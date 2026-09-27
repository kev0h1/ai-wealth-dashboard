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


async def cache_needs_recompute(uid: str, *, new_count: int, trigger: SyncTrigger) -> tuple[bool, str]:
    """Whether this sync must recompute the derived caches, and why."""
    if trigger == "user":
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
    rest. See the module docstring for where and why this runs."""
    t0 = time.monotonic()
    user_ids = [u for u in await transactions_col.distinct("user_id") if u]
    recomputed = 0
    failed = 0
    for uid in user_ids:
        try:
            result = await recompute_derived_caches(uid, new_count=0, trigger="auto")
            if result["recomputed"]:
                recomputed += 1
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
