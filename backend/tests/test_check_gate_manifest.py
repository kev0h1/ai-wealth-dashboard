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


def _pre_h83_session_sh(tmp_path: Path) -> Path:
    """The honest "old gate" baseline (see the H83 item text and
    CLAUDE.md's "Finishing" note on this item): this worktree's own HEAD,
    i.e. scripts/session.sh exactly as it stood before this item's edits,
    not a hand-written stand-in for the bug."""
    old = tmp_path / "old-session.sh"
    content = _git("show", "HEAD:scripts/session.sh", cwd=REPO_ROOT)
    old.write_text(content, encoding="utf-8")
    old.chmod(0o755)
    return old


def _make_board_root(tmp_path: Path) -> Path:
    board_root = tmp_path / "board"
    board_root.mkdir()
    (board_root / "TODO.md").write_text(BOARD_FIXTURE, encoding="utf-8")
    compliance_dir = board_root / "docs" / "compliance"
    compliance_dir.mkdir(parents=True)
    (compliance_dir / "finexer-agent-controls-2026-09.md").write_text(COMPLIANCE_FIXTURE, encoding="utf-8")
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
