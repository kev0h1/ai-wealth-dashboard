"""Per-user data-version counter — the exact-invalidation backbone behind
app.services.response_cache (see that module's own docstring for the full
two-layer cache design this feeds).

A "version" is a plain integer, persisted per user in Mongo
(`user_data_version_col`, `_id` = uid) so a bump made by ANY process (the
API or the arq worker) is immediately visible to every OTHER process the
next time it reads the version — unlike the old purely in-process TTL
cache, where the worker's 4-hourly reconcile sync couldn't invalidate the
API's cache at all except by waiting out the TTL.

Every write path that changes something a cached response depends on calls
`response_cache.invalidate()`/`ainvalidate()`, which bumps the version here.
A version bump itself carries no user data — it's a counter, not a
snapshot — so there is nothing here for the "never create/modify user data"
guardrail to worry about.

`current(uid)` memoises its result in-process for one second, so a single
page load's several cache reads (today, safe-to-spend, grow, commitments,
...) pay at most one Mongo round trip for the version, not one per read.
`current(uid, fresh=True)` (aliased as `response_cache.snapshot`) BYPASSES
that memo and always does a live Mongo read — this is the read half of the
version-pinning contract `response_cache.aput` requires: a caller must pin
`v = await response_cache.snapshot(uid)` BEFORE it starts computing a
payload, then pass that exact `v` to `aput`, so `aput` can detect (via
ANOTHER fresh read at write time) whether something bumped the version
WHILE the compute was running and, if so, refuse to store a payload that
was actually computed under a now-superseded version tagged as if it were
current (see response_cache.aput's own docstring for the full race this
closes).

Every Mongo touch below is defensive (try/except, log-and-degrade): a
version-store hiccup must never surface as a 500 on an otherwise-working
endpoint. Worst case on a Mongo failure: a cache entry that should have
been invalidated stays live until its own day-boundary/TTL naturally
expires it — the same bounded-staleness trade-off the old 90 s cache always
had, just with a longer (6 h) bound. The in-process memo is only ever
refreshed on a SUCCESSFUL Mongo read/write — a failed attempt leaves the
memo exactly as it was (if it was fresh, it stays fresh for whatever's left
of its 1 s; if it was already stale, it stays stale, so the NEXT call tries
Mongo again soon rather than pinning a failure timestamp and extending a
window where a real change could be missed).
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

from pymongo import ReturnDocument

from app.db.collections import user_data_version_col

logger = logging.getLogger(__name__)

_MEMO_TTL = 1.0  # seconds
# Mongo op budget for the cache's hot read/write paths — a slow/unreachable
# Mongo must degrade to a cache miss quickly, not hang a request.
_MAX_TIME_MS = 500

# {uid: (monotonic_ts_of_last_refresh, version)}
_memo: dict[str, tuple[float, int]] = {}

# Retained references for bump_soon's fire-and-forget tasks — asyncio only
# guarantees a task keeps running while something still references it; a
# bare `loop.create_task(...)` with nothing holding the result can be
# garbage-collected mid-flight (a documented asyncio gotcha). Each task
# removes itself once done via add_done_callback.
_background_tasks: set = set()


async def bump(uid: str) -> int:
    """Atomically increment (upserting) uid's version; return the new value.

    On a Mongo failure, logs and returns the last known value UNCHANGED
    (never raises) — see module docstring. The memo is only refreshed on
    success."""
    try:
        doc = await user_data_version_col.find_one_and_update(
            {"_id": uid},
            {"$inc": {"version": 1}, "$set": {"updated_at": datetime.now(timezone.utc)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        version = int((doc or {}).get("version", 1))
    except Exception:
        logger.exception("data_version.bump(%s) failed — version left unchanged", uid)
        return _memo.get(uid, (0.0, 0))[1]
    _memo[uid] = (time.monotonic(), version)
    return version


async def current(uid: str, *, fresh: bool = False) -> int:
    """Current version for uid, 0 if it has never been bumped.

    Served from the 1 s in-process memo when fresh and `fresh` is not
    requested; `fresh=True` always does a live Mongo read, bypassing the
    memo entirely (used by `response_cache.snapshot`/`aput`'s write-time
    recheck, where a memo hit could mask a version bump that happened in
    the last second). Degrades to the last known value (or 0) on a Mongo
    failure; the memo is only refreshed on a successful read."""
    if not fresh:
        memo = _memo.get(uid)
        if memo is not None and (time.monotonic() - memo[0]) < _MEMO_TTL:
            return memo[1]
    try:
        doc = await user_data_version_col.find_one(
            {"_id": uid}, max_time_ms=_MAX_TIME_MS
        )
        version = int((doc or {}).get("version", 0))
    except Exception:
        logger.exception("data_version.current(%s, fresh=%s) failed — using last-known value", uid, fresh)
        memo = _memo.get(uid)
        return memo[1] if memo is not None else 0
    _memo[uid] = (time.monotonic(), version)
    return version


def bump_soon(uid: str) -> None:
    """Fire-and-forget `bump(uid)` scheduled on the currently running event
    loop — for response_cache's synchronous `invalidate()`, which can't
    await. No-ops (with a logged warning) if there's no running loop to
    schedule onto; a bump that never happens degrades the same way any
    other Mongo failure here does (see module docstring). The task is
    retained in `_background_tasks` until it finishes so it can't be
    garbage-collected mid-flight."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("data_version.bump_soon(%s): no running event loop, skipped", uid)
        return

    async def _run():
        try:
            await bump(uid)
        except Exception:
            logger.exception("data_version.bump_soon(%s): background bump failed", uid)

    task = loop.create_task(_run())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
