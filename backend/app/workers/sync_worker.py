"""arq worker: bank sync tasks + reconciliation cron."""
from datetime import datetime, timedelta

from arq import ArqRedis, cron
from arq.connections import RedisSettings

from app.core.config import REDIS_URL
from app.db.collections import (
    accounts_col, connections_col, yapily_consents_col, mono_connections_col,
    webhook_events_col, expo_push_tokens_col, push_subscriptions_col,
    finexer_consents_col,
)
from app.services.truelayer_sync import sync_connection, cull_orphaned_connections
from app.services.yapily_sync import sync_yapily_consent
from app.services.mono_sync import sync_mono_connection
from app.services.finexer_sync import finexer_sync_pipeline
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


async def task_sync_finexer(ctx, consent_id: str, user_id: str):
    result = await finexer_sync_pipeline(consent_id, user_id)
    return result


async def task_reconcile_truelayer(ctx):
    """Keep every connection fresh and catch missed webhooks.

    Runs every 4 hours (took over scheduled syncing when the Discord bot was
    retired). Culls superseded connections, re-syncs any TrueLayer connection
    whose last sync is stale, then retries failed webhook events.

    NB: Mongo returns naive UTC datetimes, so all comparisons here use naive
    utcnow — mixing in tz-aware datetimes raises TypeError.
    """
    arq: ArqRedis = ctx["redis"]
    now = datetime.utcnow()
    # Just under the cron interval, so every connection refreshes each cycle.
    # (This cron replaced the Discord bot's 4-hourly sync-all loop.)
    stale_cutoff = now - timedelta(hours=3, minutes=30)
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

    # Re-sync authorized Finexer consents whose last_synced is stale
    fx_conns = await finexer_consents_col.find(
        {"status": "authorized"},
        {"_id": 1, "user_id": 1, "last_synced": 1},
    ).sort("created_at", 1).to_list(None)

    for fx in fx_conns:
        uid = fx.get("user_id")
        if not uid:
            continue
        last_synced = fx.get("last_synced")
        if last_synced is None or last_synced < stale_cutoff:
            await arq.enqueue_job(
                "task_sync_finexer",
                consent_id=str(fx["_id"]),
                user_id=uid,
                _job_id=f"fx_reconcile:{fx['_id']}",
            )
            enqueued += 1

    return {"reconciled": enqueued, "at": now.isoformat()}


async def task_period_digests(ctx):
    """Fresh-start digest: one push per user on the first day of their pay
    period. send_period_digest itself checks the boundary, the user's
    notification pref, and de-duplicates per period — this cron just fans out
    over everyone with a push target."""
    uids = set(await expo_push_tokens_col.distinct("user_id"))
    uids |= set(await push_subscriptions_col.distinct("user_id"))
    sent = 0
    for uid in uids:
        try:
            from app.services.notifications import send_period_digest
            await send_period_digest(uid)
            sent += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("period digest failed for %s: %s", uid, e)
    return {"checked": len(uids)}


class WorkerSettings:
    functions = [task_sync_truelayer, task_sync_yapily, task_sync_mono,
                 task_sync_finexer, task_reconcile_truelayer, task_period_digests]
    cron_jobs = [
        cron(task_reconcile_truelayer, hour={0, 4, 8, 12, 16, 20}, minute=0, run_at_startup=False),
        # 07:00 UTC = start-of-morning UK; the task is a no-op except on each
        # user's period boundary
        cron(task_period_digests, hour=7, minute=0, run_at_startup=False),
    ]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    max_jobs = 5
    job_timeout = 600
