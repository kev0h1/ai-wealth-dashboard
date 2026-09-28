"""Tests for scripts/frontend_build.py (H51): the atomic UAT frontend build.

Everything runs against a tmp_path "frontend" directory with a fake
`run_build` callable, so no test ever runs npm, next, or systemctl, and
nothing here goes near /root/ai-wealth-dashboard/frontend/.next. (The
mirror step does run a real `rsync` on the tiny tmp tree.) The three
scenarios the item asks to be proven are all here in unit form (a real
`next build` + scratch `next start` run backs them up, see the H51 notes):

  * a successful build lands in .next and the old build moves to .next-prev;
  * a failed, interrupted, or unverifiable build leaves .next untouched;
  * a second build while one holds the lock fails loudly, never queues.
"""
from __future__ import annotations

import datetime as dt
import fcntl
import importlib.util
import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "frontend_build.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("frontend_build_under_test", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


fb = _load_module()


def _write_complete_build(dist: Path, build_id: str) -> None:
    """Lay down the minimum shape verify_build_dir accepts, mimicking what
    `next build` writes (required-server-files.json's `files` entries are
    relative to the project dir and start with the distDir name)."""
    dist.mkdir(parents=True, exist_ok=True)
    (dist / "BUILD_ID").write_text(build_id + "\n")
    for rel in fb.BASELINE_REQUIRED:
        if rel in ("BUILD_ID", "required-server-files.json"):
            continue
        target = dist / rel
        if rel == "static":
            (target / "chunks").mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("{}")
    (dist / "server" / "app" / "page.js").parent.mkdir(parents=True, exist_ok=True)
    (dist / "server" / "app" / "page.js").write_text("// page")
    manifest = {
        "version": 1,
        "config": {"distDir": ".next"},
        "files": [".next/routes-manifest.json", ".next/server/app/page.js", ".next/BUILD_ID"],
    }
    (dist / "required-server-files.json").write_text(json.dumps(manifest))


@pytest.fixture
def frontend(tmp_path: Path) -> Path:
    """A tiny stand-in for frontend/: a couple of source files, a public
    dir, an .env.local, and a fake node_modules that the mirror must not
    copy."""
    d = tmp_path / "repo" / "frontend"
    (d / "app").mkdir(parents=True)
    (d / "app" / "page.tsx").write_text("export default () => null;\n")
    (d / "public").mkdir()
    (d / "public" / "icon.svg").write_text("<svg/>")
    (d / "package.json").write_text('{"name":"frontend","scripts":{"build":"next build"}}')
    (d / ".env.local").write_text("NEXT_PUBLIC_TRUELAYER_PICKER=on\n")
    (d / "node_modules" / "next").mkdir(parents=True)
    (d / "node_modules" / "next" / "package.json").write_text("{}")
    (d / "tsconfig.tsbuildinfo").write_text("{}")
    return d


def _live_build(frontend: Path, build_id: str = "live-old") -> Path:
    live = frontend / fb.LIVE_NAME
    _write_complete_build(live, build_id)
    (live / "marker-of-old-build").write_text("old")
    return live


def _good_builder(build_id: str):
    def run_build(mirror: Path, frontend_dir: Path):
        _write_complete_build(mirror / fb.LIVE_NAME, build_id)
        return 0, "ok"
    return run_build


def _mirror(frontend: Path) -> Path:
    return frontend.parent / fb.STAGING_NAME


# --- verification -------------------------------------------------------------


def test_verify_build_dir_accepts_complete_build(tmp_path: Path):
    dist = tmp_path / ".next"
    _write_complete_build(dist, "abc")
    assert fb.verify_build_dir(dist) == "abc"


def test_verify_build_dir_rejects_missing_build_id(tmp_path: Path):
    # The 2026-09-17 shape: manifests present, BUILD_ID absent.
    dist = tmp_path / ".next"
    _write_complete_build(dist, "abc")
    (dist / "BUILD_ID").unlink()
    with pytest.raises(fb.FrontendBuildError, match="BUILD_ID is missing"):
        fb.verify_build_dir(dist)


def test_verify_build_dir_rejects_empty_build_id(tmp_path: Path):
    dist = tmp_path / ".next"
    _write_complete_build(dist, "abc")
    (dist / "BUILD_ID").write_text("\n")
    with pytest.raises(fb.FrontendBuildError, match="BUILD_ID is missing or empty"):
        fb.verify_build_dir(dist)


def test_verify_build_dir_rejects_missing_required_server_file(tmp_path: Path):
    dist = tmp_path / ".next"
    _write_complete_build(dist, "abc")
    (dist / "server" / "app" / "page.js").unlink()
    with pytest.raises(fb.FrontendBuildError, match="server/app/page.js is listed in required-server-files.json but missing"):
        fb.verify_build_dir(dist)


def test_verify_build_dir_resolves_required_files_wherever_the_dir_lives(tmp_path: Path):
    # `files` entries start with ".next/"; the check must resolve them
    # inside whatever directory it was handed (the mirror's .next before
    # the swap, frontend/.next-prev after it).
    dist = tmp_path / "somewhere-else"
    _write_complete_build(dist, "abc")
    assert fb.verify_build_dir(dist) == "abc"


# --- the mirror ---------------------------------------------------------------


def test_prepare_staging_mirrors_source_but_not_node_modules_or_builds(frontend: Path):
    _live_build(frontend, "live-old")
    (frontend / fb.PREVIOUS_NAME).mkdir()
    (frontend / ".mobile-build").mkdir()

    mirror = fb.prepare_staging(frontend, log=lambda s: None)

    assert mirror == _mirror(frontend)
    assert (mirror / "app" / "page.tsx").read_text() == "export default () => null;\n"
    assert (mirror / "public" / "icon.svg").exists()
    assert (mirror / "package.json").exists()
    assert (mirror / ".env.local").read_text() == "NEXT_PUBLIC_TRUELAYER_PICKER=on\n"
    # node_modules is a symlink to the real one, not a copy.
    assert (mirror / "node_modules").is_symlink()
    assert os.readlink(mirror / "node_modules") == str(frontend / "node_modules")
    # No build dirs, no stale tsbuildinfo, no mobile scratch.
    assert not (mirror / fb.PREVIOUS_NAME).exists()
    assert not (mirror / ".mobile-build").exists()
    assert not (mirror / "tsconfig.tsbuildinfo").exists()
    assert not (mirror / fb.LIVE_NAME / "BUILD_ID").exists()
    # Fresh .next in the mirror with the cache linked to the stable dir.
    assert (mirror / fb.LIVE_NAME).is_dir()
    assert (mirror / fb.LIVE_NAME / "cache").is_symlink()
    assert os.readlink(mirror / fb.LIVE_NAME / "cache") == str(frontend / fb.CACHE_NAME)
    # And the live build was not touched.
    assert (frontend / fb.LIVE_NAME / "marker-of-old-build").exists()


def test_prepare_staging_when_node_modules_is_itself_a_symlink(frontend: Path, tmp_path: Path):
    # scripts/session.sh worktrees symlink frontend/node_modules to the
    # shared tree's; the mirror must still get exactly one link, to the
    # worktree's own frontend/node_modules (which resolves onward).
    real = tmp_path / "shared-node_modules"
    real.mkdir()
    import shutil
    shutil.rmtree(frontend / "node_modules")
    (frontend / "node_modules").symlink_to(real, target_is_directory=True)

    mirror = fb.prepare_staging(frontend, log=lambda s: None)

    assert (mirror / "node_modules").is_symlink()
    assert os.readlink(mirror / "node_modules") == str(frontend / "node_modules")
    assert (mirror / "node_modules").resolve() == real.resolve()


def test_prepare_staging_failure_is_a_frontend_build_error_and_cleans_up(frontend: Path, monkeypatch):
    _live_build(frontend, "live-old")

    def broken_symlink(self, target, target_is_directory=False):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(fb.Path, "symlink_to", broken_symlink)
    with pytest.raises(fb.FrontendBuildError, match="could not prepare the build mirror; live .next untouched"):
        fb.build_and_swap(frontend, run_build=_good_builder("never"), log=lambda s: None)
    assert not _mirror(frontend).exists()
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "live-old"


def test_prepare_staging_replaces_a_stale_mirror_from_an_earlier_interruption(frontend: Path):
    stale = _mirror(frontend)
    stale.mkdir()
    (stale / "leftover").write_text("x")
    mirror = fb.prepare_staging(frontend, log=lambda s: None)
    assert not (mirror / "leftover").exists()
    assert (mirror / "app" / "page.tsx").exists()


def test_build_tag_matches_next_config_format(frontend: Path, monkeypatch):
    monkeypatch.delenv("NEXT_PUBLIC_BUILD_TAG", raising=False)
    monkeypatch.delenv("BUILD_NUMBER", raising=False)
    fixed = dt.datetime(2026, 9, 27, 23, 59, tzinfo=dt.timezone.utc)
    # No git in the tmp tree: falls back to "nogit" exactly like next.config.ts.
    assert fb.build_tag(frontend, now=fixed) == "build 2026-09-27 nogit"
    monkeypatch.setenv("BUILD_NUMBER", "42")
    assert fb.build_tag(frontend, now=fixed) == "build 2026-09-27 nogit #42"
    monkeypatch.setenv("NEXT_PUBLIC_BUILD_TAG", "uat build 2026-09-27 abc1234")
    assert fb.build_tag(frontend, now=fixed) == "uat build 2026-09-27 abc1234"


def test_build_tag_uses_the_real_checkouts_sha(monkeypatch):
    # This repo's own frontend/ has a .git above it; the tag carries HEAD's
    # short sha, which is what the login-screen build whisper shows.
    monkeypatch.delenv("NEXT_PUBLIC_BUILD_TAG", raising=False)
    monkeypatch.delenv("BUILD_NUMBER", raising=False)
    tag = fb.build_tag(REPO_ROOT / "frontend")
    parts = tag.split()
    assert parts[0] == "build"
    assert len(parts[2]) == 7 and parts[2] != "nogit"


def test_run_next_build_runs_npm_in_the_mirror_with_the_build_tag(frontend: Path, monkeypatch):
    captured: dict[str, object] = {}

    class FakeProc:
        pid = 4242
        returncode = 0

        def communicate(self, timeout=None):
            return "built", None

        def poll(self):
            return 0

    def fake_popen(cmd, cwd, env, **kwargs):
        captured["cmd"] = cmd
        captured["cwd"] = cwd
        captured["tag"] = env.get("NEXT_PUBLIC_BUILD_TAG")
        captured["new_session"] = kwargs.get("start_new_session")
        return FakeProc()

    monkeypatch.delenv("NEXT_PUBLIC_BUILD_TAG", raising=False)
    monkeypatch.setattr(fb, "build_tag", lambda frontend_dir, now=None: "build 2026-09-27 abc1234")
    monkeypatch.setattr(fb.subprocess, "Popen", fake_popen)
    mirror = _mirror(frontend)
    rc, out = fb.run_next_build(mirror, frontend)
    assert (rc, out) == (0, "built")
    assert captured["cmd"] == ["npm", "run", "build"]
    assert captured["cwd"] == mirror
    assert captured["tag"] == "build 2026-09-27 abc1234"
    assert captured["new_session"] is True
    # Only the build's environment carried the tag.
    assert "NEXT_PUBLIC_BUILD_TAG" not in os.environ


def test_run_next_build_sigterm_kills_the_build_group_and_raises(frontend: Path, monkeypatch):
    # `kill <pid>` of the builder must not orphan `next build`: the scoped
    # SIGTERM handler turns the signal into BuildInterrupted, and the
    # process group of the build is killed on the way out. Simulated by
    # sending SIGTERM to this very process from inside the fake
    # communicate(); the handler is only installed for the duration of the
    # call and the previous disposition is restored afterwards.
    killed: list[tuple[int, int]] = []
    before = fb.signal.getsignal(fb.signal.SIGTERM)

    class FakeProc:
        pid = 5151
        returncode = None

        def communicate(self, timeout=None):
            os.kill(os.getpid(), fb.signal.SIGTERM)
            time.sleep(1)  # the handler fires inside this call
            return "unreachable", None

        def poll(self):
            return None if not killed else -15

        def wait(self):
            return -15

    monkeypatch.setattr(fb, "build_tag", lambda frontend_dir, now=None: "build 2026-09-27 abc1234")
    monkeypatch.setattr(fb.subprocess, "Popen", lambda *a, **k: FakeProc())
    monkeypatch.setattr(fb.os, "killpg", lambda pgid, sig: killed.append((pgid, sig)))

    with pytest.raises(fb.BuildInterrupted, match="interrupted by SIGTERM; live .next untouched"):
        fb.run_next_build(_mirror(frontend), frontend)

    assert killed and killed[0] == (5151, fb.signal.SIGTERM)
    assert fb.signal.getsignal(fb.signal.SIGTERM) == before


# --- scenario 1: a successful build lands ------------------------------------


def test_build_and_swap_success_lands_new_build_and_keeps_previous(frontend: Path):
    _live_build(frontend, "live-old")
    logs: list[str] = []

    result = fb.build_and_swap(frontend, run_build=_good_builder("new-1"), log=logs.append)

    live = frontend / fb.LIVE_NAME
    prev = frontend / fb.PREVIOUS_NAME
    assert result.build_id == "new-1"
    assert result.previous_build_id == "live-old"
    assert fb.read_build_id(live) == "new-1"
    assert fb.read_build_id(prev) == "live-old"
    assert (prev / "marker-of-old-build").exists()
    assert not (live / "marker-of-old-build").exists()
    # The mirror is gone once the build has landed.
    assert not _mirror(frontend).exists()
    # Live build is complete and boot-able by the same verification.
    assert fb.verify_build_dir(live) == "new-1"
    assert any("swapping into" in line for line in logs)


def test_build_and_swap_first_ever_build_with_no_live_next(frontend: Path):
    result = fb.build_and_swap(frontend, run_build=_good_builder("first"), log=lambda s: None)
    assert result.previous_build_id is None
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "first"
    assert not (frontend / fb.PREVIOUS_NAME).exists()


def test_build_and_swap_replaces_older_previous_build(frontend: Path):
    _live_build(frontend, "b2")
    _write_complete_build(frontend / fb.PREVIOUS_NAME, "b1")
    fb.build_and_swap(frontend, run_build=_good_builder("b3"), log=lambda s: None)
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "b3"
    # Exactly one step back is kept: b2, not b1.
    assert fb.read_build_id(frontend / fb.PREVIOUS_NAME) == "b2"


def test_build_and_swap_cache_is_the_shared_cache_dir(frontend: Path):
    seen: dict[str, object] = {}

    def run_build(mirror: Path, frontend_dir: Path):
        cache_link = mirror / fb.LIVE_NAME / "cache"
        seen["is_symlink"] = cache_link.is_symlink()
        (cache_link / "turbopack").mkdir(parents=True)
        _write_complete_build(mirror / fb.LIVE_NAME, "c1")
        return 0, ""

    fb.build_and_swap(frontend, run_build=run_build, log=lambda s: None)
    assert seen["is_symlink"] is True
    # Writes through the link landed in the stable cache dir, which the
    # swapped-in .next now also points at.
    assert (frontend / fb.CACHE_NAME / "turbopack").is_dir()
    assert (frontend / fb.LIVE_NAME / "cache").is_symlink()


def test_first_build_seeds_stable_cache_from_live_next_cache_once(frontend: Path):
    # The shared tree's .next/cache/turbopack (from the in-place-build era)
    # is copied into .next-cache the first time that directory is created,
    # read-only on the source, so the first atomic build is warm. Later
    # builds never touch it again.
    live = _live_build(frontend, "live-old")
    (live / "cache" / "turbopack").mkdir(parents=True)
    (live / "cache" / "turbopack" / "blob").write_text("warm")
    logs: list[str] = []

    fb.build_and_swap(frontend, run_build=_good_builder("n1"), log=logs.append)

    assert (frontend / fb.CACHE_NAME / "turbopack" / "blob").read_text() == "warm"
    assert any("seeded" in line for line in logs)
    # The old live cache went with the old build to .next-prev, unmodified.
    assert (frontend / fb.PREVIOUS_NAME / "cache" / "turbopack" / "blob").read_text() == "warm"
    # Second build: .next-cache already exists, nothing is re-seeded even
    # though .next-prev still has a real cache dir.
    logs.clear()
    (frontend / fb.CACHE_NAME / "turbopack" / "blob").write_text("warmer")
    fb.build_and_swap(frontend, run_build=_good_builder("n2"), log=logs.append)
    assert (frontend / fb.CACHE_NAME / "turbopack" / "blob").read_text() == "warmer"
    assert not any("seeded" in line for line in logs)


def test_first_build_without_a_live_cache_builds_cold_without_error(frontend: Path):
    _live_build(frontend, "live-old")  # no cache dir at all
    logs: list[str] = []
    fb.build_and_swap(frontend, run_build=_good_builder("n1"), log=logs.append)
    assert (frontend / fb.CACHE_NAME).is_dir()
    assert not any("seeded" in line for line in logs)


# --- scenario 2: a failed / interrupted build leaves .next untouched ----------


def _snapshot(d: Path) -> dict[str, str]:
    out = {}
    for p in sorted(d.rglob("*")):
        if p.is_file():
            out[str(p.relative_to(d))] = p.read_text()
    return out


def test_build_failure_leaves_live_next_untouched(frontend: Path):
    live = _live_build(frontend, "live-old")
    before = _snapshot(live)

    def failing_build(mirror: Path, frontend_dir: Path):
        # Partial output, then a non-zero exit.
        (mirror / fb.LIVE_NAME / "server").mkdir(parents=True)
        (mirror / fb.LIVE_NAME / "server" / "half.js").write_text("half")
        return 1, "Type error: boom"

    with pytest.raises(fb.FrontendBuildError, match="live .next untouched"):
        fb.build_and_swap(frontend, run_build=failing_build, log=lambda s: None)

    assert _snapshot(live) == before
    assert fb.verify_build_dir(live) == "live-old"
    assert not _mirror(frontend).exists()
    assert not (frontend / fb.PREVIOUS_NAME).exists()


def test_interrupted_build_leaves_live_next_untouched(frontend: Path):
    # An interruption surfaces as an exception out of run_build (the real
    # run_next_build kills its process group and re-raises); the mirror is
    # removed and .next is not touched.
    live = _live_build(frontend, "live-old")
    before = _snapshot(live)

    def interrupted_build(mirror: Path, frontend_dir: Path):
        (mirror / fb.LIVE_NAME / "build-manifest.json").write_text("{}")
        raise KeyboardInterrupt()

    with pytest.raises(KeyboardInterrupt):
        fb.build_and_swap(frontend, run_build=interrupted_build, log=lambda s: None)

    assert _snapshot(live) == before
    assert not _mirror(frontend).exists()


def test_build_exit_zero_but_incomplete_output_is_rejected(frontend: Path):
    # Exactly the 2026-09-17 shape, but this time it never reaches .next:
    # exit 0 (as a killed-then-resumed wrapper might report) with
    # manifests present and BUILD_ID absent.
    live = _live_build(frontend, "live-old")
    before = _snapshot(live)

    def incomplete_build(mirror: Path, frontend_dir: Path):
        _write_complete_build(mirror / fb.LIVE_NAME, "half")
        (mirror / fb.LIVE_NAME / "BUILD_ID").unlink()
        return 0, ""

    with pytest.raises(fb.FrontendBuildError, match="did not verify; live .next untouched"):
        fb.build_and_swap(frontend, run_build=incomplete_build, log=lambda s: None)

    assert _snapshot(live) == before
    assert not _mirror(frontend).exists()


# --- scenario 3: overlapping builds fail loudly --------------------------------


def test_second_build_while_lock_held_fails_loudly(frontend: Path):
    _live_build(frontend, "live-old")
    lock_path = frontend / fb.LOCK_NAME
    lock_path.touch()
    # Hold the lock from a separate file descriptor, the way another
    # process would (flock locks are per open file description).
    holder = open(lock_path, "a+")
    fcntl.flock(holder.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        calls: list[str] = []
        with pytest.raises(fb.FrontendBuildError, match="another frontend build is already in progress"):
            fb.build_and_swap(frontend, run_build=lambda m, f: (calls.append("built"), (0, ""))[1], log=lambda s: None)
        # It never got as far as mirroring or building, and never touched the tree.
        assert calls == []
        assert not _mirror(frontend).exists()
        assert fb.read_build_id(frontend / fb.LIVE_NAME) == "live-old"
    finally:
        fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        holder.close()


def test_second_build_during_a_running_build_fails_and_first_completes(frontend: Path):
    _live_build(frontend, "live-old")
    build_started = threading.Event()
    release_build = threading.Event()
    second_outcome: dict[str, object] = {}

    def slow_build(mirror: Path, frontend_dir: Path):
        build_started.set()
        assert release_build.wait(10)
        _write_complete_build(mirror / fb.LIVE_NAME, "slow")
        return 0, ""

    def first():
        fb.build_and_swap(frontend, run_build=slow_build, log=lambda s: None)

    t = threading.Thread(target=first)
    t.start()
    assert build_started.wait(10)
    try:
        fb.build_and_swap(frontend, run_build=_good_builder("second"), log=lambda s: None)
        second_outcome["error"] = None
    except fb.FrontendBuildError as exc:
        second_outcome["error"] = str(exc)
    finally:
        release_build.set()
        t.join(10)

    assert second_outcome["error"] is not None
    assert "another frontend build is already in progress" in str(second_outcome["error"])
    # The first build was not disturbed and landed.
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "slow"
    assert fb.read_build_id(frontend / fb.PREVIOUS_NAME) == "live-old"


def test_lock_is_released_after_a_failed_build(frontend: Path):
    _live_build(frontend, "live-old")
    with pytest.raises(fb.FrontendBuildError):
        fb.build_and_swap(frontend, run_build=lambda m, f: (1, "nope"), log=lambda s: None)
    # A following build is not blocked by the failed one.
    fb.build_and_swap(frontend, run_build=_good_builder("after"), log=lambda s: None)
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "after"


# --- revert ---------------------------------------------------------------------


def test_revert_swaps_previous_back_and_keeps_the_bad_build_one_step_away(frontend: Path):
    _live_build(frontend, "good")
    fb.build_and_swap(frontend, run_build=_good_builder("bad"), log=lambda s: None)
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "bad"

    result = fb.revert(frontend, log=lambda s: None)

    assert result.build_id == "good"
    assert result.previous_build_id == "bad"
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "good"
    assert (frontend / fb.LIVE_NAME / "marker-of-old-build").exists()
    assert fb.read_build_id(frontend / fb.PREVIOUS_NAME) == "bad"
    assert fb.verify_build_dir(frontend / fb.LIVE_NAME) == "good"


def test_revert_without_previous_build_refuses(frontend: Path):
    _live_build(frontend, "only")
    with pytest.raises(fb.FrontendBuildError, match="no previous build to revert to"):
        fb.revert(frontend, log=lambda s: None)
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "only"


def test_revert_refuses_an_incomplete_previous_build(frontend: Path):
    _live_build(frontend, "live")
    prev = frontend / fb.PREVIOUS_NAME
    _write_complete_build(prev, "broken")
    (prev / "BUILD_ID").unlink()
    with pytest.raises(fb.FrontendBuildError, match="BUILD_ID is missing"):
        fb.revert(frontend, log=lambda s: None)
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "live"


def test_revert_while_lock_held_fails_loudly(frontend: Path):
    _live_build(frontend, "live")
    _write_complete_build(frontend / fb.PREVIOUS_NAME, "prev")
    lock_path = frontend / fb.LOCK_NAME
    lock_path.touch()
    holder = open(lock_path, "a+")
    fcntl.flock(holder.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        with pytest.raises(fb.FrontendBuildError, match="another frontend build is already in progress"):
            fb.revert(frontend, log=lambda s: None)
    finally:
        fcntl.flock(holder.fileno(), fcntl.LOCK_UN)
        holder.close()
    assert fb.read_build_id(frontend / fb.LIVE_NAME) == "live"


# --- swap primitive and guards -------------------------------------------------


def test_swap_in_falls_back_to_plain_renames_without_rename_exchange(frontend: Path, monkeypatch):
    _live_build(frontend, "old")
    built = _mirror(frontend) / fb.LIVE_NAME
    _write_complete_build(built, "new")
    monkeypatch.setattr(fb, "_renameat2_exchange", lambda a, b: False)

    live, previous_id = fb.swap_in(built, frontend)

    assert previous_id == "old"
    assert fb.read_build_id(live) == "new"
    assert fb.read_build_id(frontend / fb.PREVIOUS_NAME) == "old"
    assert not built.exists()


def test_swap_in_uses_rename_exchange_when_available(frontend: Path):
    # On this host (Linux, glibc 2.28+, ext4) the real syscall is used;
    # prove it exchanged rather than silently falling back by checking it
    # returns True on two real directories in different parents (the
    # mirror's .next and frontend/.next, as in production).
    a = _mirror(frontend) / fb.LIVE_NAME
    b = frontend / fb.LIVE_NAME
    a.mkdir(parents=True)
    b.mkdir()
    (a / "who").write_text("a")
    (b / "who").write_text("b")
    if not fb._renameat2_exchange(a, b):
        pytest.skip("RENAME_EXCHANGE not supported on this filesystem")
    assert (a / "who").read_text() == "b"
    assert (b / "who").read_text() == "a"


def test_swap_in_refuses_when_live_missing_but_previous_exists(frontend: Path):
    # H51 review gap 1: a kill inside the plain-rename fallback's window
    # (old live renamed to .next-prev, the new build not yet renamed into
    # live) leaves exactly this shape: no live, but a real previous build.
    # The old code ran `_safe_rmtree(previous)` unconditionally before ever
    # checking whether `live` existed, so a later swap_in call would have
    # silently deleted the only good build left and reported
    # previous_build_id as None. It must refuse instead, and previous must
    # come out of this call completely untouched.
    previous = frontend / fb.PREVIOUS_NAME
    _write_complete_build(previous, "only-good-build")
    (previous / "marker-of-only-good-build").write_text("keep me")
    before = _snapshot(previous)
    built = _mirror(frontend) / fb.LIVE_NAME
    _write_complete_build(built, "new")

    assert not (frontend / fb.LIVE_NAME).exists()
    with pytest.raises(fb.FrontendBuildError, match="is missing but .* exists"):
        fb.swap_in(built, frontend)

    assert fb.read_build_id(previous) == "only-good-build"
    assert _snapshot(previous) == before
    assert built.exists()  # the new build was never touched either
    assert not (frontend / fb.LIVE_NAME).exists()


def test_swap_in_still_works_normally_when_neither_live_nor_previous_exist(frontend: Path):
    # Guard against the gap-1 fix being too broad: the ordinary first-ever-
    # build shape (no live, no previous) must still succeed exactly as
    # before, since there is nothing to lose there.
    built = _mirror(frontend) / fb.LIVE_NAME
    _write_complete_build(built, "first")

    live, previous_id = fb.swap_in(built, frontend)

    assert previous_id is None
    assert fb.read_build_id(live) == "first"
    assert not (frontend / fb.PREVIOUS_NAME).exists()


def test_safe_rmtree_refuses_anything_that_is_not_a_managed_dir(frontend: Path, tmp_path: Path):
    other = tmp_path / "elsewhere"
    other.mkdir()
    with pytest.raises(fb.FrontendBuildError, match="refusing to delete"):
        fb._safe_rmtree(other, frontend)
    assert other.exists()
    # Source dirs inside frontend/ are never deletable either.
    with pytest.raises(fb.FrontendBuildError, match="refusing to delete"):
        fb._safe_rmtree(frontend / "app", frontend)
    assert (frontend / "app").exists()
    # Nor is a sibling of frontend/ that is not the mirror.
    sibling = frontend.parent / "backend"
    sibling.mkdir()
    with pytest.raises(fb.FrontendBuildError, match="refusing to delete"):
        fb._safe_rmtree(sibling, frontend)
    assert sibling.exists()


def test_status_reports_all_three_dirs(frontend: Path):
    _live_build(frontend, "live")
    _write_complete_build(frontend / fb.PREVIOUS_NAME, "prev")
    assert fb.status(frontend) == {"live": "live", "previous": "prev", "staging": None}
    _write_complete_build(_mirror(frontend) / fb.LIVE_NAME, "mid-build")
    assert fb.status(frontend)["staging"] == "mid-build"


# --- CLI guard ----------------------------------------------------------------


def test_cli_refuses_to_restart_the_live_service_for_a_non_default_dir(frontend: Path, capsys):
    rc = fb.main(["--frontend-dir", str(frontend)])
    assert rc == 2
    err = capsys.readouterr().err
    assert "pass --no-restart" in err


def test_cli_status_for_a_scratch_dir(frontend: Path, capsys):
    _live_build(frontend, "live")
    assert fb.main(["--frontend-dir", str(frontend), "--status"]) == 0
    out = capsys.readouterr().out
    assert "live: live" in out
    assert "previous: -" in out
