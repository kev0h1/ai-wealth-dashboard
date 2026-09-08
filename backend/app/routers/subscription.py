"""Subscription tier endpoints."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import BILLING_ENABLED, BOT_SECRET
from app.core.subscription import (
    MCP_CALL_PACKS, PENNY_TOPUP, PENNY_TOPUP_LIFETIME_DAYS, PENNY_TOPUP_PACKS,
    TIER_BY_NAME, TIER_LIMITS, TIER_PRICES_GBP,
    get_subscription, grant_pack, mcp_allowance, penny_allowance,
)
from app.db.collections import subscriptions_col

# B5: real billing now exists (Stripe, test mode, behind BILLING_ENABLED in
# app.core.config) but no Stripe account has been created yet, so this is
# false in every environment today. Once BILLING_ENABLED flips true (a
# secret key and every price id configured), GET /subscription's
# `billing_live` follows it straight through and the frontend swaps
# "Available soon" rows for real checkout/portal buttons (MoreMessagesSheet,
# ConnectedAssistantsCard, the "Your plan" Settings card).

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

    # F9: MCP connector call allowance, same shape family as the `usage`
    # penny_* fields above but kept as its own block since ConnectedAssistantsCard
    # (not the Penny sheet) is what reads it. `limit`/`remaining` are None
    # for a tier that would be unlimited (no tier is today) and 0 for a
    # tier without the connector at all (Statements/Lite/Standard).
    mcp = {
        "limit": 0, "used": 0, "remaining": 0,
        "resets_on": None, "packs": MCP_CALL_PACKS, "pack_calls": 0,
    }
    try:
        mcp_allow = await mcp_allowance(email)
        mcp["limit"]      = mcp_allow["limit"]
        mcp["used"]       = mcp_allow["used"]
        mcp["remaining"]  = mcp_allow["remaining"]
        mcp["resets_on"]  = mcp_allow["resets_on"]
        mcp["pack_calls"] = mcp_allow["pack_calls"]
    except Exception:
        pass

    return {
        "tier":         sub.tier_name,
        "status":       sub.status,
        "prices_gbp":   TIER_PRICES_GBP,
        "billing_live": BILLING_ENABLED,
        # Legacy single-pack shape, kept for one release (see PENNY_TOPUP's
        # own comment in core/subscription.py) alongside the real pack list.
        "topup":        PENNY_TOPUP,
        "topups":       PENNY_TOPUP_PACKS,
        "limits":       TIER_LIMITS[sub.tier],
        "usage":        usage,
        "mcp":          mcp,
        "mcp_packs":    MCP_CALL_PACKS,
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
    """Bot/admin only — grant a Penny message top-up pack (`kind: "penny"`,
    the default) or an MCP connector call-pack (`kind: "mcp"`, F9), no
    purchase flow behind either yet (billing is item B5). Exists so the
    message/call caps (app.core.subscription.penny_allowance /
    mcp_allowance) can be tested/lifted without billing being live.

    Accepts either `pack_id` (one of PENNY_TOPUP_PACKS' or MCP_CALL_PACKS'
    ids, depending on `kind` — the amount and price are looked up from
    there) or a raw `messages`/`calls` count. Either way the stored doc's
    own `pack_id` is "admin", not the referenced pack's id — this is an
    admin grant, not a purchase, so it must never count as a genuine pack
    sale if that distinction matters later."""
    if user.get("name") != "Bot":
        raise HTTPException(403, "Admin only")

    target_email = body.get("email")
    if not target_email:
        raise HTTPException(400, "email required")

    kind = (body.get("kind") or "penny").lower()
    if kind not in ("penny", "mcp"):
        raise HTTPException(400, "kind must be 'penny' or 'mcp'")

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")

    if kind == "mcp":
        pack_id = body.get("pack_id")
        if pack_id:
            # B5: shared with the Stripe purchase webhook — see
            # app.core.subscription.grant_pack's own docstring for why the
            # stored doc's pack_id field stays "admin" here (source="admin"
            # is the default already used by every caller below).
            try:
                doc = await grant_pack(target_email, "mcp", pack_id, source="admin")
            except ValueError as exc:
                raise HTTPException(400, str(exc))
            return {"ok": True, "email": target_email, "calls": doc["calls"], "year_month": doc["year_month"]}

        try:
            calls = int(body.get("calls"))
        except (TypeError, ValueError):
            raise HTTPException(400, "calls must be an integer")
        if calls <= 0:
            raise HTTPException(400, "calls must be positive")
        price_gbp = 0.0

        from app.db.collections import mcp_call_packs_col

        await mcp_call_packs_col.insert_one({
            "user_id":        target_email,
            "pack_id":        "admin",
            "calls":          calls,
            "remaining":      calls,
            "price_gbp":      price_gbp,
            "purchased_at":   now,
            "expires_at":     now + timedelta(days=PENNY_TOPUP_LIFETIME_DAYS),
            "year_month":     ym,
            "source":         "admin",
            "settled_months": [],
        })
        return {"ok": True, "email": target_email, "calls": calls, "year_month": ym}

    pack_id = body.get("pack_id")
    if pack_id:
        try:
            doc = await grant_pack(target_email, "penny", pack_id, source="admin")
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return {"ok": True, "email": target_email, "messages": doc["messages"], "year_month": doc["year_month"]}

    try:
        messages = int(body.get("messages"))
    except (TypeError, ValueError):
        raise HTTPException(400, "messages must be an integer")
    if messages <= 0:
        raise HTTPException(400, "messages must be positive")
    price_gbp = 0.0

    from app.db.collections import penny_topups_col

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
