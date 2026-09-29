"""H90 parallel-collision worker A, run as its own `pytest` subprocess by
tests/test_h90_parallel_runs_do_not_collide.py -- deliberately named
without a `test_`/`_test` prefix so the normal `pytest tests` directory
walk (session.sh finish, integrate.py) never collects it on its own; it
only ever runs when the orchestrating test invokes it explicitly by path.

Writes a marker doc, waits, then re-reads it. Under the pre-H90 single
shared "wealth_test" database, a concurrent worker B finishing its own
one quick test (and firing its own session-end teardown) in that window
drops the SAME database this process is still using, and the marker
vanishes -- this file is what actually observes that and fails.

Uses its OWN standalone Motor client rather than `app.db.collections`'s
shared one: conftest.py's own autouse `_clear_response_cache` fixture
already does an `asyncio.run()` Mongo round-trip on the SHARED client
before this test's body even starts (now that H90 makes
`_mongo_cleanup_allowed()` true by construction), which binds and then
closes that client's first event loop before this test gets a turn --
see conftest.py's own docstrings for why that "first asyncio.run() in
the session wins, every later one degrades" behaviour is accepted
everywhere else. A dedicated client, used only within this one
`asyncio.run()` call end to end (insert, sleep, re-read all in the same
loop), never crosses that boundary at all -- the same reason
conftest.py's own `_drop_database_with_fresh_client`/`_sweep_stale_test_
databases` do it this way rather than reusing the app's client.
"""
import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import MONGO_URI
from app.db.collections import db as _app_db

_WAIT_SECONDS = 2.0


def test_worker_writes_marker_then_survives_a_wait():
    async def run():
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
        try:
            col = client[_app_db.name]["h90_marker"]
            await col.insert_one({"_id": "marker", "worker": "A"})
            await asyncio.sleep(_WAIT_SECONDS)
            doc = await col.find_one({"_id": "marker"})
            assert doc is not None, (
                f"H90 collision: worker A's marker doc vanished from "
                f"Mongo database {_app_db.name!r} while this process "
                f"was still mid-test -- a concurrent worker's "
                f"session-end teardown dropped this database out from "
                f"under it."
            )
        finally:
            client.close()

    asyncio.run(run())
