#!/usr/bin/env python3
"""Assert both database-drop guards exist and are unmodified (H96).

Guard 1: backend/tests/conftest.py (_looks_like_a_test_database and friends).
Guard 2: backend/app/db/guard.py (assert_drop_allowed and friends).

On 2026-09-28 a reviewer mutated guard 1 and the suite dropped the real UAT
database. This check hashes the source of every guard function so such a
mutation fails `scripts/session.sh finish`. It reads files only; it never
connects to Mongo and never runs the guarded code.

If you change a guard ON PURPOSE, re-pin: run

    backend/.venv/bin/python scripts/check_db_guard.py --print-hashes

paste the new values into PINNED below in the same commit, and explain why in
the commit message and the board note. Weakening a guard needs Kevin's say-so.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFTEST = ROOT / "backend" / "tests" / "conftest.py"
GUARD = ROOT / "backend" / "app" / "db" / "guard.py"
APP = ROOT / "backend" / "app"

# file -> {name of top-level def/class/assignment: sha256 of its exact source}
PINNED: dict[str, dict[str, str]] = {
    "backend/tests/conftest.py": {
        "_TEST_DB_PREFIX_RE": "b3b9e63130c2aac9fb7b1c7c734eb8817a27973d652c65856ab68421ab56e4bd",
        "_looks_like_a_test_database": "46172f1e7f7d4053e27e29830905d86aaf7898c1a27e4de25f7d1f079d02af1b",
        "_refuse_unless_test_db": "1085f72fad9f72f0aa5e35dcc0f6989360b4659bd5f673fbc3632fd08772e0b5",
        "_drop_database_with_fresh_client": "13bc3d781feafaf1b10cd4399c5986adab89311feda6bcd32bf84dce9b9bbbdf",
        "_drop_test_database_at_session_end": "c2fa93ef97fefe8f00313a758f3d6bfb5c566f0f52f23c8fb0c97eddde9cea3d",
        "_sweep_stale_test_databases": "d03a241156de27a5564b0aab08779b862c9c0cddb3f5a65095c92148cf6cbc0d"
    },
    "backend/app/db/guard.py": {
        "TEST_DB_NAME_RE": "a2cda4adc875d88601269cbc48ceaa2f9cab4809968a4d19e1d8e23c0f9c039b",
        "ALLOW_ENV": "e22c731813dc126a4c27d19defe35ecd8d63c97064363bbb3a7334e8d8eb4640",
        "DropDatabaseRefused": "6ba078a2f4c5809c090e9f50487b2fb73f146746be3ea224ce5c69778e873e53",
        "assert_drop_allowed": "a58b72f65d736f789ff0d01f9572993659b13b6ea215fe9030952f9dcb242eed",
        "guarded_drop_database": "8acf0c2cb62c4dfa41c2a9971d3661f745211853f013d3063557d0edc1ecbffc",
        "guarded_drop_collection": "f62383fa5dda93bcbfe831e796f1c5a7ec45a96721f5f7f5ccc725d21d0afa6e",
        "make_guarded_client_class": "d30ef1891fe49f6b032e787f8ea3c64ab17d3966e6fdba57ea859e16c1fa6425"
    }
}


def _segments(path: Path, names: list[str]) -> dict[str, str]:
    src = path.read_text()
    tree = ast.parse(src)
    found: dict[str, str] = {}
    for node in tree.body:
        targets: list[str] = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            targets = [node.name]
        elif isinstance(node, ast.Assign):
            targets = [t.id for t in node.targets if isinstance(t, ast.Name)]
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            targets = [node.target.id]
        for t in targets:
            if t in names:
                seg = ast.get_source_segment(src, node) or ""
                found[t] = seg
    return found


WATCHED = {
    "backend/tests/conftest.py": [
        "_TEST_DB_PREFIX_RE", "_looks_like_a_test_database", "_refuse_unless_test_db",
        "_drop_database_with_fresh_client", "_drop_test_database_at_session_end",
        "_sweep_stale_test_databases",
    ],
    "backend/app/db/guard.py": [
        "TEST_DB_NAME_RE", "ALLOW_ENV", "DropDatabaseRefused", "assert_drop_allowed",
        "guarded_drop_database", "guarded_drop_collection", "make_guarded_client_class",
    ],
}


def _raw_drops(py: Path) -> list[str]:
    """AST scan: .drop_database(...), .drop_collection(...), .drop() on a
    collection-like expression, and command("dropDatabase"/"drop")."""
    try:
        tree = ast.parse(py.read_text())
    except (OSError, SyntaxError):
        return []
    rel = py.relative_to(ROOT)
    found: list[str] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        attr = node.func.attr
        if attr in ("drop_database", "drop_collection"):
            found.append(f"{rel}:{node.lineno}: raw {attr}(); use app.db.guard")
        elif attr == "drop" and not node.args and not node.keywords:
            found.append(f"{rel}:{node.lineno}: raw .drop() on a collection; use app.db.guard")
        elif attr == "command" and node.args and isinstance(node.args[0], ast.Constant) \
                and str(node.args[0].value).lower() in ("dropdatabase", "drop"):
            found.append(f"{rel}:{node.lineno}: raw command({node.args[0].value!r}); use app.db.guard")
    return found


def _conftest_drop_sites() -> list[str]:
    """Both conftest drop sites (_drop_database_with_fresh_client and
    _sweep_stale_test_databases) must call guarded_drop_database."""
    try:
        tree = ast.parse(CONFTEST.read_text())
    except (OSError, SyntaxError) as exc:
        return [f"cannot parse conftest: {exc}"]
    out = []
    for fn in ("_drop_database_with_fresh_client", "_sweep_stale_test_databases"):
        node = next((n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == fn), None)
        calls = [c for c in ast.walk(node) if isinstance(c, ast.Call)
                 and isinstance(c.func, ast.Name) and c.func.id == "guarded_drop_database"] if node else []
        if not calls:
            out.append(f"backend/tests/conftest.py: {fn} must drop through app.db.guard.guarded_drop_database")
    return out


def compute() -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    for rel, names in WATCHED.items():
        segs = _segments(ROOT / rel, names)
        out[rel] = {n: hashlib.sha256(segs[n].encode()).hexdigest() for n in names if n in segs}
    return out


def check() -> list[str]:
    problems: list[str] = []
    try:
        current = compute()
    except (OSError, SyntaxError) as exc:
        return [f"cannot read a guard file: {exc}"]
    for rel, names in WATCHED.items():
        for n in names:
            have = current.get(rel, {}).get(n)
            want = PINNED.get(rel, {}).get(n)
            if have is None:
                problems.append(f"{rel}: guard `{n}` is missing")
            elif have != want:
                problems.append(f"{rel}: guard `{n}` was modified (hash {have[:12]}, pinned {str(want)[:12]})")
    problems += _conftest_drop_sites()
    colls = (APP / "db" / "collections.py").read_text()
    if "make_guarded_client_class" not in colls:
        problems.append("backend/app/db/collections.py: the app's Mongo client is not the guarded client")
    for py in [*APP.rglob("*.py"), *(ROOT / "backend" / "tests").rglob("*.py")]:
        # test_db_guard.py drives a fake client's drop_database on purpose.
        if py == GUARD or py.name == "test_db_guard.py":
            continue
        problems += _raw_drops(py)
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--print-hashes", action="store_true", help="print current hashes in PINNED form and exit")
    args = ap.parse_args(argv)
    if args.print_hashes:
        import json
        print(json.dumps(compute(), indent=4))
        return 0
    problems = check()
    if problems:
        print("DB guard check FAILED (H96):", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        print("A drop guard was removed or changed. Do not probe guards by running the suite "
              "against a real database; see docs/ops/INCIDENTS.md.", file=sys.stderr)
        return 1
    print("DB guards present and unmodified.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
