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
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.models import KPIResponse, Insight
from app.db.collections import (
    accounts_col, transactions_col, yapily_accounts_col, yapily_transactions_col,
    statement_accounts_col, investment_accounts_col, mono_accounts_col, mpesa_accounts_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
    preferences_col, savings_insights_col, cashflow_cache_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.pay_period import get_pay_period_for_date, prev_pay_period

# Cache AI recurring predictions per user (in-process, cleared on restart)
_ai_recurring_cache: dict[str, tuple[datetime, list]] = {}

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
    stmt_accs     = [a for a in stmt_accs_all if a.get("currency", "GBP") == "GBP" or a.get("region", "UK") == "UK"]
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
        "(loans, mortgages, subscriptions, utilities, insurance, direct debits etc.) and estimate when the next "
        "payment is due based on the last_seen date (assume monthly = 28–31 days later).\n\n"
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
        })

    _ai_recurring_cache[user_id] = (datetime.now(), result)
    return result


def _detect_recurring(txns: list, min_occurrences: int = 2) -> list[dict]:
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
        avg_amount = sum(abs(float(t.get("amount", 0))) for t in items) / len(items)
        last_date  = dates[-1]
        if 28 <= avg_interval <= 33:
            # Monthly bills anchor to a day of the month. Adding a rounded
            # ~30-day interval lands a day early whenever a 31-day month is
            # involved, so advance the calendar month and keep the day.
            year  = last_date.year + (1 if last_date.month == 12 else 0)
            month = 1 if last_date.month == 12 else last_date.month + 1
            day   = min(last_date.day, monthrange(year, month)[1])
            next_date = last_date.replace(year=year, month=month, day=day)
        else:
            next_date = last_date + timedelta(days=round(avg_interval))
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
        await accounts_col.find({"user_id": uid}, {"name": 1, "balance": 1, "currency": 1}).to_list(None)
        + await yapily_accounts_col.find({"user_id": uid}, {"name": 1, "balance": 1, "currency": 1}).to_list(None)
    )
    account_map: dict[str, dict] = {
        str(a["_id"]): {"name": a.get("name", "Account"), "balance": round(float(a.get("balance", 0)), 2)}
        for a in acct_docs
        if str(a.get("currency", "GBP")).upper() in {"GBP", ""}
    }

    debits  = [t for t in raw if t.get("transaction_type") == "debit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    credits = [t for t in raw if t.get("transaction_type") == "credit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]

    recurring_spend  = _detect_recurring(debits)
    recurring_income = _detect_recurring(credits)

    heuristic_keys = {r["key"] for r in recurring_spend}
    single_debits: dict[str, dict] = {}
    for t in debits:
        key = (t.get("merchant_name") or t.get("description", "")[:35]).strip()
        if not key or key in heuristic_keys:
            continue
        if key in single_debits:
            single_debits[key]["count"] += 1
        else:
            single_debits[key] = {"key": key, "avg_amount": abs(float(t.get("amount", 0))), "last_date": t["date"], "count": 1}

    ai_candidates = [v for v in single_debits.values() if v["count"] == 1 and v["avg_amount"] >= 10]
    ai_predictions = await _ai_recurring_predict(ai_candidates, uid)
    for pred in ai_predictions:
        if pred["key"] not in heuristic_keys:
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
            "next_date":       r["next_date"].isoformat(),
            "account_id":      r.get("account_id"),
            "account_name":    acct["name"] if acct else None,
            "account_balance": acct["balance"] if acct else None,
        }

    return {
        "recurring_spend":  [_serialise_pattern(r) for r in recurring_spend],
        "recurring_income": [{"key": r["key"], "avg_amount": r["avg_amount"], "next_date": r["next_date"].isoformat()} for r in recurring_income],
        "avg_daily_spend":  round(avg_daily_spend, 2),
        "available_balance": available_balance,
    }


async def compute_and_cache_cashflow(uid: str) -> None:
    """Background task: compute cashflow patterns and store to cache. Called after every sync."""
    try:
        # Clear the in-process AI cache so the next compute gets fresh predictions
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


def _build_cashflow_response(cached: dict) -> dict:
    """Reconstruct the time-sensitive cashflow response from stored patterns. Zero DB cost."""
    today      = datetime.now()
    window_end = today + timedelta(days=14)

    spend_patterns  = cached.get("recurring_spend", [])
    income_patterns = cached.get("recurring_income", [])

    def _parse_date(s: str) -> datetime:
        return datetime.fromisoformat(s)

    upcoming_bills = sorted([
        {
            "name":            r["key"],
            "amount":          r["avg_amount"],
            "expected_date":   r["next_date"][:10],
            "days_away":       (_parse_date(r["next_date"]).date() - today.date()).days,
            "account_id":      r.get("account_id"),
            "account_name":    r.get("account_name"),
            "account_balance": r.get("account_balance"),
        }
        for r in spend_patterns
        if today.date() <= _parse_date(r["next_date"]).date() <= window_end.date()
    ], key=lambda x: (x["days_away"], -x["amount"]))

    upcoming_income = sorted([
        {
            "name":          r["key"],
            "amount":        r["avg_amount"],
            "expected_date": r["next_date"][:10],
            "days_away":     (_parse_date(r["next_date"]).date() - today.date()).days,
        }
        for r in income_patterns
        if today.date() <= _parse_date(r["next_date"]).date() <= window_end.date()
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
        return _build_cashflow_response(cached)

    # No cache yet — compute live, store, then return
    data = await _compute_cashflow_patterns(uid)
    data["computed_at"] = datetime.now()
    await cashflow_cache_col.update_one({"_id": uid}, {"$set": data}, upsert=True)
    return _build_cashflow_response(data)


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
    insights = await savings_insights_col.find(
        {"user_id": uid, "user_context": {"$exists": True, "$ne": None}},
        {"savings_estimate": 1, "title": 1},
    ).to_list(None)

    total_monthly = 0.0
    breakdown = []
    for doc in insights:
        monthly = _parse_saving_amount(doc.get("savings_estimate"))
        if monthly > 0:
            total_monthly += monthly
            breakdown.append({
                "title":          doc.get("title", "Insight"),
                "monthly_saving": monthly,
                "estimate_label": doc.get("savings_estimate"),
            })

    return {
        "insights_acted_on":    len(insights),
        "total_monthly_saving": round(total_monthly, 2),
        "breakdown":            breakdown,
    }
