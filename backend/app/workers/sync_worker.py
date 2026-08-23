"""arq worker: bank sync tasks + reconciliation cron."""
import logging
from datetime import datetime, timedelta
from typing import Optional

from arq import ArqRedis, cron
from arq.connections import RedisSettings

from app.core.config import REDIS_URL
from app.core.push import send_push_to_user
from app.db.collections import (
    accounts_col, connections_col, yapily_consents_col, mono_connections_col,
    webhook_events_col, push_subscriptions_col, apns_tokens_col, fcm_tokens_col,
    finexer_consents_col,
)
from app.services.truelayer_sync import sync_connection, cull_orphaned_connections
from app.services.yapily_sync import sync_yapily_consent
from app.services.mono_sync import sync_mono_connection
from app.services.finexer_sync import finexer_sync_pipeline
from app.services.categorisation import apply_rules_bulk, categorise_others_bg
from app.services.manual_account_rules import apply_rules as apply_mirror_rules
from app.services.notifications import notif_pref
from app.db.collections import investment_accounts_col
from app.services.investment_prices import refresh_account_prices
from app.workers.ai_worker import task_refresh_savings_insights

logger = logging.getLogger(__name__)

# Specials that don't round-trip through a plain "strip 'ob-', title-case"
# transform — trademarked capitalisation, ampersands, or acronyms.
_BANK_NAME_SPECIALS = {
    "ms":       "M&S Bank",
    "hsbc":     "HSBC",
    "natwest":  "NatWest",
    "tsb":      "TSB",
    "amex":     "Amex",
    "chase_uk": "Chase",
}


def _bank_display_name(provider_id: Optional[str]) -> str:
    """Human-friendly bank name from a provider_id/provider like "ob-monzo"."""
    if not provider_id:
        return "Your bank"
    raw = provider_id[3:] if provider_id.startswith("ob-") else provider_id
    if raw in _BANK_NAME_SPECIALS:
        return _BANK_NAME_SPECIALS[raw]
    return raw.replace("_", " ").title()


async def _enqueue_weekly_insight_refresh(ctx, user_id: str) -> None:
    """Post-sync hook: queue a savings-insights refresh, at most once per user
    per ISO week (job-id dedupe). The refresh itself carries a 7-day per-category
    guard plus event-driven regen reasons, so even duplicate runs cannot spam
    search/LLM calls. Never lets a queueing hiccup fail the sync."""
    try:
        arq: ArqRedis = ctx.get("redis") if isinstance(ctx, dict) else None
        if arq is None or not user_id:
            return
        week = datetime.utcnow().strftime("%G-W%V")
        await arq.enqueue_job(
            "task_refresh_savings_insights",
            user_id=user_id,
            _job_id=f"insights:{user_id}:{week}",
        )
    except Exception:
        import logging
        logging.getLogger(__name__).warning("could not enqueue insights refresh for %s", user_id)


async def task_sync_truelayer(ctx, connection_id: str, user_id: str):
    ids, new_count = await sync_connection(connection_id, user_id)
    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    await apply_mirror_rules(user_id)
    if new_count > 0:
        from app.routers.analytics import compute_and_cache_cashflow
        await compute_and_cache_cashflow(user_id)
    await _enqueue_weekly_insight_refresh(ctx, user_id)
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
    await _enqueue_weekly_insight_refresh(ctx, user_id)
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


def _reconnect_body(bank: str, last_synced: Optional[datetime]) -> str:
    if isinstance(last_synced, datetime):
        return (
            f"{bank} last synced {last_synced.strftime('%-d %b')} and its bank permission "
            f"has ended. Tap Reconnect on the Accounts page to carry on."
        )
    return (
        f"{bank} stopped syncing because its bank permission ended. "
        f"Tap Reconnect on the Accounts page to carry on."
    )


def _expiring_copy(bank: str, expires_at: datetime, now: datetime) -> tuple[str, str]:
    days = (expires_at - now).days
    title = f"{bank} access expires tomorrow" if days <= 1 else f"{bank} access expires in {days} days"
    body = f"Reconnect before {expires_at.strftime('%-d %b')} to keep {bank} syncing without a gap."
    return title, body


async def task_consent_watch(ctx):
    """Daily nudge for bank connections whose consent is dead or expiring soon.

    `needs_reauth` (TrueLayer) and a non-"authorized" remote `status`
    (Finexer) are written during sync but, until now, nothing read them back
    — a dead connection just silently stopped syncing until a user happened
    to notice on the Accounts page. This walks every connection/consent that
    owns at least one account and pushes a calm reconnect nudge, throttled to
    once per 72h per connection so it can't nag on every run.

    NB: naive-UTC comparisons throughout, same convention as
    task_reconcile_truelayer — Mongo returns naive UTC datetimes here.
    """
    now = datetime.utcnow()
    warn_cutoff = now + timedelta(days=7)
    throttle_cutoff = now - timedelta(hours=72)

    nagged = 0
    warned = 0

    # ---- TrueLayer connections ----
    tl_conns = await connections_col.find(
        {"user_id": {"$exists": True, "$ne": None}},
        {"_id": 1, "user_id": 1, "needs_reauth": 1, "consent_expires_at": 1,
         "last_synced": 1, "provider": 1, "last_connection_nag": 1},
    ).to_list(None)

    for conn in tl_conns:
        uid = conn.get("user_id")
        if not uid:
            continue
        owns = await accounts_col.count_documents({"connection_id": conn["_id"]}, limit=1)
        if owns == 0:
            continue

        last_nag = conn.get("last_connection_nag")
        if isinstance(last_nag, datetime) and last_nag > throttle_cutoff:
            continue

        is_dead = bool(conn.get("needs_reauth"))
        expires_at = conn.get("consent_expires_at")
        is_expiring = (
            not is_dead
            and isinstance(expires_at, datetime)
            and now <= expires_at <= warn_cutoff
        )
        if not is_dead and not is_expiring:
            continue
        if not await notif_pref(uid, "connection_health"):
            continue

        bank = _bank_display_name(conn.get("provider"))
        if is_dead:
            title = f"{bank} needs reconnecting"
            body = _reconnect_body(bank, conn.get("last_synced"))
        else:
            title, body = _expiring_copy(bank, expires_at, now)

        try:
            await send_push_to_user(uid, title, body, url="/")
        except Exception:
            logger.exception("consent watch push failed for TrueLayer connection %s", conn["_id"])
            continue

        await connections_col.update_one({"_id": conn["_id"]}, {"$set": {"last_connection_nag": now}})
        if is_dead:
            nagged += 1
        else:
            warned += 1

    # ---- Finexer consents ----
    fx_consents = await finexer_consents_col.find(
        {"last_synced": {"$exists": True}},
        {"_id": 1, "user_id": 1, "status": 1, "expiry_date": 1,
         "last_synced": 1, "provider": 1, "last_connection_nag": 1},
    ).to_list(None)

    for fx in fx_consents:
        uid = fx.get("user_id")
        if not uid:
            continue

        last_nag = fx.get("last_connection_nag")
        if isinstance(last_nag, datetime) and last_nag > throttle_cutoff:
            continue

        is_dead = fx.get("status") != "authorized"
        expiry_date = fx.get("expiry_date")
        is_expiring = (
            not is_dead
            and isinstance(expiry_date, datetime)
            and now <= expiry_date <= warn_cutoff
        )
        if not is_dead and not is_expiring:
            continue
        if not await notif_pref(uid, "connection_health"):
            continue

        bank = _bank_display_name(fx.get("provider"))
        if is_dead:
            title = f"{bank} needs reconnecting"
            body = _reconnect_body(bank, fx.get("last_synced"))
        else:
            title, body = _expiring_copy(bank, expiry_date, now)

        try:
            await send_push_to_user(uid, title, body, url="/")
        except Exception:
            logger.exception("consent watch push failed for Finexer consent %s", fx["_id"])
            continue

        await finexer_consents_col.update_one({"_id": fx["_id"]}, {"$set": {"last_connection_nag": now}})
        if is_dead:
            nagged += 1
        else:
            warned += 1

    summary = {"nagged": nagged, "warned": warned}
    logger.info("consent watch: %s", summary)
    return summary


async def task_period_digests(ctx):
    """Fresh-start digest: one push per user on the first day of their pay
    period. send_period_digest itself checks the boundary, the user's
    notification pref, and de-duplicates per period — this cron just fans out
    over everyone with a push target (web push, APNs, or FCM)."""
    uids = set(await push_subscriptions_col.distinct("user_id"))
    uids |= set(await apns_tokens_col.distinct("user_id"))
    uids |= set(await fcm_tokens_col.distinct("user_id"))
    sent = 0
    for uid in uids:
        try:
            # Checkpoint resolution is NOT gated by notification prefs —
            # the app measures the outcome whether or not the user gets told.
            try:
                from app.services.checkpoints import resolve_due
                await resolve_due(uid)
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "checkpoint resolution failed for %s", uid
                )
            from app.services.notifications import send_period_digest
            await send_period_digest(uid)
            sent += 1
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning("period digest failed for %s: %s", uid, e)
    return {"checked": len(uids)}


async def task_refresh_investment_prices(ctx):
    """Refresh live prices for all investment accounts that have holdings.

    Runs daily at 06:30 UTC. Per-account exceptions are swallowed so one
    stale fetch doesn't abort the whole run.
    """
    import logging
    logger = logging.getLogger(__name__)

    all_accs = await investment_accounts_col.find({}).to_list(None)
    for acc in all_accs:
        account_id = acc["_id"]
        provider   = acc.get("provider", "Unknown")
        try:
            result = await refresh_account_prices(acc)
            logger.info(
                "investment price refresh: account=%s provider=%s updated=%s new_total=%.2f",
                account_id, provider, result["updated"], result["new_total"],
            )
        except Exception as e:
            logger.warning("investment price refresh failed for %s (%s): %s", account_id, provider, e)


class WorkerSettings:
    # task_refresh_savings_insights is defined in ai_worker but registered here
    # too: this is the worker systemd actually runs, so post-sync enqueues of
    # the weekly insights refresh land somewhere that executes them.
    functions = [task_sync_truelayer, task_sync_yapily, task_sync_mono,
                 task_sync_finexer, task_reconcile_truelayer, task_period_digests,
                 task_refresh_investment_prices, task_refresh_savings_insights,
                 task_consent_watch]
    cron_jobs = [
        cron(task_reconcile_truelayer, hour={0, 4, 8, 12, 16, 20}, minute=0, run_at_startup=False),
        cron(task_refresh_investment_prices, hour=6, minute=30, run_at_startup=False),
        # 07:00 UTC = start-of-morning UK; the task is a no-op except on each
        # user's period boundary
        cron(task_period_digests, hour=7, minute=0, run_at_startup=False),
        # 08:15 UK morning: nudge dead/expiring bank connections to reconnect.
        cron(task_consent_watch, hour=8, minute=15, run_at_startup=False),
    ]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    max_jobs = 5
    job_timeout = 600
