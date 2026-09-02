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
savings_plans_col       = db["savings_plans"]
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

# Finexer
finexer_consents_col   = db["finexer_consents"]
finexer_customers_col  = db["finexer_customers"]

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
