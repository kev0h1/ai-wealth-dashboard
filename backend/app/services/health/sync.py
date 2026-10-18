"""E7 collector 2: Finexer sync health.

Sources (all existing data): the reconcile run summary in `worker_runs`
(written by task_reconcile_truelayer), `finexer_consents.last_synced` and
`last_sync_error_at` (stamped by finexer_sync.sync_finexer_consent) for the
24 hour success and failure counts, and `orphaned_revocations` for pending A106
revocations. Consents without a webhook in 24 hours need A167's
`last_webhook_at`; that field is feature-detected (any consent carrying it)
and the figure is omitted while it does not exist.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.health.base import (
    CRIT, OK, WARN, Collector, level, naive_utc_now, result, worst,
)

RECONCILE_WARN_H, RECONCILE_CRIT_H = 8.0, 12.0     # cron runs every 4 h
REVOKE_WARN, REVOKE_CRIT = 1, 5
FAIL_WARN_RATIO, FAIL_CRIT_RATIO = 0.2, 0.5
MIN_ATTEMPTS = 5
NO_WEBHOOK_WARN = 1
LIVE_STATUSES = ["connected", "authorized"]


def _parse(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


class FinexerSyncCollector(Collector):
    name = "finexer_sync"
    title = "Bank sync"
    sample_fields = {"failed_24h": "failed_24h"}   # E8: the sync-failure surge rule

    def __init__(self, worker_runs=None, consents=None, orphaned=None):
        from app.db import collections as c
        self.worker_runs = worker_runs or c.worker_runs_col
        self.consents = consents or c.finexer_consents_col
        self.orphaned = orphaned or c.orphaned_revocations_col

    async def collect(self) -> dict:
        since = naive_utc_now() - timedelta(hours=24)
        run = await self.worker_runs.find_one({"_id": "task_reconcile_truelayer"})
        summary = (run or {}).get("summary") or {}
        last_at = _parse(summary.get("at"))
        age_h = None
        if last_at is not None:
            age_h = round((naive_utc_now().replace(tzinfo=timezone.utc) - last_at).total_seconds() / 3600, 1)

        ok_24 = await self.consents.count_documents({"last_synced": {"$gte": since}})
        failed_24 = await self.consents.count_documents({"last_sync_error_at": {"$gte": since}})
        pending = await self.orphaned.count_documents({})

        values: dict = {
            "last_reconcile_at": last_at.isoformat() if last_at else None,
            "last_reconcile_age_h": age_h,
            "reconciled": summary.get("reconciled"),
            "overflow": summary.get("overflow"),
            "synced_24h": ok_24,
            "failed_24h": failed_24,
            "pending_revocations": pending,
        }
        notes = []
        status = level(pending, REVOKE_WARN, REVOKE_CRIT)
        if age_h is not None:
            status = worst(status, level(age_h, RECONCILE_WARN_H, RECONCILE_CRIT_H))
        attempts = ok_24 + failed_24
        if attempts >= MIN_ATTEMPTS:
            status = worst(status, level(failed_24 / attempts, FAIL_WARN_RATIO, FAIL_CRIT_RATIO))

        has_webhook_field = await self.consents.find_one({"last_webhook_at": {"$exists": True}}, {"_id": 1})
        if has_webhook_field:
            stale = await self.consents.count_documents({
                "status": {"$in": LIVE_STATUSES},
                "$or": [{"last_webhook_at": {"$lt": since}}, {"last_webhook_at": {"$exists": False}}],
            })
            values["no_webhook_24h"] = stale
            status = worst(status, level(stale, NO_WEBHOOK_WARN, 10**9))
        else:
            notes.append("Consents without a webhook in 24 h omitted: last_webhook_at is not recorded yet.")
        return result(self.name, status=status, values=values, note=" ".join(notes) or None)
