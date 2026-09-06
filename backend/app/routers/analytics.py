"""KPI, insights, and budget pace-profile endpoints."""
import asyncio
import json
import logging
import re
from calendar import monthrange
from collections import defaultdict, Counter
from datetime import datetime, timedelta
from datetime import date as _date
from typing import List

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.llm import openrouter_chat
from app.core.models import KPIResponse, Insight
from app.db.collections import (
    accounts_col, transactions_col, yapily_accounts_col, yapily_transactions_col,
    yapily_consents_col,
    statement_accounts_col, investment_accounts_col, mono_accounts_col, mpesa_accounts_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
    preferences_col, savings_insights_col, cashflow_cache_col, upcoming_overrides_col,
    upcoming_rules_col, planned_expenses_col, investment_notes_col,
    confirmed_transfer_pairs_col, pending_transactions_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.pay_period import get_pay_period_for_date, prev_pay_period
from app.services import response_cache
from app.services.sync_freshness import last_bank_sync
from app.services.categorisation import (
    series_key, has_date_fragment, own_transfer_evidence, user_identity,
    canonical_merchant_key, refine_transfer_target, _byte_desc_key,
    _CHANNEL_CODES,
)
from app.services.card_rates import is_credit_card_account
from app.services.categories import get_category_kinds, is_non_spend, is_spend, kind_of, CategoryKinds, BUILTIN_CATEGORY_KINDS, MOVEMENT, COMMITMENT
from app.services.recurring_judge import gate_failure_reason, judge_suspect_series, apply_verdicts
from app.services.bnpl import is_bnpl_txn, build_bnpl_projections
from app.services.pending_transactions import PENDING_TXN_MAX_AGE_DAYS

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
# stale and force a recompute rather than trust that default. v4 changed the
# monthly recurring-bill projection anchor in `_detect_recurring` from the day
# the last payment happened to post to a derived nominal due day — pre-v4 docs
# carry `expected_date`/`days_away` on every monthly bill that are wrong by
# however far that last posting drifted from its true due day (weekends,
# month-end shifts), so they must not be served as-is either. v5 (a) taught
# `_monthly_anchor` to recognise weekday-anchored monthly cadences ("last
# Friday", "first Monday") instead of misreading their scattered
# day-of-month as a fixed-day bill, carrying the anchor descriptor through
# on every pattern as `monthly_anchor` so `_occurrences` can re-derive later
# occurrences correctly too; (b) stopped excluding Transfer-category debits
# from recurring-outflow detection, so a standing order into your own
# savings (which still consumes current-account balance) can appear in
# `upcoming_bills` for the first time; and (c) added a `kind` field
# (discretionary/commitment/movement) to every `upcoming_bills` entry. All
# three change which entries appear, what dates they carry, or what fields
# they have — pre-v5 docs have none of this and must not be served as-is.
# v6 widened the evidence window that debit-side recurring detection and
# own-transfer destination learning read from 90 to 180 days, so a monthly
# series keeps 5-6 occurrences in view instead of teetering on 3-4 and
# flipping between detected/undetected or between payday-anchored and
# naive-interval prediction as the calendar rolls forward one day at a time.
# Bill series now carry a staleness cutoff (last real occurrence must be
# recent relative to the series' own cadence) so a genuinely-stopped series
# stops projecting a fresh next_date forever, and a bill's projected amount
# now tracks its most recent occurrences instead of averaging across the
# whole window, so a mid-window price change no longer drags the projection
# away from the current price. Pre-v6 docs may show a wrong next_date, a
# wrong avg_amount, or be missing a bill entirely — they must not be served
# as-is either.
# v7 added the recurring-judge LLM scrutiny pass (app/services/
# recurring_judge.py): a trusted-category series that was only accepted
# because its category is trusted, and would have FAILED the generic
# interval/amount-stability gate on its own evidence, is now sent to an LLM
# for a second opinion before it's allowed to project (real case: HSBC
# "COMP BAL XFR" balance transfers, wildly irregular amounts and gaps,
# waved through on Transfer being trusted). A vetoed series no longer
# appears in `recurring_spend`/`upcoming_bills` at all, and the doc now
# also carries `engine_vetoed_recurring`. Pre-v7 docs were computed without
# this pass and may still contain a phantom bill it would have caught.
# v8 taught destination-learning to link a recurring Debt/card-repayment
# series to the credit-card account its payments land on
# (`_learn_card_repayment_destinations` — every one of the six card
# repayments on real data carried `dest_account_id: null` before this,
# because the general `_learn_transfer_destinations` channel deliberately
# EXCLUDES credit-card destinations, see its docstring), and uses that link
# to cap a projected repayment at the card's own outstanding debt, suppress
# it entirely once the card is in credit, and — for a card whose payment
# history classifies as a confident full-statement payer, see
# `_card_repayment_projection` — replace the trailing-mean projection with
# an estimate of spend since the last observed payment. Pre-v8 docs carry
# neither the card link nor the adjusted amount/`amount_basis` fields.
# v9 (2026-08-29) added `bnpl_commitments`: BNPL (Klarna/Clearpay/PayPal
# Pay-in-3/...) plans reconstructed from debits that `_detect_recurring` now
# unconditionally excludes from its generic bucket-build (see
# app/services/bnpl.py — a BNPL instalment's embedded purchase date used to
# read as a statement date fragment, collapsing every plan into one bucket
# and letting the 30%-tolerance amount clustering braid instalments from
# different purchases into a phantom series). Pre-v9 docs carry no
# `bnpl_commitments` key at all; `_build_cashflow_response` treats that as
# "nothing to project" rather than misreading absence as an empty list of a
# newer shape.
PATTERNS_VERSION = 9

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


# "/budget/pace-profile" removed 2026-08-30 (owner decision, option C) — its
# only caller was frontend/app/budget/BudgetPage.tsx's spend-pacing curve,
# deleted along with the rest of the zombie /budget page. It never read
# budgets_col itself (pure transaction-derived pace curves), so nothing was
# wiped here; it was removed only because its one consumer is gone and an
# authenticated endpoint with zero callers is a dead API surface.


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
            r = await openrouter_chat(
                {"model": "anthropic/claude-haiku-4-5", "max_tokens": 400,
                 "messages": [{"role": "user", "content": prompt}]},
                user_id=user_id, pipeline="money_shape", client=client,
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


# "Transfer" belongs here alongside the other bill-like categories, not as a
# late add-on: `debits` above is deliberately built WITHOUT a category filter
# (see the comment there) specifically so a standing order to the user's own
# savings/another own account counts as a bill that consumes balance. But
# leaving "Transfer" out of the TRUSTED set meant that inclusion was hollow —
# a genuinely monthly own-transfer still needed 3 occurrences in the 90-day
# window to be believed, same bar as an unproven merchant. That bit Kevin for
# real on 2026-08-27: five monthly standing orders (HSBC/Monzo/NatWest
# Main/Revolut/Chase, £1,758/£1,106/£910/£20/£50) had exactly 3 occurrences
# on 2026-08-26 (Apr 24 aged out already, May 29/Jun 26/Jul 31 in view) and
# vanished from the projection on 2026-08-27 the instant the May 29 midnight
# occurrence aged past the 90-day cutoff overnight, dropping them to 2 —
# ONE DAY before their real Aug 28 payday occurrence. Two same-account,
# same-day-window sibling series (Rainy Day Saver, Foris/Freetrade) survived
# the exact same overnight cliff untouched only because "Savings" and
# "Investment" were already trusted at 2 occurrences; "Transfer" was the one
# category that fell through. Verified empirically (see the reversal-netting
# check first — it was NOT the cause; all 5 series had zero same-account
# candidate credits within 5 days at any point).
DEFAULT_RECURRING_CATEGORIES = ["Bills", "Savings", "Investment", "Subscriptions", "Health", "Software", "Debt", "Transfer"]


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


# A weekend/bank-holiday-shifted direct debit posts LATE, never early, and UK
# bank holidays cluster tightly enough (e.g. Christmas Day + substitute
# Boxing Day) to push a posting up to ~4 calendar days past its due date.
# Genuine provider-initiated date changes (e.g. "moved from the 1st to the
# 15th") jump much further than that, so this tolerance is what separates
# "same bill, noisy posting" from "the bill's due date actually changed".
_MONTHLY_DRIFT_TOLERANCE_DAYS = 4

# Sentinel meaning "anchored to the last calendar day of the month" rather
# than a fixed day-of-month. Kept distinct from an int day because a bill
# genuinely due on "month end" must track 28/29/30/31 as the month's length
# changes, which no single day-of-month number can express.
_MONTHLY_ANCHOR_EOM = None

# Sentinel meaning "this cached pattern predates weekday-anchor support and
# carries no `monthly_anchor` descriptor at all" — distinct from a *present*
# key whose value is `None` (which legitimately means EOM). Used only by the
# `_occurrences` legacy fallback below; PATTERNS_VERSION invalidation means
# a live doc should never actually hit it, but stepping must not silently
# misread "key absent" as "key present and EOM" if it ever does.
_NO_MONTHLY_ANCHOR = object()


def _nth_weekday_of_month(year: int, month: int, weekday: int, nth: int):
    """The date of the `nth` (1-4, counted from the start) or last (`nth ==
    -1`) occurrence of `weekday` (Monday=0..Sunday=6) in `year`/`month`.

    If a stored `nth` (1-4) doesn't exist in this particular month (e.g. a
    "5th Friday" reading from a month that happened to have five, applied to
    a shorter following month), falls back to the LAST occurrence rather
    than raise or silently roll into the wrong week — the last occurrence is
    always the closest honest reading of "the same relative week" available.
    """
    month_len = monthrange(year, month)[1]
    if nth == -1:
        d = _date(year, month, month_len)
        offset = (d.weekday() - weekday) % 7
        return d - timedelta(days=offset)
    first = _date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    day = 1 + offset + (nth - 1) * 7
    if day > month_len:
        return _nth_weekday_of_month(year, month, weekday, -1)
    return _date(year, month, day)


def _monthly_anchor(dates: list):
    """Derive the NOMINAL due anchor for a monthly-cadence series, as
    distinct from the day any individual payment happened to POST on.

    `_detect_recurring` used to anchor the next projection on
    `last_date.day` — the day the most recent payment posted — which is
    wrong on two counts: a weekend/bank-holiday delay pushes that posting
    day later and the offset then ratchets forward forever, and a bill due
    on the 29th/30th/31st gets clamped down whenever it lands in a shorter
    month (e.g. February) and never climbs back once longer months return.
    Both bugs share one cause: the code had no notion of "the day this bill
    is actually due" independent of any single observed posting.

    Returns one of three shapes:
      - `int` (1-31)                    — a fixed nominal day-of-month.
      - `None`                          — anchored to the month's LAST
        CALENDAR DAY (EOM), tracking 28/29/30/31 as month length changes.
      - `{"weekday": int, "nth": int}`  — anchored to the nth (1-4, from the
        start) or last (`nth == -1`) occurrence of `weekday` in the month —
        e.g. `{"weekday": 4, "nth": -1}` is "the last Friday of the month".
        Some genuinely monthly bills (standing orders set to "last Friday",
        "first Monday", etc.) have NO stable day-of-month at all — their day
        genuinely scatters (24/26/29/31 for a last-Friday bill) — so a
        day-of-month reading of them is not a degraded version of the truth,
        it is a different and wrong claim.

    Derivation, in priority order:

    1. WEEKDAY check (tried first — see the over-correction note below for
       why). If every occurrence in the series (>= 3 of them, and at least
       one NOT on its own month's exact last day — see step 2 for why that
       exclusion matters) falls on the same weekday, and either ALL are the
       LAST occurrence of that weekday in their month, or ALL are the SAME
       nth occurrence from the start, that shared (weekday, nth) is the
       anchor. Real calendar months differ in length by 0-3 days, so a
       fixed-day-of-month bill sharing the same weekday across 3 real
       months in a row by coincidence is roughly a 1-in-49 fluke — this is
       strong, not weak, evidence once it holds for 3+ points.

       Over-correction guard: this is checked BEFORE day-of-month
       clustering specifically because the old clustering heuristic reads
       weekday noise as false day-of-month precision (it read 26/29/31 —
       genuinely three different last-Fridays — as a day-26 bill, because
       26 and 29 happen to fall inside its drift tolerance). Checking
       weekday first lets a real weekday-anchored series be read on its own
       terms instead of being forced into a day-of-month cluster that only
       coincidentally fits 2 of its 3-4 points.

       The `informative` (non-EOM) requirement guards the reverse
       over-correction: a bill that happens to land on its own month's
       exact last day every single time it's been observed (e.g. Jan 31,
       Feb 28) is trivially "the last occurrence of its weekday" in EVERY
       case, for ANY weekday — that's not evidence of weekday-anchoring,
       it's just what "last day of the month" always looks like. Requiring
       at least one occurrence that ISN'T its month's exact last day rules
       that degenerate case out and leaves it to the EOM path below, which
       already reads it correctly.

    2. An occurrence that posted on its OWN month's last day is ambiguous —
       it could be a genuinely EOM-anchored bill, or a fixed-day bill (say,
       due the 31st) that would have clamped there anyway. Those two read
       identically no matter which month they land in (clamping "day 31"
       into a short month always produces that month's last day too), so
       there's nothing to resolve for that occurrence in isolation; it's
       simply set aside as uninformative. If every occurrence is
       uninformative, the series is treated as EOM-anchored.
    3. Otherwise (no weekday match, and not all-EOM), walk the informative
       occurrences newest-first, chaining each one onto a running cluster
       while it stays within `_MONTHLY_DRIFT_TOLERANCE_DAYS` of the
       cluster's minimum day so far. The chain breaks the moment a gap is
       too large to be posting drift — which is exactly a genuine permanent
       date change — so the trailing cluster naturally captures "the new
       day, once it's stuck for a few cycles" while older, disconnected
       history stops contributing. Within the trailing cluster the MINIMUM
       day is the anchor: drift only ever pushes a posting later than its
       due date, never earlier, so the smallest observed day in a cluster
       is the least-distorted reading of the true due day. This same
       fallback also serves as the honest degrade when a series has no
       stable anchor of EITHER kind: rather than invent a new "unknown"
       output the projection layer can't render as a date anyway, it keeps
       reading the best day-of-month evidence available — exactly as
       before weekday-anchor support existed — since that's still a more
       grounded guess than either extreme (this month's raw posting day, or
       a confident weekday claim the data doesn't actually support).
    """
    dates = sorted(dates)
    informative = [
        d for d in dates if d.day != monthrange(d.year, d.month)[1]
    ]

    if informative and len(dates) >= 3 and len({d.weekday() for d in dates}) == 1:
        wd = dates[0].weekday()
        if all((d.day + 7) > monthrange(d.year, d.month)[1] for d in dates):
            return {"weekday": wd, "nth": -1}
        nths = {(d.day - 1) // 7 + 1 for d in dates}
        if len(nths) == 1:
            return {"weekday": wd, "nth": next(iter(nths))}

    if not informative:
        return _MONTHLY_ANCHOR_EOM

    informative = sorted(informative)
    cluster_min = informative[-1].day
    for d in reversed(informative[:-1]):
        if abs(d.day - cluster_min) > _MONTHLY_DRIFT_TOLERANCE_DAYS:
            break
        cluster_min = min(cluster_min, d.day)
    return cluster_min


def _advance_month_to_anchor(d, anchor):
    """Move to the following calendar month, landing on `anchor`:

      - `int`                          — that day-of-month, clamped to the
        target month's own length.
      - `None`                         — that month's last calendar day.
      - `{"weekday": int, "nth": int}` — the nth/last occurrence of that
        weekday in the target month (see `_nth_weekday_of_month`).

    Only `d`'s year/month are used; `d.day` is deliberately ignored so a
    clamped or drift-shifted day never gets carried forward as the new
    basis for the month after — each step re-derives the day fresh from the
    fixed anchor, which is what stops the month-end clamp from being sticky.
    """
    year = d.year + (1 if d.month == 12 else 0)
    month = 1 if d.month == 12 else d.month + 1
    if isinstance(anchor, dict):
        return _nth_weekday_of_month(year, month, anchor["weekday"], anchor["nth"])
    month_len = monthrange(year, month)[1]
    day = month_len if anchor is _MONTHLY_ANCHOR_EOM else min(anchor, month_len)
    return d.replace(year=year, month=month, day=day)


def _detect_recurring(txns: list, min_occurrences: int = 2, trusted_categories: set | None = None, today: _date | None = None, is_income: bool = False, pay_period_config: dict | None = None, confirmed_income: dict | None = None, reversal_credits: list | None = None) -> list[dict]:
    """Group transactions by merchant key and detect those with a regular interval (7–35 days)."""
    # BNPL guard (unconditional): a Klarna/Clearpay/PayPal-Pay-in-3/etc.
    # instalment descriptor defeats `series_key` exactly the way a
    # date-stamped statement line is SUPPOSED to collapse (see
    # app/services/bnpl.py's module docstring) — its embedded purchase date
    # reads as a date fragment, so every plan from every purchase collapses
    # into one bucket, and `_amount_clusters`'s 30% tolerance then braids
    # instalments from DIFFERENT purchases into fake series. BNPL debits are
    # excluded from the generic bucket-build entirely, unconditionally, on
    # every caller of this function, so that braiding can never fire here —
    # BNPL plans are contractual schedules with a known instalment count,
    # not a cadence to detect, and get their own reconstruction in
    # `_compute_cashflow_patterns` (see `build_bnpl_projections`). This is
    # also what keeps BNPL series out of `recurring_judge` entirely: the
    # judge only ever sees this function's output.
    if not is_income:
        txns = [t for t in txns if not is_bnpl_txn(t)]
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
    for key, all_items in series:
        if len(all_items) < min_occurrences:
            continue

        # Try the full occurrence set first; if it fails an acceptance gate
        # below, retry on the trailing subset with the OLDEST occurrence
        # dropped, repeating down to min_occurrences. WHY (2026-08-27): with
        # the debit-detection window now 180 days wide (see
        # `_compute_cashflow_patterns`), an old transaction that merely
        # shares a merchant key with a genuinely-recurring series -- a
        # one-off purchase, a different card product under the same
        # statement text -- can drag the whole-window mean interval, or the
        # tolerance check below, outside the acceptance gate even though the
        # RECENT occurrences are cleanly regular. Real case: Kevin's
        # "PLAYSTATION LONDON" reads as an 80-day gap from an unrelated
        # March purchase into its actual clean monthly run from June
        # onward -- on the full 4-point set that drags avg_interval to 47
        # (over the 35-day ceiling) and silently delists a subscription
        # that is still charging monthly today. Retrying on the trailing
        # subset recovers exactly what the OLD 90-day window already saw
        # for a series like this (the stale outlier was never inside a
        # 90-day load in the first place), so this only ever rescues a
        # series the previous window's narrower load already trusted; it
        # is a no-op for the overwhelming majority, whose full point set
        # already passes on the first try.
        items = sorted(all_items, key=lambda t: t["date"])
        gate = None
        while len(items) >= min_occurrences:
            dates = sorted(t["date"] for t in items)
            intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
            avg_interval = sum(intervals) / len(intervals)
            if avg_interval < 6 or avg_interval > 35:
                items = items[1:]
                continue

            # A two-occurrence series with sub-monthly spacing is exactly the
            # signature of a bounced direct debit + its retry (or an ingestion
            # duplicate) — reject before either acceptance tier (trusted-category
            # or generic) can wave it through as a weekly/biweekly pattern.
            # Genuine weekly/biweekly cadences must prove themselves with >= 3
            # occurrences; a genuine monthly 2-occurrence trusted series (interval
            # >= 21) is unaffected.
            if len(items) == 2 and avg_interval < 21:
                items = items[1:]
                continue

            # Majority category for the bucket — carried through so the UI can
            # show the real category icon instead of a generic dot.
            cats = [(t.get("custom_category") or t.get("category") or "Other") for t in items]
            bucket_cat = max(set(cats), key=cats.count)

            # Two-tier evidence: bill-like categories are trusted at 2 occurrences;
            # everything else must prove a cadence — 3+ hits, regular intervals,
            # stable amounts. (trusted_categories=None disables tiers, e.g. income.)
            # `gate_failure_reason` is the ONE copy of these thresholds — shared
            # with app/services/recurring_judge.py's suspect-selection so the two
            # can never drift into different bars (see that module's docstring).
            is_trusted_tier = trusted_categories is not None and bucket_cat in trusted_categories
            if trusted_categories is not None and not is_trusted_tier:
                if gate_failure_reason(items, intervals, avg_interval):
                    items = items[1:]
                    continue
                trusted_bypass_reason = None
            elif is_trusted_tier:
                # Accepted on category trust alone — record whether it would
                # ALSO have cleared the generic gate on its own evidence. A
                # non-None reason here is exactly what makes a series SUSPECT
                # (see recurring_judge.is_suspect): trusted enough to detect,
                # not proven enough to skip a second, LLM opinion.
                trusted_bypass_reason = gate_failure_reason(items, intervals, avg_interval)
            else:
                trusted_bypass_reason = None  # trusted_categories=None (income): tiers disabled

            gate = (items, dates, intervals, avg_interval, bucket_cat, trusted_bypass_reason)
            break
        if gate is None:
            continue
        items, dates, intervals, avg_interval, bucket_cat, trusted_bypass_reason = gate

        # Normalise to date objects — MongoDB stores dates as datetime, which
        # breaks comparisons against _today (a date) and .replace() calls below.
        _d2date = lambda d: d.date() if isinstance(d, datetime) else d
        last_date  = _d2date(dates[-1])
        _today = today or _date.today()

        # A genuinely-stopped series (e.g. a cancelled gym membership last
        # paid four months ago) would otherwise keep getting a fresh
        # next_date projected forward forever now that the debit window is
        # 180 days wide, because the occurrences that prove it once existed
        # are still inside the load even though the real-world activity
        # ended months ago. This is a different mechanism from
        # PENDING_GIVE_UP_DAYS: that machinery only retires a single late
        # OCCURRENCE inside the forward-looking window once nothing gets
        # observed for it (see `_occurrences`'s include_past_due check and
        # the give-up line in `_build_cashflow_response`); it never stops
        # THIS function from generating a brand-new future next_date for a
        # series whose most recent real occurrence is long gone. The guard
        # below only lets a series keep projecting when its most recent
        # occurrence is recent relative to its own cadence: two cycles, or
        # 45 days, whichever is larger. The 45-day floor gives a monthly
        # bill enough grace that one late or skipped cycle isn't misread as
        # "stopped". Income is exempt because its window stays 90 days, so a
        # dead income stream simply has no occurrences left in view to ever
        # reach this function.
        if not is_income and (_today - last_date).days > max(2 * avg_interval, 45):
            continue

        # Amounts of the most recent (up to) 3 occurrences. Used below to
        # keep a bill's projected amount tracking what it costs now rather
        # than a full-window average (cadence and anchor still benefit from
        # every point the wider 180-day window provides, but a price change
        # partway through that window shouldn't drag the projected amount
        # away from the current price), and also by income_credit_ok to
        # judge whether a prediction is stable enough for per-account
        # planning arithmetic.
        amounts_recent = [
            round(abs(float(_t.get("amount", 0))), 2)
            for _t in sorted(items, key=lambda t: t["date"])[-3:]
        ]
        # Income keeps the full-window mean (its window stays 90 days, at
        # most 3-4 points, deliberately unperturbed by this change). Bills
        # use the recent-occurrence mean instead; this is a no-op for any
        # series with 3 or fewer occurrences (amounts_recent is just all of
        # them) and only changes behaviour for series with 4+ occurrences.
        avg_amount = (
            sum(abs(float(t.get("amount", 0))) for t in items) / len(items)
            if is_income
            else sum(amounts_recent) / len(amounts_recent)
        )
        _grace = timedelta(days=0 if is_income else PENDING_GIVE_UP_DAYS)
        _config = pay_period_config or {"type": "calendar_month"}

        # Monthly-cadence anchor descriptor (int day / None=EOM / weekday
        # dict — see `_monthly_anchor`), carried through to the serialised
        # pattern so `_occurrences` can re-derive later occurrences inside
        # the same window without falling back to naive day-carry-forward
        # stepping. Stays None for every non-monthly cadence — harmless,
        # since only the monthly branch of `_occurrences` ever reads it.
        monthly_anchor_desc = None

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
            elif 26 <= avg_interval <= 35:
                # Monthly — anchor to day-of-month (existing logic).
                #
                # Upper bound raised from 33 to 35 on 2026-08-27. A weekday-
                # anchored monthly bill (e.g. "last Friday of the month",
                # see `_monthly_anchor`) genuinely spans up to 35 calendar
                # days between consecutive occurrences, not just the
                # ~28-31 days a fixed-day-of-month bill sees. With 3+
                # occurrences in view that variance averages out comfortably
                # inside the old 26-33 band (Kevin's own last-Friday STOs
                # averaged 31.5 over Jun/Jul), but the day BEFORE a payday,
                # the 90-day window can hold only the newest 2 occurrences,
                # and 2 points give a single raw interval with nothing to
                # average against — for these series that single interval is
                # exactly 35, one day outside the old band. Missing this
                # branch didn't just blur the projected date, it pushed the
                # mirrored internal-inflow credit (see `internal_inflows`)
                # a further week out than the naive `else` branch below
                # would predict, past the at-risk walk's payday-window
                # cutoff, so HSBC/NatWest/Monzo read as short again even
                # after the trusted-category fix restored detection. 35 is
                # not an arbitrary widening: it already IS this function's
                # own outer acceptance ceiling (see the `avg_interval > 35`
                # rejection above), so nothing that reaches this branch was
                # ever excluded from being "monthly" in the first place,
                # it was just being routed to the dumber fallback below.
                if is_income and _config.get("type", "calendar_month") != "calendar_month":
                    # Income with a determinate payday: use pay period config
                    from app.services.pay_period import _next_payday
                    next_date = _next_payday(_today, _config)
                else:
                    # Anchor on the bill's NOMINAL due day (derived from the
                    # whole series), not `last_date.day` — the day the most
                    # recent payment happened to POST. See `_monthly_anchor`
                    # for why that distinction matters: a weekend/holiday
                    # posting delay used to ratchet forward permanently, and
                    # a 29th/30th/31st bill clamped by a short month never
                    # climbed back once longer months returned. Re-deriving
                    # the target day from the fixed anchor on every step
                    # (rather than from the previous, possibly-clamped
                    # `next_date`) fixes both.
                    anchor = _monthly_anchor(dates)
                    monthly_anchor_desc = anchor
                    next_date = _advance_month_to_anchor(last_date, anchor)
                    # If still in the past or today (minus grace for bills), advance one more month
                    while next_date <= _today - _grace:
                        next_date = _advance_month_to_anchor(next_date, anchor)
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
        results.append({
            "key":          key,
            "avg_interval": round(avg_interval, 1),
            "avg_amount":   round(avg_amount, 2),
            "last_date":    last_date,
            "next_date":    next_date,
            "monthly_anchor": monthly_anchor_desc,
            "occurrences":  len(items),
            "account_id":   attributed_acct,
            "amounts_recent": amounts_recent,
            "category":     bucket_cat,
            # Non-serialised extras consumed only by app.services.recurring_judge
            # — `_serialise_pattern` never copies these into the cached doc, so
            # they add no persisted shape. `trusted_bypass_reason` is what makes
            # a series SUSPECT (see recurring_judge.is_suspect); occurrences_detail
            # is the raw per-occurrence evidence a judge (or a human) would want.
            "trusted_bypass_reason": trusted_bypass_reason,
            "occurrences_detail": [
                {"date": _d2date(_t["date"]).isoformat(), "amount": round(abs(float(_t.get("amount", 0))), 2)}
                for _t in sorted(items, key=lambda t: t["date"])
            ],
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


def is_assessable_bill(b: dict) -> bool:
    """True when `b` (an `upcoming_bills` entry from `_build_cashflow_
    response`) carries enough real balance data to enter a running-balance
    shortfall walk.

    Excludes exactly two shapes, and no others:
      - no balance data at all (`account_balance is None` — the bill's
        account isn't in this user's own linked-account map, e.g. removed
        or currency-filtered).
      - a credit card (`is_credit_card`, computed fresh per request via
        `is_credit_card_account` inside `_build_cashflow_response`'s
        `account_map` — never a stale stored flag) — a credit limit is not
        an available balance to walk.

    Deliberately does NOT exclude a genuinely NEGATIVE `account_balance` on
    a real current/savings (debit) account. Bug fix, 2026-09-01 (owner,
    verbatim: "the Barclays account is short and it still has bills to
    cover, I thought that when the account is in a deficit penny would make
    a suggestion to cover the deficit and also the bills"): the previous
    filter also required `account_balance >= 0`, which silently dropped
    EVERY bill on an already-overdrawn current account from the shortfall
    walk. That starved step 1 of `compute_today_items` of the bill-backed
    route entirely, leaving only the narrow overdraft-only fallback
    (`_overdraft_deficits` / `_shortfall_for_destination`'s "clear to £0 +
    next bill in-window" branch, per the 2026-08-24 doctrine) — which sizes
    off the live deficit ALONE and has no way to see the bills days away.
    An overdrawn debit account's own bills must stay assessable so the walk
    can size a move that covers the deficit AND the bills together, the
    same needs arithmetic any short account gets (the negative starting
    balance simply enters `_walk_events` as the seed — no special-cased sum
    required, see that function's docstring).

    SIMS-LOCKSTEP: this predicate is the single source of truth for three
    independent `assessable_bills` filters that must agree byte-for-byte —
    `companion.compute_today_items`, this module's `at_risk_count`, and
    `spend_impact._cashflow_window` (mirrors `_walk_events` sharing the same
    discipline: one shared implementation, not three hand-copies that can
    drift). Edit assessability rules HERE, never at a call site.
    """
    return b.get("account_balance") is not None and not b.get("is_credit_card")


def _account_pool_kind(acc: dict) -> str | None:
    """Which pool `acc` structurally belongs to, by currency/type/subtype
    alone, independent of its current balance:
      - GBP-only (currency in {"GBP", ""}); anything else -> None (excluded)
      - type or subtype contains "credit" (case-insensitive) -> None
        (a credit card is a limit, not cash, and belongs to neither pool)
      - subtype contains "saving" (case-insensitive) -> "savings"
      - everything else -> "spendable" (accounts with no subtype and no
        credit marker fall back to spendable, so the figure is never
        silently zero -- covers e.g. Mono accounts, which don't populate
        subtype today)

    Pulled out of `_split_balances` so `_learn_transfer_destinations` can
    classify an inflow's DESTINATION account against the exact same rule
    without copy-pasting it into a second place where the two could drift.
    Balance sign is deliberately NOT part of this predicate -- whether an
    account counts as "spendable" right now (bal >= 0) is a balance-figure
    concern specific to `_split_balances`'s totals, not a question of which
    pool the account is structurally a member of.
    """
    if str(acc.get("currency", "GBP")).upper() not in {"GBP", ""}:
        return None
    subtype = (acc.get("subtype") or "").lower()
    acc_type = (acc.get("type") or "").lower()
    if "credit" in acc_type or "credit" in subtype:
        return None
    if "saving" in subtype:
        return "savings"
    return "spendable"


def _split_balances(accs: list[dict]) -> tuple[float, float]:
    """Split live account balances into (spendable_cash, savings_total).

    Mirrors compute_safe_to_spend's (the Home Safe-to-Spend hero) account
    classification rules exactly, so every surface that shows "spendable
    cash" agrees with every other and can never silently diverge. Pool
    membership itself (GBP-only, not a credit card, savings-subtype or not)
    is `_account_pool_kind`, above; this function adds the one rule that is
    specific to a balance TOTAL rather than pool membership: negative
    balances are excluded from both buckets (the hero tracks these
    separately as card/overdraft debt; see compute_safe_to_spend).
    """
    spendable = 0.0
    savings = 0.0
    for acc in accs:
        pool = _account_pool_kind(acc)
        if pool is None:
            continue
        bal = float(acc.get("balance") or 0)
        if bal < 0:
            continue
        if pool == "savings":
            savings += bal
        else:
            spendable += bal
    return round(spendable, 2), round(savings, 2)


def _safe_to_spend_lowest_projected_balance(
    spendable_cash: float, bills: list[dict], income: list[dict],
) -> float:
    """Return the lowest pooled cash balance in the Safe-to-Spend window.

    Forecast occurrences carry calendar dates, not a reliable settlement time.
    For events on the same date, debit before income is therefore the only
    defensible default for a spending-permission calculation: an incoming
    payment must not be assumed to clear before a direct debit. This helper is
    intentionally pure so the conservative ordering and the low-point fact
    can be tested without the endpoint's database fan-out.
    """
    events: list[tuple[int, float]] = []  # (days_away, delta); debit is negative
    for bill in bills:
        if _is_pooled_spendable_transfer(bill):
            continue
        events.append((int(bill["days_away"]), -float(bill["amount"])))
    for item in income:
        events.append((int(item["days_away"]), float(item["amount"])))

    # Same day: debits first. A zero-valued event has no effect and may follow
    # either side without changing the result.
    events.sort(key=lambda event: (event[0], 0 if event[1] < 0 else 1))

    running = float(spendable_cash)
    minimum = running
    for _days_away, delta in events:
        running += delta
        minimum = min(minimum, running)
    return minimum


def _is_pooled_spendable_transfer(item: dict) -> bool:
    """Return true when an item only moves money inside the cash pool.

    Safe-to-Spend starts from the sum of every spendable account. A traced
    movement into another account already represented in that sum is a no-op
    for the pool: one balance falls by exactly the amount another rises.
    Savings destinations and untraced movements remain real outflows.
    """
    return item.get("kind") == MOVEMENT and item.get("dest_account_spendable") is True


async def _safe_to_spend_accounts(uid: str) -> list[dict]:
    """Live UK account pool source for Safe-to-Spend.

    Yapily account documents are retained after a consent is removed. An
    account belongs in a balance calculation only when its own consent is
    still AUTHORIZED; a different active consent must not revive stale cash.
    """
    projection = {"balance": 1, "type": 1, "subtype": 1, "currency": 1}
    native_task = accounts_col.find({"user_id": uid}, projection).to_list(None)
    active_consents_task = yapily_consents_col.find(
        {"user_id": uid, "status": "AUTHORIZED"}, {"_id": 1}
    ).to_list(None)
    accounts, active_consents = await asyncio.gather(native_task, active_consents_task)
    active_consent_ids = [consent["_id"] for consent in active_consents if consent.get("_id")]
    if active_consent_ids:
        accounts += await yapily_accounts_col.find(
            {"user_id": uid, "consent": {"$in": active_consent_ids}}, projection
        ).to_list(None)
    return accounts


# Tokens generic enough to appear in almost any UK current or savings
# account label ("HSBC Current Account", "Barclays Everyday Saver", "Chase
# Personal Account") and so would confer false name-affinity with nearly
# every debit description if left in `_affinity_tokens`' token set. A named
# module-level constant, not inline literals, so the exclusion list is
# auditable in one place and easy to extend when a new generic word turns
# up. "savings"/"saving"/"saver" are excluded together because a debit
# description naming ANY savings pot would otherwise look like it has
# affinity with EVERY savings pot; "premier"/"classic"/"everyday" are
# marketing tiers that show up across unrelated providers; "banking"/
# "limited" show up in provider legal names generically.
_GENERIC_ACCOUNT_AFFINITY_TOKENS: frozenset = frozenset({
    "account", "accounts", "current", "savings", "saving", "saver",
    "personal", "premier", "classic", "everyday", "banking", "limited",
})


def _normalise_for_affinity(text: str) -> str:
    """Lowercase and blank out punctuation so e.g. "Chase UK" and "KEVIN
    MAINGI CHASEACCOUNT STO" tokenise and substring-match the same way
    regardless of how either side happens to be punctuated."""
    return re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())


def _affinity_tokens(acct: dict) -> set[str]:
    """Distinctive tokens (5+ chars, not in the generic exclusion list)
    drawn from a destination account's `provider` and `name`. The 5-char
    floor exists to keep short incidental fragments (e.g. "isa", "acc")
    from conferring affinity by coincidence; real bank/provider names clear
    it comfortably ("chase", "hsbc" is the one common exception this rule
    accepts missing -- see `_has_affinity`'s docstring).
    """
    blob = f"{acct.get('provider') or ''} {acct.get('name') or ''}"
    words = _normalise_for_affinity(blob).split()
    return {w for w in words if len(w) >= 5 and w not in _GENERIC_ACCOUNT_AFFINITY_TOKENS}


def _has_affinity(debit_description: str, dest_acct: dict) -> bool:
    """Whether `dest_acct` (the account a CONTENDED credit landed on) is
    plausibly the account a debit with this description was actually headed
    for: true when one of the account's distinctive provider/name tokens
    appears as a SUBSTRING of the normalised description (e.g. "chase"
    inside "kevin maingi chaseaccount sto"). Substring rather than an
    exact-token match on purpose: real bank feeds glue words together with
    no separator ("chaseaccount", "hsbcmain"), so an exact-token match would
    silently miss the exact descriptions this rule exists to catch.

    Only called when a credit is CONTENDED by more than one series (see
    `_learn_transfer_destinations`); uncontended matches never reach this
    function; a real destination like "KEVIN MAINGI HSBC STO" that happens
    to share no token with "HSBC" ever gets here at all unless something
    else is also trying to claim the same credit.
    """
    desc = _normalise_for_affinity(debit_description)
    return any(tok in desc for tok in _affinity_tokens(dest_acct))


def _tx_day(t: dict):
    d = t.get("date")
    return d.date() if hasattr(d, "date") else d


def _tx_amt(t: dict) -> float:
    return abs(float(t.get("amount") or 0))


def _tx_sort_key(t: dict):
    # Deterministic across runs: date, then largest amount first, then
    # account/_id as a final tiebreak, so two candidates tied on date+amount
    # always resolve to the same match rather than whatever order Mongo
    # happened to hand documents back in this time. Shared by both
    # `_learn_transfer_destinations` and `_learn_card_repayment_destinations`
    # so their candidate pools sort identically.
    return (_tx_day(t), -_tx_amt(t), str(t.get("account_id") or ""), str(t.get("_id") or ""))


def _match_transfer_votes(candidate_debits: list[dict], candidate_credits: list[dict], account_map: dict) -> dict[str, list]:
    """Three-pass, collision-aware matcher shared by `_learn_transfer_destinations`
    (own-account transfer legs) and `_learn_card_repayment_destinations` (card
    repayment debits -> the credit landing on the card being paid off). Both
    callers build their own DIRECTION-SPECIFIC candidate pools (which
    destinations are even eligible differs: one excludes credit-card
    destinations entirely, the other requires one), already sorted with
    `_tx_sort_key`, then hand them here so the actual pairing logic — byte-
    identical description, same-day same-amount, and the loosened +/-1 day /
    1% tolerance pass, plus the name-affinity collision resolution — exists
    in exactly one place rather than risking a second, subtly different,
    implementation. See `_learn_transfer_destinations`'s docstring for the
    full rationale (collision handling, why a single loose match is never
    trusted alone); this function only implements it. Callers, and the
    evidence gate below (`_gate_destination_votes`), decide who is even
    eligible and how many matches are enough.

    Returns `{series_key(debit): [dest_account_id, ...]}` — one vote per
    matched debit occurrence.
    """
    consumed_debits: set = set()
    consumed_credits: set = set()
    votes: dict[str, list] = defaultdict(list)

    def _contending_series(c: dict, predicate) -> dict:
        """Every series (by `series_key`, mapped to one representative
        unconsumed debit) that could legitimately claim credit `c` under
        THIS pass's predicate right now. Used to detect collisions before a
        credit is consumed -- see the collision-handling paragraph in
        `_learn_transfer_destinations`'s docstring. Recomputed fresh per
        credit per call (not cached across the pass) because consumption
        shrinks the unconsumed pool as the pass proceeds, so what counted
        as a collision earlier in the pass may no longer be one later.
        """
        reps: dict = {}
        for cd in candidate_debits:
            if id(cd) in consumed_debits:
                continue
            if str(cd.get("account_id")) == str(c.get("account_id")):
                continue
            if not predicate(cd, c):
                continue
            key = series_key(cd)
            if key not in reps:
                reps[key] = cd
        return reps

    def _run_pass(predicate) -> None:
        for d in candidate_debits:
            d_id = id(d)
            if d_id in consumed_debits:
                continue
            for c in candidate_credits:
                c_id = id(c)
                if c_id in consumed_credits:
                    continue
                if str(c.get("account_id")) == str(d.get("account_id")):
                    continue  # a transfer must land on a DIFFERENT own account
                if not predicate(d, c):
                    continue
                contenders = _contending_series(c, predicate)
                if len(contenders) > 1:
                    # More than one unrelated series could legitimately claim
                    # this credit. Resolve by name affinity to the credit's
                    # own destination account rather than by whichever debit
                    # happens to sort first (see docstring above for why an
                    # arbitrary tiebreak is not acceptable here).
                    dest_acct = account_map.get(str(c.get("account_id"))) or {}
                    affine = [k for k, rep in contenders.items()
                              if _has_affinity(rep.get("description") or "", dest_acct)]
                    if len(affine) != 1:
                        # Nobody has a legible claim, or more than one does:
                        # fail closed. No series consumes this credit this
                        # pass, so nothing is learned from it -- a missed
                        # match is the acceptable failure mode here, a wrong
                        # one is not.
                        continue
                    if series_key(d) != affine[0]:
                        # This credit belongs to a different contending
                        # series; leave it for that series' own occurrence
                        # to claim (later in this same pass), don't let `d`
                        # take it just because it got here first.
                        continue
                consumed_debits.add(d_id)
                consumed_credits.add(c_id)
                key = series_key(d)
                if key:
                    votes[key].append(str(c.get("account_id")))
                break  # this debit occurrence is spoken for, move to the next debit
    # Pass 0 (highest confidence): byte-identical description, mirroring
    # categorisation.py Pass 2's own sync-time rule. Anything that matcher
    # would already have caught is caught here too, so this channel is a
    # strict superset of it, never a regression.
    _run_pass(lambda d, c: _byte_desc_key(d) == _byte_desc_key(c)
              and abs(_tx_amt(d) - _tx_amt(c)) < 0.02
              and abs((_tx_day(c) - _tx_day(d)).days) <= 5)
    # Pass 1: same amount, same calendar date. The common real-world case
    # (e.g. "KEVIN MAINGI HSBC STO" vs "MAINGI K M HSBC") where the two legs
    # simply read differently but post on the same day for the same amount.
    _run_pass(lambda d, c: abs(_tx_amt(d) - _tx_amt(c)) <= 0.02 and _tx_day(c) == _tx_day(d))
    # Pass 2: loosen the date to +/-1 day and the amount tolerance to 1% of
    # the debit (a flat 2p tolerance is too strict against rounding on
    # larger transfers). This is the weakest pass, which is exactly why the
    # evidence gate below never trusts a single loose match alone.
    _run_pass(lambda d, c: abs(_tx_amt(d) - _tx_amt(c)) <= max(0.02, 0.01 * _tx_amt(d))
              and abs((_tx_day(c) - _tx_day(d)).days) <= 1)
    return votes


def _gate_destination_votes(votes: dict[str, list], account_map: dict) -> dict[str, dict]:
    """Evidence gate shared by both destination-learning channels: a single
    unrepeated match is exactly as likely to be a coincidence (two unrelated
    transfers of the same round amount landing the same day) as a real
    recurring destination, so require the series to have matched at least
    twice, AND for the destination it lands on to be consistent — the modal
    destination must cover at least two thirds of the series' matches.
    Mirrors the conservatism of this file's other evidence gate for
    cross-account pairing (`_has_pair_evidence`, used by
    `_transfer_pair_suggestions`).
    """
    dest_by_key: dict[str, dict] = {}
    for key, matched_accounts in votes.items():
        if len(matched_accounts) < 2:
            continue
        counts = Counter(matched_accounts)
        modal_acct, modal_count = counts.most_common(1)[0]
        if modal_count / len(matched_accounts) < (2 / 3):
            continue
        acct = account_map.get(modal_acct)
        if not acct:
            continue
        dest_by_key[key] = {
            "dest_account_id":   modal_acct,
            "dest_account_name": acct["name"],
            "dest_account_bank": acct.get("provider"),
            # Whether the destination is inside the SPENDABLE pool (see
            # `_account_pool_kind`). A savings-subtype destination is still
            # learned and still mirrored below -- the per-account walk
            # genuinely receives that money and needs to know it -- but a
            # POOLED consumer (spendable_balance) must not net the inflow
            # against a pool that structurally never contained that account.
            "dest_account_spendable": bool(acct.get("is_spendable")),
            # Live balance at compute time. Unused by `_learn_transfer_destinations`'s
            # own callers, but `_learn_card_repayment_destinations` needs it
            # for the projection cap (`_card_repayment_projection`) and
            # carrying it here means neither channel needs a second
            # account_map lookup later for it.
            "dest_account_balance": acct.get("balance"),
        }
    return dest_by_key


def _learn_transfer_destinations(raw: list[dict], account_map: dict, kind_map) -> dict[str, dict]:
    """Learn each recurring MOVEMENT debit series' destination account, by
    greedily pairing it against MOVEMENT credits landing on the user's other
    own accounts.

    This exists because the cashflow projection would otherwise be
    asymmetric about the user's own internal transfers: an outbound
    standing order to the user's own savings account is projected as a bill
    (it consumes balance on the source account, so it belongs in the walk,
    see the `debits` comment in `_compute_cashflow_patterns`), but nothing
    mirrors the matching inbound credit on the DESTINATION account, so that
    account's own simulation never sees the money it is actually about to
    receive and can be falsely reported short. Description matching alone
    (categorisation.py Pass 2's byte-identical rule) misses most real
    pairs, since the two legs of one transfer routinely read differently
    ("KEVIN MAINGI HSBC STO" debit vs "MAINGI K M HSBC" credit, same day,
    same amount), so this runs its own, more permissive three-pass match
    and then demands repeat evidence before trusting the result (see the
    evidence gate below). `confirmed_transfer_pairs_col` (the sync-time
    learned-pair table) is not consulted here on purpose: that table
    relabels a single transaction's CATEGORY by description match, so it
    would miss exactly the pairs this function exists for.

    Collision handling: two unrelated recurring transfers can be the same
    amount on the same date (e.g. two different standing orders that both
    move a round £50 on payday) and so both become candidates for the SAME
    credit within one pass. Picking whichever one happens to sort first
    would be an arbitrary guess dressed up as a match, and a wrong guess
    here is worse than no match at all: it would mean mirroring money into
    an account it never actually reached. So before a credit is consumed,
    `_run_pass` checks whether more than one series could legitimately
    claim it and, if so, resolves the collision by name affinity
    (`_has_affinity`) between each contending series' description and the
    credit's own destination account. If affinity picks out exactly one
    series, that series wins the credit. If it picks out none, or more than
    one, the credit is left unconsumed by everyone this pass, failing
    closed rather than guessing. Uncontended credits (the overwhelming
    majority) are entirely unaffected by any of this.

    Returns `{series_key(debit): {"dest_account_id", "dest_account_name",
    "dest_account_bank", "dest_account_spendable"}}`. A series absent from
    the result has no learned destination, either it never matched with
    enough repeat evidence, or
    every candidate credit it could have matched was already claimed by a
    more confident pass or an earlier debit occurrence.
    """
    def _kind(t: dict) -> str:
        return kind_of(kind_map, t.get("custom_category") or t.get("category"))

    candidate_debits = sorted(
        (t for t in raw
         if t.get("transaction_type") == "debit"
         and _kind(t) == MOVEMENT
         and str(t.get("account_id") or "") in account_map),
        key=_tx_sort_key,
    )
    # Credit-card destinations are excluded up front. The simulations this
    # feeds never treat a credit card's balance as spendable cash (it's a
    # credit limit, not cash on hand; same exclusion as every other walk in
    # this file), so learning one as a destination would only be dead
    # weight nothing downstream would ever use. Card-repayment destinations
    # are learned separately, by the mirror-image sibling below.
    candidate_credits = sorted(
        (t for t in raw
         if t.get("transaction_type") == "credit"
         and _kind(t) == MOVEMENT
         and str(t.get("account_id") or "") in account_map
         and not account_map[str(t.get("account_id"))]["is_credit_card"]),
        key=_tx_sort_key,
    )
    votes = _match_transfer_votes(candidate_debits, candidate_credits, account_map)
    return _gate_destination_votes(votes, account_map)


def _learn_card_repayment_destinations(raw: list[dict], account_map: dict, kind_map) -> dict[str, dict]:
    """Learn each recurring Debt/card-repayment debit series' destination
    CREDIT CARD account — the mirror image of `_learn_transfer_destinations`
    just above, which deliberately EXCLUDES credit-card destinations because
    a card balance isn't spendable cash. Nothing today links a card
    repayment to the card it pays off at all: on real data every one of six
    recurring card-repayment series carries `dest_account_id: null`, purely
    because the matching credit lands on a credit-card account and the
    general channel throws exactly that kind of credit away by design.
    Manual amount+date inspection resolves all six cleanly (each payment
    debit has a same-date, same-amount credit on exactly one credit-card
    account) — this function automates that.

    Reuses `_learn_transfer_destinations`'s own matching engine
    (`_match_transfer_votes`) and evidence gate (`_gate_destination_votes`)
    verbatim; only the CANDIDATE POOLS differ. Candidate debits are the same
    MOVEMENT-kind pool `_learn_transfer_destinations` uses (the "Debt"
    category is itself MOVEMENT-kind, see categories.py's
    BUILTIN_CATEGORY_KINDS, so no separate category filter is needed here).
    Candidate credits are restricted to landing on a credit-card account
    instead of excluded from doing so. Two consequences worth being
    explicit about:

    1. A current-account destination (e.g. "KEVIN MAINGI CREDIT VIA MOBILE
       - PY", which matches a same-day same-amount credit into the user's
       own Premier CURRENT account, not a card) is NEVER linked here — the
       credit pool structurally excludes it, so that series stays unlinked
       exactly as before this function existed.
    2. This result is intentionally NEVER merged into
       `_learn_transfer_destinations`'s own `dest_account_id` field. That
       field feeds `internal_inflows` (see the two read sites in
       `_build_cashflow_response`, both gated on `r.get("dest_account_id")`
       plus a MOVEMENT-kind check), which mirrors an outbound bill as an
       INBOUND credit on its destination account for the per-account
       balance walks. A card is not a spendable destination and must never
       receive a mirrored inflow — so this function's result is carried on
       separate `card_dest_*` fields (see `_serialise_pattern`) that
       `internal_inflows` never reads, checked directly: neither of its two
       call sites references `card_dest_account_id` at all.

    Same evidence gate, same collision handling, same return shape as
    `_learn_transfer_destinations` (plus `dest_account_balance`, the card's
    live balance at compute time — used by the projection cap, see
    `_card_repayment_projection`).
    """
    def _kind(t: dict) -> str:
        return kind_of(kind_map, t.get("custom_category") or t.get("category"))

    candidate_debits = sorted(
        (t for t in raw
         if t.get("transaction_type") == "debit"
         and _kind(t) == MOVEMENT
         and str(t.get("account_id") or "") in account_map),
        key=_tx_sort_key,
    )
    candidate_credits = sorted(
        (t for t in raw
         if t.get("transaction_type") == "credit"
         and _kind(t) == MOVEMENT
         and str(t.get("account_id") or "") in account_map
         and account_map[str(t.get("account_id"))]["is_credit_card"]),
        key=_tx_sort_key,
    )
    votes = _match_transfer_votes(candidate_debits, candidate_credits, account_map)
    return _gate_destination_votes(votes, account_map)


# ── Balance-aware card-repayment projection (steps 2+3) ─────────────────────
#
# Step 2, the cap: a series linked to a credit card by
# `_learn_card_repayment_destinations` never needs to project more than that
# card's own outstanding debt -- the payment can't exceed the balance. If the
# card is currently in credit, no payment is coming at all.
#
# Step 3, the classifier: distinguishes a card that pays a fixed/minimum
# amount regardless of spend (trailing mean stays correct) from one that
# tracks its own spend closely enough (a "full-statement-ish" payer) that the
# trailing MEAN of just 2-3 historical payments is a worse estimate than
# spend observed since the last payment. Deliberately conservative: anything
# that doesn't clearly land in one camp or the other is "ambiguous" and keeps
# the trailing mean untouched.
CARD_CLASSIFY_MIN_CYCLES = 3             # fewer valid ratio cycles than this => ambiguous, not enough evidence either way
CARD_CLASSIFY_TRAILING_WINDOW_DAYS = 32  # spend window for a series' EARLIEST in-view occurrence (no prior payment to anchor to) -- midpoint of a 30-35d statement cycle
CARD_FIXED_PAYER_RATIO_CEILING = 0.35    # payment/spend at or below this reads as "not tracking spend" (a minimum/fixed payment)
CARD_FULL_PAYER_RATIO_FLOOR = 0.5        # payment/spend at or above this reads as "tracking spend" (task's own steer: "say >= 0.5")
CARD_FULL_PAYER_RATIO_CEILING = 1.5      # paying more than 1.5x a cycle's own spend is a catch-up/lump-sum payment, not ordinary evidence of full-statement behaviour
CARD_CLASSIFY_CONSISTENCY_SHARE = 0.6    # share of valid cycles that must land in a verdict's band to trust it -- matches Amex BA's real ratios (3 of 5 cycles = 0.6)
CARD_MIN_SPEND_FOR_RATIO = 1.0           # a cycle with less spend than this produces a meaningless ratio (near-divide-by-zero); excluded from both bands rather than counted as "fixed"

# Balance-transfer-shaped debit on a CREDIT CARD's own transaction stream --
# NOT spend, and a non-negotiable carve-out (see `_card_repayment_projection`
# docstring). Matches the BT principal itself ("BALANCE TRANSFER BT000254
# 1432", the prompt example "COMP BAL XFR") and its fee line ("BALANCE
# TRANSFER FEE 1432"), which is categorised like any other fee (Bills) and so
# needs its own description match rather than relying on category alone.
_BT_SHAPED_DESC_RE = re.compile(r"bal(?:ance)?\s*(?:xfr|transfer)|transfer\s*fee", re.IGNORECASE)


def _is_bt_shaped_card_debit(t: dict) -> bool:
    """Whether a DEBIT on a credit-card account's own transaction stream is
    balance-transfer-shaped rather than real spend: matched by description
    (`_BT_SHAPED_DESC_RE`, covers the fee lines too) OR by category ==
    "Transfer" (the BT principal itself; an ordinary card purchase is never
    categorised Transfer, so this is a safe signal scoped to a card's own
    debit stream specifically -- it is NOT applied to payer-side debits
    anywhere in this file).
    """
    desc = t.get("description") or ""
    if _BT_SHAPED_DESC_RE.search(desc):
        return True
    return (t.get("custom_category") or t.get("category") or "") == "Transfer"


def _card_repayment_projection(
    recurring_spend: list[dict], raw: list[dict], account_map: dict,
    card_dest_by_key: dict[str, dict], today: _date,
) -> dict[str, dict]:
    """Steps 2 (the cap) and 3 (the deterministic payer classifier and
    balance-derived amount for confident full-payers) of the balance-aware
    card-repayment projection.

    For every series in `card_dest_by_key` (a Debt series linked to the card
    it pays off, see `_learn_card_repayment_destinations`):

    1. Classify the card from its OWN spend history: for each historical
       payment, the card's own non-BT debits in the window since the
       previous payment (or a trailing ~32-day fallback for the earliest
       in-view payment) give a payment/spend ratio. >= `CARD_CLASSIFY_MIN_CYCLES`
       valid ratios, consistently (>= `CARD_CLASSIFY_CONSISTENCY_SHARE`) at
       or below `CARD_FIXED_PAYER_RATIO_CEILING` => "fixed"; consistently
       inside [`CARD_FULL_PAYER_RATIO_FLOOR`, `CARD_FULL_PAYER_RATIO_CEILING`]
       => "full_payer"; anything else, including too little history, =>
       "ambiguous". A BT-shaped debit ANYWHERE examined (any historical
       window, or the projection window below) forces "ambiguous"
       unconditionally, overriding whatever the ratios alone would have
       said -- this is the non-negotiable carve-out: NatWest MC#2 took a
       ~£994 balance transfer on 2026-08-07 while its DD stayed ~£62, and
       without this carve-out a naive spend-since-last-payment estimate
       for its NEXT projection (last payment 2026-07-31 -> today) would
       read that £994 BT as if it were spend and blow the projection up to
       roughly its size instead of ~£62.
    2. For a CONFIDENT full-payer only, the projected amount becomes spend
       on the card since the last observed payment (same BT exclusions) --
       replacing the trailing mean, not averaging with it.
    3. Independently of classification, cap whatever amount step 1/2 landed
       on at the card's own outstanding debt (abs(balance) when balance <
       0, else 0). A card currently in credit takes no payment at all --
       `suppressed=True` for that series rather than a misleading £0 bill.

    Returns `{series_key: {"final_amount", "amount_basis", "suppressed",
    "verdict", "ratios"}}` for exactly the series `card_dest_by_key` links;
    every other series (everything without a learned card destination) is
    simply absent from the result, and `_serialise_pattern` treats absence
    as "nothing changed" for it.
    """
    # Card account_id -> its own debit transactions. `raw` holds every
    # account's transactions for this user; this classifier only ever cares
    # about the CARD's own spend, never the payer's.
    card_debits: dict[str, list[dict]] = defaultdict(list)
    for t in raw:
        if t.get("transaction_type") != "debit":
            continue
        aid = str(t.get("account_id") or "")
        if aid and account_map.get(aid, {}).get("is_credit_card"):
            card_debits[aid].append(t)

    def _spend_in_window(card_id: str, start_exclusive, end_inclusive) -> tuple[float, bool]:
        """(non-BT spend total, whether any BT-shaped debit fell in this
        window) for `card_id` over (start_exclusive, end_inclusive]."""
        total = 0.0
        bt_seen = False
        for t in card_debits.get(card_id, []):
            d = _tx_day(t)
            if not (start_exclusive < d <= end_inclusive):
                continue
            if _is_bt_shaped_card_debit(t):
                bt_seen = True
                continue
            total += _tx_amt(t)
        return total, bt_seen

    result: dict[str, dict] = {}
    for r in recurring_spend:
        key = r["key"]
        card_dest = card_dest_by_key.get(key)
        if not card_dest:
            continue
        card_id = card_dest["dest_account_id"]
        card_balance = card_dest.get("dest_account_balance")
        outstanding = abs(card_balance) if isinstance(card_balance, (int, float)) and card_balance < 0 else 0.0

        occ = sorted(r.get("occurrences_detail") or [], key=lambda o: o["date"])
        ratios: list[float] = []
        bt_seen_anywhere = False
        prev_date = None
        for o in occ:
            this_date = _date.fromisoformat(o["date"])
            start = prev_date if prev_date is not None else this_date - timedelta(days=CARD_CLASSIFY_TRAILING_WINDOW_DAYS)
            spend, bt_seen = _spend_in_window(card_id, start, this_date)
            bt_seen_anywhere = bt_seen_anywhere or bt_seen
            if spend >= CARD_MIN_SPEND_FOR_RATIO:
                ratios.append(o["amount"] / spend)
            prev_date = this_date

        # The upcoming projection's own window: last observed payment to
        # today. Checked for BT shape unconditionally (even if it never
        # feeds a ratio) so a BT landing AFTER the last historical payment
        # still trips the carve-out -- NatWest MC#2's real case: its last
        # observed payment (31 Jul) predates its BT (7 Aug) by a week, so
        # the BT never appears in any historical ratio window above, only
        # in this one.
        last_payment_date = _date.fromisoformat(occ[-1]["date"]) if occ else None
        spend_since_last, bt_seen_since_last = (
            _spend_in_window(card_id, last_payment_date, today) if last_payment_date else (0.0, False)
        )
        bt_seen_anywhere = bt_seen_anywhere or bt_seen_since_last

        # ── Classify ─────────────────────────────────────────────────────
        verdict = "ambiguous"
        if not bt_seen_anywhere and len(ratios) >= CARD_CLASSIFY_MIN_CYCLES:
            full_share  = sum(1 for x in ratios if CARD_FULL_PAYER_RATIO_FLOOR <= x <= CARD_FULL_PAYER_RATIO_CEILING) / len(ratios)
            fixed_share = sum(1 for x in ratios if x <= CARD_FIXED_PAYER_RATIO_CEILING) / len(ratios)
            if full_share >= CARD_CLASSIFY_CONSISTENCY_SHARE:
                verdict = "full_payer"
            elif fixed_share >= CARD_CLASSIFY_CONSISTENCY_SHARE:
                verdict = "fixed"
            # else stays "ambiguous" -- neither band is consistent enough

        # ── Amount: estimator (confident full-payers only), then the cap ──
        final_amount = r["avg_amount"]
        amount_basis = None
        if verdict == "full_payer":
            final_amount = round(spend_since_last, 2)
            amount_basis = "balance_estimate"
        if final_amount > outstanding:
            final_amount = round(outstanding, 2)
            amount_basis = "balance_estimate"

        result[key] = {
            "final_amount": final_amount,
            "amount_basis": amount_basis,
            # A card in credit (outstanding <= 0) takes no payment; suppress
            # the projected occurrence rather than emit a misleading £0 bill
            # (see this function's docstring, step 3).
            "suppressed": outstanding <= 0,
            "verdict": verdict,
            "ratios": [round(x, 3) for x in ratios],
        }
    return result


async def _compute_cashflow_patterns(uid: str) -> dict:
    """
    Full cashflow computation — scans 180 days of transactions for recurring
    debit-side detection and own-transfer destination learning (90 days for
    everything else), runs AI prediction, returns the recurring patterns and
    account snapshot needed to serve the cashflow view. Stored in
    cashflow_cache_col after every sync; never called on page load.
    """
    # A monthly series only ever has 3-4 occurrences inside a flat 90-day
    # window, so the calendar rolling forward one day at a time flips that
    # series between detected/undetected, and between payday-anchored and
    # naive-interval prediction, purely because an occurrence fell out of the
    # window. This bit twice in the same 24 hours on live data: a payday
    # standing-order series with occurrences on 24 Apr, 29 May, 26 Jun and
    # 31 Jul 2026 dropped from 3 to 2 in-window occurrences and vanished from
    # recurring_spend entirely, and after a same-day partial fix it detected
    # again from 2 points but the weekday-anchor logic needs 3+ points to
    # engage, so it mispredicted Wed 26 Aug instead of the true Fri 28 Aug and
    # rendered as a wrongly-rolled "pending, hasn't left yet" bill on screen.
    # The same 90-day cliff also cost `_learn_transfer_destinations` its
    # Chase evidence, dropping it to 1 in-window vote, below its 2-vote gate.
    # The fix is a wider evidence window on the inputs that actually need
    # more points to stay stable (debit-side recurring detection, transfer
    # destination learning), not another patch on a symptom. This flat
    # 90-day cutoff on detection inputs must not come back.
    now = datetime.now()
    cutoff90 = now - timedelta(days=90)
    cutoff180 = now - timedelta(days=180)
    cutoff120 = now - timedelta(days=120)  # BNPL plan-reconstruction window (see build_bnpl_projections below)

    proj = {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
            "transaction_type": 1, "category": 1, "custom_category": 1, "account_id": 1}
    raw: list[dict] = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff180}}, proj
    ).to_list(None)
    raw += await yapily_transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff180}}, proj
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
            # Pool membership by `_split_balances`'s own rule (see
            # `_account_pool_kind`), NOT `is_credit_card_account` above --
            # this flag exists so `_learn_transfer_destinations` can tell a
            # POOLED consumer (spendable_balance) whether a learned
            # destination is actually inside that pool, and must answer with
            # the same rule `_split_balances` uses or the two would drift.
            "is_spendable": _account_pool_kind(a) == "spendable",
        }
        for a in acct_docs
        if str(a.get("currency", "GBP")).upper() in {"GBP", ""}
    }

    # Learn each own-transfer bill's destination account (see
    # `_learn_transfer_destinations`'s docstring for why this channel exists
    # and how it stays conservative) so `_serialise_pattern` below can carry
    # it through into the cached pattern, and `_build_cashflow_response` can
    # later mirror the matching inbound credit into `internal_inflows`.
    kind_map = await get_category_kinds(uid)
    dest_by_key = _learn_transfer_destinations(raw, account_map, kind_map)
    # Card-repayment destinations (see `_learn_card_repayment_destinations`'s
    # docstring for why this is a SEPARATE map from `dest_by_key` above, and
    # for the internal_inflows non-interference guarantee). Consumed below by
    # `_card_repayment_projection` (the balance-aware cap and classifier) and
    # carried through `_serialise_pattern` on `card_dest_*` fields.
    card_dest_by_key = _learn_card_repayment_destinations(raw, account_map, kind_map)

    # Debits are NOT filtered by category (Transfer included): anything that
    # regularly leaves the account on a date belongs in the projection
    # regardless of what it's called, because it consumes balance and can
    # block a payment even when it isn't a bill (e.g. a standing order into
    # your own savings still empties the current account). Credits keep the
    # Transfer exclusion — this is about outflows that consume balance, not
    # inflows, and widening it would risk double-reading a self-transfer as
    # recurring "income" as well as a recurring "bill" on the source side.
    #
    # Recurring-BILL detection reads the full 180-day `raw` (debits_180,
    # netted against reversal_credits=credits_180 from the same window) so a
    # monthly series keeps 5-6 points in view instead of teetering on 3-4.
    # Everything else that doesn't need extra points to stay stable keeps
    # reading the narrower 90-day slice (raw_90): the single-occurrence AI
    # candidate heuristic, non_recurring_debits/avg_daily_spend, and
    # recurring-INCOME detection (income_credits) all stay on debits_90/
    # credits_90 exactly as before, deliberately unperturbed.
    raw_90 = [t for t in raw if t["date"] >= cutoff90]

    debits_180  = [t for t in raw if t.get("transaction_type") == "debit"]
    credits_180 = [t for t in raw if t.get("transaction_type") == "credit"
                   and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    # BNPL debits, gathered independently of `debits_180` above (which never
    # contains them once `_detect_recurring`'s guard runs — see
    # app/services/bnpl.py). A pay-in-3 plan completes inside ~60 days, so
    # 120 is generous headroom without dragging in an unrelated older plan.
    bnpl_debits = [t for t in debits_180 if t["date"] >= cutoff120 and is_bnpl_txn(t)]
    debits_90  = [t for t in raw_90 if t.get("transaction_type") == "debit"]
    credits_90 = [t for t in raw_90 if t.get("transaction_type") == "credit"
                  and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    income_credits = [t for t in credits_90 if (t.get("custom_category") or t.get("category") or "Other") == "Income"]

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    trusted   = set(prefs.get("recurring_categories") or DEFAULT_RECURRING_CATEGORIES)
    dismissed = set(prefs.get("dismissed_recurring") or [])
    # Keys the user has explicitly told the undo-log "this IS recurring"
    # (POST /dismissed-series/override) — outranks the engine judge by
    # design, see apply_verdicts' docstring in recurring_judge.py.
    judge_overrides = set(prefs.get("judge_overrides") or [])
    pay_period_config = prefs.get("pay_period_config") or {"type": "calendar_month"}
    _today = _date.today()

    # Build confirmed income map for schedule-aware detection
    _confirmed_income_map: dict = {}
    for _s in (prefs.get("income_streams") or []):
        if _s.get("status") == "confirmed" and _s.get("schedule"):
            _confirmed_income_map[_s["key"]] = _s

    recurring_spend  = _detect_recurring(debits_180, trusted_categories=trusted, today=_today, is_income=False, pay_period_config=pay_period_config, reversal_credits=credits_180)
    recurring_spend  = [r for r in recurring_spend if r["key"] not in dismissed]
    # Engine scrutiny pass (app/services/recurring_judge.py): a series only
    # ever gets here via `dismissed_recurring`'s choke point above, so the
    # veto is applied right next to it — every consumer that reads
    # `recurring_spend` from here on (this function's own return, the
    # cashflow_cache_col doc it becomes, /cashflow, /planning, companion,
    # penny tools) inherits the same, single decision. Only SUSPECT series
    # (trusted-category bypass that would fail the generic gate — see
    # `is_suspect`) ever reach the LLM; everyone else is a no-op pass
    # through. Vetoed series are tracked separately from the user's own
    # `dismissed_recurring` list, not merged into it (see `apply_verdicts`).
    _judge_verdicts = await judge_suspect_series(uid, recurring_spend, account_map)
    recurring_spend, engine_vetoed_recurring = apply_verdicts(recurring_spend, _judge_verdicts, judge_overrides)
    # Balance-aware card-repayment projection (steps 2+3): for every series
    # `_learn_card_repayment_destinations` linked to a card, cap/override its
    # projected amount from the card's own history and live balance. Reads
    # `r["occurrences_detail"]` off the still-unserialised `recurring_spend`
    # dicts (see `_detect_recurring`) and the full 180-day `raw`, so it must
    # run before `_serialise_pattern` strips both away.
    card_repayment_projection = _card_repayment_projection(recurring_spend, raw, account_map, card_dest_by_key, _today)
    recurring_income = _detect_recurring(income_credits, today=_today, is_income=True, pay_period_config=pay_period_config, confirmed_income=_confirmed_income_map)
    recurring_income = [r for r in recurring_income if r["key"] not in dismissed]

    heuristic_keys = {r["key"] for r in recurring_spend}
    single_debits: dict[str, dict] = {}
    for t in debits_90:
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
        t for t in debits_90
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
        # dest_* is only ever populated for a MOVEMENT-kind spend series with
        # enough repeat evidence (see `_learn_transfer_destinations`). Every
        # other pattern (ordinary bills, all of `recurring_income`) carries
        # None here, which `_build_cashflow_response` reads as "nothing to
        # mirror".
        dest = dest_by_key.get(r["key"])
        # Card-repayment link + balance-aware amount (see
        # `_learn_card_repayment_destinations` and
        # `_card_repayment_projection`). `card_proj` is only ever non-None
        # for a series in `card_dest_by_key` -- i.e. never for
        # `recurring_income`, which shares this function but has no card
        # repayments in it.
        card_dest = card_dest_by_key.get(r["key"])
        card_proj = card_repayment_projection.get(r["key"])
        avg_amount = r["avg_amount"]
        amount_basis = None
        suppressed = False
        if card_proj:
            avg_amount = card_proj["final_amount"]
            amount_basis = card_proj["amount_basis"]
            suppressed = card_proj["suppressed"]
        return {
            "key":             r["key"],
            "avg_amount":      round(avg_amount, 2),
            "avg_interval":    r.get("avg_interval"),
            "next_date":       r["next_date"].isoformat(),
            "account_id":      r.get("account_id"),
            "account_name":    acct["name"] if acct else None,
            "account_bank":    acct.get("provider") if acct else None,
            "account_balance": acct["balance"] if acct else None,
            "is_credit_card":  acct.get("is_credit_card", False) if acct else False,
            "category":        r.get("category"),
            "monthly_anchor":  r.get("monthly_anchor"),
            "dest_account_id":   dest["dest_account_id"] if dest else None,
            "dest_account_name": dest["dest_account_name"] if dest else None,
            "dest_account_bank": dest["dest_account_bank"] if dest else None,
            "dest_account_spendable": dest["dest_account_spendable"] if dest else None,
            # Card-repayment destination (Step 1) -- DELIBERATELY separate
            # fields from dest_account_id/spendable above: those feed
            # `internal_inflows` (see `_build_cashflow_response`), and a
            # credit card must never receive a mirrored inflow. These fields
            # are read only by the amount_basis/suppressed handling above
            # and by any future UI wanting to show which card a repayment
            # series pays off; `internal_inflows`'s two read sites both key
            # off `dest_account_id`, never `card_dest_account_id`.
            "card_dest_account_id":   card_dest["dest_account_id"] if card_dest else None,
            "card_dest_account_name": card_dest["dest_account_name"] if card_dest else None,
            "card_dest_account_bank": card_dest["dest_account_bank"] if card_dest else None,
            # Present (non-None) exactly when the estimator (step 3) or the
            # cap (step 2) changed this series' projected amount away from
            # its plain trailing mean. The frontend renders these with a
            # leading "~" (agreed field name/contract, do not rename).
            "amount_basis":    amount_basis,
            # True when the linked card is currently in credit (no
            # outstanding debt): the occurrence-generation loop in
            # `_build_cashflow_response` skips emitting any bill for a
            # suppressed series rather than showing a misleading £0 payment.
            "suppressed":      suppressed,
        }

    # BNPL plan reconstruction (Part 2 of the fix — see app/services/bnpl.py).
    # Deliberately NOT part of `recurring_spend`: these are finite, contractual
    # schedules with a known instalment count, never a cadence for
    # `recurring_judge` to weigh in on (the Part 1 guard already keeps them
    # out of `_detect_recurring`'s input; this is the second reason they
    # never reach the judge — they're never even offered to it).
    # `_build_cashflow_response` turns each of these into a bill entry
    # directly (see its bnpl merge block), the same way it already merges
    # planned one-off expenses, rather than through `_occurrences`'s
    # cadence-stepping — a BNPL projection is a fixed date computed here
    # once, not a pattern to keep re-deriving future occurrences from.
    def _serialise_bnpl(p: dict) -> dict:
        acct = account_map.get(p.get("account_id") or "") if p.get("account_id") else None
        return {
            "provider":        p["provider"],
            "account_id":      p.get("account_id"),
            "account_name":    acct["name"] if acct else None,
            "account_bank":    acct.get("provider") if acct else None,
            "account_balance": acct["balance"] if acct else None,
            "is_credit_card":  acct.get("is_credit_card", False) if acct else False,
            "amount":          round(p["amount"], 2),
            "date":            p["date"].isoformat(),
            "instalment":      p["instalment"],
            "of":              p["of"],
            "plan_anchor":     p["plan_anchor"].isoformat(),
            # True only for the FINAL instalment of a plan reconstructed from
            # fewer than 3 observed instalments — a refund cancels remaining
            # instalments with no bank-feed signal, so this amount must never
            # read as promised. `_build_cashflow_response` reuses the same
            # `amount_basis: "balance_estimate"` contract the frontend
            # already renders with a leading "~" for every other uncertain
            # projected amount (see `_serialise_pattern` above) — this is
            # not a balance estimate, but it is the codebase's one existing
            # per-item "don't treat this figure as fact" marker, and reusing
            # it means the hedge renders correctly without a frontend change.
            "hedged":          p["hedged"],
        }

    bnpl_commitments = [_serialise_bnpl(p) for p in build_bnpl_projections(bnpl_debits)]

    return {
        "recurring_spend":  [_serialise_pattern(r) for r in recurring_spend],
        "bnpl_commitments": bnpl_commitments,
        "recurring_income": [
            {**_serialise_pattern(r), "occurrences": r.get("occurrences"), "amounts_recent": r.get("amounts_recent")}
            for r in recurring_income
        ],
        # The engine's own vetoes (app/services/recurring_judge.py) — kept
        # distinct from the user's `dismissed_recurring` preference, with the
        # reason and timestamp, so a future UI can surface "Sorted set this
        # aside: <reason>" without conflating the two.
        "engine_vetoed_recurring": engine_vetoed_recurring,
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
        # Fresh data invalidates the response caches (same-process memory
        # layer here; the per-user data version bump below is what actually
        # makes every OTHER process's cached entries — and Mongo's — stale,
        # bounded at 6h if a version-bump signal is ever missed).
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
    # Current-window boundary is EXCLUSIVE of payday day itself (2026-08-28
    # decision — see app/services/pay_period.py's in_current_window
    # docstring): a bill/income/inflow scheduled ON payday belongs to the
    # NEXT pay period's arithmetic, not this badge's. Last-day lookahead
    # (days_to_pay <= 1) is unchanged, encoded inside the helper.
    from app.services.pay_period import in_current_window as _in_window
    window_bills  = [b for b in resp["upcoming_bills"]  if _in_window(b["days_away"], _days_to_pay)]
    window_income = [i for i in resp["upcoming_income"] if _in_window(i["days_away"], _days_to_pay)]
    window_inflows = [n for n in resp["internal_inflows"] if _in_window(n["days_away"], _days_to_pay)]

    # Skip bills where we have no balance data, or the bill is on a credit
    # card (credit cards have a credit limit, not an available balance, so a
    # bill against one must never count toward at-risk/shortfall). A
    # genuinely overdrawn CURRENT account's own bills stay assessable — see
    # `is_assessable_bill`'s docstring (2026-09-01 fix) and the sims-lockstep
    # note there; this must match companion.py's `assessable_bills` and
    # spend_impact._cashflow_window byte-for-byte.
    assessable_bills = [b for b in window_bills if is_assessable_bill(b)]
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
    events: list[tuple[int, str, float, bool, str]] = []  # (days_away, acct_id, amount, is_income, kind)
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False, b.get("kind")))
    for i in window_income:
        acct = str(i.get("account_id") or "")
        if acct in running and income_credit_ok(i, acct, _confirmed_keys):
            events.append((i["days_away"], acct, float(i["amount"]), True, None))
    # Mirror internal transfers: an outbound movement bill above already
    # consumed balance on its SOURCE account; the matching inbound credit on
    # its learned DESTINATION account (see `_learn_transfer_destinations`)
    # must be credited here too, or that destination is walked as if it
    # never receives money it is actually about to receive. This is the
    # exact bug this pairing exists to fix (HSBC/NatWest/Monzo falsely "at risk" from
    # Barclays's own outbound standing order). Only credited to an account
    # the walk already tracks (`acct in running`): an inflow must never seed
    # a brand-new account into the simulation, since an account with no
    # assessable bill of its own can never be "at risk" in the first place.
    for n in window_inflows:
        acct = str(n.get("account_id") or "")
        if acct in running:
            events.append((n["days_away"], acct, float(n["amount"]), True, None))

    events.sort(key=lambda e: (e[0], 1 if e[3] else 0))  # bills before income on the same day (conservative)

    at_risk = 0
    for days_away, acct, amount, is_income, kind in events:
        if is_income:
            running[acct] = running.get(acct, 0.0) + amount
        else:
            bal = running.get(acct, 0.0)
            # Deficit cascades (same semantics as companion.py's shortfall
            # walk): a bounced bill still debits the running balance, so every
            # later bill on a short account counts until income recovers it —
            # for EVERY kind, movement included, since it genuinely still
            # empties the account and can still bounce a later bill.
            running[acct] = bal - amount
            # But a `movement` bill bouncing is never itself counted toward
            # this badge — it's the user's own plan for their own money, not
            # an obligation that can fail expensively — matching the Planning
            # page's own at-risk simulation (frontend, PlanningPage.tsx),
            # which this badge must agree with (it links straight to that
            # page). A commitment/discretionary bill a movement starves still
            # counts, same as Planning's `movementCulprit` handling.
            if bal < amount and kind != MOVEMENT:
                at_risk += 1

    return {"count": at_risk}


@router.post("/cashflow/dismiss-recurring")
async def dismiss_recurring(body: dict, user: dict = Depends(current_user)):
    """'Not a bill': permanently exclude a merchant from upcoming-payment
    prediction and rebuild the cashflow cache.

    Also stamps `dismissed_recurring_meta[key]` = {dismissed_at: now,
    hidden: false} — the undo-log's own record of *when* this happened,
    kept alongside (never instead of) `dismissed_recurring`, which stays
    the bare list of excluded keys and the sole source of truth for
    exclusion itself. See GET /dismissed-series for how the two combine.
    """
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    meta = dict(prefs.get("dismissed_recurring_meta") or {})
    meta[key] = {"dismissed_at": datetime.now(), "hidden": False}
    await preferences_col.update_one(
        {"user_id": uid},
        {
            "$addToSet": {"dismissed_recurring": key},
            "$set": {"user_id": uid, "dismissed_recurring_meta": meta},
        },
        upsert=True,
    )
    await compute_and_cache_cashflow(uid, clear_ai_cache=False)
    return {"ok": True}


@router.post("/cashflow/restore-recurring")
async def restore_recurring(body: dict, user: dict = Depends(current_user)):
    """Undo a dismiss: allow the merchant back into predictions and rebuild.

    Removes both the key (from `dismissed_recurring`) and its meta entry
    (from `dismissed_recurring_meta`) — a restored series has nothing left
    for the undo-log to track, so no meta should linger for it.
    """
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    meta = dict(prefs.get("dismissed_recurring_meta") or {})
    meta.pop(key, None)
    await preferences_col.update_one(
        {"user_id": uid},
        {"$pull": {"dismissed_recurring": key}, "$set": {"dismissed_recurring_meta": meta}},
    )
    await compute_and_cache_cashflow(uid, clear_ai_cache=False)
    return {"ok": True}


# ── Undo-log: /dismissed-series ─────────────────────────────────────────
#
# Owner decision, 2026-08-28 (verbatim intent): entries older than 60 days
# are hidden from the user's view (the exclusion itself continues
# regardless); a "delete" completely hides the entry from view "but we
# still know never to include it" — the key is retained forever. This is a
# pure VISIBILITY layer over two existing exclusion mechanisms
# (dismissed_recurring, engine_vetoed_recurring) — nothing here ever makes
# a key start projecting again except the explicit override endpoint.

DISMISSED_SERIES_WINDOW_DAYS = 60
# How far back to scan the user's own transaction history for display
# enrichment (display_name/bank/typical_amount/cadence_label/last_seen) —
# matches the 180-day window `_compute_cashflow_patterns` already reads for
# recurring-BILL detection, so a series enrichment sees the same evidence
# the detector itself would have.
_ENRICH_LOOKBACK_DAYS = 180


def _within_window(ts, now: datetime, days: int = DISMISSED_SERIES_WINDOW_DAYS) -> bool:
    """True when `ts` is within `days` of `now`. Takes `now` explicitly
    (never calls datetime.now() itself) so callers — and tests — can pin
    the reference instant precisely rather than racing the wall clock
    around a day boundary. `ts` may be a real datetime (the normal case,
    both storage sites below use datetime.now()/judged_at) or, defensively,
    an ISO string."""
    if ts is None:
        return False
    if isinstance(ts, str):
        try:
            ts = datetime.fromisoformat(ts)
        except ValueError:
            return False
    if not isinstance(ts, datetime):
        return False
    delta = now - ts
    return timedelta(0) <= delta <= timedelta(days=days)


def _stamp_missing_meta(dismissed: list, meta: dict, now: datetime) -> tuple[dict, bool]:
    """Lazy migration for `dismissed_recurring` keys that predate
    `dismissed_recurring_meta`: stamp dismissed_at=now, hidden=false the
    first time this runs for a given key. Deliberately NOT backdated to the
    (unknown) original dismissal — the 60-day undo-log clock starts at
    migration, so the owner gets one full review window on legacy
    dismissals rather than every pre-existing dismissal instantly aging out
    of view the moment this feature ships. Returns (possibly-unchanged
    meta, whether anything changed) so the caller only writes when needed.
    """
    updated = dict(meta)
    changed = False
    for key in dismissed:
        if key not in updated:
            updated[key] = {"dismissed_at": now, "hidden": False}
            changed = True
    return updated, changed


def _cadence_label_for_dates(dates: list) -> str | None:
    """Plain-English cadence phrase for /dismissed-series display only —
    NOT used by the detector (_detect_recurring keeps its own, stricter,
    interval-tolerance gates). Returns None whenever the pattern isn't
    clean enough to name with confidence, rather than guessing."""
    if len(dates) < 2:
        return None
    days = sorted(d.date() if hasattr(d, "date") else d for d in dates)
    intervals = [(days[i] - days[i - 1]).days for i in range(1, len(days))]
    avg = sum(intervals) / len(intervals)
    spread = max(intervals) - min(intervals)
    if 25 <= avg <= 35:
        return "monthly" if spread <= 4 else "roughly monthly"
    if 20 <= avg <= 45:
        return "roughly monthly"
    if 5 <= avg <= 9:
        return "weekly"
    return None


async def _enrich_dismissed_keys(uid: str, keys: set) -> dict:
    """Best-effort display fields for each series `key`, derived from the
    user's own recent transaction history via the SAME `series_key`
    bucketing `_detect_recurring` uses (not reinvented). A key with no
    matching transactions in `_ENRICH_LOOKBACK_DAYS` — a very old
    dismissal, or an engine veto whose evidence has since rolled off —
    falls back to the raw key as display_name and None for the rest,
    rather than failing the whole listing.
    """
    empty = {"display_name": None, "bank": None, "typical_amount": None,
              "cadence_label": None, "last_seen": None}
    if not keys:
        return {}

    cutoff = datetime.now() - timedelta(days=_ENRICH_LOOKBACK_DAYS)
    proj = {"merchant_name": 1, "description": 1, "amount": 1, "date": 1, "account_id": 1}
    raw: list = await transactions_col.find({"user_id": uid, "date": {"$gte": cutoff}}, proj).to_list(None)
    raw += await yapily_transactions_col.find({"user_id": uid, "date": {"$gte": cutoff}}, proj).to_list(None)

    buckets: dict = defaultdict(list)
    for t in raw:
        k = series_key(t)
        if k in keys:
            buckets[k].append(t)

    bank_by_account: dict = {}
    if any(buckets.values()):
        acct_proj = {"provider": 1}
        for col in (accounts_col, yapily_accounts_col):
            async for a in col.find({"user_id": uid}, acct_proj):
                bank_by_account[str(a["_id"])] = a.get("provider")

    result: dict = {}
    for key in keys:
        items = sorted(buckets.get(key, []), key=lambda t: t["date"])
        if not items:
            result[key] = {**empty, "display_name": key}
            continue
        latest = items[-1]
        display_name = (latest.get("merchant_name") or latest.get("description") or key).strip() or key
        amounts = sorted(abs(float(t.get("amount", 0))) for t in items)
        typical_amount = round(amounts[len(amounts) // 2], 2)
        last_seen_dt = latest["date"]
        last_seen = (last_seen_dt.date() if hasattr(last_seen_dt, "date") else last_seen_dt).isoformat()
        acct_id = latest.get("account_id")
        bank = bank_by_account.get(str(acct_id)) if acct_id else None
        result[key] = {
            "display_name": display_name,
            "bank": bank,
            "typical_amount": typical_amount,
            "cadence_label": _cadence_label_for_dates([t["date"] for t in items]),
            "last_seen": last_seen,
        }
    return result


def _iso(v):
    return v.isoformat() if hasattr(v, "isoformat") else v


@router.get("/dismissed-series")
async def dismissed_series(user: dict = Depends(current_user)):
    """The undo-log: every user dismissal and engine veto still within the
    60-day review window and not individually hidden. Filtering happens
    entirely server-side — a hidden or stale row never reaches the client.
    """
    uid = user["email"]
    now = datetime.now()
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    dismissed = list(prefs.get("dismissed_recurring") or [])
    vetoed_hidden = set(prefs.get("vetoed_hidden") or [])

    meta, migrated = _stamp_missing_meta(dismissed, dict(prefs.get("dismissed_recurring_meta") or {}), now)
    if migrated:
        await preferences_col.update_one(
            {"user_id": uid},
            {"$set": {"dismissed_recurring_meta": meta, "user_id": uid}},
            upsert=True,
        )

    user_keys = [
        k for k in dismissed
        if not (meta.get(k) or {}).get("hidden")
        and _within_window((meta.get(k) or {}).get("dismissed_at"), now)
    ]

    cached = await cashflow_cache_col.find_one({"_id": uid}) or {}
    engine_entries = [
        e for e in (cached.get("engine_vetoed_recurring") or [])
        if e.get("key") not in vetoed_hidden and _within_window(e.get("vetoed_at"), now)
    ]

    enrichment = await _enrich_dismissed_keys(uid, set(user_keys) | {e["key"] for e in engine_entries})

    user_rows = [
        {**enrichment[k], "key": k, "dismissed_at": _iso((meta.get(k) or {}).get("dismissed_at"))}
        for k in user_keys
    ]
    engine_rows = [
        {
            **enrichment[e["key"]], "key": e["key"],
            "reason": e.get("reason"), "confidence": e.get("confidence"),
            "vetoed_at": _iso(e.get("vetoed_at")),
        }
        for e in engine_entries
    ]
    return {"user": user_rows, "engine": engine_rows}


@router.post("/dismissed-series/hide")
async def hide_dismissed_series(body: dict, user: dict = Depends(current_user)):
    """Hide (or, hidden=false, un-hide) one undo-log row from GET
    /dismissed-series without touching the exclusion it represents — a
    "delete" in the owner's language. For provenance="user" this flips
    `dismissed_recurring_meta[key].hidden`; for "engine" it adds/removes
    `key` from `vetoed_hidden`. `hidden=false` exists specifically so the
    client's undo toast can reverse a hide through this same endpoint,
    without a second mechanism.

    Both provenances 404 on a `key` that doesn't refer to a real row,
    matching shape — otherwise an arbitrary string could grow
    `vetoed_hidden` unboundedly with nothing to ever unhide. Engine
    UNHIDE is the one asymmetric case: it validates against
    `vetoed_hidden` membership instead of the live veto list, because the
    veto entry may legitimately have rolled off `engine_vetoed_recurring`
    (a re-judge, a dismiss, a recompute) by the time the user's undo toast
    fires — an unhide for a key you previously hid must still succeed.
    """
    uid = user["email"]
    key = (body.get("key") or "").strip()
    provenance = body.get("provenance")
    hidden = bool(body.get("hidden"))
    if not key or provenance not in ("user", "engine"):
        raise HTTPException(400, "key and provenance ('user'|'engine') required")

    if provenance == "user":
        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        dismissed = list(prefs.get("dismissed_recurring") or [])
        if key not in dismissed:
            raise HTTPException(404, "not a dismissed key")
        meta, _ = _stamp_missing_meta(dismissed, dict(prefs.get("dismissed_recurring_meta") or {}), datetime.now())
        entry = dict(meta.get(key) or {"dismissed_at": datetime.now()})
        entry["hidden"] = hidden
        meta[key] = entry
        await preferences_col.update_one(
            {"user_id": uid},
            {"$set": {"dismissed_recurring_meta": meta, "user_id": uid}},
            upsert=True,
        )
    else:
        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        cached = await cashflow_cache_col.find_one({"_id": uid}) or {}
        vetoed_keys = {e.get("key") for e in (cached.get("engine_vetoed_recurring") or [])}
        if hidden:
            if key not in vetoed_keys:
                raise HTTPException(404, "not a vetoed key")
        else:
            vetoed_hidden = set(prefs.get("vetoed_hidden") or [])
            if key not in vetoed_keys and key not in vetoed_hidden:
                raise HTTPException(404, "not a vetoed key")
        op = {"$addToSet": {"vetoed_hidden": key}} if hidden else {"$pull": {"vetoed_hidden": key}}
        await preferences_col.update_one(
            {"user_id": uid}, {**op, "$set": {"user_id": uid}}, upsert=True
        )
    return {"ok": True}


@router.post("/dismissed-series/override")
async def override_engine_veto(body: dict, user: dict = Depends(current_user)):
    """User says "this IS recurring": permanently exempt `key` from the
    engine's veto (recurring_judge.apply_verdicts skips it for good, even
    across re-judges — see that function's docstring) and let it back into
    the live projection immediately via the same cache rebuild dismiss/
    restore already trigger.

    404s when `key` is neither a live veto nor an existing override —
    same "don't let an arbitrary string grow this list" guard as the hide
    endpoint. A repeat override of a key already in `judge_overrides` is
    treated as idempotent success, not an error, since re-submitting an
    override you already hold is a legitimate no-op for a client, not a
    mistaken key.
    """
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    judge_overrides = set(prefs.get("judge_overrides") or [])
    if key not in judge_overrides:
        cached = await cashflow_cache_col.find_one({"_id": uid}) or {}
        vetoed_keys = {e.get("key") for e in (cached.get("engine_vetoed_recurring") or [])}
        if key not in vetoed_keys:
            raise HTTPException(404, "not a vetoed key")

    await preferences_col.update_one(
        {"user_id": uid},
        {"$addToSet": {"judge_overrides": key}, "$set": {"user_id": uid}},
        upsert=True,
    )
    # Belt-and-braces: drop the now-stale cached veto entry immediately,
    # in addition to the full recompute below (which would also drop it
    # via apply_verdicts, but a recompute failure must not leave a
    # contradictory cached entry sitting alongside the fresh override).
    await cashflow_cache_col.update_one({"_id": uid}, {"$pull": {"engine_vetoed_recurring": {"key": key}}})
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
    await response_cache.ainvalidate(uid)
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
            r = await openrouter_chat(
                {"model": "anthropic/claude-haiku-4-5", "max_tokens": 300,
                 "messages": [{"role": "user", "content": prompt}]},
                user_id=uid, pipeline="cashflow_rule_preview", client=client,
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
    """Reconstruct the time-sensitive cashflow response from stored patterns.

    Pass `prefs` (the user's preferences doc) when the caller has already
    fetched it, to avoid a duplicate find_one per request."""
    today = datetime.now()
    today_d = today.date()
    # 35 days covers any monthly pay period; the frontend clips to period end.
    # Weekly-ish bills repeat within the window instead of showing once.
    window_end = today + timedelta(days=35)

    spend_patterns  = cached.get("recurring_spend", [])
    income_patterns = cached.get("recurring_income", [])

    # Every `upcoming_bills` entry carries a `kind` (discretionary /
    # commitment / movement), resolved through the shared kind map — never a
    # hardcoded set — so consumers can tell "council tax" (commitment) apart
    # from "transfer to my own savings" (movement): both consume balance and
    # both belong in the projection, but only one is a genuine risk. No uid
    # (one caller, notifications.py, doesn't have one) falls back to the
    # built-in kinds only — no custom-category overrides, but never crashes.
    kind_map = await get_category_kinds(uid) if uid else CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))

    # --- observation index for bill matching ---
    observed: dict = {}
    if uid:
        _obs_since = today - timedelta(days=PENDING_GIVE_UP_DAYS + OBSERVATION_LOOKBACK_DAYS + 1)
        async def _load_recent_observations(_col):
            rows = []
            try:
                async for _t in _col.find(
                    {"user_id": uid, "date": {"$gte": _obs_since}, "transaction_type": "debit"},
                    {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
                     "category": 1, "custom_category": 1, "account_id": 1}
                ):
                    rows.append(_t)
            except Exception:
                return []
            return rows

        # These collections are independent and both have a user/date index.
        # Reading them concurrently keeps a warm cashflow response from paying
        # the sum of two database round trips before Planning can render.
        _obs_batches = await asyncio.gather(*(
            _load_recent_observations(_col)
            for _col in [transactions_col, yapily_transactions_col]
        ))
        _obs_pipeline_results = [row for batch in _obs_batches for row in batch]
        for _t in _obs_pipeline_results:
            # No category filter here (Transfer included): the projected
            # bill list itself can now contain Transfer-category outflows
            # (see the debits filter in `_compute_cashflow_patterns`), so
            # excluding Transfer from the observation index would leave
            # those bills permanently "pending" — never matched to the real
            # posting that already closed them.
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

    # --- pending observation index: bank-side PENDING debits (see
    # app/services/pending_transactions.py) -- same shape as `observed`
    # above, sourced from the sibling pending collection instead of
    # `transactions_col`. `_match_observed` (settled) is always checked
    # FIRST at every call site below; this index is only ever consulted as
    # a fallback, so a settled debit always takes priority over a pending
    # one for the same occurrence and nothing double-counts. The age filter
    # is the query-time half of the sweep backstop the module docstring
    # describes (the sync-time half runs inside `replace_pending_for_account`).
    pending_observed: dict = {}
    if uid:
        _pending_cutoff = datetime.utcnow() - timedelta(days=PENDING_TXN_MAX_AGE_DAYS)
        try:
            async for _pt in pending_transactions_col.find(
                {"user_id": uid, "first_seen": {"$gte": _pending_cutoff}},
                {"merchant_name": 1, "description": 1, "amount": 1, "date": 1, "account_id": 1},
            ):
                _pkey = series_key(_pt)
                if not _pkey:
                    continue
                _praw_d = _pt.get("date")
                _pd_obj = _praw_d.date() if hasattr(_praw_d, "date") else _praw_d
                pending_observed.setdefault(_pkey, []).append({
                    "date": _pd_obj,
                    "amount": abs(float(_pt.get("amount", 0))),
                    "account_id": str(_pt.get("account_id") or ""),
                    "used": False,
                })
        except Exception:
            pass

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

    def _match_pending_observed(key, account_id, expected_amount, expected_d):
        """Same tolerances/contention rule as `_match_observed`, sourced from
        `pending_observed` instead. Only ever consulted after `_match_observed`
        returns False at every call site -- a settled debit always wins."""
        tol = max(2.0, abs(expected_amount) * 0.15)
        lo = expected_d - timedelta(days=OBSERVATION_LOOKBACK_DAYS)
        for tx in pending_observed.get(key, []):
            if tx["used"]:
                continue
            if not (lo <= tx["date"] <= today_d):
                continue
            if account_id and tx["account_id"] and tx["account_id"] != str(account_id):
                continue
            if abs(tx["amount"] - abs(expected_amount)) > tol:
                continue
            tx["used"] = True   # one pending debit closes at most one occurrence
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
                # Monthly bills step using the SAME anchor descriptor
                # `_detect_recurring` derived (day-of-month / EOM / nth-
                # weekday — see `_monthly_anchor`), not a fresh
                # day-carried-forward guess. Without this, a second
                # occurrence of a weekday-anchored bill inside the same
                # 35-day window (possible when `next_date` falls early
                # enough) would silently reuse the day-of-month clamp logic
                # and land on the wrong date. `_NO_MONTHLY_ANCHOR` (key
                # entirely absent, not merely `None`=EOM) means a cached
                # doc predates this field — fall back to the pre-existing
                # day-carry-forward behaviour rather than misread absence
                # as "confirmed EOM".
                _anchor = r.get("monthly_anchor", _NO_MONTHLY_ANCHOR)
                year  = d.year + (1 if d.month == 12 else 0)
                month = 1 if d.month == 12 else d.month + 1
                if _anchor is _NO_MONTHLY_ANCHOR:
                    day = min(d.day, monthrange(year, month)[1])
                    d = d.replace(year=year, month=month, day=day)
                else:
                    nd = _advance_month_to_anchor(d.date(), _anchor)
                    d = datetime(nd.year, nd.month, nd.day)
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
    # Mirrored inbound events for own-transfer bills with a learned
    # destination (see `_learn_transfer_destinations`). A balance-walk
    # input only, built alongside `raw_bills` so every mirror inherits
    # exactly the gates its source occurrence passed. Never merged into
    # `upcoming_income`/balances/totals below; see the doctrine comment on
    # the returned `internal_inflows` key.
    raw_internal_inflows: list = []
    # Occurrences matched to a bank-side PENDING debit (`_match_pending_observed`
    # above) -- the account balance already reflects them, so unlike every
    # other entry in `raw_bills` they must NEVER enter a walk-facing list.
    # Kept wholly separate so at_risk_count, companion.py, spend_impact.py,
    # the payday plan, and the frontend Planning walk all inherit the
    # exclusion for free (none of them read this key) without needing to
    # know pending transactions exist at all -- the "do NOT patch sims
    # individually" requirement this satisfies. Surfaced only for DISPLAY
    # via the response's `observed_pending_bills` key.
    raw_observed_pending_bills: list = []
    for r in spend_patterns:
        if r.get("suppressed"):
            # Card-repayment series whose linked card is currently in credit
            # (see `_card_repayment_projection`, step 2): no payment is
            # coming, so no bill is emitted for it at all rather than a
            # misleading £0 entry.
            continue
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
            # Bank-side PENDING debit (see app/services/pending_transactions.py):
            # the account balance already reflects this occurrence even
            # though our settled feed hasn't caught up yet. Checked only
            # as a fallback -- `_match_observed` above always wins when
            # both would match, so a settled debit is never shadowed by a
            # stale pending row. Bypasses the give-up horizon below (a
            # pending row is, for every practical purpose, already
            # resolved) so it can never lapse while still genuinely
            # pending; if the pending row later vanishes without settling,
            # this simply evaluates to False again next call and the
            # occurrence falls straight back into the ordinary give-up
            # check -- no persisted state, no double-firing.
            observed_pending = bool(uid) and _match_pending_observed(r["key"], r.get("account_id"), final_amount, D)
            if not observed_pending and D < today_d and (today_d - D).days >= PENDING_GIVE_UP_DAYS:
                continue          # give-up horizon: skipped this cycle
            pending = (D <= today_d) and not observed_pending  # due date arrived/passed, nothing (settled or pending) observed yet
            display_d = _next_working_day(max(D, today_d)) if pending else _next_working_day(D)
            if display_d > window_end.date():
                continue
            _occ_kind = kind_of(kind_map, r.get("category"))
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
                "kind":            _occ_kind,
                # Present (non-None) exactly when `_card_repayment_projection`
                # (steps 2+3) replaced or reduced this amount away from the
                # plain trailing mean -- see `_serialise_pattern`. Frontend
                # renders these amounts with a leading "~".
                "amount_basis":    r.get("amount_basis"),
                "edited":          edited,
                "rule_label":      rules.get(r["key"], {}).get("label"),
                "pending":         pending,
                "observed_pending": observed_pending,
                "days_past_due":   (today_d - D).days if pending else 0,
                "original_date":   final_date if display_d.isoformat() != final_date else None,
                # Stamped so the frontend's POOLED "£X left" runway (the
                # Planning list) can skip BOTH legs of a traced internal
                # transfer between two of the user's own spendable accounts:
                # for that pooled total the transfer is a no-op, but the
                # existing per-account walks (at_risk_count, companion.py,
                # spend_impact.py) still need the debit + the mirrored
                # `internal_inflows` credit exactly as before, so this only
                # ever ADDS a hint to the bill row, never removes the debit
                # itself. Only ever non-None for a MOVEMENT-kind occurrence
                # whose source pattern cleared `_learn_transfer_destinations`'s
                # evidence gate (same values `_serialise_pattern` already put
                # on the cached pattern); every other bill, and the planned
                # one-off branch below (never carries a learned destination),
                # leaves both fields None.
                "dest_account_id":        r.get("dest_account_id") if _occ_kind == MOVEMENT else None,
                "dest_account_spendable": r.get("dest_account_spendable") if _occ_kind == MOVEMENT else None,
                # Display name/bank for the two `_serialise_pattern` destination
                # pairs (self-transfer and card-repayment, kept deliberately
                # separate -- see the doctrine on `card_dest_account_id` above)
                # so a caller can name WHERE a movement is going without ever
                # touching `account_map`/Mongo itself (penny_chips.py's
                # home_payday_due chip is the first consumer). Same MOVEMENT
                # gate as the pair above -- these are user-chosen account
                # labels, not bank settlement narratives, so unlike `name`
                # they are safe to show verbatim.
                "dest_account_name":      r.get("dest_account_name") if _occ_kind == MOVEMENT else None,
                "dest_account_bank":      _bank_label(r.get("dest_account_bank")) if _occ_kind == MOVEMENT else None,
                "card_dest_account_name": r.get("card_dest_account_name") if _occ_kind == MOVEMENT else None,
                "card_dest_account_bank": _bank_label(r.get("card_dest_account_bank")) if _occ_kind == MOVEMENT else None,
            })
        # collision guard: a rolled pending occurrence must never duplicate/overtake the next cycle
        kept = []
        for i, e in enumerate(entries):
            nxt = entries[i + 1] if i + 1 < len(entries) else None
            if e["pending"] and nxt is not None and e["expected_date"] >= nxt["expected_date"]:
                continue
            kept.append(e)
        # Split AFTER the collision guard (which must see the full picture,
        # same as before) -- an observed-pending occurrence never joins the
        # walk-facing `raw_bills` list (see `raw_observed_pending_bills`
        # above), only the display-only one, and is excluded from the
        # weekly-projection/mirrored-inflow bookkeeping below exactly the
        # same way a CLOSED (settled-match) occurrence already is (it never
        # reaches `entries` at all).
        walk_kept = [e for e in kept if not e["observed_pending"]]
        raw_observed_pending_bills.extend(e for e in kept if e["observed_pending"])
        raw_bills.extend(walk_kept)
        for e in walk_kept:
            if not e.get("planned"):
                _bill_occ_dates.append((_date.fromisoformat(e["expected_date"]), e["amount"]))
            # Mirror this occurrence into an inbound event on its learned
            # destination account. Every gate the outbound occurrence itself
            # just passed (per-occurrence overrides, `_match_observed`
            # closure, the give-up horizon, the working-day roll, the
            # collision guard above) is inherited for free, because this
            # only ever looks at what actually survived into `kept`. If the
            # outbound occurrence gets dropped, its mirror is never built at
            # all. `dest_account_id` is only ever populated for a MOVEMENT-
            # kind series (see `_learn_transfer_destinations`), so the kind
            # check here is belt-and-braces against a future caller
            # attaching a destination to something else. Planned one-off
            # expenses (merged in below from `planned_docs`) never carry a
            # learned destination and so are never mirrored.
            if (r.get("dest_account_id") and e["kind"] == MOVEMENT
                    and r["dest_account_id"] != e.get("account_id")):
                raw_internal_inflows.append({
                    "name":                e["name"],
                    "amount":              e["amount"],
                    "expected_date":       e["expected_date"],
                    "days_away":           e["days_away"],
                    "account_id":          r["dest_account_id"],
                    "account_name":        r.get("dest_account_name"),
                    "account_bank":        _bank_label(r.get("dest_account_bank")),
                    "source_account_id":   e["account_id"],
                    "source_account_name": e["account_name"],
                    # True only when the destination is inside the
                    # SPENDABLE pool (`_split_balances`'s own rule, via
                    # `_account_pool_kind` -- see `_learn_transfer_destinations`).
                    # A savings destination is still mirrored here (the
                    # per-account walks below genuinely need it), but a
                    # POOLED consumer must use this flag to skip crediting
                    # an inflow against a pool that structurally never
                    # contained the destination account -- e.g. a standing
                    # order into a savings pot must not be netted against
                    # spendable_balance, only against the savings figure.
                    "destination_spendable": bool(r.get("dest_account_spendable")),
                })
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
                "kind":            kind_of(kind_map, "Planned"),
                "edited":          False,
                "rule_label":      None,
                "planned":         True,
                "planned_id":      str(pdoc["_id"]),
                "pending":         pending,
                "days_past_due":   (today_d - pdate_d).days if pending else 0,
                "original_date":   pdate_d.isoformat() if display_d != pdate_d else None,
            })

    # ── Merge BNPL projected instalments ────────────────────────────────────
    # Turned directly into bill entries here (mirroring the planned-expense
    # merge above) rather than through `_occurrences`: each cached entry is
    # already a single fixed future date computed once in
    # `_compute_cashflow_patterns` (see `build_bnpl_projections`), not a
    # cadence to keep re-deriving occurrences from. `bnpl_commitments` is
    # recomputed from the latest observed instalments on every sync (see
    # `compute_and_cache_cashflow`'s docstring), so once a real instalment
    # posts, the next computed cache simply stops projecting it — a plan
    # reconstructed with 3 observed instalments yields no projection at all.
    # That recomputation IS this plan's closure mechanism; it is
    # deliberately not routed through `_match_observed` below (that index is
    # keyed by `series_key`, which is exactly the field a BNPL descriptor
    # defeats — see app/services/bnpl.py's module docstring).
    for bp in cached.get("bnpl_commitments", []):
        D = _date.fromisoformat(bp["date"])
        if D > window_end.date():
            continue
        if D < today_d and (today_d - D).days >= PENDING_GIVE_UP_DAYS:
            continue          # give-up horizon: same grace every other bill gets
        pending = D <= today_d
        display_d = _next_working_day(max(D, today_d)) if pending else _next_working_day(D)
        if display_d > window_end.date():
            continue
        provider, n, of = bp["provider"], bp["instalment"], bp["of"]
        raw_bills.append({
            "name":            f"{provider} instalment {n} of {of}",
            "amount":          bp["amount"],
            "expected_date":   display_d.isoformat(),
            "days_away":       (display_d - today_d).days,
            "account_id":      bp.get("account_id"),
            "account_name":    bp.get("account_name"),
            "account_bank":    _bank_label(bp.get("account_bank")),
            "account_balance": bp.get("account_balance"),
            "is_credit_card":  bp.get("is_credit_card", False),
            "category":        "BNPL",
            "kind":            COMMITMENT,
            # Reuses the existing "~"-render contract (see `_serialise_bnpl`'s
            # comment) for the FINAL projected instalment of a plan
            # reconstructed from fewer than 3 observed instalments — a
            # refund can cancel it silently, so it must never read as a
            # promised charge.
            "amount_basis":    "balance_estimate" if bp.get("hedged") else None,
            "edited":          False,
            "rule_label":      None,
            "pending":         pending,
            "days_past_due":   (today_d - D).days if pending else 0,
            "original_date":   bp["date"] if display_d.isoformat() != bp["date"] else None,
            "dest_account_id":        None,
            "dest_account_spendable": None,
            "bnpl": {
                "provider":    provider,
                "instalment":  n,
                "of":          of,
                "plan_anchor": bp["plan_anchor"],
            },
        })

    upcoming_bills = sorted(raw_bills, key=lambda x: (x["days_away"], -x["amount"]))
    internal_inflows = sorted(raw_internal_inflows, key=lambda x: x["days_away"])
    observed_pending_bills = sorted(raw_observed_pending_bills, key=lambda x: (x["days_away"], -x["amount"]))

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
        # Mirrored inbound legs of the user's own outbound movement bills
        # (see the `raw_internal_inflows` comment above and
        # `_learn_transfer_destinations`). Deliberately a SEPARATE key from
        # `upcoming_income`, not merged into it, not summed into
        # `available_balance`/`spendable_balance`/`savings_balance`,
        # `weekly_projection`, or any income total below. A self-transfer is
        # not income, and stock/flow never mix in this codebase (see the
        # net-position doctrine). This is a balance-walk INPUT only; callers
        # (analytics.at_risk_count, companion.compute_today_items,
        # spend_impact._bills_risk) credit it to its destination account
        # inside their own running-balance simulations and nowhere else.
        "internal_inflows":  internal_inflows,
        # Occurrences matched to a bank-side PENDING debit (see
        # app/services/pending_transactions.py and `_match_pending_observed`
        # above) -- DISPLAY ONLY. The account balance already reflects
        # these, so they are deliberately absent from `upcoming_bills` (and
        # therefore from every at-risk/shortfall/payday-plan/runway walk
        # that consumes it); consumers wanting to show "left earlier today,
        # still settling" copy read this list separately.
        "observed_pending_bills": observed_pending_bills,
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

    # Allocations — read live (cheap queries), never baked into
    # cashflow_cache_col: a mid-period fill or a newly created/edited
    # allocation must show up on the very next request, not after the next
    # cache recompute. Attached here at response-build time regardless of
    # whether `resp` came from the cache or a live compute above. Planning
    # subtracts `remaining` from its "to last" figure client-side using this
    # same enriched shape (see app/routers/allocations.py). Failure-tolerant
    # so a broken allocation never breaks the whole cashflow response.
    try:
        from app.routers.allocations import list_active_allocations
        resp["allocations"] = await list_active_allocations(uid)
    except Exception:
        logger.exception("allocations attach failed for %s — omitting", uid)
        resp["allocations"] = []

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
    3. Sum LIVE balances of spendable current accounts only. Yapily accounts
       are eligible only while their consent remains AUTHORIZED, matching
       GET /accounts; stale records from a revoked consent must never become
       phantom cash here.
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
    6. safe_to_spend = min_running_balance − buffer − commitments_reserved.
    6c. safe_to_spend_cash = safe_to_spend at this point (pre-card-reserve).
        Reserve any unpaid credit-card growth this period
        (`net_position.card_growth_unpaid`) so a user funding life on a card
        never reads as having spare cash. safe_to_spend then becomes this NET
        figure — the single source of truth every downstream engine (pace,
        spend_impact, can_i) reads. See app/services/net_position.py.
    7. Compute state: comfortable / tight / short (on the NET figure), plus
       short_reason ("bills" vs "cards" — see net_position.short_reason_for).
    8. estimated = True when history is thin (n_months < 2).

    Kenya note: this pooled cash runway currently has UK-provider and GBP
    semantics. It must return insufficient_data for Kenya rather than claim
    a zero-cash UK result from an unsupported account universe.

    NOTE — `net_position` (period_net's period-to-date income/outflow/
    card-growth flow frame) is deliberately NOT computed here, unlike
    card_growth_unpaid above, and is NOT attached to this endpoint's
    response either (owner decision, 2026-08: the Home card's period-to-date
    ledger that used to read it was removed from the frontend). This
    function is also called directly, bypassing the 90s response cache, from
    several hot paths (can_i.py's payday-status/affordability/what-if
    handlers, planned.py's one-off preview) that never needed net_position —
    attaching a full-period transaction scan + get_category_kinds read to
    every one of those calls would be a real perf regression regardless.
    `period_net` itself still lives in app/services/net_position.py; its
    only consumer now is spend_impact.compute_spend_impact's net-negative
    permission gate, which fetches it directly, on its own request path.
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
    _region   = await _get_region(uid)
    if _region == "Kenya":
        # This endpoint's balance pool deliberately understands only UK GBP
        # connected accounts. Returning an ordinary `ok` response seeded at
        # £0 for a Kenya user is materially worse than withholding a verdict.
        return {
            "status": "insufficient_data",
            "calculation_status": "unsupported",
            "unavailable_components": ["kenya_spendable_cash"],
        }
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

    all_accs_raw = await _safe_to_spend_accounts(uid)

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
    raw_window_bills = [
        b for b in upcoming_bills
        if 0 <= b["days_away"] < days_until_payday
    ]
    # The seed is the pooled balance of every spendable account, so a traced
    # transfer between two accounts in that same pool must remove neither leg.
    # This is the backend equivalent of Planning's isPooledNoOp rule.
    window_bills = [b for b in raw_window_bills if not _is_pooled_spendable_transfer(b)]
    pooled_transfers_excluded = round(sum(
        float(b["amount"]) for b in raw_window_bills
        if _is_pooled_spendable_transfer(b)
    ), 2)
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
    min_running = _safe_to_spend_lowest_projected_balance(
        spendable_cash, window_bills, window_income
    )

    # ── 6. safe_to_spend = min_running − buffer ────────────────────────────────
    buffer = float(_prefs.get("safe_to_spend_buffer", 0.0))
    safe_to_spend = round(min_running - buffer, 2)

    # ── 6b. Commitments reserve ───────────────────────────────────────────────
    # Per-period slices promised to named future expenses come out BEFORE the
    # state/verdict is derived, so Safe-to-Spend never shows money that is
    # already spoken for. Failure-tolerant: any error → zero reserve.
    commitments_reserved = 0
    commitments_count = 0
    unavailable_components: list[str] = []
    try:
        from app.routers.commitments import total_reserved_slices
        commitments_reserved, commitments_count = await total_reserved_slices(uid)
        if commitments_reserved:
            safe_to_spend = round(safe_to_spend - commitments_reserved, 2)
    except Exception:
        logger.exception("commitments reserve failed for %s", uid)
        # Keep a backwards-compatible numeric verdict, but make the missing
        # reserve explicit. Callers must not treat this degraded result as an
        # unconditional spending permission.
        unavailable_components.append("commitments_reserve")
        commitments_reserved, commitments_count = 0, 0

    # ── 6b-2. Allocations reserve ─────────────────────────────────────────────
    # Simple per-pay-period envelopes (owner decision, 2026-08-29): only the
    # UNFILLED remainder of each active allocation is ever subtracted here —
    # filled money has already left the balance pool (it's sitting, spent, in
    # the fill account), so subtracting the full amount on top would
    # double-count it. See app/routers/allocations.py's module docstring.
    # Failure-tolerant: any error → zero reserve, matching the pattern above.
    allocations_reserved = 0.0
    allocations_count = 0
    try:
        from app.routers.allocations import total_reserved_remaining
        allocations_reserved, allocations_count = await total_reserved_remaining(uid)
        if allocations_reserved:
            safe_to_spend = round(safe_to_spend - allocations_reserved, 2)
    except Exception:
        logger.exception("allocations reserve failed for %s", uid)
        unavailable_components.append("allocations_reserve")
        allocations_reserved, allocations_count = 0.0, 0

    # ── 6c. Card growth reserve ────────────────────────────────────────────────
    # See app/services/net_position.py's module docstring: the figure above is
    # a forward-looking cash STOCK that never sees credit-card balance growth,
    # so it can hand out spending permission the user is quietly funding on a
    # card. Reserve any unpaid card growth this period, net of any scheduled
    # card payment already inside `window_bills` (the double-count guard).
    # Failure-tolerant: any error → zero reserve, matching the pattern above.
    safe_to_spend_cash = safe_to_spend
    card_growth_reserved = 0.0
    try:
        from app.services.net_position import card_growth_unpaid
        _period_start, _ = get_pay_period_for_date(_today_d, _pay_cfg)
        card_growth_reserved = await card_growth_unpaid(uid, _period_start, _today_d, window_bills)
        if card_growth_reserved:
            safe_to_spend = round(safe_to_spend - card_growth_reserved, 2)
    except Exception:
        logger.exception("card growth reserve failed for %s", uid)
        unavailable_components.append("card_growth_reserve")
        card_growth_reserved = 0.0

    # A spending-permission calculation must fail closed. Retain the result
    # shape for direct callers, but never grant positive headroom when a known
    # reserve could not be loaded. The API health fields let presentation
    # layers explain the outage instead of presenting this sentinel as a real
    # shortfall.
    if unavailable_components:
        safe_to_spend = min(safe_to_spend, 0.0)

    # ── 7. State: comfortable / tight / short ─────────────────────────────────
    # "tight" threshold: below £100 or below ~10% of monthly discretionary spend,
    # whichever is higher — calibrated to be meaningful but not alarmist.
    # Derived on the NET figure (post card-growth-reserve), so every
    # downstream engine (pace, spend_impact, can_i) inherits the conservative
    # number.
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

    # short_reason distinguishes a genuine bills-risk short (safe_to_spend_cash
    # itself non-positive — the only case that earns red) from a short that's
    # purely card-funded spending (bills ARE covered). Pure derivation lives in
    # net_position.short_reason_for so it's unit-testable in isolation.
    from app.services.net_position import short_reason_for
    short_reason = None if unavailable_components else short_reason_for(state, safe_to_spend_cash)

    # ── 8. estimated flag ────────────────────────────────────────────────────
    estimated = _cf.get("n_months", 3) < 2

    _sync_ts = await last_bank_sync(uid)

    # `net_position` (period_net's income/outflow/card-growth flow frame) is
    # deliberately NOT computed here. compute_safe_to_spend is called
    # directly — bypassing the 90s response cache below — from several hot
    # paths (can_i.py's payday-status/affordability/what-if handlers,
    # planned.py's one-off preview, which calls it twice) that never read
    # net_position; it exists purely for the Home card's period-to-date
    # ledger. A full-period transaction scan across two collections plus a
    # get_category_kinds read on every one of those calls would be a real
    # perf regression. It's attached to the result in get_safe_to_spend
    # below instead, so only the cached GET /safe-to-spend response pays
    # for it, once per 90s per user.
    return {
        "status":              "ok",
        "calculation_status":  "degraded" if unavailable_components else "complete",
        "unavailable_components": unavailable_components,
        "safe_to_spend":       safe_to_spend,
        "safe_to_spend_cash":  safe_to_spend_cash,
        "next_payday":         next_payday.isoformat(),
        "days_until_payday":   days_until_payday,
        "bills_total":         bills_total,
        "pooled_transfers_excluded": pooled_transfers_excluded,
        "income_before_payday": income_before,
        "buffer":              buffer,
        "state":               state,
        "short_reason":        short_reason,
        "estimated":           estimated,
        "spendable_now":       round(spendable_cash, 2),
        # The actual floor reached by the date-ordered bill/income walk.
        # This (rather than aggregate bills/income totals) is the missing
        # reconciling bridge from spendable_now to safe_to_spend_cash.
        "lowest_projected_balance": round(min_running, 2),
        "payday_income":       payday_income,
        "card_debt":           card_debt,
        "card_growth_reserved": card_growth_reserved,
        "commitments_reserved": int(commitments_reserved),
        "commitments_count":   commitments_count,
        "commitments_reserved_period_label": (
            _period_rhythm_label(_pay_cfg) if commitments_reserved else None
        ),
        "allocations_reserved": allocations_reserved,
        "allocations_count":   allocations_count,
        "last_synced":         _sync_ts.isoformat() if _sync_ts else None,
    }


async def get_cached_safe_to_spend(uid: str) -> dict:
    """Read-through for compute_safe_to_spend's hot direct callers (can_i.py's
    suggestions/refusal-fallback, grow.py's period gate, planned.py's
    before/after preview) that only ever need the base facts above, never
    net_position or pace — see compute_safe_to_spend's own docstring for why
    those direct callers bypass the response cache and skip net_position.

    Reuses GET /safe-to-spend's version-pinned, 6h-bounded cache (name
    "safe_to_spend" / "safe_to_spend_series") when a Home/Penny visit
    already populated it this window: same cache entries, so no separate
    cache namespace to keep in sync. That entry is a superset (base fields +
    "pace") — these callers only read base fields, so the extra "pace" key
    is harmless to ignore.

    Never WRITES to the cache itself, mirroring the established precedent in
    spend_impact.py's `_headroom()`: only get_safe_to_spend owns writes to
    this key, since it's the only caller that attaches the "pace" block —
    writing a bare compute_safe_to_spend() result here would leave a
    pace-less entry for any reader expecting the full GET /safe-to-spend
    shape, for up to the cache's TTL.
    """
    cached = await response_cache.aget("safe_to_spend", uid)
    if cached is None:
        cached = await response_cache.aget("safe_to_spend_series", uid)
    if cached is not None:
        return cached
    return await compute_safe_to_spend(uid)


async def build_safe_to_spend_response(uid: str, include_series: bool = False) -> dict:
    """Pure compute for GET /safe-to-spend's payload — compute_safe_to_spend's
    base facts plus the attached pace block. Deliberately does NOT cache
    anything itself: GET /safe-to-spend wraps this with its own aget/aput
    (below), and app.services.warmup.warm_user calls this directly and
    aputs the result itself, so the two call sites can never drift on what
    this endpoint's shape actually is."""
    result = await compute_safe_to_spend(uid)
    if result.get("status") == "ok":
        try:
            from app.services.pace import compute_pace
            result = {**result, "pace": await compute_pace(uid, include_series=include_series, sts=result)}
        except Exception:
            logger.exception("pace computation failed for %s", uid)
    return result


@router.get("/safe-to-spend")
async def get_safe_to_spend(include: str = "", user: dict = Depends(current_user)):
    """Headline verdict + pace reading. `?include=series` adds the per-day pace series."""
    uid = user["email"]
    want_series = "series" in {p.strip() for p in include.split(",")}
    cache_name = "safe_to_spend_series" if want_series else "safe_to_spend"

    # ── 0. Mongo-backed response cache (6h safety bound; exact invalidation
    # via the per-user data version — see app/services/response_cache.py) ────
    _cached_resp = await response_cache.aget(cache_name, uid)
    if _cached_resp is not None:
        return _cached_resp

    v = await response_cache.snapshot(uid)
    result = await build_safe_to_spend_response(uid, include_series=want_series)
    if result.get("status") == "ok":
        await response_cache.aput(cache_name, uid, result, version=v)
        # grow.py's cached "/grow" payload embeds a period gate derived from
        # THIS endpoint's figure (via get_cached_safe_to_spend below); retire
        # it now so the next /grow read recomputes against this fresher
        # moment instead of serving an older one for up to 6h (backlog B1).
        await response_cache.adrop("grow", uid)
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
    cached = await response_cache.aget(cache_name, uid)
    if cached is not None:
        return cached
    v = await response_cache.snapshot(uid)
    from app.services.pace import compute_pace_detail
    result = await compute_pace_detail(uid, offset=off)
    if result.get("status") == "ok":
        await response_cache.aput(cache_name, uid, result, version=v)
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
    cached = await response_cache.aget(cache_name, uid)
    if cached is not None:
        return cached
    v = await response_cache.snapshot(uid)
    from app.services.pace import compute_category_signals
    result = await compute_category_signals(uid, offset=off)
    await response_cache.aput(cache_name, uid, result, version=v)
    return result


async def _flagged_miscategorised(uid: str, exclude_ids: frozenset = frozenset()) -> list:
    """Shared guardrail query: debit rows that look like own-account transfers
    (matched via user_identity/is_own_transfer) but sit in a spend category
    rather than a money-to-self category. Excludes rows/series already
    dismissed. Returns flat list of annotated txn docs (adds _series_key and
    _effective_category).

    `exclude_ids` (owner device-testing fix 2) — the id of any transaction
    that is currently a leg of a live transfer-pair suggestion (see
    _transfer_pair_suggestions). Without this, a transaction could be asked
    about TWICE in the same review sheet: once as a pair-suggestion leg, once
    again inside its miscategorised series — reproduced live with a −£965
    "To Kevin Maingi" debit that was both the pair-suggestion's debit leg AND
    a member of the "To Kevin Maingi 2×" series. The pair is the better ask
    (it fixes both legs and learns the description pair), so the pair wins
    and the transaction is filtered out here, BEFORE grouping into series —
    a series keeps its other members; only the specific flagged row that's
    also a pair leg drops out. Callers must compute the pair-suggestion set
    first and pass every leg id (credit and debit) in here."""
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
        if tid in exclude_ids:
            continue
        sk = series_key(t)
        if sk in dismissed_series:
            continue
        text = f"{t.get('merchant_name') or ''} {t.get('description') or ''}"
        evidence = own_transfer_evidence(text, identity, own_account_id=t.get("account_id"))
        if evidence is not None:
            t["_series_key"] = sk
            t["_effective_category"] = t.get("custom_category") or t.get("category")
            t["_evidence"] = evidence
            kept.append(t)

    return kept


async def _resolve_period_bounds(uid: str, offset: int) -> tuple[_date, _date]:
    """Same pattern as pace.py's compute_pace_detail: walk back from today's
    pay period `offset` times. offset is expected pre-clamped to [-60, 0]."""
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today = _date.today()
    period_start, period_end = get_pay_period_for_date(today, pay_cfg)
    for _ in range(-offset):
        period_start, period_end = prev_pay_period(period_start, pay_cfg)
    return period_start, period_end


def _series_touching_period(txns: list, period_start: _date, period_end: _date) -> set:
    """Series keys (see series_key/_series_key) that have at least one member
    transaction dated inside [period_start, period_end] — used to scope the
    Spend page's miscategorised banner to the current pay period without
    losing a series' full history for grouping/display."""
    keys = set()
    for t in txns:
        d = t.get("date")
        if d is None:
            continue
        d_date = d.date() if hasattr(d, "date") else d
        if period_start <= d_date <= period_end:
            keys.add(t["_series_key"])
    return keys


def _group_miscategorised(txns: list) -> list:
    """Group flagged transactions by recurrence series (_series_key). Each
    group's representative is its most recent member. Each result also
    carries `account_id` (the representative's) and `members` (up to 20
    individual transactions, date-descending) so the review sheet can list
    the actual payments behind a group, not just its representative row."""
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
            "account_id": rep.get("account_id") or "",
            # Real per-row evidence for the reason the representative was
            # flagged as an own-transfer: {"kind": "account", "account_id": ...}
            # or {"kind": "name"}. Representative wins; members aren't
            # reconciled against each other.
            "reason": rep.get("_evidence"),
            # Individual transactions behind this series, date-descending
            # (members is already sorted that way), capped at 20 — lets the
            # review sheet list the actual payments rather than just the
            # representative row.
            "members": [
                {
                    "id": str(m["_id"]),
                    "date": _iso(m.get("date")),
                    "amount": m.get("amount"),
                    "account_id": m.get("account_id") or "",
                    "description": m.get("description"),
                    "merchant_name": m.get("merchant_name"),
                }
                for m in members[:20]
            ],
        })

    result.sort(key=lambda g: g.get("date") or "", reverse=True)
    return result


def _pair_leg_ids(pairs: list[dict]) -> frozenset:
    """Every transaction id (both legs) across a list of transfer-pair
    suggestions — see _flagged_miscategorised's `exclude_ids` doc for why
    (owner device-testing fix 2: one transaction, one ask)."""
    ids: set[str] = set()
    for p in pairs:
        ids.add(p["credit"]["id"])
        ids.add(p["debit"]["id"])
    return frozenset(ids)


@router.get("/transactions/miscategorised-count")
async def get_miscategorised_count(offset: int = 0, user: dict = Depends(current_user)):
    """Read-only guardrail feeding the Spend page's quiet banner: how many
    recurring-transfer SERIES look like own-account transfers (matched via
    user_identity/is_own_transfer) but are sitting in a spend category rather
    than one of the money-to-self categories. Diagnostic only — does not
    write anything.

    Scoped to the requested pay period (offset: 0 = current, negative = prior
    closed periods, clamped to [-60, 0] like /spend/verdict and friends) — a
    series only counts here if at least one of its members falls inside that
    period. Without this, mostly-historical series sat next to period-scoped
    figures elsewhere on the Spend page and inflated the banner. The sibling
    review-sheet endpoint (/transactions/miscategorised) deliberately stays
    all-time — it's a standalone "clean up your history" surface, not
    period-anchored.

    Additive field `review_total` breaks from the period-scoped semantics
    above on purpose: it's the all-time count the review sheet will actually
    show (series + pairs), so the Spend banner can say "N to review" and
    have tapping it land on exactly N items instead of a smaller
    period-scoped number. `count` and `pair_count` stay period-scoped
    unchanged for whatever other UI still keys off them."""
    uid = user["email"]
    off = max(-60, min(0, int(offset)))
    cache_name = f"miscategorised_count:{off}"
    cached = await response_cache.aget(cache_name, uid)
    if cached is not None:
        return cached
    v = await response_cache.snapshot(uid)

    # Pair suggestions computed FIRST (owner device-testing fix 2) so their
    # leg ids can be filtered out of the flagged-series set below — one
    # transaction gets one ask, and the pair (fixes both legs + learns) beats
    # the series ask. This also feeds `pair_count` further down, unchanged.
    pairs = await _transfer_pair_suggestions(uid)
    txns = await _flagged_miscategorised(uid, exclude_ids=_pair_leg_ids(pairs))
    period_start, period_end = await _resolve_period_bounds(uid, off)
    in_period_keys = _series_touching_period(txns, period_start, period_end)
    period_txns = [t for t in txns if t["_series_key"] in in_period_keys]

    groups = _group_miscategorised(period_txns)

    def _leg_in_period(leg: dict) -> bool:
        d = leg.get("date")
        if not d:
            return False
        try:
            leg_date = _date.fromisoformat(str(d)[:10])
        except ValueError:
            return False
        return period_start <= leg_date <= period_end

    pair_count = sum(1 for p in pairs if _leg_in_period(p["credit"]) or _leg_in_period(p["debit"]))

    # review_total: the all-time total the review sheet will actually show
    # (every flagged series, not just this period's, plus every suggested
    # pair, already capped at 10 by _transfer_pair_suggestions itself) — so
    # the Spend banner can report exactly what tapping it reveals. `count`
    # and `pair_count` above stay period-scoped, unchanged, for other UI.
    review_total = len(_group_miscategorised(txns)) + len(pairs)

    result = {"count": len(groups), "ids": [g["id"] for g in groups][:50], "pair_count": pair_count, "review_total": review_total}
    await response_cache.aput(cache_name, uid, result, version=v)
    return result


@router.get("/transactions/miscategorised")
async def get_miscategorised_transactions(user: dict = Depends(current_user)):
    """Grouped rows behind the miscategorised-transfers guardrail, for the
    'review miscategorised transfers' sheet. Recurring transfers (same payee,
    different dates) collapse to one series entry; dismissing a series hides
    all its members, past and future.

    A transaction that is currently a leg of a live transfer-pair suggestion
    (this same sheet's own "Possibly the same transfer" section) is excluded
    here (owner device-testing fix 2) — the pair is the better ask, and a
    transaction must only be asked about once per sheet."""
    uid = user["email"]
    cache_name = "miscategorised_list"
    cached = await response_cache.aget(cache_name, uid)
    if cached is not None:
        return cached
    v = await response_cache.snapshot(uid)

    pairs = await _transfer_pair_suggestions(uid)
    items = _group_miscategorised(await _flagged_miscategorised(uid, exclude_ids=_pair_leg_ids(pairs)))[:50]
    result = {"items": items}
    await response_cache.aput(cache_name, uid, result, version=v)
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
    response_cache.invalidate(uid, "transfer_pair_suggestions")
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
    response_cache.invalidate(uid, "transfer_pair_suggestions")
    return {"ok": True}


# ── Cross-account transfer-pair suggestions ─────────────────────────────────
# Owner-designed companion to the miscategorised-transfers guardrail above.
# The sync-time matcher (categorisation.py Pass 2) only pairs a credit+debit
# when their normalised descriptions are byte-identical; when the two legs of
# a real transfer carry different descriptions (different bank rails,
# different narrative text) it never matches and the debit sits in spend.
# This surface finds those candidate pairs, lets the user confirm/reject them
# in the same "Review these transfers" sheet, and LEARNS a confirmed pair
# (keyed on the description PAIR, via canonical_merchant_key) so future
# occurrences auto-match at the next sync — see
# POST /transactions/confirm-transfer-pair and categorisation.py's
# learned-pair pass in Pass 2.

# Month/date-fragment tokens that survive the alphabetic-only regex below
# (numeric dates never match `[A-Za-z]+` so don't need listing here) — a
# statement line sharing only "aug" or "on" with another isn't evidence of
# anything, it's the two banks' shared date-stamping vocabulary.
_MONTH_TOKENS = {
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
}

# Generic UK bank-narrative boilerplate: words that show up on huge swathes
# of UNRELATED statement lines (any "payment", any "transfer", any "direct
# debit") and so carry no evidence of a link between two SPECIFIC
# transactions, the same way a channel code or month doesn't. Confirmed live
# (owner review fix 2 follow-up): "DIRECT DEBIT PAYMENT 1432" and "NATWEST
# INITIAL PAYMENT" shared only the word "payment" and were flagged as an
# unrelated coincidence, not a real transfer pair.
_GENERIC_BANKING_TOKENS = {
    "payment", "payments", "paid", "pay", "transfer", "transfers", "transferred",
    "deposit", "deposits", "withdrawal", "withdrawals", "direct", "debit", "debits",
    "credit", "credits", "standing", "order", "orders", "initial", "faster",
    "request", "account", "accounts", "reference", "thank", "you", "from", "for",
    "via", "the", "and", "of", "on", "at", "in", "out", "ltd", "limited", "plc",
    "mr", "mrs", "ms", "dr", "bank", "banking", "card", "cards", "online", "mobile",
    "new", "not", "your", "with", "ref",
}


def _meaningful_tokens(text: str) -> set[str]:
    """Alphabetic tokens >=3 chars from `text`, excluding rail/channel codes
    (FT, BGC, FP, ...), month names, and generic bank-narrative boilerplate
    — the vocabulary two UNRELATED statement lines are likely to share by
    pure coincidence (evidence-gate fix 2: a shared "atm"/"bgc"/"aug"/
    "payment" is not evidence of a real transfer)."""
    out: set[str] = set()
    for tok in re.findall(r"[A-Za-z]+", text or ""):
        if len(tok) < 3:
            continue
        low = tok.lower()
        if tok.upper() in _CHANNEL_CODES:
            continue
        if low in _MONTH_TOKENS or low in _GENERIC_BANKING_TOKENS:
            continue
        out.add(low)
    return out


def _leg_tokens(t: dict) -> set[str]:
    return _meaningful_tokens(f"{t.get('merchant_name') or ''} {t.get('description') or ''}")


def _is_distinctive_amount(amount) -> bool:
    """True when `amount` carries non-zero pence (owner review fix 2
    follow-up). Round amounts are exactly where cross-account amount+date
    coincidences concentrate — confirmed live: a round £20.00 "Payment from
    <owner's name>" credit coincided with an unrelated £20.00 YouTube
    Premium debit purely by chance. A distinctive pence amount is far less
    likely to coincide with an unrelated transaction, so it's allowed to
    lean on weaker (one-leg) identity evidence; a round amount is not."""
    if amount is None:
        return False
    return abs(amount - round(amount)) > 0.005


def _has_pair_evidence(c: dict, d: dict, identity: dict) -> bool:
    """Evidence gate for a candidate transfer-pair suggestion (owner review
    fix 2, tightened after a follow-up false positive): same amount + close
    dates alone is not enough — two unrelated transactions can coincide on
    both by chance (confirmed live: a client-income credit paired with an
    unrelated ATM withdrawal; separately, a round-amount credit that merely
    NAMES the owner paired with an unrelated subscription debit). Require
    at least one of:
      (a) `own_transfer_evidence` fires on BOTH legs' own texts — each side
          independently looks like an own-account movement, not just one, or
      (b) the two legs' texts share a meaningful token (>=3 chars,
          alphabetic, not a rail/channel code, not a month name, not generic
          banking boilerplate) — e.g. both sides carry "Main G" or a shared
          reference/payee fragment, or
      (c) `own_transfer_evidence` fires on exactly ONE leg AND the amount is
          distinctive (non-zero pence) — one-leg evidence alone is too weak
          exactly where coincidences concentrate: small ROUND amounts. A
          distinctive pence amount is enough corroboration to accept it.
    """
    c_text = f"{c.get('merchant_name') or ''} {c.get('description') or ''}"
    d_text = f"{d.get('merchant_name') or ''} {d.get('description') or ''}"
    c_evidence = own_transfer_evidence(c_text, identity, own_account_id=c.get("account_id")) is not None
    d_evidence = own_transfer_evidence(d_text, identity, own_account_id=d.get("account_id")) is not None
    if c_evidence and d_evidence:
        return True
    if _leg_tokens(c) & _leg_tokens(d):
        return True
    if (c_evidence or d_evidence) and _is_distinctive_amount(c.get("amount")):
        return True
    return False


def _too_generic_to_learn(key: str) -> bool:
    """Owner review fix 3 — a `canonical_merchant_key` must be a real
    merchant identity, not a bare rail/channel word, before it's allowed to
    become a learned pair (which would auto-stamp Transfer on every future
    row sharing it). Stronger than the original ">=3 chars" guard: an
    "atm"-class key must never be learnable, even via a direct API call that
    bypasses the suggestion-flow UI entirely."""
    if len(key) < 6:
        return True
    if " " not in key and key.upper() in _CHANNEL_CODES:
        return True
    return False


def _pair_leg(t: dict) -> dict:
    """Serialise one leg of a suggested transfer pair for the API response."""
    d = t.get("date")
    return {
        "id": str(t["_id"]),
        "account_id": t.get("account_id") or "",
        "date": d.isoformat() if hasattr(d, "isoformat") else d,
        "amount": t.get("amount"),
        "description": t.get("description"),
        "merchant_name": t.get("merchant_name"),
        # "Effective category" — custom_category always wins when present,
        # though candidates with a custom_category on either leg are excluded
        # from suggestion entirely (manual choices always win — see below).
        "category": t.get("custom_category") or t.get("category"),
    }


async def _transfer_pair_suggestions(uid: str) -> list[dict]:
    """Candidate cross-account transfer pairs the sync-time byte-identical
    matcher missed: a credit + a debit that look like the two legs of one
    real transfer (same amount, close dates, different accounts) but carry
    different descriptions.

    Candidates come from `transactions_col` only — the same stable-_id
    caveat that applies to the miscategorised-dismiss machinery applies here
    (other providers' collections get delete-reinserted on sync, so a stored
    _id or pair_key would go stale).
    """
    kind_map = await get_category_kinds(uid)  # ONE read per request
    identity = await user_identity(uid)  # ONE read per request — evidence gate below

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    dismissed_pairs = set(prefs.get("dismissed_transfer_pairs") or [])

    learned_docs = await confirmed_transfer_pairs_col.find(
        {"user_id": uid}, {"key_a": 1, "key_b": 1}
    ).to_list(None)
    learned_pair_keys = {
        tuple(sorted((d["key_a"], d["key_b"])))
        for d in learned_docs if d.get("key_a") and d.get("key_b")
    }

    # Manual choices win only when they mean "this leg is genuinely
    # spending" (owner device-testing fix 1a) — a custom SPEND-kind category
    # blocks the pair (the user explicitly said so, don't second-guess). A
    # custom MOVEMENT-kind category (Transfer/Savings/Debt/Investment/a
    # custom movement category) does NOT block: it agrees with the transfer
    # hypothesis and ANCHORS it, so the pair still surfaces to fix the OTHER
    # leg — confirm-transfer-pair below then leaves the movement-kind leg
    # completely untouched and writes only the other. The query can no
    # longer exclude custom_category at the source, so gating moves to
    # Python (_leg_blocks_pair below).
    txns = await transactions_col.find(
        {"user_id": uid, "transaction_type": {"$in": ["credit", "debit"]}},
        {"account_id": 1, "amount": 1, "date": 1, "description": 1,
         "merchant_name": 1, "category": 1, "custom_category": 1,
         "transaction_type": 1},
    ).to_list(None)

    def _effective_category(t: dict):
        return t.get("custom_category") or t.get("category")

    def _leg_blocks_pair(t: dict) -> bool:
        cc = t.get("custom_category")
        return cc is not None and is_spend(kind_map, cc)

    def _debit_needs_fixing(cat) -> bool:
        return cat == "Other" or is_spend(kind_map, cat)

    def _credit_needs_fixing(cat) -> bool:
        return cat in ("Income", "Other") or is_spend(kind_map, cat)

    credits = [t for t in txns if t.get("transaction_type") == "credit" and t.get("date") is not None]
    debits  = [t for t in txns if t.get("transaction_type") == "debit" and t.get("date") is not None]

    def _day(t):
        d = t["date"]
        return d.date() if hasattr(d, "date") else d

    candidates = []  # (date_diff, amount, credit, debit, pair_key)
    for c in credits:
        c_day = _day(c)
        for d in debits:
            if abs((c.get("amount") or 0) - (d.get("amount") or 0)) >= 0.02:
                continue
            if c.get("account_id") == d.get("account_id"):
                continue
            date_diff = abs((c_day - _day(d)).days)
            if date_diff > 1:
                continue
            # Identical normalised descriptions are Pass 2's job at sync
            # time — this path exists precisely for the pairs that ISN'T.
            if _byte_desc_key(c) == _byte_desc_key(d):
                continue
            if _leg_blocks_pair(c) or _leg_blocks_pair(d):
                continue
            # Actionability (fix 1b) — at least one leg must still need
            # fixing: the debit's effective category is spend-kind or
            # Other, or the credit's effective category is Income, Other,
            # or spend-kind. Both legs already movement-kind -> genuinely
            # nothing to do -> skip.
            c_eff = _effective_category(c)
            d_eff = _effective_category(d)
            if not (_debit_needs_fixing(d_eff) or _credit_needs_fixing(c_eff)):
                continue
            # Evidence gate (owner review fix 2) — same amount + close dates
            # is not enough on its own; reject a coincidence like a £50
            # client-income credit paired with an unrelated £50 ATM debit.
            if not _has_pair_evidence(c, d, identity):
                continue
            pair_key = ":".join(sorted([str(c["_id"]), str(d["_id"])]))
            if pair_key in dismissed_pairs:
                continue
            c_key = canonical_merchant_key(c.get("merchant_name") or "", c.get("description") or "")
            d_key = canonical_merchant_key(d.get("merchant_name") or "", d.get("description") or "")
            # A learned description-pair auto-matches at the next sync — no
            # need to ask again.
            if tuple(sorted((c_key, d_key))) in learned_pair_keys:
                continue
            candidates.append((date_diff, c.get("amount") or 0, c, d, pair_key))

    # Greedy matching: nearest date-diff first (same-day beats 1-day), then
    # largest amount first, then pair_key as a final deterministic tiebreak
    # (owner review fix 5) — the Mongo find() above has no explicit sort, so
    # without this, two candidates tied on date-diff and amount could order
    # differently between requests depending on unspecified document order,
    # making the greedy match's outcome non-deterministic.
    candidates.sort(key=lambda x: (x[0], -x[1], x[4]))

    used_credits: set = set()
    used_debits: set = set()
    suggestions = []
    for date_diff, amount, c, d, pair_key in candidates:
        if c["_id"] in used_credits or d["_id"] in used_debits:
            continue
        used_credits.add(c["_id"])
        used_debits.add(d["_id"])
        suggestions.append({
            "pair_key": pair_key,
            "date_diff_days": date_diff,
            "credit": _pair_leg(c),
            "debit": _pair_leg(d),
        })

    suggestions.sort(key=lambda s: s["credit"]["amount"] or 0, reverse=True)
    return suggestions[:10]


@router.get("/transactions/transfer-pair-suggestions")
async def get_transfer_pair_suggestions(user: dict = Depends(current_user)):
    """Grouped candidate cross-account transfer pairs for the 'Review these
    transfers' sheet's own section, above the miscategorised groups."""
    uid = user["email"]
    cache_name = "transfer_pair_suggestions"
    cached = await response_cache.aget(cache_name, uid)
    if cached is not None:
        return cached
    v = await response_cache.snapshot(uid)
    items = await _transfer_pair_suggestions(uid)
    result = {"items": items}
    await response_cache.aput(cache_name, uid, result, version=v)
    return result


@router.post("/transactions/confirm-transfer-pair")
async def confirm_transfer_pair(body: dict, user: dict = Depends(current_user)):
    """Confirm a suggested pair as one real transfer: categorise both legs
    through the same refinement semantics as the sync-time matcher's Pass 2.6
    (categorisation.py's `refine_transfer_target`), then learn the
    description pair so future occurrences auto-match at the next sync."""
    uid = user["email"]
    credit_id = body.get("credit_id")
    debit_id = body.get("debit_id")
    if not credit_id or not debit_id:
        raise HTTPException(400, "Provide 'credit_id' and 'debit_id'")

    # `transactions_col` stores `_id` as the provider's own STRING id (e.g.
    # "trn_JkdbofZuJjsJMymXsGSXaufHFWgj" or a bare hex string) — never a Mongo
    # ObjectId. Look up by the raw string, exactly like every other
    # transactions endpoint (see resolve_movement in transactions.py). An
    # earlier version of this endpoint ran credit_id/debit_id through
    # ObjectId(v) first and 400'd "Invalid transaction id" whenever that
    # conversion failed — which was every real transaction, so confirm never
    # worked on live data. Do not reintroduce ObjectId here.
    credit_txn = await transactions_col.find_one({"_id": credit_id, "user_id": uid})
    debit_txn = await transactions_col.find_one({"_id": debit_id, "user_id": uid})
    if not credit_txn or not debit_txn:
        raise HTTPException(404, "Transaction not found")
    if credit_txn.get("transaction_type") != "credit" or debit_txn.get("transaction_type") != "debit":
        raise HTTPException(400, "credit_id must be a credit and debit_id must be a debit")
    if abs((credit_txn.get("amount") or 0) - (debit_txn.get("amount") or 0)) >= 0.02:
        raise HTTPException(400, "Amounts do not match")
    # Defence in depth (owner review fix 3) — the suggestion endpoint already
    # enforces these, but confirm must not just trust the client; a caller
    # could hit this endpoint directly with any two ids.
    if credit_txn.get("account_id") == debit_txn.get("account_id"):
        raise HTTPException(400, "credit_id and debit_id must be on different accounts")

    def _day(dt):
        return dt.date() if hasattr(dt, "date") else dt

    c_date, d_date = credit_txn.get("date"), debit_txn.get("date")
    # Slightly looser than the suggestion window's ±1 day so a pair the
    # suggestion endpoint just offered can't be rejected by a boundary
    # quirk (e.g. a timezone-adjacent date read).
    if c_date is None or d_date is None or abs((_day(c_date) - _day(d_date)).days) > 2:
        raise HTTPException(400, "credit_id and debit_id must be within 2 days of each other")

    # Owner device-testing fix 1 — a leg's custom_category only blocks
    # confirm when it's a SPEND-kind category (the user explicitly said
    # that leg is spending, don't second-guess). A custom MOVEMENT-kind
    # category (Transfer/Savings/Debt/Investment/a custom movement
    # category) is fine: that leg is left COMPLETELY untouched below (it
    # already agrees with the transfer hypothesis) and only the other leg
    # gets written.
    kind_map = await get_category_kinds(uid)

    def _blocks_confirm(cc) -> bool:
        return cc is not None and is_spend(kind_map, cc)

    if _blocks_confirm(credit_txn.get("custom_category")) or _blocks_confirm(debit_txn.get("custom_category")):
        raise HTTPException(400, "One of these transactions is confirmed as spending")

    credit_locked = credit_txn.get("custom_category") is not None
    debit_locked = debit_txn.get("custom_category") is not None

    accts = {
        str(a["_id"]): a
        async for a in accounts_col.find({"user_id": uid}, {"type": 1, "subtype": 1, "account_subtype": 1})
    }
    c_target = refine_transfer_target(accts.get(str(credit_txn.get("account_id"))))
    d_target = refine_transfer_target(accts.get(str(debit_txn.get("account_id"))))

    # Mirrors categorisation.py Pass 2.6a exactly: whichever leg sits on the
    # savings/ISA or credit-card account stays "Transfer"; the OTHER
    # (current-account) leg carries the intent. Both or neither resolving ->
    # both legs are plain "Transfer". Computed regardless of lock state —
    # only the WRITE below is conditional on it.
    if c_target and not d_target:
        credit_category, debit_category = "Transfer", c_target
    elif d_target and not c_target:
        credit_category, debit_category = d_target, "Transfer"
    else:
        credit_category, debit_category = "Transfer", "Transfer"

    # Write to the AUTO layer (`category`), NOT `custom_category` —
    # deliberate. Pass 2.5 propagates a *manual* override to every future row
    # sharing the same canonical_merchant_key; a custom "Transfer" stamped on
    # a generic rail description (e.g. "FINEXER") would contaminate every
    # future row carrying that description, regardless of real counterparty.
    # The learned description-PAIR below (not a blanket description->category
    # rule) is what makes the match durable across syncs instead. A locked
    # (custom MOVEMENT-kind) leg is skipped entirely — it's the ANCHOR, not
    # something to rewrite.
    changed: list[str] = []
    if not credit_locked:
        await transactions_col.update_one(
            {"_id": credit_id, "custom_category": None},
            {"$set": {"category": credit_category}},
        )
        changed.append("credit")
    if not debit_locked:
        await transactions_col.update_one(
            {"_id": debit_id, "custom_category": None},
            {"$set": {"category": debit_category}},
        )
        changed.append("debit")

    key_a = canonical_merchant_key(credit_txn.get("merchant_name") or "", credit_txn.get("description") or "")
    key_b = canonical_merchant_key(debit_txn.get("merchant_name") or "", debit_txn.get("description") or "")

    learned = False
    if not _too_generic_to_learn(key_a) and not _too_generic_to_learn(key_b):
        ka, kb = sorted((key_a, key_b))
        await confirmed_transfer_pairs_col.update_one(
            {"user_id": uid, "key_a": ka, "key_b": kb},
            {"$setOnInsert": {"user_id": uid, "key_a": ka, "key_b": kb, "created_at": datetime.utcnow()}},
            upsert=True,
        )
        learned = True

    response_cache.invalidate(uid, "miscategorised_count")
    response_cache.invalidate(uid, "miscategorised_list")
    response_cache.invalidate(uid, "transfer_pair_suggestions")

    # credit_category/debit_category reflect the FINAL effective category —
    # the computed target for a leg we wrote, or the pre-existing (locked)
    # custom_category for one we left alone — so the caller always sees the
    # true resulting state regardless of which leg(s) actually changed.
    final_credit_category = credit_txn.get("custom_category") if credit_locked else credit_category
    final_debit_category = debit_txn.get("custom_category") if debit_locked else debit_category

    return {
        "ok": True,
        "credit_category": final_credit_category,
        "debit_category": final_debit_category,
        "changed": changed,
        "learned": learned,
    }


@router.post("/transactions/dismiss-transfer-pair")
async def dismiss_transfer_pair(body: dict, user: dict = Depends(current_user)):
    """Dismiss a suggested transfer pair — permanent, per-instance (keyed on
    the pair of stable transaction _ids). A different month's pair sharing
    the same descriptions can still be suggested; dismissal doesn't teach the
    engine anything about that description pair."""
    uid = user["email"]
    pair_key = body.get("pair_key")
    if not pair_key:
        raise HTTPException(400, "Provide 'pair_key'")
    await preferences_col.update_one(
        {"user_id": uid},
        {"$addToSet": {"dismissed_transfer_pairs": pair_key}, "$set": {"user_id": uid}},
        upsert=True,
    )
    response_cache.invalidate(uid, "transfer_pair_suggestions")
    response_cache.invalidate(uid, "miscategorised_count")
    # Owner device-testing fix 2 — the dismissed pair's legs are no longer
    # excluded from the miscategorised list (they only lose their exclusion
    # once _pair_leg_ids no longer contains them, i.e. once the suggestions
    # list is recomputed without this pair), so the cached list must be
    # invalidated too or the transaction stays hidden from BOTH surfaces
    # until the 90s response-cache TTL expires. Without this line the
    # transaction only naturally reappears in miscategorised_list once its
    # own TTL lapses, not immediately on dismissal.
    response_cache.invalidate(uid, "miscategorised_list")
    return {"ok": True}


@router.get("/value-delivered")
async def get_value_delivered(user: dict = Depends(current_user)):
    """Return how much monthly saving the user has unlocked by acting on insights."""
    uid = user["email"]
    # Evidence-gone retirement (savings_insights.py's `retired_at`) must
    # exclude a card from this total too — it reads the same collection
    # directly, not through GET /savings-insights, so it needs its own
    # exclusion. Functionally matters here: a non-verified but "engaged"
    # insight (user_context set, a stale savings_estimate still on the doc)
    # would otherwise keep counting toward total_monthly_saving after its
    # evidence vanished and the card itself stopped rendering anywhere else.
    # `substituted_at` exclusion (Insights honesty review, incoherence A —
    # owner phone report 2026-09-01): a doc can carry `verified_savings`
    # even though the same category was subsequently (correctly) resolved
    # as `substituted` — see the tri-state repair in
    # `_refresh_savings_insights_for_user` and `_derive_insight_state` in
    # savings_insights.py, which is the source of truth for this precedence
    # everywhere else. This endpoint reads the collection directly, not
    # through `_serialize_insight`, so it needs its own guard: a substituted
    # doc must never count toward `verified_monthly_saving` here, whatever
    # residual `verified_savings` figure an unrepaired doc still carries.
    docs = await savings_insights_col.find(
        {"user_id": uid, "retired_at": {"$exists": False}, "substituted_at": {"$exists": False}},
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
