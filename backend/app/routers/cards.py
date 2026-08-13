"""Cards story endpoint — pure reading surface.

Returns a descriptive snapshot of what happened with credit cards this pay
cycle: movement totals, per-card breakdown, spending drivers, a behavioural
pattern line from the portrait, and a trajectory of recent periods.

Descriptive only, no advice, no judgement, no LLM calls (BEHAVIOURS.md).
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import current_user
from app.db.collections import (
    accounts_col,
    preferences_col,
    needle_history_col,
    behaviour_portrait_col,
    account_rates_col,
)
from app.services.pay_period import get_pay_period_for_date, prev_pay_period
from app.services.needle import (
    _credit_card_account_ids,
    _txns_for_period,
    _abs_amounts,
)

router = APIRouter(tags=["cards"])

# Categories dropped from the per-card "spending drivers" breakdown.
#
# NOT migrated to `app.services.categories.is_non_spend`, and the difference is
# a real one rather than a stylistic one: this set omits Savings, Investment and
# Income, all of which the shared helper treats as non-spend. A card debit
# categorised Savings or Investment therefore still shows up here as card
# spending. That is very likely wrong, but correcting it moves published
# per-card totals, so it is held back as a separate, owner-approved change.
# See the migration report for the measured size of the discrepancy.
_EXCLUDE_CATEGORIES = {"Transfer", "Debt"}


@router.get("/cards/story")
async def cards_story(
    user: dict = Depends(current_user),
    which: str = Query("current"),
):
    if which not in ("current", "last"):
        raise HTTPException(status_code=400, detail="which must be 'current' or 'last'")

    uid = user["email"]
    today = date.today()

    # ── Pay period ────────────────────────────────────────────────────────────
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    start, end = get_pay_period_for_date(today, pay_cfg)
    if which == "last":
        start, end = prev_pay_period(start, pay_cfg)
    days_elapsed = (min(today, end) - start).days + 1

    # ── Credit-card account ids ───────────────────────────────────────────────
    cc_ids = await _credit_card_account_ids(uid)

    # ── Period transactions ───────────────────────────────────────────────────
    txns = await _txns_for_period(uid, start, min(end, today), cc_ids) if cc_ids else []
    new_spend, payments = _abs_amounts(txns)
    delta = new_spend - payments

    # ── Per-card breakdown ────────────────────────────────────────────────────
    # Fetch account docs for credit cards
    cc_account_docs = []
    if cc_ids:
        raw_accounts = await accounts_col.find({"user_id": uid}).to_list(None)
        for a in raw_accounts:
            aid = str(a.get("account_id") or a.get("_id"))
            if aid in cc_ids:
                cc_account_docs.append(a)

    # Build per-card txn buckets
    card_txns: dict[str, list] = {}
    for t in txns:
        aid = str(t.get("account_id", ""))
        card_txns.setdefault(aid, []).append(t)

    # APR map
    rates = await account_rates_col.find({"user_id": uid}).to_list(None)
    apr_map = {r["account_id"]: r.get("apr") for r in rates}

    per_card = []
    for a in cc_account_docs:
        aid = str(a.get("account_id") or a.get("_id"))
        balance = float(
            a.get("balance") or a.get("current_balance") or a.get("available_balance") or 0
        )
        card_debits, card_credits = _abs_amounts(card_txns.get(aid, []))
        card_delta = card_debits - card_credits
        if abs(card_delta) < 1 and balance == 0:
            continue
        per_card.append({
            "account_id": aid,
            "name": a.get("name"),
            "provider": a.get("provider"),
            "balance": round(balance, 2),
            "delta": round(card_delta, 2),
            "apr": apr_map.get(aid),
        })

    per_card.sort(key=lambda c: abs(c["delta"]), reverse=True)

    # ── Spending drivers ──────────────────────────────────────────────────────
    category_totals: dict[str, float] = {}
    for t in txns:
        if t.get("transaction_type") != "debit":
            continue
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat in _EXCLUDE_CATEGORIES:
            continue
        category_totals[cat] = category_totals.get(cat, 0.0) + float(t.get("amount", 0) or 0)

    drivers = sorted(
        [{"category": cat, "total": round(total, 2)} for cat, total in category_totals.items()],
        key=lambda x: x["total"],
        reverse=True,
    )[:5]

    # ── Pattern line (credit_switch trait) ────────────────────────────────────
    pattern_line = None
    try:
        portrait = await behaviour_portrait_col.find_one({"_id": uid})
        if portrait:
            for trait in portrait.get("traits", []):
                if trait.get("id") == "credit_switch":
                    pattern_line = trait.get("narrative")
                    break
    except Exception:
        pass

    # ── Trajectory ────────────────────────────────────────────────────────────
    raw_history = (
        await needle_history_col.find({"uid": uid})
        .sort("period_end", -1)
        .limit(6)
        .to_list(6)
    )
    raw_history.reverse()  # oldest-first
    trajectory = [
        {"period_end": h.get("period_end"), "delta": round(float(h.get("card_delta", 0)), 2)}
        for h in raw_history
    ]

    return {
        "status": "ok",
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "days_elapsed": days_elapsed,
        },
        "movement": {
            "delta": round(delta, 2),
            "new_spend": round(new_spend, 2),
            "payments": round(payments, 2),
        },
        "per_card": per_card,
        "drivers": drivers,
        "pattern_line": pattern_line,
        "trajectory": trajectory,
    }
