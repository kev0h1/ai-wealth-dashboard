"""H117: nothing in the repo may atomically replace a device node (/dev/null).

The 2026-10-15 incident replaced /dev/null with a regular file. A temp file
plus os.replace / mv does exactly that when the target is a device node. No
test here touches the real /dev/null: sentinels live under tmp_path.
"""
import ast
import os
import stat
import subprocess
from pathlib import Path

import pytest

from app.core.safe_write import UnsafeWriteTarget, atomic_write_text, refuse_special_target

REPO = Path(__file__).resolve().parents[2]


def _sentinel_device(tmp_path: Path) -> Path:
    """A device-like sentinel: a char device when mknod is allowed, else a fifo.
    Either is a non-regular file, which is what the guard must protect."""
    p = tmp_path / "devnull"
    try:
        os.mknod(p, 0o666 | stat.S_IFCHR, os.makedev(1, 3))
    except (PermissionError, OSError):
        os.mkfifo(p)
    return p


def test_unguarded_replace_clobbers_a_device_node(tmp_path):
    """Reproduction of the mechanism, on a scratch sentinel only."""
    node = _sentinel_device(tmp_path)
    before = os.stat(node)
    tmp = tmp_path / "devnull.tmp"
    tmp.write_text("x")
    os.replace(tmp, node)
    after = os.stat(node)
    assert stat.S_ISREG(after.st_mode) and not stat.S_ISREG(before.st_mode)


def test_atomic_write_text_refuses_device_node(tmp_path):
    node = _sentinel_device(tmp_path)
    before = os.stat(node)
    with pytest.raises(UnsafeWriteTarget):
        atomic_write_text(node, "boom")
    after = os.stat(node)
    assert (after.st_ino, after.st_mode) == (before.st_ino, before.st_mode)
    assert not list(tmp_path.glob("devnull.tmp*"))


def test_refuses_symlink_to_device_node(tmp_path):
    node = _sentinel_device(tmp_path)
    link = tmp_path / "link"
    link.symlink_to(node)
    with pytest.raises(UnsafeWriteTarget):
        refuse_special_target(link)


def test_regular_and_missing_targets_still_work(tmp_path):
    target = tmp_path / "TODO.md"
    atomic_write_text(target, "one")
    atomic_write_text(target, "two")
    assert target.read_text() == "two"
    assert not list(tmp_path.glob("*.tmp*"))


def test_backlog_atomic_write_uses_the_guard(tmp_path):
    from app.services import backlog
    node = _sentinel_device(tmp_path)
    before = os.stat(node)
    with pytest.raises(UnsafeWriteTarget):
        backlog._atomic_write(node, "boom")
    assert os.stat(node).st_ino == before.st_ino


def test_real_devnull_is_refused_without_touching_it():
    """Guard check only; refuse_special_target never writes."""
    before = os.stat(os.devnull)
    with pytest.raises(UnsafeWriteTarget):
        refuse_special_target(os.devnull)
    after = os.stat(os.devnull)
    assert stat.S_ISCHR(after.st_mode) and after.st_rdev == before.st_rdev


# -- repo-wide scan --------------------------------------------------------

# Files whose rename/replace targets are directories under a managed path
# (frontend_build._managed) or that route through the guard.
_RENAME_NAMES = {"replace", "rename", "move", "renames"}
_GUARDED_MARKERS = ("refuse_special_target", "atomic_write_text", "S_ISREG")
_DIR_ONLY_ALLOW = {"scripts/frontend_build.py"}  # renames build directories, gated by _managed()
_SKIP_DIRS = {"node_modules", ".venv", ".git", "tests", ".next", ".frontend-staging"}


def _py_files():
    for root in ("backend", "scripts"):
        for p in (REPO / root).rglob("*.py"):
            if _SKIP_DIRS & set(p.relative_to(REPO).parts):
                continue
            yield p


def _is_rename_call(node: ast.Call) -> bool:
    f = node.func
    if isinstance(f, ast.Attribute) and f.attr in _RENAME_NAMES:
        base = f.value
        # os.replace / os.rename / shutil.move, and Path.replace(...) with one arg.
        if isinstance(base, ast.Name) and base.id in {"os", "shutil"}:
            return True
        if f.attr in {"replace", "rename"} and len(node.args) == 1 and not node.keywords:
            # str.replace takes two args, so a single-arg .replace is a Path rename.
            return f.attr == "rename" or isinstance(node.args[0], (ast.Name, ast.Attribute))
    return False


def test_every_rename_in_the_repo_is_guarded_or_allowlisted():
    offenders = []
    for p in _py_files():
        src = p.read_text(encoding="utf-8")
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue
        rel = str(p.relative_to(REPO))
        calls = [n.lineno for n in ast.walk(tree) if isinstance(n, ast.Call) and _is_rename_call(n)]
        if calls and rel not in _DIR_ONLY_ALLOW and not any(m in src for m in _GUARDED_MARKERS):
            offenders.append(f"{rel}:{calls}")
    assert not offenders, "rename/replace without the H117 device-node guard: " + ", ".join(offenders)


def test_no_path_variable_defaults_to_devnull_for_writing():
    bad = []
    for p in _py_files():
        for n in ast.walk(ast.parse(p.read_text(encoding="utf-8"))):
            targets = []
            if isinstance(n, ast.Assign):
                targets = [t.id for t in n.targets if isinstance(t, ast.Name)]
                value = n.value
            elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and n.value is not None:
                targets, value = [n.target.id], n.value
            else:
                continue
            text = ast.unparse(value)
            if ("/dev/null" in text or "os.devnull" in text) and any(
                k in t.lower() for t in targets for k in ("out", "dest", "target", "path", "file", "log")
            ):
                bad.append(f"{p.relative_to(REPO)}:{n.lineno}")
    assert not bad, "a write-target variable is set to /dev/null: " + ", ".join(bad)


def test_shell_mv_onto_variable_is_guarded():
    bad = []
    for p in list((REPO / "scripts").glob("*.sh")) + list((REPO / "frontend" / "scripts").glob("*.sh")):
        lines = p.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            s = line.strip()
            if s.startswith("#") or not (s.startswith("mv ") or " mv " in s):
                continue
            window = "\n".join(lines[max(0, i - 4):i])
            if "! -f" not in window:
                bad.append(f"{p.relative_to(REPO)}:{i + 1}")
    assert not bad, "mv without a regular-file guard: " + ", ".join(bad)


def test_fuel_collector_refuses_device_target(tmp_path, monkeypatch):
    import importlib.util
    spec = importlib.util.spec_from_file_location("fuel_collector_h117", REPO / "backend" / "fuel_finder_collector.py")
    mod = importlib.util.module_from_spec(spec)
    monkeypatch.setenv("FUEL_FINDER_CLIENT_ID", "x")
    monkeypatch.setenv("FUEL_FINDER_CLIENT_SECRET", "x")
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "CACHE_DIR", str(tmp_path))
    node = _sentinel_device(tmp_path)
    before = os.stat(node)
    with pytest.raises(OSError):
        mod._atomic_write("devnull", {"a": 1})
    assert os.stat(node).st_ino == before.st_ino


def test_refresh_script_guard_blocks_mv(tmp_path):
    """Run just the guard line from refresh_fuel_cache.sh against a sentinel."""
    node = _sentinel_device(tmp_path)
    src = (REPO / "scripts" / "refresh_fuel_cache.sh").read_text()
    guard = next(l for l in src.splitlines() if l.startswith('if [ -e "$OUT" ]'))
    tmp = tmp_path / "t.json"
    tmp.write_text("{}")
    r = subprocess.run(["bash", "-c", f'OUT="{node}"; TMP="{tmp}"; {guard}; mv "$TMP" "$OUT"'],
                       capture_output=True, text=True)
    assert r.returncode == 1 and "refusing" in r.stderr
    assert not stat.S_ISREG(os.stat(node).st_mode)
