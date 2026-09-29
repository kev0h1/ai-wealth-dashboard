"""H90 round three (finding 3, 2026-09-28): `os.environ.setdefault
("MONGO_DB", ...)` (conftest.py's original mechanism) only fills in
MONGO_DB when it is ABSENT from the environment. MONGO_DB="" (present,
but empty) or whitespace-only sails straight through unchanged, and
`app/db/collections.py`'s `_mongo[MONGO_DB]` then raises pymongo's
`InvalidName: database name cannot be the empty string` the instant
`app.db.collections` is imported -- which happens transitively from
conftest.py's own `import app.routers.billing` line, well before
`_refuse_unless_test_db` (the fail-hard guard) ever gets a chance to
run and produce a useful message. An empty MONGO_DB is exactly the kind
of thing a bad merge, a stray shell export, or a misconfigured CI step
could produce by accident, and the failure mode before this fix was an
opaque pymongo traceback rather than either "collected fine, ran against
a fresh per-run test database" or a clear refusal.

The fix treats empty/whitespace-only MONGO_DB the same as the missing
case: conftest.py's very first statement now checks `.strip()` before
deciding whether to generate a fresh name, not just presence.

Proven with a real subprocess (never by monkeypatching os.environ
in-process, which cannot exercise a fix that lives in conftest.py's own
module-level bootstrap, run once per process before any test function
exists) -- tests/_h90_worker_resolved_db_name.py asserts
`app.db.collections.db.name` starts with "wealth_test"; this file runs
that worker with MONGO_DB explicitly set to "" and to whitespace-only,
and asserts each subprocess collects and passes rather than crashing on
import.
"""
import subprocess
from pathlib import Path

import pytest

_TESTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _TESTS_DIR.parent
_VENV_PYTHON = _BACKEND_DIR / ".venv" / "bin" / "python"
_WORKER = _TESTS_DIR / "_h90_worker_resolved_db_name.py"


@pytest.mark.parametrize("mongo_db_value", ["", "   ", "\t"])
def test_worker_resolves_a_fresh_name_when_mongo_db_is_empty_or_blank(mongo_db_value):
    env = {}
    import os
    env.update(os.environ)
    env["MONGO_DB"] = mongo_db_value

    proc = subprocess.run(
        [str(_VENV_PYTHON), "-m", "pytest", "-q", str(_WORKER)],
        cwd=_BACKEND_DIR, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        timeout=30,
    )
    assert proc.returncode == 0, (
        f"worker subprocess with MONGO_DB={mongo_db_value!r} did not "
        f"collect and pass cleanly:\n{proc.stdout}"
    )
