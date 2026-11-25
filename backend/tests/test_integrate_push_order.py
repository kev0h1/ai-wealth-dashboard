"""H156: nothing reaches origin/main until every integrate gate has passed.

Runs `_integrate_one` against REAL scratch git repos under `tmp_path` (a
bare `origin`, a "shared tree" checkout and a feature branch), never the
real repo. Only the expensive gates are faked: backend suite, frontend
checks, the staging build + swap (`_restart_services`), health checks,
systemctl and notifications.

The incident (G475, 2026-11-17): a board write from another session during
integrate's long test/build window ran `git push origin HEAD`, which
published the still-unbuilt merge. The build then failed and integrate reset
local main, leaving unbuilt code on origin/main and the shared tree diverged.
"""
from __future__ import annotations

import fcntl
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = Path(os.environ.get("INTEGRATE_SCRIPT_UNDER_TEST", REPO_ROOT / "scripts" / "integrate.py"))

TODO = """# Backlog fixture

## A. Section A heading

- [ ] **A1. First item.** [owner: claude] [state: review: feature-A1] Text.
- [ ] **A2. Second item.** [owner: claude] Text.
"""


def _load():
    spec = importlib.util.spec_from_file_location("integrate_push_order_under_test", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


integrate = _load()


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True, timeout=30
    ).stdout.strip()


class Env:
    def __init__(self, tmp_path: Path):
        self.origin = tmp_path / "origin.git"
        self.shared = tmp_path / "shared"
        _git(tmp_path, "init", "--bare", "-q", "-b", "main", str(self.origin))
        self.shared.mkdir()
        _git(self.shared, "init", "-q", "-b", "main")
        _git(self.shared, "config", "user.email", "t@example.com")
        _git(self.shared, "config", "user.name", "T")
        _git(self.shared, "remote", "add", "origin", str(self.origin))
        (self.shared / "TODO.md").write_text(TODO, encoding="utf-8")
        (self.shared / "README.md").write_text("base\n", encoding="utf-8")
        _git(self.shared, "add", "-A")
        _git(self.shared, "commit", "-q", "-m", "base")
        _git(self.shared, "push", "-q", "-u", "origin", "main")
        self.pre_sha = _git(self.shared, "rev-parse", "HEAD")
        # feature branch with a frontend change, pushed to origin only.
        _git(self.shared, "checkout", "-q", "-b", "feature-A1")
        (self.shared / "feature.txt").write_text("unbuilt code\n", encoding="utf-8")
        _git(self.shared, "add", "-A")
        _git(self.shared, "commit", "-q", "-m", "feature work")
        _git(self.shared, "push", "-q", "origin", "feature-A1")
        _git(self.shared, "checkout", "-q", "main")
        _git(self.shared, "branch", "-q", "-D", "feature-A1")
        _git(self.shared, "fetch", "-q", "origin")

    def origin_main(self) -> str:
        return _git(self.origin, "rev-parse", "main")

    def origin_has_file(self, name: str) -> bool:
        r = subprocess.run(["git", "cat-file", "-e", f"main:{name}"], cwd=self.origin, capture_output=True)
        return r.returncode == 0

    def reject_pushes_containing(self, name: str) -> None:
        hook = self.origin / "hooks" / "pre-receive"
        hook.write_text(
            "#!/bin/sh\nwhile read old new ref; do\n"
            f"  git cat-file -e \"$new:{name}\" 2>/dev/null && {{ echo 'rejected by test' >&2; exit 1; }}\n"
            "done\nexit 0\n"
        )
        hook.chmod(0o755)


@pytest.fixture
def env(tmp_path, monkeypatch):
    e = Env(tmp_path)
    real_sh = integrate._sh
    pushes: list[list[str]] = []

    def fake_sh(cmd, cwd=None, timeout=30, env=None):
        if cmd[0] == "git":
            if cmd[:2] == ["git", "push"] and "--delete" not in cmd:
                pushes.append(list(cmd))
            return real_sh(cmd, cwd=e.shared, timeout=timeout, env=env)
        return 0, ""

    e.pushes = pushes
    e.hooks = {}

    def hooking_sh(cmd, cwd=None, timeout=30, env=None):
        result = fake_sh(cmd, cwd=cwd, timeout=timeout, env=env)
        if cmd[:3] == ["git", "merge", "--no-ff"] and e.hooks.get("after_merge"):
            e.hooks["after_merge"]()
        if cmd[:2] in (["git", "reset"], ["git", "cherry-pick"]) and e.hooks.get("on_rollback_step"):
            e.hooks["on_rollback_step"](cmd)
        return result

    from app.services import backlog as _backlog
    e.real_pid_check = _backlog._pid_is_integrate
    # The code under test runs inside pytest, whose cmdline is not integrate.py.
    monkeypatch.setattr(_backlog, "_pid_is_integrate", lambda pid: pid == os.getpid())
    monkeypatch.setattr(integrate, "_sh", hooking_sh)
    monkeypatch.setattr(integrate, "REPO_ROOT", e.shared)
    monkeypatch.setattr(integrate, "WINDOW_PATH", e.shared / ".integrate-window", raising=False)
    monkeypatch.setenv("BACKLOG_ROOT", str(e.shared))
    monkeypatch.setattr(integrate, "_install_dependencies", lambda changed: None)
    monkeypatch.setattr(integrate, "_run_backend_tests", lambda: None)
    monkeypatch.setattr(integrate, "_run_frontend_checks", lambda changed: None)
    monkeypatch.setattr(integrate, "_wait_and_check_health", lambda: None)
    monkeypatch.setattr(integrate, "_find_worktree_for_branch", lambda branch: None)
    monkeypatch.setattr(integrate, "_notify_uat_ready", lambda *a, **k: None)
    monkeypatch.setattr(integrate.host_memory, "available_mb", lambda *a, **k: 99999)
    return e


def _item():
    return {"id": "A1", "branch": "feature-A1", "title": "First item"}


def _state(e: Env) -> str:
    from app.services import backlog
    doc = backlog.TodoDoc.parse((e.shared / "TODO.md").read_text(encoding="utf-8"))
    it = doc.items["A1"]
    return "done" if it.done else it.state


def test_failing_frontend_build_never_reaches_origin_even_with_a_concurrent_board_write(env, monkeypatch):
    from app.services import backlog

    def failing_build(changed):
        # Another session writes a board note while the build runs; this
        # commits and (before H156) pushed HEAD, i.e. the unbuilt merge.
        backlog.add_note("A2", "note written during the build window", actor="claude")
        raise integrate.IntegrateError("frontend build failed: boom")

    monkeypatch.setattr(integrate, "_restart_services", failing_build)

    result, detail = integrate._integrate_one(_item())

    assert result == "blocked"
    assert not env.origin_has_file("feature.txt"), "unbuilt merge reached origin/main"
    assert not (env.shared / "feature.txt").exists()
    _git(env.shared, "fetch", "-q", "origin")
    assert _git(env.shared, "rev-parse", "HEAD") == _git(env.shared, "rev-parse", "origin/main")
    assert _state(env) == "blocked"
    # the concurrent board note survived the rollback and was published
    assert "note written during the build window" in (env.shared / "TODO.md").read_text(encoding="utf-8")
    assert "note written during the build window" in _git(env.origin, "show", "main:TODO.md")
    assert not (env.shared / ".integrate-window").exists()


def test_passing_run_pushes_once_and_ticks_the_item(env, monkeypatch):
    monkeypatch.setattr(integrate, "_restart_services", lambda changed: None)

    result, detail = integrate._integrate_one(_item())

    assert result == "merged", detail
    assert env.origin_has_file("feature.txt")
    main_pushes = [p for p in env.pushes if p[:3] == ["git", "push", "origin"] and p[-1] == "main"]
    assert len(main_pushes) == 1
    assert _state(env) == "done"
    _git(env.shared, "fetch", "-q", "origin")
    assert _git(env.shared, "rev-parse", "HEAD") == _git(env.shared, "rev-parse", "origin/main")
    assert not (env.shared / ".integrate-window").exists()


def test_push_failing_after_a_passing_build_leaves_things_consistent_and_blocks(env, monkeypatch):
    env.reject_pushes_containing("feature.txt")
    restarts = []
    monkeypatch.setattr(integrate, "_restart_services", lambda changed: restarts.append(1))

    result, detail = integrate._integrate_one(_item())

    assert result == "blocked"
    assert "push" in detail
    assert not env.origin_has_file("feature.txt")
    assert not (env.shared / "feature.txt").exists()
    _git(env.shared, "fetch", "-q", "origin")
    assert _git(env.shared, "rev-parse", "HEAD") == _git(env.shared, "rev-parse", "origin/main")
    assert _state(env) == "blocked"
    assert len(restarts) == 2, "services restored from the reverted tree after the failed push"
    assert not (env.shared / ".integrate-window").exists()


def test_stale_window_marker_from_a_dead_process_does_not_stop_board_pushes(env):
    from app.services import backlog

    (env.shared / ".integrate-window").write_text("999999999\n")
    _, committed, _t = backlog.add_note("A2", "after a crashed integrate", actor="claude")
    assert committed is True
    assert "after a crashed integrate" in _git(env.origin, "show", "main:TODO.md")


def _other_clone_commit(env, tmp_path, filename, text):
    n = 0
    while (tmp_path / f"other-{n}").exists():
        n += 1
    clone = tmp_path / f"other-{n}"
    _git(tmp_path, "clone", "-q", str(env.origin), str(clone))
    _git(clone, "config", "user.email", "o@example.com")
    _git(clone, "config", "user.name", "O")
    (clone / filename).write_text(text, encoding="utf-8")
    _git(clone, "add", "-A")
    _git(clone, "commit", "-q", "-m", f"other {filename}")
    _git(clone, "push", "-q", "origin", "main")


def test_board_write_between_merge_and_the_old_window_open_never_reaches_origin(env, monkeypatch):
    from app.services import backlog

    # Fires the instant `git merge` returns: before H156 the window opened
    # only after this point, so this write pushed the unbuilt merge.
    env.hooks["after_merge"] = lambda: backlog.add_note("A2", "write in the old pre-window gap", actor="claude")
    monkeypatch.setattr(integrate, "_restart_services", lambda changed: (_ for _ in ()).throw(integrate.IntegrateError("build failed")))

    result, _ = integrate._integrate_one(_item())

    assert result == "blocked"
    assert not env.origin_has_file("feature.txt")
    _git(env.shared, "fetch", "-q", "origin")
    assert _git(env.shared, "rev-parse", "HEAD") == _git(env.shared, "rev-parse", "origin/main")
    assert "write in the old pre-window gap" in _git(env.origin, "show", "main:TODO.md")


def test_failure_opening_the_window_leaves_no_merge_on_main(env, monkeypatch):
    def boom():
        raise OSError("disk full")

    monkeypatch.setattr(integrate, "_open_window", boom)
    with pytest.raises(OSError):
        integrate._integrate_one(_item())
    assert _git(env.shared, "rev-parse", "HEAD") == env.pre_sha
    assert not (env.shared / "feature.txt").exists()


def test_marker_pid_reused_by_an_unrelated_process_is_not_active(env):
    from app.services import backlog

    backlog._pid_is_integrate = env.real_pid_check  # undo the fixture stub (monkeypatch restores it)
    proc = subprocess.Popen(["sleep", "30"])
    try:
        (env.shared / ".integrate-window").write_text(f"{proc.pid}\n")
        assert backlog.integrate_window_active(env.shared) is False
        _, committed, _t = backlog.add_note("A2", "pid reuse note", actor="claude")
        assert committed is True
        assert "pid reuse note" in _git(env.origin, "show", "main:TODO.md")
    finally:
        proc.kill()
        proc.wait()


def test_marker_pid_of_a_live_integrate_process_is_active(env):
    from app.services import backlog

    backlog._pid_is_integrate = env.real_pid_check
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", "scripts/integrate.py"])
    try:
        (env.shared / ".integrate-window").write_text(f"{proc.pid}\n")
        assert backlog.integrate_window_active(env.shared) is True
        _, committed, _t = backlog.add_note("A2", "held back note", actor="claude")
        assert committed is True
        assert "held back note" not in _git(env.origin, "show", "main:TODO.md")
    finally:
        proc.kill()
        proc.wait()


def test_origin_gaining_a_board_commit_is_rebased_over_and_pushed(env, monkeypatch, tmp_path):
    def build(changed):
        if not (tmp_path / "other-0").exists():
            _other_clone_commit(env, tmp_path, "TODO.md", TODO + "\n<!-- other session note -->\n")

    monkeypatch.setattr(integrate, "_restart_services", build)

    result, detail = integrate._integrate_one(_item())

    assert result == "merged", detail
    assert env.origin_has_file("feature.txt")
    assert "other session note" in _git(env.origin, "show", "main:TODO.md")
    _git(env.shared, "fetch", "-q", "origin")
    assert _git(env.shared, "rev-parse", "HEAD") == _git(env.shared, "rev-parse", "origin/main")
    assert _state(env) == "done"
    # exactly one successful main push; no non-fast-forward attempt first
    assert len([p for p in env.pushes if p[-1] == "main"]) == 1


def test_origin_gaining_a_non_board_commit_rolls_back_and_blocks(env, monkeypatch, tmp_path):
    done = []

    def build(changed):
        if not done:  # the rollback restarts services again; only advance origin once
            done.append(1)
            _other_clone_commit(env, tmp_path, "other.txt", "x\n")

    monkeypatch.setattr(integrate, "_restart_services", build)

    result, detail = integrate._integrate_one(_item())

    assert result == "blocked"
    assert not env.origin_has_file("feature.txt")
    assert not (env.shared / "feature.txt").exists()
    _git(env.shared, "fetch", "-q", "origin")
    assert _git(env.shared, "rev-parse", "HEAD") == _git(env.shared, "rev-parse", "origin/main")
    assert _state(env) == "blocked"


def test_rollback_holds_the_board_lock_across_reset_and_replay(env, monkeypatch):
    from app.services import backlog

    held_during = []

    def probe(cmd):
        fh = open(env.shared / ".backlog.lock", "a+")
        try:
            try:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                held_during.append((cmd[1], False))
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            except BlockingIOError:
                held_during.append((cmd[1], True))
        finally:
            fh.close()

    env.hooks["on_rollback_step"] = probe

    def failing_build(changed):
        backlog.add_note("A2", "needs replaying", actor="claude")
        raise integrate.IntegrateError("build failed")

    monkeypatch.setattr(integrate, "_restart_services", failing_build)
    integrate._integrate_one(_item())

    steps = dict(held_during)
    assert "reset" in steps and "cherry-pick" in steps, held_during
    assert all(held for _, held in held_during), held_during
    assert "needs replaying" in (env.shared / "TODO.md").read_text(encoding="utf-8")


def test_branch_already_contained_in_main_merges_nothing_and_never_uses_an_older_merge(env, monkeypatch):
    from app.services import backlog

    # Land the branch on main earlier (merge commit M), then put a board
    # commit on top so HEAD is not M.
    _git(env.shared, "merge", "-q", "--no-ff", "origin/feature-A1", "-m", "earlier merge")
    older_merge = _git(env.shared, "rev-parse", "HEAD")
    (env.shared / "README.md").write_text("later\n", encoding="utf-8")
    _git(env.shared, "commit", "-q", "-am", "later commit")
    _git(env.shared, "push", "-q", "origin", "main")
    head_before = _git(env.shared, "rev-parse", "HEAD")
    assert head_before != older_merge

    def must_not_run(*a, **k):
        raise AssertionError("gates must not run when nothing was merged")

    for name in ("_run_backend_tests", "_restart_services", "_install_dependencies", "_run_frontend_checks"):
        monkeypatch.setattr(integrate, name, must_not_run)

    result, detail = integrate._integrate_one(_item())

    assert result == "merged", detail
    assert not (env.shared / ".integrate-window").exists()
    doc = backlog.TodoDoc.parse((env.shared / "TODO.md").read_text(encoding="utf-8"))
    item = doc.items["A1"]
    assert item.done
    assert item.commit == head_before, "ticked against current main, never the older merge commit"


def test_changed_paths_raising_rolls_back_without_a_nameerror(env, monkeypatch):
    monkeypatch.setattr(integrate, "_restart_services", lambda changed: None)

    def boom(sha_range):
        raise RuntimeError("git diff exploded")

    monkeypatch.setattr(integrate, "_changed_paths", boom)

    with pytest.raises(RuntimeError, match="git diff exploded"):
        integrate._integrate_one(_item())

    assert _git(env.shared, "rev-parse", "HEAD") == env.pre_sha
    assert not (env.shared / "feature.txt").exists()
    assert not (env.shared / ".integrate-window").exists()


# --- H162: UAT never keeps a frontend build whose code is not on main -------


class _FakeFrontend:
    def __init__(self, monkeypatch, revert_fails=False):
        self.calls: list[str] = []
        self.revert_fails = revert_fails
        fb = integrate.frontend_build

        def build_and_swap(frontend_dir, *a, **k):
            self.calls.append("build")
            return fb.BuildResult("new", "old", Path("/nonexistent/.next"), Path("/nonexistent/.next-prev"))

        def revert(frontend_dir, *a, **k):
            self.calls.append("revert")
            if self.revert_fails:
                raise fb.FrontendBuildError("no previous build")
            return fb.BuildResult("old", "new", Path("/nonexistent/.next"), Path("/nonexistent/.next-prev"))

        monkeypatch.setattr(fb, "build_and_swap", build_and_swap)
        monkeypatch.setattr(fb, "revert", revert)
        monkeypatch.setattr(integrate, "_systemctl_restart", lambda svc: self.calls.append(f"restart:{svc}"))
        monkeypatch.setattr(integrate, "_changed_paths", lambda rng: {"frontend/app/x.tsx"})


def test_push_failure_after_swap_reverts_the_frontend_build(env, monkeypatch):
    env.reject_pushes_containing("feature.txt")
    fake = _FakeFrontend(monkeypatch)

    result, detail = integrate._integrate_one(_item())

    assert result == "blocked"
    assert not env.origin_has_file("feature.txt")
    # built once, then reverted; never rebuilt from the reset tree
    assert fake.calls == ["build", "restart:wealth-frontend", "revert", "restart:wealth-frontend"]


def test_push_failure_with_failed_revert_falls_back_to_rebuild(env, monkeypatch):
    env.reject_pushes_containing("feature.txt")
    fake = _FakeFrontend(monkeypatch, revert_fails=True)

    result, _ = integrate._integrate_one(_item())

    assert result == "blocked"
    assert fake.calls == ["build", "restart:wealth-frontend", "revert", "build", "restart:wealth-frontend"]


def test_failed_build_never_swapped_so_nothing_is_reverted(env, monkeypatch):
    fake = _FakeFrontend(monkeypatch)
    fb = integrate.frontend_build
    n = {"i": 0}
    orig = fb.build_and_swap

    def flaky(frontend_dir, *a, **k):
        n["i"] += 1
        if n["i"] == 1:
            fake.calls.append("build-failed")
            raise fb.FrontendBuildError("boom")
        return orig(frontend_dir)

    monkeypatch.setattr(fb, "build_and_swap", flaky)

    result, _ = integrate._integrate_one(_item())

    assert result == "blocked"
    assert "revert" not in fake.calls


def test_successful_run_never_reverts(env, monkeypatch):
    fake = _FakeFrontend(monkeypatch)

    result, detail = integrate._integrate_one(_item())

    assert result == "merged", detail
    assert fake.calls == ["build", "restart:wealth-frontend"]


# --- H162: --only filtering --------------------------------------------------


def test_filter_only_keeps_named_review_items_and_reports_the_rest(capsys):
    items = [{"id": "A1"}, {"id": "A2"}, {"id": "G495"}]
    kept = integrate._filter_only(items, ["G495", "A1", "ZZ9", " "])
    assert [i["id"] for i in kept] == ["A1", "G495"]
    out = capsys.readouterr().out
    assert "ZZ9" in out and "skipped" in out


def test_integrate_once_only_passes_named_ids_through(monkeypatch):
    seen = []
    monkeypatch.setattr(integrate, "_check_preconditions", lambda b: None)
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (0, ""))
    monkeypatch.setattr(integrate, "_locked", lambda: __import__("contextlib").nullcontext())
    monkeypatch.setattr(integrate, "_review_items", lambda: [{"id": "A1", "branch": "b", "title": "t"}, {"id": "A2", "branch": "b", "title": "t"}])
    for name in ("_rejected_items", "_cancelled_items", "_review_items_missing_branch"):
        monkeypatch.setattr(integrate, name, lambda: [])
    monkeypatch.setattr(integrate, "_integrate_one", lambda item: (seen.append(item["id"]) or ("skipped", item["id"])))

    assert integrate.integrate_once(only=["A2", "NOPE"]) == 0
    assert seen == ["A2"]
    seen.clear()
    assert integrate.integrate_once() == 0
    assert seen == ["A1", "A2"]


def test_main_parses_only(monkeypatch):
    got = {}
    monkeypatch.setattr(integrate, "integrate_once", lambda allow_branch=None, only=None: got.update(only=only) or 0)
    assert integrate.main(["--only", "F28,G495"]) == 0
    assert got["only"] == ["F28", "G495"]
    integrate.main([])
    assert got["only"] is None
