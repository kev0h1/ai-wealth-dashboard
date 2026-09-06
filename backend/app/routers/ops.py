"""Private go-live readiness page — renders TODO.md and the Finexer
questionnaire/pricing docs from the repo root for Kevin only.

The markdown files are the source of truth; this router only reads and
returns them (no editing endpoint). Restricted to the account owner because
the backlog and the compliance answers are not for every allow-listed
tester. Content must never be served as static HTML (fetchable
unauthenticated) — it goes through the normal session-gated API instead,
same as every other endpoint (see app.core.auth.current_user /
auth_middleware).
"""
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL

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


@router.get("/go-live")
async def go_live(user: dict = Depends(current_user)):
    if (user.get("email") or "").strip().lower() != PRIMARY_EMAIL:
        raise HTTPException(403, "Not authorised")

    root = _repo_root()
    files: dict[str, dict] = {}
    for key, relpath in _FILES.items():
        doc = _read_doc(root, relpath)
        if doc is not None:
            files[key] = doc
    return {"files": files}
