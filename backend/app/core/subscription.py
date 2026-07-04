"""Subscription tiers, feature limits, and FastAPI gate dependencies."""
from datetime import datetime, timezone
from enum import IntEnum
from typing import Optional

from fastapi import Depends, HTTPException

from app.core.auth import current_user


class Tier(IntEnum):
    FREE = 0
    PRO = 1
    PREMIUM = 2
    FAMILY = 3


TIER_NAMES = {Tier.FREE: "free", Tier.PRO: "pro", Tier.PREMIUM: "premium", Tier.FAMILY: "family"}
TIER_BY_NAME = {v: k for k, v in TIER_NAMES.items()}

TIER_PRICES = {
    "pro":     {"monthly": 5.99,  "annual": 47.99},
    "premium": {"monthly": 9.99,  "annual": 79.99},
    "family":  {"monthly": 14.99, "annual": 119.99},
}

# None = unlimited
TIER_LIMITS = {
    Tier.FREE: {
        "max_connections":             2,
        "history_days":                90,
        "max_budget_categories":       5,
        "ai_chat_messages_per_month":  5,
        "receipt_scans_per_month":     5,
        "savings_insights":            False,
        "debt_plan_creation":          False,
        "investment_tracking":         False,
        "custom_categories":           False,
        "challenges":                  False,
        "export":                      False,
    },
    Tier.PRO: {
        "max_connections":             None,
        "history_days":                365,
        "max_budget_categories":       None,
        "ai_chat_messages_per_month":  50,
        "receipt_scans_per_month":     None,
        "savings_insights":            True,
        "debt_plan_creation":          True,
        "investment_tracking":         False,
        "custom_categories":           True,
        "challenges":                  True,
        "export":                      True,
    },
    Tier.PREMIUM: {
        "max_connections":             None,
        "history_days":                None,
        "max_budget_categories":       None,
        "ai_chat_messages_per_month":  None,
        "receipt_scans_per_month":     None,
        "savings_insights":            True,
        "debt_plan_creation":          True,
        "investment_tracking":         True,
        "custom_categories":           True,
        "challenges":                  True,
        "export":                      True,
    },
    Tier.FAMILY: {
        "max_connections":             None,
        "history_days":                None,
        "max_budget_categories":       None,
        "ai_chat_messages_per_month":  None,
        "receipt_scans_per_month":     None,
        "savings_insights":            True,
        "debt_plan_creation":          True,
        "investment_tracking":         True,
        "custom_categories":           True,
        "challenges":                  True,
        "export":                      True,
    },
}


class Subscription:
    def __init__(self, tier: Tier, status: str = "active"):
        self.tier = tier
        self.status = status
        self.limits = TIER_LIMITS[tier]

    @property
    def tier_name(self) -> str:
        return TIER_NAMES[self.tier]

    def allows(self, feature: str) -> bool:
        val = self.limits.get(feature)
        return bool(val) if isinstance(val, bool) else val is not None or True

    def limit(self, key: str) -> Optional[int]:
        return self.limits.get(key)


async def get_subscription(email: str) -> Subscription:
    from app.db.collections import subscriptions_col
    doc = await subscriptions_col.find_one({"user_id": email})
    if not doc or doc.get("status") == "expired":
        return Subscription(Tier.FREE)
    expires_at = doc.get("expires_at")
    if expires_at and expires_at < datetime.now(timezone.utc):
        return Subscription(Tier.FREE)
    tier = TIER_BY_NAME.get(doc.get("tier", "free"), Tier.FREE)
    return Subscription(tier, doc.get("status", "active"))


def require_tier(min_tier: Tier):
    """FastAPI dependency factory — raises 402 if user tier is below min_tier."""
    async def _dep(user: dict = Depends(current_user)) -> Subscription:
        sub = await get_subscription(user["email"])
        if sub.tier < min_tier:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "UPGRADE_REQUIRED",
                    "current_tier": sub.tier_name,
                    "required_tier": TIER_NAMES[min_tier],
                    "message": f"This feature requires a {TIER_NAMES[min_tier].title()} subscription.",
                },
            )
        return sub
    return _dep


async def check_connection_limit(email: str) -> None:
    """Raise 402 if Free-tier user has hit their 2-connection cap."""
    from app.db.collections import (
        connections_col, yapily_consents_col, subscriptions_col,
    )
    sub = await get_subscription(email)
    cap = sub.limit("max_connections")
    if cap is None:
        return
    # Only count completed OAuth flows — pending/abandoned records don't have access_token
    tl_count  = await connections_col.count_documents({"user_id": email, "access_token": {"$exists": True}})
    yap_count = await yapily_consents_col.count_documents({"user_id": email})
    if tl_count + yap_count >= cap:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "CONNECTION_LIMIT_REACHED",
                "current_tier": sub.tier_name,
                "limit": cap,
                "message": f"Free plan allows {cap} connected accounts. Upgrade to Pro for unlimited connections.",
            },
        )


async def check_ai_chat_limit(email: str) -> None:
    """Raise 402 if user has exhausted their monthly AI chat quota."""
    from app.db.collections import subscription_usage_col
    sub = await get_subscription(email)
    cap = sub.limit("ai_chat_messages_per_month")
    if cap is None:
        return
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    doc = await subscription_usage_col.find_one({"user_id": email, "year_month": ym})
    used = (doc or {}).get("ai_chat_messages", 0)
    if used >= cap:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "AI_CHAT_LIMIT_REACHED",
                "current_tier": sub.tier_name,
                "limit": cap,
                "used": used,
                "message": f"You've used all {cap} AI chat messages for this month. Upgrade to Pro for 50, or Premium for unlimited.",
            },
        )


async def increment_ai_chat_usage(email: str) -> None:
    from app.db.collections import subscription_usage_col
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    await subscription_usage_col.update_one(
        {"user_id": email, "year_month": ym},
        {"$inc": {"ai_chat_messages": 1}, "$set": {"user_id": email, "year_month": ym}},
        upsert=True,
    )


async def check_scan_limit(email: str) -> None:
    """Raise 402 if Free-tier user has hit their monthly receipt scan cap."""
    from app.db.collections import subscription_usage_col
    sub = await get_subscription(email)
    cap = sub.limit("receipt_scans_per_month")
    if cap is None:
        return
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    doc = await subscription_usage_col.find_one({"user_id": email, "year_month": ym})
    used = (doc or {}).get("receipt_scans", 0)
    if used >= cap:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "SCAN_LIMIT_REACHED",
                "current_tier": sub.tier_name,
                "limit": cap,
                "used": used,
                "message": f"You've used all {cap} receipt scans for this month. Upgrade to Pro for unlimited scanning.",
            },
        )


async def increment_scan_usage(email: str) -> None:
    from app.db.collections import subscription_usage_col
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    await subscription_usage_col.update_one(
        {"user_id": email, "year_month": ym},
        {"$inc": {"receipt_scans": 1}, "$set": {"user_id": email, "year_month": ym}},
        upsert=True,
    )
