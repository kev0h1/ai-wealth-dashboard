"""H158: the backend image holds only backend/, so the icon manifest must ship inside app/."""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent


def test_backend_copy_matches_shared_source():
    shared = (REPO / "shared" / "category-icons.json").read_bytes()
    assert (BACKEND / "app" / "data" / "category-icons.json").read_bytes() == shared, \
        "copy shared/category-icons.json to backend/app/data/category-icons.json"


def _copy_backend_only(tmp_path: Path) -> Path:
    dest = tmp_path / "app_root"
    dest.mkdir()
    shutil.copytree(BACKEND / "app", dest / "app", ignore=shutil.ignore_patterns("__pycache__"))
    return dest


_PROBE = (
    "import sys\n"
    "from app.services import category_icons as c\n"
    "{extra}\n"
    "c.check_manifest()\n"
    "print(c.builtin_icon_key('Rent'), c.fallback_icon_key())\n"
)


def _run(root: Path, extra: str = ""):
    return subprocess.run(
        [sys.executable, "-c", _PROBE.format(extra=extra)],
        cwd=root, capture_output=True, text=True,
        env={"PYTHONPATH": str(root), "PATH": "/usr/bin:/bin", "MONGO_DB": "wealth_test_h158", "FORBID_LIVE_QUEUE": "1"},
    )


def test_manifest_loads_in_backend_only_tree(tmp_path):
    root = _copy_backend_only(tmp_path)
    assert not (tmp_path / "shared").exists()
    out = _run(root)
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.split()[0] == "key"


def test_missing_manifest_fails_loudly(tmp_path):
    root = _copy_backend_only(tmp_path)
    (root / "app" / "data" / "category-icons.json").unlink()
    out = _run(root)
    assert out.returncode != 0
    assert "Category icon manifest unusable" in out.stderr


def test_invalid_manifest_fails_loudly(tmp_path):
    root = _copy_backend_only(tmp_path)
    (root / "app" / "data" / "category-icons.json").write_text('{"version": 2}')
    out = _run(root)
    assert out.returncode != 0
    assert "Category icon manifest unusable" in out.stderr


def test_startup_hook_registered():
    src = (BACKEND / "app" / "main.py").read_text()
    assert "_check_category_icon_manifest" in src and "check_manifest()" in src
