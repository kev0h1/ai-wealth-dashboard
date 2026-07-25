"""KPI, insights, and budget pace-profile endpoints."""
import asyncio
import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from datetime import date as _date
from typing import List

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.models import KPIResponse, Insight
from app.db.collections import (
    accounts_col, transactions_col, yapily_accounts_col, yapily_transactions_col,
    statement_accounts_col, investment_accounts_col, mono_accounts_col, mpesa_accounts_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
    preferences_col, savings_insights_col, cashflow_cache_col, upcoming_overrides_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.pay_period import get_pay_period_for_date, prev_pay_period

# Cache AI recurring predictions per user (in-process, cleared on restart)
_ai_recurring_cache: dict[str, tuple[datetime, list]] = {}

# Friendly display labels for upstream bank provider codes (uppercase keys).
# Any code not in the map is title-cased by default (e.g. "MONZO" → "Monzo").
_BANK_LABELS: dict[str, str] = {
    "HSBC": "HSBC",
    "TSB": "TSB",
    "RBS": "RBS",
    "AIB": "AIB",
    "NATWEST": "NatWest",
    "M&S": "M&S",
}


def _bank_label(provider: str | None) -> str | None:
    """Return a display-friendly bank name from a raw provider code."""
    if not provider:
        return None
    return _BANK_LABELS.get(provider.upper(), provider.title())

router = APIRouter(tags=["analytics"])

# Only transfers are excluded from the burn — money moved between own accounts
# isn't real outflow. Everything else (incl. savings/debt) counts toward runway.
SKIP_BURN_CATS = {"Transfer"}


def _avg_monthly_burn(debits: list, fallback: float = 1000.0) -> float:
    """Average monthly spend from debit transactions.

    Excludes only transfers (not real cost of living), and divides by the actual
    months of data present (clamped to 1–3) rather than a hard-coded 3, so a
    partial history isn't divided down and runway over-stated.
    """
    spend = [
        d for d in debits
        if (d.get("custom_category") or d.get("category") or "Other") not in SKIP_BURN_CATS
    ]
    if not spend:
        return fallback
    total = sum(d["amount"] for d in spend)
    earliest = min(d["date"] for d in spend)
    days = max((datetime.now() - earliest).days, 1)
    months = min(max(days / 30.0, 1.0), 3.0)
    return total / months


@router.get("/kpis", response_model=KPIResponse)
async def get_kpis(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    if region == "Kenya":
        mono_accs  = await mono_accounts_col.find({"user_id": uid}).to_list(None)
        mpesa_accs = await mpesa_accounts_col.find({"user_id": uid}).to_list(None)
        stmt_accs  = await statement_accounts_col.find({"user_id": uid}).to_list(None)
        all_accs   = mono_accs + mpesa_accs + stmt_accs
        if not all_accs:
            return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=datetime.now())
        net_worth = sum(a.get("balance", 0) for a in all_accs)
        cash      = net_worth
        debits    = await get_kenya_transactions(uid, cutoff)
        debits    = [d for d in debits if d.get("transaction_type") == "debit"]
        avg_spend = _avg_monthly_burn(debits)
        runway    = cash / avg_spend if avg_spend else 0
        return KPIResponse(
            net_worth=net_worth, cash=cash, runway=round(runway, 1),
            investments=0, pensions=0, last_updated=datetime.now(),
        )

    accounts      = await accounts_col.find({"user_id": uid}).to_list(None)
    yapily_accs   = await yapily_accounts_col.find({"user_id": uid}).to_list(None)
    stmt_accs_all = await statement_accounts_col.find({"user_id": uid}).to_list(None)
    # GBP net worth only — a KES statement upload must not be summed as £
    stmt_accs     = [a for a in stmt_accs_all if str(a.get("currency", "GBP")).upper() == "GBP"]
    inv_accs      = await investment_accounts_col.find({"user_id": uid}).to_list(None)
    investment_total = sum(a.get("total_value", 0) for a in inv_accs)

    if not accounts and not yapily_accs and not stmt_accs and not inv_accs:
        return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=datetime.now())

    net_worth = (
        sum(a["balance"] for a in accounts)
        + sum(a.get("balance", 0) for a in yapily_accs)
        + sum(a.get("balance", 0) for a in stmt_accs)
        + investment_total
    )
    cash = (
        sum(a["balance"] for a in accounts if a["type"] == "bank")
        + sum(a.get("balance", 0) for a in yapily_accs if a.get("type") == "bank")
        + sum(a.get("balance", 0) for a in stmt_accs if a.get("type") == "bank")
    )
    yapily_txn_debits = await yapily_transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    debits    = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}
    ).to_list(None)
    all_debits = debits + yapily_txn_debits
    avg_spend  = _avg_monthly_burn(all_debits)
    runway     = cash / avg_spend if avg_spend else 0

    return KPIResponse(
        net_worth=net_worth, cash=cash, runway=round(runway, 1),
        investments=investment_total, pensions=0, last_updated=datetime.now(),
    )


@router.get("/insights", response_model=List[Insight])
async def get_insights(user: dict = Depends(current_user)):
    return await compute_insights(user["email"])


async def compute_insights(uid: str) -> List[Insight]:
    insights = []
    accounts = await accounts_col.find({"user_id": uid}).to_list(None)

    for acc in accounts:
        if acc["balance"] > 5000:
            insights.append(Insight(
                id=f"idle-{acc['_id']}", title=f"Sweep idle cash from {acc['name']}",
                impact=int(acc["balance"] * 0.045), confidence=100,
                rationale=f"£{acc['balance']:,.0f} sitting idle. Move to 5% AER savings → +£{int(acc['balance']*0.045)}/yr.",
                action="Transfer to savings", category="savings",
            ))

    cutoff    = datetime.now() - timedelta(days=90)
    txns      = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
    by_merchant: dict[str, list] = defaultdict(list)
    for t in txns:
        if t.get("merchant_name"):
            by_merchant[t["merchant_name"]].append(t)

    for merchant, ts in by_merchant.items():
        if len(ts) >= 2:
            sorted_ts  = sorted(ts, key=lambda x: x["date"])
            avg_amount = sum(t["amount"] for t in sorted_ts) / len(sorted_ts)
            last_days  = (datetime.now() - sorted_ts[-1]["date"]).days
            if last_days > 60:
                insights.append(Insight(
                    id=f"sub-{merchant.lower().replace(' ', '-')}",
                    title=f"Review {merchant} subscription",
                    impact=int(avg_amount * 12), confidence=85,
                    rationale=f"£{avg_amount:.2f}/mo to {merchant}. Last charge {last_days}d ago — possibly unused.",
                    action="Review subscription", category="spending",
                ))

    insights.sort(key=lambda x: x.impact, reverse=True)
    return insights[:10]


@router.get("/budget/pace-profile")
async def budget_pace_profile(user: dict = Depends(current_user)):
    uid        = user["email"]
    prefs      = await preferences_col.find_one({"user_id": uid}) or {}
    pay_config = prefs.get("pay_period_config", {"type": "calendar_month"})
    region     = prefs.get("region", "UK")

    today         = _date.today()
    SKIP          = {"Transfer", "Savings", "Debt", "Income"}
    SAMPLE_POINTS = 20
    MIN_PERIODS   = 2

    cur_start, _ = get_pay_period_for_date(today, pay_config)

    periods: list[tuple[_date, _date]] = []
    ps, pe = cur_start, _date.today()
    for _ in range(6):
        ps, pe = prev_pay_period(ps, pay_config)
        periods.append((ps, pe))
        if ps < _date(2024, 1, 1):
            break

    if not periods:
        return {"curves": {}, "sample_points": SAMPLE_POINTS, "periods_analysed": 0}

    earliest_dt = datetime(min(p[0] for p in periods).year, min(p[0] for p in periods).month, min(p[0] for p in periods).day)
    cutoff_dt   = datetime(cur_start.year, cur_start.month, cur_start.day)
    proj        = {"date": 1, "amount": 1, "category": 1, "custom_category": 1, "planned": 1, "transaction_type": 1}
    base_q      = {"user_id": uid, "transaction_type": "debit", "date": {"$gte": earliest_dt, "$lt": cutoff_dt}}

    raw: list[dict] = []
    if region == "Kenya":
        for col in [mono_transactions_col, mpesa_transactions_col, statement_transactions_col]:
            raw.extend(await col.find(base_q, proj).to_list(None))
    else:
        raw.extend(await transactions_col.find(base_q, proj).to_list(None))
        raw.extend(await yapily_transactions_col.find(base_q, proj).to_list(None))

    cat_data: dict[str, list[list[tuple[float, float]]]] = defaultdict(
        lambda: [[] for _ in range(len(periods))]
    )

    for tx in raw:
        if tx.get("planned"):
            continue
        cat    = tx.get("custom_category") or tx.get("category") or "Other"
        if cat in SKIP:
            continue
        amount = abs(float(tx.get("amount", 0) or 0))
        if amount <= 0:
            continue
        try:
            d       = tx["date"]
            tx_date = d.date() if isinstance(d, datetime) else _date.fromisoformat(str(d)[:10])
        except Exception:
            continue
        for i, (ps, pe) in enumerate(periods):
            if ps <= tx_date <= pe:
                span = max(1, (pe - ps).days)
                frac = (tx_date - ps).days / span
                cat_data[cat][i].append((frac, amount))
                break

    sample_fracs = [i / SAMPLE_POINTS for i in range(SAMPLE_POINTS + 1)]
    curves: dict[str, list[float]] = {}

    for cat, period_lists in cat_data.items():
        per_period_curves: list[list[float]] = []
        for period_txns in period_lists:
            if not period_txns:
                continue
            total = sum(a for _, a in period_txns)
            if total <= 0:
                continue
            per_period_curves.append([
                sum(a for f, a in period_txns if f <= sf) / total
                for sf in sample_fracs
            ])
        if len(per_period_curves) < MIN_PERIODS:
            continue
        n = len(per_period_curves)
        curves[cat] = [
            sum(pc[i] for pc in per_period_curves) / n
            for i in range(len(sample_fracs))
        ]

    return {"curves": curves, "sample_points": SAMPLE_POINTS, "periods_analysed": len(periods)}


async def _ai_recurring_predict(candidates: list[dict], user_id: str) -> list[dict]:
    """Ask Claude to identify which single-occurrence debits are likely monthly recurring bills.

    Returns list of {key, avg_amount, next_date} for any it recognises as periodic.
    Results are cached 24h per user to avoid repeated API calls.
    """
    cached = _ai_recurring_cache.get(user_id)
    if cached and (datetime.now() - cached[0]).seconds < 86400:
        return cached[1]

    if not OPENROUTER_API_KEY or not candidates:
        return []

    # Build a compact payload: just description + amount + last seen date
    items = [
        {"key": c["key"], "amount": round(c["avg_amount"], 2), "last_seen": c["last_date"].strftime("%Y-%m-%d")}
        for c in candidates[:30]  # cap at 30 to keep prompt small
    ]

    prompt = (
        "You are a UK personal finance assistant. The following are debit transactions from a user's bank account "
        "that have only appeared once in the last 90 days. Identify which are likely to be recurring monthly bills "
        "and estimate when the next payment is due based on the last_seen date (assume monthly = 28–31 days later).\n"
        "Only classic fixed billers qualify: utilities, telecoms, insurance, subscriptions, rent/mortgage, "
        "loan payments, gym memberships. NEVER travel, transport, parking, restaurants, retail, entertainment "
        "or anything that looks like a one-off purchase — when unsure, leave it out.\n\n"
        f"Transactions:\n{json.dumps(items, indent=2)}\n\n"
        "Reply ONLY with a JSON array of objects for those you're confident are recurring monthly. "
        'Each object: {"key": "...", "next_expected_date": "YYYY-MM-DD"}. '
        "Omit one-off purchases, ATM withdrawals, and anything ambiguous. Return [] if none qualify."
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 400,
                      "messages": [{"role": "user", "content": prompt}]},
            )
        if r.status_code != 200:
            return []
        content = r.json()["choices"][0]["message"]["content"].strip()
        # Extract JSON array from response
        m = re.search(r"\[.*\]", content, re.DOTALL)
        if not m:
            return []
        predictions = json.loads(m.group(0))
    except Exception:
        return []

    # Build result list merging AI predictions with candidate data
    cand_map = {c["key"]: c for c in candidates}
    result = []
    for pred in predictions:
        key = pred.get("key", "")
        if key not in cand_map:
            continue
        try:
            next_date = datetime.fromisoformat(pred["next_expected_date"])
        except Exception:
            continue
        c = cand_map[key]
        result.append({
            "key":          key,
            "avg_interval": 30.0,
            "avg_amount":   c["avg_amount"],
            "last_date":    c["last_date"],
            "next_date":    next_date,
            "occurrences":  1,
            "ai_predicted": True,
            "category":     c.get("category"),
        })

    _ai_recurring_cache[user_id] = (datetime.now(), result)
    return result


DEFAULT_RECURRING_CATEGORIES = ["Bills", "Savings", "Subscriptions", "Health", "Software", "Debt"]


def _detect_recurring(txns: list, min_occurrences: int = 2, trusted_categories: set | None = None, today: _date | None = None, is_income: bool = False, pay_period_config: dict | None = None) -> list[dict]:
    """Group transactions by merchant key and detect those with a regular interval (7–35 days)."""
    buckets: dict[str, list] = defaultdict(list)
    for t in txns:
        key = (t.get("merchant_name") or t.get("description", "")[:35]).strip()
        if not key:
            continue
        buckets[key].append(t)

    results = []
    for key, items in buckets.items():
        if len(items) < min_occurrences:
            continue
        dates = sorted(t["date"] for t in items)
        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        avg_interval = sum(intervals) / len(intervals)
        if avg_interval < 6 or avg_interval > 35:
            continue

        # Majority category for the bucket — carried through so the UI can
        # show the real category icon instead of a generic dot.
        cats = [(t.get("custom_category") or t.get("category") or "Other") for t in items]
        bucket_cat = max(set(cats), key=cats.count)

        # Two-tier evidence: bill-like categories are trusted at 2 occurrences;
        # everything else must prove a cadence — 3+ hits, regular intervals,
        # stable amounts. (trusted_categories=None disables tiers, e.g. income.)
        if trusted_categories is not None:
            if bucket_cat not in trusted_categories:
                if len(items) < 3:
                    continue
                tolerance = max(3.0, avg_interval * 0.2)
                if any(abs(iv - avg_interval) > tolerance for iv in intervals):
                    continue
                amounts = sorted(abs(float(t.get("amount", 0))) for t in items)
                median = amounts[len(amounts) // 2]
                if median <= 0 or any(abs(a - median) > median * 0.3 for a in amounts):
                    continue

        avg_amount = sum(abs(float(t.get("amount", 0))) for t in items) / len(items)
        # Normalise to date objects — MongoDB stores dates as datetime, which
        # breaks comparisons against _today (a date) and .replace() calls below.
        _d2date = lambda d: d.date() if isinstance(d, datetime) else d
        last_date  = _d2date(dates[-1])
        _today = today or _date.today()
        _config = pay_period_config or {"type": "calendar_month"}

        if 6 <= avg_interval <= 10:
            # Weekly — anchor to the modal weekday of the occurrence dates
            weekdays = [d.weekday() for d in dates]
            modal_wd = max(set(weekdays), key=weekdays.count)
            delta = (modal_wd - _today.weekday()) % 7
            delta = delta or 7  # never 0: always strictly after today
            next_date = _today + timedelta(days=delta)
        elif 11 <= avg_interval <= 18:
            # Biweekly — anchor to the modal weekday but keep 14-day cadence
            weekdays = [d.weekday() for d in dates]
            modal_wd = max(set(weekdays), key=weekdays.count)
            # Find next occurrence of modal_wd strictly after today
            delta = (modal_wd - _today.weekday()) % 7
            delta = delta or 7
            candidate = _today + timedelta(days=delta)
            # Align to 14-day cadence from last known date
            since_last = (candidate - last_date).days
            # Round to nearest 14-day multiple from last_date
            periods = round(since_last / 14)
            next_date = last_date + timedelta(days=max(14, periods * 14))
            # Ensure it's strictly after today
            while next_date <= _today:
                next_date += timedelta(days=14)
        elif 26 <= avg_interval <= 33:
            # Monthly — anchor to day-of-month (existing logic)
            if is_income and _config.get("type", "calendar_month") != "calendar_month":
                # Income with a determinate payday: use pay period config
                from app.services.pay_period import _next_payday
                next_date = _next_payday(_today, _config)
            else:
                year  = last_date.year + (1 if last_date.month == 12 else 0)
                month = 1 if last_date.month == 12 else last_date.month + 1
                day   = min(last_date.day, monthrange(year, month)[1])
                next_date = last_date.replace(year=year, month=month, day=day)
                # If still in the past or today, advance one more month
                while next_date <= _today:
                    year  = next_date.year + (1 if next_date.month == 12 else 0)
                    month = 1 if next_date.month == 12 else next_date.month + 1
                    day   = min(next_date.day, monthrange(year, month)[1])
                    next_date = next_date.replace(year=year, month=month, day=day)
        else:
            next_date = last_date + timedelta(days=round(avg_interval))
            while next_date <= _today:
                next_date += timedelta(days=round(avg_interval))
        # Use account_id from the most recent transaction — bills reliably come from the same account
        most_recent = max(items, key=lambda t: t["date"])
        results.append({
            "key":          key,
            "avg_interval": round(avg_interval, 1),
            "avg_amount":   round(avg_amount, 2),
            "last_date":    last_date,
            "next_date":    next_date,
            "occurrences":  len(items),
            "account_id":   str(most_recent.get("account_id", "")) or None,
            "category":     bucket_cat,
        })
    return results


async def _compute_cashflow_patterns(uid: str) -> dict:
    """
    Full cashflow computation — scans 90 days of transactions, runs AI prediction,
    returns the recurring patterns and account snapshot needed to serve the cashflow view.
    Stored in cashflow_cache_col after every sync; never called on page load.
    """
    cutoff = datetime.now() - timedelta(days=90)

    proj = {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
            "transaction_type": 1, "category": 1, "custom_category": 1, "account_id": 1}
    raw: list[dict] = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}}, proj
    ).to_list(None)
    raw += await yapily_transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}}, proj
    ).to_list(None)

    acct_docs = (
        await accounts_col.find({"user_id": uid}, {"name": 1, "balance": 1, "currency": 1, "provider": 1}).to_list(None)
        + await yapily_accounts_col.find({"user_id": uid}, {"name": 1, "balance": 1, "currency": 1, "provider": 1}).to_list(None)
    )
    account_map: dict[str, dict] = {
        str(a["_id"]): {
            "name": a.get("name", "Account"),
            "balance": round(float(a.get("balance", 0)), 2),
            "provider": a.get("provider"),
        }
        for a in acct_docs
        if str(a.get("currency", "GBP")).upper() in {"GBP", ""}
    }

    debits  = [t for t in raw if t.get("transaction_type") == "debit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    credits = [t for t in raw if t.get("transaction_type") == "credit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    trusted   = set(prefs.get("recurring_categories") or DEFAULT_RECURRING_CATEGORIES)
    dismissed = set(prefs.get("dismissed_recurring") or [])
    pay_period_config = prefs.get("pay_period_config") or {"type": "calendar_month"}
    _today = _date.today()

    recurring_spend  = _detect_recurring(debits, trusted_categories=trusted, today=_today, is_income=False, pay_period_config=pay_period_config)
    recurring_spend  = [r for r in recurring_spend if r["key"] not in dismissed]
    recurring_income = _detect_recurring(credits, today=_today, is_income=True, pay_period_config=pay_period_config)
    recurring_income = [r for r in recurring_income if r["key"] not in dismissed]

    heuristic_keys = {r["key"] for r in recurring_spend}
    single_debits: dict[str, dict] = {}
    for t in debits:
        # First-occurrence AI guessing is only allowed in trusted categories —
        # a one-off restaurant or car park should never reach the model
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat not in trusted:
            continue
        key = (t.get("merchant_name") or t.get("description", "")[:35]).strip()
        if not key or key in heuristic_keys or key in dismissed:
            continue
        if key in single_debits:
            single_debits[key]["count"] += 1
        else:
            single_debits[key] = {"key": key, "avg_amount": abs(float(t.get("amount", 0))), "last_date": t["date"], "count": 1, "category": cat}

    ai_candidates = [v for v in single_debits.values() if v["count"] == 1 and v["avg_amount"] >= 10]
    ai_predictions = await _ai_recurring_predict(ai_candidates, uid)
    for pred in ai_predictions:
        if pred["key"] not in heuristic_keys and pred["key"] not in dismissed:
            recurring_spend.append(pred)

    recurring_keys = {r["key"] for r in recurring_spend}
    non_recurring_debits = [
        t for t in debits
        if (t.get("merchant_name") or t.get("description", "")[:35]).strip() not in recurring_keys
    ]
    avg_daily_spend = (sum(abs(float(t.get("amount", 0))) for t in non_recurring_debits) / 90) if non_recurring_debits else 0

    acct_proj = {"balance": 1, "currency": 1}
    all_accounts = (
        await accounts_col.find({"user_id": uid}, acct_proj).to_list(None)
        + await yapily_accounts_col.find({"user_id": uid}, acct_proj).to_list(None)
        + await mono_accounts_col.find({"user_id": uid}, acct_proj).to_list(None)
    )
    available_balance = round(sum(
        float(a.get("balance", 0))
        for a in all_accounts
        if str(a.get("currency", "GBP")).upper() in {"GBP", ""}
        and float(a.get("balance", 0)) > 0
    ), 2)

    def _serialise_pattern(r: dict) -> dict:
        acct = account_map.get(r.get("account_id") or "") if r.get("account_id") else None
        return {
            "key":             r["key"],
            "avg_amount":      r["avg_amount"],
            "avg_interval":    r.get("avg_interval"),
            "next_date":       r["next_date"].isoformat(),
            "account_id":      r.get("account_id"),
            "account_name":    acct["name"] if acct else None,
            "account_bank":    acct.get("provider") if acct else None,
            "account_balance": acct["balance"] if acct else None,
            "category":        r.get("category"),
        }

    return {
        "recurring_spend":  [_serialise_pattern(r) for r in recurring_spend],
        "recurring_income": [{"key": r["key"], "avg_amount": r["avg_amount"], "avg_interval": r.get("avg_interval"), "next_date": r["next_date"].isoformat(), "category": r.get("category")} for r in recurring_income],
        "avg_daily_spend":  round(avg_daily_spend, 2),
        "available_balance": available_balance,
    }


async def compute_and_cache_cashflow(uid: str, clear_ai_cache: bool = True) -> None:
    """Background task: compute cashflow patterns and store to cache. Called after every sync."""
    try:
        # Clear the in-process AI cache so the next compute gets fresh predictions.
        # Dismiss/restore skip this — they only change filters, so the cached
        # AI predictions stay valid and the rebuild takes milliseconds.
        if clear_ai_cache:
            _ai_recurring_cache.pop(uid, None)
        data = await _compute_cashflow_patterns(uid)
        data["computed_at"] = datetime.now()
        await cashflow_cache_col.update_one(
            {"_id": uid},
            {"$set": data},
            upsert=True,
        )
    except Exception as e:
        print(f"[cashflow_cache] compute failed for {uid}: {e}")


@router.get("/cashflow/at-risk-count")
async def at_risk_count(user: dict = Depends(current_user)):
    """Bills due strictly before the user's next payday that their account genuinely can't cover.

    Uses a running-balance simulation per account rather than comparing each bill
    in isolation.  The naive approach (bill.amount > account_balance) over-counts
    because N bills sharing one under-funded account each trip the check, inflating
    the badge by up to N-1.  The simulation walks bills and income in chronological
    order and only marks a bill at-risk when the running balance at that point in
    time is insufficient — reflecting payment sequencing and incoming income.
    """
    cached = await cashflow_cache_col.find_one({"_id": user["email"]})
    if not cached:
        return {"count": 0}
    resp = await _build_cashflow_response(cached, uid=user["email"])

    from app.services.pay_period import get_pay_period_for_date as _get_period, _next_payday as _calc_next_payday
    from datetime import date as _date_cls
    _user_prefs = await preferences_col.find_one({"user_id": user["email"]}) or {}
    _pay_cfg    = _user_prefs.get("pay_period_config", {"type": "calendar_month"})
    _today_d    = _date_cls.today()
    _next_pay   = _calc_next_payday(_today_d, _pay_cfg)
    _days_to_pay = (_next_pay - _today_d).days
    window_bills  = [b for b in resp["upcoming_bills"]  if b["days_away"] < _days_to_pay]
    window_income = [i for i in resp["upcoming_income"] if i["days_away"] < _days_to_pay]

    # Skip bills where we have no balance data (credit cards / unknown accounts).
    assessable_bills = [
        b for b in window_bills
        if b.get("account_balance") is not None and b["account_balance"] >= 0
    ]
    if not assessable_bills:
        return {"count": 0}

    # Seed each account's running balance from live account documents so that
    # balances reflect the current state rather than the (possibly days-old)
    # snapshot frozen inside the cashflow cache.  Falls back to the cached
    # account_balance if the live query returns nothing for a given account
    # (e.g. the account was removed or belongs to a provider not in scope).
    acct_ids = list({b["account_id"] for b in assessable_bills if b.get("account_id")})
    live_balances: dict[str, float] = {}
    if acct_ids:
        from bson import ObjectId

        def _try_oid(v: str):
            try:
                return ObjectId(v)
            except Exception:
                return v

        oid_ids = [_try_oid(a) for a in acct_ids]
        for col in (accounts_col, yapily_accounts_col):
            async for acc in col.find(
                {"_id": {"$in": oid_ids}},
                {"balance": 1, "current_balance": 1, "available_balance": 1},
            ):
                bal = acc.get("balance") or acc.get("current_balance") or acc.get("available_balance") or 0.0
                live_balances[str(acc["_id"])] = float(bal)

    running: dict[str, float] = {}
    for b in assessable_bills:
        acct = b["account_id"] or "__unknown__"
        if acct not in running:
            running[acct] = live_balances.get(str(acct), float(b.get("account_balance") or 0))

    # Merge bills and income into a single timeline, sorted by days_away.
    # Income carries no account_id in the current schema, so credit it to every
    # account proportionally would be wrong — instead we credit the shared pot for
    # each account that has the same account_id as the income occurrence (unknown
    # here, so income without an account_id is applied to "__unknown__" only).
    events: list[tuple[int, str, float, bool]] = []  # (days_away, acct_id, amount, is_income)
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False))
    for i in window_income:
        # income_patterns don't carry account_id; broadcast credit to all seeded accounts
        for acct in list(running.keys()):
            events.append((i["days_away"], acct, float(i["amount"]), True))

    events.sort(key=lambda e: (e[0], 0 if e[3] else 1))  # income before bills on the same day

    at_risk = 0
    # Track which (days_away, acct) bills we've already assessed so that
    # broadcast income isn't double-applied when multiple bills share one account.
    processed_income: set[tuple[int, str]] = set()
    for days_away, acct, amount, is_income in events:
        if is_income:
            key = (days_away, acct)
            if key not in processed_income:
                running[acct] = running.get(acct, 0.0) + amount
                processed_income.add(key)
        else:
            bal = running.get(acct, 0.0)
            if bal >= amount:
                running[acct] = bal - amount  # bill clears
            else:
                at_risk += 1                  # bill bounces; balance unchanged

    return {"count": at_risk}


@router.post("/cashflow/dismiss-recurring")
async def dismiss_recurring(body: dict, user: dict = Depends(current_user)):
    """'Not a bill': permanently exclude a merchant from upcoming-payment
    prediction and rebuild the cashflow cache."""
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    await preferences_col.update_one(
        {"user_id": uid},
        {"$addToSet": {"dismissed_recurring": key}, "$set": {"user_id": uid}},
        upsert=True,
    )
    await compute_and_cache_cashflow(uid, clear_ai_cache=False)
    return {"ok": True}


@router.post("/cashflow/restore-recurring")
async def restore_recurring(body: dict, user: dict = Depends(current_user)):
    """Undo a dismiss: allow the merchant back into predictions and rebuild."""
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    await preferences_col.update_one(
        {"user_id": uid}, {"$pull": {"dismissed_recurring": key}}
    )
    await compute_and_cache_cashflow(uid, clear_ai_cache=False)
    return {"ok": True}


@router.post("/cashflow/edit-upcoming")
async def edit_upcoming(body: dict, user: dict = Depends(current_user)):
    """Override a single upcoming occurrence's date and/or amount."""
    uid = user["email"]
    key = (body.get("key") or "").strip()
    date_str = (body.get("date") or "").strip()
    scope = (body.get("scope") or "one").strip()
    new_date = (body.get("new_date") or "").strip() or None
    new_amount = body.get("new_amount")

    if not key:
        raise HTTPException(400, "key required")
    if not date_str:
        raise HTTPException(400, "date required")
    if scope not in ("one", "future"):
        raise HTTPException(400, "scope must be 'one' or 'future'")
    # Validate ISO dates
    try:
        _date.fromisoformat(date_str)
        if new_date:
            _date.fromisoformat(new_date)
    except ValueError:
        raise HTTPException(400, "invalid date format — use ISO 8601 (YYYY-MM-DD)")
    if new_amount is not None:
        try:
            new_amount = float(new_amount)
            if new_amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(400, "new_amount must be a positive number")
    if new_date is None and new_amount is None:
        raise HTTPException(400, "at least one of new_date or new_amount must be provided")

    doc = {
        "uid": uid,
        "key": key,
        "date": date_str,
        "scope": scope,
        "new_date": new_date,
        "new_amount": new_amount,
        "created_at": datetime.now(),
    }
    await upcoming_overrides_col.update_one(
        {"uid": uid, "key": key, "date": date_str, "scope": scope},
        {"$set": doc},
        upsert=True,
    )
    # Fast rebuild from cached patterns — no AI re-run
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if cached:
        result = await _build_cashflow_response(cached, uid=uid)
        await cashflow_cache_col.update_one(
            {"_id": uid},
            {"$set": {"_override_rebuild": datetime.now()}},
        )
    return {"ok": True}


@router.post("/cashflow/clear-override")
async def clear_override(body: dict, user: dict = Depends(current_user)):
    """Remove all overrides for a given occurrence key+date."""
    uid = user["email"]
    key = (body.get("key") or "").strip()
    date_str = (body.get("date") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    if not date_str:
        raise HTTPException(400, "date required")
    await upcoming_overrides_col.delete_many({"uid": uid, "key": key, "date": date_str})
    return {"ok": True}


async def _build_cashflow_response(cached: dict, uid: str | None = None) -> dict:
    """Reconstruct the time-sensitive cashflow response from stored patterns. Zero DB cost."""
    today = datetime.now()
    # 35 days covers any monthly pay period; the frontend clips to period end.
    # Weekly-ish bills repeat within the window instead of showing once.
    window_end = today + timedelta(days=35)

    spend_patterns  = cached.get("recurring_spend", [])
    income_patterns = cached.get("recurring_income", [])

    # Load overrides for this user (empty list if no uid provided)
    overrides: list[dict] = []
    if uid:
        overrides = await upcoming_overrides_col.find({"uid": uid}).to_list(None)

    def _parse_date(s: str) -> datetime:
        return datetime.fromisoformat(s)

    def _occurrences(r: dict) -> list[datetime]:
        interval = float(r.get("avg_interval") or 30)
        d = _parse_date(r["next_date"])
        out: list[datetime] = []
        for _ in range(12):  # guard: at most 12 projections per pattern
            if d.date() > window_end.date():
                break
            if d.date() >= today.date():
                out.append(d)
            if 28 <= interval <= 33:
                # Monthly bills anchor to day-of-month (same rule as detection)
                year  = d.year + (1 if d.month == 12 else 0)
                month = 1 if d.month == 12 else d.month + 1
                day   = min(d.day, monthrange(year, month)[1])
                d = d.replace(year=year, month=month, day=day)
            else:
                d = d + timedelta(days=max(2, round(interval)))
        return out

    def _apply_overrides_to_occurrence(key: str, occ_date_str: str, amount: float) -> tuple[str, float, bool]:
        """Returns (final_date_str, final_amount, edited_flag)."""
        edited = False
        final_date = occ_date_str
        final_amount = amount
        for ov in overrides:
            if ov.get("key") != key:
                continue
            scope = ov.get("scope", "one")
            ov_date = ov.get("date", "")
            if scope == "one" and occ_date_str == ov_date:
                if ov.get("new_date"):
                    final_date = ov["new_date"]
                if ov.get("new_amount") is not None:
                    final_amount = float(ov["new_amount"])
                edited = True
            elif scope == "future" and occ_date_str >= ov_date:
                if ov.get("new_amount") is not None:
                    final_amount = float(ov["new_amount"])
                    edited = True
                if ov.get("new_date") and not edited:
                    # For future scope, re-anchor the day-of-month/weekday
                    # to match the override date's weekday/day
                    try:
                        new_ref = _date.fromisoformat(ov["new_date"])
                        orig = _date.fromisoformat(occ_date_str)
                        r_interval = float(overrides[0].get("avg_interval", 30) if overrides else 30)
                        if 6 <= r_interval <= 18:
                            # Weekly/biweekly: shift by weekday delta
                            wd_delta = new_ref.weekday() - _date.fromisoformat(ov_date).weekday()
                            shifted = orig + timedelta(days=wd_delta)
                            final_date = shifted.isoformat()
                        else:
                            # Monthly: shift by day-of-month delta
                            day_delta = new_ref.day - _date.fromisoformat(ov_date).day
                            try:
                                shifted = orig.replace(day=min(orig.day + day_delta, monthrange(orig.year, orig.month)[1]))
                                final_date = shifted.isoformat()
                            except ValueError:
                                pass
                        edited = True
                    except Exception:
                        pass
        return final_date, final_amount, edited

    raw_bills = []
    for r in spend_patterns:
        for occ in _occurrences(r):
            occ_date_str = occ.date().isoformat()
            final_date, final_amount, edited = _apply_overrides_to_occurrence(r["key"], occ_date_str, r["avg_amount"])
            final_date_obj = _date.fromisoformat(final_date)
            days_away = (final_date_obj - today.date()).days
            if final_date_obj > window_end.date():
                continue
            if final_date_obj < today.date():
                continue
            raw_bills.append({
                "name":            r["key"],
                "amount":          final_amount,
                "expected_date":   final_date,
                "days_away":       days_away,
                "account_id":      r.get("account_id"),
                "account_name":    r.get("account_name"),
                "account_bank":    _bank_label(r.get("account_bank")),
                "account_balance": r.get("account_balance"),
                "category":        r.get("category"),
                "edited":          edited,
            })
    upcoming_bills = sorted(raw_bills, key=lambda x: (x["days_away"], -x["amount"]))

    upcoming_income = sorted([
        {
            "name":          r["key"],
            "amount":        r["avg_amount"],
            "expected_date": occ.date().isoformat(),
            "days_away":     (occ.date() - today.date()).days,
            "category":      r.get("category"),
            "edited":        False,
        }
        for r in income_patterns
        for occ in _occurrences(r)
    ], key=lambda x: x["days_away"])

    avg_daily = cached.get("avg_daily_spend", 0)
    weeks = []
    for w in range(4):
        week_start = today + timedelta(days=w * 7)
        week_end   = week_start + timedelta(days=7)
        projected_income = sum(r["avg_amount"] for r in income_patterns if week_start.date() <= _parse_date(r["next_date"]).date() < week_end.date())
        projected_bills  = sum(r["avg_amount"] for r in spend_patterns  if week_start.date() <= _parse_date(r["next_date"]).date() < week_end.date())
        weeks.append({
            "label":            week_start.strftime("%-d %b"),
            "projected_income": round(projected_income, 2),
            "projected_spend":  round(projected_bills + avg_daily * 7, 2),
            "projected_bills":  round(projected_bills, 2),
        })

    return {
        "weekly_projection": weeks,
        "upcoming_bills":    upcoming_bills,
        "upcoming_income":   upcoming_income,
        "avg_daily_spend":   round(avg_daily, 2),
        "available_balance": cached.get("available_balance", 0),
    }


_CACHE_TTL_HOURS = 6


@router.get("/cashflow")
async def get_cashflow(user: dict = Depends(current_user)):
    uid    = user["email"]
    cached = await cashflow_cache_col.find_one({"_id": uid})

    if cached:
        # Serve cache immediately; if stale, kick off a background refresh for next load
        computed_at = cached.get("computed_at")
        if computed_at and (datetime.now() - computed_at).total_seconds() > _CACHE_TTL_HOURS * 3600:
            asyncio.create_task(compute_and_cache_cashflow(uid))
        return await _build_cashflow_response(cached, uid=uid)

    # No cache yet — compute live, store, then return
    data = await _compute_cashflow_patterns(uid)
    data["computed_at"] = datetime.now()
    await cashflow_cache_col.update_one({"_id": uid}, {"$set": data}, upsert=True)
    return await _build_cashflow_response(data, uid=uid)


def _parse_saving_amount(estimate: str | None) -> float:
    """Extract a monthly £ figure from a savings estimate string.

    Strategy:
    1. Look for an amount immediately after a savings verb ("save £X", "saving £X")
       to avoid picking up loan balances that appear earlier in the string.
    2. Fall back to the LAST £ amount in the string (the saving figure tends to
       appear after any referenced balances/prices).
    3. Determine the time unit; default to annual ÷ 12 when none is stated.
    """
    if not estimate:
        return 0.0

    clean = estimate.replace(",", "")
    low   = clean.lower()

    # 1. Savings-verb pattern: "save £3,600", "saving £37", "saves £200"
    m = re.search(r"sav(?:e|es|ing|ings)[^£]{0,30}£([\d]+(?:\.\d+)?)", low)

    # 2. Fall back: last £ amount in the string
    if not m:
        matches = list(re.finditer(r"£([\d]+(?:\.\d+)?)", clean))
        if not matches:
            return 0.0
        m = matches[-1]

    amount = float(m.group(1))

    is_monthly = "/mo" in low or "per month" in low or "a month" in low or "monthly" in low
    if is_monthly:
        return round(amount, 2)
    # Default to annual (covers /yr, "a year", "annually", unspecified)
    return round(amount / 12, 2)


@router.get("/value-delivered")
async def get_value_delivered(user: dict = Depends(current_user)):
    """Return how much monthly saving the user has unlocked by acting on insights."""
    uid = user["email"]
    docs = await savings_insights_col.find(
        {"user_id": uid},
        {"savings_estimate": 1, "title": 1, "user_context": 1,
         "verified_savings": 1, "verified_merchant": 1},
    ).to_list(None)

    verified_monthly = 0.0
    total_monthly = 0.0
    breakdown = []
    engaged = 0
    for doc in docs:
        if doc.get("verified_savings"):
            verified_monthly += float(doc["verified_savings"])
            breakdown.append({
                "title":          f"Stopped paying {doc.get('verified_merchant', '')}".strip(),
                "monthly_saving": float(doc["verified_savings"]),
                "estimate_label": "verified",
            })
            continue
        if not doc.get("user_context"):
            continue
        engaged += 1
        monthly = _parse_saving_amount(doc.get("savings_estimate"))
        if monthly > 0:
            total_monthly += monthly
            breakdown.append({
                "title":          doc.get("title", "Insight"),
                "monthly_saving": monthly,
                "estimate_label": doc.get("savings_estimate"),
            })

    return {
        "insights_acted_on":       engaged,
        "total_monthly_saving":    round(total_monthly, 2),
        "verified_monthly_saving": round(verified_monthly, 2),
        "breakdown":               breakdown,
    }
