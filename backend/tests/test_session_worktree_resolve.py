"""End-to-end tests for `scripts/session.sh`'s worktree resolution (item H85).

Resolving "which worktree is item <ID>?" used to be a single
`find ... | head -1`: it globbed worktree names, took whatever the
filesystem happened to list first, and never looked at the branch the
board already records.

On 2026-09-18 that picked a stale, never-cleaned worktree for G127
(`feature-G127-upcoming-round3`, sitting at a commit that had been
REJECTED on review) over the live one (`feature-G127-round3-fix`).
`finish` pushed the rejected branch and marked the item `review` against
it; the next integrate pass would have merged rejected code into `main`
and UAT while the board read as a clean review. The agent only noticed
because it knew its own fix could not exist on that branch.

These tests reproduce exactly that condition (two worktrees matching one
id) and assert the resolver either produces the one right answer or
refuses. They follow `backend/tests/test_session_start_guard.py`: each
test builds its own throwaway "shared tree" (a local bare repo as a fake
`origin` plus a clone of it) and its own worktrees root under `tmp_path`,
then drives the *real* function bodies from `scripts/session.sh` through
a small bash driver that sources the script and reassigns its
`SHARED_TREE` / `BACKLOG_PY` / `VENV_PY` / `WORKTREES_ROOT` globals.
Nothing here ever touches `/root/ai-wealth-dashboard`, `/root/worktrees`
or the real board.

Re-running the original failure
-------------------------------
Set `SESSION_SH_UNDER_TEST` to a pre-H85 copy of the script and these
tests go red on the ambiguous cases, showing the actual bug rather than a
missing function:

    git show <pre-H85-sha>:scripts/session.sh > /tmp/old-session.sh
    SESSION_SH_UNDER_TEST=/tmp/old-session.sh \\
      backend/.venv/bin/python -m pytest backend/tests/test_session_worktree_resolve.py

The driver falls back to the old `find_worktree_for_id` (id only, first
name match, board ignored) when the H85 `resolve_session_worktree` is not
defined, which is what makes that run meaningful.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION_SH = Path(os.environ.get("SESSION_SH_UNDER_TEST") or (REPO_ROOT / "scripts" / "session.sh"))
BACKLOG_PY = REPO_ROOT / "scripts" / "backlog.py"
VENV_PY = REPO_ROOT / "backend" / ".venv" / "bin" / "python"

COMPLIANCE_FIXTURE = """# Fixture compliance doc

## Q1 Start date

Status: ready

```text
2026-10-01
```
"""

# The 2026-09-18 shape: one item, one branch recorded on the board, and
# (in the tests that create it) more than one worktree on disk matching
# its id.
BOARD_FIXTURE = """# Backlog fixture for session.sh worktree-resolution tests (H85)

## G. Section G heading

- [ ] **G127. Item with a branch recorded.** [owner: claude] [state: in-progress] [branch: feature-G127-round3-fix] A session is live on it.
- [ ] **G128. Item with no branch recorded.** [owner: claude] [state: in-progress] Approved from a uat round (H31); no branch yet.
"""

pytestmark = pytest.mark.skipif(not VENV_PY.exists(), reason="backend/.venv not present in this checkout")


def _git(*args: str, cwd: Path) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)
    return result.stdout


def _make_board_root(tmp_path: Path, fixture: str = BOARD_FIXTURE) -> Path:
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(fixture, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    return board_root


def _make_fake_shared_tree(tmp_path: Path) -> Path:
    """A disposable stand-in for /root/ai-wealth-dashboard: a bare repo as
    `origin` plus a clone of it, so worktrees and pushes behave for real."""
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


def _add_worktree(shared: Path, worktrees_root: Path, name: str, branch: str) -> Path:
    worktrees_root.mkdir(parents=True, exist_ok=True)
    path = worktrees_root / name
    _git("worktree", "add", "-q", "-b", branch, str(path), "main", cwd=shared)
    return path


def _add_detached_worktree(shared: Path, worktrees_root: Path, name: str) -> Path:
    worktrees_root.mkdir(parents=True, exist_ok=True)
    path = worktrees_root / name
    _git("worktree", "add", "-q", "--detach", str(path), "main", cwd=shared)
    return path


DRIVER = """#!/usr/bin/env bash
set -uo pipefail
_SESSION_SH="$1"; shift
_FAKE_SHARED="$1"; shift
_FAKE_BACKLOG_PY="$1"; shift
_FAKE_VENV_PY="$1"; shift
_FAKE_WORKTREES="$1"; shift

# Sourced with no command: runs main "" once, which prints usage and
# returns (does not exit), leaving the real function bodies defined here.
# Its output is discarded so this driver's stdout is the resolver's alone.
source "$_SESSION_SH" "" >/dev/null

SHARED_TREE="$_FAKE_SHARED"
BACKLOG_PY="$_FAKE_BACKLOG_PY"
VENV_PY="$_FAKE_VENV_PY"
WORKTREES_ROOT="$_FAKE_WORKTREES"

if declare -F resolve_session_worktree >/dev/null; then
  resolve_session_worktree "$@"
else
  # Pre-H85 session.sh: the old resolver took an id only, printed the
  # first `find` hit, and never consulted the board. Kept so this test
  # can be pointed at an old copy via SESSION_SH_UNDER_TEST and show the
  # original failure instead of a missing-function error.
  find_worktree_for_id "$1"
fi
"""


class Resolution:
    def __init__(self, proc: subprocess.CompletedProcess):
        self.proc = proc
        self.returncode = proc.returncode
        self.stdout = proc.stdout
        self.stderr = proc.stderr
        lines = [line for line in proc.stdout.splitlines() if line.strip()]
        parts = lines[-1].split("\t") if lines else []
        self.worktree = parts[0] if parts else ""
        self.branch = parts[1] if len(parts) > 1 else ""
        self.board_branch = parts[2] if len(parts) > 2 else ""

    @property
    def output(self) -> str:
        return self.stdout + self.stderr


def _resolve(tmp_path: Path, board_root: Path, shared_tree: Path, worktrees_root: Path, item_id: str, verb: str = "finish") -> Resolution:
    driver = tmp_path / "resolve_driver.sh"
    driver.write_text(DRIVER, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    env.pop("BACKLOG_AGENT", None)

    proc = subprocess.run(
        [
            "bash",
            str(driver),
            str(SESSION_SH),
            str(shared_tree),
            str(BACKLOG_PY),
            str(VENV_PY),
            str(worktrees_root),
            item_id,
            verb,
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return Resolution(proc)


@pytest.fixture()
def fixture_env(tmp_path):
    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path)
    worktrees_root = tmp_path / "worktrees"
    return board_root, shared_tree, worktrees_root


# ---------------------------------------------------------------------
# The 2026-09-18 G127 failure itself: two worktrees, one id.
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "recorded, stale",
    [
        ("feature-G127-round3-fix", "feature-G127-upcoming-round3"),
        ("feature-G127-upcoming-round3", "feature-G127-round3-fix"),
    ],
)
def test_two_worktrees_for_one_id_resolve_to_the_branch_the_board_records(tmp_path, recorded, stale):
    """Both orderings are exercised because the old resolver returned a
    fixed first `find` hit: whichever of the two the filesystem happens to
    list first, one of these parametrisations must go red against pre-H85
    code. Neither may ever resolve to the branch the board does not
    record."""
    fixture = BOARD_FIXTURE.replace("[branch: feature-G127-round3-fix]", f"[branch: {recorded}]")
    board_root = _make_board_root(tmp_path, fixture=fixture)
    shared_tree = _make_fake_shared_tree(tmp_path)
    worktrees_root = tmp_path / "worktrees"

    _add_worktree(shared_tree, worktrees_root, stale, stale)
    _add_worktree(shared_tree, worktrees_root, recorded, recorded)

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode == 0, res.output
    assert res.worktree == str(worktrees_root / recorded), res.output
    assert res.branch == recorded, res.output
    assert res.board_branch == recorded, res.output


def test_two_worktrees_with_no_branch_recorded_are_refused_not_guessed(tmp_path, fixture_env):
    """G128 has no branch recorded (the legitimate post-`approve` shape).
    With two worktrees matching its id there is no authority to choose
    between them, so the resolver must refuse and list them rather than
    pick one."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G128-first", "feature-G128-first")
    _add_worktree(shared_tree, worktrees_root, "feature-G128-second", "feature-G128-second")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G128")
    assert res.returncode != 0, res.output
    assert "2 worktrees" in res.stderr, res.output
    assert str(worktrees_root / "feature-G128-first") in res.stderr
    assert str(worktrees_root / "feature-G128-second") in res.stderr
    assert "refusing to guess" in res.stderr


# ---------------------------------------------------------------------
# Single-worktree cases
# ---------------------------------------------------------------------


def test_single_worktree_on_the_recorded_branch_resolves(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode == 0, res.output
    assert res.worktree == str(worktrees_root / "feature-G127-round3-fix")
    assert res.branch == "feature-G127-round3-fix"
    assert res.board_branch == "feature-G127-round3-fix"


def test_single_worktree_on_the_wrong_branch_is_refused(tmp_path, fixture_env):
    """The narrow version of the incident: the live worktree is gone and
    only the stale one is left. Its name still matches the id, so the old
    resolver returned it happily. It is not the branch the board records,
    so it must be refused, loudly."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-upcoming-round3", "feature-G127-upcoming-round3")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode != 0, res.output
    assert "feature-G127-round3-fix" in res.stderr
    assert "no worktree has that branch checked out" in res.stderr
    assert "feature-G127-upcoming-round3" in res.stderr
    assert res.worktree != str(worktrees_root / "feature-G127-upcoming-round3")


def test_single_worktree_with_no_branch_recorded_resolves(tmp_path, fixture_env):
    """An item with no branch recorded is legitimate (`approve` leaves one
    in exactly that shape, and `start` records a branch only after it has
    created the worktree). One name match, nothing to disambiguate: use
    it."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G128-fold-in", "feature-G128-fold-in")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G128")
    assert res.returncode == 0, res.output
    assert res.worktree == str(worktrees_root / "feature-G128-fold-in")
    assert res.branch == "feature-G128-fold-in"
    assert res.board_branch == ""


def test_no_worktree_at_all_is_reported_clearly(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    worktrees_root.mkdir()

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode != 0, res.output
    assert "no worktree" in res.stderr.lower()
    assert "G127" in res.stderr


# ---------------------------------------------------------------------
# Compatibility and edge cases the fix must not break
# ---------------------------------------------------------------------


def test_old_item_named_worktree_is_still_found(tmp_path, fixture_env):
    """Worktrees created before the feature-<ID>[-slug] convention are
    named item-<ID>-<slug>; `list`/`abandon` deliberately still recognise
    them so they can be cleaned up."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "item-G128-old-naming", "item/G128-old-naming")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G128", verb="abandon")
    assert res.returncode == 0, res.output
    assert res.worktree == str(worktrees_root / "item-G128-old-naming")
    assert res.branch == "item/G128-old-naming"


def test_old_item_named_worktree_resolves_via_a_recorded_old_branch(tmp_path):
    """The same old worktree, but with its old-style branch recorded on
    the board: resolution is by branch, so the naming is irrelevant."""
    fixture = BOARD_FIXTURE.replace("[branch: feature-G127-round3-fix]", "[branch: item/G127-old-naming]")
    board_root = _make_board_root(tmp_path, fixture=fixture)
    shared_tree = _make_fake_shared_tree(tmp_path)
    worktrees_root = tmp_path / "worktrees"
    _add_worktree(shared_tree, worktrees_root, "item-G127-old-naming", "item/G127-old-naming")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127", verb="abandon")
    assert res.returncode == 0, res.output
    assert res.worktree == str(worktrees_root / "item-G127-old-naming")
    assert res.branch == "item/G127-old-naming"


def test_resolves_when_the_remote_branch_has_been_deleted(tmp_path, fixture_env):
    """The aftermath of the very incident this fixes: integrate merged and
    deleted the branch on the remote, but the local branch and its
    worktree are still there. Resolution is local, so this must still
    work (finish would simply re-push it)."""
    board_root, shared_tree, worktrees_root = fixture_env
    path = _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")
    _git("push", "-q", "-u", "origin", "feature-G127-round3-fix", cwd=path)
    _git("push", "-q", "origin", "--delete", "feature-G127-round3-fix", cwd=path)

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode == 0, res.output
    assert res.worktree == str(path)
    assert res.branch == "feature-G127-round3-fix"


def test_detached_worktree_is_refused_when_a_branch_is_recorded(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    _add_detached_worktree(shared_tree, worktrees_root, "feature-G127-detached")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode != 0, res.output
    assert "no worktree has that branch checked out" in res.stderr
    assert "detached" in res.stderr.lower()


def test_detached_worktree_is_resolvable_when_no_branch_is_recorded(tmp_path, fixture_env):
    """`abandon` must still be able to clean up a worktree whose branch is
    gone or was never recorded, otherwise a stuck session cannot tidy
    itself. The branch field comes back empty and the caller decides."""
    board_root, shared_tree, worktrees_root = fixture_env
    path = _add_detached_worktree(shared_tree, worktrees_root, "feature-G128-detached")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G128", verb="abandon")
    assert res.returncode == 0, res.output
    assert res.worktree == str(path)
    assert res.branch == ""


def test_branch_checked_out_outside_the_worktrees_root_is_refused(tmp_path):
    """If the board records a branch that is checked out in the shared
    tree itself (or a scratch clone), resolving to it would have `finish`
    push, and `abandon` delete, the shared tree. Refuse."""
    fixture = BOARD_FIXTURE.replace("[branch: feature-G127-round3-fix]", "[branch: main]")
    board_root = _make_board_root(tmp_path, fixture=fixture)
    shared_tree = _make_fake_shared_tree(tmp_path)
    worktrees_root = tmp_path / "worktrees"
    worktrees_root.mkdir()

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode != 0, res.output
    assert "not under" in res.stderr
    assert str(shared_tree) in res.stderr


def test_ids_do_not_prefix_match_each_other(tmp_path, fixture_env):
    """G12's worktree must never be resolved for G127 or vice versa; the
    name match is anchored on the whole id."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G1287-other", "feature-G1287-other")
    _add_worktree(shared_tree, worktrees_root, "feature-G128", "feature-G128")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G128", verb="abandon")
    assert res.returncode == 0, res.output
    assert res.worktree == str(worktrees_root / "feature-G128")
