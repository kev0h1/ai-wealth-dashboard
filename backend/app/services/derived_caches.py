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
  and otherwise only when the cache doc is missing, predates
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
from typing import Literal

from app.core.build import engine_build
from app.db.collections import cashflow_cache_col, transactions_col

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


async def cache_needs_recompute(uid: str, *, new_count: int, trigger: SyncTrigger) -> tuple[bool, str]:
    """Whether this sync must recompute the derived caches, and why."""
    if trigger == "user":
        # Always call this first, unconditionally, so the window is armed
        # even when new_count > 0 goes on to bypass the debounce below.
        debounced = _debounce_user_refresh(uid)
        if new_count > 0:
            return True, "user_refresh"
        if debounced:
            return False, "debounced"
        return True, "user_refresh"
    if new_count > 0:
        return True, "new_transactions"
    from app.routers.analytics import PATTERNS_VERSION
    doc = await cashflow_cache_col.find_one(
        {"_id": uid}, {"computed_at": 1, "patterns_version": 1, "engine_build": 1},
    )
    if not doc or doc.get("computed_at") is None:
        return True, "no_cache"
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
        await compute_and_cache_money_shape(uid)
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
