"""E16: the day-rollover warm. The response cache keys on the user's London
calendar day, so every user is cold at the first open after midnight. A
worker cron fires shortly after the rollover and warms the users who are
actually around, one at a time.

Activity (read-only): a user is "recent" when any of these is within the
window (7 days):
  * `user_profiles.last_active_at` (stamped by retention.stamp_activity on
    every authenticated request, so it is the session signal);
  * `connections.last_synced` (TrueLayer);
  * `finexer_consents.last_synced` (authorised consents only).
Logs carry counts only, never ids.
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from app.core import timeutil

logger = logging.getLogger(__name__)

ACTIVE_WINDOW_DAYS = 7
PAUSE_BETWEEN_USERS_SECONDS = 1.0
# The cron fires at 23:05 and 00:05 UTC; exactly one of them is 00:05 London
# (23:05 UTC in BST, 00:05 UTC in GMT). The task checks London time inside.
TIME_BUDGET_SECONDS = 500.0   # worker job_timeout is 600
ROLLOVER_UTC_HOURS = {23, 0}
ROLLOVER_MINUTE = 5


def is_london_rollover(now_utc: datetime | None = None) -> bool:
    """True when it is the 00:00 to 00:59 hour in London."""
    now_utc = now_utc or datetime.now(timezone.utc)  # naive-ok: aware UTC instant, converted to London or compared to stored UTC
    return now_utc.astimezone(timeutil.LONDON).hour == 0


async def select_recent_users(now_utc: datetime | None = None, days: int = ACTIVE_WINDOW_DAYS) -> list[str]:
    """Recently active users, most recent activity first (the latest of
    last_active_at and any last_synced), ties broken by id."""
    from app.db import collections as cols
    now_utc = now_utc or datetime.now(timezone.utc)  # naive-ok: aware UTC instant, converted to London or compared to stored UTC
    # Mongo returns and compares naive UTC datetimes here.
    cutoff = (now_utc - timedelta(days=days)).replace(tzinfo=None)
    latest: dict[str, datetime] = {}

    def note(uid, stamp):
        if isinstance(stamp, datetime) and (uid not in latest or stamp > latest[uid]):
            latest[uid] = stamp

    async for d in cols.user_profiles_col.find({"last_active_at": {"$gte": cutoff}}, {"_id": 1, "last_active_at": 1}):
        uid = d.get("_id")
        if isinstance(uid, str) and "@" in uid:
            note(uid, d.get("last_active_at"))
    for col, filt in (
        (cols.connections_col, {"last_synced": {"$gte": cutoff}}),
        (cols.finexer_consents_col, {"status": "authorized", "last_synced": {"$gte": cutoff}}),
    ):
        async for d in col.find(filt, {"user_id": 1, "last_synced": 1}):
            uid = d.get("user_id")
            if isinstance(uid, str) and uid:
                note(uid, d.get("last_synced"))
    return sorted(latest, key=lambda u: (-latest[u].timestamp(), u))


async def warm_recent_users(now_utc: datetime | None = None, *, pause: float = PAUSE_BETWEEN_USERS_SECONDS,
                            budget: float = TIME_BUDGET_SECONDS, clock=time.monotonic) -> dict:
    """Warm every recently active user, one at a time. Failures are logged
    (class name only) and skipped. warm_user is single-flight per uid."""
    from app.services.warmup import warm_user
    uids = await select_recent_users(now_utc)
    warmed = failed = skipped = 0
    started = clock()
    for i, uid in enumerate(uids):
        if clock() - started >= budget:
            skipped = len(uids) - i
            break
        if i and pause:
            await asyncio.sleep(pause)
        try:
            await warm_user(uid, include_cover_plan=True)
            warmed += 1
        except Exception as exc:
            failed += 1
            logger.warning("rollover warm: a user failed (%s)", type(exc).__name__)
    logger.info("rollover warm: users=%d warmed=%d skipped_for_budget=%d failed=%d",
                len(uids), warmed, skipped, failed)
    return {"users": len(uids), "warmed": warmed, "skipped": skipped, "failed": failed}
