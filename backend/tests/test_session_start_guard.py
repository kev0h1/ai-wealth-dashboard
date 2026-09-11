"""End-to-end tests for `scripts/session.sh start`'s item-H21 guard: it must
refuse to attach to a backlog item that already exists but isn't in `todo`
state, and `--title` must always allocate a fresh id rather than reusing
whatever id the caller guessed.

`scripts/session.sh` hardcodes `SHARED_TREE=/root/ai-wealth-dashboard` (see
its header comment: that fixed path is deliberate, so a session running
from a worktree edits the one shared board, not a fork of it). These tests
never touch that real path. Instead each test builds its own throwaway
"shared tree" under `tmp_path` — a local bare repo as a fake `origin` plus
a clone of it as the fake shared tree — and drives `cmd_start` by sourcing
the real `scripts/session.sh` in a small bash driver, then reassigning its
`SHARED_TREE` / `BACKLOG_PY` / `VENV_PY` / `WORKTREES_ROOT` globals before
calling `cmd_start` directly (skipping `main`'s own dispatch, which already
ran once harmlessly via `source ... ""` -> the empty-command usage branch).
This runs the *actual* function bodies from the real script, unmodified and
in place, just pointed at disposable fixtures.

`BACKLOG_PY` is pointed at *this worktree's* `scripts/backlog.py` (the one
with the new `show` command from item H21), not the shared tree's, since
the guard depends on it and the shared tree's copy won't have it until
`integrate.py` merges this branch. `BACKLOG_ROOT` (honoured by
`backend/app/services/backlog.py` regardless of cwd) points that script at
a throwaway TODO.md under `tmp_path`, never the real board.

The guard runs before any worktree is created, so the refusal-path tests
below never create one. The two success-path tests (a `todo` id, and
`--title`) do let `cmd_start` run to completion, including a real `git
worktree add` — but entirely inside `tmp_path`'s fake shared tree, never
touching `/root/worktrees` or `/root/ai-wealth-dashboard`.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION_SH = REPO_ROOT / "scripts" / "session.sh"
BACKLOG_PY = REPO_ROOT / "scripts" / "backlog.py"
VENV_PY = REPO_ROOT / "backend" / ".venv" / "bin" / "python"

COMPLIANCE_FIXTURE = """# Fixture compliance doc

## Q1 Start date

Status: ready

```text
2026-10-01
```
"""

GUARD_FIXTURE = """# Backlog fixture for session.sh start guard tests

## H. Section H heading

- [ ] **H1. Todo item, ready to start.** [owner: claude] Nothing special.
- [ ] **H2. In progress item.** [owner: claude] [state: in-progress] Someone already has it.
- [ ] **H3. Blocked item with a reason.** [owner: claude] [state: blocked: waiting on Kevin] Needs Kevin.
- [ ] **H5. Review item.** [owner: claude] [state: review: feature-H5-thing] Sent to review.
- [x] **H6. Done item.** [owner: claude] Already done. (done 2026-09-01, abc1234)
"""

# Separate fixture for the item-H29 owner guard tests below, kept apart
# from GUARD_FIXTURE so it doesn't shift the id GUARD_FIXTURE's own tests
# expect `add_item` to allocate next (max existing number in the section,
# plus one; see backend/app/services/backlog.py TodoDoc.add_item).
OWNER_GUARD_FIXTURE = """# Backlog fixture for session.sh start owner guard tests (H29)

## H. Section H heading

- [ ] **H1. Claude owned todo item.** [owner: claude] Nothing special.
- [ ] **H2. Codex owned todo item.** [owner: codex] Nothing special.
- [ ] **H3. Kevin owned todo item.** [owner: kevin] Nothing special.
"""

pytestmark = pytest.mark.skipif(not VENV_PY.exists(), reason="backend/.venv not present in this checkout")


def _make_board_root(tmp_path: Path, fixture: str = GUARD_FIXTURE) -> Path:
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(fixture, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    return board_root


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _make_fake_shared_tree(tmp_path: Path) -> Path:
    """A disposable local "shared tree": a bare repo as `origin` plus a
    clone of it, exactly like the real /root/ai-wealth-dashboard is a clone
    with an `origin` remote, minus any frontend/backend dirs (cmd_start's
    node_modules/.venv symlink steps are conditional on those existing, so
    they're skipped cleanly)."""
    origin = tmp_path / "origin.git"
    _git("init", "--bare", "-q", "-b", "main", str(origin), cwd=tmp_path)

    seed = tmp_path / "seed"
    seed.mkdir()
    _git("init", "-q", "-b", "main", cwd=seed)
    (seed / ".gitkeep").write_text("", encoding="utf-8")
    _git("add", "-A", cwd=seed)
    _git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init", cwd=seed)
    _git("remote", "add", "origin", str(origin), cwd=seed)
    _git("push", "-q", "origin", "main", cwd=seed)
    shutil.rmtree(seed)

    shared = tmp_path / "shared"
    _git("clone", "-q", str(origin), str(shared), cwd=tmp_path)
    return shared


def _run_start(
    tmp_path: Path,
    board_root: Path,
    shared_tree: Path,
    *args: str,
    agent: str | None = None,
) -> subprocess.CompletedProcess:
    worktrees_root = tmp_path / "worktrees"
    driver = tmp_path / "guard_driver.sh"
    driver.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        '_SESSION_SH="$1"; shift\n'
        '_FAKE_SHARED="$1"; shift\n'
        '_FAKE_BACKLOG_PY="$1"; shift\n'
        '_FAKE_VENV_PY="$1"; shift\n'
        '_FAKE_WORKTREES="$1"; shift\n'
        "\n"
        "# Sourced with no command: runs main \"\" once, which just prints\n"
        "# usage and returns (does not exit), leaving the real cmd_start\n"
        "# etc. function bodies defined in this shell.\n"
        'source "$_SESSION_SH" ""\n'
        "\n"
        'SHARED_TREE="$_FAKE_SHARED"\n'
        'BACKLOG_PY="$_FAKE_BACKLOG_PY"\n'
        'VENV_PY="$_FAKE_VENV_PY"\n'
        'WORKTREES_ROOT="$_FAKE_WORKTREES"\n'
        "\n"
        'cmd_start "$@"\n',
        encoding="utf-8",
    )

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    # Deterministic default: tests exercising the owner guard (H29) pass
    # `agent` explicitly; everything else should behave as if the caller
    # never set BACKLOG_AGENT at all (defaulting to claude), regardless of
    # what happens to be set in the ambient test environment.
    env.pop("BACKLOG_AGENT", None)
    if agent is not None:
        env["BACKLOG_AGENT"] = agent

    return subprocess.run(
        ["bash", str(driver), str(SESSION_SH), str(shared_tree), str(BACKLOG_PY), str(VENV_PY), str(worktrees_root), *args],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _show(board_root: Path, item_id: str) -> dict:
    import json

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    result = subprocess.run(
        [sys.executable, str(BACKLOG_PY), "show", item_id],
        cwd=board_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


# ---------------------------------------------------------------------
# Refusal paths: the guard must exit 1 with a clear message, and — since
# it runs before any worktree is created — must leave no worktree behind.
# ---------------------------------------------------------------------


def test_start_refuses_in_progress_item(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H2")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H2 is already in-progress" in result.stderr
    assert "session.sh list" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_refuses_blocked_item_and_includes_reason(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H3")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H3 is blocked" in result.stderr
    assert "waiting on Kevin" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_refuses_review_item_and_includes_branch(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H5")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H5 is in review" in result.stderr
    assert "feature-H5-thing" in result.stderr
    assert "integrate" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_refuses_done_item_and_points_at_title(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H6")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H6 is already done" in result.stderr
    assert "--title" in result.stderr
    assert not (tmp_path / "worktrees").exists()

    # The board itself must be untouched: still done, no stray worktree
    # or branch anywhere (this is the exact real-world H18 scenario).
    data = _show(board_root, "H6")
    assert data["state"] == "done"


# ---------------------------------------------------------------------
# Success paths
# ---------------------------------------------------------------------


def test_start_still_works_on_a_todo_item(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "finish with: scripts/session.sh finish H1" in result.stdout

    worktree_dir = tmp_path / "worktrees" / "feature-H1-todo-item-ready-to"
    assert worktree_dir.is_dir()

    data = _show(board_root, "H1")
    assert data["state"] == "in-progress"


def test_title_always_allocates_a_fresh_id_even_when_requested_id_is_free(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H999", "--title", "Brand new idea")
    assert result.returncode == 0, result.stdout + result.stderr

    data = _show(board_root, "H1")  # sanity: H1 untouched
    assert data["state"] == "todo"

    # H999 was never a real item; the board should now have a freshly
    # allocated id (H7, the next free one in section H) instead.
    new_data = _show(board_root, "H7")
    assert new_data["title"] == "Brand new idea"
    assert new_data["state"] == "in-progress"
    assert "H7: allocated new item" in result.stdout or "allocated new item H7" in result.stdout


def test_title_wins_over_an_existing_todo_id(tmp_path):
    """H21 build step 2: if the caller passes both an existing todo id and
    --title, --title wins and a fresh id is allocated — the existing id is
    never looked up, let alone reused."""
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H1", "--title", "Different fresh idea")
    assert result.returncode == 0, result.stdout + result.stderr

    # H1 (an existing, free, todo item) must be untouched: --title ignored
    # it entirely rather than attaching to it.
    h1 = _show(board_root, "H1")
    assert h1["state"] == "todo"

    new_data = _show(board_root, "H7")
    assert new_data["title"] == "Different fresh idea"
    assert new_data["state"] == "in-progress"

    worktree_dir = tmp_path / "worktrees" / "feature-H7-different-fresh-idea"
    assert worktree_dir.is_dir()


# ---------------------------------------------------------------------
# Owner guard (item H29): a session only starts an item owned by its own
# model type (BACKLOG_AGENT, defaulting to claude), unless --any-owner is
# passed. An item owned by kevin is refused for every agent type.
# ---------------------------------------------------------------------


def test_start_refuses_item_owned_by_another_agent_when_agent_unset(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H2")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H2 is owned by codex" in result.stderr
    assert "not claude" in result.stderr
    assert "--any-owner" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_refuses_item_owned_by_another_agent_for_codex(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H1", agent="codex")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H1 is owned by claude" in result.stderr
    assert "not codex" in result.stderr
    assert "--any-owner" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_refuses_kevin_owned_item_for_claude(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H3")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H3 is owned by kevin" in result.stderr
    assert "--any-owner" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_refuses_kevin_owned_item_for_codex(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H3", agent="codex")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "H3 is owned by kevin" in result.stderr
    assert "--any-owner" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_allows_matching_owner_for_codex_agent(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H2", agent="codex")
    assert result.returncode == 0, result.stdout + result.stderr

    data = _show(board_root, "H2")
    assert data["state"] == "in-progress"


def test_start_any_owner_overrides_mismatched_owner(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H2", "--any-owner")
    assert result.returncode == 0, result.stdout + result.stderr

    data = _show(board_root, "H2")
    assert data["state"] == "in-progress"


def test_start_any_owner_overrides_kevin_owned_item(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H3", "--any-owner")
    assert result.returncode == 0, result.stdout + result.stderr

    data = _show(board_root, "H3")
    assert data["state"] == "in-progress"


def test_start_rejects_invalid_backlog_agent_value(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H1", agent="gpt5")
    assert result.returncode == 1, result.stdout + result.stderr
    assert "BACKLOG_AGENT" in result.stderr
    assert "gpt5" in result.stderr
    assert not (tmp_path / "worktrees").exists()


def test_start_title_creates_item_owned_by_codex_when_agent_is_codex(tmp_path):
    """--title always allocates a fresh item (see the H21 tests above); it
    must own that fresh item to the caller's own type, not hardcode
    `claude`, or a Codex session using --title would immediately violate
    the very rule H29 exists to enforce."""
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H9", "--title", "New codex idea", agent="codex")
    assert result.returncode == 0, result.stdout + result.stderr

    # OWNER_GUARD_FIXTURE's highest existing H-number is 3, so --title
    # allocates H4.
    new_data = _show(board_root, "H4")
    assert new_data["title"] == "New codex idea"
    assert new_data["owner"] == "codex"
    assert new_data["state"] == "in-progress"


def test_start_title_creates_item_owned_by_claude_when_agent_unset(tmp_path):
    board_root = _make_board_root(tmp_path, fixture=OWNER_GUARD_FIXTURE)
    shared_tree = _make_fake_shared_tree(tmp_path)
    result = _run_start(tmp_path, board_root, shared_tree, "H9", "--title", "New claude idea")
    assert result.returncode == 0, result.stdout + result.stderr

    new_data = _show(board_root, "H4")
    assert new_data["title"] == "New claude idea"
    assert new_data["owner"] == "claude"
    assert new_data["state"] == "in-progress"
