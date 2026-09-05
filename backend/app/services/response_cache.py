"""Per-user, two-layer response cache: a version-pinned write contract, a
local calendar day, and a 6h safety-bound TTL.

Layer 1 is an in-process memory dict (`_caches`), keyed (name, uid) — most
requests are served from here, no I/O at all. Layer 2 is a Mongo-backed
`response_cache` collection (see `app.db.collections.response_cache_col`),
so a cache warmed by ONE process (typically the worker, right after a sync
— see `app.services.warmup.warm_user`) is visible to every OTHER process
(the API, serving the next page load) without waiting out a TTL, and
survives an API process restart, which the old pure in-memory cache never
could.

An entry is valid when ALL of:
  - `entry["version"]` equals the user's CURRENT data version
    (`app.services.data_version`) — bumped by every write path that changes
    something a cached response depends on, so invalidation is EXACT
    instead of purely time-based;
  - `entry["day"]` equals today's local calendar date (see `local_day()`
    below); a response computed yesterday must never survive into today
    even if nothing else changed;
  - it is younger than `TTL_SECONDS` (6 hours) — a safety BOUND, not the
    primary invalidation mechanism.

WRITE CONTRACT — version pinning (`aput` requires `version=`):
    A naive "read version, compute, write version" `aput` has a race: if
    something bumps the version WHILE the (often slow — network calls, many
    Mongo reads) compute is running, the payload was actually computed
    under the OLD version but would get written stamped with the NEW one,
    making a STALE result look fresh for up to 6 hours. To close this,
    every caller must:
        1. `v = await response_cache.snapshot(uid)`   — BEFORE computing
        2. `payload = await compute(...)`             — the (possibly slow)
                                                          compute
        3. `await response_cache.aput(name, uid, payload, version=v)`
    `aput` re-reads the version FRESH (bypassing the 1 s memo) at write
    time; if it no longer matches the pinned `v`, the write (both layers)
    is skipped and logged at DEBUG — the entry that would have been
    written is simply not needed anymore: whatever bumped the version will
    have its own fresher compute in flight (or already cached) very soon.

`aget`/`snapshot` are the read half — `aget` checks memory then Mongo;
`snapshot(uid)` is `data_version.current(uid, fresh=True)`, a live,
un-memoised version read for the write-time pin.

Every Mongo touch is defensive (try/except, log-and-degrade): a cache-layer
hiccup must never surface as a 500 on an otherwise-working endpoint. Reads
are also bounded (`max_time_ms`) so an unreachable/slow Mongo degrades to a
miss quickly rather than hanging a request.

`invalidate`/`ainvalidate` are unchanged in spirit from phase 1: they drop
the memory layer and bump the version (fire-and-forget / awaited,
respectively) so every process's next `aget`/`aput` sees the new version.
"""
import logging
import time
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi.encoders import jsonable_encoder

from app.db.collections import response_cache_col
from app.services import data_version

logger = logging.getLogger(__name__)

TTL_SECONDS = 6 * 3600.0
_MAX_TIME_MS = 500

# UK users; the app's OTHER date logic mostly uses naive server-local
# `date.today()` (a separate, wider concern not touched by this round) —
# this cache specifically pins its day boundary to Europe/London (DST-aware)
# so the API and worker processes, even if their host clocks/TZ ever
# diverge, can never disagree about whether "today" has rolled over.
_LONDON = ZoneInfo("Europe/London")


def local_day() -> str:
    """Today's calendar date in Europe/London, as an ISO string."""
    return datetime.now(_LONDON).date().isoformat()


def _stringify_keys(obj: Any) -> Any:
    """`jsonable_encoder` converts VALUES to JSON-native types but leaves
    dict KEYS as-is (an int-keyed dict stays int-keyed) — fine for
    `json.dumps` later (which stringifies keys itself) but not for a direct
    BSON write: pymongo requires every Mongo document key to be a string
    and raises InvalidDocument otherwise. Recursively stringify keys AFTER
    jsonable_encoder so the exact same structure is safe to store in Mongo
    and identical to what the memory layer holds (see aput's docstring)."""
    if isinstance(obj, dict):
        return {str(k): _stringify_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_stringify_keys(v) for v in obj]
    return obj


# {cache_name: {uid: {"version": int, "day": str, "ts": float, "payload": Any}}}
_caches: dict[str, dict[str, dict]] = {}


def _memory_fresh(entry: dict | None, *, version: int, ttl: float) -> bool:
    if entry is None:
        return False
    if time.monotonic() - entry["ts"] > ttl:
        return False
    if entry["day"] != local_day():
        return False
    return entry["version"] == version


async def snapshot(uid: str) -> int:
    """Live (un-memoised) read of uid's current data version — pin this
    BEFORE starting a compute that will later be `aput` (see module
    docstring's write contract)."""
    return await data_version.current(uid, fresh=True)


async def aget(name: str, uid: str, ttl: float = TTL_SECONDS) -> Any | None:
    """Memory, then Mongo. Populates memory on a Mongo hit so a repeat call
    in the same process is free."""
    version = await data_version.current(uid)
    entry = _caches.get(name, {}).get(uid)
    if _memory_fresh(entry, version=version, ttl=ttl):
        return entry["payload"]
    if entry is not None:
        _caches[name].pop(uid, None)

    try:
        doc = await response_cache_col.find_one(
            {"user_id": uid, "name": name}, max_time_ms=_MAX_TIME_MS
        )
    except Exception:
        logger.exception("response_cache.aget(%s, %s): Mongo read failed", name, uid)
        return None
    if not doc:
        return None
    if doc.get("version") != version or doc.get("day") != local_day():
        return None
    computed_at = doc.get("computed_at")
    if isinstance(computed_at, datetime):
        if computed_at.tzinfo is None:
            computed_at = computed_at.replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - computed_at).total_seconds() > ttl:
            return None

    payload = doc.get("payload")
    _caches.setdefault(name, {})[uid] = {
        "version": version, "day": doc.get("day"), "ts": time.monotonic(), "payload": payload,
    }
    return payload


async def aput(name: str, uid: str, payload: Any, *, version: int) -> None:
    """Writes memory AND Mongo — but only if `version` (pinned by the
    caller BEFORE it started computing `payload`, via `snapshot`) still
    matches uid's version right now. See module docstring's write contract
    for the race this closes. A version mismatch is not an error — it just
    means the write is stale before it happens, so it's silently skipped
    (logged at DEBUG)."""
    fresh_version = await data_version.current(uid, fresh=True)
    if fresh_version != version:
        logger.debug(
            "response_cache.aput(%s, %s): version raced (pinned=%s, now=%s) — write skipped",
            name, uid, version, fresh_version,
        )
        return

    today = local_day()
    # Encode ONCE and store the identical encoded value in BOTH layers, so
    # a memory-hit and a Mongo-hit can never return different shapes for
    # the same write (a plain dict of dict/list/str/number/bool/None/date
    # round-trips through jsonable_encoder unchanged; this only matters for
    # a payload carrying something less JSON-native, e.g. a Decimal/tuple).
    encoded = _stringify_keys(jsonable_encoder(payload))
    _caches.setdefault(name, {})[uid] = {
        "version": version, "day": today, "ts": time.monotonic(), "payload": encoded,
    }
    try:
        await response_cache_col.replace_one(
            {"user_id": uid, "name": name},
            {
                "user_id": uid, "name": name, "version": version, "day": today,
                "payload": encoded, "computed_at": datetime.now(timezone.utc),
            },
            upsert=True,
        )
    except Exception:
        logger.exception("response_cache.aput(%s, %s): Mongo persist failed", name, uid)


def invalidate(uid: str, name: str | None = None) -> None:
    """Drop cached responses for a user from the MEMORY layer — one named
    cache, or all of them — and bump the user's data version in the
    background (`data_version.bump_soon`) so every OTHER process's memory
    layer, and the Mongo layer, drop this uid too the next time they check.

    `name` also matches offset-keyed caches stored as "name:<offset>" (e.g.
    "miscategorised_count:0", "miscategorised_count:-1", ...) so a caller
    that just knows the logical cache name doesn't need to enumerate every
    offset variant.

    A name-scoped call still bumps the GLOBAL version — there is only one
    counter per user, not one per cache name — a deliberate trade-off: a
    targeted invalidation (e.g. just "today") also invalidates every OTHER
    cached response for this user a beat sooner than it strictly needed to,
    in exchange for one counter instead of dozens. Prefer `ainvalidate`
    where the caller is already async and wants the bump guaranteed to have
    landed before the response returns, rather than merely scheduled."""
    if name is None:
        for cache in _caches.values():
            cache.pop(uid, None)
    else:
        prefix = name + ":"
        for cache_name, cache in _caches.items():
            if cache_name == name or cache_name.startswith(prefix):
                cache.pop(uid, None)
    data_version.bump_soon(uid)


async def ainvalidate(uid: str) -> None:
    """Full wipe of the memory layer + an AWAITED version bump. Use at write
    paths where the caller is already async and the very next read (even
    from a different process) must be guaranteed-cold, not just
    eventually-cold — see the docstring trade-off above."""
    for cache in _caches.values():
        cache.pop(uid, None)
    await data_version.bump(uid)
