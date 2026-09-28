"""H90 round three (finding 3) worker, run as its own `pytest` subprocess
by tests/test_h90_empty_mongo_db_resolves_to_a_test_name.py -- see
tests/_h90_worker_write_then_wait.py's own docstring for the naming and
invocation convention this shares (no `test_`/`_test` prefix, so the
normal `pytest tests` directory walk never collects it on its own).

A single assertion: whatever `MONGO_DB` this process was actually
started with, the database `app.db.collections.db` resolves to must
still look like a test database. This is what actually observes the
fix for MONGO_DB="" (or whitespace-only) crashing pymongo before
conftest.py's own guard ever gets a turn -- the fix lives in
conftest.py's FIRST statement, at collection time, so it can only be
proven by a real subprocess starting fresh with that env value, never
by monkeypatching os.environ after this process's conftest.py has
already run its module-level code once.
"""
from app.db.collections import db as _app_db


def test_resolved_db_name_still_looks_like_a_test_database():
    assert _app_db.name.startswith("wealth_test"), (
        f"resolved Mongo database {_app_db.name!r} does not start with "
        f"\"wealth_test\" -- conftest.py's empty/whitespace-MONGO_DB "
        f"handling did not regenerate a fresh per-run name as expected."
    )
