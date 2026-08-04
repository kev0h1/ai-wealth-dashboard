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
expo_push_tokens_col    = db["expo_push_tokens"]
notification_state_col  = db["notification_state"]

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

# Grocery receipts / price intelligence
shopping_baskets_col    = db["shopping_baskets"]

# Subscriptions
subscriptions_col       = db["subscriptions"]
subscription_usage_col  = db["subscription_usage"]

# Cashflow cache (computed after sync, read at page load)
cashflow_cache_col      = db["cashflow_cache"]

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
