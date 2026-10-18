"""E7 collector 5: Mongo size, collection count, index size and slow queries.

`dbStats` and `profile: -1` (which only reads the current profiling level) are
read-only. The profiler is never enabled here: with it off the slow-query
count is omitted and the note says so. An optional storage limit
(MONGO_STORAGE_LIMIT_MB, e.g. the Atlas tier's cap) gives size a status.
"""
from __future__ import annotations

from datetime import timedelta

from app.services.health.base import Collector, env_float, level, naive_utc_now, result, worst

SIZE_WARN, SIZE_CRIT = 0.75, 0.90
SLOW_WARN, SLOW_CRIT = 20, 200
SLOW_MS = 100
MB = 1048576.0


class MongoCollector(Collector):
    name = "mongo"
    title = "Database"
    sample_fields = {"storage_mb": "storage_mb"}

    def __init__(self, database=None):
        if database is None:
            from app.db.collections import db as database
        self.db = database

    async def collect(self) -> dict:
        stats = await self.db.command("dbStats")
        storage = float(stats.get("storageSize") or 0) + float(stats.get("indexSize") or 0)
        values = {
            "data_mb": round(float(stats.get("dataSize") or 0) / MB, 1),
            "storage_mb": round(float(stats.get("storageSize") or 0) / MB, 1),
            "index_mb": round(float(stats.get("indexSize") or 0) / MB, 1),
            "collections": int(stats.get("collections") or 0),
            "objects": int(stats.get("objects") or 0),
        }
        status = "ok"
        limit = env_float("MONGO_STORAGE_LIMIT_MB")
        values["limit_mb"] = limit
        if limit and limit > 0:
            status = level(storage / MB / limit, SIZE_WARN, SIZE_CRIT)

        notes = []
        try:
            prof = await self.db.command("profile", -1)
            profiling = int(prof.get("was", 0)) > 0
        except Exception:
            profiling = False
        if profiling:
            since = naive_utc_now() - timedelta(hours=24)
            slow = await self.db["system.profile"].count_documents({"ts": {"$gte": since}, "millis": {"$gte": SLOW_MS}})
            values["slow_queries_24h"] = slow
            status = worst(status, level(slow, SLOW_WARN, SLOW_CRIT))
        else:
            notes.append("Slow queries omitted: the profiler is off (not enabled by this page).")
        return result(self.name, status=status, values=values, note=" ".join(notes) or None)
