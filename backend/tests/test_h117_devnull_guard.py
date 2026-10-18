"""H117: nothing in the repo may atomically replace a device node (/dev/null).

The 2026-10-15 incident replaced /dev/null with a regular file. A temp file
plus os.replace / mv does exactly that when the target is a device node. No
test here touches the real /dev/null: sentinels live under tmp_path.
"""
import ast
import os
import re
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

_DIR_ONLY_ALLOW = {"scripts/frontend_build.py"}  # renames build directories, gated by _managed()
_SKIP_DIRS = {"node_modules", ".venv", ".git", "tests", ".next", ".frontend-staging"}


_IGNORED_PARTS = {
    "venv", ".venv", "node_modules", "site-packages", ".next", "out",
    ".git", ".frontend-staging", "__pycache__",
}


def tracked_files(listing: "list[str] | None" = None) -> list[Path]:
    """Tracked files only (`git ls-files`), minus venv-like and build dirs.

    Walking the tree picked up an old gitignored virtualenv in the shared
    tree (backend/venv) and blocked an integrate pass. `listing` lets a test
    pass a fake tracked list."""
    if listing is None:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=REPO, capture_output=True, text=True, check=True).stdout
        listing = [x for x in out.split("\0") if x]
    files = []
    for rel in listing:
        if _IGNORED_PARTS & set(Path(rel).parts):
            continue
        p = REPO / rel
        if p.is_file():
            files.append(p)
    return files


def _tracked(prefixes, suffix, listing=None, recursive=True):
    res = []
    for p in tracked_files(listing):
        rel = p.relative_to(REPO)
        if p.suffix != suffix:
            continue
        for pre in prefixes:
            pre_parts = Path(pre).parts
            if rel.parts[:len(pre_parts)] == pre_parts and (recursive or len(rel.parts) == len(pre_parts) + 1):
                res.append(p)
                break
    return res


def _py_files(listing=None):
    for p in _tracked(("backend", "scripts"), ".py", listing):
        if "tests" in p.relative_to(REPO).parts:
            continue
        yield p


def test_scans_ignore_untracked_and_venv_like_files(tmp_path):
    listing = [
        "backend/venv/lib/python3.12/site-packages/x/mod.py",
        "backend/.venv/lib/y.py",
        "backend/app/definitely_untracked_h117.py",
        "backend/app/core/safe_write.py",
    ]
    names = {str(p.relative_to(REPO)) for p in _py_files(listing)}
    assert names == {"backend/app/core/safe_write.py"}
    # and the real listing never includes a venv or untracked scratch file
    real = {str(p.relative_to(REPO)) for p in _py_files()}
    assert not any("site-packages" in n or "/venv/" in n for n in real)


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


_GUARD_CALLS = {"refuse_special_target", "atomic_write_text", "S_ISREG"}


def _guard_lines(scope: ast.AST) -> list[int]:
    """Lines inside `scope` that call the guard (or test S_ISREG inline)."""
    out = []
    for n in ast.walk(scope):
        name = None
        if isinstance(n, ast.Call):
            f = n.func
            name = f.id if isinstance(f, ast.Name) else f.attr if isinstance(f, ast.Attribute) else None
        elif isinstance(n, ast.Attribute):
            name = n.attr
        if name in _GUARD_CALLS:
            out.append(n.lineno)
    return out


def unguarded_renames(src: str) -> list[int]:
    """Rename/replace calls with no guard earlier in the SAME function body
    (module level counts as one scope). A marker elsewhere in the file does
    not exempt a call."""
    tree = ast.parse(src)
    bad = []

    def visit(scope, own_nodes):
        guards = _guard_lines(scope)
        for n in own_nodes:
            if isinstance(n, ast.Call) and _is_rename_call(n) and not any(g < n.lineno for g in guards):
                bad.append(n.lineno)

    def own(scope):
        # nodes belonging to this scope, not to nested functions
        stack, found = list(ast.iter_child_nodes(scope)), []
        while stack:
            n = stack.pop()
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            found.append(n)
            stack.extend(ast.iter_child_nodes(n))
        return found

    visit(tree, own(tree))
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            visit(fn, own(fn))
    return sorted(set(bad))


def test_every_rename_in_the_repo_is_guarded_or_allowlisted():
    offenders = []
    for p in _py_files():
        rel = str(p.relative_to(REPO))
        if rel in _DIR_ONLY_ALLOW:
            continue
        try:
            lines = unguarded_renames(p.read_text(encoding="utf-8"))
        except SyntaxError:
            continue
        if lines:
            offenders.append(f"{rel}:{lines}")
    assert not offenders, "rename/replace without a guard earlier in the same function: " + ", ".join(offenders)


def test_per_call_scan_catches_an_unguarded_replace_next_to_a_guarded_one():
    src = (
        "from app.core.safe_write import atomic_write_text\n"
        "import os\n"
        "def good(p):\n    atomic_write_text(p, 'x')\n"
        "def bad(tmp, p):\n    os.replace(tmp, p)\n"
    )
    assert unguarded_renames(src) == [6]
    assert unguarded_renames("import os\ndef ok(t, p):\n    from app.core.safe_write import refuse_special_target\n    refuse_special_target(p)\n    os.replace(t, p)\n") == []


_JS_RENAME = re.compile(r"\b(?:renameSync|rename)\(\s*([^,()]+(?:\([^)]*\))?)\s*,\s*([^)]+)\)")


def js_unguarded_renames(src: str) -> list[int]:
    lines = src.splitlines()
    bad = []
    for i, line in enumerate(lines):
        m = _JS_RENAME.search(line)
        if not m or "fs" not in line and "rename" not in line:
            continue
        if "renameSync" not in line and "fs.rename" not in line and "promises.rename" not in line and ".rename(" not in line:
            continue
        dest = m.group(2).strip()
        if dest[:1] in "'\"`" and "${" not in dest:
            continue  # literal destination
        window = "\n".join(lines[max(0, i - 6):i])
        if not re.search(r"isFile\(\)|isCharacterDevice|S_IFREG|lstat|stat\(", window):
            bad.append(i + 1)
    return bad


def test_mjs_renames_with_non_literal_destination_are_guarded():
    bad = []
    for p in _tracked(("frontend/scripts",), ".mjs", recursive=False):
        for ln in js_unguarded_renames(p.read_text(encoding="utf-8")):
            bad.append(f"{p.relative_to(REPO)}:{ln}")
    assert not bad, "fs rename with a variable destination and no stat guard: " + ", ".join(bad)
    assert js_unguarded_renames("fs.renameSync(tmp, target);\n") == [1]
    assert js_unguarded_renames("const s = fs.statSync(t); if (!s.isFile()) throw 1;\nfs.renameSync(tmp, t);\n") == []


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


# Destinations are fixed repo paths (google-services.json, its .bak, the board
# capacitor.config.json), never configurable, so they cannot resolve to a device.
_SHELL_MV_ALLOW = {
    "capacitor-spike/scripts/apply-board-flavor.sh",
    "capacitor-spike/scripts/build-board-web-assets.sh",
    "capacitor-spike/scripts/setup-android-push.sh",
}


def test_shell_mv_onto_variable_is_guarded():
    bad = []
    for p in _tracked(("scripts", "frontend/scripts", "capacitor-spike"), ".sh"):
        if str(p.relative_to(REPO)) in _SHELL_MV_ALLOW:
            continue
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
