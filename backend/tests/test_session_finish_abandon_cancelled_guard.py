"""End-to-end tests for the H80 correction round's HIGH 1/HIGH 2 fix:
`scripts/session.sh finish` must refuse a cancelled item before running
any tests or pushing anything, and `scripts/session.sh abandon` on a
cancelled item must remove the worktree/branch without un-cancelling the
item (no `todo` call), instead clearing its now-dangling `[branch: ...]`
tag.

What the `finish` tests actually prove (reviewer round 3 correction, so
this is stated precisely rather than implied): the fake worktree here has
no `backend/`/`frontend/` directories at all, so even the PRE-fix
`cmd_finish` would have died at its own pytest step long before reaching
`git push` -- these tests do not, and could not, reproduce a real push
being attempted and blocked. What they legitimately assert is (1) the new
guard fires and exits 1 with the expected message BEFORE any of
`cmd_finish`'s later steps run at all (i.e. strictly upstream of where a
push would happen), and (2), as a positive fact about the resulting
state, that the branch is absent from `origin` and the item is untouched
afterwards. Together these are the guard actually firing early, not a
simulation of "a push was attempted and rejected".

Same sandboxing convention as `test_session_start_guard.py`: a disposable
local "shared tree" (bare repo as `origin` plus a clone) under `tmp_path`,
`SHARED_TREE`/`BACKLOG_PY`/`VENV_PY`/`WORKTREES_ROOT` reassigned after
sourcing the real `scripts/session.sh`, and `BACKLOG_ROOT` pointing
`scripts/backlog.py` at a throwaway `TODO.md`. `BACKLOG_PY` is this
worktree's own `scripts/backlog.py` (the one with `cancel`/`uncancel`/
`clear-branch` and the `_refuse_if_cancelled` guard), not the shared
tree's, since the guard depends on it and the real shared tree won't have
it until `integrate.py` merges this branch.

Unlike `test_session_start_guard.py`, these tests need a real worktree to
exist (both `cmd_finish` and `cmd_abandon` operate on one), so each test
creates one with a real `git worktree add` off the fake shared tree,
entirely inside `tmp_path`, never touching `/root/worktrees` or
`/root/ai-wealth-dashboard`.
"""
from __future__ import annotations

import json
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


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _make_fake_shared_tree(tmp_path: Path) -> Path:
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


def _make_board_root(tmp_path: Path, fixture: str) -> Path:
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(fixture, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    return board_root


def _make_worktree(shared_tree: Path, worktrees_root: Path, item_id: str, board_env: dict) -> tuple[Path, str]:
    """Creates a real feature-<id>-thing worktree/branch off the fake
    shared tree's main, and records that branch on the item via the real
    `backlog.py start --branch` (so `[branch: ...]` matches what a genuine
    live session would have written) -- callers then cancel the item
    themselves to get to the "in-progress with a branch, then cancelled"
    shape HIGH 1/HIGH 2 are about."""
    worktrees_root.mkdir(parents=True, exist_ok=True)
    branch = f"feature-{item_id}-thing"
    worktree_dir = worktrees_root / branch
    _git("worktree", "add", str(worktree_dir), "-b", branch, "main", cwd=shared_tree)
    subprocess.run(
        [sys.executable, str(BACKLOG_PY), "start", item_id, "--branch", branch],
        cwd=shared_tree,
        env=board_env,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return worktree_dir, branch


def _run_session_cmd(
    tmp_path: Path,
    board_root: Path,
    shared_tree: Path,
    worktrees_root: Path,
    *args: str,
) -> subprocess.CompletedProcess:
    driver = tmp_path / "driver.sh"
    driver.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        '_SESSION_SH="$1"; shift\n'
        '_FAKE_SHARED="$1"; shift\n'
        '_FAKE_BACKLOG_PY="$1"; shift\n'
        '_FAKE_VENV_PY="$1"; shift\n'
        '_FAKE_WORKTREES="$1"; shift\n'
        '_CMD="$1"; shift\n'
        "\n"
        'source "$_SESSION_SH" ""\n'
        "\n"
        'SHARED_TREE="$_FAKE_SHARED"\n'
        'BACKLOG_PY="$_FAKE_BACKLOG_PY"\n'
        'VENV_PY="$_FAKE_VENV_PY"\n'
        'WORKTREES_ROOT="$_FAKE_WORKTREES"\n'
        "\n"
        'cmd_"$_CMD" "$@"\n',
        encoding="utf-8",
    )
    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    env.pop("BACKLOG_AGENT", None)
    return subprocess.run(
        ["bash", str(driver), str(SESSION_SH), str(shared_tree), str(BACKLOG_PY), str(VENV_PY), str(worktrees_root), *args],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _show(board_root: Path, item_id: str) -> dict:
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


GUARD_FIXTURE = """# Backlog fixture for session.sh finish/abandon cancelled guard tests (H80)

## H. Section H heading

- [ ] **H1. Todo item, ready to start.** [owner: claude] Nothing special.
"""


# ---------------------------------------------------------------------
# HIGH 1: `scripts/session.sh finish` must refuse a cancelled item BEFORE
# running any tests or pushing anything.
# ---------------------------------------------------------------------


def test_finish_refuses_a_cancelled_item_before_pushing_anything(tmp_path):
    shared_tree = _make_fake_shared_tree(tmp_path)
    board_root = _make_board_root(tmp_path, GUARD_FIXTURE)
    worktrees_root = tmp_path / "worktrees"
    board_env = dict(os.environ)
    board_env["BACKLOG_ROOT"] = str(board_root)

    worktree_dir, branch = _make_worktree(shared_tree, worktrees_root, "H1", board_env)

    # Kevin cancels the item while a worktree is genuinely live on it.
    cancel = subprocess.run(
        [sys.executable, str(BACKLOG_PY), "cancel", "H1", "superseded", "--actor", "kevin"],
        cwd=shared_tree, env=board_env, capture_output=True, text=True, timeout=30,
    )
    assert cancel.returncode == 0, cancel.stderr
    item = _show(board_root, "H1")
    assert item["state"] == "cancelled"
    assert item["branch"] == branch

    # Proves the bug this closes: before the fix, `finish` had no state
    # check at all, so it would have gone on to run its pytest/tsc/npm
    # steps and, in a real worktree, push. Here the guard fires and exits
    # 1 immediately, before any of those steps run.
    result = _run_session_cmd(tmp_path, board_root, shared_tree, worktrees_root, "finish", "H1")

    assert result.returncode == 1, result.stdout + result.stderr
    assert "is cancelled" in result.stderr
    assert "superseded" in result.stderr
    assert "abandon" in result.stderr

    # A fact about the resulting state, not a claim that this sandbox
    # reproduced a real push attempt (see the module docstring): the
    # branch is absent from origin.
    ls_remote = subprocess.run(
        ["git", "ls-remote", "--heads", "origin", branch], cwd=shared_tree, capture_output=True, text=True,
    )
    assert branch not in ls_remote.stdout

    # The item is untouched: still cancelled, same reason, same branch,
    # never sent to review.
    item = _show(board_root, "H1")
    assert item["state"] == "cancelled"
    assert item["reason"] == "superseded"
    assert item["branch"] == branch

    # Cleanup: this test's own worktree, never touching the real one.
    subprocess.run(["git", "worktree", "remove", "--force", str(worktree_dir)], cwd=shared_tree, capture_output=True)


def test_finish_still_works_on_a_non_cancelled_item(tmp_path):
    # Belt and braces: the new guard must not false-positive on an
    # ordinary in-progress item. This does NOT run the real backend test
    # suite -- the fake worktree has no backend/frontend directories at
    # all, so cmd_finish's own pytest step fails immediately once it gets
    # there; this test only asserts that failure isn't "is cancelled"
    # (the guard itself did not misfire), and does not care what happens
    # after that.
    shared_tree = _make_fake_shared_tree(tmp_path)
    board_root = _make_board_root(tmp_path, GUARD_FIXTURE)
    worktrees_root = tmp_path / "worktrees"
    board_env = dict(os.environ)
    board_env["BACKLOG_ROOT"] = str(board_root)

    worktree_dir, branch = _make_worktree(shared_tree, worktrees_root, "H1", board_env)
    item = _show(board_root, "H1")
    assert item["state"] == "in-progress"
    assert item["branch"] == branch

    # cmd_finish's own state check must not raise/refuse for this item;
    # it will go on to fail later (no real backend/frontend in this
    # sandboxed worktree), which is fine -- this test only proves the new
    # guard itself does not misfire on a live, non-cancelled item.
    result = _run_session_cmd(tmp_path, board_root, shared_tree, worktrees_root, "finish", "H1")
    assert "is cancelled" not in result.stderr

    subprocess.run(["git", "worktree", "remove", "--force", str(worktree_dir)], cwd=shared_tree, capture_output=True)


# ---------------------------------------------------------------------
# HIGH 2: `scripts/session.sh abandon` on a cancelled item must remove the
# worktree/branch WITHOUT reopening the item (no `todo` call), and should
# clear the now-dangling `[branch: ...]` tag.
# ---------------------------------------------------------------------


def test_abandon_on_a_cancelled_item_does_not_reopen_it(tmp_path):
    shared_tree = _make_fake_shared_tree(tmp_path)
    board_root = _make_board_root(tmp_path, GUARD_FIXTURE)
    worktrees_root = tmp_path / "worktrees"
    board_env = dict(os.environ)
    board_env["BACKLOG_ROOT"] = str(board_root)

    worktree_dir, branch = _make_worktree(shared_tree, worktrees_root, "H1", board_env)

    cancel = subprocess.run(
        [sys.executable, str(BACKLOG_PY), "cancel", "H1", "superseded", "--actor", "kevin"],
        cwd=shared_tree, env=board_env, capture_output=True, text=True, timeout=30,
    )
    assert cancel.returncode == 0, cancel.stderr
    item = _show(board_root, "H1")
    assert item["state"] == "cancelled"
    assert item["branch"] == branch

    # Proves the bug this closes: before the fix, abandon unconditionally
    # ran `backlog.py todo`, which would have wiped "cancelled" here.
    result = _run_session_cmd(tmp_path, board_root, shared_tree, worktrees_root, "abandon", "H1")
    assert result.returncode == 0, result.stdout + result.stderr

    assert not worktree_dir.exists()
    branches = subprocess.run(["git", "branch", "--list", branch], cwd=shared_tree, capture_output=True, text=True)
    assert branch not in branches.stdout

    item = _show(board_root, "H1")
    assert item["state"] == "cancelled"  # NOT reopened to todo
    assert item["reason"] == "superseded"
    assert item["branch"] is None  # dangling tag cleared, not left pointing at a deleted branch
    assert any("stays cancelled" in n["text"] for n in item["notes"])


def test_abandon_on_a_non_cancelled_item_still_resets_to_todo(tmp_path):
    # Belt and braces: the branch-on-state fix must not change abandon's
    # existing behaviour for every other state.
    shared_tree = _make_fake_shared_tree(tmp_path)
    board_root = _make_board_root(tmp_path, GUARD_FIXTURE)
    worktrees_root = tmp_path / "worktrees"
    board_env = dict(os.environ)
    board_env["BACKLOG_ROOT"] = str(board_root)

    worktree_dir, branch = _make_worktree(shared_tree, worktrees_root, "H1", board_env)
    item = _show(board_root, "H1")
    assert item["state"] == "in-progress"

    result = _run_session_cmd(tmp_path, board_root, shared_tree, worktrees_root, "abandon", "H1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert not worktree_dir.exists()

    item = _show(board_root, "H1")
    assert item["state"] == "todo"
    assert item["branch"] is None
