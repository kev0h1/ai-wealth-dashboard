"""Subscription tiers and feature limits (data only, no enforcement beyond
connection limits). See CLAUDE.md "Codex design round" section for the
retirement of the old free/pro/premium/family tiers.

Tiers: Statements (free, statement upload only) < Lite < Standard < Connect
< Max. Nobody should be restricted before launch — the tier a user gets
when they have no subscription doc (or an expired/unrecognised one) is
DEFAULT_TIER (app.core.config), which defaults to "max"."""
import logging
from datetime import date, datetime, timezone
from enum import IntEnum
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)


class Tier(IntEnum):
    STATEMENTS = 0   # free: statement upload only, no open banking
    LITE = 1
    STANDARD = 2
    CONNECT = 3
    MAX = 4


TIER_NAMES = {
    Tier.STATEMENTS: "statements",
    Tier.LITE:       "lite",
    Tier.STANDARD:   "standard",
    Tier.CONNECT:    "connect",
    Tier.MAX:        "max",
}
TIER_BY_NAME = {v: k for k, v in TIER_NAMES.items()}

TIER_PRICES_GBP = {
    "statements": 0.0,
    "lite":       5.99,
    "standard":   9.99,
    "connect":    12.99,
    "max":        16.99,
}

PENNY_TOPUP = {"messages": 100, "price_gbp": 2.99}

# None = unlimited
TIER_LIMITS = {
    Tier.STATEMENTS: {
        "open_banking":                False,
        "max_banks":                   0,
        "max_accounts":                0,
        "refresh":                     "on_upload",
        "penny_messages_per_month":    10,
        "mcp_tool_calls_per_month":    0,
        "history_days":                90,
        "statement_uploads_per_month": 3,
    },
    Tier.LITE: {
        "open_banking":                True,
        "max_banks":                   3,
        "max_accounts":                None,
        "refresh":                     "daily",
        "penny_messages_per_month":    40,
        "mcp_tool_calls_per_month":    0,
        "history_days":                180,
        "statement_uploads_per_month": None,
    },
    Tier.STANDARD: {
        "open_banking":                True,
        "max_banks":                   None,
        "max_accounts":                20,
        "refresh":                     "4h",
        "penny_messages_per_month":    150,
        "mcp_tool_calls_per_month":    0,
        "history_days":                None,
        "statement_uploads_per_month": None,
    },
    Tier.CONNECT: {
        "open_banking":                True,
        "max_banks":                   None,
        "max_accounts":                20,
        "refresh":                     "4h",
        "penny_messages_per_month":    150,
        "mcp_tool_calls_per_month":    2000,
        "history_days":                None,
        "statement_uploads_per_month": None,
    },
    Tier.MAX: {
        "open_banking":                True,
        "max_banks":                   None,
        "max_accounts":                None,
        "refresh":                     "priority",
        "penny_messages_per_month":    400,
        "mcp_tool_calls_per_month":    5000,
        "history_days":                None,
        "statement_uploads_per_month": None,
    },
}

# Legacy stored tier names map onto the new tiers for anyone with an existing
# subscription doc. "free" resolves to whatever DEFAULT_TIER is configured as
# (looked up lazily in get_subscription to avoid a stale import-time value).
_LEGACY_TIER_MAP = {
    "pro":     Tier.STANDARD,
    "premium": Tier.MAX,
    "family":  Tier.MAX,
}


class Subscription:
    def __init__(self, tier: Tier, status: str = "active"):
        self.tier = tier
        self.status = status
        self.limits = TIER_LIMITS[tier]

    @property
    def tier_name(self) -> str:
        return TIER_NAMES[self.tier]

    def limit(self, key: str) -> Optional[int]:
        return self.limits.get(key)


def _default_tier() -> Tier:
    from app.core.config import DEFAULT_TIER
    return TIER_BY_NAME.get(DEFAULT_TIER.strip().lower(), Tier.MAX)


async def get_subscription(email: str) -> Subscription:
    from app.db.collections import subscriptions_col

    default_tier = _default_tier()
    doc = await subscriptions_col.find_one({"user_id": email})
    if not doc or doc.get("status") == "expired":
        return Subscription(default_tier)

    expires_at = doc.get("expires_at")
    if expires_at and expires_at < datetime.now(timezone.utc):
        return Subscription(default_tier)

    stored_name = (doc.get("tier") or "").strip().lower()
    if stored_name in TIER_BY_NAME:
        tier = TIER_BY_NAME[stored_name]
    elif stored_name in _LEGACY_TIER_MAP:
        tier = _LEGACY_TIER_MAP[stored_name]
        logger.info("subscription: legacy tier '%s' mapped to '%s' for user", stored_name, TIER_NAMES[tier])
    else:
        tier = default_tier
        if stored_name == "free":
            logger.info("subscription: legacy tier 'free' mapped to default tier '%s' for user", TIER_NAMES[tier])
        elif stored_name:
            logger.info("subscription: unrecognised tier '%s' mapped to default tier '%s' for user", stored_name, TIER_NAMES[tier])

    return Subscription(tier, doc.get("status", "active"))


async def penny_allowance(email: str) -> dict:
    """This calendar month's Penny message allowance for `email`: the
    user's tier limit (`penny_messages_per_month`, None = unlimited) plus
    any purchased/admin top-ups (`penny_topups_col`) for the current UTC
    year_month, measured against `app.core.llm.monthly_usage`'s distinct-
    penny-message-id count.

    Returns `{"tier", "limit" (tier limit + this month's top-ups, None
    when the tier itself is unlimited), "used", "remaining" (None when
    unlimited), "resets_on" ("YYYY-MM-DD", the 1st of next month UTC),
    "topup_messages" (this month's top-up total, 0 if none)}`.

    Both cross-module reads (`penny_topups_col`, `monthly_usage`) are
    imported lazily inside the function, matching this module's own
    `get_subscription`/`check_connection_limit` convention above, so a
    test can monkeypatch either module's attribute and have it picked up
    here without a fresh top-level import cycle."""
    from app.core.llm import monthly_usage
    from app.db.collections import penny_topups_col

    sub = await get_subscription(email)
    tier_limit = sub.limit("penny_messages_per_month")

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")

    topup_messages = 0
    async for doc in penny_topups_col.find({"user_id": email, "year_month": ym}):
        topup_messages += int(doc.get("messages") or 0)

    limit = None if tier_limit is None else tier_limit + topup_messages

    usage = await monthly_usage(email, ym)
    used = int(usage.get("penny_messages") or 0)
    remaining = None if limit is None else max(0, limit - used)

    if now.month == 12:
        resets_on = date(now.year + 1, 1, 1)
    else:
        resets_on = date(now.year, now.month + 1, 1)

    return {
        "tier": sub.tier_name,
        "limit": limit,
        "used": used,
        "remaining": remaining,
        "resets_on": resets_on.isoformat(),
        "topup_messages": topup_messages,
    }


async def check_connection_limit(email: str) -> None:
    """Raise 402 if the user's tier's bank or account cap is exceeded.

    `max_banks` counts completed TrueLayer connections, connected Finexer
    consents, and Yapily consents. `max_accounts` counts `accounts_col`
    docs for the user. Either cap being None means unlimited. With the
    default tier at max, this is a no-op today."""
    from app.db.collections import (
        accounts_col, connections_col, finexer_consents_col, yapily_consents_col,
    )

    sub = await get_subscription(email)
    max_banks = sub.limit("max_banks")
    max_accounts = sub.limit("max_accounts")

    if max_banks is not None:
        tl_count = await connections_col.count_documents({"user_id": email, "access_token": {"$exists": True}})
        finexer_count = await finexer_consents_col.count_documents({"user_id": email, "status": "connected"})
        yap_count = await yapily_consents_col.count_documents({"user_id": email})
        bank_count = tl_count + finexer_count + yap_count
        if bank_count >= max_banks:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "CONNECTION_LIMIT_REACHED",
                    "current_tier": sub.tier_name,
                    "limit": max_banks,
                    "kind": "banks",
                    "message": f"Your {sub.tier_name.title()} plan allows up to {max_banks} connected banks.",
                },
            )

    if max_accounts is not None:
        account_count = await accounts_col.count_documents({"user_id": email})
        if account_count >= max_accounts:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "CONNECTION_LIMIT_REACHED",
                    "current_tier": sub.tier_name,
                    "limit": max_accounts,
                    "kind": "accounts",
                    "message": f"Your {sub.tier_name.title()} plan allows up to {max_accounts} connected accounts.",
                },
            )
