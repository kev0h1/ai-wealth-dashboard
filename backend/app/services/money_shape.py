"""Money Shape — per-pay-period Fixed/Moved/Free/Left breakdown.

Splits a completed pay period's take-home into four jobs (see PRODUCT.md /
BEHAVIOURS.md section 2, "The Facts / Voice Split"): every figure here is
deterministic, computed from transactions with no LLM involved. The verdict
sentence and trend line are fixed templates over those figures, not narrated
prose — "The Mirror Is Not A Score" means we describe the shape, we never
grade it.

Pure functions (``bucket_period``, ``shares_of``, ``verdict_for``,
``trend_line_for``, ``average_for_window``, ``average_verdict_for``,
``evaluate_patterns``, ``proposal_for``) take plain dicts/lists and touch no
database, so tests can drive them with synthetic fixtures. ``compute_money_shape``
and its cache wrappers are the only async, DB-touching pieces.

No-refetch scope selector (owner decision, superseding the earlier
``?horizon`` query param — see git history)
-----------------------------------------------------------------------------
Kevin's call: the hero card gets a client-side scope selector (a specific pay
period, or an average over N months) with NO server round trip when the user
switches scope. So the ENTIRE response — every valid completed period found
in the lookback window (``periods``, newest first, full jobs/categories) plus
pre-computed rolling averages (``averages``, one per qualifying window in
3/6/12/24 months) — is computed once, cached whole, and served whole. There is
no per-request slicing layer any more: ``compute_money_shape`` returns exactly
the response contract, ``compute_and_cache_money_shape`` stores it verbatim
plus ``computed_at``/``schema_version``, and the router returns the cached
blob unmodified. Top-level ``period``/``jobs``/``verdict``/``take_home``/
``overspent`` are kept equal to ``periods[0]`` for callers that haven't moved
to the scope selector yet.
"""
from __future__ import annotations

import calendar as _calendar
from datetime import date as _date, datetime, timedelta

from app.db.collections import (
    accounts_col,
    behaviour_portrait_col,
    money_shape_cache_col,
    preferences_col,
    transactions_col,
)
from app.services.behaviour import classify_saving_flow, savings_account_ids
from app.services.categories import MOVEMENT, get_category_kinds, is_commitment, is_discretionary, is_income, kind_of
from app.services.pay_period import get_pay_period_for_date, period_rhythm_label, prev_pay_period

# How far back (in months) to walk hunting for valid completed pay periods,
# and the hard iteration cap that bounds the walk regardless of rhythm. A
# month-bounded stop (rather than a fixed period COUNT) means weekly/biweekly
# rhythms get the same ~2-year time span as monthly ones -- 120 iterations
# comfortably covers weekly (~108 periods over 25 months) with headroom. 25
# (not 24) so the 24-month average window always has a full 24 months to draw
# from even when "today" sits early in the current period.
_LOOKBACK_MONTHS = 25
_MAX_LOOKBACK_ITERATIONS = 120

# what_works (the "what works for you" correlation) and trend_line both use
# only the most recent 6 valid periods, regardless of how many are available
# overall -- unchanged from the original (pre-scope-selector) behaviour.
_RECENT_LOOKBACK = 6

#: Rolling-average windows surfaced in "averages", in display order. An entry
#: only appears when >=2 valid periods fall inside its window (see
#: average_for_window).
_AVERAGE_WINDOWS_MONTHS = (3, 6, 12, 24)

# 1/2 are needed for average_verdict_for -- an averages window's period_count
# can be as low as 2 (the qualification minimum), unlike trend_line_for
# (which never sees fewer than 3).
_N_WORDS = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six"}

#: Bump whenever the cached response shape changes, so a stale doc from a
#: previous shape (e.g. the old horizon-sliced "trend"/"trend_summary") is
#: never served even if its computed_at TTL hasn't expired yet.
SCHEMA_VERSION = 2


# ── Pure helpers ─────────────────────────────────────────────────────────────

def _largest_remainder_pct(amounts: dict[str, float], total: float) -> dict[str, int]:
    """Integer percentages of ``total``, summing to exactly 100.

    Standard largest-remainder (Hamilton) apportionment: floor each share,
    then hand the leftover points to the entries with the largest fractional
    remainder, in dict insertion order on ties (deterministic).
    """
    keys = list(amounts.keys())
    if total <= 0:
        return {k: 0 for k in keys}
    raw = {k: (amounts[k] / total * 100) for k in keys}
    floors = {k: int(raw[k]) for k in keys}
    remainder = 100 - sum(floors.values())
    if remainder > 0:
        order = sorted(keys, key=lambda k: (raw[k] - floors[k]), reverse=True)
        for i in range(remainder):
            floors[order[i % len(order)]] += 1
    return floors


def shares_of(fixed: float, moved: float, free: float, left: float, overspent: float) -> dict[str, int]:
    """Integer shares for the four jobs.

    When ``overspent`` is 0 the shares are of take-home (fixed+moved+free+left,
    which equals take_home by construction). When overspent, ``left`` is 0 and
    the shares are computed over (fixed+moved+free) instead so they still sum
    to 100 (per brief: overspent periods have nothing left to share out).
    """
    amounts = {"fixed": fixed, "moved": moved, "free": free, "left": left}
    total = (fixed + moved + free) if overspent > 1e-9 else (fixed + moved + free + left)
    return _largest_remainder_pct(amounts, total)


def _category_totals(txns: list[dict]) -> dict[str, float]:
    """Effective category -> summed abs(amount) among ``txns``. Insertion
    order follows first appearance (used as the tie-break when sorting)."""
    totals: dict[str, float] = {}
    for t in txns:
        cat = t["category"]
        totals[cat] = totals.get(cat, 0.0) + abs(t["amount"])
    return totals


def _sorted_by_contribution(totals: dict[str, float]) -> list[str]:
    """Category names from a totals dict, sorted by contribution descending.
    Ties keep dict insertion (first-appearance) order, so the result is
    deterministic. Used to build each job's "categories" evidence -- the
    frontend builds `/transactions?categories=...` links from this, so it
    must reflect what actually summed into the job."""
    return sorted(totals.keys(), key=lambda c: totals[c], reverse=True)


def _union_categories(periods_full: list[dict], job_id: str) -> list[str]:
    """Category evidence for an averages window: sums each period's
    ``category_totals[job_id]`` across the whole window, then sorts by that
    summed contribution descending. ``periods_full`` entries are
    bucket_period dicts (any order)."""
    totals: dict[str, float] = {}
    for p in periods_full:
        for cat, amt in p["category_totals"][job_id].items():
            totals[cat] = totals.get(cat, 0.0) + amt
    return _sorted_by_contribution(totals)


def bucket_period(txns: list[dict], kinds, saving_ids: set, start: _date, end: _date) -> dict:
    """Split one pay period's transactions into the four jobs.

    ``txns`` is the FULL normalised transaction list (compute_portrait shape:
    amount/category/date "YYYY-MM-DD"/account_id/is_debit, plus an ``_id`` key
    used to keep a savings-account credit out of take_home when it's also
    counted as moved) — this function filters it to ``[start, end]`` itself.
    ``kinds`` is a category-kinds map (app.services.categories.get_category_kinds
    result or a plain dict). ``category`` on each txn is already the EFFECTIVE
    category (custom_category or category or "Other").
    """
    start_s, end_s = start.isoformat(), end.isoformat()
    period_txns = [t for t in txns if start_s <= t["date"] <= end_s]

    # Saving flow first: a credit landing on a savings/ISA account can be
    # categorised "Income" by the categoriser (payday transfer, refund, etc.)
    # and still count as type2 (an un-matched credit to a savings account) --
    # it is money MOVED, not money arriving, so it must land in exactly one
    # job. type1 is debits-only and fixed/free are also debits-only, so the
    # only route by which the same transaction could be summed into both
    # take_home and moved is via type2; excluding type2's ids from take_home
    # closes that one route.
    flow = classify_saving_flow(period_txns, saving_ids)
    type1, type2 = flow["type1"], flow["type2"]
    type2_ids = {t.get("_id") for t in type2}

    income_txns = [
        t for t in period_txns
        if not t["is_debit"] and is_income(kinds, t["category"]) and t.get("_id") not in type2_ids
    ]
    take_home = sum(abs(t["amount"]) for t in income_txns)

    fixed_txns = [t for t in period_txns if t["is_debit"] and is_commitment(kinds, t["category"])]
    fixed = sum(abs(t["amount"]) for t in fixed_txns)

    free_txns = [t for t in period_txns if t["is_debit"] and is_discretionary(kinds, t["category"])]
    free = sum(abs(t["amount"]) for t in free_txns)

    # Investment-category debits, added on top of the saving flow. type1 is
    # strictly `category == "Savings"` debits (see classify_saving_flow), so
    # an Investment-category debit can never land in type1 too -- one field,
    # one value, the two filters are mutually exclusive by construction. No
    # id-based dedupe is needed or reachable here.
    investment_extra = [t for t in period_txns if t["is_debit"] and t["category"] == "Investment"]
    moved_txns = type1 + type2 + investment_extra
    moved = sum(abs(t["amount"]) for t in moved_txns)

    left_raw = take_home - fixed - free - moved
    overspent = -left_raw if left_raw < 0 else 0.0
    left = 0.0 if left_raw < 0 else left_raw

    shares = shares_of(fixed, moved, free, left, overspent)

    # early_saving: any saving movement (type1/type2) dated in the first 7
    # days of the period (start .. start+6 inclusive).
    week1_end_s = (start + timedelta(days=6)).isoformat()
    early_saving_hit = any(start_s <= t["date"] <= week1_end_s for t in (type1 + type2))

    # calm_start: discretionary spend in the first 3 days (start .. start+2).
    day3_end_s = (start + timedelta(days=2)).isoformat()
    first3_discretionary = sum(
        abs(t["amount"]) for t in free_txns if start_s <= t["date"] <= day3_end_s
    )

    fixed_totals = _category_totals(fixed_txns)
    # moved_txns can include a type2 credit the categoriser tagged something
    # other than a movement category -- most dangerously "Income" (a salary
    # paid straight into a savings account). Its amount still counts in the
    # moved TOTAL (money moved, not spent), but it must not appear as a
    # "moved" category, or the frontend's /transactions?categories=Income
    # drill-through would list the user's salary as spend moved to savings.
    # type1 and investment_extra are always MOVEMENT-kind by construction
    # ("Savings"/"Investment"), so this filter only ever removes type2
    # stragglers.
    moved_totals = _category_totals([t for t in moved_txns if kind_of(kinds, t["category"]) == MOVEMENT])
    free_totals = _category_totals(free_txns)
    # income_txns are already is_income(...)-filtered above, so every entry
    # here is INCOME-kind by construction -- nothing further to filter.
    left_totals = _category_totals(income_txns)

    return {
        "start": start,
        "end": end,
        "take_home": take_home,
        "fixed": fixed,
        "moved": moved,
        "free": free,
        "left": left,
        "left_raw": left_raw,
        "overspent": overspent,
        "shares": shares,
        "early_saving_hit": early_saving_hit,
        "first3_discretionary": first3_discretionary,
        # Per-job category evidence -- distinct effective categories that
        # contributed to each job, sorted by contribution descending. "left"
        # is the categories of the INCOME credits that made take_home (not
        # "leftover spend", which doesn't exist as transactions).
        "categories": {
            "fixed": _sorted_by_contribution(fixed_totals),
            "moved": _sorted_by_contribution(moved_totals),
            "free": _sorted_by_contribution(free_totals),
            "left": _sorted_by_contribution(left_totals),
        },
        # Raw per-job category totals -- not part of the response contract,
        # kept so average_for_window can build a cross-period category union
        # (sorted by summed contribution) without re-touching transactions.
        "category_totals": {
            "fixed": fixed_totals,
            "moved": moved_totals,
            "free": free_totals,
            "left": left_totals,
        },
    }


def _build_jobs(fixed: float, moved: float, free: float, left: float, shares: dict, categories: dict) -> list[dict]:
    """The 4-job list shape shared by the hero/each period/each average
    entry. fixed/moved/free are debit-only jobs; left is the credit
    (income) side -- the frontend ANDs "txn_type" into its
    `/transactions?categories=...` drill-through link."""
    return [
        {"id": "fixed", "label": "Fixed (bills, debt, rent)", "amount": round(fixed, 2),
         "share": shares["fixed"], "categories": categories["fixed"], "txn_type": "debit"},
        {"id": "moved", "label": "Moved to savings", "amount": round(moved, 2),
         "share": shares["moved"], "categories": categories["moved"], "txn_type": "debit"},
        {"id": "free", "label": "Free spending", "amount": round(free, 2),
         "share": shares["free"], "categories": categories["free"], "txn_type": "debit"},
        {"id": "left", "label": "Left over", "amount": round(left, 2),
         "share": shares["left"], "categories": categories["left"], "txn_type": "credit"},
    ]


def verdict_for(fixed_share: int, free_share: int, overspent: float) -> str:
    if overspent > 1e-9:
        return (
            f"Of every £100 you take home, £{fixed_share} was spoken for before you chose anything, "
            f"and spending went £{overspent:,.0f} past what came in."
        )
    return (
        f"Of every £100 you take home, £{fixed_share} is spoken for before you choose anything. "
        f"£{free_share} is yours to spend freely."
    )


def _n_periods_label(n: int) -> str:
    """"three".."six" for n<=6 (word form), digits above that ("12")."""
    return _N_WORDS[n] if n <= 6 else str(n)


def trend_line_for(fixed_shares: list[int]) -> str | None:
    """Compares oldest vs newest of whatever window ``fixed_shares``
    represents -- callers pass the most recent 6 valid periods' fixed
    shares, oldest→newest. n<=6 uses the word form ("six"), n>6 (kept for
    robustness, not expected in practice) uses digits."""
    n = len(fixed_shares)
    if n < 3:
        return None
    n_label = _n_periods_label(n)
    delta = fixed_shares[-1] - fixed_shares[0]
    if abs(delta) >= 3:
        direction = "up" if delta > 0 else "down"
        return f"Fixed share is {direction} {abs(delta)} points over {n_label} pay periods."
    return f"Fixed share has held steady over {n_label} pay periods."


def _subtract_months(d: _date, months: int) -> _date:
    """``d`` minus ``months`` whole calendar months, clamping the day to the
    target month's length (matches the clamp pattern in pay_period.py)."""
    total = d.year * 12 + (d.month - 1) - months
    y, m = divmod(total, 12)
    m += 1
    day = min(d.day, _calendar.monthrange(y, m)[1])
    return _date(y, m, day)


def average_verdict_for(k: int, fixed_share: int, free_share: int, overspent_mean: float,
                         outflow_mean: float, take_home_mean: float) -> str:
    """Verdict for an averages window. ``outflow_mean`` is the mean of
    (fixed+moved+free) across the window's periods (un-clamped); when it
    exceeds ``take_home_mean`` the overspent form is used, quoting
    ``overspent_mean`` (the mean of each period's own clamped overspent)."""
    k_label = _n_periods_label(k)
    if outflow_mean > take_home_mean + 1e-9:
        return (
            f"Over the last {k_label} pay periods, £{fixed_share} of every £100 you took home was "
            f"spoken for before you chose anything, and spending went £{overspent_mean:,.0f} "
            f"past what came in on average."
        )
    return (
        f"Over the last {k_label} pay periods, £{fixed_share} of every £100 you took home was "
        f"spoken for before you chose anything. £{free_share} was yours to spend freely."
    )


def average_for_window(periods_newest_first: list[dict], months: int) -> dict | None:
    """One "averages" entry for a rolling window, or None if fewer than 2
    valid periods fall inside it. ``periods_newest_first`` are bucket_period
    dicts already filtered to the window (newest first) -- see
    compute_money_shape for how the window is selected."""
    k = len(periods_newest_first)
    if k < 2:
        return None

    oldest, newest = periods_newest_first[-1], periods_newest_first[0]
    take_home_mean = sum(p["take_home"] for p in periods_newest_first) / k
    overspent_mean = sum(p["overspent"] for p in periods_newest_first) / k
    fixed_mean = sum(p["fixed"] for p in periods_newest_first) / k
    moved_mean = sum(p["moved"] for p in periods_newest_first) / k
    free_mean = sum(p["free"] for p in periods_newest_first) / k
    left_mean = sum(p["left"] for p in periods_newest_first) / k

    shares = shares_of(fixed_mean, moved_mean, free_mean, left_mean, overspent_mean)
    categories = {job: _union_categories(periods_newest_first, job) for job in ("fixed", "moved", "free", "left")}
    jobs = _build_jobs(fixed_mean, moved_mean, free_mean, left_mean, shares, categories)

    outflow_mean = fixed_mean + moved_mean + free_mean
    verdict = average_verdict_for(k, shares["fixed"], shares["free"], overspent_mean, outflow_mean, take_home_mean)

    return {
        "months": months,
        "period_count": k,
        "start": oldest["start"].isoformat(),
        "end": newest["end"].isoformat(),
        "label": f"Last {months} months",
        "take_home": round(take_home_mean, 2),
        "overspent": round(overspent_mean, 2),
        "jobs": jobs,
        "verdict": verdict,
    }


def evaluate_patterns(periods: list[dict]) -> dict:
    """What works for you: correlation over the most recent 6 valid periods.

    ``periods`` is the up-to-6 valid periods used for pattern-matching,
    oldest→newest, each a ``bucket_period`` dict with a "label" key attached
    by the caller. Returns the ``what_works`` sub-object minus
    "trait"/"proposal" (added by the async caller, which is the only part of
    this that needs a DB read).
    """
    n = len(periods)
    if n < 4:
        return {
            "state": "thin",
            "periods_available": n,
            "periods_needed": 4,
            "pattern_id": None,
            "headline": "Not enough history yet.",
            "flag_labels": None,
            "evidence": [],
        }

    outcomes = [p["left_raw"] > 0 for p in periods]

    def _rate_gap(hit_flags: list[bool]) -> tuple[int, int, float, float] | None:
        hits = [o for f, o in zip(hit_flags, outcomes) if f]
        misses = [o for f, o in zip(hit_flags, outcomes) if not f]
        hit_n, miss_n = len(hits), len(misses)
        if hit_n == 0 and miss_n == 0:
            return None
        hit_rate = (sum(hits) / hit_n) if hit_n else 0.0
        miss_rate = (sum(misses) / miss_n) if miss_n else 0.0
        return hit_n, miss_n, hit_rate, miss_rate

    candidates = {}

    # 1. early_saving
    early_flags = [p["early_saving_hit"] for p in periods]
    stats = _rate_gap(early_flags)
    if stats:
        hit_n, miss_n, hit_rate, miss_rate = stats
        gap = hit_rate - miss_rate
        if hit_n >= 3 and miss_n >= 1 and gap >= 0.3:
            k = sum(1 for f, o in zip(early_flags, outcomes) if f and o)
            candidates["early_saving"] = {
                "gap": gap,
                "flags": early_flags,
                "headline": (
                    f"Pay periods where you moved money to savings in the first week "
                    f"ended with cash left over {k} times out of {hit_n}."
                ),
                "flag_labels": {"hit": "early", "miss": "late"},
            }

    # 2. calm_start
    first3_vals = sorted(p["first3_discretionary"] for p in periods)
    m = len(first3_vals)
    mid = m // 2
    threshold = first3_vals[mid] if m % 2 else (first3_vals[mid - 1] + first3_vals[mid]) / 2
    calm_flags = [p["first3_discretionary"] <= threshold for p in periods]
    stats = _rate_gap(calm_flags)
    if stats:
        hit_n, miss_n, hit_rate, miss_rate = stats
        gap = hit_rate - miss_rate
        if hit_n >= 3 and miss_n >= 1 and gap >= 0.3:
            k = sum(1 for f, o in zip(calm_flags, outcomes) if f and o)
            candidates["calm_start"] = {
                "gap": gap,
                "flags": calm_flags,
                "headline": (
                    f"Pay periods that started calm, under £{threshold:,.0f} of free spending "
                    f"in the first three days, ended with cash left over {k} times out of {hit_n}."
                ),
                "flag_labels": {"hit": "calm", "miss": "fast"},
            }

    if not candidates:
        return {
            "state": "no_pattern",
            "periods_available": n,
            "periods_needed": 4,
            "pattern_id": None,
            "headline": f"No clear pattern yet across {n} pay periods.",
            "flag_labels": None,
            "evidence": [],
        }

    pattern_id = max(candidates, key=lambda k: candidates[k]["gap"])
    chosen = candidates[pattern_id]
    evidence = [
        {
            "period": p["label"],
            "flag": "hit" if flag else "miss",
            "left_over": p["left_raw"],
        }
        for p, flag in zip(periods, chosen["flags"])
    ]

    return {
        "state": "ok",
        "periods_available": n,
        "periods_needed": 4,
        "pattern_id": pattern_id,
        "headline": chosen["headline"],
        "flag_labels": chosen["flag_labels"],
        "evidence": evidence,
    }


_PROPOSALS: dict[str, dict] = {
    "early_saving": {
        "headline": "Move your payday transfer to the first week?",
        "body": (
            "Your early periods ended with cash left over more often. Penny can help "
            "you set this up in Planning, you approve before anything moves."
        ),
        "penny_ask": "Help me move my regular savings transfer to the first week of my pay period",
    },
    "calm_start": {
        "headline": "Give the first three days a number?",
        "body": (
            "Your calm starts ended with cash left over more often. Penny can help you set "
            "a first-week allocation in Planning, you approve before anything moves."
        ),
        "penny_ask": "Help me set an allocation for the first week of my pay period",
    },
}


def proposal_for(state: str, pattern_id: str | None, trait: dict | None) -> dict | None:
    """The Consent Rule (BEHAVIOURS.md section 2): a proposal may only appear
    on a trait the user has explicitly marked "change". Keep, or no choice
    made yet, is silence — celebration only, never a nudge.
    """
    if state != "ok" or pattern_id not in _PROPOSALS:
        return None
    if not trait or trait.get("choice") != "change":
        return None
    return _PROPOSALS[pattern_id]


# ── DB-touching layer ────────────────────────────────────────────────────────

def _to_date_str(val) -> str:
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, str):
        return val[:10]
    return ""


def _period_label(start: _date, end: _date, rhythm: str | None) -> str:
    """Short label for a period: "Mar", or "w/c 3 Mar" for weekly rhythms."""
    if rhythm in ("weekly", "every 2 weeks"):
        return f"w/c {start.day} {start.strftime('%b')}"
    return end.strftime("%b")


async def compute_money_shape(uid: str) -> dict:
    """Computes the ENTIRE GET /money-shape response (see module docstring --
    there is no per-request slicing any more): hero period (top-level
    period/jobs/verdict/take_home/overspent, kept equal to periods[0]),
    trend/trend_line (most recent 6), what_works (most recent 6), every
    valid completed period found in the lookback window (``periods``, newest
    first), and rolling averages for qualifying 3/6/12/24-month windows.
    """
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    rhythm = period_rhythm_label(pay_cfg)

    kinds = await get_category_kinds(uid)
    raw_accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    saving_ids = savings_account_ids(raw_accounts)

    today = _date.today()

    # Walk back to the most recent COMPLETED pay period, then keep walking
    # back, time-bounded (not period-count-bounded) so every rhythm gets the
    # same ~2-year lookback, with a hard iteration cap as a backstop.
    start, end = get_pay_period_for_date(today, pay_cfg)
    if end >= today:
        start, end = prev_pay_period(start, pay_cfg)

    lookback_cutoff = _subtract_months(today, _LOOKBACK_MONTHS)
    period_bounds: list[tuple[_date, _date]] = []
    for _ in range(_MAX_LOOKBACK_ITERATIONS):
        if start < lookback_cutoff:
            break
        period_bounds.append((start, end))
        start, end = prev_pay_period(start, pay_cfg)

    if not period_bounds:
        return _thin_response()

    cutoff = period_bounds[-1][0]
    cutoff_dt = datetime(cutoff.year, cutoff.month, cutoff.day)

    raw_txns = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff_dt}}
    ).to_list(None)
    if not raw_txns:
        cutoff_str = cutoff.isoformat()
        raw_txns = await transactions_col.find(
            {"user_id": uid, "date": {"$gte": cutoff_str}}
        ).to_list(None)

    txns = []
    for t in raw_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        txns.append({
            "_id": str(t.get("_id")),
            "amount": float(t.get("amount", 0) or 0),
            "category": cat,
            "date": _to_date_str(t.get("date", "")),
            "account_id": str(t.get("account_id") or ""),
            "is_debit": (t.get("transaction_type") == "debit"),
        })

    valid_periods_full: list[dict] = []  # newest → oldest, FULL bucket_period dicts
    for s, e in period_bounds:
        b = bucket_period(txns, kinds, saving_ids, s, e)
        if b["take_home"] > 0:
            b["label"] = _period_label(s, e, rhythm)
            valid_periods_full.append(b)

    if not valid_periods_full:
        return _thin_response()

    # "periods": every valid completed period, newest first, full detail.
    periods_response = [
        {
            "start": p["start"].isoformat(),
            "end": p["end"].isoformat(),
            "label": p["label"],
            "take_home": round(p["take_home"], 2),
            "overspent": round(p["overspent"], 2),
            "jobs": _build_jobs(p["fixed"], p["moved"], p["free"], p["left"], p["shares"], p["categories"]),
            "verdict": verdict_for(p["shares"]["fixed"], p["shares"]["free"], p["overspent"]),
        }
        for p in valid_periods_full
    ]
    hero_entry = periods_response[0]

    # trend: ALL valid periods, oldest -> newest.
    trend_oldest_first = list(reversed(valid_periods_full))
    trend = {
        "periods": [p["label"] for p in trend_oldest_first],
        "fixed": [p["shares"]["fixed"] for p in trend_oldest_first],
        "moved": [p["shares"]["moved"] for p in trend_oldest_first],
        "free": [p["shares"]["free"] for p in trend_oldest_first],
        "left": [p["shares"]["left"] for p in trend_oldest_first],
    }

    # trend_line / what_works: most recent 6 valid periods only (unchanged
    # from the original, pre-scope-selector behaviour), oldest -> newest.
    recent = list(reversed(valid_periods_full[:_RECENT_LOOKBACK]))
    trend_line = trend_line_for([p["shares"]["fixed"] for p in recent])
    what_works = evaluate_patterns(recent)

    trait = None
    portrait = await behaviour_portrait_col.find_one({"_id": uid}) or {}
    for tr in portrait.get("traits", []):
        if tr.get("id") == "saving_habit":
            trait = {"id": tr["id"], "title": tr.get("title"), "choice": tr.get("choice")}
            break
    what_works["trait"] = trait
    what_works["proposal"] = proposal_for(what_works["state"], what_works["pattern_id"], trait)

    # averages: rolling mean over each qualifying 3/6/12/24-month window.
    averages = []
    for months in _AVERAGE_WINDOWS_MONTHS:
        window_cutoff = _subtract_months(today, months)
        window = [p for p in valid_periods_full if p["end"] >= window_cutoff]
        entry = average_for_window(window, months)
        if entry is not None:
            averages.append(entry)

    return {
        "status": "ok",
        "period": {"start": hero_entry["start"], "end": hero_entry["end"], "label": hero_entry["label"]},
        "take_home": hero_entry["take_home"],
        "overspent": hero_entry["overspent"],
        "jobs": hero_entry["jobs"],
        "verdict": hero_entry["verdict"],
        "trend": trend,
        "trend_line": trend_line,
        "what_works": what_works,
        "periods": periods_response,
        "averages": averages,
    }


def _thin_response() -> dict:
    return {
        "status": "thin",
        "period": None,
        "take_home": 0.0,
        "overspent": 0.0,
        "jobs": None,
        "verdict": None,
        "trend": {"periods": [], "fixed": [], "moved": [], "free": [], "left": []},
        "trend_line": None,
        "what_works": {
            "state": "thin",
            "periods_available": 0,
            "periods_needed": 4,
            "pattern_id": None,
            "headline": "Not enough history yet.",
            "flag_labels": None,
            "evidence": [],
            "trait": None,
            "proposal": None,
        },
        "periods": [],
        "averages": [],
    }


async def compute_and_cache_money_shape(uid: str) -> dict:
    """Background task: compute money shape and store to cache. Called after
    every sync. Stores the FULL response verbatim (no per-request slicing —
    see module docstring) plus ``computed_at`` (TTL sentinel, same convention
    as compute_and_cache_cashflow, and FastAPI auto-serialises it to an ISO
    string on the way out) and ``schema_version`` (see get_money_shape_cached).
    """
    data = await compute_money_shape(uid)
    data["computed_at"] = datetime.now()
    data["schema_version"] = SCHEMA_VERSION
    await money_shape_cache_col.update_one({"_id": uid}, {"$set": data}, upsert=True)
    return data


async def get_money_shape_cached(uid: str, ttl_hours: int = 6) -> dict:
    """Memoised money shape (TTL fallback), same pattern as
    app.services.cashflow.monthly_cashflow_cached. A cache doc whose
    ``schema_version`` doesn't match the current one is treated as stale
    regardless of its TTL — this is what lets a response-shape change (like
    this one, adding periods/averages and dropping the old horizon-sliced
    trend/trend_summary) roll out without a manual cache-wide invalidation.
    """
    cached = await money_shape_cache_col.find_one({"_id": uid})
    if cached:
        computed_at = cached.get("computed_at")
        fresh = isinstance(computed_at, datetime) and (datetime.now() - computed_at).total_seconds() < ttl_hours * 3600
        if fresh and cached.get("schema_version") == SCHEMA_VERSION:
            cached.pop("_id", None)
            return cached

    return await compute_and_cache_money_shape(uid)
