"""FastAPI application factory."""
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import APP_URL, TRUELAYER_CLIENT_ID
from app.core.auth import auth_middleware
from app.db.collections import (
    connections_col, accounts_col, transactions_col, preferences_col,
    chat_sessions_col, episodic_memory_col, user_categories_col,
    budgets_col, mono_connections_col, mono_accounts_col, mono_transactions_col,
    savings_insights_col, savings_labels_col,
)
from app.services.categorisation import apply_rules_bulk, RAW_TRUELAYER_CATEGORIES

from app.routers import (
    auth, truelayer, yapily, mono, accounts as accounts_router,
    transactions as transactions_router, preferences, push, categories,
    analytics, budget, debt, chat, statements, investments, challenges,
    savings_insights, admin,
)

app = FastAPI(title="Wealth Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[APP_URL, "http://localhost:3000"],
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
    challenges.router, savings_insights.router, admin.router,
]:
    app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "truelayer_configured": bool(TRUELAYER_CLIENT_ID)}


@app.on_event("startup")
async def _create_indexes():
    await transactions_col.create_index("account_id")
    await transactions_col.create_index("date")
    await transactions_col.create_index("user_id")
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


@app.on_event("startup")
async def _migrate():
    email = "kevin.maingi12@gmail.com"
    for col in [connections_col, accounts_col, transactions_col]:
        await col.update_many({"user_id": {"$exists": False}}, {"$set": {"user_id": email}})
    await preferences_col.update_one(
        {"user_id": email, "pay_period_config": {"$exists": False}},
        {"$set": {"pay_period_config": {"type": "last_friday"}}},
        upsert=False,
    )
    asyncio.create_task(_fix_all_users_categories())


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
