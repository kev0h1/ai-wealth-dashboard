"""All MongoDB collection handles as module-level singletons."""
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import MONGO_URI

# Cap the pool per process. The web and worker run as separate Railway
# services, each opening its own client; on Atlas M0 (500-connection cap)
# two processes at maxPoolSize=20 stay well inside the limit with headroom
# for a future replica. serverSelectionTimeoutMS fails fast if Atlas is
# unreachable instead of hanging a request for the default 30s.
_mongo = AsyncIOMotorClient(MONGO_URI, maxPoolSize=20, serverSelectionTimeoutMS=8000)
db     = _mongo["wealth"]

# TrueLayer
connections_col         = db["connections"]
accounts_col            = db["accounts"]
transactions_col        = db["transactions"]

# User data
preferences_col         = db["preferences"]
user_profiles_col       = db["user_profiles"]
chat_sessions_col       = db["chat_sessions"]
episodic_memory_col     = db["episodic_memory"]
user_categories_col     = db["user_categories"]
user_rules_col          = db["user_rules"]
merchant_categories_col = db["merchant_categories"]
budgets_col             = db["budgets"]
challenges_col          = db["challenges"]
account_rates_col       = db["account_rates"]
push_subscriptions_col  = db["push_subscriptions"]
apns_tokens_col         = db["apns_tokens"]
fcm_tokens_col          = db["fcm_tokens"]
notification_state_col  = db["notification_state"]

# Cross-account transfer-pair suggestions — learned description-pair
# confirmations (see analytics.py POST /transactions/confirm-transfer-pair
# and categorisation.py Pass 2's learned-pair matching). Keyed on
# canonical_merchant_key, not the raw description, so a confirmed pair
# survives month-to-month statement drift.
confirmed_transfer_pairs_col = db["confirmed_transfer_pairs"]

# Mono (Kenya)
mono_connections_col    = db["mono_connections"]
mono_accounts_col       = db["mono_accounts"]
mono_transactions_col   = db["mono_transactions"]

# M-Pesa
mpesa_accounts_col      = db["mpesa_accounts"]
mpesa_transactions_col  = db["mpesa_transactions"]

# Bank statements (UK + Kenya)
statement_accounts_col      = db["statement_accounts"]
statement_transactions_col  = db["statement_transactions"]
# One doc per successful statement/M-Pesa upload (app.core.subscription
# check_statement_upload_allowed / record_statement_upload) — counts
# against the Statements tier's statement_uploads_per_month cap.
statement_uploads_col       = db["statement_uploads"]

# Yapily
yapily_consents_col     = db["yapily_consents"]
yapily_accounts_col     = db["yapily_accounts"]
yapily_transactions_col = db["yapily_transactions"]

# Savings insights
savings_insights_col    = db["savings_insights"]
savings_labels_col      = db["savings_insight_labels"]

# Debt repayment plans
debt_plans_col          = db["debt_plans"]

# Card terms (per-user confirmed APR/promo facts) + shared product-rate cache
card_terms_col          = db["card_terms"]
card_product_rates_col  = db["card_product_rates"]

# Safety-net / savings goals
savings_goals_col       = db["savings_goals"]
manual_accounts_col     = db["manual_accounts"]
manual_transactions_col    = db["manual_transactions"]
manual_account_rules_col   = db["manual_account_rules"]
manual_account_mirrors_col = db["manual_account_mirrors"]

# Investments
investment_accounts_col = db["investment_accounts"]
investment_holdings_col = db["investment_holdings"]
investment_notes_col    = db["investment_contract_notes"]  # per-trade contract notes, additive between statements

# Grocery receipts / price intelligence
shopping_baskets_col    = db["shopping_baskets"]

# Subscriptions
subscriptions_col       = db["subscriptions"]
subscription_usage_col  = db["subscription_usage"]

# Penny message-cap top-ups (see app.core.subscription.penny_allowance) — a
# purchased (or admin-granted, for testing) top-up of extra Penny messages
# for one calendar month, additive on top of the user's tier limit for that
# month only. Doc shape: {user_id, year_month ("YYYY-MM"), messages (int),
# source: "purchase" | "admin", purchased_at}. No purchase path exists yet;
# today the only writer is POST /subscription/admin/topup (bot-only).
penny_topups_col        = db["penny_topups"]

# F9: MCP connector call-pack top-ups, same mechanics as penny_topups_col
# above but for MCP tool calls (see app.core.subscription.mcp_allowance /
# settle_mcp_packs). Doc shape: {user_id, pack_id, calls (int), remaining
# (int), price_gbp, purchased_at, expires_at (90d from purchase),
# year_month ("YYYY-MM"), source: "purchase" | "admin", settled_months}.
# No purchase path exists yet; today the only writer is POST
# /subscription/admin/topup (bot-only, kind="mcp").
mcp_call_packs_col      = db["mcp_call_packs"]

# B5: Stripe billing. billing_customers_col maps our own user_id (email) to
# a Stripe customer id, {user_id, stripe_customer_id, created_at} — created
# lazily the first time a user starts a checkout (app.services.billing's
# _get_or_create_customer), one doc per user. billing_events_col is the
# webhook idempotency ledger, {event_id (Stripe's own, unique), type,
# received_at, processed_at (None until handled), result} — POST
# /webhooks/stripe checks this before doing anything so a Stripe retry of
# an already-processed event is a no-op, not a double-grant. No purchase
# path is live yet (no Stripe account exists, see CLAUDE.md's Backlog B5
# note) — both collections stay empty until BILLING_ENABLED is true
# somewhere.
billing_customers_col  = db["billing_customers"]
billing_events_col     = db["billing_events"]

# Cashflow cache (computed after sync, read at page load)
cashflow_cache_col      = db["cashflow_cache"]

# Money shape cache (per-pay-period Fixed/Moved/Free/Left breakdown,
# computed after sync, read at page load — see app/services/money_shape.py)
money_shape_cache_col   = db["money_shape_cache"]

# Upcoming payment overrides (user-edits to forecast dates/amounts)
upcoming_overrides_col  = db["upcoming_overrides"]

# User-defined AI recurrence rules for upcoming items
upcoming_rules_col = db["upcoming_rules"]

# Webhook event log (TrueLayer webhooks → queue → processed)
webhook_events_col      = db["webhook_events"]

# User-level permanently removed TrueLayer account IDs (survives reconnects)
excluded_accounts_col   = db["excluded_accounts"]

# Distributed locks (startup migrations etc.)
locks_col               = db["locks"]

# Per-task cron run summaries (E2), one doc per task name (`_id`), overwritten
# on every run — a lightweight "what happened last time" store for
# GET /admin/sync-stats (app/routers/admin_usage.py) rather than a full run
# history. See app/workers/sync_worker.py's task_reconcile_truelayer.
worker_runs_col         = db["worker_runs"]

# Finexer
finexer_consents_col   = db["finexer_consents"]
finexer_customers_col  = db["finexer_customers"]

# H19: cached result of GET /providers (the full paginated AIS-provider
# list Finexer supports) — one doc, `_id: "providers"`, holding
# `{providers: [...], fetched_at, count}`. This is effectively static
# reference data, so app.services.finexer_sync.list_providers() re-walks
# every page only when this doc is missing or older than
# FINEXER_PROVIDERS_TTL_HOURS, instead of on every consent sync.
finexer_providers_col  = db["finexer_providers"]

# Bank-side PENDING transactions (provisional, not yet settled) — a SIBLING
# collection to `transactions_col`, deliberately never merged into it, so
# every existing consumer of `transactions_col` (recurring detection,
# categorisation learning, spend history, category totals) excludes these
# rows by construction. The ONLY consumer is the occurrence-matching choke
# point in app/routers/analytics.py::_build_cashflow_response. See
# app/services/pending_transactions.py for the full doctrine (ingestion,
# supersession-on-settle, sweep).
pending_transactions_col = db["pending_transactions"]

# Behavioural portrait cache (The Mirror)
behaviour_portrait_col  = db["behaviour_portraits"]

# Month-close needle history
needle_history_col      = db["needle_history"]

# Cycle (pay-period) story cache
cycle_story_col         = db["cycle_stories"]

# Companion spine — today-engine items + dismissals
companion_items_col     = db["companion_items"]

# Planned one-off expenses (user-declared future payments)
planned_expenses_col    = db["planned_expenses"]

# The Door — consent-gated checkpoints (BEHAVIOURS.md Layer 4)
checkpoints_col         = db["checkpoints"]
category_intent_col     = db["category_intents"]

# Commitments — named future big expenses funded a slice per pay period
commitments_col         = db["commitments"]

# Allocations — simple per-pay-period envelopes (owner decision, 2026-08-29:
# "it's merely an allocation ... just create an allocation, it deducts from
# what's available and have specific transactions fill it"). See
# app/routers/allocations.py for the full model.
allocations_col          = db["allocations"]

# ENGINE.md "The One Stream Rule" — every teaching signal (correction, naming,
# kind confirm, intent, ask answer, bill confirm/dismiss) lands here as one
# uniform event, user-scoped (Firewall Rule: nothing global). Indexed
# (user_id, created_at) — see app/main.py startup index creation.
teaching_events_col     = db["teaching_events"]

# Recurring-detector LLM scrutiny verdicts (app/services/recurring_judge.py)
# — per-user cache of "is this trusted-category series a genuine recurring
# bill or a set of one-off events sharing statement text" judgements, keyed
# f"{uid}::{series_key}". A vetoed series is excluded from projection but
# tracked separately from the user's own `dismissed_recurring` preference.
recurring_judge_col     = db["recurring_judge_verdicts"]

# Penny Agent Mode v1 — propose-only write tools (owner decision, 2026-08-30,
# see PENNY_TOOLS.md's "Write tools (propose-only)" section). Penny never
# executes an action herself: a write tool in app/services/penny_tools.py
# builds a validated PROPOSAL here, and POST /penny/proposals/{id}/execute
# (app/routers/can_i.py) is the ONLY thing that ever replays it, through the
# same router functions the app's own confirm sheets call. Doc shape: {_id
# (uuid str), user_id, kind, params, summary, consequence, created_at,
# expires_at (created_at + 15min — TTL index in app/main.py's
# _create_indexes), executed_at, result, cancelled_at}. All four of
# executed_at/result/cancelled_at start None; a proposal is "live" while all
# three stay None, "executed" once executed_at/result are set (execute is
# idempotent — a second call replays `result` rather than re-dispatching),
# "cancelled" once cancelled_at is set (blocks execute), or naturally expired
# once `expires_at` has passed with nothing else set.
penny_proposals_col     = db["penny_proposals"]

# Per-user data-version counter (see app/services/data_version.py) —
# `{_id: uid, version, updated_at}`. Bumped by every write path that changes
# something a cached response depends on; app/services/response_cache.py
# compares a cached entry's stamped version against this so invalidation is
# EXACT across processes (API + worker), not TTL-based. Indexed on `_id`
# only (Mongo's automatic primary-key index) — no extra index needed.
user_data_version_col   = db["user_data_version"]

# Linked sign-in identities — lets an authenticated user attach a second
# provider identity (e.g. Apple's Hide My Email relay address, which is
# stable per-app but distinct from their real email) to their existing
# account, so that provider's sign-in resolves to the SAME account instead
# of silently creating a second one. Keyed `_id: f"{provider}:{subject}"`
# (subject = the provider's stable per-user identifier, e.g. Apple's `sub`
# claim) so linking is idempotent per (provider, subject). Doc shape:
# {_id, provider, subject, user_id (canonical allow-list account email this
# identity resolves to), email_at_link (the email claim seen at link time,
# lowercased — may be a relay address), relay (bool, Apple's
# is_private_email at link time), linked_at}. See app/routers/auth.py's
# apple_native() (resolves through this map before the email allow list)
# and the /auth/identities endpoints.
linked_identities_col   = db["linked_identities"]

# D5: in-app sign-up allow list, the day-to-day layer on top of the
# ALLOWED_EMAILS env var (app.core.config) — adding/removing an address no
# longer needs a Railway env edit + redeploy, just the /ops/go-live page
# (app/routers/admin_allowlist.py). ALLOWED_EMAILS stays the seed list and
# is checked FIRST (app.core.allowlist.resolve_allowed_signup); this
# collection is consulted only when the seed list doesn't already allow the
# address. Doc shape: {key (Gmail dot-insensitive key, see
# app.core.config._gmail_key — unique, the lookup key), email (as entered,
# lower-cased), invited_by (inviter's email), created_at, status:
# "invited" | "revoked", note (optional str)}. Revoking sets status
# "revoked" rather than deleting the doc — no user data is ever deleted,
# and a re-invite of a revoked address flips it back to "invited" instead
# of creating a duplicate.
allowed_signups_col    = db["allowed_signups"]

# Cross-process response cache (see app/services/response_cache.py) — the
# Mongo-backed half of the two-layer (in-process memory + Mongo) per-user
# cache. `{user_id, name, version, day, payload, computed_at}`, unique on
# (user_id, name) with a 6h TTL index on computed_at (app/main.py's
# _create_indexes). app/services/warmup.py's warm_user() writes here right
# after a sync so the next request opens warm even after an API process
# restart, which the old pure in-memory cache could never survive.
response_cache_col      = db["response_cache"]

# Per-user/pipeline OpenRouter usage metering (see app/core/llm.py's
# `openrouter_chat`/`record_llm_usage`/`monthly_usage`) — every model call
# in the app now goes through that shared client, which writes one doc per
# request here: {user_id, pipeline, model, prompt_tokens, cached_tokens,
# completion_tokens, cost_usd, latency_ms, ts, year_month, message_id
# (penny only — one user message can span several tool-calling rounds,
# each its own doc, all sharing the same message_id so cost/usage can be
# rolled up per MESSAGE rather than per round)}. Indexed (user_id,
# year_month) for the monthly-usage rollup the /subscription surface reads,
# and (ts) for time-boxed debugging queries.
llm_usage_col           = db["llm_usage"]

# F3: audit log for the /mcp read connector (app/routers/mcp.py), one doc
# per `tools/call`, ok or not: {user_id, client ("session" until F2's OAuth
# server introduces real per-token clients), tool, ok, ts, year_month,
# latency_ms, dropped_keys (count of keys app/services/mcp_mask.py stripped
# from that call's result, never the values)}. Indexed (user_id, year_month)
# in app/main.py's _create_indexes, backing both the tier's monthly
# `mcp_tool_calls_per_month` allowance check and GET /mcp/audit.
mcp_calls_col           = db["mcp_calls"]

# F14: durable per-(user_id, year_month) call counter, one doc per pair:
# {user_id, year_month, count, updated_at}. Incremented via `$inc` on every
# metered `tools/call` in app.routers.mcp._write_audit, regardless of `ok`
# (a failed tool call still counts against the monthly allowance, same as
# mcp_calls_col's audit row does today). This is the SOURCE OF TRUTH for the
# monthly MCP allowance (app.core.subscription.mcp_allowance /
# settle_mcp_packs, via the shared `_mcp_call_count` helper) rather than
# mcp_calls_col row counts, so that the TTL index on mcp_calls_col (F14,
# app/main.py, MCP_AUDIT_TTL_DAYS) can reap old audit rows without ever
# resetting a user's usage mid-cycle. Seeded from existing mcp_calls_col rows
# once by app.main._seed_mcp_call_counters (idempotent via $setOnInsert), and
# never itself expires. Indexed unique on (user_id, year_month) in
# app/main.py's _create_indexes.
mcp_call_counters_col  = db["mcp_call_counters"]

# F2: OAuth 2.1 authorisation server (app/routers/oauth.py) for the /mcp
# connector — dynamic client registration, PKCE authorization codes, and
# opaque access/refresh tokens. See that module's own docstring for the
# full grant flow.
#
# oauth_clients_col: one doc per dynamically-registered connector.
# {_id: client_id, client_id, client_name, redirect_uris: [str, ...],
# token_endpoint_auth_method: "none" (public client, no secret — PKCE is
# the whole defence), grant_types, software_id (optional, RFC 7591),
# created_at}.
oauth_clients_col      = db["oauth_clients"]

# oauth_codes_col: one doc per issued PKCE authorization code, keyed by the
# SHA-256 hash of the (opaque, never-stored-raw) code — same doctrine as
# session tokens never being stored raw. {_id: code_hash, client_id, uid,
# redirect_uri, scopes: [str, ...], code_challenge (S256, base64url),
# created_at, expires_at (5 min — TTL index in app/main.py), used_at
# (None until redeemed; a second redemption attempt revokes every token
# minted from this code, see oauth.py's reuse-detection)}.
oauth_codes_col        = db["oauth_codes"]

# oauth_tokens_col: one doc per issued access OR refresh token, keyed by
# the SHA-256 hash of the opaque `sorted_at_`/`sorted_rt_`-prefixed token
# string (never stored raw). {_id: token_hash, kind: "access"|"refresh",
# client_id, client_name (denormalised at issuance so resolve_mcp_principal
# never has to join oauth_clients_col on every /mcp call), uid, scopes:
# [str, ...], created_at, expires_at (access 1h, refresh 30d — TTL index),
# last_used_at, revoked_at, pair_id (shared by the access/refresh token
# issued together in one grant — revoking either revokes both, "the
# family"), origin_code_hash (the authorization code this token's lineage
# started from, carried forward through refresh rotations, so a reused
# code revokes every descendant token too), rotated_from (the refresh
# token hash this one replaced, or None for a token minted straight from
# the code exchange)}.
oauth_tokens_col       = db["oauth_tokens"]
