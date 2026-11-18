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
    monkeypatch.setattr(integrate, "_sh", fake_sh)
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
