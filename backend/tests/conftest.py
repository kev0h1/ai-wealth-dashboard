import asyncio
import os

import pytest

from app.services import data_version, response_cache


def _mongo_cleanup_allowed() -> bool:
    """Gate for `_best_effort_clear_mongo_cache_state` — this codebase has
    no separate test-database config (`app/db/collections.py` hardcodes the
    "wealth" db; there's no MONGO_DB env var to key off), so the only way to
    guarantee this fixture never wipes the real app's cache/version
    collections is an explicit opt-in: set TEST_DB=1, or point MONGO_URI at
    a database literally named/suffixed "_test". Neither is set by default
    in this environment, so by default this cleanup simply does not run —
    see the fixture's own docstring for why that's still safe."""
    if os.getenv("TEST_DB") == "1":
        return True
    from app.db.collections import db as _app_db
    return _app_db.name.endswith("_test")


async def _best_effort_clear_mongo_cache_state():
    """Wipe the Mongo-backed halves of the cache too (`response_cache_col`,
    `user_data_version_col`) — see the fixture's own docstring for why this
    is unconditionally wrapped in try/except by the caller rather than
    awaited for real success. No mongomock in this environment; this talks
    to the real local Mongo (only when `_mongo_cleanup_allowed()` says so)."""
    from app.db.collections import response_cache_col, user_data_version_col
    await response_cache_col.delete_many({})
    await user_data_version_col.delete_many({})


@pytest.fixture(autouse=True)
def _clear_response_cache():
    """`response_cache._caches` is process-global in-memory state (see
    app/services/response_cache.py's own module docstring) — by design, so
    a real request's write-then-read within the same TTL window is a cache
    hit. Several unit tests call router handler functions directly with a
    shared/fixed test UID (e.g. tests/test_grow.py's `UID =
    "kevin@example.com"`), bypassing the per-request isolation an actual
    HTTP client would have. Without a reset between tests, a cache entry
    written by one test (e.g. grow_view's own "grow" cache, or
    get_cached_safe_to_spend's "safe_to_spend" read-through) leaks into a
    later test for the same UID and silently shadows that test's
    monkeypatched collaborators. Clearing before AND after each test keeps
    this test process's cache state from ever crossing a test boundary in
    either direction.

    `data_version._memo` (the 1 s in-process version memo) is cleared
    alongside it for the same reason — a fresh memo from an earlier test
    must not answer a later test's version check.

    Phase 2 (data_version.py/response_cache.py) added a Mongo-backed layer
    behind aget/aput that this fixture cannot really reach in THIS
    environment's default configuration: `_mongo_cleanup_allowed()` keeps
    the real-Mongo `delete_many` OFF unless a test database is explicitly
    configured (TEST_DB=1, or a "..._test" suffixed DB) — this repo's
    configured Mongo IS the real app's "wealth" database (no separate test
    DB wired up), and a test run must never quietly wipe its cache/version
    state out from under the real app between runs of this suite.

    With that cleanup off by default, the SOLE protection against
    cross-test/cross-session Mongo leakage is the same one already relied
    on before this fixture existed: per test_notifications.py's own note,
    this environment has no mongomock, and the real Motor client can only
    be driven from ONE asyncio event loop for its whole process lifetime —
    the first `asyncio.run()` in the whole test session that touches it
    "wins", and every later one raises "Event loop is closed", which
    response_cache.py/data_version.py already catch and degrade from (log +
    treat as a miss/no-op). The net effect for the suite: at most the ONE
    first-to-touch-Mongo test in a session risks reading a stale leftover
    doc; every other test's Mongo layer behaves as unreachable, and the
    still-cleared in-memory layer above means it still recomputes fresh.
    Real Mongo-layer behaviour is exercised deterministically instead in
    tests/test_response_cache_v2.py, which monkeypatches
    response_cache_col/user_data_version_col with in-memory fakes rather
    than touching Mongo at all.
    """
    response_cache._caches.clear()
    data_version._memo.clear()
    if _mongo_cleanup_allowed():
        try:
            asyncio.run(_best_effort_clear_mongo_cache_state())
        except Exception:
            pass
    yield
    response_cache._caches.clear()
    data_version._memo.clear()
