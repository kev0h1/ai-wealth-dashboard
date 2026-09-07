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
