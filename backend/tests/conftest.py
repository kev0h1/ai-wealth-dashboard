import asyncio
import fcntl
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

# H90 (2026-09-28, review round): force every backend test process
# onto a disposable Mongo DATABASE, and give each RUN its own name,
# before a single line below gets the chance to import anything that
# creates the real "wealth" collection handles. app/db/collections.py now
# reads MONGO_DB (app/core/config.py, default "wealth" — every real
# process, API and worker, never sets this and is therefore unaffected)
# to choose which database inside MONGO_URI's deployment it opens;
# setting it here, as literally the first statements in this file, before
# the `import app...` lines below, means every module they pull in
# (transitively, all the way down to app.db.collections) resolves against
# MONGO_DB, not a hardcoded "wealth".
#
# Review-round correction: the first version of this fix shipped a
# single shared literal, "wealth_test", for
# every run. This VPS runs several sessions' `finish` gates and an
# `integrate` pass against ONE local mongod, sometimes concurrently (seven
# finishes one morning) — each one's own session-end teardown dropped the
# SAME "wealth_test" database by name, so session B's teardown wiped
# session A's still-running fixtures mid-test. A new flaky-failure mode
# versus `main`, where nothing ever dropped anything at all. The fix is a
# per-run name: "wealth_test_<epoch seconds>_<8 hex>", unique enough
# across concurrent processes that no two sessions' teardowns can ever
# collide, with the epoch embedded so `_sweep_stale_test_databases` below
# can find and reap ones a crashed session (an OOM kill, a Ctrl-C) never
# got to drop itself, without needing a separate metadata store.
#
# `os.environ.setdefault` rather than a plain assignment so a caller CAN
# pass its own name (see scripts/session.sh's `finish` and
# scripts/integrate.py's `_run_backend_tests`, which both generate and
# pass their OWN per-run name explicitly — belt and braces, not reliance
# on this file's import ordering, for the two callers most likely to run
# concurrently with each other) — but see `_refuse_unless_test_db` below:
# whatever ends up in MONGO_DB, generated here, passed by a caller, or set
# by hand, MUST still look like a test database or collection aborts
# before any test runs.
#
# `app.core.config`'s `load_dotenv(..., override=False)` (the
# python-dotenv default) is why this is safe even when a real
# `backend/.env` IS on the import path (true for `scripts/integrate.py`,
# which runs the suite from the shared tree rather than a worktree, and
# whose `backend/.env` really does carry `MONGO_DB=wealth` — see
# docs/ops/ENV.md): dotenv only fills in names ABSENT from the process
# environment, and this line (or the caller's own explicit env, set even
# earlier, before the subprocess starts) has already filled MONGO_DB in
# by the time `app.core.config` (imported transitively below) calls
# `load_dotenv`, so the real .env's `wealth` is never allowed to
# overwrite it.


def _generate_test_db_name() -> str:
    """The shape scripts/session.sh and scripts/integrate.py's own
    generators duplicate (search those files for "wealth_test_" if this
    ever needs to change) — kept in sync by convention, not by a shared
    import, since neither of those is test code and this file must not
    become something a production ops script depends on."""
    return f"wealth_test_{int(time.time())}_{uuid.uuid4().hex[:8]}"


os.environ.setdefault("MONGO_DB", _generate_test_db_name())

import pytest

import app.routers.billing as billing_router_module
import app.routers.subscription as subscription_router_module
import app.services.billing as billing_module
from app.services import data_version, response_cache

# H90 review round (finding 3, 2026-09-28): a stale-database sweep keyed
# on age ALONE reintroduces the exact collision class this whole file
# exists to prevent, one layer up -- a session whose suite legitimately
# runs past an hour (this box has been memory-starved all day; a slow
# suite is not far-fetched) would have ANOTHER session's collection-time
# sweep drop its still-live database out from under it, reproduced
# directly by the H96 reviewer against throwaway names. Age is now only
# ever a SECONDARY condition: `_sweep_stale_test_databases` below also
# requires proof the owning process is actually gone, via a non-blocking
# `flock` on a per-database lockfile every session holds for its own
# lifetime (`_acquire_own_lock`, called once at collection time,
# released in `_drop_test_database_at_session_end`'s teardown). `flock`
# is process-scoped and kernel-held: if the owning process dies for any
# reason (crash, OOM kill, `Ctrl-C`) without a chance to run its own
# teardown, the OS releases the lock the instant the process exits, so a
# LATER sweep's own non-blocking attempt to acquire that same lock
# succeeds immediately -- proof, not inference, that no one is still
# using this database, exactly the same "kernel enforces it, not our own
# bookkeeping" property this file already leans on for Mongo's single
# event loop per client.
_LOCK_DIR = Path(tempfile.gettempdir()) / "wealth_test_locks"

# Kept open for this process's entire lifetime once acquired --
# closing it (explicitly in `_release_own_lock`, or implicitly at
# process exit) is what releases the underlying `flock`.
_own_lock_file = None


def _lock_path_for(name: str) -> Path:
    return _LOCK_DIR / f"{name}.lock"


def _acquire_own_lock(name: str) -> None:
    """Best-effort: a lock directory that can't be created or written to
    (an unusual host, a permissions problem) must not crash the whole
    suite over a liveness nicety -- it degrades to the pre-lock behaviour
    for THIS run's own liveness signal (another session's sweep would
    have no lock to find for us), printed loudly rather than silently
    swallowed, since that degradation is worth knowing about."""
    global _own_lock_file
    try:
        _LOCK_DIR.mkdir(parents=True, exist_ok=True)
        fh = open(_lock_path_for(name), "w")
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as exc:
        print(f"[H90] could not acquire a liveness lock for {name!r}: {exc}")
        return
    _own_lock_file = fh


def _release_own_lock(name: str) -> None:
    global _own_lock_file
    if _own_lock_file is not None:
        try:
            fcntl.flock(_own_lock_file.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            _own_lock_file.close()
        except OSError:
            pass
        _own_lock_file = None
    try:
        _lock_path_for(name).unlink(missing_ok=True)
    except OSError:
        pass


def _lock_dir_is_usable() -> tuple[bool, str]:
    """Can the lock directory actually be used right now, as a real,
    writable directory -- not colliding with a plain file, not blocked
    by permissions, not otherwise broken. Returns `(True, "")` when
    usable, `(False, <reason>)` otherwise. Shared by `_acquire_own_lock`
    (which already tolerates failure here, degrading for THIS session's
    own liveness signal) and `_sweep_stale_test_databases` (which must
    NOT tolerate it -- see that function's own docstring, H90 round
    three)."""
    try:
        _LOCK_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return False, f"cannot create or use lock directory {_LOCK_DIR}: {exc}"
    if not _LOCK_DIR.is_dir():
        return False, f"{_LOCK_DIR} exists but is not a directory"
    return True, ""


def _has_a_live_owner(name: str) -> bool:
    """Non-blocking probe of the SAME lockfile `_acquire_own_lock` above
    holds for a database's whole-session lifetime.

    FAIL CLOSED (H90 round three): the only answer that means "no
    evidence of a live owner" (False) is a clean, unambiguous "the
    lockfile plainly does not exist". EVERY OTHER failure -- the lock
    directory itself broken or colliding with something else, a
    permissions problem, `.exists()` itself raising, `open()` failing,
    `flock()` failing for any reason besides "already held" -- is
    treated as "yes, a live owner" (True), not as "no evidence, so
    probably safe". The earlier version conflated these: it treated ANY
    open/stat failure the same as "no lock file at all" and returned
    False, which let a broken lock directory (the H96 class of defect,
    one precondition deeper -- see `_sweep_stale_test_databases`) make
    every candidate look unowned regardless of whether anything actually
    was. `_sweep_stale_test_databases` also short-circuits the whole
    sweep via `_lock_dir_is_usable` above before this function is ever
    called with the directory in that state, but this function fails
    closed on its own too, independent of that guard, rather than
    relying on it alone."""
    path = _lock_path_for(name)
    try:
        exists = path.exists()
    except OSError:
        return True  # could not even ask -- fail closed, not "no evidence"
    if not exists:
        return False
    try:
        fh = open(path, "r+")
    except OSError:
        return True  # exists but unopenable -- fail closed
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return True
    except OSError:
        return True  # any other flock failure -- fail closed too
    else:
        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
        return False
    finally:
        fh.close()


# Matches ONLY our own generated shape, "wealth_test_<epoch>_<8 hex
# lowercase>" — deliberately narrower than `_looks_like_a_test_database`
# below (which also accepts a bare "wealth_test" or any other
# "..._test_..." name a human might set by hand), so the stale-database
# sweep never touches a database it didn't itself create the naming
# convention for.
_GENERATED_TEST_DB_RE = re.compile(r"^wealth_test_(\d+)_[0-9a-f]{8}$")
_STALE_TEST_DB_AGE_SECONDS = 3600


# H96 review round: `name.startswith("wealth_test")` was UNANCHORED --
# it accepted "wealth_testing", "wealth_testament", "wealth_testers_prod",
# any name merely SHARING that prefix, despite this function's own
# docstring claiming to exclude substring coincidences. Anchored: the
# match must be the literal component "wealth_test", followed by either
# an underscore (a per-run generated name, "wealth_test_<epoch>_<hex>",
# or any other "wealth_test_..." shape) or the end of the string (the
# bare name "wealth_test" itself) -- never just followed by more letters.
_TEST_DB_PREFIX_RE = re.compile(r"^wealth_test(_|\Z)")


def _looks_like_a_test_database(name: str) -> bool:
    """Broadened (H90's review round) from a plain `.endswith("_test")`
    check (correct when every run shared the one literal "wealth_test")
    to also accept any per-run generated name -- "wealth_test_<epoch>_<8
    hex>" matches `_TEST_DB_PREFIX_RE` above -- or any other name
    carrying "test" as a whole underscore-delimited component (covering a
    hand-set "MONGO_DB" like "foo_test_bar" without accepting a substring
    coincidence like "wealthtest" or, the one case that must never pass,
    literal "wealth"). The prefix check is ANCHORED (H96 review round --
    see `_TEST_DB_PREFIX_RE`'s own comment): "wealth_testing" is not
    "wealth_test" plus a component boundary, so it is refused, not
    accepted on a substring coincidence.

    Round-three correction: ANY whitespace anywhere in `name` refuses it
    outright, checked first, before either the regex or the fallback.
    Two independent reasons this exists rather than relying on either
    check alone: (1) `_TEST_DB_PREFIX_RE` used a bare `$`, which in
    Python (without `re.MULTILINE`) matches not only the true end of the
    string but also the position immediately before a single trailing
    newline character -- so the literal name "wealth_test" plus a
    trailing newline matched `^wealth_test$` even though it is not, in
    fact, the bare name. Fixed there too (an end-of-string-only anchor,
    which has no such exception), but this whitespace check is defence in depth, not
    a substitute. (2) The split-based fallback below (`"test" in
    name.split("_")`) never examined the CONTENT of each component, only
    whether "test" was exactly one of them -- " wealth_test".split("_")
    is `[" wealth", "test"]`, and "test" is still in that list, so a
    leading space on the first component changed nothing. No generator
    in this file has ever produced a name with any whitespace in it, and
    Mongo's own database-name rules make one vanishingly unlikely to be
    legitimate, so refusing on sight is unambiguous, not a false
    negative risk."""
    if any(ch.isspace() for ch in name):
        return False
    if _TEST_DB_PREFIX_RE.match(name):
        return True
    return "test" in name.split("_")


def _refuse_unless_test_db() -> None:
    """Fail-hard backstop (H90). Runs once, at collection time, before any
    test in the suite executes. However MONGO_DB ended up resolved --
    the `setdefault` above, an explicit override from session.sh/
    integrate.py, or (if a future refactor ever moves that `setdefault`
    below this point, or removes it) nothing at all -- this is the one
    check that cannot be bypassed by import order: if the database this
    process would touch does not look like a test database
    (`_looks_like_a_test_database` above), abort collection outright
    rather than let even one test reach a Mongo write against what could
    be the real UAT/production "wealth" database. This is deliberately
    independent of, and a backstop for, the naming mechanism above -- that
    is the actual mechanism (a genuinely disposable, per-run database),
    this is the guard that fires if the mechanism is ever missing,
    misordered, or overridden to something unsafe.
    """
    from app.db.collections import db as _app_db
    if not _looks_like_a_test_database(_app_db.name):
        raise pytest.UsageError(
            f"refusing to collect the backend suite: Mongo database "
            f"{_app_db.name!r} does not look like a test database, so "
            f"running tests would write into what may be the real "
            f"UAT/production database. Set MONGO_DB to a name starting "
            f"with \"wealth_test\" (or unset MONGO_DB entirely -- this "
            f"file already defaults it to a fresh per-run name) before "
            f"running pytest again."
        )


async def _drop_database_with_fresh_client(name: str) -> None:
    """A standalone Motor client for exactly one operation, never the
    app's own shared `app.db.collections` client -- that client can only
    ever be driven from the FIRST asyncio event loop that touches it for
    its whole process lifetime (see `_clear_response_cache`'s own
    docstring below), so reusing it here from a fresh `asyncio.run()` risks
    "Event loop is closed" for no reason: a throwaway client, used once
    and closed, has no such history to fight."""
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.core.config import MONGO_URI

    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
    try:
        await client.drop_database(name)
    finally:
        client.close()


async def _sweep_stale_test_databases(own_name: str) -> list[str]:
    """Reap a "wealth_test_<epoch>_<8 hex>" database that is BOTH older
    than `_STALE_TEST_DB_AGE_SECONDS` AND has no live owner
    (`_has_a_live_owner` above) -- left behind by a session that crashed
    (OOM-killed, Ctrl-C'd) before its own `_drop_test_database_at_session_
    end` teardown ran, otherwise these accumulate forever on a host that
    runs many short sessions a day. Age ALONE is deliberately not enough
    (H90 review round, finding 3): a session whose suite legitimately
    runs past an hour on a memory-starved box is still alive and must
    survive another session's sweep, which age-only sweeping cannot tell
    apart from a genuinely abandoned database -- reproduced directly by
    the H96 reviewer. Only ever matches OUR OWN generated name shape
    exactly (`_GENERATED_TEST_DB_RE`, never a bare "wealth_test" a human
    might have set up on purpose, never "wealth" itself) and never drops
    `own_name`, this run's own database, however the age check might read
    it (in practice it never can: the epoch in a freshly-generated name
    is always "now"). Returns the names actually dropped so the caller
    can report them.

    H90 round three: checks `_lock_dir_is_usable()` FIRST and skips the
    ENTIRE sweep, printing why, if it is not -- a broken lock directory
    means NO session on this host could have registered a lock for
    anything, so there is no evidence either way for any candidate, and
    "no evidence" must never read as "safe to drop". This is a
    short-circuit ahead of `_has_a_live_owner`'s own fail-closed
    behaviour (see that function's docstring), not a replacement for
    it -- belt and braces, same as everywhere else in this file."""
    lock_dir_ok, lock_dir_reason = _lock_dir_is_usable()
    if not lock_dir_ok:
        print(
            f"[H90] skipping the stale-database sweep entirely: "
            f"{lock_dir_reason} -- no liveness evidence is available for "
            f"any candidate, so nothing can safely be dropped this run."
        )
        return []

    from motor.motor_asyncio import AsyncIOMotorClient

    from app.core.config import MONGO_URI

    dropped: list[str] = []
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=8000)
    try:
        try:
            names = await client.list_database_names()
        except Exception:
            return dropped
        now = time.time()
        for name in names:
            if name == own_name:
                continue
            m = _GENERATED_TEST_DB_RE.match(name)
            if not m:
                continue
            if now - int(m.group(1)) < _STALE_TEST_DB_AGE_SECONDS:
                continue
            if _has_a_live_owner(name):
                continue
            try:
                await client.drop_database(name)
                dropped.append(name)
            except Exception:
                pass
    finally:
        client.close()
    return dropped


def _refuse_unless_test_db_and_sweep_stale() -> None:
    _refuse_unless_test_db()
    from app.db.collections import db as _app_db
    # Acquire OUR OWN liveness lock BEFORE sweeping, not after: two
    # sessions starting near-simultaneously must each see the other
    # already holding its lock by the time either one sweeps, or the
    # liveness check has no evidence to find yet.
    _acquire_own_lock(_app_db.name)
    try:
        dropped = asyncio.run(_sweep_stale_test_databases(_app_db.name))
    except Exception:
        dropped = []
    if dropped:
        print(
            f"[H90] dropped {len(dropped)} stale test database(s) "
            f"(>{_STALE_TEST_DB_AGE_SECONDS}s old, no live owner): "
            f"{', '.join(sorted(dropped))}"
        )


_refuse_unless_test_db_and_sweep_stale()


@pytest.fixture(scope="session", autouse=True)
def _drop_test_database_at_session_end():
    """H90: the disposable, per-run database `MONGO_DB` points this
    session at (see the module-level generator/`_refuse_unless_test_db`
    above) is dropped once, after every test in the session has run, so
    it never quietly accumulates fixture debris. `_sweep_stale_test_
    databases` above is the backstop for the case this fixture never
    gets to run at all (a crash, an OOM kill). Guarded again on
    `_looks_like_a_test_database` even though `_refuse_unless_test_db`
    already aborted collection otherwise -- a second, independent check
    right before the one truly destructive operation this file performs,
    same "cheap enough to just re-check" spirit as `_mongo_cleanup_
    allowed` below re-checking rather than trusting a module-level flag.

    Releases this session's OWN liveness lock (`_acquire_own_lock`,
    taken at collection time) FIRST, in every case, whether or not this
    database looks droppable -- a session that used a hand-set,
    non-generated name still held a lock other sessions' sweeps may have
    checked, and it must not outlive this process on disk.

    Uses a standalone client (`_drop_database_with_fresh_client`), not
    the app's own shared one, specifically so THIS drop is not subject to
    the single-event-loop constraint the rest of this file's Mongo
    touches accept as best-effort -- the whole point of a session-end
    teardown is that it should actually run, not join the same
    degrade-to-noop most mid-suite Mongo touches already do.
    """
    yield
    from app.db.collections import db as _app_db
    _release_own_lock(_app_db.name)
    if not _looks_like_a_test_database(_app_db.name):
        return
    try:
        asyncio.run(_drop_database_with_fresh_client(_app_db.name))
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
    between runs. Since H90, `MONGO_DB` defaults to a fresh per-run
    "wealth_test_<epoch>_<hex>" name (the review round's own fix: no
    longer the single shared literal "wealth_test" — see this file's
    module-level generator and `_refuse_unless_test_db` above), so
    `_looks_like_a_test_database`
    is now true by construction for every normal run — collection would
    already have aborted otherwise — and this cleanup genuinely runs.
    `TEST_DB=1` stays as an explicit force for the (currently
    hypothetical) case of a database name `_looks_like_a_test_database`
    wouldn't recognise that someone has independently confirmed is safe
    to wipe; kept for backward compatibility rather than because anything
    still needs it."""
    if os.getenv("TEST_DB") == "1":
        return True
    from app.db.collections import db as _app_db
    return _looks_like_a_test_database(_app_db.name)


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
    H90 the suite runs against a disposable database by default (the
    review round's own fix: a fresh PER-RUN "wealth_test_<epoch>_<hex>"
    name, not a single shared literal — see this file's module-level
    generator and `_refuse_unless_test_db`), so `_mongo_cleanup_allowed()`
    now genuinely
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
