"""Tests for the H93 fix: a stale or contended `.git/index.lock`, and
concurrent board writers racing each other's `git commit`.

Unlike test_backlog.py (which mocks `subprocess.run` so nothing ever
touches real git), everything here runs against a REAL, disposable git
repo under `tmp_path` with a local bare repo standing in for `origin`, so
`git add`/`commit`/`push` really run and a real `.git/index.lock` can be
created. Never the real board, never `/root/ai-wealth-dashboard` or
`/root/worktrees`.

The incident this closes (2026-09-27): a board commit died mid-operation
and left `.git/index.lock` in the shared tree, 30 minutes old with no
live git process. Three concurrent board writes behind it each printed
"saved to file; git commit or push failed" and carried on with exit 0,
so none of them ever reached origin/main, and nothing that read the
board (including /ops/go-live) could tell.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.services import backlog

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_BACKLOG = REPO_ROOT / "scripts" / "backlog.py"

TODO_FIXTURE = """# Backlog fixture

## A. Section A heading

- [ ] **A1. First item.** [owner: claude] Some description text about A1.
"""

COMPLIANCE_FIXTURE = """# Fixture compliance doc

## Q1 Start date

Status: ready

```text
2026-10-01
```
"""


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True, timeout=15)


def _make_real_board_root(tmp_path: Path) -> Path:
    """A real, pushable git repo at `tmp_path/board`, wired to a local
    bare `origin` one directory over, seeded with TODO_FIXTURE/
    COMPLIANCE_FIXTURE and one initial commit already pushed. Every
    mutator under test here (`backlog.set_state`/`add_note`/the CLI) can
    then genuinely `git add`/`commit`/`push` against it."""
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    origin = tmp_path / "board-origin.git"
    _git("init", "--bare", "-q", "-b", "main", str(origin), cwd=tmp_path)
    _git("init", "-q", "-b", "main", cwd=board_root)
    _git("config", "user.email", "backlog-test@example.com", cwd=board_root)
    _git("config", "user.name", "Backlog Test", cwd=board_root)
    _git("remote", "add", "origin", str(origin), cwd=board_root)
    _git("add", "-A", cwd=board_root)
    _git("commit", "-q", "-m", "initial fixture commit", cwd=board_root)
    _git("push", "-q", "-u", "origin", "HEAD", cwd=board_root)
    return board_root


def _commit_count(board_root: Path) -> int:
    result = _git("log", "--oneline", cwd=board_root)
    return len(result.stdout.strip().splitlines())


# A small standalone script, run as a subprocess, that opens
# `.git/index.lock`, holds the fd open for `hold_seconds`, and then either
# deletes the file itself (simulating a slow-but-successful git operation
# releasing its own lock) or leaves it behind (simulating a genuinely
# stuck/dead process, which this module must never clean up on someone
# else's behalf while it's still live).
_HOLD_LOCK_SCRIPT = """
import os, sys, time
path = sys.argv[1]
hold_seconds = float(sys.argv[2])
delete_after = sys.argv[3] == "1"
fh = open(path, "wb")
fh.write(b"fake index.lock, held by this test\\n")
fh.flush()
time.sleep(hold_seconds)
if delete_after:
    fh.close()
    try:
        os.remove(path)
    except OSError:
        pass
else:
    fh.close()
"""


def _spawn_lock_holder(lock_path: Path, hold_seconds: float, *, delete_after: bool) -> subprocess.Popen:
    proc = subprocess.Popen(
        [sys.executable, "-c", _HOLD_LOCK_SCRIPT, str(lock_path), str(hold_seconds), "1" if delete_after else "0"]
    )
    deadline = time.monotonic() + 5.0
    while not lock_path.exists():
        if time.monotonic() >= deadline:
            proc.kill()
            raise RuntimeError("lock holder subprocess never created the lock file")
        time.sleep(0.02)
    return proc


# ---------------------------------------------------------------------
# .git/index.lock: stale (no live holder) is removed, live is waited on
# and never removed.
# ---------------------------------------------------------------------


def test_stale_index_lock_with_no_holder_is_removed_and_commit_lands(tmp_path, caplog):
    board_root = _make_real_board_root(tmp_path)
    git_dir = board_root / ".git"
    lock_path = git_dir / "index.lock"
    lock_path.write_text("stale, abandoned by a commit that died mid-operation\n", encoding="utf-8")
    # Back-date it well past GIT_LOCK_STALE_SECONDS so the age check
    # alone would call it stale; _lock_holder_pids (nothing has this file
    # open) is what actually clears it for removal.
    old = time.time() - (backlog.GIT_LOCK_STALE_SECONDS + 60)
    os.utime(lock_path, (old, old))

    with caplog.at_level(logging.WARNING, logger="app.services.backlog"):
        item, committed = backlog.add_note(
            "A1", "note written behind a stale index.lock", actor="claude",
            todo_path=board_root / "TODO.md", repo_root=board_root,
        )

    assert committed is True
    assert not lock_path.exists(), "a stale, unheld .git/index.lock must be removed before the commit"
    assert any("removing stale .git/index.lock" in r.message for r in caplog.records), caplog.text
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "note written behind a stale index.lock" in saved
    log_result = _git("log", "-1", "--pretty=%s", cwd=board_root)
    assert "A1 note added by claude" in log_result.stdout


def test_live_index_lock_is_waited_on_and_commit_lands_once_it_clears(tmp_path, caplog):
    board_root = _make_real_board_root(tmp_path)
    lock_path = board_root / ".git" / "index.lock"
    # Holds the lock for 1.5s, well under the module's default
    # GIT_LOCK_WAIT_SECONDS (20s), then releases it itself — the "slow but
    # genuinely still running" case, which must be waited out, not torn
    # down.
    holder = _spawn_lock_holder(lock_path, hold_seconds=1.5, delete_after=True)
    try:
        started = time.monotonic()
        with caplog.at_level(logging.WARNING, logger="app.services.backlog"):
            item, committed = backlog.add_note(
                "A1", "note written behind a live index.lock", actor="claude",
                todo_path=board_root / "TODO.md", repo_root=board_root,
            )
        elapsed = time.monotonic() - started
    finally:
        holder.wait(timeout=10)

    assert committed is True
    # It really did wait for the holder rather than removing its lock out
    # from under it: the write cannot have landed before the holder let go.
    assert elapsed >= 1.0
    assert any("index.lock" in r.message and "held by pid" in r.message for r in caplog.records), caplog.text
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "note written behind a live index.lock" in saved


def test_live_index_lock_that_never_clears_is_never_removed_and_times_out_loudly(tmp_path, caplog):
    board_root = _make_real_board_root(tmp_path)
    lock_path = board_root / ".git" / "index.lock"
    # Held for far longer than the short max_wait below, and never
    # deletes the file itself — the "genuinely stuck" case. Calling
    # _wait_for_git_index_lock directly (rather than through a mutator)
    # so the test can pass a short max_wait/poll_interval without
    # depending on the module's real ~20s default, which is baked into
    # the function's own defaults at def-time and not something a
    # monkeypatched module attribute would reach.
    holder = _spawn_lock_holder(lock_path, hold_seconds=10.0, delete_after=False)
    try:
        with caplog.at_level(logging.WARNING, logger="app.services.backlog"):
            with pytest.raises(backlog._GitLockHeld) as excinfo:
                backlog._wait_for_git_index_lock(
                    board_root, stale_after=90.0, max_wait=1.0, poll_interval=0.1
                )
        assert "still present after waiting" in str(excinfo.value)
        assert "held by pid" in str(excinfo.value)
        # The actual safety property: a lock a live process holds is
        # NEVER removed, no matter how long it has existed or how long
        # this waited.
        assert lock_path.exists(), "a live-held .git/index.lock must never be removed out from under its holder"
    finally:
        holder.kill()
        holder.wait(timeout=10)


def test_git_commit_and_push_folds_a_timed_out_live_lock_into_committed_false(tmp_path, monkeypatch):
    """End to end through the real mutator path (not the direct
    _wait_for_git_index_lock unit test above): a live lock that never
    clears must make the whole write report committed=False, the same
    "saved but not committed" shape any other git failure produces,
    never an unhandled exception escaping a public mutator."""
    board_root = _make_real_board_root(tmp_path)
    lock_path = board_root / ".git" / "index.lock"
    holder = _spawn_lock_holder(lock_path, hold_seconds=10.0, delete_after=False)
    try:
        # Shrink the compiled-in defaults via the function's own
        # __defaults__ tuple (order: stale_after, max_wait, poll_interval)
        # so this test does not have to wait out the real ~20s ceiling;
        # monkeypatch restores the original tuple afterwards.
        monkeypatch.setattr(backlog._wait_for_git_index_lock, "__defaults__", (90.0, 1.0, 0.1))
        item, committed = backlog.add_note(
            "A1", "note that cannot land while the lock is stuck", actor="claude",
            todo_path=board_root / "TODO.md", repo_root=board_root,
        )
    finally:
        holder.kill()
        holder.wait(timeout=10)

    assert committed is False
    assert lock_path.exists()
    # The file write itself is never lost even though the commit failed.
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "note that cannot land while the lock is stuck" in saved


# ---------------------------------------------------------------------
# Loud failure: a saved-but-uncommitted write is a non-zero CLI exit with
# a clear message, not a footnote.
# ---------------------------------------------------------------------


def test_cli_commit_failure_is_a_loud_non_zero_exit_with_the_board_still_saved(tmp_path):
    """board_root here is deliberately NOT a git repo at all (no `git
    init`), the exact shape every scripts/backlog.py CLI test used before
    H93 — git add/commit genuinely fails (exit 128, not a git repository).
    Before H93 the CLI printed a footnote and exited 0 anyway; this is
    the regression test for the loud failure H93 requires instead."""
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(TODO_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_BACKLOG), "note", "A1", "a note that cannot be committed"],
        cwd=board_root, env=env, capture_output=True, text=True, timeout=30,
    )

    assert result.returncode == 1, (result.stdout, result.stderr)
    assert (
        "was written to TODO.md but the git commit/push failed; the board file and origin/main now disagree"
        in result.stderr
    )
    # The write itself is never lost even though the process exits non-zero.
    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "a note that cannot be committed" in saved


# ---------------------------------------------------------------------
# The board's own lock (.backlog.lock): bounded wait, contention logged,
# never removes a live holder's claim on the lock itself.
# ---------------------------------------------------------------------


def test_locked_reports_contention_and_waits_bounded_when_a_holder_never_releases(tmp_path, caplog):
    board_root = _make_real_board_root(tmp_path)
    lock_path = board_root / ".backlog.lock"

    import fcntl

    held_fh = open(lock_path, "a+")
    fcntl.flock(held_fh.fileno(), fcntl.LOCK_EX)
    try:
        started = time.monotonic()
        with caplog.at_level(logging.WARNING, logger="app.services.backlog"):
            with pytest.raises(backlog.BacklogError) as excinfo:
                with backlog._locked(board_root, timeout=1.0):
                    pass  # pragma: no cover - never entered, the lock is held
        elapsed = time.monotonic() - started
    finally:
        fcntl.flock(held_fh.fileno(), fcntl.LOCK_UN)
        held_fh.close()

    assert "could not acquire the board write lock" in str(excinfo.value)
    assert ".backlog.lock" in str(excinfo.value)
    # Bounded, not indefinite: it gave up close to the 1s timeout, not
    # instantly and not after a long hang.
    assert 0.9 <= elapsed <= 4.0
    assert any("held by another session, waiting up to" in r.message for r in caplog.records), caplog.text


def test_locked_succeeds_once_a_contended_holder_releases(tmp_path):
    board_root = _make_real_board_root(tmp_path)
    lock_path = board_root / ".backlog.lock"

    import fcntl

    held_fh = open(lock_path, "a+")
    fcntl.flock(held_fh.fileno(), fcntl.LOCK_EX)

    def _release_soon():
        time.sleep(0.5)
        fcntl.flock(held_fh.fileno(), fcntl.LOCK_UN)
        held_fh.close()

    import threading

    releaser = threading.Thread(target=_release_soon)
    releaser.start()
    try:
        entered = False
        with backlog._locked(board_root, timeout=5.0):
            entered = True
        assert entered
    finally:
        releaser.join(timeout=10)


# ---------------------------------------------------------------------
# Two concurrent writers: both land, as two separate commits, never one
# clobbering the other.
# ---------------------------------------------------------------------


def test_two_concurrent_cli_writers_both_land_as_two_separate_commits(tmp_path):
    board_root = _make_real_board_root(tmp_path)
    before = _commit_count(board_root)

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)

    def _launch(text: str) -> subprocess.Popen:
        return subprocess.Popen(
            [sys.executable, str(SCRIPTS_BACKLOG), "note", "A1", text],
            cwd=board_root, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )

    proc_a = _launch("note from writer A")
    proc_b = _launch("note from writer B")
    out_a, err_a = proc_a.communicate(timeout=30)
    out_b, err_b = proc_b.communicate(timeout=30)

    assert proc_a.returncode == 0, (out_a, err_a)
    assert proc_b.returncode == 0, (out_b, err_b)

    saved = (board_root / "TODO.md").read_text(encoding="utf-8")
    assert "note from writer A" in saved
    assert "note from writer B" in saved

    after = _commit_count(board_root)
    assert after == before + 2, "each writer's commit must land separately, never squashed or lost"
    # .backlog.lock must not be left held.
    lock_path = board_root / ".backlog.lock"
    if lock_path.exists():
        import fcntl

        probe = open(lock_path, "a+")
        try:
            fcntl.flock(probe.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(probe.fileno(), fcntl.LOCK_UN)
        finally:
            probe.close()
