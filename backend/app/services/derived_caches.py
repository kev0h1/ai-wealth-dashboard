"""Post-sync recompute of the derived caches: the cashflow forecast
(`cashflow_cache_col`, written by `compute_and_cache_cashflow`) and the money
shape (`money_shape_cache_col`). One gate, shared by every sync path, that
knows WHY the sync ran (G159).

Before this module each sync path carried its own `if new_count > 0:` guard
around the recompute. That guard is a cost optimisation: a recompute is about
1.3 s of CPU on the event loop for a user with ~2,000 transactions and 19
accounts (measured on UAT, 2026-09-27), plus one Haiku call for the
single-occurrence bill predictor, and the 4-hourly reconcile would otherwise
pay it for every user every tick. But the guard assumes the only thing that
can change a forecast is a new transaction, and that is false whenever the
engine itself changes, which is every deploy: Kevin tapped Home's refresh
twice after G158 merged and still saw his salary missing, because the sync
found nothing new, kept the 19:23 forecast doc, and then rebuilt every
screen from that same stale doc so the tap looked like it had worked.

The trigger is what distinguishes the two callers now:

- `"user"`: an explicit refresh (POST /accounts/sync, POST
  /accounts/sync-history, and the Finexer pipeline when started by one of
  those). Always recomputes. The user asked for a refresh; a refresh that
  does not refresh is the bug.
- `"auto"`: the worker's 4-hourly reconcile, webhook-triggered syncs and the
  Finexer OAuth callback. Recomputes when the sync pulled new transactions,
  when the doc carries a `dirty_since` stamp (G177, see `mark_stale`), and otherwise only when the cache doc is missing, predates
  `PATTERNS_VERSION`, or was written by a different engine build (see
  `app.core.build`). That last check is the cheap self-heal for a user the
  deploy-time pass missed; it costs one projected find_one.

`refresh_stale_cashflow_caches` is the deploy-time pass itself: the worker
runs it once in the background on every start (`WorkerSettings.on_startup`
in app.workers.sync_worker), and the engine-build stamp makes it a no-op on a
restart without a code change. It lives in the worker, not the API, because
the API is a single uvicorn process and the recompute blocks its event loop
for over a second per user; the worker has nothing latency-sensitive to
protect. It recomputes the forecast only, and does not run the response
warm-up: `compute_and_cache_cashflow` bumps the user's data version, so the
next open rebuilds each screen from the fresh doc, and the next reconcile
tick warms them as it always has.
"""
import asyncio
import logging
import time
import uuid
import weakref
from datetime import datetime, timezone
from typing import Literal

from app.core.build import engine_build
from app.db.collections import cashflow_cache_col, transactions_col
from app.services import response_cache

logger = logging.getLogger(__name__)

SyncTrigger = Literal["user", "auto"]

# Between users in the deploy-time pass: keeps the worker's own jobs and Mongo
# from being starved by a back-to-back recompute of the whole population.
_STARTUP_PAUSE_SECONDS = 0.5

# G159 review fix #1: a burst of explicit refreshes with nothing new must
# not each pay the ~1.2s of blocked event-loop CPU plus one Haiku call.
# The frontend's own `setSyncing` guard cannot prevent this by itself: it
# releases as soon as POST /accounts/sync's HTTP response returns, which is
# BEFORE `_post_sync` (routers/accounts.py) even starts running in the
# background, so a second tap a few seconds later queues a second full
# recompute regardless of what the button shows. EXPENSIVE_PREFIXES
# (app.core.ratelimit) is the blunt per-identity backstop against a real
# flood; this is the mechanism that actually avoids paying twice for two
# taps that land close together.
#
# Per-process, in-memory, keyed by uid — the same trade-off the AI
# recurring-predictions cache (`analytics._ai_recurring_cache`) already
# makes for this exact deployment (a single uvicorn/arq worker process per
# service; see docs/ops/ENV.md and the Performance memory note), not a
# distributed lock: correct here because there is only one process to
# dedupe against, and simpler than standing up a Redis lock for a window
# this short. Must be revisited when E2 (web replicas) lands: two API
# processes each holding their own dict would stop coordinating, and a
# rapid double-tap routed to different replicas would no longer collapse.
#
# Stamped at START, not completion, of the recompute: two taps landing
# while the first recompute is still in flight must also collapse to one,
# not just two that land after the first has already finished.
#
# Only debounces a trigger="user" call whose OWN sync pulled zero new
# transactions. A refresh that pulled genuinely new data always recomputes
# regardless of the window — matching the "auto" trigger's own
# always-recompute-on-new-data rule below — because the bug this closes is
# bursts of nothing happening, not a real bill landing inside the window
# and then silently going unrepresented until the window elapses.
#
# N = 20s: comfortably longer than the observed failure (a second tap ~2s
# after the first) and than a recompute's own ~1.2s CPU + one Haiku call
# (so overlapping taps reliably collapse to one), while short enough that a
# genuinely separate refresh later in the same visit still gets a fresh
# recompute rather than silently serving a stale doc to someone actively
# watching the screen.
USER_REFRESH_DEBOUNCE_SECONDS = 20
_last_user_recompute_started: dict[str, float] = {}
# One API process serves this deployment.  The durable token below is the
# cross-process safety net if that deployment model changes; this lock simply
# stops two simultaneous Done taps paying for the same calculation today.
_transfer_review_flush_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()


def _debounce_user_refresh(uid: str) -> bool:
    """True if a user-triggered recompute for `uid` started within the
    debounce window and this call should therefore be skipped. Marks the
    window's start UNCONDITIONALLY, before returning, not only on the
    branch that goes on to recompute: a re-review (2026-09-28) found the
    window was only ever armed on a new_count=0 call, so a first tap whose
    OWN sync found new data (new_count>0, which always bypasses the
    debounce below) never recorded a start time, and an immediately
    following tap that found nothing was therefore not debounced either —
    missing the common real shape, a refresh that finds something followed
    right away by one that finds nothing."""
    now = time.monotonic()
    last = _last_user_recompute_started.get(uid)
    debounced = last is not None and (now - last) < USER_REFRESH_DEBOUNCE_SECONDS
    _last_user_recompute_started[uid] = now
    return debounced


# G177: the fields of a transaction row that can move a forecast. A re-pulled
# row whose only difference is `category` or `merchant_key` (the categoriser
# rewrites those after every sync) must NOT count as a change, or every
# reconcile tick would mark every user stale and the 4-hourly gate would be
# gone. `TXN_MATERIAL_PROJECTION` is what a sync reads back from the BEFORE
# image of its upsert.
TXN_MATERIAL_FIELDS = ("account_id", "date", "amount", "currency", "description", "transaction_type")
TXN_MATERIAL_PROJECTION = {f: 1 for f in TXN_MATERIAL_FIELDS}


def _norm_material(field: str, value):
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
    if field == "amount" and value is not None:
        try:
            return round(float(value), 2)
        except (TypeError, ValueError):
            return value
    return value


def txn_materially_changed(before: dict | None, after: dict) -> bool:
    """True if an upsert inserted the row (`before` is None) or changed any
    field in TXN_MATERIAL_FIELDS. `before` is the pre-update image."""
    if before is None:
        return True
    return any(
        _norm_material(f, before.get(f)) != _norm_material(f, after.get(f))
        for f in TXN_MATERIAL_FIELDS
    )


def _ms_now() -> datetime:
    n = datetime.now()  # naive-ok: cache stamp, compared only with computed_from
    return n.replace(microsecond=(n.microsecond // 1000) * 1000)


async def mark_stale(uid: str, *, reason: str = "transactions_changed") -> None:
    """G177: record that `uid`'s transactions changed (a sync inserted or
    materially updated a row), so the forecast doc no longer reflects them.

    Stamps `dirty_since` on the user's cashflow_cache doc and awaits a
    response-cache invalidation (memory layer plus the per-user data-version
    bump every other process and the Mongo layer key on). The stamp is what
    makes the staleness visible to every later decision, whichever process
    or sync path it comes from: `cache_needs_recompute` (auto trigger) and
    the cashflow readers both treat a doc with `dirty_since` as stale, and
    only a recompute that STARTED at or after the stamp clears it
    (`clear_dirty`). Not upserted: a missing doc already reads as
    `no_cache` and recomputes. Never raises into the sync that called it."""
    try:
        await cashflow_cache_col.update_one(
            {"_id": uid},
            # Millisecond precision, like the recompute watermark it is
            # compared with (Mongo stores ms).
            # A fresh change also lifts any read-path failure backoff.
            {"$set": {"dirty_since": _ms_now()}, "$unset": {"dirty_retry_after": ""}},
        )
    except Exception:
        logger.exception("mark_stale(%s, %s): could not stamp dirty_since", uid, reason)
    try:
        await response_cache.ainvalidate(uid)
    except Exception:
        logger.exception("mark_stale(%s, %s): response cache invalidation failed", uid, reason)


async def defer_transfer_review_recompute(uid: str) -> None:
    """Record a review decision whose expensive forecast rebuild is deferred.

    The correction itself has already been written before this is called.  The
    marker lives with the cashflow cache so closing a browser, or moving to a
    different API process, cannot lose the fact that the forecast still needs
    one rebuild.  The stale stamp and opaque token are one atomic Mongo write:
    a marker-only cache document must never be mistaken for a fresh forecast.
    """
    stamp = _ms_now()
    token = uuid.uuid4().hex
    # Do not swallow this write.  A successful category decision without its
    # durable batch marker would silently violate the close-time contract.
    await cashflow_cache_col.update_one(
        {"_id": uid},
        {"$set": {
            "dirty_since": stamp,
            "transfer_review_pending_since": stamp,
            "transfer_review_pending_token": token,
        }, "$unset": {"dirty_retry_after": ""}},
        upsert=True,
    )
    try:
        await response_cache.ainvalidate(uid)
    except Exception:
        logger.exception("defer_transfer_review_recompute(%s): response cache invalidation failed", uid)


async def finish_transfer_review_recompute(uid: str) -> dict:
    """Flush one deferred transfer-review batch, preserving concurrent work.

    `compute_and_cache_cashflow` owns the dirty-stamp compare-and-swap.  We
    only remove the exact token read before computing, so a new decision
    saved while the close request is running remains queued.
    """
    lock = _transfer_review_flush_locks.setdefault(uid, asyncio.Lock())
    # Each caller holds a strong reference through acquire and release. Weak
    # entries disappear only once no current caller or waiter can use the lock.
    async with lock:
        return await _finish_transfer_review_recompute(uid)


async def _finish_transfer_review_recompute(uid: str) -> dict:
    pending = await cashflow_cache_col.find_one(
        {"_id": uid}, {"transfer_review_pending_token": 1},
    )
    token = pending.get("transfer_review_pending_token") if pending else None
    if not token:
        return {"recomputed": False, "pending": False}

    from app.routers.analytics import compute_and_cache_cashflow
    completed = await compute_and_cache_cashflow(uid, clear_ai_cache=False)

    # An explicit result proves THIS invocation wrote its snapshot. Millisecond
    # watermarks alone cannot distinguish a failed call from an earlier write
    # in the same clock tick.
    after = await cashflow_cache_col.find_one(
        {"_id": uid}, {"dirty_since": 1, "transfer_review_pending_token": 1},
    )
    if completed is not True or not after:
        return {"recomputed": False, "pending": True, "failed": True}

    # A write may have landed while the compute was reading.  Its fresh token
    # means this calculation cannot cover that choice; restore dirty state
    # even when both writes happened in the same millisecond and
    # `clear_dirty` therefore could not distinguish their timestamps.
    if after.get("transfer_review_pending_token") != token:
        newer_token = after.get("transfer_review_pending_token")
        if newer_token:
            await cashflow_cache_col.update_one(
                {"_id": uid, "transfer_review_pending_token": newer_token},
                {"$set": {"dirty_since": _ms_now()}, "$unset": {"dirty_retry_after": ""}},
            )
            try:
                await response_cache.ainvalidate(uid)
            except Exception:
                logger.exception("finish_transfer_review_recompute(%s): response cache invalidation failed", uid)
        return {"recomputed": True, "pending": True}

    if after.get("dirty_since") is not None:
        return {"recomputed": False, "pending": True, "failed": True}

    # G447 (H145): the batch's answers change the stored transfers review; rebuild it now.
    try:
        from app.services import transfer_review_store
        transfer_review_store.refresh_soon(uid)
    except Exception:
        logger.exception("finish_transfer_review_recompute(%s): review store refresh failed to start", uid)
    # Finish the cross-process cache invalidation before acknowledging the batch.
    # A failure here retains the marker so Done can safely be retried.
    await response_cache.ainvalidate(uid)
    # Exact token equality, rather than millisecond timestamps, makes a
    # decision saved in the same clock tick as this flush impossible to lose.
    await cashflow_cache_col.update_one(
        {"_id": uid, "transfer_review_pending_token": token},
        {"$unset": {
            "transfer_review_pending_since": "",
            "transfer_review_pending_token": "",
        }},
    )
    latest = await cashflow_cache_col.find_one(
        {"_id": uid}, {"transfer_review_pending_token": 1},
    )
    return {"recomputed": True, "pending": bool(latest and latest.get("transfer_review_pending_token"))}


async def clear_dirty(uid: str, started_at: datetime) -> None:
    """Clear `dirty_since` iff the stamp is not newer than the recompute that
    just landed, i.e. the recompute read the data after the change. A stamp
    set while the recompute was running is newer and survives."""
    await cashflow_cache_col.update_one(
        {"_id": uid, "dirty_since": {"$lte": started_at}},
        {"$unset": {"dirty_since": "", "dirty_retry_after": ""}},
    )


async def cache_needs_recompute(uid: str, *, new_count: int, trigger: SyncTrigger) -> tuple[bool, str]:
    """Whether this sync must recompute the derived caches, and why."""
    if trigger == "user":
        # Always call this first, unconditionally, so the window is armed
        # even when new_count > 0 goes on to bypass the debounce below.
        debounced = _debounce_user_refresh(uid)
        if new_count > 0:
            return True, "user_refresh"
        if debounced:
            # A debounced tap must still not leave a doc a sync marked dirty.
            try:
                d = await cashflow_cache_col.find_one({"_id": uid}, {"dirty_since": 1})
            except Exception:
                d = None  # best-effort: a lookup failure keeps the debounce
            if d and d.get("dirty_since") is not None:
                return True, "dirty"
            return False, "debounced"
        return True, "user_refresh"
    if new_count > 0:
        return True, "new_transactions"
    from app.routers.analytics import PATTERNS_VERSION
    doc = await cashflow_cache_col.find_one(
        {"_id": uid}, {"computed_at": 1, "patterns_version": 1, "engine_build": 1, "dirty_since": 1, "model_work_pending": 1},
    )
    if not doc or doc.get("computed_at") is None:
        return True, "no_cache"
    # G177: a sync inserted/updated transactions since the last recompute
    # landed (mark_stale), even though THIS sync pulled nothing new and the
    # engine build is current.
    if doc.get("dirty_since") is not None:
        return True, "dirty"
    if doc.get("model_work_pending"):
        return True, "model_work"  # E18: an owed judge/predictor rerun
    if (doc.get("patterns_version") or 0) < PATTERNS_VERSION:
        return True, "patterns_version"
    if doc.get("engine_build") != engine_build():
        return True, "engine_build"
    return False, "unchanged"


async def recompute_derived_caches(uid: str, *, new_count: int, trigger: SyncTrigger) -> dict:
    """Recompute cashflow + money shape if `cache_needs_recompute` says so.

    Returns `{"recomputed": bool, "reason": str}`. The money-shape failure
    path is isolated the same way every existing caller isolated it: a
    broken shape compute must never lose the forecast recompute that just
    succeeded, nor fail the sync that called this."""
    should, reason = await cache_needs_recompute(uid, new_count=new_count, trigger=trigger)
    if not should:
        return {"recomputed": False, "reason": reason}
    from app.routers.analytics import compute_and_cache_cashflow
    await compute_and_cache_cashflow(uid)
    try:
        from app.services.money_shape import compute_and_cache_money_shape
        await compute_and_cache_money_shape(uid, background=True)
    except Exception:
        logger.exception("money_shape compute failed for %s", uid)
    logger.info("derived caches recomputed for %s (trigger=%s, reason=%s)", uid, trigger, reason)
    return {"recomputed": True, "reason": reason}


async def refresh_stale_cashflow_caches(*, reason: str) -> dict:
    """Deploy-time pass: recompute the forecast for every user whose cache
    doc is missing or was written by another engine build. One user at a
    time, a short pause between users, one user's failure never stops the
    rest. See the module docstring for where and why this runs.

    G159 review fix #4: `recomputed: True` only means `cache_needs_recompute`
    decided a recompute was owed and `compute_and_cache_cashflow` ran to
    completion without raising — it does NOT mean a fresh doc actually
    landed. `compute_and_cache_cashflow` (routers/analytics.py) catches
    every exception itself and only prints, by design (a broken forecast
    for one user must never take down the sync that triggered it), so a
    real compute failure never raises up to here and `failed` alone would
    never count it. This pass re-reads each user's stamp after the call and
    counts a STILL-stale stamp as a failure instead of a success, so the
    summary reflects what's actually in the database, not just what ran
    without throwing."""
    t0 = time.monotonic()
    user_ids = [u for u in await transactions_col.distinct("user_id") if u]
    recomputed = 0
    failed = 0
    for uid in user_ids:
        try:
            result = await recompute_derived_caches(uid, new_count=0, trigger="auto")
            if result["recomputed"]:
                doc = await cashflow_cache_col.find_one({"_id": uid}, {"engine_build": 1})
                if doc and doc.get("engine_build") == engine_build():
                    recomputed += 1
                else:
                    failed += 1
                    logger.error(
                        "engine refresh (%s): recompute for %s returned but the stamp is still stale "
                        "(compute_and_cache_cashflow likely swallowed an exception)", reason, uid,
                    )
                if _STARTUP_PAUSE_SECONDS:
                    await asyncio.sleep(_STARTUP_PAUSE_SECONDS)
        except Exception:
            failed += 1
            logger.exception("engine refresh (%s): recompute failed for %s", reason, uid)
    summary = {
        "reason": reason,
        "engine_build": engine_build(),
        "users": len(user_ids),
        "recomputed": recomputed,
        "failed": failed,
        "elapsed_ms": round((time.monotonic() - t0) * 1000, 1),
    }
    logger.info("engine refresh: %s", summary)
    return summary


# ---------------------------------------------------------------------------
# E18: request paths never recompute the forecast; they enqueue it.
#
# GET /cashflow serves the stored doc (stale allowed) and calls
# `enqueue_cashflow_recompute`, which puts `task_recompute_cashflow` on the
# arq worker under the job id `recompute:<uid>`, so a burst of reads (or a
# dirty doc read from two tabs) queues one job. The worker task is registered
# with keep_result=0 so a finished job does not block the next enqueue for
# arq's default hour. `_enqueued_recently` is a short per-process throttle
# that saves the Redis round trip for the burst itself and bounds a
# permanently failing recompute to one enqueue per window per process.
_ENQUEUE_THROTTLE_SECONDS = 30.0
_enqueued_recently: dict[str, float] = {}
# model_work only: when the queue was unreachable, back off for a few seconds
# rather than dialling Redis on every read.
_MODEL_WORK_BACKOFF_SECONDS = 5.0
_model_work_failed_at: dict[str, float] = {}
_inline_fallback_tasks: dict[str, "asyncio.Task"] = {}


async def _get_arq_pool():
    """Kept as the seam tests patch; the pool itself comes from the H148 choke
    point (a recording double in test runs)."""
    from app.workers import queue
    return await queue.get_pool()


async def enqueue_cashflow_recompute(uid: str, *, reason: str) -> bool:
    """Queue one worker recompute for `uid`. True when a job was queued or one
    is already queued; never raises. If the queue is unreachable, falls back
    to a single in-process recompute (which still never calls the model in
    the API process), so a dirty doc is never left waiting for the 6h pass."""
    now = time.monotonic()
    last = _enqueued_recently.get(uid)
    # "model_work" is exempt from the throttle: the owed rerun is recorded on
    # the doc and every read re-asks, so it must reach the queue each time
    # (arq's job id still dedupes a queued or running job).
    if reason == "model_work":
        failed = _model_work_failed_at.get(uid)
        if failed is not None and now - failed < _MODEL_WORK_BACKOFF_SECONDS:
            return False
    else:
        if last is not None and now - last < _ENQUEUE_THROTTLE_SECONDS:
            return True
        if len(_enqueued_recently) > 2000:
            for k in [k for k, t in _enqueued_recently.items() if now - t >= _ENQUEUE_THROTTLE_SECONDS]:
                del _enqueued_recently[k]
        _enqueued_recently[uid] = now
    try:
        pool = await _get_arq_pool()
        from app.workers import queue
        await queue.enqueue("task_recompute_cashflow", user_id=uid, reason=reason,
                            job_id=f"recompute:{uid}", pool=pool)
        logger.info("cashflow recompute enqueued for %s (reason=%s)", uid, reason)
        return True
    except Exception as exc:
        from app.workers import queue as _q
        _q.reset_pool()
        if reason == "model_work":
            # An API compute cannot do the owed model work, so an in-process
            # fallback would only repeat the judge-free compute. The marker on
            # the doc keeps the work owed; back off and let a later read retry.
            _model_work_failed_at[uid] = now
            if len(_model_work_failed_at) > 2000:
                for k in [k for k, t in _model_work_failed_at.items() if now - t >= _MODEL_WORK_BACKOFF_SECONDS]:
                    del _model_work_failed_at[k]
            logger.warning("cashflow model_work enqueue failed (%s); will retry on a later read", type(exc).__name__)
            return False
        logger.warning("cashflow recompute enqueue failed (%s); running in-process", type(exc).__name__)
    existing = _inline_fallback_tasks.get(uid)
    if existing is not None and not existing.done():
        return True
    from app.routers.analytics import compute_and_cache_cashflow
    _inline_fallback_tasks[uid] = asyncio.create_task(compute_and_cache_cashflow(uid))
    return False
