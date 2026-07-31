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
async def get_today(user: dict = Depends(current_user)):
    uid = user["email"]
    # Short-TTL response cache (90 s; invalidated on dismiss and after sync)
    cached = response_cache.get("today", uid)
    if cached is not None:
        return cached
    items = await compute_today_items(uid)
    payload = {"status": "ok", "items": items}
    response_cache.put("today", uid, payload)
    return payload


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
