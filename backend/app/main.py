"""FastAPI application factory."""
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import os

from app.core.config import APP_URL, TRUELAYER_CLIENT_ID
from app.core.auth import auth_middleware
from app.db.collections import (
    connections_col, accounts_col, transactions_col, preferences_col,
    chat_sessions_col, episodic_memory_col, user_categories_col,
    budgets_col, mono_connections_col, mono_accounts_col, mono_transactions_col,
    statement_transactions_col, mpesa_transactions_col,
    savings_insights_col, savings_labels_col,
    subscriptions_col, subscription_usage_col,
    yapily_consents_col, yapily_accounts_col, yapily_transactions_col,
    cashflow_cache_col, webhook_events_col,
    checkpoints_col, category_intent_col,
)
from app.services.categorisation import apply_rules_bulk, RAW_TRUELAYER_CATEGORIES

from app.routers import (
    auth, truelayer, yapily, mono, accounts as accounts_router,
    transactions as transactions_router, preferences, push, categories,
    analytics, budget, debt, chat, statements, investments, challenges,
    savings_insights, savings, admin, manual_accounts, profile, money_basics,
    fuel, baskets, subscription as subscription_router, transport, webhooks,
    goals, logos, finexer, income, behaviour, companion, cards, cycle, planned,
    checkpoints, card_terms, debt_plan as debt_plan_router,
)

if _dsn := os.getenv("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(dsn=_dsn, traces_sample_rate=0.1, environment=os.getenv("SENTRY_ENV", "vps"))

app = FastAPI(title="Wealth Dashboard API")

_cors_origins = [APP_URL]
if os.getenv("DEV_MODE"):
    _cors_origins.append("http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.middleware("http")(auth_middleware)

for router in [
    auth.router, truelayer.router, yapily.router, mono.router,
    accounts_router.router, transactions_router.router, preferences.router,
    push.router, categories.router, analytics.router, budget.router,
    debt.router, chat.router, statements.router, investments.router,
    challenges.router, savings_insights.router, savings.router, admin.router,
    manual_accounts.router, profile.router, money_basics.router,
    fuel.router, baskets.router, subscription_router.router, transport.router,
    webhooks.router, goals.router, logos.router, finexer.router,
    income.router,
    behaviour.router,
    companion.router,
    cards.router,
    cycle.router,
    planned.router,
    checkpoints.router,
    card_terms.router,
    debt_plan_router.router,
]:
    app.include_router(router)


@app.get("/health")
async def health():
    from app.core.config import FINEXER_API_KEY
    return {
        "status": "ok",
        "truelayer_configured": bool(TRUELAYER_CLIENT_ID),
        "finexer_configured": bool(FINEXER_API_KEY),
    }


@app.on_event("startup")
async def _create_indexes():
    await transactions_col.create_index("account_id")
    await transactions_col.create_index("date")
    await transactions_col.create_index("user_id")
    # Compound indexes for the paginated per-account list (filter + sort in one)
    # and the cross-account queries (user_id + date range).
    await transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await transactions_col.create_index([("user_id", 1), ("date", -1)])
    await yapily_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await yapily_transactions_col.create_index([("user_id", 1), ("date", -1)])
    await statement_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await statement_transactions_col.create_index([("user_id", 1), ("date", -1)])
    await mpesa_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await mono_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await accounts_col.create_index("connection_id")
    await accounts_col.create_index("user_id")
    await connections_col.create_index("user_id")
    await preferences_col.create_index("user_id", unique=True)
    await chat_sessions_col.create_index("user_id")
    await chat_sessions_col.create_index([("created_at", 1)], expireAfterSeconds=604800)
    await episodic_memory_col.create_index("user_id", unique=True)
    await user_categories_col.create_index("user_id", unique=True)
    await budgets_col.create_index([("user_id", 1), ("region", 1)], unique=True)
    await mono_connections_col.create_index("user_id")
    await mono_accounts_col.create_index("user_id")
    await mono_transactions_col.create_index([("user_id", 1), ("date", -1)])
    await savings_insights_col.create_index("expires_at", expireAfterSeconds=0, sparse=True)
    await savings_insights_col.create_index([("user_id", 1), ("category", 1)])
    await savings_labels_col.create_index([("user_id", 1), ("merchant_key", 1)], unique=True)
    await subscriptions_col.create_index("user_id", unique=True)
    await subscription_usage_col.create_index([("user_id", 1), ("year_month", 1)], unique=True)
    await cashflow_cache_col.create_index("computed_at")
    await webhook_events_col.create_index([("status", 1), ("received_at", 1)])
    # TTL: auto-delete webhook event logs after 30 days
    try:
        await webhook_events_col.drop_index("received_at_1")
    except Exception:
        pass
    await webhook_events_col.create_index(
        "received_at", expireAfterSeconds=30 * 24 * 3600, name="webhook_ttl"
    )
    await checkpoints_col.create_index([("user_id", 1), ("status", 1), ("period_end", 1)])
    await checkpoints_col.create_index([("user_id", 1), ("ref", 1), ("period_end", 1)])
    await category_intent_col.create_index(
        [("user_id", 1), ("category", 1), ("period_end", 1)], unique=True
    )


async def _acquire_migration_lock() -> bool:
    """One worker runs startup migrations; others skip. Lock self-expires."""
    from datetime import datetime, timedelta
    from app.db.collections import locks_col
    now = datetime.utcnow()
    result = await locks_col.find_one_and_update(
        {"_id": "startup_migrations",
         "$or": [{"acquired_at": {"$lt": now - timedelta(seconds=60)}},
                 {"acquired_at": {"$exists": False}}]},
        {"$set": {"acquired_at": now}},
        upsert=False,
    )
    if result is not None:
        return True
    try:
        await locks_col.insert_one({"_id": "startup_migrations", "acquired_at": now})
        return True
    except Exception:  # duplicate key — another worker holds a fresh lock
        return False


@app.on_event("startup")
async def _migrate():
    if not await _acquire_migration_lock():
        return
    email = "kevin.maingi12@gmail.com"
    for col in [connections_col, accounts_col, transactions_col]:
        await col.update_many({"user_id": {"$exists": False}}, {"$set": {"user_id": email}})
    await preferences_col.update_one(
        {"user_id": email, "pay_period_config": {"$exists": False}},
        {"$set": {"pay_period_config": {"type": "last_friday"}}},
        upsert=False,
    )
    asyncio.create_task(_encrypt_plaintext_tokens())
    asyncio.create_task(_fix_all_users_categories())
    asyncio.create_task(_seed_subscriptions())
    asyncio.create_task(_cleanup_stale_connections())
    asyncio.create_task(_cleanup_stale_yapily_data())
    asyncio.create_task(_seed_cashflow_cache())


async def _encrypt_plaintext_tokens():
    """One-time: encrypt any bank tokens still stored as plaintext."""
    from app.core.crypto import encrypt_token, is_encrypted
    count = 0
    async for conn in connections_col.find({"access_token": {"$exists": True}}):
        update = {}
        for field in ("access_token", "refresh_token"):
            val = conn.get(field)
            if val and not is_encrypted(val):
                update[field] = encrypt_token(val)
        if update:
            await connections_col.update_one({"_id": conn["_id"]}, {"$set": update})
            count += 1
    if count:
        print(f"[startup] encrypted tokens on {count} connections")


async def _fix_all_users_categories():
    user_ids = await transactions_col.distinct("user_id")
    for uid in user_ids:
        if not uid:
            continue
        needs_fix = await transactions_col.count_documents({
            "user_id": uid, "custom_category": None,
            "$or": [{"category": None}, {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES) + ["Other"]}}],
        })
        if needs_fix > 0:
            await apply_rules_bulk(uid)


async def _cleanup_stale_yapily_data():
    """Remove yapily_accounts and yapily_transactions for users with no active Yapily consent.

    These are orphaned records from past Yapily connections that were later replaced by
    TrueLayer. They cause phantom duplicate accounts on the accounts page and confuse the
    delete logic (delete_account finds the Yapily copy first, leaving the TrueLayer copy).
    """
    user_ids = await yapily_accounts_col.distinct("user_id")
    for uid in user_ids:
        if not uid:
            continue
        has_consent = await yapily_consents_col.count_documents(
            {"user_id": uid, "status": "AUTHORIZED"}
        )
        if has_consent == 0:
            accts = await yapily_accounts_col.delete_many({"user_id": uid})
            txns  = await yapily_transactions_col.delete_many({"user_id": uid})
            if accts.deleted_count:
                print(f"[startup] cleaned {accts.deleted_count} stale yapily accounts "
                      f"and {txns.deleted_count} transactions for {uid}")


async def _cleanup_stale_connections():
    """Delete pending TrueLayer OAuth records older than 2 hours that never
    completed, plus completed connections superseded by a reconnect."""
    from datetime import datetime, timedelta
    from app.services.truelayer_sync import cull_orphaned_connections
    cutoff = datetime.utcnow() - timedelta(hours=2)
    result = await connections_col.delete_many({
        "access_token": {"$exists": False},
        "created_at":   {"$lt": cutoff},
    })
    if result.deleted_count:
        print(f"[startup] cleaned up {result.deleted_count} stale pending connections")
    culled = await cull_orphaned_connections()
    if culled:
        print(f"[startup] culled {culled} superseded connections")


async def _seed_cashflow_cache():
    """Populate cashflow cache for any user who has none yet."""
    from app.routers.analytics import compute_and_cache_cashflow
    user_ids = await transactions_col.distinct("user_id")
    for uid in user_ids:
        if not uid:
            continue
        existing = await cashflow_cache_col.find_one({"_id": uid}, {"_id": 1})
        if not existing:
            await compute_and_cache_cashflow(uid)


async def _seed_subscriptions():
    """Seed subscription tiers for all known users. Idempotent — skips existing docs."""
    from datetime import datetime, timezone
    from app.core.config import ALLOWED_EMAILS

    FREE_USERS = {"mbithi.maingi12@gmail.com"}

    for email in ALLOWED_EMAILS:
        existing = await subscriptions_col.find_one({"user_id": email})
        if existing:
            continue
        tier = "free" if email in FREE_USERS else "premium"
        await subscriptions_col.insert_one({
            "user_id":    email,
            "tier":       tier,
            "status":     "active",
            "managed_by": "manual",
            "started_at": datetime.now(timezone.utc),
            "expires_at": None,
        })
