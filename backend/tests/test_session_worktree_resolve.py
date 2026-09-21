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
    _seed_finish_stubs(seed)
    _git("add", "-A", cwd=seed)
    _git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init", cwd=seed)
    _git("remote", "add", "origin", str(origin), cwd=seed)
    _git("push", "-q", "origin", "main", cwd=seed)
    shutil.rmtree(seed)

    shared = tmp_path / "shared"
    _git("clone", "-q", str(origin), str(shared), cwd=tmp_path)
    return shared


# `cmd_finish` shells out to the backend suite, the pentest-evidence
# check, tsc and nine npm checks before it pushes. The fake shared tree
# seeds a stub for every one of them (and the stub python ignores its
# arguments), so a fixture can drive cmd_finish end to end with only the
# parts under test left real: the resolution, the push to the fake
# origin, and the board write. Without this, the one command that pushes
# is the one command no test exercises, which is how the errexit hole
# below survived a full round of review.
STUB_EXIT_0 = "#!/usr/bin/env bash\nexit 0\n"


def _seed_finish_stubs(seed: Path) -> None:
    (seed / "frontend").mkdir()
    (seed / "frontend" / ".gitkeep").write_text("", encoding="utf-8")
    (seed / "scripts").mkdir()
    (seed / "scripts" / "check_pentest_evidence.py").write_text("", encoding="utf-8")
    venv_bin = seed / "backend" / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    stub_python = venv_bin / "python"
    stub_python.write_text(STUB_EXIT_0, encoding="utf-8")
    stub_python.chmod(0o755)


def _make_tool_stubs(tmp_path: Path) -> Path:
    """npx / npm on PATH, exiting 0, for cmd_finish's frontend gate."""
    bindir = tmp_path / "stubbin"
    bindir.mkdir(exist_ok=True)
    for name in ("npx", "npm"):
        stub = bindir / name
        stub.write_text(STUB_EXIT_0, encoding="utf-8")
        stub.chmod(0o755)
    return bindir


def _origin_branches(tmp_path: Path) -> set:
    out = _git("for-each-ref", "--format=%(refname:short)", "refs/heads", cwd=tmp_path / "origin.git")
    return {line.strip() for line in out.splitlines() if line.strip()}


def _noisy_backlog_shim(tmp_path: Path) -> Path:
    """A backlog.py that writes to stderr and still succeeds. Capturing
    the board read with 2>&1 concatenated that noise ahead of the JSON
    and broke the parse; this codebase emits 351 warnings under pytest,
    so PYTHONWARNINGS or a future Python makes it live."""
    shim = tmp_path / "noisy_backlog.py"
    shim.write_text(
        "import runpy, sys\n"
        f"REAL = {str(BACKLOG_PY)!r}\n"
        "sys.stderr.write('DeprecationWarning: datetime.utcnow() is deprecated\\n')\n"
        "sys.argv[0] = REAL\n"
        "runpy.run_path(REAL, run_name='__main__')\n",
        encoding="utf-8",
    )
    return shim


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


# =====================================================================
# Coverage for the commands themselves, not just the resolver: cmd_
# abandon, --worktree, cmd_list and worktree_id_of_path. The first round
# of this item tested resolve_session_worktree only, and every defect
# review found afterwards lived in code these tests never executed.
# =====================================================================

CMD_DRIVER = """#!/usr/bin/env bash
set -uo pipefail
_SESSION_SH="$1"; shift
_FAKE_SHARED="$1"; shift
_FAKE_BACKLOG_PY="$1"; shift
_FAKE_VENV_PY="$1"; shift
_FAKE_WORKTREES="$1"; shift

source "$_SESSION_SH" "" >/dev/null

SHARED_TREE="$_FAKE_SHARED"
BACKLOG_PY="$_FAKE_BACKLOG_PY"
VENV_PY="$_FAKE_VENV_PY"
WORKTREES_ROOT="$_FAKE_WORKTREES"

"$@"
"""


def _run_cmd(
    tmp_path: Path,
    board_root: Path,
    shared_tree: Path,
    worktrees_root: Path,
    *argv: str,
    backlog_py: str | None = None,
    cwd: Path | None = None,
    extra_path: Path | None = None,
) -> subprocess.CompletedProcess:
    driver = tmp_path / "cmd_driver.sh"
    driver.write_text(CMD_DRIVER, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    env.pop("BACKLOG_AGENT", None)
    if extra_path is not None:
        env["PATH"] = f"{extra_path}{os.pathsep}{env['PATH']}"

    return subprocess.run(
        [
            "bash",
            str(driver),
            str(SESSION_SH),
            str(shared_tree),
            backlog_py or str(BACKLOG_PY),
            str(VENV_PY),
            str(worktrees_root),
            *argv,
        ],
        cwd=cwd or tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _show(board_root: Path, item_id: str) -> dict:
    import json

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    result = subprocess.run(
        [str(VENV_PY), str(BACKLOG_PY), "show", item_id],
        cwd=board_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


# ---------------------------------------------------------------------
# --worktree: the escape hatch must not become a foot-gun
# ---------------------------------------------------------------------


def test_abandon_worktree_rejects_a_path_that_escapes_the_root_with_dotdot(tmp_path, fixture_env):
    """`--worktree` guarded the path with a plain string prefix test, so
    <root>/worktrees/../elsewhere/precious passed it and was deleted,
    contents and branch and all. That shape is real on this host:
    /tmp/g70-review is reachable as /root/worktrees/../../tmp/g70-review."""
    board_root, shared_tree, worktrees_root = fixture_env
    worktrees_root.mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    precious = elsewhere / "precious"
    _git("worktree", "add", "-q", "-b", "feature-precious", str(precious), "main", cwd=shared_tree)
    (precious / "treasure.txt").write_text("do not delete", encoding="utf-8")

    traversal = str(worktrees_root / ".." / "elsewhere" / "precious")
    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G127", "--worktree", traversal)

    assert result.returncode != 0, result.stdout + result.stderr
    assert "not under" in result.stderr, result.stdout + result.stderr
    assert precious.is_dir(), "the traversal path was removed despite the guard"
    assert (precious / "treasure.txt").exists()


def test_abandon_worktree_does_not_reset_the_board_for_a_stale_duplicate(tmp_path, fixture_env):
    """Removing a stale duplicate is what --worktree is advertised for, by
    the usage text, BACKLOG.md and the refusal hint alike. Applied to a
    live item it used to also reset that item to todo, clear its recorded
    branch and write a note naming the wrong branch, i.e. corrupt exactly
    the item you were trying to unblock."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")
    stale = _add_worktree(shared_tree, worktrees_root, "feature-G127-upcoming-round3", "feature-G127-upcoming-round3")

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G127", "--worktree", str(stale))
    assert result.returncode == 0, result.stdout + result.stderr
    assert not stale.exists()

    data = _show(board_root, "G127")
    assert data["state"] == "in-progress", "the live item was reset by cleaning up a stale sibling"
    assert data["branch"] == "feature-G127-round3-fix"
    assert not any("upcoming-round3" in n["text"] for n in data["notes"]), data["notes"]


def test_abandon_worktree_still_resets_the_board_for_the_recorded_session(tmp_path, fixture_env):
    """The other half: when the named worktree IS the item's recorded
    session, --worktree behaves like a normal abandon."""
    board_root, shared_tree, worktrees_root = fixture_env
    live = _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G127", "--worktree", str(live))
    assert result.returncode == 0, result.stdout + result.stderr
    assert not live.exists()

    data = _show(board_root, "G127")
    assert data["state"] == "todo"


def test_abandon_worktree_without_a_value_explains_itself(tmp_path, fixture_env):
    """`shift 2` on a missing value exits 1 under set -e with nothing
    printed at all, which reads as a crash."""
    board_root, shared_tree, worktrees_root = fixture_env
    worktrees_root.mkdir()

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G127", "--worktree")
    assert result.returncode != 0
    assert "--worktree" in result.stderr, result.stdout + result.stderr


def test_abandon_resolved_path_resets_the_board_as_before(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    live = _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G127")
    assert result.returncode == 0, result.stdout + result.stderr
    assert not live.exists()
    assert _show(board_root, "G127")["state"] == "todo"


def test_abandon_removes_a_detached_worktree_and_notes_it_accurately(tmp_path, fixture_env):
    """A detached worktree was always removable (rev-parse --abbrev-ref
    prints HEAD and exits 0); what was wrong was the note claiming a
    branch called HEAD was discarded, and a pointless `git branch -D
    HEAD`."""
    board_root, shared_tree, worktrees_root = fixture_env
    path = _add_detached_worktree(shared_tree, worktrees_root, "feature-G128-detached")

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G128")
    assert result.returncode == 0, result.stdout + result.stderr
    assert not path.exists()

    data = _show(board_root, "G128")
    assert data["state"] == "todo"
    assert any("no branch checked out" in n["text"] for n in data["notes"]), data["notes"]
    assert not any("branch HEAD" in n["text"] for n in data["notes"]), data["notes"]


# ---------------------------------------------------------------------
# Resolution holes found on review
# ---------------------------------------------------------------------


def test_a_recorded_branch_belonging_to_another_item_is_refused(tmp_path):
    """Making the board unconditionally authoritative removed the one
    bound the old resolver did have: it could only ever pick a worktree
    whose NAME matched the id. A mistyped or copy-pasted branch tag would
    otherwise resolve to another item's live worktree, and finish would
    push that branch and mark this item in review against it.
    integrate.py already warns that recorded branches drift from their
    id, so this state occurs."""
    fixture = BOARD_FIXTURE.replace("[branch: feature-G127-round3-fix]", "[branch: feature-G999-someone-elses-work]")
    board_root = _make_board_root(tmp_path, fixture=fixture)
    shared_tree = _make_fake_shared_tree(tmp_path)
    worktrees_root = tmp_path / "worktrees"
    _add_worktree(shared_tree, worktrees_root, "feature-G999-someone-elses-work", "feature-G999-someone-elses-work")
    _add_worktree(shared_tree, worktrees_root, "feature-G127-mine", "feature-G127-mine")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode != 0, res.output
    assert "feature-G999-someone-elses-work" in res.stderr
    assert res.worktree != str(worktrees_root / "feature-G999-someone-elses-work")


def test_a_leftover_plain_directory_does_not_create_ambiguity(tmp_path, fixture_env):
    """An rm -rf'd or half-pruned worktree leaves a plain directory. It is
    not a worktree, so it must not make the id ambiguous: it used to
    trigger "2 worktrees match its id", and the --worktree escape the
    refusal recommends cannot clear it either (git worktree remove says
    "is not a working tree")."""
    board_root, shared_tree, worktrees_root = fixture_env
    live = _add_worktree(shared_tree, worktrees_root, "feature-G128-live", "feature-G128-live")
    (worktrees_root / "feature-G128-stale-leftover").mkdir()

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G128")
    assert res.returncode == 0, res.output
    assert res.worktree == str(live)


def test_a_prunable_worktree_is_refused_not_resolved_to_a_missing_path(tmp_path, fixture_env):
    """git still lists a worktree whose directory was deleted until
    someone prunes. Resolving to it returned a path that does not exist,
    and finish then died on a raw git error."""
    board_root, shared_tree, worktrees_root = fixture_env
    path = _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")
    shutil.rmtree(path)

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode != 0, res.output
    assert "prune" in res.stderr, res.output
    assert res.worktree != str(path)


def test_an_unreadable_board_is_fatal_rather_than_silently_name_matching(tmp_path, fixture_env):
    """If `backlog.py show` fails at runtime, treating that as "no branch
    recorded" silently downgrades the board-is-authority rule back to a
    worktree-name match, which is the pre-H85 bug."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-upcoming-round3", "feature-G127-upcoming-round3")

    driver = tmp_path / "cmd_driver.sh"
    driver.write_text(CMD_DRIVER, encoding="utf-8")
    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    env.pop("BACKLOG_AGENT", None)
    result = subprocess.run(
        [
            "bash",
            str(driver),
            str(SESSION_SH),
            str(shared_tree),
            str(tmp_path / "no-such-backlog.py"),
            str(VENV_PY),
            str(worktrees_root),
            "resolve_session_worktree",
            "G127",
            "finish",
        ],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0, result.stdout + result.stderr
    assert "board" in result.stderr.lower(), result.stdout + result.stderr
    assert str(worktrees_root / "feature-G127-upcoming-round3") not in result.stdout


# ---------------------------------------------------------------------
# list
# ---------------------------------------------------------------------


def test_list_warns_about_duplicate_ids_entirely_on_stderr(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G128-a", "feature-G128-a")
    _add_worktree(shared_tree, worktrees_root, "feature-G128-b", "feature-G128-b")

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_list")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "G128 has more than one worktree" in result.stderr
    # stdout stays the plain worktree table: one line per worktree, no
    # blank separator lines orphaned from the warning they belong to.
    assert all(line.strip() for line in result.stdout.splitlines()), repr(result.stdout)
    assert len(result.stdout.splitlines()) == 2, repr(result.stdout)


def test_worktree_id_of_path_only_claims_real_ids(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    worktrees_root.mkdir()
    cases = {
        "/root/worktrees/feature-G127-round3-fix": "G127",
        "/root/worktrees/feature-H85": "H85",
        "/root/worktrees/item-G127-old-naming": "G127",
        "/root/worktrees/feature-G1287-other": "G1287",
        "/root/worktrees/story-preview-qa": "",
        "/root/worktrees/feature-notanid": "",
    }
    for path, expected in cases.items():
        result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "worktree_id_of_path", path)
        assert result.returncode == 0, result.stderr
        assert result.stdout == expected, f"{path} -> {result.stdout!r}, expected {expected!r}"


# ---------------------------------------------------------------------
# cmd_finish: the one command that pushes. Driven end to end against a
# fake origin, with every gate step stubbed out, so what is asserted is
# which branch actually landed on the remote and what the board recorded.
# ---------------------------------------------------------------------


def _finish(tmp_path, board_root, shared_tree, worktrees_root, item_id, *extra):
    return _run_cmd(
        tmp_path,
        board_root,
        shared_tree,
        worktrees_root,
        "cmd_finish",
        item_id,
        *extra,
        extra_path=_make_tool_stubs(tmp_path),
    )


def test_finish_pushes_the_branch_the_board_records_not_the_stale_sibling(tmp_path, fixture_env):
    """The 2026-09-18 incident, all the way through the command that
    caused it: two worktrees for G127, and the branch that reaches the
    remote must be the one the board records, never the stale sibling
    that had already been rejected."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-upcoming-round3", "feature-G127-upcoming-round3")
    _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    result = _finish(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "resolved item G127" in result.stdout
    assert "branch:        feature-G127-round3-fix" in result.stdout

    pushed = _origin_branches(tmp_path)
    assert "feature-G127-round3-fix" in pushed
    assert "feature-G127-upcoming-round3" not in pushed, "pushed the stale sibling"

    data = _show(board_root, "G127")
    assert data["state"] == "review"
    assert data["branch"] == "feature-G127-round3-fix"


def test_finish_pushes_nothing_when_the_board_cannot_be_read(tmp_path, fixture_env):
    """recorded_branch_for_id returning 1 must actually stop finish.
    `resolved="$(resolve_session_worktree ...)" || exit 1` suppresses
    errexit inside the command substitution, so the refusal was printed
    and then ignored: finish ran the gate and pushed a branch picked by
    name, which is the pre-H85 bug wearing a refusal message. One missing
    docs/compliance file makes backlog.py show fail for every id, so this
    is not a typo-only path."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-upcoming-round3", "feature-G127-upcoming-round3")

    result = _run_cmd(
        tmp_path,
        board_root,
        shared_tree,
        worktrees_root,
        "cmd_finish",
        "G127",
        backlog_py=str(tmp_path / "no-such-backlog.py"),
        extra_path=_make_tool_stubs(tmp_path),
    )
    assert result.returncode != 0, result.stdout + result.stderr
    assert "refusing to continue" in result.stderr, result.stdout + result.stderr
    assert "resolved item G127" not in result.stdout, "printed a resolution after refusing"
    assert _origin_branches(tmp_path) == {"main"}, "pushed despite refusing to continue"


def test_finish_pushes_nothing_when_no_worktree_is_on_the_recorded_branch(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-upcoming-round3", "feature-G127-upcoming-round3")

    result = _finish(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert result.returncode != 0, result.stdout + result.stderr
    assert _origin_branches(tmp_path) == {"main"}
    assert _show(board_root, "G127")["state"] == "in-progress"


def test_finish_pushes_nothing_when_two_worktrees_match_and_no_branch_is_recorded(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G128-a", "feature-G128-a")
    _add_worktree(shared_tree, worktrees_root, "feature-G128-b", "feature-G128-b")

    result = _finish(tmp_path, board_root, shared_tree, worktrees_root, "G128")
    assert result.returncode != 0, result.stdout + result.stderr
    assert _origin_branches(tmp_path) == {"main"}
    assert _show(board_root, "G128")["state"] == "in-progress"


def test_finish_works_for_an_item_with_no_branch_recorded_and_one_worktree(tmp_path, fixture_env):
    """The post-approve shape must still be finishable."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G128-fold-in", "feature-G128-fold-in")

    result = _finish(tmp_path, board_root, shared_tree, worktrees_root, "G128")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "board records: (none yet; matched by worktree name)" in result.stdout
    assert "feature-G128-fold-in" in _origin_branches(tmp_path)
    assert _show(board_root, "G128")["branch"] == "feature-G128-fold-in"


def test_finish_survives_stderr_noise_from_a_successful_board_read(tmp_path, fixture_env):
    """Capturing the board read with 2>&1 put stderr ahead of the JSON and
    broke the parse, which combined with the errexit hole degrades to a
    name match rather than a refusal."""
    board_root, shared_tree, worktrees_root = fixture_env
    _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    result = _run_cmd(
        tmp_path,
        board_root,
        shared_tree,
        worktrees_root,
        "cmd_finish",
        "G127",
        backlog_py=str(_noisy_backlog_shim(tmp_path)),
        extra_path=_make_tool_stubs(tmp_path),
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "could not parse" not in result.stderr, result.stdout + result.stderr
    assert "feature-G127-round3-fix" in _origin_branches(tmp_path)


# ---------------------------------------------------------------------
# The other two board-protection clauses (only branch != board_branch
# was pinned; deleting either of the others left the suite green).
# ---------------------------------------------------------------------


def test_abandon_worktree_leaves_the_board_alone_when_no_branch_is_recorded(tmp_path, fixture_env):
    """G128 records no branch, so nothing confirms this worktree is its
    session even though it is the only one. Removing it must not reset
    the item; the exact command to do that deliberately is printed."""
    board_root, shared_tree, worktrees_root = fixture_env
    only = _add_worktree(shared_tree, worktrees_root, "feature-G128-fold-in", "feature-G128-fold-in")

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, "cmd_abandon", "G128", "--worktree", str(only))
    assert result.returncode == 0, result.stdout + result.stderr
    assert not only.exists()
    assert "records no branch" in result.stdout, result.stdout + result.stderr
    assert "backlog.py todo G128" in result.stdout

    data = _show(board_root, "G128")
    assert data["state"] == "in-progress"
    assert data["notes"] == []


def test_abandon_worktree_leaves_the_board_alone_when_the_board_cannot_be_read(tmp_path, fixture_env):
    board_root, shared_tree, worktrees_root = fixture_env
    only = _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    result = _run_cmd(
        tmp_path,
        board_root,
        shared_tree,
        worktrees_root,
        "cmd_abandon",
        "G127",
        "--worktree",
        str(only),
        backlog_py=str(tmp_path / "no-such-backlog.py"),
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert not only.exists()
    assert "the board will not be touched" in result.stderr, result.stdout + result.stderr
    # Pins the `-z "$board_readable"` clause specifically: the
    # `-z "$board_branch"` clause below it would also skip the board
    # here (the fallback blanks board_branch), so only the reason it
    # gives distinguishes them.
    assert "leaving the board alone: the board could not be read" in result.stdout, result.stdout

    data = _show(board_root, "G127")
    assert data["state"] == "in-progress"
    assert data["branch"] == "feature-G127-round3-fix"
    assert data["notes"] == []


def test_abandon_worktree_accepts_a_relative_path(tmp_path, fixture_env):
    """--worktree was normalised for the guard but acted on raw, so a
    relative path passed every check against the caller's cwd and then
    died on "is not a working tree" inside the shared tree."""
    board_root, shared_tree, worktrees_root = fixture_env
    live = _add_worktree(shared_tree, worktrees_root, "feature-G127-round3-fix", "feature-G127-round3-fix")

    result = _run_cmd(
        tmp_path,
        board_root,
        shared_tree,
        worktrees_root,
        "cmd_abandon",
        "G127",
        "--worktree",
        "./feature-G127-round3-fix",
        cwd=worktrees_root,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert not live.exists()
    assert "is not a working tree" not in result.stderr


def test_no_stray_realpath_error_on_the_foreign_branch_warning_path(tmp_path):
    """path_is_one_of expanded an empty candidate array to one empty
    argument, leaking `realpath: '': No such file or directory` onto the
    path that most warrants careful reading."""
    fixture = BOARD_FIXTURE.replace("[branch: feature-G127-round3-fix]", "[branch: oddly-named-branch]")
    board_root = _make_board_root(tmp_path, fixture=fixture)
    shared_tree = _make_fake_shared_tree(tmp_path)
    worktrees_root = tmp_path / "worktrees"
    _add_worktree(shared_tree, worktrees_root, "oddly-named", "oddly-named-branch")

    res = _resolve(tmp_path, board_root, shared_tree, worktrees_root, "G127")
    assert res.returncode == 0, res.output
    # Matched precisely: pytest's tmp_path embeds this test's own name,
    # so a bare "realpath" substring check matches the directory itself.
    assert "realpath: ''" not in res.stderr, res.stderr
    assert "No such file or directory" not in res.stderr, res.stderr
    assert "Check it is really yours" in res.stderr
