"""Tests for scripts/integrate.py's dependency-reinstall and
service-restart logic.

Everything here loads the script as a module and monkeypatches `_sh` (and
`_systemctl_restart` where relevant) so no test ever runs a real git, npm,
pip, or systemctl command.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "integrate.py"


def _load_integrate_module():
    spec = importlib.util.spec_from_file_location("integrate_script_under_test", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


integrate = _load_integrate_module()


def test_install_dependencies_pip_when_requirements_changed(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"backend/requirements.txt"})

    assert len(calls) == 1
    cmd, cwd, timeout = calls[0]
    assert cmd == [
        str(integrate.REPO_ROOT / "backend" / ".venv" / "bin" / "pip"),
        "install",
        "-q",
        "-r",
        "requirements.txt",
    ]
    assert cwd == integrate.REPO_ROOT / "backend"
    assert timeout == 900


def test_install_dependencies_npm_ci_when_package_lock_changed(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"frontend/package-lock.json"})

    assert calls == [(["npm", "ci"], integrate.REPO_ROOT / "frontend", 900)]


def test_install_dependencies_npm_ci_when_package_json_changed(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"frontend/package.json"})

    assert calls == [(["npm", "ci"], integrate.REPO_ROOT / "frontend", 900)]


def test_install_dependencies_noop_when_unrelated_change(monkeypatch):
    calls: list[tuple] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append((cmd, cwd, timeout))
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._install_dependencies({"backend/app/services/x.py"})

    assert calls == []


def test_install_dependencies_pip_failure_raises(monkeypatch):
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (1, "boom"))

    with pytest.raises(integrate.IntegrateError):
        integrate._install_dependencies({"backend/requirements.txt"})


def test_install_dependencies_npm_ci_failure_raises(monkeypatch):
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (1, "boom"))

    with pytest.raises(integrate.IntegrateError):
        integrate._install_dependencies({"frontend/package-lock.json"})


def test_restart_services_backend_change_restarts_api_and_worker(monkeypatch):
    restarted: list[str] = []
    monkeypatch.setattr(integrate, "_systemctl_restart", lambda service: restarted.append(service))
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (0, ""))

    integrate._restart_services({"backend/app/services/x.py"})

    assert restarted == ["wealth-api", "wealth-worker"]


def test_restart_services_frontend_only_change_restarts_neither_backend_service(monkeypatch):
    restarted: list[str] = []
    monkeypatch.setattr(integrate, "_systemctl_restart", lambda service: restarted.append(service))
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: (0, ""))

    integrate._restart_services({"frontend/components/Foo.tsx"})

    assert "wealth-api" not in restarted
    assert "wealth-worker" not in restarted
    assert restarted == ["wealth-frontend"]


# --- frontend gate checks (H23) -------------------------------------------
#
# scripts/session.sh finish already ran check:design-index and (H23)
# check:legal-content before pushing a branch for review, but integrate.py
# itself never re-ran them, so a merge could still land a broken privacy.md
# renumbering on main if review was skipped or predated the gate (F14,
# 2026-09-10). These tests exercise _run_frontend_checks directly with a
# fake _sh so no real npm command runs.


def test_run_frontend_checks_noop_when_frontend_and_shared_untouched(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(integrate, "_sh", lambda *a, **k: calls.append((a, k)) or (0, ""))

    integrate._run_frontend_checks({"backend/app/services/x.py"})

    assert calls == []


def test_run_frontend_checks_runs_design_index_then_legal_content_when_frontend_changed(monkeypatch):
    calls: list[list[str]] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append(cmd)
        return 0, ""

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    integrate._run_frontend_checks({"frontend/components/Foo.tsx"})

    assert calls == [
        ["npm", "run", "-s", "check:design-index"],
        ["npm", "run", "-s", "check:legal-content"],
    ]


def test_run_frontend_checks_runs_when_shared_changed(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(integrate, "_sh", lambda cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT: (calls.append(cmd), (0, ""))[1])

    integrate._run_frontend_checks({"shared/types.ts"})

    assert len(calls) == 2


def test_run_frontend_checks_raises_and_stops_on_design_index_failure(monkeypatch):
    calls: list[list[str]] = []

    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        calls.append(cmd)
        return (1, "design index broken") if cmd[-1] == "check:design-index" else (0, "")

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    with pytest.raises(integrate.IntegrateError, match="check:design-index failed"):
        integrate._run_frontend_checks({"frontend/app/page.tsx"})

    # stopped after the failing check, never ran check:legal-content
    assert calls == [["npm", "run", "-s", "check:design-index"]]


def test_run_frontend_checks_raises_on_legal_content_failure(monkeypatch):
    def fake_sh(cmd, cwd=integrate.REPO_ROOT, timeout=integrate.GIT_TIMEOUT):
        return (1, "marker contract broken") if cmd[-1] == "check:legal-content" else (0, "")

    monkeypatch.setattr(integrate, "_sh", fake_sh)

    with pytest.raises(integrate.IntegrateError, match="check:legal-content failed"):
        integrate._run_frontend_checks({"frontend/content/privacy.md"})


# --- health check retry (H24) --------------------------------------------
#
# A restart under concurrent build load can take a while to come back up
# (F14, 2026-09-10: a single poll 5s after restart hit a non-200 because
# another integrate pass was restarting services at the same moment, and a
# perfectly good merge got reverted and blocked). These tests exercise the
# retry helper directly, with real but tiny timeout/interval values so they
# stay fast without needing to fake the clock.


def test_wait_for_http_ok_succeeds_immediately_when_healthy(monkeypatch):
    monkeypatch.setattr(integrate, "_http_ok", lambda url: True)

    ok, elapsed = integrate._wait_for_http_ok("http://example.invalid/health", timeout=1, interval=0.01)

    assert ok is True
    assert elapsed >= 0


def test_wait_for_http_ok_retries_then_succeeds(monkeypatch):
    attempts = {"n": 0}

    def fake_http_ok(url):
        attempts["n"] += 1
        return attempts["n"] >= 3  # fails twice, succeeds on the third poll

    sleeps: list[float] = []
    monkeypatch.setattr(integrate, "_http_ok", fake_http_ok)
    monkeypatch.setattr(integrate.time, "sleep", lambda s: sleeps.append(s))

    ok, elapsed = integrate._wait_for_http_ok("http://example.invalid/health", timeout=1, interval=0.01)

    assert ok is True
    assert attempts["n"] == 3
    assert sleeps == [0.01, 0.01]  # slept between the two failed attempts, not after success


def test_wait_for_http_ok_gives_up_after_timeout(monkeypatch):
    monkeypatch.setattr(integrate, "_http_ok", lambda url: False)
    monkeypatch.setattr(integrate.time, "sleep", lambda s: None)

    ok, elapsed = integrate._wait_for_http_ok("http://example.invalid/health", timeout=0.05, interval=0.01)

    assert ok is False


def test_wait_and_check_health_raises_with_wait_duration_on_failure(monkeypatch):
    monkeypatch.setattr(integrate, "_wait_for_http_ok", lambda url: (False, 61.2))

    with pytest.raises(integrate.IntegrateError) as exc_info:
        integrate._wait_and_check_health()

    message = str(exc_info.value)
    assert integrate.HEALTH_URLS[0] in message
    assert "61.2" in message
    assert "retrying for" in message
    assert str(integrate.HEALTH_CHECK_TIMEOUT_S) in message


def test_wait_and_check_health_passes_when_all_urls_ok(monkeypatch):
    checked: list[str] = []

    def fake_wait(url):
        checked.append(url)
        return True, 0.0

    monkeypatch.setattr(integrate, "_wait_for_http_ok", fake_wait)

    integrate._wait_and_check_health()  # must not raise

    assert checked == integrate.HEALTH_URLS
