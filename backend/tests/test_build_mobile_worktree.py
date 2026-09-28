"""H76 (2026-09-28): frontend/scripts/build-mobile.sh could not run inside a
worktree at all. In the worktree layout scripts/session.sh creates,
frontend/node_modules is a symlink to the shared tree's real node_modules
directory (not a directory itself). The script's rsync exclude
(`node_modules/`, trailing slash) only matches directories, so it copied the
symlink into its scratch dir; the following `ln -s "$(pwd)/node_modules"
"$SCRATCH/node_modules"` then found an existing destination that itself
resolved (through two symlink hops) to a real directory, and GNU ln's
directory-placement behaviour silently planted a stray `node_modules`
symlink *inside* /root/ai-wealth-dashboard/frontend/node_modules -- the one
tree every session is forbidden to write into -- instead of erroring under
`set -e` as originally assumed.

This test builds a throwaway fake "shared tree + worktree" layout under
tmp_path (a fake frontend dir whose node_modules is a symlink pointing
outside it, mirroring the real worktree layout from scripts/session.sh) and
runs the real, checked-in build-mobile.sh against it in
BUILD_MOBILE_SKIP_BUILD=1 stub mode (skips `next build` and the out/ copy,
stages the scratch dir and leaves it on disk). It asserts the script exits
0, stages the expected top-level entries, and -- the actual regression
check -- never writes anything into the fake shared tree's real
node_modules directory.

Manually verified red/green while building this fix (not re-run here, since
it would require temporarily reintroducing the bug into the checked-in
script): checked out the original build-mobile.sh via `git show
HEAD:frontend/scripts/build-mobile.sh` (before this fix), ran the same
fake-worktree layout through it, and confirmed a `node_modules` symlink
pointing back at the worktree appeared inside the fake shared tree's real
node_modules directory. Running the fixed script (this repo's checked-in
copy) against the same layout leaves that directory untouched.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "frontend" / "scripts" / "build-mobile.sh"

CALLBACK_ROUTES = [
    "app/auth/finexer/callback/route.ts",
    "app/auth/nordigen/callback/route.ts",
    "app/auth/truelayer/callback/route.ts",
    "app/auth/yapily/callback/route.ts",
]

ROUTE_STUB = (
    'const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";\n'
    "export function GET() { return null; }\n"
)


def _build_fake_layout(tmp_path: Path, *, node_modules_is_symlink: bool) -> tuple[Path, Path]:
    """Build a fake "shared tree" + "frontend" pair under tmp_path.

    When node_modules_is_symlink is True this mirrors the worktree layout
    scripts/session.sh creates: frontend/node_modules is a symlink to a
    real node_modules directory living in a separate "shared tree" location
    -- the shape that triggered H76. When False, node_modules is a real
    directory in frontend/ itself, mirroring the shared-tree case that
    always worked.

    Returns (frontend_dir, real_node_modules_dir).
    """
    shared_node_modules = tmp_path / "shared" / "frontend" / "node_modules"
    (shared_node_modules / "some-real-pkg").mkdir(parents=True)
    (shared_node_modules / ".bin").mkdir()
    (shared_node_modules / "some-real-pkg" / "index.js").write_text("module.exports = {};\n")

    frontend = tmp_path / "worktree" / "frontend"
    (frontend / "scripts").mkdir(parents=True)
    for route in CALLBACK_ROUTES:
        route_path = frontend / route
        route_path.parent.mkdir(parents=True, exist_ok=True)
        route_path.write_text(ROUTE_STUB)
    (frontend / "package.json").write_text("{}\n")
    (frontend / "next.config.ts").write_text("")

    if node_modules_is_symlink:
        (frontend / "node_modules").symlink_to(shared_node_modules, target_is_directory=True)
        real_node_modules = shared_node_modules
    else:
        real_node_modules = frontend / "node_modules"
        real_node_modules.mkdir()
        (real_node_modules / "some-real-pkg").mkdir()
        (real_node_modules / ".bin").mkdir()
        (real_node_modules / "some-real-pkg" / "index.js").write_text("module.exports = {};\n")

    script_copy = frontend / "scripts" / "build-mobile.sh"
    shutil.copy(SCRIPT_PATH, script_copy)
    script_copy.chmod(script_copy.stat().st_mode | stat.S_IEXEC)

    return frontend, real_node_modules


def _snapshot(dir_path: Path) -> set[str]:
    return {str(p.relative_to(dir_path)) for p in dir_path.rglob("*")}


def _run_stub_build(frontend: Path) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["BUILD_MOBILE_SKIP_BUILD"] = "1"
    return subprocess.run(
        ["bash", "scripts/build-mobile.sh"],
        cwd=frontend,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


@pytest.mark.skipif(not SCRIPT_PATH.exists(), reason="build-mobile.sh not found")
def test_worktree_layout_never_writes_into_real_node_modules(tmp_path):
    frontend, real_node_modules = _build_fake_layout(tmp_path, node_modules_is_symlink=True)
    before = _snapshot(real_node_modules)

    result = _run_stub_build(frontend)

    assert result.returncode == 0, (
        f"stub build exited {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )

    after = _snapshot(real_node_modules)
    assert after == before, (
        "the fake shared tree's real node_modules directory changed -- the "
        f"exact H76 regression. before={before} after={after}"
    )

    # And specifically: no stray "node_modules" entry (the H76 symptom)
    # appeared anywhere inside it.
    assert not any(name == "node_modules" for name in after)


@pytest.mark.skipif(not SCRIPT_PATH.exists(), reason="build-mobile.sh not found")
def test_worktree_layout_stages_expected_files_and_symlinks_node_modules(tmp_path):
    frontend, real_node_modules = _build_fake_layout(tmp_path, node_modules_is_symlink=True)

    result = _run_stub_build(frontend)
    assert result.returncode == 0, result.stdout + result.stderr

    scratch = frontend / ".mobile-build"
    assert scratch.is_dir(), "BUILD_MOBILE_SKIP_BUILD=1 should leave the scratch dir on disk"

    # Expected top-level staged entries from the rsync mirror.
    assert (scratch / "package.json").is_file()
    assert (scratch / "next.config.ts").is_file()
    assert (scratch / "app").is_dir()
    assert (scratch / "scripts" / "build-mobile.sh").is_file()
    for route in CALLBACK_ROUTES:
        assert (scratch / route).is_file()
        # The force-static literal patch (applied only to the scratch copy)
        # should still be present -- unrelated to the node_modules fix, but
        # confirms the rest of the staging pipeline ran to completion.
        assert "force-static" in (scratch / route).read_text()

    # node_modules must be a symlink (never a real copied directory) that
    # resolves to the real, shared node_modules directory.
    staged_nm = scratch / "node_modules"
    assert staged_nm.is_symlink(), "node_modules must be relinked, not copied"
    assert os.path.realpath(staged_nm) == os.path.realpath(real_node_modules)


@pytest.mark.skipif(not SCRIPT_PATH.exists(), reason="build-mobile.sh not found")
def test_shared_tree_layout_still_works_and_matches_worktree_staging(tmp_path):
    """Non-worktree case (node_modules is a real directory, not a symlink)
    must behave exactly as before this fix: no exclusion edge case applies,
    and the staged tree shape matches the worktree case's."""
    frontend, real_node_modules = _build_fake_layout(tmp_path, node_modules_is_symlink=False)
    before = _snapshot(real_node_modules)

    result = _run_stub_build(frontend)
    assert result.returncode == 0, result.stdout + result.stderr

    after = _snapshot(real_node_modules)
    assert after == before

    scratch = frontend / ".mobile-build"
    staged_nm = scratch / "node_modules"
    assert staged_nm.is_symlink()
    assert os.path.realpath(staged_nm) == os.path.realpath(real_node_modules)

    top_level_names = {p.name for p in scratch.iterdir()}
    assert top_level_names == {"app", "next.config.ts", "node_modules", "package.json", "scripts"}
