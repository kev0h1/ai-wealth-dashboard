"""End-to-end test for `scripts/session.sh start`'s venv-import diagnostic
(item H89).

`cmd_start` links a freshly created worktree's `backend/.venv` to the
shared tree's, then runs `import app` inside it as a sanity check. Before
this fix, that check was a bare `resolved="$(...)"` assignment -- a
context where `set -e` (errexit) DOES fire under this script's `set -euo
pipefail` -- so a genuinely failing import (a broken venv, an
ImportError, a syntax error reachable on the path) killed `cmd_start`
right there, before the `err` block written just below it ever ran. The
session saw a bare non-zero exit with no indication the worktree's venv
was the problem, the opposite of what that check was written to do (see
the sibling "resolves outside the worktree" branch, which has always
been a non-fatal warning that never exits).

This is the inverse of item H85's bug in the same file (see
`test_session_worktree_resolve.py`): there, errexit was suppressed
inside a command substitution whose assignment status the caller did
test, so a refusal never propagated; here it propagates too eagerly and
swallows the diagnosis instead.

Follows `test_session_start_guard.py`'s harness (a disposable bare-repo
"origin" plus a clone as the fake shared tree, driven by a small bash
script that sources the real `scripts/session.sh` and calls `cmd_start`
directly), but -- unlike that file's own `_make_fake_shared_tree`, which
deliberately omits `backend/` so cmd_start's venv-import-check code path
is never reached -- this one tracks a `backend/` directory in the seed
commit and drops a stub `.venv/bin/python` into the shared clone, so a
real worktree is created with a real (fake) `.venv` symlink and the
buggy line actually runs.
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

GUARD_FIXTURE = """# Backlog fixture for session.sh start venv-import tests (H89)

## H. Section H heading

- [ ] **H1. Todo item ready to start.** [owner: claude] Nothing special.
"""

pytestmark = pytest.mark.skipif(not VENV_PY.exists(), reason="backend/.venv not present in this checkout")

# A stub `.venv/bin/python` that fails exactly the way a broken venv does:
# `import app` raises, with a real (if fake) traceback on stderr, and a
# non-zero exit -- the shape session.sh's own comment (H89) names as the
# thing that used to kill cmd_start silently.
BROKEN_IMPORT_STUB = (
    "#!/usr/bin/env bash\n"
    'echo \'Traceback (most recent call last):\' >&2\n'
    'echo \'  File "<string>", line 1, in <module>\' >&2\n'
    "echo \"ModuleNotFoundError: No module named 'app'\" >&2\n"
    "exit 1\n"
)

# A stub that succeeds, printing a path under the worktree itself (the
# check's own success case: `import app; print(app.__file__)` -- the stub
# is invoked with `cwd` already `$worktree_dir/backend`, so `$(pwd)`
# resolves inside the worktree, same as a real resolved import would).
WORKING_IMPORT_STUB = (
    "#!/usr/bin/env bash\n"
    'echo "$(pwd)/app/__init__.py"\n'
    "exit 0\n"
)


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _init_board_git_repo(board_root: Path) -> None:
    """Wires `board_root` (BACKLOG_ROOT) as a real, pushable git repo
    (H93): `scripts/backlog.py` now exits non-zero when the board's git
    commit or push fails, and before this fixture had a real repo,
    `board_root` here was never one at all, so every write that reached
    the commit step genuinely failed (exit 128, not a git repo), just
    silently, since nothing in this file asserted on that outcome --
    exactly the class of bug H93 itself closes. See the identically named
    helper in test_session_worktree_resolve.py, which this mirrors."""
    origin = board_root.parent / (board_root.name + "-origin.git")
    _git("init", "--bare", "-q", "-b", "main", str(origin), cwd=board_root.parent)
    _git("init", "-q", "-b", "main", cwd=board_root)
    _git("-c", "user.email=test@example.com", "-c", "user.name=Test", "add", "-A", cwd=board_root)
    _git(
        "-c", "user.email=test@example.com", "-c", "user.name=Test",
        "commit", "-q", "-m", "init", cwd=board_root,
    )
    _git("remote", "add", "origin", str(origin), cwd=board_root)
    _git("push", "-q", "-u", "origin", "main", cwd=board_root)


def _make_board_root(tmp_path: Path) -> Path:
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(GUARD_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    _init_board_git_repo(board_root)
    return board_root


def _make_fake_shared_tree_with_backend(tmp_path: Path, python_stub: str) -> Path:
    """Unlike test_session_start_guard.py's `_make_fake_shared_tree`, this
    tracks a `backend/` directory in the seed commit (so `git worktree add`
    creates one in the new worktree, satisfying cmd_start's `[[ -d
    "$worktree_dir/backend" ]]` guard) and drops a stub `.venv/bin/python`
    directly into the shared clone -- untracked, exactly like the real
    `backend/.venv` is untracked and merely present on disk -- so
    `ln -s "$SHARED_TREE/backend/.venv" ...` and the subsequent import
    check both have something real to run against."""
    origin = tmp_path / "origin.git"
    _git("init", "--bare", "-q", "-b", "main", str(origin), cwd=tmp_path)

    seed = tmp_path / "seed"
    seed.mkdir()
    _git("init", "-q", "-b", "main", cwd=seed)
    (seed / ".gitkeep").write_text("", encoding="utf-8")
    (seed / "backend").mkdir()
    (seed / "backend" / ".gitkeep").write_text("", encoding="utf-8")
    _git("add", "-A", cwd=seed)
    _git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init", cwd=seed)
    _git("remote", "add", "origin", str(origin), cwd=seed)
    _git("push", "-q", "origin", "main", cwd=seed)
    shutil.rmtree(seed)

    shared = tmp_path / "shared"
    _git("clone", "-q", str(origin), str(shared), cwd=tmp_path)

    venv_bin = shared / "backend" / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    stub_python = venv_bin / "python"
    stub_python.write_text(python_stub, encoding="utf-8")
    stub_python.chmod(0o755)

    return shared


def _run_start(tmp_path: Path, board_root: Path, shared_tree: Path, *args: str) -> subprocess.CompletedProcess:
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


def test_broken_venv_import_prints_the_real_error_and_a_hint_instead_of_a_bare_exit(tmp_path):
    """The H89 case: a worktree whose `.venv` genuinely can't `import app`
    (broken venv, ImportError, syntax error -- anything that makes the
    check itself fail rather than merely resolve to the wrong tree). Before
    the fix, this killed cmd_start via errexit with no diagnostic at all;
    now the real traceback and a one-line hint must reach stderr, and --
    matching the sibling "resolves outside the worktree" branch, which has
    always been a non-fatal warning -- the session must still finish and
    the item must still land in-progress with a real worktree, since a
    broken venv is a fixable follow-up, not a reason to discard the whole
    session."""
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree_with_backend(tmp_path, BROKEN_IMPORT_STUB)

    result = _run_start(tmp_path, board_root, shared_tree, "H1")

    # The underlying error text must reach the user -- this is the actual
    # regression: before the fix, none of this printed at all.
    assert "venv import check FAILED" in result.stderr
    assert "ModuleNotFoundError: No module named 'app'" in result.stderr
    assert "Traceback (most recent call last):" in result.stderr
    # A one-line hint, not just a raw traceback dump.
    assert "broken or missing backend/.venv" in result.stderr

    # Matching the sibling wrong-tree-resolution branch (which has always
    # been non-fatal): the session still completes and the item still
    # lands in-progress with a real worktree, rather than being silently
    # discarded the way the pre-fix errexit abort left it.
    assert result.returncode == 0, result.stdout + result.stderr
    assert "finish with: scripts/session.sh finish H1" in result.stdout
    worktree_dir = tmp_path / "worktrees" / "feature-H1-todo-item-ready-to"
    assert worktree_dir.is_dir()
    data = _show(board_root, "H1")
    assert data["state"] == "in-progress"


def test_working_venv_import_still_reports_ok_with_no_warning(tmp_path):
    """Sanity/positive control for the fixture itself: a working stub must
    still hit the existing "venv import check ok" log line with no FAILED
    warning, proving the broken-stub test above is exercising the failure
    path specifically, not a fixture that always warns."""
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree_with_backend(tmp_path, WORKING_IMPORT_STUB)

    result = _run_start(tmp_path, board_root, shared_tree, "H1")

    assert result.returncode == 0, result.stdout + result.stderr
    assert "venv import check ok" in result.stdout
    assert "venv import check FAILED" not in result.stdout
    assert "venv import check FAILED" not in result.stderr
