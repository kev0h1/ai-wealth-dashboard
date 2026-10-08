"""H90 parallel-collision worker B, run as its own `pytest` subprocess by
tests/test_h90_parallel_runs_do_not_collide.py -- see
tests/_h90_worker_write_then_wait.py's own docstring for the naming and
invocation convention this shares.

Directly performs what a concurrent session's session-end teardown does:
drops whatever database `MONGO_DB` resolves to for THIS process, via a
standalone client rather than `app.db.collections`'s shared one.

Why a standalone client rather than exercising the real autouse
`_drop_test_database_at_session_end` fixture end to end: that fixture's
PRE-H90 form called `drop_database` on the shared client, which by then
has almost always already been bound (and closed) by an earlier
`asyncio.run()` elsewhere in the same process (this file's own sibling,
`_clear_response_cache`, touches it on every single test) -- Motor
cannot reuse a client from a second event loop, so that call typically
raises "Event loop is closed" and is silently swallowed by the fixture's
own try/except, meaning the drop usually never actually happens at all.
That is a real, separate, already-documented limitation of this
environment (no mongomock, one asyncio loop per Motor client for its
whole process lifetime) -- worth knowing, but it is NOT what H90 is
about, and letting it gate whether this test can even observe a
collision would make the proof flaky for a reason that has nothing to do
with per-run database naming. A standalone client sidesteps it (exactly
the fix H90 itself applies to the real teardown fixture in conftest.py),
so this test reliably isolates the one thing it exists to prove: does
worker B's resolved database name collide with worker A's.
"""
import asyncio

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import MONGO_URI
from app.db.collections import db as _app_db
from app.db.guard import guarded_drop_database


def test_worker_drops_its_own_resolved_database():
    async def run():
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
        try:
            await guarded_drop_database(client, _app_db.name)
        finally:
            client.close()

    asyncio.run(run())
