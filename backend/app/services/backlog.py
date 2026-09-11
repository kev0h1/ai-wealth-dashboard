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

`[state: ...]` is one of `in-progress`, `blocked: <reason>`,
`review: <branch>`, `rejected: <reason>`, or `uat: <link>` (see
docs/ops/BACKLOG.md "Branch per item" — a session finishing work on a
worktree branch sends the item to review with the branch name attached,
and `scripts/integrate.py` either merges it to `done`, to `uat` (a
design round awaiting Kevin's choice on a real, rebuilt UAT page — see
H31), or bounces it back to `blocked` with the conflict/failure reason);
absent means to do. A
reviewer who finds a defect in an item sitting in `review` marks it
`rejected` instead of leaving it in `review` — a `review` item is treated
as consent to merge by any integrate pass, including one from a
concurrent session, so a rejection has to land on the board immediately,
not just in conversation (see the `reject` command below). Rejecting
keeps the item's branch (so the reviewer can see which branch was
refused) in a separate `[branch: <name>]` tag, since the `[state:
rejected: ...]` slot is already carrying the reason; `scripts/integrate.py`
never selects a `rejected` item as a merge candidate. Moving a rejected
item back to `todo` or `in-progress` clears both the rejection reason and
the retained branch. `uat` is the analogous state for a design round: a
branch whose diff is nothing but new preview variants under
`frontend/app/design/` (flagged explicitly via `scripts/session.sh finish
<ID> --uat-review`, or caught by a backstop heuristic in
`scripts/integrate.py` when the merged diff touches only that tree) still
gets merged and rebuilds UAT like any other item, but lands in `uat`
instead of `done`, carrying a preview link in the `[state: uat: <link>]`
slot and (like `rejected`) retaining the branch it came from in a
separate `[branch: <name>]` tag. `uat`, like `rejected`, is never picked
up by `scripts/integrate.py`'s own candidate selection — landing there is
the whole point, so it can never be merged a second time. `approve <id>
"<choice>"` records which variant Kevin picked as a dated note and moves
the item back to `in-progress` with its owner unchanged, so the same
agent implements the winner on a fresh branch. See H31 and
docs/ops/BACKLOG.md. The checkbox carries done/not-done, independent of
the state tag — marking an item done clears any state tag. A done item
gets a trailing `(done 2026-09-06, abc1234)` marker (commit hash optional,
and for an integrated item is the merge commit on main). Notes are
indented sub-bullets directly under the item line.

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
import urllib.parse
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

ITEM_STATES = ("todo", "in-progress", "blocked", "review", "rejected", "uat")
QUESTION_STATUSES = ("ready", "needs-kevin", "blocked-deploy", "submitted")
OWNERS = ("kevin", "claude", "codex")
PRIORITIES = ("p1", "p2", "p3")
DEFAULT_PRIORITY = "p3"
REASON_CAP = 200

# H31: the only host a `uat` preview link is ever allowed to point at.
# Kevin opens these links from his phone, not this VPS's loopback
# interface — a 127.0.0.1/localhost link (what a dev server prints) would
# be dead on arrival for him, which is exactly the B19 failure mode this
# state exists to fix (a preview link that served main's stale page).
# See normalise_preview_link() below.
PUBLIC_UAT_HOST = "uat.wealth.auriqltd.co.uk"
_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "0.0.0.0", "::1"}


def normalise_preview_link(raw: Optional[str]) -> str:
    """Validate/normalise a `uat` preview link so a loopback URL can never
    be stored on the board (see PUBLIC_UAT_HOST above). A loopback host
    (with or without a port) is silently rewritten onto the public UAT
    host, keeping the path and query — this is what lets
    `scripts/integrate.py` build a link without knowing or caring what
    host it happens to be running against. Anything else must already BE
    the public UAT host; any other domain raises, since a stray link to
    some other site is far more likely a mistake (or a copy-paste from a
    local dev session) than a deliberate choice. Raises BacklogError on
    anything that isn't a parseable absolute URL at all."""
    if not raw or not raw.strip():
        raise BacklogError("a preview link is required to set state to uat")
    # A URL never legitimately contains whitespace or the `[`/`]` that
    # would corrupt the `[state: uat: <link>]` tag (see one_line_reason
    # above for the same discipline on blocked/rejected reasons).
    collapsed = re.sub(r"\s+", "", raw.strip()).replace("[", "").replace("]", "")
    if not collapsed:
        raise BacklogError("a preview link is required to set state to uat")
    candidate = collapsed if "://" in collapsed else f"https://{collapsed}"
    try:
        parsed = urllib.parse.urlsplit(candidate)
    except ValueError:
        raise BacklogError(f"not a valid preview link: {raw!r}") from None
    host = (parsed.hostname or "").lower()
    if not host:
        raise BacklogError(f"not a valid preview link: {raw!r}")
    if host in _LOOPBACK_HOSTS:
        rebuilt = parsed._replace(scheme="https", netloc=PUBLIC_UAT_HOST)
        return urllib.parse.urlunsplit(rebuilt)
    if host != PUBLIC_UAT_HOST:
        raise BacklogError(
            f"preview link must be on {PUBLIC_UAT_HOST} (got {host!r}), not some other host"
        )
    rebuilt = parsed._replace(scheme="https")
    return urllib.parse.urlunsplit(rebuilt)


def one_line_reason(text: Optional[str], cap: int = REASON_CAP) -> str:
    """Sanitise a `blocked`/`rejected` reason to one line safe for the
    `[state: blocked: ...]` / `[state: rejected: ...]` tag: take the first
    non-empty line, collapse internal whitespace, strip `[`/`]` (either
    would close the tag early or open a spurious new one), and cap the
    length with an ellipsis. Every writer of a blocked/rejected reason —
    `scripts/backlog.py`, the `/ops/go-live` page, and
    `scripts/integrate.py`'s own block reasons — goes through
    `TodoDoc.set_state`, which calls this, so it is the one place that has
    to hold the one-line-per-item format (see H27: a raw multi-line
    command-output reason from `scripts/integrate.py` corrupted the
    G29/G32 item lines on 2026-09-10 and caused a merge conflict between
    two coordinator sessions)."""
    if not text:
        return ""
    first_line = ""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            first_line = stripped
            break
    collapsed = re.sub(r"\s+", " ", first_line).strip()
    collapsed = collapsed.replace("[", "").replace("]", "")
    if len(collapsed) > cap:
        if cap > 3:
            collapsed = collapsed[: cap - 3].rstrip() + "..."
        else:
            collapsed = collapsed[:cap]
    return collapsed


def _collapse_note_text(text: str) -> str:
    """Notes are one line each in TODO.md (`NOTE_RE` only ever matches a
    single list line) — a note containing a literal newline would insert a
    line into `TodoDoc.lines` that does not start with the `  - note (...)`
    prefix, so it silently stops being a note on the next parse and just
    sits in the file as stray text. Collapse embedded newlines to " / "
    instead of dropping them, so multi-line detail (e.g. a chunk of
    command output passed to `add_note`) stays readable on one line."""
    parts = [p.strip() for p in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return " / ".join(p for p in parts if p)


SECTION_HEADING_RE = re.compile(r"^## ([A-H])\. (.+)$")
ITEM_RE = re.compile(
    r"^(?P<prefix>- \[(?P<check>[ xX])\] \*\*(?P<id>[A-H]\d+)\.\s*(?P<title>.*?)\*\*)"
    r"(?P<tail>.*)$"
)
OWNER_RE = re.compile(r"\[owner:\s*(kevin|claude|codex)\]")
STATE_RE = re.compile(r"\[state:\s*(in-progress|blocked|review|rejected|uat)(?::\s*([^\]]*))?\]")
PRIORITY_RE = re.compile(r"\[priority:\s*(p1|p2|p3)\]")
UNBLOCKS_RE = re.compile(r"\[unblocks:\s*([^\]]*)\]")
# A rejected (or uat) item's branch is stored separately from `[state:
# rejected: <reason>]` / `[state: uat: <link>]` (those slots already carry
# a reason or a link) so it's still visible which branch produced this —
# `review` keeps its branch inline as `[state: review: <branch>]` instead.
BRANCH_RE = re.compile(r"\[branch:\s*([^\]]*)\]")
# H31: set by `scripts/session.sh finish <ID> --uat-review` while an item
# sits in `review`, telling `scripts/integrate.py` to land the merge in
# `uat` instead of `done` once it's clean (the same job the backstop
# heuristic over the merged diff's paths does when this marker is
# missing). Presence-only, no value, so it's not part of STATE_RE.
UAT_REVIEW_RE = re.compile(r"\[uat-review\]")
DONE_SUFFIX_RE = re.compile(r"\(done\s+(\d{4}-\d{2}-\d{2})(?:,\s*([^)]+))?\)\s*$")
NOTE_RE = re.compile(r"^  - note \((\d{4}-\d{2}-\d{2}), (kevin|claude|codex)\): (.*)$")


def _parse_unblocks(raw: str) -> list[str]:
    return [q.strip() for q in raw.split(",") if q.strip()]

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
    state: str  # "todo" | "in-progress" | "blocked" | "review" | "rejected" | "uat" (meaningless once done)
    reason: Optional[str]
    done_at: Optional[str]
    commit: Optional[str]
    line_no: int
    raw_line: str
    notes: list[BacklogNote] = field(default_factory=list)
    branch: Optional[str] = None  # set when state == "review", "rejected" or "uat"
    priority: str = DEFAULT_PRIORITY  # "p1" | "p2" | "p3", defaults to p3 when absent
    unblocks: list[str] = field(default_factory=list)  # question ids this item unblocks
    link: Optional[str] = None  # preview link, set when state == "uat" (see H31)
    uat_review: bool = False  # set via `[uat-review]` while state == "review" (see H31)

    def to_dict(self) -> dict:
        state = "done" if self.done else self.state
        return {
            "id": self.item_id,
            "section": self.section,
            "title": self.title,
            "text": self.text,
            "owner": self.owner,
            "state": state,
            "reason": self.reason if state in ("blocked", "rejected") else None,
            "branch": self.branch if state in ("review", "rejected", "uat") else None,
            "link": self.link if state == "uat" else None,
            "uat_review": self.uat_review if state == "review" else False,
            "done_at": self.done_at,
            "commit": self.commit,
            "notes": [n.to_dict() for n in self.notes],
            "priority": self.priority,
            "unblocks": list(self.unblocks),
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

    priority = DEFAULT_PRIORITY
    priority_m = PRIORITY_RE.search(tail)
    if priority_m:
        priority = priority_m.group(1)
        tail = PRIORITY_RE.sub("", tail, count=1)

    unblocks: list[str] = []
    unblocks_m = UNBLOCKS_RE.search(tail)
    if unblocks_m:
        unblocks = _parse_unblocks(unblocks_m.group(1))
        tail = UNBLOCKS_RE.sub("", tail, count=1)

    # The standalone `[branch: ...]` tag (used by `rejected`/`uat` to retain
    # the branch that produced them) is parsed before STATE_RE below so a
    # `review` item's inline branch (which STATE_RE captures directly)
    # always wins if somehow both are present.
    branch_tag: Optional[str] = None
    branch_m = BRANCH_RE.search(tail)
    if branch_m:
        branch_tag = branch_m.group(1).strip() or None
        tail = BRANCH_RE.sub("", tail, count=1)

    uat_review = False
    uat_review_m = UAT_REVIEW_RE.search(tail)
    if uat_review_m:
        uat_review = True
        tail = UAT_REVIEW_RE.sub("", tail, count=1)

    state = "todo"
    reason: Optional[str] = None
    link: Optional[str] = None
    branch: Optional[str] = branch_tag
    state_m = STATE_RE.search(tail)
    if state_m:
        state = state_m.group(1)
        detail = (state_m.group(2) or "").strip() or None
        if state in ("blocked", "rejected"):
            reason = detail
        elif state == "review":
            branch = detail
        elif state == "uat":
            link = detail
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
        reason=reason if state in ("blocked", "rejected") else None,
        done_at=done_at if done else None,
        commit=commit if done else None,
        line_no=line_no,
        raw_line=raw_line,
        branch=branch if state in ("review", "rejected", "uat") else None,
        priority=priority,
        unblocks=unblocks,
        link=link if state == "uat" else None,
        uat_review=uat_review if state == "review" else False,
    )


def _render_item_line(item: BacklogItem) -> str:
    check = "x" if item.done else " "
    prefix = f"- [{check}] **{item.item_id}. {item.title}**"

    segments: list[str] = []
    if item.owner:
        segments.append(f"[owner: {item.owner}]")
    if item.priority and item.priority != DEFAULT_PRIORITY:
        segments.append(f"[priority: {item.priority}]")
    if not item.done and item.state and item.state != "todo":
        if item.state == "blocked":
            segments.append(f"[state: blocked: {item.reason or ''}]")
        elif item.state == "review":
            segments.append(f"[state: review: {item.branch or ''}]")
            if item.uat_review:
                segments.append("[uat-review]")
        elif item.state == "rejected":
            segments.append(f"[state: rejected: {item.reason or ''}]")
            if item.branch:
                segments.append(f"[branch: {item.branch}]")
        elif item.state == "uat":
            segments.append(f"[state: uat: {item.link or ''}]")
            if item.branch:
                segments.append(f"[branch: {item.branch}]")
        else:
            segments.append(f"[state: {item.state}]")
    if item.unblocks:
        segments.append(f"[unblocks: {', '.join(item.unblocks)}]")
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
        self,
        item_id: str,
        state: str,
        reason: Optional[str] = None,
        branch: Optional[str] = None,
        link: Optional[str] = None,
        uat_review: bool = False,
    ) -> BacklogItem:
        if state not in ITEM_STATES:
            raise BacklogError(f"invalid state: {state!r} (must be one of {ITEM_STATES})")
        if state == "review" and not branch:
            raise BacklogError("branch is required to set state to review")
        if state == "rejected" and not reason:
            raise BacklogError("reason is required to set state to rejected")
        if state == "uat" and not link:
            raise BacklogError("link is required to set state to uat")
        # Sanitise before storing so a raw multi-line reason (e.g. command
        # output passed straight through from scripts/integrate.py) can
        # never corrupt the item's one-line `[state: ...]` tag — see
        # one_line_reason() above and H27.
        sanitised_reason = one_line_reason(reason) if reason else None
        # Same defence in depth for a `uat` link (H31): validated/normalised
        # here, at the lowest level, not just in the module-level set_uat()
        # wrapper, so a caller that talks to TodoDoc directly can never
        # write a loopback URL to disk either.
        normalised_link = normalise_preview_link(link) if state == "uat" else None
        item = self.item(item_id)
        item.state = state
        item.reason = sanitised_reason if state in ("blocked", "rejected") else None
        if state == "review":
            item.branch = branch
            item.link = None
            item.uat_review = uat_review
        elif state == "rejected":
            # A rejection normally follows straight out of `review`, so
            # retain whatever branch the item already had (the branch it's
            # being rejected on) unless the caller explicitly passes a
            # different one; going to any other state below clears it.
            item.branch = branch or item.branch
            item.link = None
            item.uat_review = False
        elif state == "uat":
            # A design round landing in uat normally follows straight out
            # of `review` too (see H31) — same "retain the branch unless
            # told otherwise" rule as rejected above, so the branch that
            # produced this preview stays visible.
            item.branch = branch or item.branch
            item.link = normalised_link
            item.uat_review = False
        else:
            item.branch = None
            item.link = None
            item.uat_review = False
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
        if "**" in title:
            # A literal double-asterisk in the title would close the
            # markdown bold id marker (`**<id>. <title>**`) early and
            # truncate everything after it, silently corrupting the item
            # instead of failing loudly. Single asterisks, parentheses and
            # `=` are all fine (see ITEM_RE, which stops at the first `**`
            # non-greedily rather than the first `*`).
            raise BacklogError(f"title cannot contain a literal '**': {title!r}")

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
        new_line = _render_item_line(new_item)
        self.lines.insert(insert_at, new_line)

        reparsed = TodoDoc.parse(self.text())
        self.items = reparsed.items
        self.section_headings = reparsed.section_headings
        if new_id not in self.items:
            # The line was written but ITEM_RE could not parse it back (for
            # example a title containing a literal "**" that closes the bold
            # marker early) — show the raw line so the next person can see
            # exactly what was written and why it did not round-trip,
            # instead of just "<id> is not a known backlog item.".
            raise BacklogError(
                f"{new_id} is not a known backlog item after being written; "
                f"the line did not parse back: {new_line!r}"
            )
        return self.item(new_id)

    def set_owner(self, item_id: str, owner: str) -> BacklogItem:
        if owner not in OWNERS:
            raise BacklogError(f"invalid owner: {owner!r} (must be one of {OWNERS})")
        item = self.item(item_id)
        item.owner = owner
        self._rewrite(item)
        return item

    def set_priority(self, item_id: str, priority: str) -> BacklogItem:
        if priority not in PRIORITIES:
            raise BacklogError(f"invalid priority: {priority!r} (must be one of {PRIORITIES})")
        item = self.item(item_id)
        item.priority = priority
        self._rewrite(item)
        return item

    def set_unblocks(self, item_id: str, questions: list[str]) -> BacklogItem:
        item = self.item(item_id)
        item.unblocks = [q.strip() for q in questions if q.strip()]
        self._rewrite(item)
        return item

    def add_note(self, item_id: str, text: str, actor: str) -> BacklogItem:
        item = self.item(item_id)
        note_line = f"  - note ({today_str()}, {actor}): {_collapse_note_text(text)}"
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
        unblocked_by = unblocked_by_index(self.todo.items.values())
        questions = []
        for q_id in sorted(self.compliance.questions):
            q = self.compliance.question_dict(q_id)
            q["unblocked_by"] = unblocked_by.get(q_id, [])
            questions.append(q)
        return questions


def unblocked_by_index(items: "Iterator[BacklogItem] | list[BacklogItem]") -> dict[str, list[str]]:
    """Reverse index from question id to the sorted list of item ids whose
    `unblocks` tag names that question — used to annotate each question
    with `unblocked_by` so the board can show "Unblocked by A1, A2"."""
    index: dict[str, list[str]] = {}
    for item in items:
        for q_id in item.unblocks:
            index.setdefault(q_id, []).append(item.item_id)
    for q_id in index:
        index[q_id] = sorted(index[q_id])
    return index


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
    link: Optional[str] = None,
    uat_review: bool = False,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.set_state(item_id, state, reason=reason, branch=branch, link=link, uat_review=uat_review)
        doc.save(resolved_path)
    action = {
        "in-progress": "started",
        "blocked": "blocked",
        "todo": "reset to to-do",
        "review": f"sent to review ({branch})",
        "rejected": f"rejected ({reason})",
        "uat": f"sent to uat ({item.link})",
    }[state]
    committed = _git_commit_and_push([resolved_path], f"backlog: {item_id} {action} by {actor}", resolved_root)
    return item.to_dict(), committed


def set_review(
    item_id: str,
    branch: str,
    actor: str = "claude",
    uat_review: bool = False,
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    """Convenience wrapper over `set_state(..., "review", branch=branch)` —
    what `scripts/session.sh finish` calls once tests are green and the
    branch is pushed, and what `scripts/integrate.py` reads back to find
    the branches waiting to be merged into main. `uat_review=True` (passed
    through from `scripts/session.sh finish <ID> --uat-review`) marks this
    as a design round: `scripts/integrate.py` lands a clean merge in `uat`
    instead of `done` when it sees the flag (see H31), same as its own
    backstop heuristic does when the flag is missing but the merged diff
    touches only `frontend/app/design/`."""
    return set_state(
        item_id, "review", branch=branch, uat_review=uat_review, actor=actor, todo_path=todo_path, repo_root=repo_root
    )


def set_uat(
    item_id: str,
    link: str,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    """Move `item_id` into `uat`: a design round has landed on a rebuilt
    UAT and is waiting on Kevin's review, not on integrate's next pass
    (`uat` is never selected as a merge candidate — see
    `scripts/integrate.py` `_review_items()`, which only ever looks at
    `review` state). `link` is validated/normalised by
    `normalise_preview_link` so a loopback URL can never be stored; see
    H31."""
    return set_state(item_id, "uat", link=link, actor=actor, todo_path=todo_path, repo_root=repo_root)


def set_approved(
    item_id: str,
    choice: str,
    actor: str = "kevin",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    """Kevin's pick from a `uat` round: records `choice` as a dated note
    (same date/actor/history shape as any other note) and moves the item
    back to `in-progress` with its owner left UNCHANGED, so the same agent
    that built the variants implements the winner on a fresh branch — this
    deliberately never reassigns owner the way a plain `start` implicitly
    would leave it. Raises if the item isn't currently in `uat` (there's
    nothing to approve about a review or a todo item; use `review` /
    `reject` / `start` for those). See H31."""
    if not choice or not choice.strip():
        raise BacklogError("a choice is required to approve a uat item")
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    choice_clean = choice.strip()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.item(item_id)
        if item.state != "uat":
            raise BacklogError(f"{item_id} is not awaiting uat review (state: {item.state})")
        doc.add_note(item_id, f"approved: {choice_clean}", actor)
        item = doc.set_state(item_id, "in-progress")
        doc.save(resolved_path)
    committed = _git_commit_and_push(
        [resolved_path], f"backlog: {item_id} approved ({choice_clean}) by {actor}", resolved_root
    )
    return item.to_dict(), committed


def set_rejected(
    item_id: str,
    reason: str,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    """Convenience wrapper over `set_state(..., "rejected", reason=reason)`
    — what a reviewer uses the moment they find a defect in an item sitting
    in `review`, rather than leaving it there (where any integrate pass,
    including one from a concurrent session, treats `review` as consent to
    merge). Keeps the item's existing branch (see `TodoDoc.set_state`) so
    the reviewer can see which branch was refused;
    `scripts/integrate.py` never selects a `rejected` item as a merge
    candidate."""
    return set_state(item_id, "rejected", reason=reason, actor=actor, todo_path=todo_path, repo_root=repo_root)


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


def set_priority(
    item_id: str,
    priority: str,
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.set_priority(item_id, priority)
        doc.save(resolved_path)
    committed = _git_commit_and_push(
        [resolved_path], f"backlog: {item_id} priority set to {priority} by {actor}", resolved_root
    )
    return item.to_dict(), committed


def set_unblocks(
    item_id: str,
    questions: list[str],
    actor: str = "claude",
    *,
    todo_path: Optional[Path] = None,
    repo_root: Optional[Path] = None,
) -> tuple[dict, bool]:
    resolved_path = todo_path or _todo_path()
    resolved_root = repo_root or _repo_root()
    with _locked(resolved_root):
        doc = TodoDoc.load(resolved_path)
        item = doc.set_unblocks(item_id, questions)
        doc.save(resolved_path)
    label = ", ".join(item.unblocks) if item.unblocks else "none"
    committed = _git_commit_and_push(
        [resolved_path], f"backlog: {item_id} unblocks set to {label} by {actor}", resolved_root
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
