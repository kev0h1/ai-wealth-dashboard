"""H90 review round (finding 3, 2026-09-28): `_sweep_stale_test_databases`
(backend/tests/conftest.py) must not infer a database is abandoned from
AGE alone. Before this fix it did exactly that -- any
"wealth_test_<epoch>_<hex>" database older than an hour was dropped on
sight by any OTHER session's own collection-time sweep, regardless of
whether its owning process was still running. On a box that has been
memory-starved all day, a legitimately slow suite run past the one-hour
mark is not far-fetched, and the H96 reviewer reproduced the collision
directly against throwaway names.

The fix adds a liveness check (`_has_a_live_owner`, via a non-blocking
`flock` probe on a per-database lockfile each session holds for its own
lifetime) as a SECOND, required condition alongside age. This file
proves both halves: an old database with a live owner survives a sweep;
an old database with no owner (the lock never taken, or already
released) is still reaped exactly as before.

Every database this file touches is itself created with the
"wealth_test_..." naming convention (never anything resembling "wealth")
and is dropped again by this file's own cleanup regardless of which
assertion runs, real or not.
"""
import asyncio
import time
import uuid

import conftest
from app.core.config import MONGO_URI
from motor.motor_asyncio import AsyncIOMotorClient

_OLD_ENOUGH_SECONDS = conftest._STALE_TEST_DB_AGE_SECONDS + 600  # comfortably past the threshold


def _old_test_db_name() -> str:
    old_epoch = int(time.time()) - _OLD_ENOUGH_SECONDS
    return f"wealth_test_{old_epoch}_{uuid.uuid4().hex[:8]}"


async def _seed_marker(name: str) -> None:
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
    try:
        await client[name]["marker"].insert_one({"note": "H90 liveness test fixture"})
    finally:
        client.close()


async def _database_exists(name: str) -> bool:
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
    try:
        return name in await client.list_database_names()
    finally:
        client.close()


async def _drop(name: str) -> None:
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
    try:
        await client.drop_database(name)
    finally:
        client.close()


def test_old_database_with_a_live_owner_is_not_dropped():
    name = _old_test_db_name()
    asyncio.run(_seed_marker(name))
    conftest._acquire_own_lock(name)  # simulates: another session still owns this database
    try:
        dropped = asyncio.run(
            conftest._sweep_stale_test_databases(own_name="wealth_test_unrelated_sentinel")
        )
        assert name not in dropped, (
            f"{name!r} has a live owner (its lock is held) and is well "
            f"past the age threshold -- the sweep must not have dropped "
            f"it just because it looks old."
        )
        assert asyncio.run(_database_exists(name)), (
            f"{name!r} vanished even though the sweep claims it wasn't "
            f"the one that dropped it."
        )
    finally:
        conftest._release_own_lock(name)
        asyncio.run(_drop(name))


def test_old_database_with_no_owner_is_still_reaped():
    """Control case: same age, but no lock ever taken for this name --
    the sweep's pre-liveness-check behaviour, which must still hold."""
    name = _old_test_db_name()
    asyncio.run(_seed_marker(name))
    try:
        dropped = asyncio.run(
            conftest._sweep_stale_test_databases(own_name="wealth_test_unrelated_sentinel")
        )
        assert name in dropped, (
            f"{name!r} is old and has no lock held for it anywhere -- "
            f"the sweep should have reaped it."
        )
        assert not asyncio.run(_database_exists(name))
    finally:
        # Best-effort: if the assertion above already failed because the
        # sweep dropped it, this is a no-op; if the sweep somehow didn't,
        # this still cleans up rather than leaving fixture debris.
        asyncio.run(_drop(name))
