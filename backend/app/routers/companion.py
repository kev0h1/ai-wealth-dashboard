"""Companion spine — today-engine router."""
from datetime import date, timedelta
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services import response_cache
from app.services.companion import compute_today_items, dismiss_item
from app.db.collections import needle_history_col, preferences_col
from app.services.pay_period import get_pay_period_for_date
from app.services.needle import (
    _credit_card_account_ids,
    _current_account_ids,
    _txns_for_period,
    _card_delta,
)

router = APIRouter(tags=["companion"])


@router.get("/today")
async def get_today(payday_preview: int = 0, user: dict = Depends(current_user)):
    uid = user["email"]
    preview = bool(payday_preview)
    # Mongo-backed response cache (6h safety bound; exact invalidation via
    # the per-user data version — see app/services/response_cache.py).
    # Invalidated on dismiss and after sync. Preview requests never read
    # from or write to it — they're a one-off design/QA look at the Payday
    # Plan card, not the live today-state.
    v = None
    if not preview:
        cached = await response_cache.aget("today", uid)
        if cached is not None:
            return cached
        v = await response_cache.snapshot(uid)
    items = await compute_today_items(uid, payday_preview=preview)
    payload = {"status": "ok", "items": items}
    if not preview:
        await response_cache.aput("today", uid, payload, version=v)
    return payload


@router.get("/today/cover-plan")
async def get_cover_plan(user: dict = Depends(current_user)):
    """Return the current cover-plan cards without advancing Home state.

    Settings uses this after a source exclusion changes. The companion
    engine's read-only mode preserves the exact source finder and returned
    route while preventing item lifecycle updates and one-time celebration
    stamps from being consumed outside Home.

    `account_eligibility` (G50, 2026-09-12): `{account_id: {"short": bool,
    "headroom": float}}` for every account the source finder could ever
    consider, straight from `compute_today_items`'s own headroom
    computation (`_account_headroom`) — not reconstructed from whatever
    move cards happen to be active this request. Settings uses this to
    show the Skipped state for an account that has no spare headroom even
    when no live move card names it. Read-only: the out-param is filled
    in memory only, nothing is written.
    """
    uid = user["email"]
    account_eligibility: dict = {}
    items = await compute_today_items(
        uid=uid, persist=False, account_eligibility_out=account_eligibility,
    )
    return {
        "status": "ok",
        "items": [item for item in items if item.get("type") == "move"],
        "account_eligibility": account_eligibility,
    }


@router.post("/today/dismiss")
async def dismiss_today_item(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        from fastapi import HTTPException
        raise HTTPException(400, "item_id required")
    await dismiss_item(uid, item_id)
    response_cache.invalidate(uid, "today")
    return {"ok": True}


@router.get("/needle/summary")
async def needle_summary(user: dict = Depends(current_user)):
    uid = user["email"]

    # 1. Most recent closed needle doc
    last_closed_list = await needle_history_col.find(
        {"uid": uid}
    ).sort("period_end", -1).limit(1).to_list(1)
    last_closed = last_closed_list[0] if last_closed_list else None

    # 2. Current open pay period
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today = date.today()
    start, end = get_pay_period_for_date(today, pay_cfg)

    # 3. Card delta so far this period
    cc_ids = await _credit_card_account_ids(uid)
    cc_txns = await _txns_for_period(uid, start, today, cc_ids) if cc_ids else []
    delta = _card_delta(cc_txns)

    # 4. Cash now — live balances across current accounts
    current_accs = await _current_account_ids(uid)
    cash_now = sum(
        float(a.get("balance") or a.get("current_balance") or a.get("available_balance") or 0)
        for a in current_accs
    )

    # 5. Days to payday
    days_to_payday = ((end + timedelta(days=1)) - today).days
    days_into_period = (today - start).days + 1

    return {
        "status": "ok",
        "last_closed": last_closed,
        "current": {
            "card_delta_so_far": round(delta, 2),
            "cash_now": round(cash_now, 2),
            "days_to_payday": days_to_payday,
            "days_into_period": days_into_period,
        },
    }
