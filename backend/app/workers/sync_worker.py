"""arq worker: bank sync tasks + reconciliation cron."""
from datetime import datetime, timedelta

from arq import ArqRedis, cron
from arq.connections import RedisSettings

from app.core.config import REDIS_URL
from app.db.collections import (
    accounts_col, connections_col, yapily_consents_col, mono_connections_col,
    webhook_events_col,
)
from app.services.truelayer_sync import sync_connection, cull_orphaned_connections
from app.services.yapily_sync import sync_yapily_consent
from app.services.mono_sync import sync_mono_connection
from app.services.categorisation import apply_rules_bulk, categorise_others_bg
from app.services.manual_account_rules import apply_rules as apply_mirror_rules


async def task_sync_truelayer(ctx, connection_id: str, user_id: str):
    ids, new_count = await sync_connection(connection_id, user_id)
    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    await apply_mirror_rules(user_id)
    if new_count > 0:
        from app.routers.analytics import compute_and_cache_cashflow
        await compute_and_cache_cashflow(user_id)
    return {"synced": len(ids), "new_transactions": new_count}


async def task_sync_yapily(ctx, consent_token: str, user_id: str):
    await sync_yapily_consent(consent_token, user_id)
    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    await apply_mirror_rules(user_id)
    return {"ok": True}


async def task_sync_mono(ctx, connection_id: str, user_id: str):
    ids = await sync_mono_connection(connection_id, user_id)
    await apply_mirror_rules(user_id)
    return {"synced": len(ids)}


async def task_reconcile_truelayer(ctx):
    """Catch any connections that missed a webhook in the last 12 hours.

    Runs twice daily (8am + 8pm). Culls superseded connections, re-syncs any
    TrueLayer connection whose last sync is stale, then retries failed
    webhook events.

    NB: Mongo returns naive UTC datetimes, so all comparisons here use naive
    utcnow — mixing in tz-aware datetimes raises TypeError.
    """
    arq: ArqRedis = ctx["redis"]
    now = datetime.utcnow()
    stale_cutoff = now - timedelta(hours=12)
    enqueued = 0

    await cull_orphaned_connections()

    # Oldest first, so when duplicates remain the newest connection syncs
    # last and wins the account claims.
    all_conns = await connections_col.find(
        {"access_token": {"$exists": True}},
        {"_id": 1, "user_id": 1, "last_synced": 1},
    ).sort("created_at", 1).to_list(None)

    for conn in all_conns:
        uid = conn.get("user_id")
        if not uid:
            continue
        # Skip connections that own no accounts — they're pending cull
        owns = await accounts_col.count_documents({"connection_id": conn["_id"]}, limit=1)
        if owns == 0:
            continue
        last_synced = conn.get("last_synced")
        if last_synced is None or last_synced < stale_cutoff:
            await arq.enqueue_job(
                "task_sync_truelayer",
                connection_id=str(conn["_id"]),
                user_id=uid,
                _job_id=f"reconcile:{conn['_id']}",  # deduplicate if already queued
            )
            enqueued += 1

    # Retry webhook events that failed or got stuck in pending > 15 minutes
    stuck_cutoff = now - timedelta(minutes=15)
    failed_events = await webhook_events_col.find(
        {
            "status": {"$in": ["failed", "pending"]},
            "received_at": {"$lt": stuck_cutoff},
            "user_id": {"$exists": True},
        },
        {"connection_id": 1, "resolved_connection_id": 1, "user_id": 1},
    ).to_list(50)

    for ev in failed_events:
        conn_id = ev.get("resolved_connection_id") or ev.get("connection_id")
        if not conn_id:
            continue
        await arq.enqueue_job(
            "task_sync_truelayer",
            connection_id=conn_id,
            user_id=ev["user_id"],
            _job_id=f"retry:{ev['_id']}",
        )
        await webhook_events_col.update_one(
            {"_id": ev["_id"]}, {"$set": {"status": "retried", "retried_at": now}}
        )
        enqueued += 1

    return {"reconciled": enqueued, "at": now.isoformat()}


class WorkerSettings:
    functions = [task_sync_truelayer, task_sync_yapily, task_sync_mono, task_reconcile_truelayer]
    cron_jobs = [
        cron(task_reconcile_truelayer, hour={8, 20}, minute=0, run_at_startup=False),
    ]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    max_jobs = 5
    job_timeout = 600
