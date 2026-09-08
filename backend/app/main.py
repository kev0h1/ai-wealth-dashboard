"""FastAPI application factory."""
import asyncio
import logging
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

import os

from app.core.config import APP_URL, API_PUBLIC_URL, MCP_CONNECTOR_ENABLED, TRUELAYER_CLIENT_ID
from app.core.auth import auth_middleware
from app.db.collections import (
    connections_col, accounts_col, transactions_col, preferences_col,
    chat_sessions_col, episodic_memory_col, user_categories_col,
    budgets_col, mono_connections_col, mono_accounts_col, mono_transactions_col,
    statement_transactions_col, mpesa_transactions_col,
    savings_insights_col, savings_labels_col,
    subscriptions_col, subscription_usage_col, statement_uploads_col,
    yapily_consents_col, yapily_accounts_col, yapily_transactions_col,
    cashflow_cache_col, webhook_events_col,
    checkpoints_col, category_intent_col, commitments_col,
    teaching_events_col, allocations_col, penny_proposals_col,
    response_cache_col, mcp_calls_col,
    oauth_codes_col, oauth_tokens_col,
)
from app.services.categorisation import apply_rules_bulk, RAW_TRUELAYER_CATEGORIES
from app.services import data_version

from app.routers import (
    auth, truelayer, yapily, mono, accounts as accounts_router,
    transactions as transactions_router, preferences, push, categories,
    analytics, chat, statements, investments, challenges,
    savings_insights, savings, admin, manual_accounts, profile, money_basics,
    fuel, baskets, subscription as subscription_router, transport, webhooks,
    goals, logos, finexer, income, behaviour, companion, cards, cycle, planned,
    checkpoints, card_terms, debt_plan as debt_plan_router, grow, can_i,
    commitments, spend_verdict, tax, scenario, allocations, money_shape,
    penny_chip, ops, admin_usage, mcp as mcp_router, oauth as oauth_router,
)

if _dsn := os.getenv("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(dsn=_dsn, traces_sample_rate=0.1, environment=os.getenv("SENTRY_ENV", "vps"))

_slow_request_logger = logging.getLogger("app.perf")
_SLOW_REQUEST_MS = 400


def _routers(mcp_connector_enabled: bool) -> list:
    """The app's full router table. A17: `mcp_router` (F3, the /mcp
    Streamable HTTP connector) and `oauth_router` (F2, its OAuth 2.1
    authorisation server) are only included when the connector is turned on,
    so production ships with them entirely absent (no routes, no OpenAPI
    entries, not merely unauthenticated) per the Finexer compliance answers
    ("planned", not live). A small factory rather than an inline literal so
    tests (tests/test_mcp_connector_flag.py) can build a throwaway app with
    either value of the flag without reloading this module."""
    routers = [
        auth.router, truelayer.router, yapily.router, mono.router,
        accounts_router.router, transactions_router.router, preferences.router,
        push.router, categories.router, analytics.router,
        chat.router, statements.router, investments.router,
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
        grow.router,
        can_i.router,
        commitments.router,
        spend_verdict.router,
        tax.router,
        scenario.router,
        allocations.router,
        money_shape.router,
        penny_chip.router,
        ops.router,
        admin_usage.router,
    ]
    if mcp_connector_enabled:
        routers += [mcp_router.router, oauth_router.router]
    return routers


def build_app(mcp_connector_enabled: bool) -> FastAPI:
    """Construct a fresh FastAPI app with the full middleware/router stack,
    parameterized by the MCP connector flag (A17). The module-level `app`
    below is the one production instance, built from
    `app.core.config.MCP_CONNECTOR_ENABLED`; tests
    (tests/test_mcp_connector_flag.py) call this directly with an explicit
    True or False so route-table and middleware assertions never depend on
    whatever happens to be in the process environment when pytest runs
    (`MCP_CONNECTOR_ENABLED` is read from `backend/.env` on UAT, which the
    shared tree loads and a worktree does not, so a test that read the
    module-level constant instead would pass or fail depending on which
    tree it ran in). Callers that also need the middleware's
    `/mcp`-specific branches to match must additionally monkeypatch
    `app.core.auth.MCP_CONNECTOR_ENABLED`, since `auth_middleware` itself is
    one shared function object that reads that flag at call time, not
    something this factory can parameterize per app instance.
    """
    # Public API introspection (Swagger UI, ReDoc, raw OpenAPI schema) is off
    # by default in every deployed environment (UAT and prod), since it
    # leaks route/schema details to unauthenticated callers. Set
    # ENABLE_API_DOCS=1 locally to browse them during development; never set
    # it on the VPS or Railway.
    if os.getenv("ENABLE_API_DOCS"):
        built = FastAPI(title="Wealth Dashboard API")
    else:
        built = FastAPI(title="Wealth Dashboard API", docs_url=None, redoc_url=None, openapi_url=None)

    cors_origins = [APP_URL, API_PUBLIC_URL]
    # Capacitor mobile WebView origins (Android WebView with androidScheme
    # "https" reports Origin: https://localhost; some WebViews use the
    # capacitor: scheme).
    cors_origins.append("https://localhost")
    cors_origins.append("capacitor://localhost")
    if os.getenv("DEV_MODE"):
        cors_origins.append("http://localhost:3000")
    # Dedupe while preserving order (APP_URL/API_PUBLIC_URL could collide
    # with an explicit env override, or in a future config where they
    # match).
    cors_origins = list(dict.fromkeys(cors_origins))
    built.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        max_age=86400,
    )
    built.add_middleware(GZipMiddleware, minimum_size=1024)
    built.middleware("http")(auth_middleware)

    @built.middleware("http")
    async def _log_slow_requests(request, call_next):
        """Lightweight request timing: logs at WARNING only when a request
        takes longer than 400 ms, staying silent otherwise so it remains a
        no-op signal source rather than request-volume noise. Uses the
        stdlib logging module (no extra handler configured), so it's
        visible under uvicorn's own `--log-level warning` (the systemd
        unit's flag): WARNING is emitted via Python's logging "lastResort"
        handler to stderr regardless of uvicorn's own logger configuration,
        which systemd captures via the journal. Registered after
        auth_middleware so elapsed time reflects route/dependency
        execution, not the cheap token-decode auth check.
        """
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        if elapsed_ms > _SLOW_REQUEST_MS:
            _slow_request_logger.warning(
                "%s %s %s %.0fms",
                request.method, request.url.path, response.status_code, elapsed_ms,
            )
        return response

    for router in _routers(mcp_connector_enabled):
        built.include_router(router)

    @built.get("/health")
    async def health():
        from app.core.config import FINEXER_API_KEY
        return {
            "status": "ok",
            "truelayer_configured": bool(TRUELAYER_CLIENT_ID),
            "finexer_configured": bool(FINEXER_API_KEY),
        }

    return built


app = build_app(MCP_CONNECTOR_ENABLED)


@app.on_event("startup")
async def _create_indexes():
    await transactions_col.create_index("account_id")
    await transactions_col.create_index("date")
    await transactions_col.create_index("user_id")
    # Compound indexes for the paginated per-account list (filter + sort in one)
    # and the cross-account queries (user_id + date range).
    await transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await transactions_col.create_index([("user_id", 1), ("date", -1)])
    # ENGINE.md "Identity" stage — the similar-endpoint's primary lookup path
    # (an exact equality match on merchant_key), so it's an index hit rather
    # than the regex-prefix scan kept only as a fallback for rows missing the
    # field.
    await transactions_col.create_index([("user_id", 1), ("merchant_key", 1), ("transaction_type", 1)])
    await yapily_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await yapily_transactions_col.create_index([("user_id", 1), ("date", -1)])
    await statement_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await statement_transactions_col.create_index([("user_id", 1), ("date", -1)])
    await mpesa_transactions_col.create_index([("account_id", 1), ("user_id", 1), ("date", -1)])
    await mpesa_transactions_col.create_index([("user_id", 1), ("date", -1)])
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
    # Statements-tier upload cap (app.core.subscription check_statement_upload_allowed).
    await statement_uploads_col.create_index([("user_id", 1), ("year_month", 1)])
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
    await commitments_col.create_index([("user_id", 1), ("status", 1)])
    await allocations_col.create_index([("user_id", 1), ("active", 1)])
    # Penny Agent Mode v1 — 15-minute proposal TTL (owner decision,
    # 2026-08-30, see PENNY_TOOLS.md). expires_at is set at creation time
    # (app.services.penny_tools._create_proposal); Mongo reaps the doc
    # itself once it's past that instant, no separate sweep job needed.
    await penny_proposals_col.create_index([("user_id", 1), ("_id", 1)])
    await penny_proposals_col.create_index("expires_at", expireAfterSeconds=0)
    # ENGINE.md "The One Stream Rule" — the uniform teaching-event feed.
    await teaching_events_col.create_index([("user_id", 1), ("created_at", -1)])
    # Append-only event log with no consumer/rollup yet — TTL bounds growth
    # (365d retention) rather than letting it accumulate forever.
    await teaching_events_col.create_index([("created_at", 1)], expireAfterSeconds=31536000)
    # Response cache (app/services/response_cache.py) — one entry per
    # (user_id, name); TTL is the 6h safety bound described there.
    # user_data_version_col needs no explicit index: `_id` (uid) already has
    # Mongo's automatic primary-key index.
    await response_cache_col.create_index([("user_id", 1), ("name", 1)], unique=True)
    await response_cache_col.create_index(
        "computed_at", expireAfterSeconds=6 * 3600, name="response_cache_ttl"
    )
    # F3 /mcp connector audit log (app/routers/mcp.py), backs both
    # check_mcp_allowance's monthly count and GET /mcp/audit's per-user read.
    await mcp_calls_col.create_index([("user_id", 1), ("year_month", 1)])
    # F2 OAuth 2.1 authorisation server (app/routers/oauth.py). Codes and
    # tokens each TTL themselves out via their own `expires_at` (revocation
    # is an application-level flag, not what reaps the doc — a revoked
    # token still disappears naturally once it would have expired anyway).
    await oauth_codes_col.create_index("expires_at", expireAfterSeconds=0)
    await oauth_tokens_col.create_index("expires_at", expireAfterSeconds=0)
    # GET /oauth/connections' per-user, per-client rollup.
    await oauth_tokens_col.create_index([("uid", 1), ("client_id", 1)])
    # Revocation cascades ("the family") and the code-reuse cascade walk
    # these two.
    await oauth_tokens_col.create_index("pair_id")
    await oauth_tokens_col.create_index("origin_code_hash")


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
    asyncio.create_task(_migrate_category_kinds())
    asyncio.create_task(_fix_all_users_categories())
    asyncio.create_task(_seed_subscriptions())
    asyncio.create_task(_cleanup_stale_connections())
    asyncio.create_task(_cleanup_stale_yapily_data())
    asyncio.create_task(_seed_cashflow_cache())
    asyncio.create_task(_migrate_penny_topup_packs())


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


async def _migrate_category_kinds():
    """One-time: upgrade user_categories from [str] to [{name, kind}]."""
    from app.services.categories import migrate_category_kinds
    stats = await migrate_category_kinds()
    if stats["upgraded"]:
        print(f"[startup] category kinds migrated: {stats}")


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
            # Startup migration — categories changed under this user without
            # anything else invalidating their cached responses.
            await data_version.bump(uid)


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


async def _migrate_penny_topup_packs():
    """One-time (B11): backfill legacy `penny_topups` docs — inserted back
    when a top-up was a single £2.99/100-message row that expired at month
    end — to the pack shape (`pack_id`, `remaining`, `expires_at`,
    `settled_months`) that `app.core.subscription.penny_allowance`'s
    draw-down logic now expects. Idempotent: only touches docs missing
    `expires_at`, matched by `_id` on each write, so a second run finds
    nothing left to do.

    `purchased_at` for a doc that never recorded it falls back to its
    ObjectId's own embedded creation time (`ObjectId.generation_time`)
    rather than "now" — using "now" would give an old top-up a fresh 90-day
    life it never had, letting a stale pack draw down long after a real
    purchase that old would have expired."""
    from datetime import datetime, timedelta, timezone
    from bson import ObjectId
    from app.core.subscription import PENNY_TOPUP_LIFETIME_DAYS
    from app.db.collections import penny_topups_col

    count = 0
    async for doc in penny_topups_col.find({"expires_at": {"$exists": False}}):
        purchased_at = doc.get("purchased_at")
        if not purchased_at:
            oid = doc.get("_id")
            purchased_at = oid.generation_time if isinstance(oid, ObjectId) else datetime.now(timezone.utc)
        update = {
            "remaining":      doc.get("remaining", doc.get("messages", 0)),
            "purchased_at":   purchased_at,
            "expires_at":     purchased_at + timedelta(days=PENNY_TOPUP_LIFETIME_DAYS),
            "pack_id":        doc.get("pack_id") or ("admin" if doc.get("source") == "admin" else "legacy"),
            "settled_months": doc.get("settled_months", []),
        }
        await penny_topups_col.update_one({"_id": doc["_id"]}, {"$set": update})
        count += 1
    if count:
        print(f"[startup] migrated {count} legacy penny_topups docs to the B11 pack shape")


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
