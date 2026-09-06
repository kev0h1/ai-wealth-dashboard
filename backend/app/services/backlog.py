"""Shared backlog model for `TODO.md` and the Finexer questionnaire doc.

Replaces the old Jira sync (`scripts/jira_sync.py`, now deleted). Kevin
chose our own board over Jira: the markdown files stay the single source
of truth for both content (what an item says) and workflow (to do / in
progress / blocked / done, who owns it, notes). Git is the history. The
private page `/ops/go-live` and `scripts/backlog.py` both read and write
through this module so the file, the page and git history stay one thing.

Model on a TODO.md item line:

    - [ ] **A1. Title.** [owner: claude] [state: in-progress] Description text.
      - note (2026-09-06, kevin): a note about A1.

`[state: ...]` is one of `in-progress`, `blocked: <reason>`, or
`review: <branch>` (see docs/ops/BACKLOG.md "Branch per item" — a session
finishing work on a worktree branch sends the item to review with the
branch name attached, and `scripts/integrate.py` either merges it to `done`
or bounces it back to `blocked` with the conflict/failure reason); absent
means to do. The checkbox carries done/not-done, independent of the state
tag — marking an item done clears any state tag. A done item gets a
trailing `(done 2026-09-06, abc1234)` marker (commit hash optional, and for
an integrated item is the merge commit on main). Notes are indented
sub-bullets directly under the item line.

Questions in the compliance doc keep their existing `## Qn <title>` /
`Status: <status>` shape; `status` is one of ready, needs-kevin,
blocked-deploy, submitted.

Every public mutator (`set_done`, `set_state`, `set_owner`, `add_note`,
`set_question_status`) writes the file atomically (temp file + rename)
under an `fcntl.flock` on `.backlog.lock` in the repo root, then attempts
a `git add` + `git commit` + `git push` of just that file. A failed
commit or push is logged and reported back as `committed: False`; the
file write itself is never lost because it happens before any git call.
"""
from __future__ import annotations

import fcntl
import logging
import os
import re
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Iterator, Optional

logger = logging.getLogger(__name__)


def _repo_root() -> Path:
    """The board's repo root is fixed to the shared tree, not wherever this
    file's checkout happens to live. Every git worktree under
    /root/worktrees/<branch> (see docs/ops/BACKLOG.md "Branch per item") has
    its own copy of this very file, so the old `Path(__file__).resolve()
    .parents[3]` trick resolved to the *worktree* when a session ran the CLI
    from inside one — silently forking the board instead of editing the one
    everyone shares. Fixed to `/root/ai-wealth-dashboard` regardless of cwd
    or `__file__`; override with `BACKLOG_ROOT` for tests or a genuinely
    different deployment layout. (`backend/app/routers/ops.py` has its own
    `_repo_root()` for the live API process, which runs from the shared tree
    only and is unaffected by this.)"""
    env_root = os.environ.get("BACKLOG_ROOT")
    if env_root:
        return Path(env_root)
    return Path("/root/ai-wealth-dashboard")


def _todo_path() -> Path:
    return _repo_root() / "TODO.md"


def _compliance_path() -> Path:
    return _repo_root() / "docs" / "compliance" / "finexer-agent-controls-2026-09.md"


# Snapshots at import time for any external code that still reaches for
# these names directly. Everything in this module calls _repo_root() /
# _todo_path() / _compliance_path() fresh instead, so BACKLOG_ROOT and the
# worktree-vs-shared-tree fix above always apply regardless of import order.
REPO_ROOT = _repo_root()
TODO_PATH = _todo_path()
COMPLIANCE_PATH = _compliance_path()

GIT_AUTHOR = "Sorted Ops <ops@auriqltd.co.uk>"
GIT_TIMEOUT = 15

ITEM_STATES = ("todo", "in-progress", "blocked", "review")
QUESTION_STATUSES = ("ready", "needs-kevin", "blocked-deploy", "submitted")
OWNERS = ("kevin", "claude")

SECTION_HEADING_RE = re.compile(r"^## ([A-H])\. (.+)$")
ITEM_RE = re.compile(
    r"^(?P<prefix>- \[(?P<check>[ xX])\] \*\*(?P<id>[A-H]\d+)\.\s*(?P<title>[^*]*)\*\*)"
    r"(?P<tail>.*)$"
)
OWNER_RE = re.compile(r"\[owner:\s*(kevin|claude)\]")
STATE_RE = re.compile(r"\[state:\s*(in-progress|blocked|review)(?::\s*([^\]]*))?\]")
DONE_SUFFIX_RE = re.compile(r"\(done\s+(\d{4}-\d{2}-\d{2})(?:,\s*([^)]+))?\)\s*$")
NOTE_RE = re.compile(r"^  - note \((\d{4}-\d{2}-\d{2}), (kevin|claude)\): (.*)$")

QUESTION_HEADING_RE = re.compile(r"^## (Q\d+) (.+)$")
STATUS_LINE_RE = re.compile(r"^Status:\s*(ready|needs-kevin|blocked-deploy|submitted)\s*$")
ANSWER_FENCE_RE = re.compile(r"```text\n([\s\S]*?)```")
KEVIN_MARKER_RE = re.compile(r"\[KEVIN:[^\]]*\]")


class BacklogError(RuntimeError):
    """Raised for any user/caller-facing failure (unknown id, bad enum)."""


def today_str() -> str:
    return date.today().isoformat()


# --------------------------------------------------------------------------
# Atomic write + file lock
# --------------------------------------------------------------------------


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp{__import__('os').getpid()}")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


@contextmanager
def _locked(repo_root: Path) -> Iterator[None]:
    repo_root.mkdir(parents=True, exist_ok=True)
    lock_path = repo_root / ".backlog.lock"
    with open(lock_path, "a+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def _git_commit_and_push(paths: list[Path], message: str, repo_root: Path) -> bool:
    """Best-effort `git add` + `git commit` + `git push` of exactly `paths`.

    Returns True only if both the commit and the push succeed. Any failure
    (including a timeout) is logged and swallowed — the caller has already
    written the file by the time this runs, so a git failure never loses
    the edit, it just means the page should show "git commit failed"."""
    rel: list[str] = []
    for p in paths:
        try:
            rel.append(str(p.relative_to(repo_root)))
        except ValueError:
            rel.append(str(p))
    try:
        subprocess.run(
            ["git", "add", *rel], cwd=repo_root, check=True, capture_output=True, timeout=GIT_TIMEOUT
        )
        subprocess.run(
            ["git", "commit", "-m", message, "--author", GIT_AUTHOR, "--", *rel],
            cwd=repo_root,
            check=True,
            capture_output=True,
            timeout=GIT_TIMEOUT,
        )
    except Exception:
        logger.warning("backlog: git commit failed for %s", rel, exc_info=True)
        return False
    try:
        subprocess.run(
            ["git", "push", "origin", "HEAD"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            timeout=GIT_TIMEOUT,
        )
    except Exception:
        logger.warning("backlog: git push failed for %s (commit still landed locally)", rel, exc_info=True)
        return False
    return True


# --------------------------------------------------------------------------
# TODO.md model
# --------------------------------------------------------------------------


@dataclass
class BacklogNote:
    date: str
    actor: str
    text: str
    line_no: int

    def to_dict(self) -> dict:
        return {"date": self.date, "actor": self.actor, "text": self.text}


@dataclass
class BacklogItem:
    item_id: str
    section: str
    title: str
    text: str
    owner: Optional[str]
    done: bool
    state: str  # "todo" | "in-progress" | "blocked" | "review" (meaningless once done)
    reason: Optional[str]
    done_at: Optional[str]
    commit: Optional[str]
    line_no: int
    raw_line: str
    notes: list[BacklogNote] = field(default_factory=list)
    branch: Optional[str] = None  # set when state == "review"

    def to_dict(self) -> dict:
        state = "done" if self.done else self.state
        return {
            "id": self.item_id,
            "section": self.section,
            "title": self.title,
            "text": self.text,
            "owner": self.owner,
            "state": state,
            "reason": self.reason if state == "blocked" else None,
            "branch": self.branch if state == "review" else None,
            "done_at": self.done_at,
            "commit": self.commit,
            "notes": [n.to_dict() for n in self.notes],
        }


def _parse_item_line(match: "re.Match[str]", section: str, line_no: int, raw_line: str) -> BacklogItem:
    tail = match.group("tail").strip()

    done = match.group("check").lower() == "x"

    done_at: Optional[str] = None
    commit: Optional[str] = None
    done_m = DONE_SUFFIX_RE.search(tail)
    if done_m:
        done_at, commit = done_m.group(1), done_m.group(2)
        tail = tail[: done_m.start()].rstrip()

    owner: Optional[str] = None
    owner_m = OWNER_RE.search(tail)
    if owner_m:
        owner = owner_m.group(1)
        tail = OWNER_RE.sub("", tail, count=1)

    state = "todo"
    reason: Optional[str] = None
    branch: Optional[str] = None
    state_m = STATE_RE.search(tail)
    if state_m:
        state = state_m.group(1)
        detail = (state_m.group(2) or "").strip() or None
        if state == "blocked":
            reason = detail
        elif state == "review":
            branch = detail
        tail = STATE_RE.sub("", tail, count=1)

    text = re.sub(r"\s{2,}", " ", tail).strip()

    return BacklogItem(
        item_id=match.group("id"),
        section=section or match.group("id")[0],
        title=match.group("title").strip(),
        text=text,
        owner=owner,
        done=done,
        state=state,
        reason=reason if state == "blocked" else None,
        done_at=done_at if done else None,
        commit=commit if done else None,
        line_no=line_no,
        raw_line=raw_line,
        branch=branch if state == "review" else None,
    )


def _render_item_line(item: BacklogItem) -> str:
    check = "x" if item.done else " "
    prefix = f"- [{check}] **{item.item_id}. {item.title}**"

    segments: list[str] = []
    if item.owner:
        segments.append(f"[owner: {item.owner}]")
    if not item.done and item.state and item.state != "todo":
        if item.state == "blocked":
            segments.append(f"[state: blocked: {item.reason or ''}]")
        elif item.state == "review":
            segments.append(f"[state: review: {item.branch or ''}]")
        else:
            segments.append(f"[state: {item.state}]")
    if item.text:
        segments.append(item.text)
    if item.done:
        suffix = f"(done {item.done_at or today_str()}"
        if item.commit:
            suffix += f", {item.commit}"
        suffix += ")"
        segments.append(suffix)

    tail = " ".join(segments)
    return f"{prefix} {tail}" if tail else prefix


@dataclass
class TodoDoc:
    lines: list[str]
    items: dict[str, BacklogItem] = field(default_factory=dict)
    section_headings: dict[str, tuple[int, str]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "TodoDoc":
        return cls.parse((path or _todo_path()).read_text(encoding="utf-8"))

    @classmethod
    def parse(cls, text: str) -> "TodoDoc":
        lines = text.split("\n")
        doc = cls(lines=lines)
        current_section = ""
        for i, line in enumerate(lines):
            heading = SECTION_HEADING_RE.match(line)
            if heading:
                current_section = heading.group(1)
                doc.section_headings[current_section] = (i, heading.group(2))
                continue
            m = ITEM_RE.match(line)
            if not m:
                continue
            item = _parse_item_line(m, current_section, i, line)
            doc.items[item.item_id] = item

        for item in doc.items.values():
            j = item.line_no + 1
            while j < len(lines):
                note_m = NOTE_RE.match(lines[j])
                if not note_m:
                    break
                item.notes.append(
                    BacklogNote(date=note_m.group(1), actor=note_m.group(2), text=note_m.group(3), line_no=j)
                )
                j += 1
        return doc

    def text(self) -> str:
        return "\n".join(self.lines)

    def save(self, path: Optional[Path] = None) -> None:
        _atomic_write(path or _todo_path(), self.text())

    def item(self, item_id: str) -> BacklogItem:
        try:
            return self.items[item_id]
        except KeyError:
            raise BacklogError(f"{item_id} is not a known backlog item.") from None

    def _rewrite(self, item: BacklogItem) -> None:
        self.lines[item.line_no] = _render_item_line(item)
        item.raw_line = self.lines[item.line_no]

    def set_done(self, item_id: str, done: bool, commit: Optional[str] = None) -> BacklogItem:
        item = self.item(item_id)
        item.done = done
        if done:
            item.done_at = today_str()
            item.commit = commit
            item.state = "todo"
            item.reason = None
        else:
            item.done_at = None
            item.commit = None
        self._rewrite(item)
        return item

    def set_state(
        self, item_id: str, state: str, reason: Optional[str] = None, branch: Optional[str] = None
    ) -> BacklogItem:
        if state not in ITEM_STATES:
            raise BacklogError(f"invalid state: {state!r} (must be one of {ITEM_STATES})")
        if state == "review" and not branch:
            raise BacklogError("branch is required to set state to review")
        item = self.item(item_id)
        item.state = state
        item.reason = reason if state == "blocked" else None
        item.branch = branch if state == "review" else None
        self._rewrite(item)
        return item

    def add_item(self, section: str, title: str, owner: Optional[str] = None) -> BacklogItem:
        """Allocate the next id in `section` and append it as a new to-do
        item at the end of that section's block (just before the next
        section heading, or end of file for the last section)."""
        if section not in self.section_headings:
            raise BacklogError(f"unknown section: {section!r} (no '## {section}. ...' heading in the board)")
        if owner is not None and owner not in OWNERS:
            raise BacklogError(f"invalid owner: {owner!r} (must be one of {OWNERS})")

        existing_nums = [
            int(m.group(1))
            for item_id, item in self.items.items()
            if item.section == section
            for m in [re.match(rf"^{re.escape(section)}(\d+)$", item_id)]
            if m
        ]
        new_id = f"{section}{max(existing_nums, default=0) + 1}"

        heading_line_no, _ = self.section_headings[section]
        later_headings = [ln for ln, _ in self.section_headings.values() if ln > heading_line_no]
        end_line = min(later_headings) if later_headings else len(self.lines)

        insert_at = end_line
        while insert_at > heading_line_no + 1 and self.lines[insert_at - 1].strip() == "":
            insert_at -= 1

        new_item = BacklogItem(
            item_id=new_id,
            section=section,
            title=title.strip(),
            text="",
            owner=owner,
            done=False,
            state="todo",
            reason=None,
            done_at=None,
            commit=None,
            line_no=insert_at,
            raw_line="",
        )
        self.lines.insert(insert_at, _render_item_line(new_item))

        reparsed = TodoDoc.parse(self.text())
        self.items = reparsed.items
        self.section_headings = reparsed.section_headings
        return self.item(new_id)

    def set_owner(self, item_id: str, owner: str) -> BacklogItem:
        if owner not in OWNERS:
            raise BacklogError(f"invalid owner: {owner!r} (must be one of {OWNERS})")
        item = self.item(item_id)
        item.owner = owner
        self._rewrite(item)
        return item

    def add_note(self, item_id: str, text: str, actor: str) -> BacklogItem:
        item = self.item(item_id)
        note_line = f"  - note ({today_str()}, {actor}): {text}"
        insert_at = item.line_no + 1 + len(item.notes)
        self.lines.insert(insert_at, note_line)
        reparsed = TodoDoc.parse(self.text())
        self.items = reparsed.items
        self.section_headings = reparsed.section_headings
        return self.item(item_id)


# --------------------------------------------------------------------------
# Compliance questionnaire model
# --------------------------------------------------------------------------


@dataclass
class BacklogQuestion:
    q_id: str
    title: str
    status: str
    status_line_no: int
    heading_line_no: int
    raw_status_line: str


@dataclass
class ComplianceDoc:
    lines: list[str]
    questions: dict[str, BacklogQuestion] = field(default_factory=dict)
    _next_heading: dict[str, int] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Optional[Path] = None) -> "ComplianceDoc":
        return cls.parse((path or _compliance_path()).read_text(encoding="utf-8"))

    @classmethod
    def parse(cls, text: str) -> "ComplianceDoc":
        lines = text.split("\n")
        doc = cls(lines=lines)
        headings: list[tuple[int, str, str]] = []
        for i, line in enumerate(lines):
            m = QUESTION_HEADING_RE.match(line)
            if m:
                headings.append((i, m.group(1), m.group(2).strip()))
        for idx, (heading_line, q_id, title) in enumerate(headings):
            next_line = headings[idx + 1][0] if idx + 1 < len(headings) else len(lines)
            doc._next_heading[q_id] = next_line
            status_line_no = None
            for j in range(heading_line + 1, next_line):
                if STATUS_LINE_RE.match(lines[j]):
                    status_line_no = j
                    break
            if status_line_no is None:
                continue
            sm = STATUS_LINE_RE.match(lines[status_line_no])
            doc.questions[q_id] = BacklogQuestion(
                q_id=q_id,
                title=title,
                status=sm.group(1),
                status_line_no=status_line_no,
                heading_line_no=heading_line,
                raw_status_line=lines[status_line_no],
            )
        return doc

    def text(self) -> str:
        return "\n".join(self.lines)

    def save(self, path: Optional[Path] = None) -> None:
        _atomic_write(path or _compliance_path(), self.text())

    def question(self, q_id: str) -> BacklogQuestion:
        try:
            return self.questions[q_id]
        except KeyError:
            raise BacklogError(f"{q_id} is not a known question.") from None

    def set_status(self, q_id: str, status: str) -> BacklogQuestion:
        if status not in QUESTION_STATUSES:
            raise BacklogError(f"invalid status: {status!r} (must be one of {QUESTION_STATUSES})")
        q = self.question(q_id)
        self.lines[q.status_line_no] = f"Status: {status}"
        q.status = status
        q.raw_status_line = self.lines[q.status_line_no]
        return q

    def question_dict(self, q_id: str) -> dict:
        q = self.question(q_id)
        end = self._next_heading.get(q_id, len(self.lines))
        body = "\n".join(self.lines[q.heading_line_no + 1 : end])
        fence_m = ANSWER_FENCE_RE.search(body)
        answer = fence_m.group(1).strip() if fence_m else ""
        kevin_markers = KEVIN_MARKER_RE.findall(answer)
        return {
            "q": q.q_id,
            "title": f"{q.q_id} {q.title}",
            "status": q.status,
            "chars": len(answer),
            "kevin_markers": kevin_markers,
            "answer": answer,
        }


# --------------------------------------------------------------------------
# Public read API
# --------------------------------------------------------------------------


@dataclass
class Backlog:
    todo: TodoDoc
    compliance: ComplianceDoc

    def items(self) -> list[dict]:
        return [self.todo.items[item_id].to_dict() for item_id in sorted(self.todo.items)]

    def questions(self) -> list[dict]:
        return [self.compliance.question_dict(q_id) for q_id in sorted(self.compliance.questions)]


def load(todo_path: Optional[Path] = None, compliance_path: Optional[Path] = None) -> Backlog:
    return Backlog(todo=TodoDoc.load(todo_path), compliance=ComplianceDoc.load(compliance_path))


# --------------------------------------------------------------------------
# Public mutators — each locks, loads, mutates, saves, then best-effort
# commits and pushes just the one file it touched.
# --------------------------------------------------------------------------


def set_done(
    item_id: str,
    done: bool,
    commit: Optional[str] = None,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.set_done(item_id, done, commit=commit)
        doc.save(resolved_path)
    action = "done" if done else "reopened"
    committed = _git_commit_and_push([resolved_path], f"backlog: {item_id} {action} by {actor}", resolved_root)
    return item.to_dict(), committed


def set_state(
    item_id: str,
    state: str,
    reason: Optional[str] = None,
    branch: Optional[str] = None,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.set_state(item_id, state, reason=reason, branch=branch)
        doc.save(resolved_path)
    action = {
        "in-progress": "started",
        "blocked": "blocked",
        "todo": "reset to to-do",
        "review": f"sent to review ({branch})",
    }[state]
    committed = _git_commit_and_push([resolved_path], f"backlog: {item_id} {action} by {actor}", resolved_root)
    return item.to_dict(), committed


def set_review(
    item_id: str,
    branch: str,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    """Convenience wrapper over `set_state(..., "review", branch=branch)` —
    what `scripts/session.sh finish` calls once tests are green and the
    branch is pushed, and what `scripts/integrate.py` reads back to find
    the branches waiting to be merged into main."""
    return set_state(item_id, "review", branch=branch, actor=actor, todo_path=todo_path, repo_root=repo_root)


def add_item(
    section: str,
    title: str,
    owner: Optional[str] = None,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.add_item(section, title, owner=owner)
        doc.save(resolved_path)
    committed = _git_commit_and_push([resolved_path], f"backlog: {item.item_id} added by {actor}", resolved_root)
    return item.to_dict(), committed


def set_owner(
    item_id: str,
    owner: str,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.set_owner(item_id, owner)
        doc.save(resolved_path)
    committed = _git_commit_and_push(
        [resolved_path], f"backlog: {item_id} owner set to {owner} by {actor}", resolved_root
    )
    return item.to_dict(), committed


def add_note(
    item_id: str,
    text: str,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.add_note(item_id, text, actor)
        doc.save(resolved_path)
    committed = _git_commit_and_push([resolved_path], f"backlog: {item_id} note added by {actor}", resolved_root)
    return item.to_dict(), committed


def set_question_status(
    q_id: str,
    status: str,
    actor: str = "kevin",
    *,
    compliance_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = compliance_path or _compliance_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = ComplianceDoc.load(resolved_path)
        doc.set_status(q_id, status)
        doc.save(resolved_path)
        result = doc.question_dict(q_id)
    committed = _git_commit_and_push(
        [resolved_path], f"backlog: {q_id} status set to {status} by {actor}", resolved_root
    )
    return result, committed
