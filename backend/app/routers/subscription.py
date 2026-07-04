"""Subscription tier endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import BOT_SECRET
from app.core.subscription import (
    TIER_BY_NAME, TIER_LIMITS, TIER_NAMES, TIER_PRICES, Tier,
    get_subscription,
)
from app.db.collections import subscription_usage_col, subscriptions_col

router = APIRouter(tags=["subscription"])


@router.get("/subscription")
async def get_subscription_info(user: dict = Depends(current_user)):
    email = user["email"]
    sub = await get_subscription(email)

    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    usage_doc = await subscription_usage_col.find_one({"user_id": email, "year_month": ym}) or {}

    limits = TIER_LIMITS[sub.tier]

    return {
        "tier": sub.tier_name,
        "status": sub.status,
        "limits": {
            "max_connections":            limits["max_connections"],
            "history_days":               limits["history_days"],
            "max_budget_categories":      limits["max_budget_categories"],
            "ai_chat_messages_per_month": limits["ai_chat_messages_per_month"],
            "receipt_scans_per_month":    limits["receipt_scans_per_month"],
        },
        "features": {
            "savings_insights":    limits["savings_insights"],
            "debt_plan_creation":  limits["debt_plan_creation"],
            "investment_tracking": limits["investment_tracking"],
            "custom_categories":   limits["custom_categories"],
            "challenges":          limits["challenges"],
            "export":              limits["export"],
        },
        "usage": {
            "ai_chat_messages": usage_doc.get("ai_chat_messages", 0),
            "receipt_scans":    usage_doc.get("receipt_scans", 0),
        },
        "prices": TIER_PRICES,
    }


@router.patch("/subscription/admin/set-tier")
async def admin_set_tier(body: dict, user: dict = Depends(current_user)):
    """Bot/admin only — manually set a user's subscription tier."""
    auth_header_ok = user.get("name") == "Bot"
    if not auth_header_ok:
        raise HTTPException(403, "Admin only")

    target_email = body.get("email")
    tier_name    = body.get("tier", "free").lower()
    if not target_email:
        raise HTTPException(400, "email required")
    if tier_name not in TIER_BY_NAME:
        raise HTTPException(400, f"tier must be one of: {list(TIER_BY_NAME)}")

    await subscriptions_col.update_one(
        {"user_id": target_email},
        {
            "$set": {
                "user_id":    target_email,
                "tier":       tier_name,
                "status":     "active",
                "managed_by": "manual",
                "updated_at": datetime.now(timezone.utc),
            },
            "$setOnInsert": {"started_at": datetime.now(timezone.utc)},
        },
        upsert=True,
    )
    return {"ok": True, "email": target_email, "tier": tier_name}
