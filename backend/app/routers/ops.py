"""Private go-live readiness board — renders and edits TODO.md and the
Finexer questionnaire/pricing docs from the repo root, for Kevin only.

The markdown files stay the source of truth; this router reads them (GET)
and, through `app.services.backlog`, writes them (POST) with an atomic
write + file lock + best-effort git commit/push of just the file that
changed. See `docs/ops/BACKLOG.md` for the model. Restricted to the
account owner because the backlog and the compliance answers are not for
every allow-listed tester. Content must never be served as static HTML
(fetchable unauthenticated) — it goes through the normal session-gated API
instead, same as every other endpoint (see app.core.auth.current_user /
auth_middleware).
"""
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL
from app.services import backlog

router = APIRouter(prefix="/ops", tags=["ops"])

# Relative to the repo root (not the backend package).
_FILES = {
    "todo": "TODO.md",
    "compliance": "docs/compliance/finexer-agent-controls-2026-09.md",
    "pricing": "docs/pricing/tiering-unit-economics-mcp-2026-09.md",
}


def _repo_root() -> Path:
    """backend/app/routers/ops.py -> parents[3] is the repo root that also
    holds TODO.md and docs/ (verified: parents[0]=routers, [1]=app,
    [2]=backend, [3]=repo root). Production runs from the `backend/`
    directory alone (see DEPLOY.md), so that computed path won't contain
    TODO.md there; REPO_ROOT lets an operator point this at a full checkout
    if they ever want the page live in production too. Otherwise the
    missing-file branch in `go_live` below just omits those keys."""
    candidate = Path(__file__).resolve().parents[3]
    if (candidate / "TODO.md").is_file():
        return candidate
    env_root = os.getenv("REPO_ROOT")
    if env_root:
        return Path(env_root)
    return candidate


def _require_owner(user: dict) -> None:
    if (user.get("email") or "").strip().lower() != PRIMARY_EMAIL:
        raise HTTPException(403, "Not authorised")


def _read_doc(root: Path, relpath: str) -> dict | None:
    path = root / relpath
    try:
        if not path.is_file():
            return None
        markdown = path.read_text(encoding="utf-8")
        updated_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except OSError:
        return None
    return {"markdown": markdown, "updated_at": updated_at}


def _load_items(todo_path: Path) -> list[dict]:
    if not todo_path.is_file():
        return []
    try:
        doc = backlog.TodoDoc.load(todo_path)
    except OSError:
        return []
    return [doc.items[item_id].to_dict() for item_id in sorted(doc.items)]


def _load_questions(compliance_path: Path, items: list[dict]) -> list[dict]:
    if not compliance_path.is_file():
        return []
    try:
        doc = backlog.ComplianceDoc.load(compliance_path)
    except OSError:
        return []
    unblocked_by: dict[str, list[str]] = {}
    for item in items:
        for q_id in item.get("unblocks") or []:
            unblocked_by.setdefault(q_id, []).append(item["id"])
    for q_id in unblocked_by:
        unblocked_by[q_id] = sorted(unblocked_by[q_id])
    questions = []
    for q_id in sorted(doc.questions):
        q = doc.question_dict(q_id)
        q["unblocked_by"] = unblocked_by.get(q_id, [])
        questions.append(q)
    return questions


async def _go_live_payload(user: dict) -> dict:
    _require_owner(user)
    root = _repo_root()
    files: dict[str, dict] = {}
    for key, relpath in _FILES.items():
        doc = _read_doc(root, relpath)
        if doc is not None:
            files[key] = doc
    items = _load_items(root / _FILES["todo"])
    return {
        "files": files,
        "items": items,
        "questions": _load_questions(root / _FILES["compliance"], items),
    }


@router.get("/go-live")
async def go_live(user: dict = Depends(current_user)):
    return await _go_live_payload(user)


class ItemActionRequest(BaseModel):
    action: Literal["done", "reopen", "start", "block", "note", "owner", "priority", "unblocks", "todo"]
    reason: Optional[str] = None
    text: Optional[str] = None
    owner: Optional[Literal["kevin", "claude"]] = None
    commit: Optional[str] = None
    priority: Optional[Literal["p1", "p2", "p3"]] = None
    questions: Optional[list[str]] = None


class QuestionStatusRequest(BaseModel):
    status: Literal["ready", "needs-kevin", "blocked-deploy", "submitted"]


# The page is owner-only end to end (see _require_owner below), so every
# write it makes is attributed to Kevin regardless of which session's
# browser sent it.
_PAGE_ACTOR = "kevin"


@router.post("/go-live/items/{item_id}")
async def go_live_item_action(item_id: str, body: ItemActionRequest, user: dict = Depends(current_user)):
    _require_owner(user)
    root = _repo_root()
    todo_path = root / _FILES["todo"]

    try:
        if body.action == "done":
            _, committed = backlog.set_done(
                item_id, True, commit=body.commit, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root
            )
        elif body.action == "reopen":
            _, committed = backlog.set_done(item_id, False, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root)
        elif body.action == "todo":
            # Resets the `[state: ...]` tag on a not-done item (board drag
            # from In progress or Blocked back to To do). For a *done* item
            # the board sends "reopen" instead (see BoardView.tsx's drop
            # mapping), which also clears the `done` flag via `set_done` —
            # "todo" deliberately stays a single, single-commit call rather
            # than chaining two writes for a case the frontend never hits.
            _, committed = backlog.set_state(item_id, "todo", actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root)
        elif body.action == "start":
            _, committed = backlog.set_state(
                item_id, "in-progress", actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root
            )
        elif body.action == "block":
            if not body.reason:
                raise HTTPException(400, "reason is required to block an item")
            _, committed = backlog.set_state(
                item_id, "blocked", reason=body.reason, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root
            )
        elif body.action == "note":
            if not body.text:
                raise HTTPException(400, "text is required to add a note")
            _, committed = backlog.add_note(item_id, body.text, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root)
        elif body.action == "owner":
            if not body.owner:
                raise HTTPException(400, "owner is required")
            _, committed = backlog.set_owner(item_id, body.owner, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root)
        elif body.action == "priority":
            if not body.priority:
                raise HTTPException(400, "priority is required")
            _, committed = backlog.set_priority(
                item_id, body.priority, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root
            )
        elif body.action == "unblocks":
            if body.questions is None:
                raise HTTPException(400, "questions is required")
            _, committed = backlog.set_unblocks(
                item_id, body.questions, actor=_PAGE_ACTOR, todo_path=todo_path, repo_root=root
            )
        else:  # unreachable given the Literal type, kept for clarity
            raise HTTPException(400, f"unknown action: {body.action}")
    except backlog.BacklogError as exc:
        raise HTTPException(404, str(exc)) from exc

    payload = await _go_live_payload(user)
    payload["committed"] = committed
    return payload


@router.post("/go-live/questions/{q}")
async def go_live_question_status(q: str, body: QuestionStatusRequest, user: dict = Depends(current_user)):
    _require_owner(user)
    root = _repo_root()
    compliance_path = root / _FILES["compliance"]

    try:
        _, committed = backlog.set_question_status(
            q, body.status, actor=_PAGE_ACTOR, compliance_path=compliance_path, repo_root=root
        )
    except backlog.BacklogError as exc:
        raise HTTPException(404, str(exc)) from exc

    payload = await _go_live_payload(user)
    payload["committed"] = committed
    return payload
