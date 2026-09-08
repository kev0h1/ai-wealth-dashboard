"""Subscription tier endpoints."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import BOT_SECRET
from app.core.subscription import (
    PENNY_TOPUP, PENNY_TOPUP_LIFETIME_DAYS, PENNY_TOPUP_PACKS,
    TIER_BY_NAME, TIER_LIMITS, TIER_PRICES_GBP,
    get_subscription, penny_allowance,
)
from app.db.collections import subscriptions_col

router = APIRouter(tags=["subscription"])


@router.get("/subscription")
async def get_subscription_info(user: dict = Depends(current_user)):
    email = user["email"]
    sub = await get_subscription(email)

    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    usage = {
        "year_month": ym, "penny_messages": 0, "cost_usd": 0.0,
        # Message-cap fields (new): penny_limit is None for an unlimited
        # tier, mirroring app.core.subscription.penny_allowance's own
        # None-means-unlimited contract.
        "penny_limit": None, "penny_remaining": None,
        "penny_resets_on": None, "penny_topup_messages": 0,
        # B11 top-up packs (docs/pricing/tiering-unit-economics-mcp-2026-09.md
        # section 9): soonest expiry among the user's currently active packs
        # (None if they have none), and how many packs they bought THIS
        # calendar month — MoreMessagesSheet.tsx leads with "Move to Max"
        # instead of the packs once this reaches 2.
        "penny_topup_expires_soonest": None, "penny_packs_bought_this_month": 0,
    }
    try:
        from app.core.llm import monthly_usage
        result = await monthly_usage(email, ym)
        usage["penny_messages"] = result.get("penny_messages", 0)
        usage["cost_usd"]       = result.get("cost_usd", 0.0)
        usage["year_month"]     = result.get("year_month", ym)
    except Exception:
        pass

    try:
        allowance = await penny_allowance(email)
        usage["penny_limit"]                    = allowance["limit"]
        usage["penny_remaining"]                = allowance["remaining"]
        usage["penny_resets_on"]                = allowance["resets_on"]
        usage["penny_topup_messages"]           = allowance["topup_messages"]
        usage["penny_topup_expires_soonest"]    = allowance["topup_expires_soonest"]
        usage["penny_packs_bought_this_month"]  = allowance["packs_bought_this_month"]
    except Exception:
        pass

    return {
        "tier":        sub.tier_name,
        "status":      sub.status,
        "prices_gbp":  TIER_PRICES_GBP,
        # Legacy single-pack shape, kept for one release (see PENNY_TOPUP's
        # own comment in core/subscription.py) alongside the real pack list.
        "topup":       PENNY_TOPUP,
        "topups":      PENNY_TOPUP_PACKS,
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


@router.post("/subscription/admin/topup")
async def admin_topup(body: dict, user: dict = Depends(current_user)):
    """Bot/admin only — grant a Penny message top-up pack, no purchase flow
    behind it yet (billing is item B5). Exists so the message cap
    (app.core.subscription.penny_allowance, checked in POST /can-i) can be
    tested/lifted without billing being live.

    Accepts either `pack_id` (one of PENNY_TOPUP_PACKS' ids — messages and
    price are looked up from there) or a raw `messages` count. Either way
    the stored doc's own `pack_id` is "admin", not the referenced pack's id
    — this is an admin grant, not a purchase, so it must never count as a
    genuine pack sale if that distinction matters later."""
    if user.get("name") != "Bot":
        raise HTTPException(403, "Admin only")

    target_email = body.get("email")
    if not target_email:
        raise HTTPException(400, "email required")

    pack_id = body.get("pack_id")
    if pack_id:
        pack = next((p for p in PENNY_TOPUP_PACKS if p["id"] == pack_id), None)
        if pack is None:
            raise HTTPException(400, f"pack_id must be one of: {[p['id'] for p in PENNY_TOPUP_PACKS]}")
        messages = pack["messages"]
        price_gbp = pack["price_gbp"]
    else:
        try:
            messages = int(body.get("messages"))
        except (TypeError, ValueError):
            raise HTTPException(400, "messages must be an integer")
        if messages <= 0:
            raise HTTPException(400, "messages must be positive")
        price_gbp = 0.0

    from app.db.collections import penny_topups_col

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")
    await penny_topups_col.insert_one({
        "user_id":        target_email,
        "pack_id":        "admin",
        "messages":       messages,
        "remaining":      messages,
        "price_gbp":      price_gbp,
        "purchased_at":   now,
        "expires_at":     now + timedelta(days=PENNY_TOPUP_LIFETIME_DAYS),
        "year_month":     ym,
        "source":         "admin",
        "settled_months": [],
    })
    return {"ok": True, "email": target_email, "messages": messages, "year_month": ym}
