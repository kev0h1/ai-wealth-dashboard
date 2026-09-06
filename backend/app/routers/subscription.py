"""Subscription tier endpoints."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import BOT_SECRET
from app.core.subscription import (
    PENNY_TOPUP, TIER_BY_NAME, TIER_LIMITS, TIER_PRICES_GBP,
    get_subscription,
)
from app.db.collections import subscriptions_col

router = APIRouter(tags=["subscription"])


@router.get("/subscription")
async def get_subscription_info(user: dict = Depends(current_user)):
    email = user["email"]
    sub = await get_subscription(email)

    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    usage = {"year_month": ym, "penny_messages": 0, "cost_usd": 0.0}
    try:
        from app.core.llm import monthly_usage
        result = await monthly_usage(email, ym)
        usage = {
            "penny_messages": result.get("penny_messages", 0),
            "cost_usd":       result.get("cost_usd", 0.0),
            "year_month":     result.get("year_month", ym),
        }
    except Exception:
        pass

    return {
        "tier":        sub.tier_name,
        "status":      sub.status,
        "prices_gbp":  TIER_PRICES_GBP,
        "topup":       PENNY_TOPUP,
        "limits":      TIER_LIMITS[sub.tier],
        "usage":       usage,
    }


@router.patch("/subscription/admin/set-tier")
async def admin_set_tier(body: dict, user: dict = Depends(current_user)):
    """Bot/admin only — manually set a user's subscription tier."""
    auth_header_ok = user.get("name") == "Bot"
    if not auth_header_ok:
        raise HTTPException(403, "Admin only")

    target_email = body.get("email")
    tier_name    = body.get("tier", "").lower()
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
