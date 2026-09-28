import asyncio
import os

# H90 (2026-09-28): force every backend test process onto a disposable
# Mongo DATABASE before a single line below gets the chance to import
# anything that creates the real "wealth" collection handles.
# app/db/collections.py now reads MONGO_DB (app/core/config.py, default
# "wealth" — every real process, API and worker, never sets this and is
# therefore unaffected) to choose which database inside MONGO_URI's
# deployment it opens; setting it here, as literally the first statement
# in this file, before the `import app...` lines below, means every
# module they pull in (transitively, all the way down to
# app.db.collections) resolves against MONGO_DB, not a hardcoded
# "wealth". `os.environ.setdefault` rather than a plain assignment so an
# operator CAN point the suite at a different database on purpose (e.g. a
# CI Mongo container already set up with its own name), but see
# `_refuse_unless_test_db` below: whatever ends up in MONGO_DB, real or
# forced, MUST be "_test"-suffixed or collection aborts before any test
# runs.
#
# `app.core.config`'s `load_dotenv(..., override=False)` (the
# python-dotenv default) is why this is safe even when a real
# `backend/.env` IS on the import path (true for `scripts/integrate.py`,
# which runs the suite from the shared tree rather than a worktree, and
# whose `backend/.env` really does carry `MONGO_DB=wealth` — see
# docs/ops/ENV.md): dotenv only fills in names ABSENT from the process
# environment, and this line has already filled MONGO_DB in by the time
# `app.core.config` (imported transitively below) calls `load_dotenv`, so
# the real .env's `wealth` is never allowed to overwrite it.
os.environ.setdefault("MONGO_DB", "wealth_test")

import pytest

import app.routers.billing as billing_router_module
import app.routers.subscription as subscription_router_module
import app.services.billing as billing_module
from app.services import data_version, response_cache


def _refuse_unless_test_db() -> None:
    """Fail-hard backstop (H90). Runs once, at collection time, before any
    test in the suite executes. However MONGO_DB ended up resolved --
    the `setdefault` above, an explicit override, or (if a future refactor
    ever moves that `setdefault` below this point, or removes it) nothing
    at all -- this is the one check that cannot be bypassed by import
    order: if the database this process would touch is not "_test"-
    suffixed, abort collection outright rather than let even one test
    reach a Mongo write against what could be the real UAT/production
    "wealth" database. This is deliberately independent of, and a backstop
    for, the `os.environ.setdefault` above -- that line is the actual
    mechanism (a genuinely disposable database), this is the guard that
    fires if the mechanism is ever missing, misordered, or overridden to
    something unsafe.
    """
    from app.db.collections import db as _app_db
    if not _app_db.name.endswith("_test"):
        raise pytest.UsageError(
            f"refusing to collect the backend suite: Mongo database "
            f"{_app_db.name!r} is not \"_test\"-suffixed, so running tests "
            f"would write into what may be the real UAT/production "
            f"database. Set MONGO_DB=wealth_test (or unset MONGO_DB "
            f"entirely -- this file already defaults it to that) before "
            f"running pytest again."
        )


_refuse_unless_test_db()


@pytest.fixture(scope="session", autouse=True)
def _drop_test_database_at_session_end():
    """H90: the disposable database `MONGO_DB` points the whole suite at
    (see the module-level `setdefault`/`_refuse_unless_test_db` above) is
    dropped once, after every test in the session has run, so it never
    quietly accumulates fixture debris across suite runs. Guarded again
    on `.endswith("_test")` even though `_refuse_unless_test_db` already
    aborted collection otherwise -- a second, independent check right
    before the one truly destructive operation this file performs, same
    "cheap enough to just re-check" spirit as `_mongo_cleanup_allowed`
    below re-checking rather than trusting a module-level flag.

    Wrapped in try/except like every other real-Mongo touch in this file:
    per this file's own `_clear_response_cache` docstring, the Motor
    client can only ever be driven from the FIRST asyncio event loop that
    touches it for the whole process lifetime, so by the time the session
    ends, `asyncio.run()` here (a fresh loop) may well raise "Event loop
    is closed" the same way most mid-suite Mongo touches already silently
    do. That is a missed best-effort cleanup, not a correctness problem:
    the database stays disposable and unread by the real app either way.
    """
    yield
    from app.db.collections import db as _app_db
    if not _app_db.name.endswith("_test"):
        return
    try:
        asyncio.run(_app_db.client.drop_database(_app_db.name))
    except Exception:
        pass


def patch_billing_enabled(monkeypatch, enabled: bool, *, price_ids: dict | None = None):
    """BILLING_ENABLED is imported ('from app.core.config import
    BILLING_ENABLED') separately into app.services.billing,
    app.routers.billing and app.routers.subscription, so each module's own
    binding has to be patched independently — same convention
    test_mcp_connector_flag.py uses for MCP_CONNECTOR_ENABLED. Shared here
    (moved from tests/test_billing.py, B34) so any test that merely touches
    a BILLING_ENABLED-gated code path, not just test_billing.py's own
    dedicated billing tests, can pin the flag instead of inheriting whatever
    Stripe configuration happens to be in the environment."""
    monkeypatch.setattr(billing_module, "BILLING_ENABLED", enabled)
    monkeypatch.setattr(billing_router_module, "BILLING_ENABLED", enabled)
    monkeypatch.setattr(subscription_router_module, "BILLING_ENABLED", enabled)
    if price_ids is not None:
        monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", price_ids)


def _mongo_cleanup_allowed() -> bool:
    """Gate for `_best_effort_clear_mongo_cache_state`. Before H90 this was
    OFF by default: the suite had no separate test-database config
    (`app/db/collections.py` hardcoded the "wealth" db, no MONGO_DB env var
    existed to key off), so an unconditional `delete_many` here would have
    wiped the real app's live cache/version collections out from under it
    between runs. Since H90, `MONGO_DB` defaults to "wealth_test" (see this
    file's module-level `os.environ.setdefault` and `_refuse_unless_test_db`
    above), so `_app_db.name.endswith("_test")` is now true by construction
    for every normal run — collection would already have aborted otherwise
    — and this cleanup genuinely runs. `TEST_DB=1` stays as an explicit
    force for the (currently hypothetical) case of a non-"_test"-named
    database someone has independently confirmed is safe to wipe; kept for
    backward compatibility rather than because anything still needs it."""
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
    behind aget/aput. Before H90, this fixture could not really reach it
    safely: `_mongo_cleanup_allowed()` kept the real-Mongo `delete_many`
    OFF unless a test database was explicitly configured, because the
    suite's configured Mongo WAS the real app's "wealth" database. Since
    H90 the suite runs against a disposable "wealth_test" database by
    default (see this file's module-level `os.environ.setdefault` and
    `_refuse_unless_test_db`), so `_mongo_cleanup_allowed()` now genuinely
    returns True and this Mongo-layer cleanup runs for real.

    One long-standing limitation is unchanged by H90 and still applies:
    per test_notifications.py's own note, this environment has no
    mongomock, and the real Motor client can only be driven from ONE
    asyncio event loop for its whole process lifetime — the first
    `asyncio.run()` in the whole test session that touches it "wins", and
    every later one raises "Event loop is closed", which
    response_cache.py/data_version.py already catch and degrade from (log +
    treat as a miss/no-op). The net effect for the suite: at most the ONE
    first-to-touch-Mongo test in a session gets a real Mongo round-trip
    (write or cleanup); every other test's Mongo layer behaves as
    unreachable, and the still-cleared in-memory layer above means it
    still recomputes fresh regardless. That degrade-to-noop is exactly why
    it stays safe for this to be a disposable database rather than a
    correctness-critical one: a cleanup that silently fails to run most of
    the time was already the deliberate design, H90 only changes what
    database it is (occasionally) cleaning. Real Mongo-layer behaviour is
    exercised deterministically instead in tests/test_response_cache_v2.py,
    which monkeypatches response_cache_col/user_data_version_col with
    in-memory fakes rather than touching Mongo at all.
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
