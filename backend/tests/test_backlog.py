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


# ---------------------------------------------------------------------
# H27 — block/reject reasons and notes are sanitised to a single line, so
# a caller passing raw multi-line command output (e.g.
# scripts/integrate.py) can never corrupt the item's one-line format.
# ---------------------------------------------------------------------


def test_one_line_reason_first_line_whitespace_collapsed_brackets_stripped():
    text = "  frontend build   failed: [next] error\nsecond line\nthird line  "
    assert backlog.one_line_reason(text) == "frontend build failed: next error"


def test_one_line_reason_skips_leading_blank_lines():
    text = "\n\n   \nactual first line\nsecond line"
    assert backlog.one_line_reason(text) == "actual first line"


def test_one_line_reason_caps_at_200_chars_with_ellipsis():
    text = "y" * 2000
    result = backlog.one_line_reason(text)
    assert len(result) == 200
    assert result.endswith("...")
    assert result[:197] == "y" * 197


def test_one_line_reason_empty_or_none_input():
    assert backlog.one_line_reason(None) == ""
    assert backlog.one_line_reason("") == ""
    assert backlog.one_line_reason("   \n   \n") == ""


def test_set_state_blocked_sanitises_multiline_reason_with_brackets():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    raw_reason = "frontend build failed:\n[next] error TS2345: something [broke]\nmore output\nyet more"
    doc.set_state("A1", "blocked", reason=raw_reason)

    line = doc.lines[doc.items["A1"].line_no]
    assert "\n" not in line
    assert "[state: blocked: frontend build failed:]" in line
    assert doc.items["A1"].reason == "frontend build failed:"

    # the item line still round-trips through the service's own parser.
    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].state == "blocked"
    assert reparsed.items["A1"].reason == "frontend build failed:"
    assert "\n" not in reparsed.lines[reparsed.items["A1"].line_no]


def test_set_state_blocked_caps_a_very_long_reason_at_200_chars():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "blocked", reason="z" * 2000)

    assert len(doc.items["A1"].reason) == 200
    assert doc.items["A1"].reason.endswith("...")

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].reason == doc.items["A1"].reason


def test_set_state_rejected_sanitises_multiline_reason():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    raw_reason = "reviewer found a bug:\nsee the diff at line 42\n[details omitted]"
    doc.set_state("A1", "rejected", reason=raw_reason)

    line = doc.lines[doc.items["A1"].line_no]
    assert "\n" not in line
    assert doc.items["A1"].reason == "reviewer found a bug:"

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].reason == "reviewer found a bug:"


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


def test_add_note_collapses_embedded_newlines_to_slash_separated_single_line():
    # A note is one `TodoDoc.lines` entry (NOTE_RE only ever matches a
    # whole list line); a raw newline embedded in note text (e.g. a chunk
    # of command output passed to add_note) must not end up creating
    # unparsed stray lines the next time the file is loaded (H27).
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.add_note("A1", "line one\nline two\n\nline three  ", "claude")

    assert len(doc.items["A1"].notes) == 1
    note = doc.items["A1"].notes[0]
    assert note.text == "line one / line two / line three"
    assert "\n" not in doc.lines[note.line_no]

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert len(reparsed.items["A1"].notes) == 1
    assert reparsed.items["A1"].notes[0].text == "line one / line two / line three"
    # nothing else in the fixture (B1 etc.) was corrupted by the shift.
    assert reparsed.items["B1"].text == "Something about B1."


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


def test_public_set_state_blocked_sanitises_raw_multiline_reason(paths, mock_git):
    # Defence in depth for H27: even a caller that skips its own
    # sanitisation (e.g. a future scripts/integrate.py regression) can
    # never write raw multi-line command output through the public
    # backlog.set_state() entry point — TodoDoc.set_state sanitises
    # independently, and this is what lands on disk.
    todo_path, _ = paths
    repo_root = todo_path.parent
    raw_reason = "npm run build failed:\nModule not found: Error: Can't resolve './Foo'\nBuild failed with 1 error."

    item, committed = backlog.set_state(
        "B1", "blocked", reason=raw_reason, actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert item["state"] == "blocked"
    assert item["reason"] == "npm run build failed:"
    assert committed is True

    on_disk_line = next(
        line for line in todo_path.read_text(encoding="utf-8").splitlines() if line.startswith("- [ ] **B1.")
    )
    assert "npm run build failed:" in on_disk_line
    assert "Module not found" not in on_disk_line
    assert "\n" not in on_disk_line


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


# ---------------------------------------------------------------------
# uat state (H31) — a design round lands here instead of `done` so Kevin
# reviews it on a real, rebuilt UAT page. Mirrors the shape H25 established
# for `rejected`: retains the branch in a separate [branch: ...] tag,
# never a merge candidate, cleared when the item moves anywhere else.
# ---------------------------------------------------------------------


def test_normalise_preview_link_rejects_empty():
    with pytest.raises(backlog.BacklogError):
        backlog.normalise_preview_link("")
    with pytest.raises(backlog.BacklogError):
        backlog.normalise_preview_link(None)
    with pytest.raises(backlog.BacklogError):
        backlog.normalise_preview_link("   ")


def test_normalise_preview_link_normalises_loopback_hosts():
    assert (
        backlog.normalise_preview_link("http://127.0.0.1:3030/design/plan-picker")
        == "https://uat.wealth.auriqltd.co.uk/design/plan-picker"
    )
    assert (
        backlog.normalise_preview_link("http://localhost:3030/design")
        == "https://uat.wealth.auriqltd.co.uk/design"
    )
    # Scheme-less input is treated as an absolute URL against https, not a
    # path relative to something else.
    assert backlog.normalise_preview_link("127.0.0.1/design") == "https://uat.wealth.auriqltd.co.uk/design"


def test_normalise_preview_link_accepts_the_public_host_and_forces_https():
    assert (
        backlog.normalise_preview_link("http://uat.wealth.auriqltd.co.uk/design/plan-picker")
        == "https://uat.wealth.auriqltd.co.uk/design/plan-picker"
    )
    assert (
        backlog.normalise_preview_link("https://uat.wealth.auriqltd.co.uk/design")
        == "https://uat.wealth.auriqltd.co.uk/design"
    )


def test_normalise_preview_link_rejects_any_other_host():
    with pytest.raises(backlog.BacklogError):
        backlog.normalise_preview_link("https://evil.example.com/design")
    with pytest.raises(backlog.BacklogError):
        backlog.normalise_preview_link("https://wealth.auriqltd.co.uk/design")  # close, but not the UAT subdomain


def test_normalise_preview_link_rejects_not_a_url():
    with pytest.raises(backlog.BacklogError):
        backlog.normalise_preview_link("not a url at all, just text")


def test_state_uat_requires_a_link():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.set_state("A1", "uat")


def test_state_uat_round_trip_parses_and_renders_link_and_retains_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "uat", link="http://127.0.0.1:3030/design")

    item = doc.items["A1"]
    line = doc.lines[item.line_no]
    assert "[state: uat: https://uat.wealth.auriqltd.co.uk/design]" in line
    assert "[branch: feature-A1-first-item]" in line
    assert item.state == "uat"
    assert item.link == "https://uat.wealth.auriqltd.co.uk/design"
    assert item.branch == "feature-A1-first-item"
    assert item.to_dict()["link"] == "https://uat.wealth.auriqltd.co.uk/design"
    assert item.to_dict()["branch"] == "feature-A1-first-item"
    assert item.to_dict()["state"] == "uat"

    # A loopback link must never actually reach disk, only its normalised
    # form — this is the core H31 safety property.
    assert "127.0.0.1" not in line
    assert "127.0.0.1" not in doc.text()

    first_text = doc.text()
    reparsed = backlog.TodoDoc.parse(first_text)
    a1 = reparsed.items["A1"]
    assert a1.state == "uat"
    assert a1.link == "https://uat.wealth.auriqltd.co.uk/design"
    assert a1.branch == "feature-A1-first-item"
    # Idempotent re-serialisation, same guarantee every other state has.
    assert reparsed.text() == first_text


def test_state_uat_without_prior_review_can_take_an_explicit_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "uat", link="https://uat.wealth.auriqltd.co.uk/design", branch="feature-A1-alt")
    assert doc.items["A1"].branch == "feature-A1-alt"


def test_uat_then_moved_to_todo_clears_link_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "uat", link="https://uat.wealth.auriqltd.co.uk/design")
    doc.set_state("A1", "todo")

    item = doc.items["A1"]
    assert item.state == "todo"
    assert item.link is None
    assert item.branch is None
    line = doc.lines[item.line_no]
    assert "[state:" not in line
    assert "[branch:" not in line


def test_mark_done_from_uat_clears_state_link_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    doc.set_state("A1", "uat", link="https://uat.wealth.auriqltd.co.uk/design")
    doc.set_done("A1", True, commit="deadbee")

    line = doc.lines[doc.items["A1"].line_no]
    assert "[state:" not in line
    assert "[branch:" not in line
    assert doc.items["A1"].state == "todo"
    d = doc.items["A1"].to_dict()
    assert d["link"] is None
    assert d["branch"] is None


def test_uat_review_flag_round_trips_while_in_review_and_is_cleared_on_uat():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item", uat_review=True)
    line = doc.lines[doc.items["A1"].line_no]
    assert "[uat-review]" in line
    assert doc.items["A1"].uat_review is True
    assert doc.items["A1"].to_dict()["uat_review"] is True

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].uat_review is True
    assert reparsed.text() == doc.text()

    # Landing in uat consumes the flag; it is meaningless once merged.
    doc.set_state("A1", "uat", link="https://uat.wealth.auriqltd.co.uk/design")
    assert doc.items["A1"].uat_review is False
    assert doc.items["A1"].to_dict()["uat_review"] is False
    assert "[uat-review]" not in doc.lines[doc.items["A1"].line_no]


def test_review_without_uat_review_flag_defaults_false():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="feature-A1-first-item")
    assert doc.items["A1"].uat_review is False
    assert "[uat-review]" not in doc.lines[doc.items["A1"].line_no]


def test_set_approved_records_choice_moves_to_in_progress_owner_unchanged():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    # A3 is owned by claude in the fixture.
    doc.set_state("A3", "review", branch="feature-A3-third-item")
    doc.set_state("A3", "uat", link="https://uat.wealth.auriqltd.co.uk/design")

    item = doc.item("A3")
    assert item.state == "uat"
    doc.add_note("A3", "approved: Variant B, the weighted instrument", "kevin")
    item = doc.set_state("A3", "in-progress")

    assert item.state == "in-progress"
    assert item.owner == "claude"  # unchanged, still the original owner
    assert item.link is None
    assert item.branch is None
    notes = doc.items["A3"].notes
    assert notes[-1].text == "approved: Variant B, the weighted instrument"
    assert notes[-1].actor == "kevin"


def test_public_set_uat_normalises_link_and_writes_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    mock_git.reset_mock()

    item, committed = backlog.set_uat(
        "A1", "http://127.0.0.1:3030/design", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["state"] == "uat"
    assert item["link"] == "https://uat.wealth.auriqltd.co.uk/design"
    assert item["branch"] == "feature-A1-first-item"
    commit_call = mock_git.call_args_list[1]
    assert "backlog: A1 sent to uat (https://uat.wealth.auriqltd.co.uk/design) by claude" in commit_call.args[0]


def test_public_set_uat_rejects_a_non_public_host(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    with pytest.raises(backlog.BacklogError):
        backlog.set_uat(
            "A1", "https://evil.example.com/design", actor="claude", todo_path=todo_path, repo_root=repo_root
        )
    # Nothing was written for this failed call.
    reloaded = backlog.TodoDoc.load(todo_path)
    assert reloaded.items["A1"].state == "todo"


def test_public_set_approved_writes_note_and_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    backlog.set_uat(
        "A1", "https://uat.wealth.auriqltd.co.uk/design", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    mock_git.reset_mock()

    item, committed = backlog.set_approved(
        "A1", "Variant B", actor="kevin", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["state"] == "in-progress"
    assert item["owner"] == "claude"  # A1's original owner in TODO_FIXTURE, unchanged
    assert item["notes"][-1]["text"] == "approved: Variant B"
    assert item["notes"][-1]["actor"] == "kevin"
    commit_calls = [c.args[0] for c in mock_git.call_args_list if c.args[0][:2] == ["git", "commit"]]
    assert any("backlog: A1 approved (Variant B) by kevin" in call for call in commit_calls)


def test_public_set_approved_requires_item_to_be_in_uat(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    # A1 is plain todo in the fixture, never sent to uat.
    with pytest.raises(backlog.BacklogError):
        backlog.set_approved("A1", "Variant B", actor="kevin", todo_path=todo_path, repo_root=repo_root)


def test_public_set_approved_requires_a_choice(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    backlog.set_uat(
        "A1", "https://uat.wealth.auriqltd.co.uk/design", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    with pytest.raises(backlog.BacklogError):
        backlog.set_approved("A1", "   ", actor="kevin", todo_path=todo_path, repo_root=repo_root)


def test_list_output_shows_uat_link_and_branch(paths, mock_git):
    todo_path, compliance_path = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "feature-A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    backlog.set_uat(
        "A1", "https://uat.wealth.auriqltd.co.uk/design", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    snapshot = backlog.load(todo_path=todo_path, compliance_path=compliance_path)
    a1 = next(i for i in snapshot.items() if i["id"] == "A1")
    assert a1["state"] == "uat"
    assert a1["link"] == "https://uat.wealth.auriqltd.co.uk/design"
    assert a1["branch"] == "feature-A1-first-item"


def test_cli_uat_and_approve_round_trip(tmp_path):
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
        [sys.executable, str(SCRIPTS_BACKLOG), "review", "A1", "--branch", "feature-A1-first-item", "--uat-review"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert review_result.returncode == 0, review_result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[uat-review]" in saved

    uat_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "uat", "A1", "--link", "http://127.0.0.1:3030/design"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert uat_result.returncode == 0, uat_result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: uat: https://uat.wealth.auriqltd.co.uk/design]" in saved
    assert "127.0.0.1" not in saved
    assert "[uat-review]" not in saved  # consumed on landing

    list_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "list"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert list_result.returncode == 0, list_result.stderr
    assert "uat" in list_result.stdout

    approve_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "approve", "A1", "Variant B, the weighted instrument"],
        cwd=other_cwd, env=env, capture_output=True, text=True, timeout=30,
    )
    assert approve_result.returncode == 0, approve_result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: in-progress]" in saved
    assert "[owner: claude]" in saved  # A1's owner, unchanged by approve
    assert "approved: Variant B, the weighted instrument" in saved


def test_cli_uat_without_link_errors(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "uat", "A1"],
        cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
    )
    # argparse itself rejects the missing required --link flag.
    assert result.returncode != 0


def test_cli_approve_on_non_uat_item_errors(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "approve", "A1", "Variant B"],
        cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 1
    assert "not awaiting uat review" in result.stderr


# ---------------------------------------------------------------------
# "start after approve" (H31 follow-up): approve moves a uat item to
# in-progress, but scripts/session.sh start only ever attached to a `todo`
# item, so nobody could open a worktree for the winning variant and the
# loop deadlocked one step later than before. The fix: `in-progress` with
# NO branch recorded (exactly the shape approve leaves an item in) is now
# a second, narrow case scripts/session.sh start accepts; `in-progress`
# WITH a branch (a worktree is genuinely live) still refuses, same as
# blocked/review/uat/rejected/done — the guard item H21 added is
# unweakened, just narrowed.
# ---------------------------------------------------------------------


def test_state_in_progress_with_branch_round_trips_and_renders_branch_tag():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "in-progress", branch="feature-A1-first-item")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state: in-progress]" in line
    assert "[branch: feature-A1-first-item]" in line
    assert doc.items["A1"].branch == "feature-A1-first-item"
    assert doc.items["A1"].to_dict()["branch"] == "feature-A1-first-item"

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].state == "in-progress"
    assert reparsed.items["A1"].branch == "feature-A1-first-item"
    assert reparsed.text() == doc.text()


def test_state_in_progress_without_branch_renders_no_branch_tag():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "in-progress")
    line = doc.lines[doc.items["A1"].line_no]
    assert line.rstrip().endswith(doc.items["A1"].text) or "[branch:" not in line
    assert "[branch:" not in line
    assert doc.items["A1"].branch is None
    assert doc.items["A1"].to_dict()["branch"] is None


def test_approve_lands_in_progress_with_no_branch_even_though_uat_had_one():
    """The core H31 follow-up property: approve must NOT carry the old
    (already-deleted-by-integrate) branch forward onto the in-progress
    item, or scripts/session.sh start's new no-branch check would
    wrongly refuse it as 'already live'."""
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A3", "review", branch="feature-A3-third-item")
    doc.set_state("A3", "uat", link="https://uat.wealth.auriqltd.co.uk/design")
    assert doc.items["A3"].branch == "feature-A3-third-item"

    doc.add_note("A3", "approved: Variant B", "kevin")
    item = doc.set_state("A3", "in-progress")

    assert item.state == "in-progress"
    assert item.branch is None
    assert item.to_dict()["branch"] is None
    line = doc.lines[item.line_no]
    assert "[branch:" not in line
    assert "feature-A3-third-item" not in line


def test_in_progress_branch_is_not_retained_across_a_second_start_without_branch():
    """Going in-progress -> in-progress again with no branch passed (e.g.
    a plain 'backlog.py start <id>' with no --branch) must clear a
    previously-recorded branch, not silently keep serving the old one as
    if a worktree were still live."""
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "in-progress", branch="feature-A1-first-item")
    doc.set_state("A1", "in-progress")  # no branch this time
    assert doc.items["A1"].branch is None
    assert "[branch:" not in doc.lines[doc.items["A1"].line_no]


def test_moving_in_progress_with_branch_to_blocked_clears_the_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "in-progress", branch="feature-A1-first-item")
    doc.set_state("A1", "blocked", reason="waiting on Kevin")
    assert doc.items["A1"].branch is None
    line = doc.lines[doc.items["A1"].line_no]
    assert "[branch:" not in line


def test_public_set_state_in_progress_with_branch_writes_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_state(
        "B1", "in-progress", branch="feature-B1-thing", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["state"] == "in-progress"
    assert item["branch"] == "feature-B1-thing"
    commit_call = mock_git.call_args_list[1]
    assert "backlog: B1 started (branch feature-B1-thing) by claude" in commit_call.args[0]


def test_public_set_state_in_progress_without_branch_writes_plain_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_state(
        "B1", "in-progress", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["branch"] is None
    commit_call = mock_git.call_args_list[1]
    assert "backlog: B1 started by claude" in commit_call.args[0]


def test_cli_start_with_branch_flag_round_trips(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "start", "A1", "--branch", "feature-A1-first-item"],
        cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: in-progress]" in saved
    assert "[branch: feature-A1-first-item]" in saved

    show_result = _cli_show(board_root, "A1")
    data = json.loads(show_result.stdout)
    assert data["state"] == "in-progress"
    assert data["branch"] == "feature-A1-first-item"


def test_cli_start_without_branch_flag_records_no_branch(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "start", "A1"],
        cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: in-progress]" in saved
    assert "[branch:" not in saved


def test_end_to_end_uat_loop_including_start_after_approve(tmp_path):
    """The full deliverable, exercised through the real CLI end to end on
    a synthetic board (never a real board item): in-progress -> review
    --uat-review -> (simulated integrate landing) uat with a link ->
    approve -> in-progress with no branch -> start succeeds again with a
    NEW branch. Mirrors exactly what scripts/integrate.py and
    scripts/session.sh do, without touching git/worktrees, which the
    shell-level test covers separately."""
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    def run(*args):
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_BACKLOG), *args],
            cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
        )
        assert result.returncode == 0, f"{args} failed: {result.stderr}"
        return result

    # 1. a session claims A1 with a live worktree branch.
    run("start", "A1", "--branch", "feature-A1-first-item")
    state = json.loads(run("show", "A1").stdout)
    assert state["state"] == "in-progress" and state["branch"] == "feature-A1-first-item"

    # a second session must not be able to attach while this one is live
    # (session.sh's own refusal is covered by the shell test; here we
    # confirm the board data it reads on).
    assert state["branch"] == "feature-A1-first-item"

    # 2. session finishes: sent to review, flagged as a design round.
    run("review", "A1", "--branch", "feature-A1-first-item", "--uat-review")
    state = json.loads(run("show", "A1").stdout)
    assert state["state"] == "review" and state["uat_review"] is True

    # 3. simulated integrate landing: uat with a preview link.
    run("uat", "A1", "--link", "https://uat.wealth.auriqltd.co.uk/design")
    state = json.loads(run("show", "A1").stdout)
    assert state["state"] == "uat"
    assert state["link"] == "https://uat.wealth.auriqltd.co.uk/design"
    assert state["branch"] == "feature-A1-first-item"  # retained through uat

    # 4. Kevin approves a variant.
    run("approve", "A1", "Variant B, the weighted instrument")
    state = json.loads(run("show", "A1").stdout)
    assert state["state"] == "in-progress"
    assert state["branch"] is None  # old branch cleared, no worktree live
    assert state["owner"] == "claude"  # unchanged
    assert state["notes"][-1]["text"] == "approved: Variant B, the weighted instrument"

    # 5. a fresh session can now start on it again, with a NEW branch.
    run("start", "A1", "--branch", "feature-A1-first-item-v2")
    state = json.loads(run("show", "A1").stdout)
    assert state["state"] == "in-progress"
    assert state["branch"] == "feature-A1-first-item-v2"

    print("end-to-end uat loop (CLI level):")
    print("  in-progress(branch) -> review --uat-review -> uat(link) -> approve -> in-progress(no branch) -> start(new branch)")
    print("  final state:", state)


# ---------------------------------------------------------------------
# H38 — lint / repair of historical pytest-noise damage: before H27 added
# `one_line_reason`, a raw multi-line pytest run got written straight into
# a `[state: blocked: ...]` reason, leaving free-standing dot-progress
# rows and item lines with a `[state: ...` tag that never closes with a
# `]` on the same physical line. `lint_todo`/`repair_todo` detect and (on
# request) clean that up without touching anything else.
# ---------------------------------------------------------------------

NOISE_FIXTURE = """# Backlog fixture with historical pytest noise (H38)

## A. Section A heading

- [x] **A1. First item, corrupted by the old integrate bug.** [owner: claude] [priority: p1] [state: blocked: backend test suite failed: (done 2026-09-01, abc0001)
........................................................................ [  4%]
........................................................................ [  9%]
.................................] [unblocks: Q1]
  - note (2026-09-01, claude): Requeued after a transient failure.
- [ ] **A2. Clean item, untouched.** [owner: claude] Some description text about A2.
"""


def test_lint_todo_leaves_a_clean_board_untouched():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    assert backlog.lint_todo(doc) == []


def test_lint_todo_flags_noise_lines_and_the_dangling_state_tag():
    doc = backlog.TodoDoc.parse(NOISE_FIXTURE)
    findings = backlog.lint_todo(doc)

    noise = [f for f in findings if f.kind == "noise_line"]
    dangling = [f for f in findings if f.kind == "dangling_state_tag"]
    assert len(noise) == 3
    assert len(dangling) == 1

    # The three noise lines are exactly the dot-progress rows, never the
    # item line itself or the note.
    noise_originals = {f.original for f in noise}
    assert noise_originals == {
        "........................................................................ [  4%]",
        "........................................................................ [  9%]",
        ".................................] [unblocks: Q1]",
    }

    tag = dangling[0]
    assert tag.item_id == "A1"
    assert "[state:" not in tag.replacement
    assert tag.replacement.endswith("(done 2026-09-01, abc0001)")
    assert "[owner: claude]" in tag.replacement
    assert "[priority: p1]" in tag.replacement


def test_repair_todo_dry_run_changes_nothing_on_disk(tmp_path, mock_git):
    todo_path = tmp_path / "TODO.md"
    todo_path.write_text(NOISE_FIXTURE, encoding="utf-8")
    before = todo_path.read_text(encoding="utf-8")

    findings, committed = backlog.repair_todo(apply=False, todo_path=todo_path, repo_root=tmp_path)

    assert len(findings) == 4
    assert committed is False
    assert todo_path.read_text(encoding="utf-8") == before
    mock_git.assert_not_called()


def test_repair_todo_apply_removes_exactly_the_malformed_lines(tmp_path, mock_git):
    todo_path = tmp_path / "TODO.md"
    todo_path.write_text(NOISE_FIXTURE, encoding="utf-8")

    findings, committed = backlog.repair_todo(
        apply=True, actor="claude", todo_path=todo_path, repo_root=tmp_path
    )

    assert len(findings) == 4
    assert committed is True
    assert "backlog: repaired 4 malformed line(s) by claude" in mock_git.call_args_list[1].args[0]

    saved = todo_path.read_text(encoding="utf-8")
    assert "....." not in saved
    assert "[state: blocked: backend test suite failed:" not in saved

    # Nothing but the flagged lines moved: A1 keeps its done marker, commit,
    # owner, priority and (now correctly attached, since the noise between
    # it and the item line is gone) its note; A2 is untouched byte for byte.
    reparsed = backlog.TodoDoc.parse(saved)
    assert set(reparsed.items) == {"A1", "A2"}

    a1 = reparsed.items["A1"]
    assert a1.done is True
    assert a1.done_at == "2026-09-01"
    assert a1.commit == "abc0001"
    assert a1.owner == "claude"
    assert a1.priority == "p1"
    assert a1.text == ""
    assert len(a1.notes) == 1
    assert a1.notes[0].text == "Requeued after a transient failure."

    a2 = reparsed.items["A2"]
    assert a2.text == "Some description text about A2."
    assert a2.owner == "claude"


def test_repair_todo_apply_on_a_clean_board_makes_no_commit(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    before = todo_path.read_text(encoding="utf-8")

    findings, committed = backlog.repair_todo(apply=True, todo_path=todo_path, repo_root=repo_root)

    assert findings == []
    assert committed is False
    assert todo_path.read_text(encoding="utf-8") == before
    mock_git.assert_not_called()


def test_cli_lint_dry_run_then_apply(tmp_path):
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(NOISE_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    def run(*args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(SCRIPTS_BACKLOG), *args],
            cwd=board_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    dry = run("lint")
    assert dry.returncode == 0, dry.stderr
    assert "would remove pytest noise line" in dry.stdout
    assert "would rewrite dangling state tag" in dry.stdout
    # Dry run really did nothing.
    assert "....." in (board_root / "TODO.md").read_text(encoding="utf-8")

    applied = run("lint", "--apply")
    assert applied.returncode == 0, applied.stderr
    assert "4 finding(s) fixed." in applied.stdout

    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "....." not in saved
    assert "[state: blocked:" not in saved

    # A second pass has nothing left to do.
    clean = run("lint")
    assert clean.returncode == 0, clean.stderr
    assert "no H38-shaped damage found" in clean.stdout
