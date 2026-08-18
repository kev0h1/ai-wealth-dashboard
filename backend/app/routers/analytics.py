"""KPI, insights, and budget pace-profile endpoints."""
import asyncio
import json
import logging
import re
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from datetime import date as _date
from typing import List

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS
from app.core.models import KPIResponse, Insight
from app.db.collections import (
    accounts_col, transactions_col, yapily_accounts_col, yapily_transactions_col,
    statement_accounts_col, investment_accounts_col, mono_accounts_col, mpesa_accounts_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
    preferences_col, savings_insights_col, cashflow_cache_col, upcoming_overrides_col,
    upcoming_rules_col, planned_expenses_col, investment_notes_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.pay_period import get_pay_period_for_date, prev_pay_period
from app.services import response_cache
from app.services.sync_freshness import last_bank_sync
from app.services.categorisation import series_key, has_date_fragment, is_own_transfer, user_identity
from app.services.card_rates import is_credit_card_account
from app.services.categories import get_category_kinds, is_non_spend

# Cache AI recurring predictions per user (in-process, cleared on restart)
_ai_recurring_cache: dict[str, tuple[datetime, list]] = {}

# England & Wales bank holidays (static set; extend when new years published)
UK_BANK_HOLIDAYS_EW: frozenset = frozenset({
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
    "2026-08-31", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31",
    "2027-08-30", "2027-12-27", "2027-12-28",
})
PENDING_GIVE_UP_DAYS = 10       # unmatched bills stay visible past-due long enough for the day-5 ask to be seen and acted on before auto-drop
ASK_PAST_DUE_DAYS = 5           # past-due bills escalate from quiet notice to an explicit ask at this age
OBSERVATION_LOOKBACK_DAYS = 6   # real bills land up to 5 days before their anchor; 3 days caused paid bills to sit "pending" then be silently skipped

# Bump whenever the shape/semantics of cashflow_cache_col docs change in a way
# that makes older cached docs unsafe to serve as-is. v2 added "is_credit_card"
# to every bill entry (see is_credit_card_account) — pre-v2 docs predate the
# field entirely, so `.get("is_credit_card", False)` on them silently resolves
# to a concrete False (indistinguishable from a real "not a credit card"
# answer) instead of "unknown". Readers must treat missing/low version as
# stale and force a recompute rather than trust that default.
PATTERNS_VERSION = 3

def _next_working_day(d):  # d: datetime.date -> datetime.date
    while d.weekday() >= 5 or d.isoformat() in UK_BANK_HOLIDAYS_EW:
        d += timedelta(days=1)
    return d

from app.services.income import next_occurrence as _next_occ_svc, schedule_label as _schedule_label_svc

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
#
# DELIBERATELY NOT `app.services.categories.is_non_spend`. That helper also
# excludes Savings, Investment and Debt (kind `movement`), and this is the one
# place where that would be wrong: runway asks "how long does the cash last?",
# and a savings transfer or a debt repayment genuinely leaves the account, so
# it has to count. Swapping this for the shared helper would silently lengthen
# every runway figure. If you are here to "fix the drift" — this is not drift.
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
    _last_sync = await last_bank_sync(uid)

    if region == "Kenya":
        mono_accs  = await mono_accounts_col.find({"user_id": uid}).to_list(None)
        mpesa_accs = await mpesa_accounts_col.find({"user_id": uid}).to_list(None)
        stmt_accs  = await statement_accounts_col.find({"user_id": uid}).to_list(None)
        all_accs   = mono_accs + mpesa_accs + stmt_accs
        if not all_accs:
            return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=_last_sync)
        net_worth = sum(a.get("balance", 0) for a in all_accs)
        cash      = net_worth
        debits    = await get_kenya_transactions(uid, cutoff)
        debits    = [d for d in debits if d.get("transaction_type") == "debit"]
        avg_spend = _avg_monthly_burn(debits)
        runway    = cash / avg_spend if avg_spend else 0
        return KPIResponse(
            net_worth=net_worth, cash=cash, runway=round(runway, 1),
            investments=0, pensions=0, last_updated=_last_sync,
        )

    accounts      = await accounts_col.find({"user_id": uid}).to_list(None)
    yapily_accs   = await yapily_accounts_col.find({"user_id": uid}).to_list(None)
    stmt_accs_all = await statement_accounts_col.find({"user_id": uid}).to_list(None)
    # GBP net worth only — a KES statement upload must not be summed as £
    stmt_accs     = [a for a in stmt_accs_all if str(a.get("currency", "GBP")).upper() == "GBP"]
    inv_accs      = await investment_accounts_col.find({"user_id": uid}).to_list(None)
    # Aggregate contract notes since each account's statement date (display_value semantics)
    inv_notes     = await investment_notes_col.find({"user_id": uid}).to_list(None)
    _stmt_dates   = {a["_id"]: a.get("statement_date") for a in inv_accs}
    _notes_by_acc: dict = {}
    for _n in inv_notes:
        _notes_by_acc.setdefault(_n["account_id"], []).append(_n)
    investment_total = sum(
        a.get("total_value", 0) + sum(
            _n.get("amount", 0)
            for _n in _notes_by_acc.get(a["_id"], [])
            if (
                _stmt_dates.get(a["_id"]) is None
                or _n.get("trade_date") is None
                or _n["trade_date"] > _stmt_dates[a["_id"]]
            )
        )
        for a in inv_accs
    )

    if not accounts and not yapily_accs and not stmt_accs and not inv_accs:
        return KPIResponse(net_worth=0, cash=0, runway=0, investments=0, pensions=0, last_updated=_last_sync)

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
        investments=investment_total, pensions=0, last_updated=_last_sync,
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
                    rationale=f"£{avg_amount:.2f}/mo to {merchant}. Last charge {last_days}d ago, possibly unused.",
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
    kind_map      = await get_category_kinds(uid)  # ONE read per request
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
        if is_non_spend(kind_map, cat):
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
                      "messages": [{"role": "user", "content": prompt}],
                      "provider": OPENROUTER_PROVIDER_PREFS},
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
            "account_id":   c.get("account_id"),
        })

    _ai_recurring_cache[user_id] = (datetime.now(), result)
    return result


def _amount_clusters(items: list, tolerance: float = 0.3) -> list[list]:
    """Split a bucket into amount clusters (median +/- tolerance), ascending.

    Applied only to buckets whose key came from date-fragment stripping:
    date-stamped statement lines to the same account may be DIFFERENT
    payments, so only instances within the detector's existing amount
    tolerance may form one series.
    """
    srt = sorted(items, key=lambda t: abs(float(t.get("amount", 0))))
    clusters: list[list] = [[srt[0]]] if srt else []
    for t in srt[1:]:
        cur = clusters[-1]
        amts = sorted(abs(float(x.get("amount", 0))) for x in cur)
        med = amts[len(amts) // 2]
        a = abs(float(t.get("amount", 0)))
        if med > 0 and abs(a - med) <= med * tolerance:
            cur.append(t)
        else:
            clusters.append([t])
    return clusters


DEFAULT_RECURRING_CATEGORIES = ["Bills", "Savings", "Investment", "Subscriptions", "Health", "Software", "Debt"]


def _net_reversals(items: list, credits: list) -> list:
    """Drop a debit occurrence that was bounced and reversed by a matching
    credit — e.g. a returned/unpaid direct debit ("...UNP") on the same day
    as the original debit, followed by a successful retry ~a week later
    (real case: AMEX DDR £1,138.99 bounced 2026-07-10, reversed same day,
    retried 2026-07-17 — without netting this reads as a weekly series).
    Matches are same account_id, |amount diff| < 0.02, |date diff| <= 5
    days; each credit cancels at most one debit, consumed nearest-date-first.
    """
    if not credits:
        return items
    remaining = list(credits)
    kept = []
    for t in items:
        acct = str(t.get("account_id", "") or "")
        amt = abs(float(t.get("amount", 0)))
        d = t["date"]
        d = d.date() if hasattr(d, "date") else d
        best_idx, best_diff = None, None
        for i, c in enumerate(remaining):
            if not acct or str(c.get("account_id", "") or "") != acct:
                continue
            if abs(abs(float(c.get("amount", 0))) - amt) >= 0.02:
                continue
            cd = c["date"]
            cd = cd.date() if hasattr(cd, "date") else cd
            diff = abs((cd - d).days)
            if diff > 5:
                continue
            if best_diff is None or diff < best_diff:
                best_idx, best_diff = i, diff
        if best_idx is not None:
            remaining.pop(best_idx)
            continue  # bounced + reversed — not a real occurrence
        kept.append(t)
    return kept


def _detect_recurring(txns: list, min_occurrences: int = 2, trusted_categories: set | None = None, today: _date | None = None, is_income: bool = False, pay_period_config: dict | None = None, confirmed_income: dict | None = None, reversal_credits: list | None = None) -> list[dict]:
    """Group transactions by merchant key and detect those with a regular interval (7–35 days)."""
    buckets: dict[str, list] = defaultdict(list)
    date_merged_keys: set[str] = set()
    for t in txns:
        key = series_key(t)
        if not key:
            continue
        buckets[key].append(t)
        if not (t.get("merchant_name") or "").strip() and has_date_fragment(t.get("description") or ""):
            date_merged_keys.add(key)

    # Date-stripped keys may blend distinct payments that share statement
    # text; split those buckets by amount before cadence detection.
    series: list[tuple[str, list]] = []
    for key, bucket in buckets.items():
        # Identical (date, amount, account) rows are provider duplicates, not
        # cadence evidence — their zero-day intervals would halve the detected
        # interval and misread a monthly bill as biweekly.
        seen_sigs: set = set()
        deduped: list = []
        for t in bucket:
            _d = t["date"]
            _d = _d.date() if hasattr(_d, "date") else _d
            sig = (_d, round(abs(float(t.get("amount", 0))), 2), str(t.get("account_id", "") or ""))
            if sig in seen_sigs:
                continue
            seen_sigs.add(sig)
            deduped.append(t)
        # A bounced direct debit + its reversal credit + a successful retry
        # otherwise looks like two clean debit occurrences ~7 days apart
        # (real case: AMEX "...DDR" £1,138.99 bounced 2026-07-10, reversed
        # same day by an "...UNP" credit, retried 2026-07-17) — net those out
        # before cadence/clustering ever sees them.
        deduped = _net_reversals(deduped, reversal_credits or [])
        if key in date_merged_keys:
            series.extend((key, grp) for grp in _amount_clusters(deduped))
        else:
            series.append((key, deduped))

    results = []
    for key, items in series:
        if len(items) < min_occurrences:
            continue
        dates = sorted(t["date"] for t in items)
        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        avg_interval = sum(intervals) / len(intervals)
        if avg_interval < 6 or avg_interval > 35:
            continue

        # A two-occurrence series with sub-monthly spacing is exactly the
        # signature of a bounced direct debit + its retry (or an ingestion
        # duplicate) — reject before either acceptance tier (trusted-category
        # or generic) can wave it through as a weekly/biweekly pattern.
        # Genuine weekly/biweekly cadences must prove themselves with >= 3
        # occurrences; a genuine monthly 2-occurrence trusted series (interval
        # >= 21) is unaffected.
        if len(items) == 2 and avg_interval < 21:
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
        _grace = timedelta(days=0 if is_income else PENDING_GIVE_UP_DAYS)
        _config = pay_period_config or {"type": "calendar_month"}

        # Confirmed income stream: use stored schedule directly (wins over all interval logic)
        _confirmed_sched = (confirmed_income or {}).get(key, {}).get("schedule") if is_income else None
        if _confirmed_sched:
            from app.services.income import next_occurrence as _next_occ
            next_date = _next_occ(_confirmed_sched, _today)
        else:
            if 6 <= avg_interval <= 10:
                # Weekly — anchor to the modal weekday of the occurrence dates
                weekdays = [d.weekday() for d in dates]
                modal_wd = max(set(weekdays), key=weekdays.count)
                delta = (modal_wd - _today.weekday()) % 7
                delta = delta or 7  # never 0: always strictly after today
                next_date = _today + timedelta(days=delta)
                if not is_income:
                    prev_occ = _today - timedelta(days=(_today.weekday() - modal_wd) % 7)
                    if prev_occ > last_date:
                        next_date = prev_occ
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
                # Ensure it's strictly after today (minus grace for bills)
                while next_date <= _today - _grace:
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
                    # If still in the past or today (minus grace for bills), advance one more month
                    while next_date <= _today - _grace:
                        year  = next_date.year + (1 if next_date.month == 12 else 0)
                        month = 1 if next_date.month == 12 else next_date.month + 1
                        day   = min(next_date.day, monthrange(year, month)[1])
                        next_date = next_date.replace(year=year, month=month, day=day)
            else:
                next_date = last_date + timedelta(days=round(avg_interval))
                while next_date <= _today - _grace:
                    next_date += timedelta(days=round(avg_interval))
        # Attribute the pattern to the account its transactions actually landed
        # in: majority account across occurrences, tie-broken by recency.
        # (Bills reliably come from one account, so majority == most-recent for
        # them; income can wander between accounts — majority is the truth a
        # per-account simulation may rely on.)
        most_recent = max(items, key=lambda t: t["date"])
        _acct_counts: dict[str, int] = {}
        for _t in items:
            _a = str(_t.get("account_id", "") or "")
            if _a:
                _acct_counts[_a] = _acct_counts.get(_a, 0) + 1
        _recent_acct = str(most_recent.get("account_id", "") or "")
        attributed_acct = (
            max(_acct_counts, key=lambda a: (_acct_counts[a], 1 if a == _recent_acct else 0))
            if _acct_counts else None
        )
        # Amounts of the most recent (up to) 3 occurrences — used by
        # income_credit_ok to judge whether a prediction is stable enough
        # for per-account planning arithmetic.
        amounts_recent = [
            round(abs(float(_t.get("amount", 0))), 2)
            for _t in sorted(items, key=lambda t: t["date"])[-3:]
        ]
        results.append({
            "key":          key,
            "avg_interval": round(avg_interval, 1),
            "avg_amount":   round(avg_amount, 2),
            "last_date":    last_date,
            "next_date":    next_date,
            "occurrences":  len(items),
            "account_id":   attributed_acct,
            "amounts_recent": amounts_recent,
            "category":     bucket_cat,
        })
    return results


def income_credit_ok(item: dict, account_id: str, confirmed_keys: set | frozenset = frozenset()) -> bool:
    """Whether a predicted income may be credited to `account_id` inside a
    PER-ACCOUNT balance simulation (cover plans, at-risk badge, source walks).

    Plans promise safety, so an income only counts when BOTH hold:
      1. Attribution — its matched history actually landed in this account
         (majority landing account, carried on the item as `account_id`).
         Broadcast-crediting predicted income to every account is how a
         self-transfer that historically landed in one bank silently
         underwrote another bank's cover plan.
      2. Reliability — the prediction is solid: a user-confirmed income
         stream, or 3+ occurrences with stable recent amounts
         (max/min ≤ 1.5 over the last 3). Two-occurrence self-transfer
         patterns ("From <own name>") fail this gate by construction.

    Items from stale caches missing this metadata are excluded outright —
    deliberately conservative: per-account arithmetic never leans on money
    that might land elsewhere. POOLED views still count every income.
    """
    if not account_id or str(item.get("account_id") or "") != str(account_id):
        return False
    if item.get("name") in confirmed_keys:
        return True
    if (item.get("occurrences") or 0) < 3:
        return False
    amts = [float(a) for a in (item.get("amounts_recent") or []) if a and float(a) > 0]
    if len(amts) < 2:
        return False
    return max(amts) / min(amts) <= 1.5


def _split_balances(accs: list[dict]) -> tuple[float, float]:
    """Split live account balances into (spendable_cash, savings_total).

    Mirrors compute_safe_to_spend's (the Home Safe-to-Spend hero) account
    classification rules exactly, so every surface that shows "spendable
    cash" agrees with every other and can never silently diverge:
      - GBP-only (currency in {"GBP", ""})
      - subtype contains "saving" (case-insensitive) -> savings account,
        summed into savings_total (only positive balances)
      - type or subtype contains "credit" (case-insensitive) -> credit
        card, excluded from both buckets
      - negative balances excluded from both buckets (the hero tracks these
        separately as card/overdraft debt; see compute_safe_to_spend)
      - accounts with no subtype and no credit marker fall back to
        spendable, so the figure is never silently zero (covers e.g. Mono
        accounts, which don't populate subtype today)
    """
    spendable = 0.0
    savings = 0.0
    for acc in accs:
        if str(acc.get("currency", "GBP")).upper() not in {"GBP", ""}:
            continue
        bal = float(acc.get("balance") or 0)
        if bal < 0:
            continue
        subtype = (acc.get("subtype") or "").lower()
        acc_type = (acc.get("type") or "").lower()
        if "credit" in acc_type or "credit" in subtype:
            continue
        if "saving" in subtype:
            savings += bal
            continue
        spendable += bal
    return round(spendable, 2), round(savings, 2)


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

    # accounts_col/yapily_accounts_col docs today only ever populate "type"/
    # "subtype" (see truelayer_sync.py, finexer_sync.py); "account_type"/
    # "account_subtype" are projected too for forward-compat with
    # is_credit_card_account's dual lookup (mirrors companion.py/behaviour.py/
    # needle.py) in case a future writer uses the longer key names.
    acct_proj_map = {"name": 1, "balance": 1, "currency": 1, "provider": 1,
                      "type": 1, "subtype": 1, "account_type": 1, "account_subtype": 1}
    acct_docs = (
        await accounts_col.find({"user_id": uid}, acct_proj_map).to_list(None)
        + await yapily_accounts_col.find({"user_id": uid}, acct_proj_map).to_list(None)
    )
    account_map: dict[str, dict] = {
        str(a["_id"]): {
            "name": a.get("name", "Account"),
            "balance": round(float(a.get("balance", 0)), 2),
            "provider": a.get("provider"),
            "is_credit_card": is_credit_card_account(a),
        }
        for a in acct_docs
        if str(a.get("currency", "GBP")).upper() in {"GBP", ""}
    }

    debits  = [t for t in raw if t.get("transaction_type") == "debit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    credits = [t for t in raw if t.get("transaction_type") == "credit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    income_credits = [t for t in credits if (t.get("custom_category") or t.get("category") or "Other") == "Income"]

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    trusted   = set(prefs.get("recurring_categories") or DEFAULT_RECURRING_CATEGORIES)
    dismissed = set(prefs.get("dismissed_recurring") or [])
    pay_period_config = prefs.get("pay_period_config") or {"type": "calendar_month"}
    _today = _date.today()

    # Build confirmed income map for schedule-aware detection
    _confirmed_income_map: dict = {}
    for _s in (prefs.get("income_streams") or []):
        if _s.get("status") == "confirmed" and _s.get("schedule"):
            _confirmed_income_map[_s["key"]] = _s

    recurring_spend  = _detect_recurring(debits, trusted_categories=trusted, today=_today, is_income=False, pay_period_config=pay_period_config, reversal_credits=credits)
    recurring_spend  = [r for r in recurring_spend if r["key"] not in dismissed]
    recurring_income = _detect_recurring(income_credits, today=_today, is_income=True, pay_period_config=pay_period_config, confirmed_income=_confirmed_income_map)
    recurring_income = [r for r in recurring_income if r["key"] not in dismissed]

    heuristic_keys = {r["key"] for r in recurring_spend}
    single_debits: dict[str, dict] = {}
    for t in debits:
        # First-occurrence AI guessing is only allowed in trusted categories —
        # a one-off restaurant or car park should never reach the model
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat not in trusted:
            continue
        key = series_key(t)
        if not key or key in heuristic_keys or key in dismissed:
            continue
        if key in single_debits:
            single_debits[key]["count"] += 1
        else:
            single_debits[key] = {"key": key, "avg_amount": abs(float(t.get("amount", 0))), "last_date": t["date"], "count": 1, "category": cat, "account_id": str(t.get("account_id") or "") or None}

    def _prefix_token(key: str) -> str:
        # First token of the key; use first two joined if token[0] < 6 chars
        # e.g. "NETFLIX.COM 18665797172" → "NETFLIX.COM"; "EE 203832" → "EE 203832"
        parts = key.split()
        return parts[0] if len(parts[0]) >= 6 else " ".join(parts[:2])

    def _within_15pct(a: float, b: float) -> bool:
        ref = max(a, b)
        return ref == 0 or abs(a - b) / ref <= 0.15

    heuristic_prefixes = {_prefix_token(k): r["avg_amount"] for r in recurring_spend for k in [r["key"]]}

    raw_candidates = [v for v in single_debits.values() if v["count"] == 1 and v["avg_amount"] >= 10]
    # Drop candidates whose prefix+amount already match a deterministic recurring entry
    # (e.g. "NETFLIX.COM 203832 LND" shadowed by heuristic "NETFLIX.COM 18665797172", same £12.99)
    filtered_candidates: list[dict] = []
    for c in raw_candidates:
        pfx = _prefix_token(c["key"])
        if pfx in heuristic_prefixes and _within_15pct(c["avg_amount"], heuristic_prefixes[pfx]):
            continue  # Netflix phantom-bill guard: same prefix+~amount already heuristic-detected
        filtered_candidates.append(c)
    # Among remaining candidates with matching prefix+amount, keep only the most recent
    best_by_prefix: dict[str, dict] = {}
    for c in filtered_candidates:
        pfx = _prefix_token(c["key"])
        existing = best_by_prefix.get(pfx)
        if existing is None:
            best_by_prefix[pfx] = c
        elif _within_15pct(c["avg_amount"], existing["avg_amount"]) and c["last_date"] > existing["last_date"]:
            # same prefix+~amount: keep the one with the most recent last_date
            best_by_prefix[pfx] = c
        # different amounts under same prefix → keep both via separate prefix keys (won't collide here)
    ai_candidates = list(best_by_prefix.values())
    ai_predictions = await _ai_recurring_predict(ai_candidates, uid)
    for pred in ai_predictions:
        pfx = _prefix_token(pred["key"])
        # Guard: don't append if an existing recurring_spend entry shares prefix+~amount
        dup = any(
            _prefix_token(r["key"]) == pfx and _within_15pct(pred.get("avg_amount", 0), r["avg_amount"])
            for r in recurring_spend
        )
        if pred["key"] not in heuristic_keys and pred["key"] not in dismissed and not dup:
            recurring_spend.append(pred)

    recurring_keys = {r["key"] for r in recurring_spend}
    non_recurring_debits = [
        t for t in debits
        if series_key(t) not in recurring_keys
    ]
    avg_daily_spend = (sum(abs(float(t.get("amount", 0))) for t in non_recurring_debits) / 90) if non_recurring_debits else 0

    acct_proj = {"balance": 1, "currency": 1, "type": 1, "subtype": 1}
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
    # Same pool as the Home Safe-to-Spend hero, split spendable vs savings so
    # the Planning runway can use exactly the hero's "spendable cash" figure
    # instead of the all-positive-balances sum above (which silently counts
    # savings). See _split_balances docstring for the shared classification
    # rules.
    spendable_balance, savings_balance = _split_balances(all_accounts)

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
            "is_credit_card":  acct.get("is_credit_card", False) if acct else False,
            "category":        r.get("category"),
        }

    return {
        "recurring_spend":  [_serialise_pattern(r) for r in recurring_spend],
        "recurring_income": [
            {**_serialise_pattern(r), "occurrences": r.get("occurrences"), "amounts_recent": r.get("amounts_recent")}
            for r in recurring_income
        ],
        "avg_daily_spend":  round(avg_daily_spend, 2),
        "available_balance": available_balance,
        "spendable_balance": spendable_balance,
        "savings_balance":  savings_balance,
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
        data["patterns_version"] = PATTERNS_VERSION
        # Refresh the memoised monthly cash-flow alongside the patterns so
        # per-request callers (safe-to-spend, debt, savings) read it for free.
        try:
            from app.services.cashflow import monthly_cashflow as _mcf
            _region = await get_user_region(uid)
            _cf = await _mcf(uid, _region, datetime.now() - timedelta(days=90))
            data["monthly_cf"] = {"data": _cf, "region": _region, "computed_at": datetime.now()}
        except Exception as _mcf_e:
            print(f"[cashflow_cache] monthly_cf refresh failed for {uid}: {_mcf_e}")
        await cashflow_cache_col.update_one(
            {"_id": uid},
            # Fresh transactions/categories can move the 90-day medians the
            # Spend tiles compare against, so the memoised per-category
            # baselines go with the stale cashflow (see pace._read_cached_baseline).
            {"$set": data, "$unset": {"total_baselines": ""}},
            upsert=True,
        )
        # Fresh data invalidates the short-TTL response caches (same-process
        # only; worker-process syncs rely on the 90 s TTL as the bound).
        response_cache.invalidate(uid)
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
    if not cached or (cached.get("patterns_version") or 0) < PATTERNS_VERSION:
        # This badge drives a user-visible red "at risk" count — a stale/pre-fix
        # cache doc (missing is_credit_card) can misclassify a credit card as a
        # debit account and inflate it with a false alarm. Recompute
        # synchronously rather than ever serving that doc for this endpoint.
        await compute_and_cache_cashflow(user["email"])
        cached = await cashflow_cache_col.find_one({"_id": user["email"]})
        if not cached:
            return {"count": 0}
    resp = await _build_cashflow_response(cached, uid=user["email"])

    from app.services.pay_period import get_pay_period_for_date as _get_period, _next_payday as _calc_next_payday
    from app.services.income import get_confirmed_payday as _get_confirmed_payday
    from datetime import date as _date_cls
    _user_prefs = await preferences_col.find_one({"user_id": user["email"]}) or {}
    _pay_cfg    = _user_prefs.get("pay_period_config", {"type": "calendar_month"})
    _today_d    = _date_cls.today()
    _confirmed_result = _get_confirmed_payday(_user_prefs, _today_d)
    if _confirmed_result:
        _next_pay, _ = _confirmed_result
    else:
        _next_pay = _calc_next_payday(_today_d, _pay_cfg)
    _days_to_pay = (_next_pay - _today_d).days
    _lookahead = 5 if _days_to_pay <= 1 else 0  # last-day lookahead: assess the next period's first 5 days once the current one is ending
    window_bills  = [b for b in resp["upcoming_bills"]  if b["days_away"] <= _days_to_pay + _lookahead]
    window_income = [i for i in resp["upcoming_income"] if i["days_away"] <= _days_to_pay + _lookahead]

    # Skip bills where we have no balance data, or the bill is on a credit card
    # (credit cards have a credit limit, not an available balance, so a bill
    # against one must never count toward at-risk/shortfall).
    assessable_bills = [
        b for b in window_bills
        if b.get("account_balance") is not None
        and b["account_balance"] >= 0
        and not b.get("is_credit_card")
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
    # Income is credited ONLY to the account its history actually landed in,
    # and only when the prediction is reliable — see income_credit_ok.
    _confirmed_keys = {
        s.get("key") for s in (_user_prefs.get("income_streams") or [])
        if s.get("status") == "confirmed"
    }
    events: list[tuple[int, str, float, bool]] = []  # (days_away, acct_id, amount, is_income)
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False))
    for i in window_income:
        acct = str(i.get("account_id") or "")
        if acct in running and income_credit_ok(i, acct, _confirmed_keys):
            events.append((i["days_away"], acct, float(i["amount"]), True))

    events.sort(key=lambda e: (e[0], 1 if e[3] else 0))  # bills before income on the same day (conservative)

    at_risk = 0
    for days_away, acct, amount, is_income in events:
        if is_income:
            running[acct] = running.get(acct, 0.0) + amount
        else:
            bal = running.get(acct, 0.0)
            # Deficit cascades (same semantics as companion.py's shortfall
            # walk): a bounced bill still debits the running balance, so every
            # later bill on a short account counts until income recovers it.
            running[acct] = bal - amount
            if bal < amount:
                at_risk += 1

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


def _validate_schedule(schedule: dict) -> dict | None:
    """Validate a user-provided schedule dict. Returns cleaned dict or None if invalid."""
    if not isinstance(schedule, dict):
        return None
    t = schedule.get("type")
    if t not in ("weekly", "biweekly", "day_of_month", "last_weekday"):
        return None
    if t in ("weekly", "last_weekday"):
        wd = schedule.get("weekday")
        if not isinstance(wd, int) or not (0 <= wd <= 6):
            return None
        return {"type": t, "weekday": wd}
    if t == "biweekly":
        wd = schedule.get("weekday")
        if not isinstance(wd, int) or not (0 <= wd <= 6):
            return None
        anchor_str = schedule.get("anchor", "")
        try:
            anchor_date = _date.fromisoformat(str(anchor_str))
        except (ValueError, TypeError):
            anchor_date = _date.today()
        # Shift anchor to the nearest matching weekday (forward)
        delta = (wd - anchor_date.weekday()) % 7
        if delta != 0:
            anchor_date = anchor_date + timedelta(days=delta)
        return {"type": t, "weekday": wd, "anchor": anchor_date.isoformat()}
    if t == "day_of_month":
        day = schedule.get("day")
        if not isinstance(day, int) or not (1 <= day <= 31):
            return None
        return {"type": t, "day": day}
    return None


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
        raise HTTPException(400, "invalid date format, use ISO 8601 (YYYY-MM-DD)")
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
    response_cache.invalidate(uid)
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
    response_cache.invalidate(uid)
    return {"ok": True}


@router.post("/cashflow/skip-occurrence")
async def skip_occurrence(body: dict, user: dict = Depends(current_user)):
    """Mark a single upcoming bill occurrence as user-dismissed (per-occurrence skip).

    The skip can be undone with POST /cashflow/clear-override using the same key+date.
    """
    uid = user["email"]
    key = (body.get("key") or "").strip()
    date_str = (body.get("date") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    if not date_str:
        raise HTTPException(400, "date required")
    try:
        _date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(400, "invalid date format, use ISO 8601 (YYYY-MM-DD)")

    doc = {
        "uid": uid,
        "key": key,
        "date": date_str,
        "scope": "one",
        "skip": True,
        "created_at": datetime.now(),
    }
    await upcoming_overrides_col.update_one(
        {"uid": uid, "key": key, "scope": "one", "date": date_str},
        {"$set": doc},
        upsert=True,
    )
    # Fast rebuild from cached patterns — mirror edit_upcoming's cache-invalidation pattern
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if cached:
        result = await _build_cashflow_response(cached, uid=uid)
        await cashflow_cache_col.update_one(
            {"_id": uid},
            {"$set": {"_override_rebuild": datetime.now()}},
        )
    response_cache.invalidate(uid)
    return {"ok": True}


@router.post("/cashflow/preview-rule")
async def preview_rule(body: dict, user: dict = Depends(current_user)):
    """Parse plain-English recurrence description via Haiku → return schedule + next 3 dates."""
    from datetime import date as _d_today
    uid = user["email"]
    key = (body.get("key") or "").strip()
    text = (body.get("text") or "").strip()
    anchor_str = (body.get("anchor_date") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    if not text:
        raise HTTPException(400, "text required")
    if len(text) > 200:
        raise HTTPException(400, "text too long (max 200 chars)")
    try:
        anchor_date = _date.fromisoformat(anchor_str)
    except (ValueError, TypeError):
        anchor_date = _date.today()

    today_iso = _date.today().isoformat()
    prompt = (
        f"Today is {today_iso}. The recurring item is: \"{key}\". "
        f"The anchor date (last known occurrence) is: {anchor_date.isoformat()}.\n\n"
        "The user describes when a recurring payment happens, in plain English. "
        "Map it to EXACTLY one of these JSON schedules (weekday: 0=Monday … 6=Sunday):\n"
        "{\"type\":\"weekly\",\"weekday\":N} — e.g. \"every Sunday\"\n"
        "{\"type\":\"biweekly\",\"weekday\":N,\"anchor\":\"YYYY-MM-DD\"} — e.g. \"every other Friday\"; "
        "use the anchor date provided, adjusted to the nearest matching weekday\n"
        "{\"type\":\"day_of_month\",\"day\":N} — e.g. \"the 15th of each month\" (day 1-31)\n"
        "{\"type\":\"last_weekday\",\"weekday\":N} — e.g. \"last Friday of the month\"\n"
        "If the description can't be expressed as one of these, reply {\"error\":\"<short plain-English reason>\"}.\n"
        "Reply ONLY with the JSON object.\n\n"
        f"User description: \"{text}\""
    )

    _soft_error = {"ok": False, "error": "Couldn't understand that, try something like 'every Sunday' or 'last Friday of the month'"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 300,
                      "messages": [{"role": "user", "content": prompt}],
                      "provider": OPENROUTER_PROVIDER_PREFS},
            )
        if r.status_code != 200:
            return _soft_error
        content = r.json()["choices"][0]["message"]["content"].strip()
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            return _soft_error
        raw_sched = json.loads(m.group(0))
    except Exception:
        return _soft_error

    if raw_sched.get("error"):
        return {"ok": False, "error": raw_sched["error"]}

    schedule = _validate_schedule(raw_sched)
    if schedule is None:
        return _soft_error

    # Build label (never 500)
    try:
        label = _schedule_label_svc(schedule)
    except Exception:
        t = schedule["type"]
        wd_names = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
        if t == "weekly":
            label = f"every {wd_names[schedule['weekday']]}"
        elif t == "biweekly":
            label = f"every other {wd_names[schedule['weekday']]}"
        elif t == "day_of_month":
            label = f"around the {schedule['day']} each month"
        elif t == "last_weekday":
            label = f"the last {wd_names[schedule['weekday']]} each month"
        else:
            label = "on a regular schedule"

    # Compute next 3 occurrences (today counts if it matches)
    from datetime import timedelta as _td2
    d = _next_occ_svc(schedule, _date.today() - timedelta(days=1))
    next_dates = [d]
    for _ in range(2):
        d = _next_occ_svc(schedule, d)
        next_dates.append(d)

    return {
        "ok": True,
        "schedule": schedule,
        "label": label,
        "next_dates": [d.isoformat() for d in next_dates],
    }


@router.post("/cashflow/apply-rule")
async def apply_rule(body: dict, user: dict = Depends(current_user)):
    """Persist a validated recurrence rule for an upcoming item."""
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    schedule = _validate_schedule(body.get("schedule") or {})
    if schedule is None:
        raise HTTPException(400, "invalid schedule")

    try:
        label = _schedule_label_svc(schedule)
    except Exception:
        label = "on a regular schedule"

    doc = {
        "uid": uid,
        "key": key,
        "schedule": schedule,
        "label": label,
        "created_at": datetime.now(),
    }
    await upcoming_rules_col.update_one(
        {"uid": uid, "key": key},
        {"$set": doc},
        upsert=True,
    )
    # Delete all overrides for this key — rule is the new source of truth
    await upcoming_overrides_col.delete_many({"uid": uid, "key": key})
    # Touch cache rebuild timestamp
    await cashflow_cache_col.update_one(
        {"_id": uid},
        {"$set": {"_override_rebuild": datetime.now()}},
    )
    response_cache.invalidate(uid)
    return {"ok": True, "label": label}


@router.post("/cashflow/clear-rule")
async def clear_rule(body: dict, user: dict = Depends(current_user)):
    """Remove a user-defined recurrence rule for an upcoming item."""
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    await upcoming_rules_col.delete_many({"uid": uid, "key": key})
    await cashflow_cache_col.update_one(
        {"_id": uid},
        {"$set": {"_override_rebuild": datetime.now()}},
    )
    response_cache.invalidate(uid)
    return {"ok": True}


async def _build_cashflow_response(cached: dict, uid: str | None = None, prefs: dict | None = None) -> dict:
    """Reconstruct the time-sensitive cashflow response from stored patterns. Zero DB cost.

    Pass `prefs` (the user's preferences doc) when the caller has already
    fetched it, to avoid a duplicate find_one per request."""
    today = datetime.now()
    today_d = today.date()
    # 35 days covers any monthly pay period; the frontend clips to period end.
    # Weekly-ish bills repeat within the window instead of showing once.
    window_end = today + timedelta(days=35)

    spend_patterns  = cached.get("recurring_spend", [])
    income_patterns = cached.get("recurring_income", [])

    # --- observation index for bill matching ---
    observed: dict = {}
    if uid:
        _obs_since = today - timedelta(days=PENDING_GIVE_UP_DAYS + OBSERVATION_LOOKBACK_DAYS + 1)
        _obs_pipeline_results = []
        for _col in [transactions_col, yapily_transactions_col]:
            try:
                async for _t in _col.find(
                    {"user_id": uid, "date": {"$gte": _obs_since}, "transaction_type": "debit"},
                    {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
                     "category": 1, "custom_category": 1, "account_id": 1}
                ):
                    _obs_pipeline_results.append(_t)
            except Exception:
                pass
        for _t in _obs_pipeline_results:
            _eff_cat = (_t.get("custom_category") or _t.get("category") or "Other")
            if _eff_cat == "Transfer":
                continue
            _key = series_key(_t)
            if not _key:
                continue
            _raw_d = _t.get("date")
            _d_obj = _raw_d.date() if hasattr(_raw_d, "date") else _raw_d
            observed.setdefault(_key, []).append({
                "date": _d_obj,
                "amount": abs(float(_t.get("amount", 0))),
                "account_id": str(_t.get("account_id") or ""),
                "used": False,
            })

    # Load overrides for this user (empty list if no uid provided)
    overrides: list[dict] = []
    if uid:
        overrides = await upcoming_overrides_col.find({"uid": uid}).to_list(None)

    # Load confirmed income schedules so _occurrences can step correctly
    confirmed_income: dict[str, dict] = {}
    if uid:
        _prefs_doc = prefs if prefs is not None else (await preferences_col.find_one({"user_id": uid}) or {})
        for s in (_prefs_doc.get("income_streams") or []):
            if s.get("status") == "confirmed" and s.get("schedule"):
                confirmed_income[s["key"]] = s

    # Load user-defined AI recurrence rules (highest priority)
    rules: dict[str, dict] = {}
    if uid:
        for rdoc in await upcoming_rules_col.find({"uid": uid}).to_list(None):
            rules[rdoc["key"]] = rdoc

    def _parse_date(s: str) -> datetime:
        return datetime.fromisoformat(s)

    def _match_observed(key, account_id, expected_amount, expected_d):
        tol = max(2.0, abs(expected_amount) * 0.15)
        lo = expected_d - timedelta(days=OBSERVATION_LOOKBACK_DAYS)
        for tx in observed.get(key, []):
            if tx["used"]:
                continue
            if not (lo <= tx["date"] <= today_d):
                continue
            if account_id and tx["account_id"] and tx["account_id"] != str(account_id):
                continue
            if abs(tx["amount"] - abs(expected_amount)) > tol:
                continue
            tx["used"] = True   # one debit closes at most one occurrence
            return True
        return False

    def _occurrences(r: dict, include_past_due: bool = False) -> list[datetime]:
        interval = float(r.get("avg_interval") or 30)
        key = r.get("key", "")
        confirmed_sched = confirmed_income.get(key, {}).get("schedule") if confirmed_income else None

        # User rule takes TOP precedence — generate directly from the rule schedule
        if rule := rules.get(key):
            sched = rule["schedule"]
            d_date = _next_occ_svc(sched, (today_d - timedelta(days=PENDING_GIVE_UP_DAYS + 1)) if include_past_due else (today.date() - timedelta(days=1)))
            out: list[datetime] = []
            while d_date <= window_end.date() and len(out) < 12:
                out.append(datetime(d_date.year, d_date.month, d_date.day))
                d_date = _next_occ_svc(sched, d_date)
            return out

        d = _parse_date(r["next_date"])
        out = []
        for _ in range(12):  # guard: at most 12 projections per pattern
            if d.date() > window_end.date():
                break
            if d.date() >= (today_d - timedelta(days=PENDING_GIVE_UP_DAYS) if include_past_due else today_d):
                out.append(d)
            # Step to next occurrence
            if confirmed_sched:
                next_d = _next_occ_svc(confirmed_sched, d.date())
                d = datetime(next_d.year, next_d.month, next_d.day)
            elif 28 <= interval <= 33:
                # Monthly bills anchor to day-of-month (same rule as detection)
                year  = d.year + (1 if d.month == 12 else 0)
                month = 1 if d.month == 12 else d.month + 1
                day   = min(d.day, monthrange(year, month)[1])
                d = d.replace(year=year, month=month, day=day)
            else:
                d = d + timedelta(days=max(2, round(interval)))
        return out

    def _apply_overrides_to_occurrence(key: str, occ_date_str: str, amount: float) -> tuple[str, float, bool, bool]:
        """Returns (final_date_str, final_amount, edited_flag, skipped_flag)."""
        edited = False
        skipped = False
        final_date = occ_date_str
        final_amount = amount
        for ov in overrides:
            if ov.get("key") != key:
                continue
            scope = ov.get("scope", "one")
            ov_date = ov.get("date", "")
            if scope == "one" and occ_date_str == ov_date:
                if ov.get("skip"):
                    skipped = True
                    return final_date, final_amount, edited, skipped
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
        return final_date, final_amount, edited, skipped

    raw_bills = []
    _bill_occ_dates: list = []  # (date_obj, amount) tuples for weekly projection
    for r in spend_patterns:
        entries = []
        for occ in _occurrences(r, include_past_due=True):
            occ_date_str = occ.date().isoformat()
            final_date, final_amount, edited, skipped = _apply_overrides_to_occurrence(r["key"], occ_date_str, r["avg_amount"])
            if skipped:
                continue  # per-occurrence user dismiss; can be undone via clear-override
            D = _date.fromisoformat(final_date)
            if D > window_end.date():
                continue
            if uid and _match_observed(r["key"], r.get("account_id"), final_amount, D):
                continue          # CLOSED by an observed debit (early payments included)
            if D < today_d and (today_d - D).days >= PENDING_GIVE_UP_DAYS:
                continue          # give-up horizon: skipped this cycle
            pending = D <= today_d            # due date arrived/passed, nothing observed
            display_d = _next_working_day(max(D, today_d)) if pending else _next_working_day(D)
            if display_d > window_end.date():
                continue
            entries.append({
                "name":            r["key"],
                "amount":          final_amount,
                "expected_date":   display_d.isoformat(),
                "days_away":       (display_d - today_d).days,
                "account_id":      r.get("account_id"),
                "account_name":    r.get("account_name"),
                "account_bank":    _bank_label(r.get("account_bank")),
                "account_balance": r.get("account_balance"),
                "is_credit_card":  r.get("is_credit_card", False),
                "category":        r.get("category"),
                "edited":          edited,
                "rule_label":      rules.get(r["key"], {}).get("label"),
                "pending":         pending,
                "days_past_due":   (today_d - D).days if pending else 0,
                "original_date":   final_date if display_d.isoformat() != final_date else None,
            })
        # collision guard: a rolled pending occurrence must never duplicate/overtake the next cycle
        kept = []
        for i, e in enumerate(entries):
            nxt = entries[i + 1] if i + 1 < len(entries) else None
            if e["pending"] and nxt is not None and e["expected_date"] >= nxt["expected_date"]:
                continue
            kept.append(e)
        raw_bills.extend(kept)
        for e in kept:
            if not e.get("planned"):
                _bill_occ_dates.append((_date.fromisoformat(e["expected_date"]), e["amount"]))
    # ── Merge planned one-off expenses ─────────────────────────────────────────
    if uid:
        from bson import ObjectId as _ObjId

        def _try_oid_inner(v: str):
            try:
                return _ObjId(v)
            except Exception:
                return v

        planned_docs = await planned_expenses_col.find(
            {"user_id": uid, "status": "planned"}
        ).to_list(None)
        for pdoc in planned_docs:
            pdate = pdoc["date"]
            if isinstance(pdate, datetime):
                pdate_d = pdate.date()
            else:
                pdate_d = pdate
            if pdate_d > window_end.date():
                continue
            if pdate_d < today_d and (today_d - pdate_d).days > PENDING_GIVE_UP_DAYS:
                continue          # past the expiry horizon; planned.py owns the flip to "missed" — planned expenses keep their own 7-day semantic (they already surface "missed" explicitly); recurring bills now use 10 with an ask at 5
            pending = pdate_d <= today_d      # due date arrived/passed, nothing observed
            display_d = _next_working_day(max(pdate_d, today_d)) if pending else _next_working_day(pdate_d)
            if display_d > window_end.date():
                continue
            days_away = (display_d - today_d).days
            acc_name = None
            acc_bank = None
            acc_balance = None
            acc_is_credit_card = False
            acc_id = pdoc.get("account_id")
            if acc_id:
                _acct_doc = None
                for _col in (accounts_col, yapily_accounts_col):
                    # account_type/account_subtype: forward-compat projection,
                    # see acct_proj_map comment above — no current writer sets them.
                    _acct_doc = await _col.find_one(
                        {"_id": _try_oid_inner(acc_id)},
                        {"name": 1, "provider": 1, "balance": 1,
                         "type": 1, "subtype": 1, "account_type": 1, "account_subtype": 1},
                    )
                    if _acct_doc:
                        break
                if _acct_doc:
                    acc_name = _acct_doc.get("name")
                    acc_bank = _bank_label(_acct_doc.get("provider"))
                    acc_balance = float(_acct_doc["balance"]) if _acct_doc.get("balance") is not None else None
                    acc_is_credit_card = is_credit_card_account(_acct_doc)
            raw_bills.append({
                "name":            pdoc["name"],
                "amount":          float(pdoc["amount"]),
                "expected_date":   display_d.isoformat(),
                "days_away":       days_away,
                "account_id":      acc_id,
                "account_name":    acc_name,
                "account_bank":    acc_bank,
                "account_balance": acc_balance,
                "is_credit_card":  acc_is_credit_card,
                "category":        "Planned",
                "edited":          False,
                "rule_label":      None,
                "planned":         True,
                "planned_id":      str(pdoc["_id"]),
                "pending":         pending,
                "days_past_due":   (today_d - pdate_d).days if pending else 0,
                "original_date":   pdate_d.isoformat() if display_d != pdate_d else None,
            })

    upcoming_bills = sorted(raw_bills, key=lambda x: (x["days_away"], -x["amount"]))

    raw_income = []
    for r in income_patterns:
        for occ in _occurrences(r):
            occ_date_str = occ.date().isoformat()
            final_date, final_amount, edited, skipped = _apply_overrides_to_occurrence(r["key"], occ_date_str, r["avg_amount"])
            if skipped:
                continue
            final_date_obj = _date.fromisoformat(final_date)
            days_away = (final_date_obj - today.date()).days
            if final_date_obj > window_end.date():
                continue
            if final_date_obj < today.date():
                continue
            raw_income.append({
                "name":          r["key"],
                "amount":        final_amount,
                "expected_date": final_date,
                "days_away":     days_away,
                "category":      r.get("category"),
                "edited":        edited,
                "rule_label":    rules.get(r["key"], {}).get("label"),
                "account_id":      r.get("account_id"),
                "account_name":    r.get("account_name"),
                "account_bank":    _bank_label(r.get("account_bank")),
                "account_balance": r.get("account_balance"),
                "occurrences":     r.get("occurrences"),
                "amounts_recent":  r.get("amounts_recent"),
            })
    upcoming_income = sorted(raw_income, key=lambda x: x["days_away"])

    avg_daily = cached.get("avg_daily_spend", 0)
    weeks = []
    for w in range(4):
        week_start = today + timedelta(days=w * 7)
        week_end   = week_start + timedelta(days=7)
        projected_income = sum(r["avg_amount"] for r in income_patterns if week_start.date() <= _parse_date(r["next_date"]).date() < week_end.date())
        projected_bills  = sum(amt for d, amt in _bill_occ_dates if week_start.date() <= d < week_end.date())
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
        # Spendable-cash pool, parity with the Home Safe-to-Spend hero. May be
        # absent on caches computed before this field existed — the None
        # default lets consumers fall back to available_balance rather than
        # silently rendering a stale/incorrect 0.
        "spendable_balance": cached.get("spendable_balance"),
        "savings_balance":   cached.get("savings_balance", 0),
    }


_CACHE_TTL_HOURS = 6


async def _get_txn_dates_for_income_key(uid: str, key: str) -> list:
    """Fetch sorted transaction dates for a given income stream key."""
    from datetime import timedelta as _td
    cutoff = datetime.now() - _td(days=90)
    proj = {"merchant_name": 1, "description": 1, "date": 1, "transaction_type": 1}
    raw = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": "credit"}, proj
    ).to_list(None)
    raw += await yapily_transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": "credit"}, proj
    ).to_list(None)
    dates = []
    for t in raw:
        t_key = series_key(t)
        if t_key == key:
            d = t["date"]
            if isinstance(d, datetime):
                d = d.date()
            dates.append(d)
    return sorted(dates)


@router.get("/cashflow")
async def get_cashflow(user: dict = Depends(current_user)):
    uid    = user["email"]
    cached = await cashflow_cache_col.find_one({"_id": uid})

    if cached and (cached.get("patterns_version") or 0) < PATTERNS_VERSION:
        # Pre-fix (or unversioned) cache doc — e.g. bills serialised before the
        # is_credit_card flag existed, where the missing key resolves to a
        # false-but-confident False rather than "unknown". Recompute
        # synchronously so this response never serves that stale doc, even once.
        await compute_and_cache_cashflow(uid)
        cached = await cashflow_cache_col.find_one({"_id": uid}) or cached

    if cached:
        # Serve cache immediately; if stale, kick off a background refresh for next load
        computed_at = cached.get("computed_at")
        if computed_at and (datetime.now() - computed_at).total_seconds() > _CACHE_TTL_HOURS * 3600:
            asyncio.create_task(compute_and_cache_cashflow(uid))
        resp = await _build_cashflow_response(cached, uid=uid)
        data = cached
    else:
        # No cache yet — compute live, store, then return
        data = await _compute_cashflow_patterns(uid)
        data["computed_at"] = datetime.now()
        data["patterns_version"] = PATTERNS_VERSION
        await cashflow_cache_col.update_one({"_id": uid}, {"$set": data}, upsert=True)
        resp = await _build_cashflow_response(data, uid=uid)

    # Augment with payday info
    from app.services.income import get_confirmed_payday as _gcp, derive_schedule as _ds, schedule_label as _sl, next_occurrence as _no
    from app.services.pay_period import _next_payday as _calc_np
    _prefs = await preferences_col.find_one({"user_id": uid}) or {}
    _pay_cfg = _prefs.get("pay_period_config", {"type": "calendar_month"})
    _today_d = _date.today()

    _confirmed = _gcp(_prefs, _today_d)
    if _confirmed:
        resp["next_payday"] = _confirmed[0].isoformat()
        resp["payday_source"] = "confirmed"
    elif _pay_cfg.get("type", "calendar_month") != "calendar_month":
        resp["next_payday"] = _calc_np(_today_d, _pay_cfg).isoformat()
        resp["payday_source"] = "period"
    else:
        resp["next_payday"] = None
        resp["payday_source"] = None

    # income_suggestion: largest mature un-rejected unconfirmed stream
    _dismissed = set(_prefs.get("dismissed_recurring") or [])
    _stored_map = {s["key"]: s for s in (_prefs.get("income_streams") or [])}
    _income_patterns = data.get("recurring_income", [])

    _candidates = []
    for p in _income_patterns:
        k = p["key"]
        if k in _dismissed:
            continue
        st = _stored_map.get(k, {}).get("status")
        if st in ("confirmed", "rejected"):
            continue
        if int(p.get("occurrences", 0)) < 2:
            continue
        _candidates.append(p)

    if _candidates and not _confirmed:
        _primary = max(_candidates, key=lambda x: x["avg_amount"])
        _txn_dates = await _get_txn_dates_for_income_key(uid, _primary["key"])
        _sug_sched = _ds(_txn_dates) if len(_txn_dates) >= 2 else None
        resp["income_suggestion"] = {
            "key": _primary["key"],
            "avg_amount": round(_primary["avg_amount"], 2),
            "schedule_label": _sl(_sug_sched) if _sug_sched else None,
            "next_date": _primary["next_date"],
        }
    else:
        resp["income_suggestion"] = None

    return resp


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


async def compute_safe_to_spend(uid: str) -> dict:
    """Compute the safe-to-spend verdict for `uid` without touching the response cache.

    All logic lives here; the HTTP endpoint is a thin cache wrapper around this.

    Algorithm (pooled):
    1. Compute next_payday from pay_period_config / confirmed income schedule.
    2. Load cashflow cache; if absent → insufficient_data.
    3. Sum LIVE balances of spendable current accounts only.
       Exclusion rules (mirrors HomePage.tsx isSavings / isCredit heuristics):
         - subtype contains "SAVING" (case-insensitive) → savings account
         - type contains "credit" OR subtype contains "CREDIT" → credit card
         - balance < 0 → negative (credit card) — excluded
       If subtype is unavailable for an account we fall back to including all
       non-credit bank accounts so the figure is never silently zero.
    4. Walk a chronological timeline today → next_payday applying upcoming bills
       (negative) and pre-payday non-salary income (positive). Pool all accounts
       into one running balance seeded at the spendable cash sum.
    5. Track the MINIMUM running balance across the window — this is the safe floor.
    6. safe_to_spend = min_running_balance − buffer.
    7. Compute state: comfortable / tight / short.
    8. estimated = True when history is thin (n_months < 2).
    """
    from datetime import date as _date_cls, timedelta as _td
    from app.services.income import get_confirmed_payday as _gcp
    from app.services.pay_period import _next_payday as _calc_next_payday
    from app.services.pay_period import period_rhythm_label as _period_rhythm_label
    from app.services.cashflow import monthly_cashflow_cached as _monthly_cashflow
    from app.services.region import get_user_region as _get_region
    from bson import ObjectId

    # ── 1. Payday ──────────────────────────────────────────────────────────────
    _prefs    = await preferences_col.find_one({"user_id": uid}) or {}
    _pay_cfg  = _prefs.get("pay_period_config", {"type": "calendar_month"})
    _today_d  = _date_cls.today()

    _confirmed = _gcp(_prefs, _today_d)
    if _confirmed:
        next_payday = _confirmed[0]
    else:
        next_payday = _calc_next_payday(_today_d, _pay_cfg)
    days_until_payday = (next_payday - _today_d).days

    # ── 2. Cashflow cache ─────────────────────────────────────────────────────
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if not cached:
        return {"status": "insufficient_data"}

    resp = await _build_cashflow_response(cached, uid=uid)
    upcoming_bills  = resp.get("upcoming_bills", [])
    upcoming_income = resp.get("upcoming_income", [])

    # ── 3. Spendable current-account balance ───────────────────────────────────
    def _is_savings(acc: dict) -> bool:
        return "saving" in (acc.get("subtype") or "").lower()

    def _try_oid(v: str):
        try:
            return ObjectId(v)
        except Exception:
            return v

    # Fetch live accounts from both providers
    all_accs_raw = await accounts_col.find(
        {"user_id": uid}, {"balance": 1, "type": 1, "subtype": 1, "currency": 1}
    ).to_list(None)
    all_accs_raw += await yapily_accounts_col.find(
        {"user_id": uid}, {"balance": 1, "type": 1, "subtype": 1, "currency": 1}
    ).to_list(None)

    # Shared with the Planning runway (_split_balances) so the two surfaces
    # can never diverge; savings_total is unused here — the hero shows a
    # single spendable figure, not a savings breakout.
    spendable_cash, _ = _split_balances(all_accs_raw)

    card_debt_total = 0.0
    for acc in all_accs_raw:
        # GBP only
        if str(acc.get("currency", "GBP")).upper() not in {"GBP", ""}:
            continue
        if _is_savings(acc):
            continue
        bal = float(acc.get("balance") or 0)
        if bal < 0:
            # Negative-balance credit card or current account — treat as debt
            card_debt_total += abs(bal)
    card_debt = round(card_debt_total, 2)

    # ── 4. Build chronological event timeline today → next_payday ─────────────
    window_bills = [
        b for b in upcoming_bills
        if 0 <= b["days_away"] < days_until_payday
    ]
    # Pre-payday income: exclude items that look like the salary itself
    # (we identify the payday salary as income arriving ON or AFTER next_payday;
    # any income strictly before that day can legitimately boost the balance)
    window_income = [
        i for i in upcoming_income
        if 0 <= i["days_away"] < days_until_payday
    ]

    bills_total    = round(sum(b["amount"] for b in window_bills), 2)
    income_before  = round(sum(i["amount"] for i in window_income), 2)
    payday_income  = round(sum(
        i["amount"] for i in upcoming_income
        if i["days_away"] == days_until_payday
    ), 2)

    # ── 5. Walk timeline; track minimum running balance ────────────────────────
    events: list[tuple[int, float]] = []   # (days_away, delta)  — positive = income
    for b in window_bills:
        events.append((b["days_away"], -float(b["amount"])))
    for i in window_income:
        events.append((i["days_away"], float(i["amount"])))
    # Income before bills on the same day (same as at_risk_count logic)
    events.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))

    running = spendable_cash
    min_running = running
    for _days, delta in events:
        running += delta
        if running < min_running:
            min_running = running

    # ── 6. safe_to_spend = min_running − buffer ────────────────────────────────
    buffer = float(_prefs.get("safe_to_spend_buffer", 0.0))
    safe_to_spend = round(min_running - buffer, 2)

    # ── 6b. Commitments reserve ───────────────────────────────────────────────
    # Per-period slices promised to named future expenses come out BEFORE the
    # state/verdict is derived, so Safe-to-Spend never shows money that is
    # already spoken for. Failure-tolerant: any error → zero reserve.
    commitments_reserved = 0
    commitments_count = 0
    try:
        from app.routers.commitments import total_reserved_slices
        commitments_reserved, commitments_count = await total_reserved_slices(uid)
        if commitments_reserved:
            safe_to_spend = round(safe_to_spend - commitments_reserved, 2)
    except Exception:
        logger.exception("commitments reserve failed for %s — using zero", uid)
        commitments_reserved, commitments_count = 0, 0

    # ── 7. State: comfortable / tight / short ─────────────────────────────────
    # "tight" threshold: below £100 or below ~10% of monthly discretionary spend,
    # whichever is higher — calibrated to be meaningful but not alarmist.
    _region = await _get_region(uid)
    from datetime import datetime as _dt
    _cutoff = _dt.now() - _td(days=90)
    _cf = await _monthly_cashflow(uid, _region, _cutoff)
    monthly_spend = _cf.get("spending", 0.0)
    tight_threshold = max(100.0, monthly_spend * 0.10)

    if safe_to_spend <= 0:
        state = "short"
    elif safe_to_spend < tight_threshold:
        state = "tight"
    else:
        state = "comfortable"

    # ── 8. estimated flag ────────────────────────────────────────────────────
    estimated = _cf.get("n_months", 3) < 2

    _sync_ts = await last_bank_sync(uid)

    return {
        "status":              "ok",
        "safe_to_spend":       safe_to_spend,
        "next_payday":         next_payday.isoformat(),
        "days_until_payday":   days_until_payday,
        "bills_total":         bills_total,
        "income_before_payday": income_before,
        "buffer":              buffer,
        "state":               state,
        "estimated":           estimated,
        "spendable_now":       round(spendable_cash, 2),
        "payday_income":       payday_income,
        "card_debt":           card_debt,
        "commitments_reserved": int(commitments_reserved),
        "commitments_count":   commitments_count,
        "commitments_reserved_period_label": (
            _period_rhythm_label(_pay_cfg) if commitments_reserved else None
        ),
        "last_synced":         _sync_ts.isoformat() if _sync_ts else None,
    }


@router.get("/safe-to-spend")
async def get_safe_to_spend(include: str = "", user: dict = Depends(current_user)):
    """Headline verdict + pace reading. `?include=series` adds the per-day pace series."""
    uid = user["email"]
    want_series = "series" in {p.strip() for p in include.split(",")}
    cache_name = "safe_to_spend_series" if want_series else "safe_to_spend"

    # ── 0. Short-TTL response cache (90 s; invalidated on sync/recompute) ─────
    _cached_resp = response_cache.get(cache_name, uid)
    if _cached_resp is not None:
        return _cached_resp

    result = await compute_safe_to_spend(uid)
    if result.get("status") == "ok":
        try:
            from app.services.pace import compute_pace
            result = {**result, "pace": await compute_pace(uid, include_series=want_series, sts=result)}
        except Exception:
            logger.exception("pace computation failed for %s", uid)
        response_cache.put(cache_name, uid, result)
    return result


@router.get("/pace/detail")
async def get_pace_detail(offset: int = 0, user: dict = Depends(current_user)):
    """Full category-trends payload for the Trends page.

    offset: 0 = current pay period (default), -1 = previous period, etc.
    Clamped to [-60, 0].  Response is cached per-offset; invalidating the
    user's cache (e.g. on new transactions) clears all offsets.
    """
    uid = user["email"]
    off = max(-60, min(0, int(offset)))
    cache_name = f"pace_detail:{off}"
    cached = response_cache.get(cache_name, uid)
    if cached is not None:
        return cached
    from app.services.pace import compute_pace_detail
    result = await compute_pace_detail(uid, offset=off)
    if result.get("status") == "ok":
        response_cache.put(cache_name, uid, result)
    return result


@router.get("/spend/category-signals")
async def get_category_signals(offset: int = 0, user: dict = Depends(current_user)):
    """Total-basis per-category readings for the Spend page tiles (× your usual + the Door).

    Returns per-category multiples and Door fields computed on TOTAL spend —
    the same basis as the Spend page's category tiles. offset: 0 = current
    period (default), negative = closed prior periods. Clamped to [-60, 0].
    """
    uid = user["email"]
    off = max(-60, min(0, int(offset)))
    cache_name = f"category_signals:{off}"
    cached = response_cache.get(cache_name, uid)
    if cached is not None:
        return cached
    from app.services.pace import compute_category_signals
    result = await compute_category_signals(uid, offset=off)
    response_cache.put(cache_name, uid, result)
    return result


async def _flagged_miscategorised(uid: str) -> list:
    """Shared guardrail query: debit rows that look like own-account transfers
    (matched via user_identity/is_own_transfer) but sit in a spend category
    rather than a money-to-self category. Excludes rows/series already
    dismissed. Returns flat list of annotated txn docs (adds _series_key and
    _effective_category)."""
    identity = await user_identity(uid)
    # is_own_transfer treats "no identity data at all" as own (legacy default),
    # which would flag every spend row here. Guard: no identity → no guardrail.
    if not identity.get("name_tokens") and not identity.get("own_ids"):
        return []

    # Built from this user's actual kind map (built-ins + custom), not a
    # literal name set — a custom category the user declared `movement`
    # (e.g. "House Fund") must be excluded here exactly like Transfer/Savings
    # are, or the guardrail nags the user to recategorise money they already
    # told the app is a transfer.
    kind_map = await get_category_kinds(uid)  # ONE read per request
    money_to_self = [name for name in kind_map if is_non_spend(kind_map, name)]

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    dismissed = set(prefs.get("dismissed_miscategorised") or [])
    dismissed_series = set(prefs.get("dismissed_miscategorised_series") or [])

    txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": "debit",
         "$or": [
             # auto-categorised into a spend category
             {"custom_category": None, "category": {"$nin": money_to_self}},
             # manually overridden into a spend category — guide the user back
             {"custom_category": {"$nin": [None, *money_to_self]}},
         ]},
        {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
         "currency": 1, "category": 1, "custom_category": 1, "transaction_type": 1,
         "account_id": 1},
    ).to_list(None)

    kept = []
    for t in txns:
        tid = str(t["_id"])
        if tid in dismissed:
            continue
        sk = series_key(t)
        if sk in dismissed_series:
            continue
        text = f"{t.get('merchant_name') or ''} {t.get('description') or ''}"
        if is_own_transfer(text, identity, own_account_id=t.get("account_id")):
            t["_series_key"] = sk
            t["_effective_category"] = t.get("custom_category") or t.get("category")
            kept.append(t)

    return kept


def _group_miscategorised(txns: list) -> list:
    """Group flagged transactions by recurrence series (_series_key). Each
    group's representative is its most recent member."""
    groups: dict = defaultdict(list)
    for t in txns:
        groups[t["_series_key"]].append(t)

    result = []
    for sk, members in groups.items():
        members.sort(key=lambda x: (x.get("date") is not None, x.get("date")), reverse=True)
        rep = members[0]
        member_dates = [m["date"] for m in members if m.get("date")]
        first_date = min(member_dates) if member_dates else None
        amounts = [m.get("amount") for m in members if m.get("amount") is not None]

        def _iso(d):
            return d.isoformat() if hasattr(d, "isoformat") else d

        result.append({
            "id": str(rep["_id"]),
            "ids": [str(m["_id"]) for m in members],
            "count": len(members),
            "series_key": sk,
            "merchant_name": rep.get("merchant_name"),
            "description": rep.get("description"),
            "amount": rep.get("amount"),
            "amount_min": min(amounts) if amounts else None,
            "amount_max": max(amounts) if amounts else None,
            "date": _iso(rep.get("date")),
            "first_date": _iso(first_date) if first_date is not None else None,
            "currency": rep.get("currency"),
            "category": rep.get("_effective_category"),
            "transaction_type": rep.get("transaction_type"),
        })

    result.sort(key=lambda g: g.get("date") or "", reverse=True)
    return result


@router.get("/transactions/miscategorised-count")
async def get_miscategorised_count(user: dict = Depends(current_user)):
    """Read-only guardrail: how many recurring-transfer SERIES look like
    own-account transfers (matched via user_identity/is_own_transfer) but are
    sitting in a spend category rather than one of the money-to-self
    categories. Diagnostic only — does not write anything."""
    uid = user["email"]
    cache_name = "miscategorised_count"
    cached = response_cache.get(cache_name, uid)
    if cached is not None:
        return cached

    groups = _group_miscategorised(await _flagged_miscategorised(uid))
    result = {"count": len(groups), "ids": [g["id"] for g in groups][:50]}
    response_cache.put(cache_name, uid, result)
    return result


@router.get("/transactions/miscategorised")
async def get_miscategorised_transactions(user: dict = Depends(current_user)):
    """Grouped rows behind the miscategorised-transfers guardrail, for the
    'review miscategorised transfers' sheet. Recurring transfers (same payee,
    different dates) collapse to one series entry; dismissing a series hides
    all its members, past and future."""
    uid = user["email"]
    cache_name = "miscategorised_list"
    cached = response_cache.get(cache_name, uid)
    if cached is not None:
        return cached

    items = _group_miscategorised(await _flagged_miscategorised(uid))[:50]
    result = {"items": items}
    response_cache.put(cache_name, uid, result)
    return result


@router.post("/transactions/{txn_id}/dismiss-miscategorised")
async def dismiss_miscategorised(txn_id: str, user: dict = Depends(current_user)):
    """Dismiss a single miscategorised-transfer row from the review sheet.
    Does not change the transaction's category — only hides it from the
    guardrail count/list going forward."""
    uid = user["email"]
    await preferences_col.update_one(
        {"user_id": uid},
        {"$addToSet": {"dismissed_miscategorised": txn_id}, "$set": {"user_id": uid}},
        upsert=True,
    )
    response_cache.invalidate(uid, "miscategorised_count")
    response_cache.invalidate(uid, "miscategorised_list")
    return {"ok": True}


@router.post("/transactions/dismiss-miscategorised-series")
async def dismiss_miscategorised_series(body: dict, user: dict = Depends(current_user)):
    """Dismiss an entire recurring-transfer series from the review sheet —
    covers all past members and future months with the same series key.
    Does not change any transaction's category."""
    uid = user["email"]
    series = body.get("series_key")
    if not series:
        raise HTTPException(400, "Provide 'series_key'")
    await preferences_col.update_one(
        {"user_id": uid},
        {"$addToSet": {"dismissed_miscategorised_series": series}, "$set": {"user_id": uid}},
        upsert=True,
    )
    response_cache.invalidate(uid, "miscategorised_count")
    response_cache.invalidate(uid, "miscategorised_list")
    return {"ok": True}


@router.get("/value-delivered")
async def get_value_delivered(user: dict = Depends(current_user)):
    """Return how much monthly saving the user has unlocked by acting on insights."""
    uid = user["email"]
    docs = await savings_insights_col.find(
        {"user_id": uid},
        {"savings_estimate": 1, "title": 1, "user_context": 1,
         "verified_savings": 1, "verified_merchant": 1},
    ).to_list(None)

    # Same house-style backstop as the main /savings-insights serializer
    # (_serialize_insight in savings_insights.py) — this endpoint also
    # surfaces raw stored title/savings_estimate text to the client, so it
    # needs the same em/en-dash scrub for docs written before that guardrail
    # existed.
    from app.routers.savings_insights import _house_style

    verified_monthly = 0.0
    total_monthly = 0.0
    breakdown = []
    engaged = 0
    for doc in docs:
        if doc.get("verified_savings"):
            verified_monthly += float(doc["verified_savings"])
            breakdown.append({
                "title":          _house_style(f"Stopped paying {doc.get('verified_merchant', '')}".strip()),
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
                "title":          _house_style(doc.get("title", "Insight")),
                "monthly_saving": monthly,
                "estimate_label": _house_style(doc.get("savings_estimate") or "") or None,
            })

    return {
        "insights_acted_on":       engaged,
        "total_monthly_saving":    round(total_monthly, 2),
        "verified_monthly_saving": round(verified_monthly, 2),
        "breakdown":               breakdown,
    }
