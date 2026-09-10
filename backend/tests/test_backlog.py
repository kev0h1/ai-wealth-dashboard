"""Tests for backend/app/services/backlog.py — the shared TODO.md /
compliance-questionnaire model behind `scripts/backlog.py` and the
`/ops/go-live` write endpoints.

Everything here runs on temp copies of TODO.md / the compliance doc under
`tmp_path` (never the real files), and mocks `subprocess.run` so no test
ever touches the real git history or network.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, call

import pytest

from app.services import backlog

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_BACKLOG = REPO_ROOT / "scripts" / "backlog.py"


TODO_FIXTURE = """# Backlog fixture

Some intro paragraph.

## A. Section A heading

- [ ] **A1. First item.** [owner: claude] Some description text about A1.
- [x] **A2. Second item.** [owner: kevin] Already done text. (done 2026-09-01, abc1230)
- [ ] **A3. Third item.** [owner: claude] Has notes below already.
  - note (2026-09-02, kevin): an existing note.

## B. Section B heading

- [ ] **B1. Only item in B.** [owner: claude] Something about B1.
"""

COMPLIANCE_FIXTURE = """# Fixture compliance doc

## Q1 Start date

Status: ready

```text
2026-10-01
```

## Q2 Material changes

Status: needs-kevin

```text
Some answer body for Q2. [KEVIN: confirm this figure]
```

## Q3 Already submitted

Status: blocked-deploy

```text
Some answer body for Q3.
```
"""


@pytest.fixture()
def paths(tmp_path: Path) -> tuple[Path, Path]:
    todo_path = tmp_path / "TODO.md"
    todo_path.write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_path = tmp_path / "compliance.md"
    compliance_path.write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    return todo_path, compliance_path


@pytest.fixture()
def mock_git(monkeypatch):
    """Replaces subprocess.run so no test shells out to real git. Returns
    the MagicMock so tests can inspect call args or force a failure."""
    mock_run = MagicMock()
    mock_run.return_value = MagicMock(returncode=0)
    monkeypatch.setattr(backlog.subprocess, "run", mock_run)
    return mock_run


# ---------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------


def test_parses_items_owners_state_and_notes():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    assert set(doc.items) == {"A1", "A2", "A3", "B1"}

    a1 = doc.items["A1"]
    assert a1.owner == "claude"
    assert a1.done is False
    assert a1.state == "todo"
    assert a1.text == "Some description text about A1."
    assert a1.notes == []

    a2 = doc.items["A2"]
    assert a2.done is True
    assert a2.done_at == "2026-09-01"
    assert a2.commit == "abc1230"
    assert a2.text == "Already done text."

    a3 = doc.items["A3"]
    assert len(a3.notes) == 1
    assert a3.notes[0].date == "2026-09-02"
    assert a3.notes[0].actor == "kevin"
    assert a3.notes[0].text == "an existing note."

    assert doc.items["A1"].section == "A"
    assert doc.items["B1"].section == "B"

    # No priority/unblocks tags present anywhere in the fixture: default to
    # p3 and an empty unblocks list.
    assert a1.priority == "p3"
    assert a1.unblocks == []


def test_parses_questions_and_status():
    doc = backlog.ComplianceDoc.parse(COMPLIANCE_FIXTURE)
    assert doc.questions["Q1"].status == "ready"
    assert doc.questions["Q2"].status == "needs-kevin"
    assert doc.questions["Q3"].status == "blocked-deploy"

    q2 = doc.question_dict("Q2")
    assert q2["answer"] == "Some answer body for Q2. [KEVIN: confirm this figure]"
    assert q2["kevin_markers"] == ["[KEVIN: confirm this figure]"]
    assert q2["chars"] == len(q2["answer"])


# ---------------------------------------------------------------------
# In-memory mutation round trips
# ---------------------------------------------------------------------


def test_set_state_in_progress_then_blocked_round_trip():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "in-progress")
    assert "[state: in-progress]" in doc.lines[doc.items["A1"].line_no]
    assert doc.items["A1"].state == "in-progress"

    doc.set_state("A1", "blocked", reason="waiting on Kevin")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state: blocked: waiting on Kevin]" in line
    assert "[state: in-progress]" not in line
    assert doc.items["A1"].reason == "waiting on Kevin"

    doc.set_state("A1", "todo")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state:" not in line
    assert doc.items["A1"].state == "todo"
    assert doc.items["A1"].reason is None


def test_set_state_rejects_unknown_state():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.set_state("A1", "done")


def test_mark_done_clears_state_tag_and_appends_marker():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "blocked", reason="waiting")
    doc.set_done("A1", True, commit="deadbee")
    line = doc.lines[doc.items["A1"].line_no]
    assert line.startswith("- [x]")
    assert "[state:" not in line
    assert "(done" in line and "deadbee" in line
    assert doc.items["A1"].state == "todo"


def test_mark_done_then_reopen_round_trip():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_done("A1", True, commit="abc1234")
    doc.set_done("A1", False)
    line = doc.lines[doc.items["A1"].line_no]
    assert line.startswith("- [ ]")
    assert "(done" not in line
    assert doc.items["A1"].done_at is None
    assert doc.items["A1"].commit is None


def test_set_owner_round_trip_and_rejects_unknown_owner():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_owner("A1", "kevin")
    assert doc.items["A1"].owner == "kevin"
    assert "[owner: kevin]" in doc.lines[doc.items["A1"].line_no]
    doc.set_owner("A1", "codex")
    assert doc.items["A1"].owner == "codex"
    assert "[owner: codex]" in doc.lines[doc.items["A1"].line_no]
    with pytest.raises(backlog.BacklogError):
        doc.set_owner("A1", "nobody")


def test_parses_priority_and_unblocks_tags():
    doc = backlog.TodoDoc.parse(
        "## A. Section A heading\n\n"
        "- [ ] **A1. First item.** [owner: claude] [priority: p1] [unblocks: Q5, Q6] Some text.\n"
    )
    a1 = doc.items["A1"]
    assert a1.priority == "p1"
    assert a1.unblocks == ["Q5", "Q6"]
    assert a1.text == "Some text."


def test_priority_defaults_to_p3_when_tag_absent():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    assert doc.items["A1"].priority == "p3"


def test_set_priority_round_trip_and_rejects_unknown_priority():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_priority("A1", "p1")
    assert doc.items["A1"].priority == "p1"
    assert "[priority: p1]" in doc.lines[doc.items["A1"].line_no]

    # p3 is the default and is never rendered as an explicit tag.
    doc.set_priority("A1", "p3")
    assert "[priority:" not in doc.lines[doc.items["A1"].line_no]
    assert doc.items["A1"].priority == "p3"

    with pytest.raises(backlog.BacklogError):
        doc.set_priority("A1", "p9")


def test_set_unblocks_round_trip_and_empty_clears():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_unblocks("A1", ["Q5", "Q6"])
    assert doc.items["A1"].unblocks == ["Q5", "Q6"]
    assert "[unblocks: Q5, Q6]" in doc.lines[doc.items["A1"].line_no]

    doc.set_unblocks("A1", [])
    assert doc.items["A1"].unblocks == []
    assert "[unblocks:" not in doc.lines[doc.items["A1"].line_no]


def test_priority_and_unblocks_round_trip_preserves_other_tags():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "in-progress")
    doc.set_priority("A1", "p1")
    doc.set_unblocks("A1", ["Q5", "Q6"])
    line = doc.lines[doc.items["A1"].line_no]
    assert "[owner: claude]" in line
    assert "[priority: p1]" in line
    assert "[state: in-progress]" in line
    assert "[unblocks: Q5, Q6]" in line

    reparsed = backlog.TodoDoc.parse(doc.text())
    a1 = reparsed.items["A1"]
    assert a1.owner == "claude"
    assert a1.priority == "p1"
    assert a1.state == "in-progress"
    assert a1.unblocks == ["Q5", "Q6"]


def test_unblocked_by_index_and_questions_reverse_index():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_unblocks("A1", ["Q5", "Q6"])
    doc.set_unblocks("A3", ["Q5"])
    index = backlog.unblocked_by_index(doc.items.values())
    assert index["Q5"] == ["A1", "A3"]
    assert index["Q6"] == ["A1"]
    assert "Q1" not in index


def test_public_set_priority(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_priority("A1", "p1", actor="claude", todo_path=todo_path, repo_root=repo_root)
    assert item["priority"] == "p1"
    assert committed is True
    assert "backlog: A1 priority set to p1 by claude" in mock_git.call_args_list[1].args[0]


def test_public_set_unblocks(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_unblocks(
        "A1", ["Q5", "Q6"], actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert item["unblocks"] == ["Q5", "Q6"]
    assert committed is True
    assert "backlog: A1 unblocks set to Q5, Q6 by claude" in mock_git.call_args_list[1].args[0]

    mock_git.reset_mock()
    item, committed = backlog.set_unblocks("A1", [], actor="claude", todo_path=todo_path, repo_root=repo_root)
    assert item["unblocks"] == []
    assert "backlog: A1 unblocks set to none by claude" in mock_git.call_args_list[1].args[0]


def test_load_questions_include_unblocked_by(paths, mock_git):
    todo_path, compliance_path = paths
    repo_root = todo_path.parent
    backlog.set_unblocks("A1", ["Q1", "Q2"], actor="claude", todo_path=todo_path, repo_root=repo_root)
    snapshot = backlog.load(todo_path=todo_path, compliance_path=compliance_path)
    q1 = next(q for q in snapshot.questions() if q["q"] == "Q1")
    q3 = next(q for q in snapshot.questions() if q["q"] == "Q3")
    assert q1["unblocked_by"] == ["A1"]
    assert q3["unblocked_by"] == []


def test_add_note_appends_after_existing_notes_and_keeps_other_items_intact():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.add_note("A3", "a brand new note", "claude")
    assert len(doc.items["A3"].notes) == 2
    assert doc.items["A3"].notes[-1].text == "a brand new note"
    assert doc.items["A3"].notes[-1].actor == "claude"
    # B1 must still parse correctly after the line-count shift.
    assert doc.items["B1"].text == "Something about B1."


def test_add_note_by_codex_round_trips_through_reparse():
    # NOTE_RE must recognise "codex" as an actor, not just kevin/claude —
    # otherwise a codex-authored note is written to disk but silently
    # dropped the next time the file is parsed back.
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.add_note("A1", "a codex note", "codex")
    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].notes[-1].actor == "codex"
    assert reparsed.items["A1"].notes[-1].text == "a codex note"


def test_add_note_on_item_with_no_notes_yet():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.add_note("A1", "first note ever", "kevin")
    assert len(doc.items["A1"].notes) == 1
    assert doc.items["A1"].notes[0].text == "first note ever"


def test_unknown_item_id_raises():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.item("Z9")


def test_set_question_status_round_trip_and_rejects_unknown_status():
    doc = backlog.ComplianceDoc.parse(COMPLIANCE_FIXTURE)
    doc.set_status("Q1", "submitted")
    assert doc.questions["Q1"].status == "submitted"
    assert doc.lines[doc.questions["Q1"].status_line_no] == "Status: submitted"
    with pytest.raises(backlog.BacklogError):
        doc.set_status("Q1", "not-a-status")


def test_unknown_question_id_raises():
    doc = backlog.ComplianceDoc.parse(COMPLIANCE_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.question("Q99")


# ---------------------------------------------------------------------
# Idempotent write-back (save then re-parse gives the same structure)
# ---------------------------------------------------------------------


def test_save_then_reload_is_idempotent(paths):
    todo_path, _ = paths
    doc = backlog.TodoDoc.load(todo_path)
    doc.set_state("A1", "in-progress")
    doc.add_note("A1", "note text", "claude")
    doc.save(todo_path)

    first_text = todo_path.read_text(encoding="utf-8")
    reloaded = backlog.TodoDoc.load(todo_path)
    reloaded.save(todo_path)
    second_text = todo_path.read_text(encoding="utf-8")
    assert first_text == second_text
    assert reloaded.items["A1"].state == "in-progress"
    assert reloaded.items["A1"].notes[-1].text == "note text"


# ---------------------------------------------------------------------
# Public mutators: file writes + git commit/push args
# ---------------------------------------------------------------------


def test_public_set_done_writes_file_and_calls_git_with_expected_args(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent

    item, committed = backlog.set_done(
        "A1", True, commit="cafe123", actor="claude", todo_path=todo_path, repo_root=repo_root
    )

    assert committed is True
    assert item["state"] == "done"
    assert item["commit"] == "cafe123"
    saved = todo_path.read_text(encoding="utf-8")
    assert "(done" in saved and "cafe123" in saved

    add_call = mock_git.call_args_list[0]
    assert add_call.args[0][:2] == ["git", "add"]
    assert "TODO.md" in add_call.args[0]
    assert add_call.kwargs["cwd"] == repo_root

    commit_call = mock_git.call_args_list[1]
    assert commit_call.args[0][0:2] == ["git", "commit"]
    assert "--author" in commit_call.args[0]
    assert "Sorted Ops <ops@auriqltd.co.uk>" in commit_call.args[0]
    assert "backlog: A1 done by claude" in commit_call.args[0]

    push_call = mock_git.call_args_list[2]
    assert push_call.args[0] == ["git", "push", "origin", "HEAD"]


def test_public_set_done_false_reports_reopened_in_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_done("A2", False, actor="kevin", todo_path=todo_path, repo_root=repo_root)
    commit_call = mock_git.call_args_list[1]
    assert "backlog: A2 reopened by kevin" in commit_call.args[0]


def test_public_set_state_start_and_block(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent

    item, committed = backlog.set_state(
        "B1", "in-progress", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert item["state"] == "in-progress"
    assert committed is True
    assert "backlog: B1 started by claude" in mock_git.call_args_list[1].args[0]

    mock_git.reset_mock()
    item, committed = backlog.set_state(
        "B1", "blocked", reason="waiting on Finexer", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert item["state"] == "blocked"
    assert item["reason"] == "waiting on Finexer"
    assert "backlog: B1 blocked by claude" in mock_git.call_args_list[1].args[0]


def test_public_set_owner(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_owner("A1", "kevin", actor="claude", todo_path=todo_path, repo_root=repo_root)
    assert item["owner"] == "kevin"
    assert committed is True
    assert "backlog: A1 owner set to kevin by claude" in mock_git.call_args_list[1].args[0]


def test_public_add_note(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.add_note(
        "A3", "Board write-side smoke test", actor="kevin", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["notes"][-1]["text"] == "Board write-side smoke test"
    assert item["notes"][-1]["actor"] == "kevin"
    assert "backlog: A3 note added by kevin" in mock_git.call_args_list[1].args[0]


def test_public_set_question_status(paths, mock_git):
    _, compliance_path = paths
    repo_root = compliance_path.parent
    result, committed = backlog.set_question_status(
        "Q2", "ready", actor="kevin", compliance_path=compliance_path, repo_root=repo_root
    )
    assert result["status"] == "ready"
    assert committed is True
    saved = compliance_path.read_text(encoding="utf-8")
    assert "Status: ready" in saved
    assert "backlog: Q2 status set to ready by kevin" in mock_git.call_args_list[1].args[0]


def test_public_mutator_still_writes_file_when_git_commit_fails(paths, monkeypatch):
    todo_path, _ = paths
    repo_root = todo_path.parent

    def _raise(*args, **kwargs):
        raise RuntimeError("git not available")

    monkeypatch.setattr(backlog.subprocess, "run", _raise)

    item, committed = backlog.set_done(
        "A1", True, commit="abc0001", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is False
    saved = todo_path.read_text(encoding="utf-8")
    assert "abc0001" in saved  # the file write must never be lost


def test_public_mutator_reports_committed_false_when_push_fails(paths, monkeypatch):
    todo_path, _ = paths
    repo_root = todo_path.parent

    calls = {"n": 0}

    def _run(cmd, **kwargs):
        calls["n"] += 1
        if cmd[:2] == ["git", "push"]:
            raise RuntimeError("network unreachable")
        return MagicMock(returncode=0)

    monkeypatch.setattr(backlog.subprocess, "run", _run)

    item, committed = backlog.set_done(
        "A1", True, actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is False
    saved = backlog.TodoDoc.load(todo_path)
    assert saved.items["A1"].done is True


# ---------------------------------------------------------------------
# load() / Backlog snapshot
# ---------------------------------------------------------------------


def test_load_returns_sorted_items_and_questions(paths):
    todo_path, compliance_path = paths
    snapshot = backlog.load(todo_path=todo_path, compliance_path=compliance_path)
    items = snapshot.items()
    assert [i["id"] for i in items] == ["A1", "A2", "A3", "B1"]
    questions = snapshot.questions()
    assert [q["q"] for q in questions] == ["Q1", "Q2", "Q3"]


# ---------------------------------------------------------------------
# File lock: concurrent-looking calls still produce a consistent file
# ---------------------------------------------------------------------


def test_lock_file_is_created_and_released(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_done("A1", True, actor="claude", todo_path=todo_path, repo_root=repo_root)
    lock_path = repo_root / ".backlog.lock"
    assert lock_path.exists()
    # A second call must not deadlock (lock was released after the first).
    item, _ = backlog.set_owner("A1", "kevin", actor="claude", todo_path=todo_path, repo_root=repo_root)
    assert item["owner"] == "kevin"


def test_sequential_writes_are_all_applied(paths, mock_git):
    """Guards against a mutator accidentally reloading a stale snapshot:
    three sequential public calls against the same file must all show up,
    since each call re-loads from disk under the lock rather than reusing
    an in-memory copy."""
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_state("A1", "in-progress", actor="claude", todo_path=todo_path, repo_root=repo_root)
    backlog.add_note("A1", "note one", actor="claude", todo_path=todo_path, repo_root=repo_root)
    item, _ = backlog.set_owner("A1", "kevin", actor="kevin", todo_path=todo_path, repo_root=repo_root)
    assert item["state"] == "in-progress"
    assert item["owner"] == "kevin"
    assert item["notes"][-1]["text"] == "note one"


# ---------------------------------------------------------------------
# Fixed repo root (BACKLOG_ROOT) — a session running from a git worktree
# must still resolve to the shared tree, not wherever backlog.py's own
# checkout happens to sit.
# ---------------------------------------------------------------------


def test_repo_root_defaults_to_shared_tree_path(monkeypatch):
    monkeypatch.delenv("BACKLOG_ROOT", raising=False)
    assert backlog._repo_root() == Path("/root/ai-wealth-dashboard")
    assert backlog._todo_path() == Path("/root/ai-wealth-dashboard/TODO.md")


def test_repo_root_honours_backlog_root_env_override(monkeypatch, tmp_path):
    monkeypatch.setenv("BACKLOG_ROOT", str(tmp_path))
    assert backlog._repo_root() == tmp_path
    assert backlog._todo_path() == tmp_path / "TODO.md"
    assert backlog._compliance_path() == tmp_path / "docs" / "compliance" / "finexer-agent-controls-2026-09.md"


def test_repo_root_is_resolved_fresh_not_cached_at_import(monkeypatch, tmp_path):
    """Regression guard: _repo_root() must be a function called at call time,
    not a module-level constant baked in at import — otherwise a worktree's
    own copy of this file would resolve to itself instead of the shared
    tree, exactly the bug this fix closes."""
    monkeypatch.delenv("BACKLOG_ROOT", raising=False)
    before = backlog._repo_root()
    monkeypatch.setenv("BACKLOG_ROOT", str(tmp_path))
    after = backlog._repo_root()
    assert before != after
    assert after == tmp_path


# ---------------------------------------------------------------------
# review state (branch-per-item workflow)
# ---------------------------------------------------------------------


def test_state_review_round_trip_parses_and_renders_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state: review: feature-A1-first-item]" in line
    assert doc.items["A1"].state == "review"
    assert doc.items["A1"].branch == "feature-A1-first-item"

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].state == "review"
    assert reparsed.items["A1"].branch == "feature-A1-first-item"
    assert reparsed.items["A1"].to_dict()["branch"] == "feature-A1-first-item"


def test_state_review_without_branch_raises():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.set_state("A1", "review")


def test_state_review_then_blocked_clears_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "blocked", reason="integration conflict with main; rebase the branch")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state: blocked:" in line
    assert "review" not in line
    assert doc.items["A1"].branch is None


def test_mark_done_from_review_clears_state_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_done("A1", True, commit="deadbee")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state:" not in line
    assert doc.items["A1"].state == "todo"
    assert doc.items["A1"].to_dict()["branch"] is None


# ---------------------------------------------------------------------
# rejected state (H25 — a reviewer's rejection has to land on the board
# immediately, since a `review` item is otherwise treated as consent to
# merge by any integrate pass, including one from a concurrent session).
# ---------------------------------------------------------------------


def test_set_state_rejected_requires_a_reason():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    with pytest.raises(backlog.BacklogError):
        doc.set_state("A1", "rejected")


def test_reject_sets_state_reason_and_retains_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "rejected", reason="broke the safe-to-spend guard")

    item = doc.items["A1"]
    assert item.state == "rejected"
    assert item.reason == "broke the safe-to-spend guard"
    # The branch is retained from the prior review state, not cleared.
    assert item.branch == "feature-A1-first-item"

    line = doc.lines[item.line_no]
    assert "[state: rejected: broke the safe-to-spend guard]" in line
    assert "[branch: feature-A1-first-item]" in line
    assert item.to_dict()["reason"] == "broke the safe-to-spend guard"
    assert item.to_dict()["branch"] == "feature-A1-first-item"
    assert item.to_dict()["state"] == "rejected"


def test_reject_can_take_an_explicit_branch_override():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    # A1 has no prior branch (never sent to review) — reject can still be
    # given one explicitly.
    doc.set_state("A1", "rejected", reason="wrong approach", branch="feature-A1-alt")
    assert doc.items["A1"].branch == "feature-A1-alt"


def test_rejected_item_round_trips_through_parse_and_serialise_unchanged():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "rejected", reason="broke the safe-to-spend guard")
    first_text = doc.text()

    reparsed = backlog.TodoDoc.parse(first_text)
    a1 = reparsed.items["A1"]
    assert a1.state == "rejected"
    assert a1.reason == "broke the safe-to-spend guard"
    assert a1.branch == "feature-A1-first-item"

    # Re-serialising the reparsed doc must produce byte-identical output —
    # the same idempotency guarantee every other state already has.
    assert reparsed.text() == first_text


def test_rejected_then_moved_to_todo_clears_reason_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "rejected", reason="broke the safe-to-spend guard")
    doc.set_state("A1", "todo")

    item = doc.items["A1"]
    assert item.state == "todo"
    assert item.reason is None
    assert item.branch is None
    line = doc.lines[item.line_no]
    assert "[state:" not in line
    assert "[branch:" not in line


def test_rejected_then_started_clears_reason_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "rejected", reason="broke the safe-to-spend guard")
    doc.set_state("A1", "in-progress")

    item = doc.items["A1"]
    assert item.state == "in-progress"
    assert item.reason is None
    assert item.branch is None
    line = doc.lines[item.line_no]
    assert "[state: in-progress]" in line
    assert "[branch:" not in line


def test_mark_done_from_rejected_clears_state_reason_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "rejected", reason="broke the safe-to-spend guard")
    doc.set_done("A1", True, commit="deadbee")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state:" not in line
    assert "[branch:" not in line
    assert doc.items["A1"].state == "todo"
    assert doc.items["A1"].to_dict()["branch"] is None
    assert doc.items["A1"].to_dict()["reason"] is None


def test_public_set_rejected_writes_file_and_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    mock_git.reset_mock()

    item, committed = backlog.set_rejected(
        "A1", "broke the safe-to-spend guard", actor="kevin", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["state"] == "rejected"
    assert item["reason"] == "broke the safe-to-spend guard"
    assert item["branch"] == "feature-A1-first-item"
    commit_call = mock_git.call_args_list[1]
    assert "backlog: A1 rejected (broke the safe-to-spend guard) by kevin" in commit_call.args[0]


def test_public_set_state_rejected_without_reason_raises(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    with pytest.raises(backlog.BacklogError):
        backlog.set_state("A1", "rejected", actor="claude", todo_path=todo_path, repo_root=repo_root)


def test_list_output_shows_rejected_branch(paths, mock_git):
    todo_path, compliance_path = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    backlog.set_rejected("A1", "wrong approach", actor="kevin", todo_path=todo_path, repo_root=repo_root)
    snapshot = backlog.load(todo_path=todo_path, compliance_path=compliance_path)
    a1 = next(i for i in snapshot.items() if i["id"] == "A1")
    assert a1["state"] == "rejected"
    assert a1["branch"] == "feature-A1-first-item"
    assert a1["reason"] == "wrong approach"


def test_cli_reject_and_state_display(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    other_cwd = tmp_path / "elsewhere"
    other_cwd.mkdir()

    review_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "review", "A1", "--branch", "feature-A1-first-item"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert review_result.returncode == 0, review_result.stderr

    reject_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "reject", "A1", "found a defect in review"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert reject_result.returncode == 0, reject_result.stderr

    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: rejected: found a defect in review]" in saved
    assert "[branch: feature-A1-first-item]" in saved

    list_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "list"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert list_result.returncode == 0, list_result.stderr
    assert "rejected:feature-A1-first-item" in list_result.stdout

    # `start` moves it back out again, clearing the rejection.
    start_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "start", "A1"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert start_result.returncode == 0, start_result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: in-progress]" in saved
    assert "rejected" not in saved
    assert "[branch:" not in saved


def test_cli_reject_without_reason_errors(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "reject", "A1"],
        cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
    )
    # argparse itself rejects the missing positional "reason" arg.
    assert result.returncode != 0


def test_public_set_review_writes_file_and_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_review(
        "A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["state"] == "review"
    assert item["branch"] == "feature-A1-first-item"
    commit_call = mock_git.call_args_list[1]
    assert "backlog: A1 sent to review (feature-A1-first-item) by claude" in commit_call.args[0]


def test_list_output_shows_review_branch(paths, mock_git, capsys):
    todo_path, compliance_path = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    snapshot = backlog.load(todo_path=todo_path, compliance_path=compliance_path)
    a1 = next(i for i in snapshot.items() if i["id"] == "A1")
    assert a1["state"] == "review"
    assert a1["branch"] == "feature-A1-first-item"


# ---------------------------------------------------------------------
# add_item (allocate the next id in a section)
# ---------------------------------------------------------------------


def test_add_item_with_codex_owner_round_trips():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    item = doc.add_item("A", "A codex-owned item.", owner="codex")
    assert item.owner == "codex"
    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items[item.item_id].owner == "codex"


def test_add_item_allocates_next_id_and_appends_to_section():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    item = doc.add_item("A", "A brand new item.", owner="claude")
    assert item.item_id == "A4"
    assert item.section == "A"
    assert item.owner == "claude"
    assert item.state == "todo"
    assert item.done is False

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert set(reparsed.items) == {"A1", "A2", "A3", "A4", "B1"}
    assert reparsed.items["A4"].title == "A brand new item."
    # B1 (a different, later section) must still parse correctly.
    assert reparsed.items["B1"].text == "Something about B1."
    # A4 must land inside section A, before the "## B." heading.
    b_heading_line = reparsed.section_headings["B"][0]
    assert reparsed.items["A4"].line_no < b_heading_line


def test_add_item_starts_at_one_for_empty_section():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    item = doc.add_item("B", "Second item in B.")
    assert item.item_id == "B2"


def test_add_item_unknown_section_raises():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.add_item("Z", "Nowhere to put this.")


def test_add_item_invalid_owner_raises():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.add_item("A", "Bad owner.", owner="nobody")


def test_add_item_last_section_appends_at_end_of_file():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    item = doc.add_item("B", "Tail of file.")
    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items[item.item_id].title == "Tail of file."


def test_add_item_title_with_parens_equals_and_asterisk_round_trips():
    """Regression test for the 2026-09-08 H13 add failure: a title with
    parentheses, an `=` sign and a lone `*` (e.g. an env var wildcard like
    `NEXT_PUBLIC_*`) used to make the whole line fail ITEM_RE after
    add_item's internal reparse, so the newly written item vanished and
    add_item raised "<id> is not a known backlog item." even though the
    line had just been written to disk."""
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    title = (
        "build-mobile.sh must exclude frontend/.env.local from its rsync "
        "(and unset UAT-only NEXT_PUBLIC_* flags such as TRUELAYER_PICKER "
        "when MOBILE_TARGET=prod), so a production mobile build made on the "
        "VPS never inherits the UAT-only .env.local used by the "
        "wealth-frontend build."
    )
    item = doc.add_item("A", title, owner="claude")
    assert item.title == title

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert item.item_id in reparsed.items
    assert reparsed.items[item.item_id].title == title
    # Other items must still parse correctly after the insert.
    assert reparsed.items["B1"].text == "Something about B1."


def test_add_item_rejects_title_with_literal_double_asterisk():
    """A literal '**' inside a title would close the markdown bold id
    marker early and truncate the title, silently corrupting the item
    instead of failing loudly. add_item must refuse this up front rather
    than write a corrupted line."""
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError, match=r"\*\*"):
        doc.add_item("A", "Title with a literal ** pair inside it.")
    # Nothing was written: the fixture's next A id (A4) must not exist.
    assert "A4" not in backlog.TodoDoc.parse(doc.text()).items


def test_add_item_failure_message_includes_raw_written_line(monkeypatch):
    """Defensive check: if a rendered line ever fails to parse back for any
    other reason (a future regression in ITEM_RE or _render_item_line),
    add_item must say so and show the exact line it wrote, not just repeat
    the generic 'is not a known backlog item' message."""
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)

    real_render = backlog._render_item_line

    def _broken_render(item):
        if item.item_id == "A4":
            return "this line does not match ITEM_RE at all"
        return real_render(item)

    monkeypatch.setattr(backlog, "_render_item_line", _broken_render)
    with pytest.raises(backlog.BacklogError) as exc_info:
        doc.add_item("A", "A perfectly normal title.")
    message = str(exc_info.value)
    assert "did not parse back" in message
    assert "this line does not match ITEM_RE at all" in message


def test_public_add_item_writes_file_and_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.add_item(
        "A", "A brand new item.", owner="claude", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["id"] == "A4"
    saved = todo_path.read_text(encoding="utf-8")
    assert "**A4. A brand new item.**" in saved
    assert "[owner: claude]" in saved.splitlines()[-1] or any(
        "A4" in line and "[owner: claude]" in line for line in saved.splitlines()
    )
    commit_call = mock_git.call_args_list[1]
    assert "backlog: A4 added by claude" in commit_call.args[0]


# ---------------------------------------------------------------------
# Real board regression guard: every checkbox line in the real TODO.md
# (sections A-H) must parse into an item. Read-only via BACKLOG_ROOT /
# load(todo_path=...) so this never touches the real board.
# ---------------------------------------------------------------------


def test_real_todo_board_every_checkbox_line_parses_into_an_item():
    # The shared board, not this worktree's copy (which may be behind) —
    # read-only via load(todo_path=...), never written to.
    real_todo_path = Path("/root/ai-wealth-dashboard/TODO.md")
    if not real_todo_path.exists():
        pytest.skip(f"shared board not present at {real_todo_path} in this environment")

    lines = real_todo_path.read_text(encoding="utf-8").split("\n")
    section_heading_re = backlog.SECTION_HEADING_RE
    checkbox_re = re.compile(r"^- \[[ xX]\]")

    current_section = None
    checkbox_line_count = 0
    for line in lines:
        heading = section_heading_re.match(line)
        if heading:
            current_section = heading.group(1)
            continue
        if current_section in set("ABCDEFGH") and checkbox_re.match(line):
            checkbox_line_count += 1

    snapshot = backlog.load(todo_path=real_todo_path)
    item_count = len(snapshot.todo.items)

    assert checkbox_line_count > 0, "sanity check: the real board should have items"
    assert item_count == checkbox_line_count, (
        f"{checkbox_line_count} checkbox lines in sections A-H but only "
        f"{item_count} parsed into items; some line failed ITEM_RE "
        "(check for punctuation in titles that defeats the parser)"
    )


# ---------------------------------------------------------------------
# End-to-end CLI smoke test: proves BACKLOG_ROOT makes scripts/backlog.py
# edit the target tree regardless of the caller's cwd — the exact scenario
# a session running from /root/worktrees/<branch> needs.
# ---------------------------------------------------------------------


def test_cli_add_and_review_edit_backlog_root_regardless_of_cwd(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    other_cwd = tmp_path / "elsewhere"
    other_cwd.mkdir()

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    add_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "add", "A", "CLI added item", "--owner", "claude"],
        cwd=other_cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert add_result.returncode == 0, add_result.stderr
    new_id = add_result.stdout.strip().splitlines()[0]
    assert new_id == "A4"

    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "**A4. CLI added item**" in saved
    # Confirms nothing was written next to the CLI script's own checkout.
    assert not (REPO_ROOT / "TODO.md.tmp0").exists()

    review_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "review", new_id, "--branch", "feature-A4-cli-added-item"],
        cwd=other_cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert review_result.returncode == 0, review_result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: review: feature-A4-cli-added-item]" in saved

    list_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "list"],
        cwd=other_cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert list_result.returncode == 0, list_result.stderr
    assert "review:feature-A4-cli-added-item" in list_result.stdout


# ---------------------------------------------------------------------
# `backlog.py show` — the read-only, machine-readable single-item mode
# added for item H21 (scripts/session.sh used to scrape `list`'s
# human-readable table with awk to decide whether an id was free, which
# is how `start` ended up silently re-attaching to a *done* item).
# ---------------------------------------------------------------------

SHOW_FIXTURE = """# Backlog fixture for `show` tests

## H. Section H heading

- [ ] **H1. Todo item, ready to start.** [owner: claude] Nothing special.
- [ ] **H2. In progress item.** [owner: claude] [state: in-progress] Someone already has it.
- [ ] **H3. Blocked item with a reason.** [owner: claude] [state: blocked: waiting on Kevin] Needs Kevin.
- [ ] **H4. Blocked item, no reason given.** [owner: claude] [state: blocked] Needs something.
- [ ] **H5. Review item.** [owner: claude] [state: review: feature-H5-thing] Sent to review.
- [x] **H6. Done item.** [owner: claude] Already done. (done 2026-09-01, abc1234)
"""


def _make_board_root(tmp_path: Path, todo_text: str) -> Path:
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(todo_text, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    return board_root


def _cli_show(board_root: Path, item_id: str) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    return subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "show", item_id],
        cwd=board_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_cli_show_todo_item(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H1")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["id"] == "H1"
    assert data["state"] == "todo"
    assert data["reason"] is None
    assert data["branch"] is None


def test_cli_show_in_progress_item(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H2")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["state"] == "in-progress"


def test_cli_show_blocked_item_with_reason(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H3")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["state"] == "blocked"
    assert data["reason"] == "waiting on Kevin"


def test_cli_show_blocked_item_without_reason(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H4")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["state"] == "blocked"
    assert data["reason"] is None


def test_cli_show_review_item_includes_branch(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H5")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["state"] == "review"
    assert data["branch"] == "feature-H5-thing"


def test_cli_show_done_item(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H6")
    assert result.returncode == 0, result.stderr
    data = json.loads(result.stdout)
    assert data["state"] == "done"
    assert data["done_at"] == "2026-09-01"


def test_cli_show_unknown_item_errors(tmp_path):
    board_root = _make_board_root(tmp_path, SHOW_FIXTURE)
    result = _cli_show(board_root, "H999")
    assert result.returncode == 1
    assert "not a known backlog item" in result.stderr
