"""E11: once-a-minute limit on user-present bank refresh (POST /accounts/sync).

A customer-present refresh is always allowed, but a double tap or a pull-to-
refresh loop should not cost a full Finexer sync (about 14 GETs per consent)
each time. One doc per user in `worker_runs` (`_id` `user_sync:<uid>`) holds
the last allowed time; the claim is a single atomic upsert whose filter only
matches when the last claim is older than the window, so two replicas cannot
both pass. A user whose connection has never synced (the first sync after
connect, or its retry) is exempt. Any storage failure fails OPEN: a lost
refresh is worse than an extra one.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60
MESSAGE = "Refreshed less than a minute ago"


def _naive_utc(now: Optional[datetime] = None) -> datetime:
    if now is not None:
        return now
    return datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: UTC wall time stored as a naive Mongo datetime


async def _first_sync_pending(uid: str) -> bool:
    from app.db.collections import connections_col, finexer_consents_col
    q = {"user_id": uid, "last_synced": {"$exists": False}}
    if await connections_col.count_documents(q, limit=1):
        return True
    return bool(await finexer_consents_col.count_documents({**q, "status": "authorized"}, limit=1))


async def check_user_sync(uid: str, now: Optional[datetime] = None) -> int:
    """0 when the refresh may run (and the window is claimed), otherwise the
    whole seconds to wait. `now` is the injected naive-UTC clock for tests."""
    try:
        if await _first_sync_pending(uid):
            return 0
        from app.db.collections import worker_runs_col
        t = _naive_utc(now)
        try:
            await worker_runs_col.find_one_and_update(
                {"_id": f"user_sync:{uid}", "last_at": {"$lt": t - timedelta(seconds=WINDOW_SECONDS)}},
                {"$set": {"last_at": t}},
                upsert=True,
            )
            return 0
        except DuplicateKeyError:
            doc = await worker_runs_col.find_one({"_id": f"user_sync:{uid}"}, {"last_at": 1}) or {}
            last = doc.get("last_at")
            if not isinstance(last, datetime):
                return 0
            return max(1, math.ceil(WINDOW_SECONDS - (t - last).total_seconds()))
    except Exception:
        logger.exception("sync throttle unavailable; allowing the refresh")
        return 0
