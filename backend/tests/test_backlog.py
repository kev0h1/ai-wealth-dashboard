"""Tests for backend/app/services/backlog.py — the shared TODO.md /
compliance-questionnaire model behind `scripts/backlog.py` and the
`/ops/go-live` write endpoints.

Everything here runs on temp copies of TODO.md / the compliance doc under
`tmp_path` (never the real files), and mocks `subprocess.run` so no test
ever touches the real git history or network.
"""
from __future__ import annotations

import os
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
    with pytest.raises(backlog.BacklogError):
        doc.set_owner("A1", "nobody")


def test_add_note_appends_after_existing_notes_and_keeps_other_items_intact():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.add_note("A3", "a brand new note", "claude")
    assert len(doc.items["A3"].notes) == 2
    assert doc.items["A3"].notes[-1].text == "a brand new note"
    assert doc.items["A3"].notes[-1].actor == "claude"
    # B1 must still parse correctly after the line-count shift.
    assert doc.items["B1"].text == "Something about B1."


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
    doc.set_state("A1", "review", branch="item/A1-first-item")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state: review: item/A1-first-item]" in line
    assert doc.items["A1"].state == "review"
    assert doc.items["A1"].branch == "item/A1-first-item"

    reparsed = backlog.TodoDoc.parse(doc.text())
    assert reparsed.items["A1"].state == "review"
    assert reparsed.items["A1"].branch == "item/A1-first-item"
    assert reparsed.items["A1"].to_dict()["branch"] == "item/A1-first-item"


def test_state_review_without_branch_raises():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    with pytest.raises(backlog.BacklogError):
        doc.set_state("A1", "review")


def test_state_review_then_blocked_clears_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="item/A1-first-item")
    doc.set_state("A1", "blocked", reason="integration conflict with main; rebase the branch")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state: blocked:" in line
    assert "review" not in line
    assert doc.items["A1"].branch is None


def test_mark_done_from_review_clears_state_and_branch():
    doc = backlog.TodoDoc.parse(TODO_FIXTURE)
    doc.set_state("A1", "review", branch="item/A1-first-item")
    doc.set_done("A1", True, commit="deadbee")
    line = doc.lines[doc.items["A1"].line_no]
    assert "[state:" not in line
    assert doc.items["A1"].state == "todo"
    assert doc.items["A1"].to_dict()["branch"] is None


def test_public_set_review_writes_file_and_commit_message(paths, mock_git):
    todo_path, _ = paths
    repo_root = todo_path.parent
    item, committed = backlog.set_review(
        "A1", "item/A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root
    )
    assert committed is True
    assert item["state"] == "review"
    assert item["branch"] == "item/A1-first-item"
    commit_call = mock_git.call_args_list[1]
    assert "backlog: A1 sent to review (item/A1-first-item) by claude" in commit_call.args[0]


def test_list_output_shows_review_branch(paths, mock_git, capsys):
    todo_path, compliance_path = paths
    repo_root = todo_path.parent
    backlog.set_review("A1", "item/A1-first-item", actor="claude", todo_path=todo_path, repo_root=repo_root)
    snapshot = backlog.load(todo_path=todo_path, compliance_path=compliance_path)
    a1 = next(i for i in snapshot.items() if i["id"] == "A1")
    assert a1["state"] == "review"
    assert a1["branch"] == "item/A1-first-item"


# ---------------------------------------------------------------------
# add_item (allocate the next id in a section)
# ---------------------------------------------------------------------


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
        [sys.executable, str(SCRIPTS_BACKLOG), "review", new_id, "--branch", "item/A4-cli-added-item"],
        cwd=other_cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert review_result.returncode == 0, review_result.stderr
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "[state: review: item/A4-cli-added-item]" in saved

    list_result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "list"],
        cwd=other_cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert list_result.returncode == 0, list_result.stderr
    assert "review:item/A4-cli-added-item" in list_result.stdout
