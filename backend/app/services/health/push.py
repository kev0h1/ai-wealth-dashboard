"""E7 collector 8: push delivery over the last 24 hours.

There is no push delivery log on main today (core/push.py prunes dead tokens
but records no sent or failed counts), so this is feature-detected: it reads a
`push_log` collection of {ts, status: "sent" | "failed"} if one exists and
otherwise reports "omitted" with that note. It never creates the collection.
"""
from __future__ import annotations

from datetime import timedelta

from app.services.health.base import Collector, level, naive_utc_now, result

LOG_COLLECTION = "push_log"
MIN_SENDS = 10
FAIL_WARN, FAIL_CRIT = 0.10, 0.30


class PushDeliveryCollector(Collector):
    name = "push"
    title = "Push delivery"

    def __init__(self, database=None):
        if database is None:
            from app.db.collections import db as database
        self.db = database

    async def collect(self) -> dict:
        if LOG_COLLECTION not in await self.db.list_collection_names():
            return result(self.name, state="omitted", note="No push delivery log exists yet, so sent and failed counts are not available.")
        since = naive_utc_now() - timedelta(hours=24)
        col = self.db[LOG_COLLECTION]
        sent = await col.count_documents({"ts": {"$gte": since}, "status": "sent"})
        failed = await col.count_documents({"ts": {"$gte": since}, "status": "failed"})
        total = sent + failed
        status = level(failed / total, FAIL_WARN, FAIL_CRIT) if total >= MIN_SENDS else "ok"
        return result(self.name, status=status, values={"sent_24h": sent, "failed_24h": failed})
