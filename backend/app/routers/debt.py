"""Debt insights and burndown endpoints."""
import copy
from collections import defaultdict as _dd
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import (
    accounts_col, transactions_col, yapily_transactions_col,
    account_rates_col, preferences_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
)
from app.services.region import get_user_region, get_kenya_transactions

router = APIRouter(tags=["debt"])

_DISCRETIONARY = ["Eating Out", "Entertainment", "Shopping", "Travel", "Subscriptions", "Software", "Other", "Health"]
_DISC_CATS     = {"Eating Out", "Entertainment", "Shopping", "Travel", "Subscriptions", "Software", "Other", "Health"}
_NON_DISC      = {"Transfer", "Savings", "Debt", "Income"}


@router.get("/debt/insights")
async def debt_insights(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    if region == "Kenya":
        all_txns    = await get_kenya_transactions(uid, cutoff)
        income_txns = [t for t in all_txns if t.get("transaction_type") == "credit" and
                       (t.get("custom_category") or t.get("category")) == "Income"]
        debit_txns  = [t for t in all_txns if t.get("transaction_type") == "debit"]
        monthly_income = sum(t["amount"] for t in income_txns) / 3
        cat_totals: dict[str, float] = {}
        for t in debit_txns:
            cat = t.get("custom_category") or t.get("category") or "Other"
            cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
        monthly_cat     = {k: round(v / 3, 2) for k, v in cat_totals.items()}
        monthly_essential = sum(v for k, v in monthly_cat.items() if k not in _NON_DISC)
        monthly_surplus   = monthly_income - monthly_essential
        recommendations   = []
        for cat in sorted(_DISCRETIONARY, key=lambda c: monthly_cat.get(c, 0), reverse=True):
            amt = monthly_cat.get(cat, 0)
            if amt > 5:
                recommendations.append({"category": cat, "monthly_spend": amt,
                                         "cut_25pct_saves": round(amt * 0.25, 2), "cut_50pct_saves": round(amt * 0.50, 2)})
        disc_cutoff = datetime.now() - timedelta(days=30)
        disc_txns   = [t for t in all_txns if
                       t.get("transaction_type") == "debit" and
                       t.get("date", datetime.min) >= disc_cutoff and
                       (t.get("custom_category") or t.get("category")) in _DISC_CATS]
        disc_txns.sort(key=lambda t: t.get("amount", 0), reverse=True)
        recent_discretionary = [
            {"id": str(t["_id"]), "description": t.get("merchant_name") or t.get("description", ""),
             "amount": t["amount"], "date": t["date"].isoformat(),
             "category": t.get("custom_category") or t.get("category") or "Other"}
            for t in disc_txns[:20]
        ]
        return {
            "total_debt": 0, "accounts": [],
            "monthly_income": round(monthly_income, 2), "monthly_spending": round(monthly_essential, 2),
            "monthly_surplus": round(monthly_surplus, 2), "monthly_debt_payment": 0,
            "payment_needed_12mo": 0, "gap_to_12mo": 0, "months_at_current_rate": 0,
            "category_spending": {k: v for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1])},
            "recommendations": recommendations, "recent_discretionary": recent_discretionary,
        }

    accounts    = await accounts_col.find({"user_id": uid}).to_list(None)
    cc_accounts = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
    total_debt  = sum(abs(a["balance"]) for a in cc_accounts)

    income_txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}
    ).to_list(None)
    yap_income  = await yapily_transactions_col.find(
        {"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}
    ).to_list(None)
    income_txns   = income_txns + yap_income
    monthly_income = sum(t["amount"] for t in income_txns) / 3

    debit_txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    yap_debits = await yapily_transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    debit_txns = debit_txns + yap_debits

    cat_totals2: dict[str, float] = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        cat_totals2[cat] = cat_totals2.get(cat, 0) + t["amount"]
    monthly_cat      = {k: round(v / 3, 2) for k, v in cat_totals2.items()}
    monthly_debt_payment = monthly_cat.get("Debt", 0)
    monthly_essential    = sum(v for k, v in monthly_cat.items() if k not in _NON_DISC)
    monthly_surplus      = monthly_income - monthly_essential

    account_rates: dict[str, float] = {}
    for a in cc_accounts:
        rate_doc = await account_rates_col.find_one({"user_id": uid, "account_id": str(a["_id"])})
        if rate_doc:
            account_rates[str(a["_id"])] = float(rate_doc["apr"])

    weighted_apr = (
        sum(abs(a["balance"]) * account_rates.get(str(a["_id"]), 0) for a in cc_accounts) / total_debt
        if total_debt > 0 else 0.0
    )
    monthly_rate = weighted_apr / 12 / 100

    prefs_doc        = await preferences_col.find_one({"user_id": uid}) or {}
    target_months_pref = int(prefs_doc.get("debt_target_months", 12))
    if monthly_rate > 0 and target_months_pref > 0:
        payment_for_target = round(total_debt * monthly_rate / (1 - (1 + monthly_rate) ** (-target_months_pref)), 2) if total_debt > 0 else 0
    else:
        payment_for_target = round(total_debt / target_months_pref, 2) if total_debt > 0 else 0

    gap = max(0, round(payment_for_target - monthly_surplus, 2))

    if monthly_surplus > 0 and total_debt > 0:
        if monthly_rate > 0:
            sim_bal = total_debt
            months_at_current = 0
            while sim_bal > 0.01 and months_at_current < 999:
                sim_bal = sim_bal * (1 + monthly_rate) - monthly_surplus
                months_at_current += 1
            months_at_current = round(float(months_at_current), 1)
        else:
            months_at_current = round(total_debt / monthly_surplus, 1)
    else:
        months_at_current = 999

    recommendations = []
    for cat in sorted(_DISCRETIONARY, key=lambda c: monthly_cat.get(c, 0), reverse=True):
        amt = monthly_cat.get(cat, 0)
        if amt > 5:
            recommendations.append({"category": cat, "monthly_spend": amt,
                                     "cut_25pct_saves": round(amt * 0.25, 2), "cut_50pct_saves": round(amt * 0.50, 2)})

    disc_cutoff = datetime.now() - timedelta(days=30)
    disc_txns   = await transactions_col.find({
        "user_id": uid, "transaction_type": "debit", "date": {"$gte": disc_cutoff},
        "$or": [{"custom_category": {"$in": list(_DISC_CATS)}},
                {"category": {"$in": list(_DISC_CATS)}, "custom_category": None}],
    }).sort("amount", -1).to_list(20)
    recent_discretionary = [
        {"id": str(t["_id"]), "description": t.get("merchant_name") or t.get("description", ""),
         "amount": t["amount"], "date": t["date"].isoformat(),
         "category": t.get("custom_category") or t.get("category") or "Other"}
        for t in disc_txns
    ]

    return {
        "total_debt": round(total_debt, 2),
        "accounts": [
            {"account_id": str(a["_id"]), "name": a["name"], "provider": a.get("provider", ""),
             "balance": round(a["balance"], 2), "apr": account_rates.get(str(a["_id"])),
             "monthly_interest": round(abs(a["balance"]) * account_rates.get(str(a["_id"]), 0) / 12 / 100, 2)}
            for a in cc_accounts
        ],
        "monthly_income": round(monthly_income, 2), "monthly_spending": round(monthly_essential, 2),
        "monthly_surplus": round(monthly_surplus, 2), "monthly_debt_payment": round(monthly_debt_payment, 2),
        "payment_needed_12mo": payment_for_target, "gap_to_12mo": gap,
        "months_at_current_rate": months_at_current, "weighted_apr": round(weighted_apr, 4),
        "category_spending": {k: v for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1])},
        "recommendations": recommendations, "recent_discretionary": recent_discretionary,
    }


@router.get("/debt/burndown")
async def debt_burndown(
    user: dict = Depends(current_user),
    target_months: Optional[int] = None,
    strategy: str = "avalanche",
    start_date: Optional[str] = None,
):
    uid   = user["email"]
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    if target_months is None:
        target_months = int(prefs.get("debt_target_months", 12))
    region = prefs.get("region", "UK")
    sym    = "KES" if region == "Kenya" else "GBP"

    accounts    = await accounts_col.find({"user_id": uid}).to_list(None)
    cc_accounts = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
    cc_ids      = [a["_id"] for a in cc_accounts]

    apr_map: dict[str, float] = {}
    for a in cc_accounts:
        rate_doc = await account_rates_col.find_one({"user_id": uid, "account_id": str(a["_id"])})
        if rate_doc:
            apr_map[str(a["_id"])] = float(rate_doc["apr"])

    sim_cards = [
        {"id": str(a["_id"]), "balance": abs(a["balance"]),
         "monthly_rate": apr_map.get(str(a["_id"]), 0) / 12 / 100}
        for a in cc_accounts
    ]
    current_debt = sum(c["balance"] for c in sim_cards)

    today  = datetime.now()
    cur_mk = today.strftime("%Y-%m")
    if start_date is None:
        start_date = prefs.get("debt_tracking_start", cur_mk)

    if current_debt == 0 or not cc_ids:
        return {
            "burndown": [], "current_debt": 0, "target_months": target_months,
            "target_date": (today.replace(day=1) + timedelta(days=32 * target_months)).strftime("%Y-%m"),
            "monthly_payment_needed": 0, "currency": sym,
            "total_interest_target": 0, "total_interest_projected": 0,
            "weighted_apr": 0, "strategy": strategy, "has_rates": False,
            "start_date": start_date,
        }

    weighted_apr      = sum(c["balance"] * c["monthly_rate"] * 12 * 100 for c in sim_cards) / current_debt if current_debt > 0 else 0
    avg_monthly_rate  = weighted_apr / 12 / 100
    has_rates         = any(c["monthly_rate"] > 0 for c in sim_cards)

    all_cc_txns  = await transactions_col.find(
        {"account_id": {"$in": cc_ids}, "user_id": uid},
        {"amount": 1, "transaction_type": 1, "date": 1},
    ).to_list(None)
    yap_cc_txns  = await yapily_transactions_col.find(
        {"account_id": {"$in": cc_ids}, "user_id": uid},
        {"amount": 1, "transaction_type": 1, "date": 1},
    ).to_list(None)
    all_cc_txns += yap_cc_txns

    monthly_net: dict = _dd(float)
    for t in all_cc_txns:
        d = t.get("date")
        if not isinstance(d, datetime):
            continue
        mk = d.strftime("%Y-%m")
        if t["transaction_type"] == "debit":
            monthly_net[mk] += t["amount"]
        else:
            monthly_net[mk] -= t["amount"]

    full_history: dict[str, float] = {cur_mk: current_debt}
    running = current_debt
    for mk in sorted(monthly_net.keys(), reverse=True):
        running -= monthly_net[mk]
        year, mon   = map(int, mk.split("-"))
        prev_mon    = mon - 1 if mon > 1 else 12
        prev_year   = year if mon > 1 else year - 1
        full_history[f"{prev_year}-{prev_mon:02d}"] = max(0.0, running)

    if len(full_history) >= 2:
        sorted_full         = sorted(full_history.items())
        oldest_debt         = sorted_full[0][1]
        num_hist_months     = len(sorted_full) - 1
        avg_monthly_reduction = (oldest_debt - current_debt) / num_hist_months if num_hist_months > 0 else 0
    else:
        avg_monthly_reduction = 0

    history = {mk: v for mk, v in full_history.items() if mk >= start_date}
    if not history:
        history = {cur_mk: current_debt}

    if avg_monthly_rate > 0 and target_months > 0:
        monthly_target_payment = current_debt * avg_monthly_rate / (1 - (1 + avg_monthly_rate) ** (-target_months))
    else:
        monthly_target_payment = current_debt / target_months if target_months > 0 else current_debt

    def simulate(cards: list[dict], monthly_payment: float, max_months: int) -> tuple[list[float], float]:
        cards_s      = copy.deepcopy(cards)
        balances: list[float] = []
        total_interest = 0.0
        for _ in range(max_months):
            for c in cards_s:
                interest = c["balance"] * c["monthly_rate"]
                c["balance"] += interest
                total_interest += interest
            order = sorted(cards_s, key=lambda x: x["balance"]) if strategy == "snowball" else sorted(cards_s, key=lambda x: x["monthly_rate"], reverse=True)
            remaining = monthly_payment
            for c in order:
                pay = min(c["balance"], remaining)
                c["balance"] = round(c["balance"] - pay, 4)
                remaining -= pay
                if remaining <= 0:
                    break
            total = sum(c["balance"] for c in cards_s)
            balances.append(round(total, 2))
            if total < 0.01:
                break
        return balances, round(total_interest, 2)

    target_balances: list[float] = []
    total_interest_target = 0.0
    _bal = current_debt
    for _ in range(target_months):
        _interest = _bal * avg_monthly_rate
        total_interest_target += _interest
        _bal = max(0.0, _bal + _interest - monthly_target_payment)
        target_balances.append(round(_bal, 2))
        if _bal < 0.01:
            break
    total_interest_target = round(total_interest_target, 2)

    implied_payment = avg_monthly_reduction + avg_monthly_rate * current_debt
    if implied_payment >= 0:
        proj_balances, total_interest_projected = simulate(sim_cards, implied_payment, target_months)
    else:
        proj_balances = []
        total_interest_projected = 0.0
        _p = current_debt
        for _ in range(target_months):
            interest = _p * avg_monthly_rate
            total_interest_projected += interest
            _p = _p * (1 + avg_monthly_rate) - avg_monthly_reduction
            proj_balances.append(round(_p, 2))
        total_interest_projected = round(total_interest_projected, 2)

    points: list[dict] = []
    for mk, debt_val in sorted(history.items()):
        year, mon   = map(int, mk.split("-"))
        months_back = (today.year - year) * 12 + (today.month - mon)
        if months_back > 0 and avg_monthly_rate > 0:
            past_target = round(current_debt + months_back * monthly_target_payment / (1 + avg_monthly_rate) ** months_back, 2)
        elif months_back > 0:
            past_target = round(current_debt + months_back * monthly_target_payment, 2)
        else:
            past_target = round(current_debt, 2)
        proj_anchor = round(current_debt, 2) if months_back == 0 else None
        points.append({"month": mk, "actual": round(debt_val, 2), "target": max(0.0, past_target), "projected": proj_anchor})

    for i in range(1, target_months + 1):
        future_dt  = today.replace(day=1) + timedelta(days=32 * i)
        mk         = future_dt.strftime("%Y-%m")
        target_val = target_balances[i - 1] if i - 1 < len(target_balances) else 0.0
        proj_val   = proj_balances[i - 1]   if i - 1 < len(proj_balances)   else 0.0
        points.append({"month": mk, "actual": None,
                        "target": round(max(0.0, target_val), 2),
                        "projected": round(max(0.0, proj_val), 2)})

    target_date = (today.replace(day=1) + timedelta(days=32 * target_months)).strftime("%Y-%m")

    return {
        "burndown": points, "current_debt": round(current_debt, 2),
        "target_months": target_months, "target_date": target_date,
        "monthly_payment_needed": round(monthly_target_payment, 2), "currency": sym,
        "total_interest_target": total_interest_target,
        "total_interest_projected": total_interest_projected,
        "weighted_apr": round(weighted_apr, 2), "strategy": strategy,
        "has_rates": has_rates, "start_date": start_date,
    }
