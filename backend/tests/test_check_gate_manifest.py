"""H83: `scripts/session.sh finish` used to run a hand-maintained list of
`npm run -s check:*` calls that drifted from frontend/package.json's own
`check:*` scripts every time a new one was added and nobody remembered to
add a matching line to the hardcoded loop -- most recently G148's
check:home-cache-shape/check:spend-from-render, added by hand, while
nine older ones (check:accounts-pinned, check:build-mobile-guard,
check:penny-screen-views, check:preference-save,
check:preferences-snapshot, check:preferences-version,
check:purchase-availability-ssr, check:scroll-nav-detect,
check:serial-queue) were never added at all. A guard that exists but
never runs in this gate reads as protection in review and catches
nothing.

The fix (`run_check_gate` in scripts/session.sh) enumerates every
`check:*` script in frontend/package.json itself, alphabetically, rather
than a hardcoded shell list, so a newly added check is enforced by
default. An explicit opt-out lives next to the script it exempts, in
package.json's own "checkGate.exclude" object (script name -> one-line
reason), never as a second list in the shell.

These tests prove:

1. Red-then-green (`test_a_new_check_is_silently_skipped_by_the_old_hardcoded_gate_but_enforced_by_the_new_manifest_gate`):
   a throwaway `check:zz-probe` script that always fails is added to a
   scratch package.json. Driven through the *pre-H83* `scripts/session.sh`
   (fetched straight from this worktree's own HEAD, i.e. before this
   item's edits -- the honest "old gate" baseline), `cmd_finish` still
   exits 0 and the probe is never actually invoked: the bug, reproduced
   for real rather than asserted from reading the diff. Driven through
   the *current* `scripts/session.sh`, the same package.json makes
   `cmd_finish` fail, and the probe shows up in the invocation log: the
   fix, proven the same way.

2. The exclusion path (`test_a_declared_exclusion_is_skipped_with_its_reason_logged`):
   the same always-failing probe, this time declared in
   "checkGate.exclude" with a reason. `run_check_gate` skips it, logs the
   reason, the probe is never invoked, and the gate otherwise passes.

Follows the sandboxing convention already established in
`test_session_worktree_resolve.py` and `test_session_start_guard.py`: a
disposable local "shared tree" (bare repo as `origin` plus a clone) under
`tmp_path`, and a small bash driver that sources the script under test
with `SHARED_TREE`/`BACKLOG_PY`/`VENV_PY`/`WORKTREES_ROOT` reassigned.
Nothing here ever touches `/root/ai-wealth-dashboard`, `/root/worktrees`
or the real board.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION_SH = REPO_ROOT / "scripts" / "session.sh"
BACKLOG_PY = REPO_ROOT / "scripts" / "backlog.py"
VENV_PY = REPO_ROOT / "backend" / ".venv" / "bin" / "python"

pytestmark = pytest.mark.skipif(not VENV_PY.exists(), reason="backend/.venv not present in this checkout")

COMPLIANCE_FIXTURE = """# Fixture compliance doc

## Q1 Start date

Status: ready

```text
2026-10-01
```
"""

BOARD_FIXTURE = """# Backlog fixture for the H83 check-gate-manifest tests

## H. Section H heading

- [ ] **H900. Item with a branch recorded.** [owner: claude] [state: in-progress] [branch: feature-H900-manifest-probe] A session is live on it.
"""

STUB_EXIT_0 = "#!/usr/bin/env bash\nexit 0\n"


def _git(*args: str, cwd: Path) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)
    return result.stdout


# The last commit on `main` before H83's own commits landed, i.e. the
# merge-base of this branch's HEAD and `origin/main` at the time this
# item was being built -- resolved ONCE, by hand
# (`git merge-base HEAD origin/main` -> b9a571ef70026451d649fdebd2d4b31b3188b203,
# "backlog: G168 started ..."), and pinned here as a fixed sha rather
# than re-resolved at test time.
#
# A moving ref cannot be used for this (review-round correction): the
# first version of this test called `git merge-base HEAD origin/main`
# live. That is correct only until H83 itself reaches `origin/main`
# (the very next integrate pass after this branch merges) -- from that
# point on, `origin/main` contains H83, so the merge-base of ANY future
# branch's HEAD and `origin/main` is guaranteed by git to be on or after
# H83, forever. This fixture's own guard would then fire unconditionally
# on every subsequent session, and `cmd_finish` runs `pytest -q -x
# tests`, so that single fixture failure would break `finish` for every
# future item, on any unrelated branch, until someone deleted this test
# -- a worse failure than the silent-skip bug H83 fixes. A sha baked
# into permanent git history has no such problem: `git show
# <sha>:scripts/session.sh` returns the same content forever, regardless
# of where `main`'s tip moves. See
# test_pinned_pre_h83_baseline_sha_genuinely_predates_run_check_gate
# below for the one-time "is this pin still honest" check, which stays
# green forever because the sha is fixed, not because the check is
# toothless.
_PRE_H83_SESSION_SH_SHA = "b9a571ef70026451d649fdebd2d4b31b3188b203"


def _pre_h83_session_sh(tmp_path: Path) -> Path:
    """The honest "old gate" baseline (see the H83 item text and
    CLAUDE.md's "Finishing" note on this item): scripts/session.sh
    exactly as it stood before this item's edits, not a hand-written
    stand-in for the bug. See `_PRE_H83_SESSION_SH_SHA` above for why
    this is a pinned sha rather than `git show HEAD:...` (HEAD on this
    branch IS the H83 commit) or a live merge-base resolution (a
    landmine for every session after H83 merges)."""
    old = tmp_path / "old-session.sh"
    content = _git("show", f"{_PRE_H83_SESSION_SH_SHA}:scripts/session.sh", cwd=REPO_ROOT)
    old.write_text(content, encoding="utf-8")
    old.chmod(0o755)
    return old


def test_pinned_pre_h83_baseline_sha_genuinely_predates_run_check_gate():
    """Test-of-the-test: if `_PRE_H83_SESSION_SH_SHA` were ever wrong (a
    typo, or repointed at a post-H83 commit), the red-then-green test
    below would still pass every stubbed step -- it would just be
    proving the current gate against itself a second time, silently. A
    fixed sha never drifts, so this never becomes the landmine a moving
    ref would have been; it exists to make a bad PIN fail loudly rather
    than a bad pin proving nothing."""
    content = _git("show", f"{_PRE_H83_SESSION_SH_SHA}:scripts/session.sh", cwd=REPO_ROOT)
    assert "run_check_gate" not in content, (
        f"the pinned pre-H83 baseline sha {_PRE_H83_SESSION_SH_SHA} already contains "
        "run_check_gate -- this pin is wrong, and the red-then-green test proves nothing "
        "until it is repointed at a genuinely pre-H83 commit"
    )


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
    (board_root / "TODO.md").write_text(BOARD_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
    _init_board_git_repo(board_root)
    return board_root


def _make_fake_shared_tree(tmp_path: Path, package_json: dict) -> Path:
    """A disposable stand-in for /root/ai-wealth-dashboard: a bare repo as
    `origin` plus a clone of it, seeded with a frontend/package.json a
    test controls directly, so a test can add its own throwaway check:*
    script and/or checkGate.exclude entry without touching the real
    package.json anywhere."""
    origin = tmp_path / "origin.git"
    _git("init", "--bare", "-q", "-b", "main", str(origin), cwd=tmp_path)

    seed = tmp_path / "seed"
    seed.mkdir()
    _git("init", "-q", "-b", "main", cwd=seed)
    (seed / ".gitkeep").write_text("", encoding="utf-8")
    (seed / "frontend").mkdir()
    (seed / "frontend" / "package.json").write_text(json.dumps(package_json) + "\n", encoding="utf-8")
    (seed / "scripts").mkdir()
    (seed / "scripts" / "check_pentest_evidence.py").write_text("", encoding="utf-8")
    (seed / "scripts" / "check_naive_dates.py").write_text("", encoding="utf-8")
    venv_bin = seed / "backend" / ".venv" / "bin"
    venv_bin.mkdir(parents=True)
    stub_python = venv_bin / "python"
    stub_python.write_text(STUB_EXIT_0, encoding="utf-8")
    stub_python.chmod(0o755)
    _git("add", "-A", cwd=seed)
    _git("-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "init", cwd=seed)
    _git("remote", "add", "origin", str(origin), cwd=seed)
    _git("push", "-q", "origin", "main", cwd=seed)

    shared = tmp_path / "shared"
    _git("clone", "-q", str(origin), str(shared), cwd=tmp_path)
    return shared


def _add_worktree(shared: Path, worktrees_root: Path, name: str, branch: str) -> Path:
    worktrees_root.mkdir(parents=True, exist_ok=True)
    path = worktrees_root / name
    _git("worktree", "add", "-q", "-b", branch, str(path), "main", cwd=shared)
    return path


def _make_tool_stubs(tmp_path: Path, log_file: Path, failing_checks: set[str]) -> Path:
    """npx exits 0 unconditionally (it only ever stands in for `tsc
    --noEmit`, not under test here). npm logs every invocation to
    `log_file` (so a test can assert exactly which check:* scripts were
    actually run, not just the gate's overall exit code) and fails only
    for the script names listed in `failing_checks` -- the always-fail
    throwaway probe these tests add to a scratch package.json."""
    bindir = tmp_path / "stubbin"
    bindir.mkdir(exist_ok=True)

    npx = bindir / "npx"
    npx.write_text(STUB_EXIT_0, encoding="utf-8")
    npx.chmod(0o755)

    failing = " ".join(sorted(failing_checks))
    npm = bindir / "npm"
    npm.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "$*" >> {str(log_file)!r}\n'
        # $1=run $2=-s $3=<script-name>
        f"script=\"${{3:-}}\"\n"
        f"for f in {failing}; do\n"
        '  if [[ "$script" == "$f" ]]; then exit 1; fi\n'
        "done\n"
        "exit 0\n",
        encoding="utf-8",
    )
    npm.chmod(0o755)
    return bindir


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
    session_sh: Path,
    *argv: str,
    extra_path: Path,
) -> subprocess.CompletedProcess:
    driver = tmp_path / "cmd_driver.sh"
    driver.write_text(CMD_DRIVER, encoding="utf-8")

    env = dict(os.environ)
    env["BACKLOG_ROOT"] = str(board_root)
    env.pop("BACKLOG_AGENT", None)
    env["PATH"] = f"{extra_path}{os.pathsep}{env['PATH']}"

    return subprocess.run(
        ["bash", str(driver), str(session_sh), str(shared_tree), str(BACKLOG_PY), str(VENV_PY), str(worktrees_root), *argv],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


def test_a_new_check_is_silently_skipped_by_the_old_hardcoded_gate_but_enforced_by_the_new_manifest_gate(tmp_path):
    package_json = {
        "scripts": {
            "check:design-index": "true",
            # The throwaway probe (verification instructions): always
            # fails when actually invoked, so whether the gate ran it is
            # visible from the exit code alone, no log inspection needed
            # to tell red from green (the log is asserted too, as a
            # second, independent signal).
            "check:zz-probe": "false",
        }
    }

    # ---- OLD: scripts/session.sh as it stood before this item (H83) ----
    old_tmp = tmp_path / "old"
    old_tmp.mkdir()
    old_session_sh = _pre_h83_session_sh(old_tmp)
    board_root = _make_board_root(old_tmp)
    shared_tree = _make_fake_shared_tree(old_tmp, package_json)
    worktrees_root = old_tmp / "worktrees"
    _add_worktree(shared_tree, worktrees_root, "feature-H900-manifest-probe", "feature-H900-manifest-probe")
    npm_log = old_tmp / "npm-invocations.log"
    npm_log.write_text("", encoding="utf-8")
    tool_stubs = _make_tool_stubs(old_tmp, npm_log, {"check:zz-probe"})

    old_result = _run_cmd(old_tmp, board_root, shared_tree, worktrees_root, old_session_sh, "cmd_finish", "H900", extra_path=tool_stubs)

    assert old_result.returncode == 0, (
        "expected the PRE-H83 gate to pass despite an always-failing "
        f"check:zz-probe (that is the bug this item fixes): {old_result.stdout}{old_result.stderr}"
    )
    old_log = npm_log.read_text(encoding="utf-8")
    assert "check:zz-probe" not in old_log, (
        f"the old hardcoded gate ran check:zz-probe, which it was never told about; it should not have found it: {old_log!r}"
    )

    # ---- NEW: scripts/session.sh as edited by this item ----
    new_tmp = tmp_path / "new"
    new_tmp.mkdir()
    board_root = _make_board_root(new_tmp)
    shared_tree = _make_fake_shared_tree(new_tmp, package_json)
    worktrees_root = new_tmp / "worktrees"
    _add_worktree(shared_tree, worktrees_root, "feature-H900-manifest-probe", "feature-H900-manifest-probe")
    npm_log = new_tmp / "npm-invocations.log"
    npm_log.write_text("", encoding="utf-8")
    tool_stubs = _make_tool_stubs(new_tmp, npm_log, {"check:zz-probe"})

    new_result = _run_cmd(new_tmp, board_root, shared_tree, worktrees_root, SESSION_SH, "cmd_finish", "H900", extra_path=tool_stubs)

    assert new_result.returncode != 0, (
        f"expected the manifest-derived gate to fail on an always-failing check:zz-probe it discovered on its own: "
        f"{new_result.stdout}{new_result.stderr}"
    )
    new_log = npm_log.read_text(encoding="utf-8")
    assert "check:zz-probe" in new_log, (
        f"the new gate never actually invoked check:zz-probe -- it must enumerate package.json itself, not just claim to: {new_log!r}"
    )
    # The board must not have been pushed to or advanced past in-progress:
    # a failed check must stop the gate before anything ships, exactly
    # like the old hardcoded loop's own failures always did.
    origin_branches = {
        line.strip()
        for line in _git("for-each-ref", "--format=%(refname:short)", "refs/heads", cwd=shared_tree.parent / "origin.git").splitlines()
        if line.strip()
    }
    assert "feature-H900-manifest-probe" not in origin_branches, "pushed a branch whose check gate failed"


def test_a_declared_exclusion_is_skipped_with_its_reason_logged(tmp_path):
    reason = "throwaway probe for the H83 manifest-gate test itself, never meant to run for real"
    package_json = {
        "scripts": {
            "check:design-index": "true",
            "check:zz-probe": "false",
        },
        "checkGate": {
            "exclude": {
                "check:zz-probe": reason,
            }
        },
    }

    board_root = _make_board_root(tmp_path)
    shared_tree = _make_fake_shared_tree(tmp_path, package_json)
    worktrees_root = tmp_path / "worktrees"
    _add_worktree(shared_tree, worktrees_root, "feature-H900-manifest-probe", "feature-H900-manifest-probe")
    npm_log = tmp_path / "npm-invocations.log"
    npm_log.write_text("", encoding="utf-8")
    tool_stubs = _make_tool_stubs(tmp_path, npm_log, {"check:zz-probe"})

    result = _run_cmd(tmp_path, board_root, shared_tree, worktrees_root, SESSION_SH, "cmd_finish", "H900", extra_path=tool_stubs)

    assert result.returncode == 0, f"an excluded check must not block the gate: {result.stdout}{result.stderr}"
    assert "skipping check:zz-probe" in result.stdout + result.stderr, result.stdout + result.stderr
    assert reason in result.stdout + result.stderr, "the exclusion's own reason must be logged, not just the fact of skipping"

    log = npm_log.read_text(encoding="utf-8")
    assert "check:zz-probe" not in log, f"an excluded check must never actually be invoked: {log!r}"

    origin_branches = {
        line.strip()
        for line in _git("for-each-ref", "--format=%(refname:short)", "refs/heads", cwd=shared_tree.parent / "origin.git").splitlines()
        if line.strip()
    }
    assert "feature-H900-manifest-probe" in origin_branches, "the rest of the gate should still have passed and pushed"


# ---------------------------------------------------------------------
# H83 review round 2: the tests above only ever exercise a synthetic
# package.json with a throwaway probe, so a hardcoded, undeclared skip
# of a REAL check inside run_check_gate (bypassing the manifest read
# entirely for that one name) would pass every test above unnoticed --
# exactly the class of regression this item exists to make impossible.
# This drives run_check_gate against the ACTUAL frontend/package.json in
# this checkout, with npm stubbed to a no-op that only records which
# check name it was asked to run (never runs a real check, which would
# make this slow and coupled to check content rather than to the gate's
# own enumeration logic), and asserts the recorded set is exactly the
# declared check:* set minus whatever checkGate.exclude declares.
# ---------------------------------------------------------------------

REAL_FRONTEND_PACKAGE_JSON = REPO_ROOT / "frontend" / "package.json"

RUN_CHECK_GATE_DRIVER = """#!/usr/bin/env bash
set -uo pipefail
_SESSION_SH="$1"; shift
_FRONTEND_DIR="$1"; shift
source "$_SESSION_SH" "" >/dev/null
run_check_gate "$_FRONTEND_DIR"
"""


def _real_declared_checks_and_exclusions() -> tuple[set[str], dict[str, str]]:
    data = json.loads(REAL_FRONTEND_PACKAGE_JSON.read_text(encoding="utf-8"))
    scripts = data.get("scripts", {})
    declared = {name for name in scripts if name.startswith("check:")}
    exclude = dict((data.get("checkGate") or {}).get("exclude") or {})
    return declared, exclude


def test_run_check_gate_invokes_exactly_the_real_manifests_declared_checks_minus_its_declared_exclusions(tmp_path):
    declared, exclusions = _real_declared_checks_and_exclusions()
    assert declared, "frontend/package.json declared no check:* scripts -- fixture assumption broken"

    log_file = tmp_path / "invocations.log"
    log_file.write_text("", encoding="utf-8")
    bindir = tmp_path / "stubbin"
    bindir.mkdir()
    npm = bindir / "npm"
    npm.write_text(
        "#!/usr/bin/env bash\n"
        f'echo "${{3:-}}" >> {str(log_file)!r}\n'
        "exit 0\n",
        encoding="utf-8",
    )
    npm.chmod(0o755)

    driver = tmp_path / "run_check_gate_driver.sh"
    driver.write_text(RUN_CHECK_GATE_DRIVER, encoding="utf-8")

    env = dict(os.environ)
    env["PATH"] = f"{bindir}{os.pathsep}{env['PATH']}"

    result = subprocess.run(
        ["bash", str(driver), str(SESSION_SH), str(REPO_ROOT / "frontend")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr

    invoked = {line.strip() for line in log_file.read_text(encoding="utf-8").splitlines() if line.strip()}
    expected = declared - set(exclusions.keys())
    assert invoked == expected, (
        f"run_check_gate invoked {invoked!r} against the real manifest, expected exactly "
        f"{expected!r} (declared check:* scripts minus checkGate.exclude); missing: "
        f"{expected - invoked!r}, unexpected extra: {invoked - expected!r}"
    )

    output = result.stdout + result.stderr
    for excluded_name, reason in exclusions.items():
        assert reason, f"checkGate.exclude[{excluded_name!r}] has an empty reason"
        assert f"skipping {excluded_name}" in output, f"exclusion of {excluded_name} was not logged: {output}"
        assert reason in output, f"exclusion reason for {excluded_name} was not logged: {output}"


# ---------------------------------------------------------------------
# H83 review round 2 (low-severity finding): a malformed checkGate.exclude
# (not an object, or a value that is not a plain string reason) must
# fail loudly rather than silently parsing to "no exclusions" -- that
# direction happens to be safe (more checks run, not fewer) but a typo
# that silently stops excluding a check nobody touched could sit
# unnoticed indefinitely, defeating the whole point of a mechanism whose
# job is to make an exception visible.
# ---------------------------------------------------------------------

RUN_CHECK_GATE_ON_DIR_DRIVER = """#!/usr/bin/env bash
set -uo pipefail
_SESSION_SH="$1"; shift
_FRONTEND_DIR="$1"; shift
source "$_SESSION_SH" "" >/dev/null
run_check_gate "$_FRONTEND_DIR"
"""


def _run_check_gate_against(tmp_path: Path, package_json: dict) -> subprocess.CompletedProcess:
    frontend_dir = tmp_path / "frontend"
    frontend_dir.mkdir(exist_ok=True)
    (frontend_dir / "package.json").write_text(json.dumps(package_json), encoding="utf-8")

    bindir = tmp_path / "stubbin"
    bindir.mkdir(exist_ok=True)
    npm = bindir / "npm"
    npm.write_text(STUB_EXIT_0, encoding="utf-8")
    npm.chmod(0o755)

    driver = tmp_path / "run_check_gate_on_dir_driver.sh"
    driver.write_text(RUN_CHECK_GATE_ON_DIR_DRIVER, encoding="utf-8")

    env = dict(os.environ)
    env["PATH"] = f"{bindir}{os.pathsep}{env['PATH']}"

    return subprocess.run(
        ["bash", str(driver), str(SESSION_SH), str(frontend_dir)],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_a_non_object_check_gate_exclude_fails_loudly_instead_of_silently_running_everything(tmp_path):
    result = _run_check_gate_against(tmp_path, {"scripts": {"check:a": "true"}, "checkGate": {"exclude": "oops"}})
    assert result.returncode != 0, "a malformed checkGate.exclude must refuse, not silently proceed"
    assert "checkGate.exclude" in result.stdout + result.stderr
    assert "malformed" in result.stdout + result.stderr


def test_a_nested_object_check_gate_exclude_value_fails_loudly(tmp_path):
    result = _run_check_gate_against(
        tmp_path,
        {
            "scripts": {"check:a": "true"},
            "checkGate": {"exclude": {"check:a": {"nested": "object, not a one-line reason string"}}},
        },
    )
    assert result.returncode != 0, "a non-string exclusion reason must refuse, not silently proceed"
    assert "checkGate.exclude" in result.stdout + result.stderr
    assert "malformed" in result.stdout + result.stderr


def test_a_well_formed_check_gate_exclude_still_works_after_the_malformed_case_is_rejected(tmp_path):
    result = _run_check_gate_against(
        tmp_path,
        {
            "scripts": {"check:a": "true", "check:b": "true"},
            "checkGate": {"exclude": {"check:b": "a good one-line reason"}},
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "skipping check:b (excluded from finish gate: a good one-line reason)" in result.stdout + result.stderr


def test_no_check_gate_key_at_all_is_not_malformed(tmp_path):
    """Absence of "checkGate" entirely (every check:* script today) must
    not be confused with a malformed exclude block: jq's `// {}` handles
    a genuinely missing key, only a present-but-wrong-shaped value should
    refuse."""
    result = _run_check_gate_against(tmp_path, {"scripts": {"check:a": "true"}})
    assert result.returncode == 0, result.stdout + result.stderr


# ---------------------------------------------------------------------
# H83 review round 3 (fix 2/2): @tsv only rejects composite exclusion
# values (arrays/objects) -- it happily stringifies a number or boolean
# and renders `null` as an empty string, so a number, boolean, null or
# empty-string reason all sailed through the round-2 fix as if they were
# real reasons (a null reason even logged as a blank string). The whole
# point of this mechanism is that an exception stays visible, so each of
# these must refuse exactly like a nested object does, not silently
# accept a non-reason as a reason.
# ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_value",
    [42, True, False, None, ""],
    ids=["number", "true", "false", "null", "empty-string"],
)
def test_a_non_string_or_empty_exclude_reason_fails_loudly(tmp_path, bad_value):
    result = _run_check_gate_against(
        tmp_path,
        {"scripts": {"check:a": "true", "check:b": "true"}, "checkGate": {"exclude": {"check:b": bad_value}}},
    )
    assert result.returncode != 0, (
        f"a {bad_value!r} exclusion reason must refuse, not be accepted as a real reason: {result.stdout}{result.stderr}"
    )
    output = result.stdout + result.stderr
    assert "checkGate.exclude" in output
    assert "malformed" in output
    assert "non-empty string" in output
