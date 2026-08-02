"""Discretionary spend-pace engine.

Answers one question: given how much safe-to-spend pot remains and how many
days are left in the period, is the user spending at a sustainable rate?

The 'actual' rate (discretionary spend / days elapsed) is compared against the
'sustainable' rate (safe-to-spend / days left). The chart series is constructed
so that the cumulative spend line sitting ABOVE the sustainable line means
exactly the same thing as actual > sustainable — chart and headline pill can
never disagree.

Public API
----------
    result = await compute_pace(uid, include_series=False)
    result = await compute_pace(uid, include_series=True, sts=precomputed_sts)

`sts` is the already-computed safe-to-spend dict; when omitted the function
computes it itself. Pass it from the HTTP handler to avoid a second round-trip.
"""
import logging
import statistics
from datetime import date, datetime, timedelta

from app.db.collections import (
    cashflow_cache_col,
    preferences_col,
    transactions_col,
    yapily_transactions_col,
)
from app.services.pay_period import get_pay_period_for_date, prev_pay_period

logger = logging.getLogger(__name__)

# Categories whose debits are not real discretionary spend.
# Mirrors _NON_DISC in app.services.cashflow (imported lazily to avoid cycles).
_NON_SPEND = {"Transfer", "Savings", "Debt", "Income"}

# ── Typing alias ──────────────────────────────────────────────────────────────
_Txn = dict   # normalised transaction record


# ── 0. Internal helpers ───────────────────────────────────────────────────────

def _norm(raw: dict) -> _Txn:
    """Normalise a raw Mongo transaction document into a lightweight dict."""
    raw_date = raw.get("date")
    if hasattr(raw_date, "date"):
        d_obj = raw_date.date()
    elif isinstance(raw_date, date):
        d_obj = raw_date
    else:
        d_obj = date.today()

    key = (raw.get("merchant_name") or raw.get("description", "")[:35] or "").strip()
    cat = (raw.get("custom_category") or raw.get("category") or "Other")

    return {
        "date":       d_obj,
        "amount":     abs(float(raw.get("amount") or 0)),
        "key":        key,
        "category":   cat,
        "account_id": str(raw.get("account_id") or ""),
        "planned":    bool(raw.get("planned")),
    }


def _classify(
    txns: list[_Txn],
    patterns: list[dict],
    window_days: int,
) -> tuple[list[_Txn], list[_Txn], list[_Txn], list[_Txn]]:
    """Split *txns* into four buckets (mutually exclusive, priority order):

    1. non_spend  — category in _NON_SPEND
    2. planned    — user-declared one-off (txn["planned"] is True)
    3. commitment — matches a recurring-bill pattern
    4. discretionary — everything else

    Returns (discretionary, commitments, non_spend, planned).
    The bill matcher is stateless per call (fresh `used` sets each time),
    so it is safe to call twice with different window_days for the same txns.
    """
    # Index transactions by merchant key for O(n) bill matching.
    by_key: dict[str, list[_Txn]] = {}
    for t in txns:
        by_key.setdefault(t["key"], []).append(t)

    # Sort each bucket newest-first so the matcher grabs the most recent.
    for bucket in by_key.values():
        bucket.sort(key=lambda x: x["date"], reverse=True)

    # Track which (key, index) pairs have been consumed by the bill matcher.
    used: dict[str, list[bool]] = {k: [False] * len(v) for k, v in by_key.items()}

    commitment_set: set[int] = set()   # id() of matched txn dicts

    for p in patterns:
        p_key = (p.get("key") or "").strip()
        if not p_key or p_key not in by_key:
            continue

        avg_amount = abs(float(p.get("avg_amount") or 0))
        avg_interval = max(1.0, float(p.get("avg_interval") or 30))
        p_account = str(p.get("account_id") or "")
        tol = max(2.0, avg_amount * 0.15)
        max_matches = max(1, round(window_days / avg_interval)) + 1

        matched = 0
        bucket = by_key[p_key]
        used_flags = used[p_key]
        for i, t in enumerate(bucket):
            if matched >= max_matches:
                break
            if used_flags[i]:
                continue
            # Amount tolerance check
            if abs(t["amount"] - avg_amount) > tol:
                continue
            # Account check (only when both sides are non-empty)
            if p_account and t["account_id"] and t["account_id"] != p_account:
                continue
            used_flags[i] = True
            commitment_set.add(id(t))
            matched += 1

    discretionary: list[_Txn] = []
    commitments:   list[_Txn] = []
    non_spend:     list[_Txn] = []
    planned:       list[_Txn] = []

    for t in txns:
        cat = t["category"]
        if cat in _NON_SPEND:
            non_spend.append(t)
        elif t["planned"]:
            planned.append(t)
        elif id(t) in commitment_set:
            commitments.append(t)
        else:
            discretionary.append(t)

    return discretionary, commitments, non_spend, planned


# ── 1. Main entry point ───────────────────────────────────────────────────────

async def compute_pace(
    uid: str,
    include_series: bool = False,
    sts: dict | None = None,
) -> dict:
    """Compute the spend-pace reading for *uid*.

    Parameters
    ----------
    uid:
        User email / identifier.
    include_series:
        When True the returned dict includes a per-day chart series under
        the key ``"series"``.
    sts:
        Pre-computed safe-to-spend dict (from ``compute_safe_to_spend``).
        When omitted the function fetches it itself — pass it from the HTTP
        handler to save the extra round-trip.

    Returns
    -------
    dict
        See module docstring for the full return shape.
        Returns ``{"state": "unavailable"}`` when data is insufficient.
    """

    # ── A. Safe-to-spend pot ──────────────────────────────────────────────────
    if sts is None:
        from app.routers.analytics import compute_safe_to_spend  # lazy — avoids circular import
        sts = await compute_safe_to_spend(uid)

    if sts.get("status") != "ok":
        return {"state": "unavailable"}

    pot       = float(sts["safe_to_spend"])
    days_left = int(sts["days_until_payday"])

    # ── B. Period window ──────────────────────────────────────────────────────
    prefs    = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg  = prefs.get("pay_period_config", {"type": "calendar_month"})
    today    = date.today()

    period_start, _period_end = get_pay_period_for_date(today, pay_cfg)
    # days_elapsed = completed days since period start; today is NOT yet elapsed —
    # it is already included in days_left as a spending day.  The max(1, …) floor
    # fires only on day 1 of the period (where .days == 0), which makes total_days
    # one larger than the true period length; state is "early" there so the
    # actual/sustainable comparison is suppressed anyway.
    days_elapsed = max(1, (today - period_start).days)
    total_days   = days_elapsed + days_left

    # ── C. Load debits — one pass per collection covers both windows ──────────
    # We need the current period for pace, and 70 days back for notable_day.
    # Use the earlier of period_start vs (today - 70d) as the single DB cutoff.
    history_start = today - timedelta(days=70)
    db_cutoff = min(period_start, history_start)
    db_cutoff_dt = datetime(db_cutoff.year, db_cutoff.month, db_cutoff.day)

    _projection = {
        "merchant_name": 1, "description": 1, "amount": 1, "date": 1,
        "category": 1, "custom_category": 1, "account_id": 1, "planned": 1,
    }

    raw_docs: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        try:
            async for doc in col.find(
                {
                    "user_id": uid,
                    "transaction_type": "debit",
                    "date": {"$gte": db_cutoff_dt},
                },
                _projection,
            ):
                raw_docs.append(doc)
        except Exception:
            logger.exception("pace: failed fetching from %s for %s", col.name, uid)

    all_txns = [_norm(d) for d in raw_docs]

    # Split by window in Python — no second DB round-trip needed.
    period_txns  = [t for t in all_txns if t["date"] >= period_start]
    history_txns = [t for t in all_txns if t["date"] >= history_start]

    # ── C (cont). Load cashflow cache for bill patterns ───────────────────────
    cached   = await cashflow_cache_col.find_one({"_id": uid}) or {}
    patterns = cached.get("recurring_spend", [])

    # Classify current-period debits
    disc_period, comm_period, non_spend_period, planned_period = _classify(
        period_txns, patterns, window_days=days_elapsed
    )

    discretionary_so_far = round(sum(t["amount"] for t in disc_period), 2)

    split = {
        "commitment_total":    round(sum(t["amount"] for t in comm_period), 2),
        "discretionary_total": discretionary_so_far,
        "non_spend_total":     round(sum(t["amount"] for t in non_spend_period), 2),
        "planned_total":       round(sum(t["amount"] for t in planned_period), 2),
        "commitment_count":    len(comm_period),
        "discretionary_count": len(disc_period),
    }

    # ── D. Rates and state ────────────────────────────────────────────────────
    sustainable = round(pot / max(days_left, 1), 2)
    actual      = round(discretionary_so_far / days_elapsed, 2)

    if pot <= 0:
        state = "short"
    elif days_elapsed < 3:
        state = "early"
    elif actual < sustainable * 0.9:
        state = "comfortable"
    elif actual > sustainable * 1.1:
        state = "ahead"
    else:
        state = "on_pace"

    # ── E. Per-day series (optional) ─────────────────────────────────────────
    #
    # Algebraic proof that line = (disc_so_far + pot) * (i+1) / total_days is
    # the correct sustainable boundary:
    #
    #   Let A = discretionary_so_far, P = pot, E = days_elapsed, L = days_left.
    #   actual > sustainable  ⟺  A/E > P/L
    #                         ⟺  A·L > P·E
    #                         ⟺  A > P·E/L
    #                         ⟺  A > (A+P)·E/(E+L)      [since A·L > P·E ⟺ A(E+L) > (A+P)E]
    #   i.e. cumulative spend on day E sitting ABOVE line(E) = (A+P)·E/total
    #   means exactly "ahead", and below means exactly "comfortable".
    #   Chart and pill can never disagree.
    #
    period_allowance = round(discretionary_so_far + max(pot, 0.0), 2)

    series: list[dict] = []
    if include_series:
        # Build cumulative daily discretionary totals for past days.
        daily_disc: dict[date, float] = {}
        for t in disc_period:
            daily_disc[t["date"]] = daily_disc.get(t["date"], 0.0) + t["amount"]

        cumulative = 0.0
        for i in range(total_days):
            day = period_start + timedelta(days=i)
            is_past = day <= today
            if is_past:
                cumulative = round(cumulative + daily_disc.get(day, 0.0), 2)
                cum_val: float | None = cumulative
            else:
                cum_val = None
            # When pot <= 0 there is no target to pace toward before payday;
            # drawing a line from 0 to exactly what's already been spent would
            # be circular and meaningless.  Emit None so the chart omits the
            # sustainable boundary entirely.
            sustainable_line_val = (
                round(period_allowance * (i + 1) / total_days, 2)
                if pot > 0 else None
            )
            series.append({
                "date":                    day.isoformat(),
                "cumulative_discretionary": cum_val,
                "sustainable_line":        sustainable_line_val,
            })

    # ── F. Notable day (big-spend day vs weekday baseline) ───────────────────
    notable_day = _compute_notable_day(
        history_txns=history_txns,
        patterns=patterns,
        period_start=period_start,
        scan_end=today,
    )

    result: dict = {
        "state":               state,
        "pot":                 pot,
        "days_left":           days_left,
        "days_elapsed":        days_elapsed,
        "period_start":        period_start.isoformat(),
        "discretionary_so_far": discretionary_so_far,
        "sustainable":         sustainable,
        "actual":              actual,
        "period_allowance":    period_allowance,
        "notable_day":         notable_day,
        "split":               split,
    }
    if include_series:
        result["series"] = series
    return result


# ── F impl. Notable day ───────────────────────────────────────────────────────

def _weekday_baseline(
    history_txns: list[_Txn],
    patterns: list[dict],
    period_start: date,
    scan_end: date,
) -> tuple[dict, dict, list]:
    """Classify history and return (daily_totals, weekday_medians, disc_history).

    daily_totals : {date: float} — per-day discretionary spend over the 70-day window,
                   including zero-spend days between the earliest txn date and scan_end.
    weekday_medians : {int: float} — median daily spend per weekday (0=Monday), only
                      for weekdays with >= 6 historical samples OUTSIDE the current period.
    disc_history : list[_Txn] — classified discretionary transactions from history_txns.

    Returns ({}, {}, []) when history_txns is empty.
    """
    if not history_txns:
        return {}, {}, []

    disc_history, _, _, _ = _classify(history_txns, patterns, window_days=70)

    if not disc_history:
        return {}, {}, []

    # Build per-day totals over the 70-day window.
    earliest_txn_date = min(t["date"] for t in disc_history)
    daily_totals: dict[date, float] = {}
    d = earliest_txn_date
    while d <= scan_end:
        daily_totals[d] = 0.0
        d += timedelta(days=1)
    for t in disc_history:
        daily_totals[t["date"]] = daily_totals.get(t["date"], 0.0) + t["amount"]

    # Build weekday baseline excluding current period days.
    weekday_samples: dict[int, list[float]] = {wd: [] for wd in range(7)}
    for day, total in daily_totals.items():
        if day < period_start:
            weekday_samples[day.weekday()].append(total)

    weekday_medians: dict[int, float] = {}
    for wd, samples in weekday_samples.items():
        if len(samples) >= 6:
            weekday_medians[wd] = statistics.median(samples)

    return daily_totals, weekday_medians, disc_history


def _compute_notable_day(
    history_txns: list[_Txn],
    patterns: list[dict],
    period_start: date,
    scan_end: date,
) -> dict | None:
    """Find the most recent day in the current period with unusually high spend.

    Uses 70-day historical daily discretionary totals (with the current period
    excluded from the baseline) to compute a per-weekday median, then flags
    any current-period day that is >= 2× the median, >= £50, and backed by
    at least 6 historical samples for that weekday.

    Returns None when history is thin or nothing qualifies.
    """
    if not history_txns:
        return None

    daily_totals, weekday_medians, disc_history = _weekday_baseline(
        history_txns, patterns, period_start, scan_end=scan_end
    )

    if not daily_totals:
        return None

    # Scan current-period days for qualifying big-spend days.
    qualifying: list[dict] = []
    for day in sorted(d for d in daily_totals if period_start <= d <= scan_end):
        wd = day.weekday()
        median = weekday_medians.get(wd)
        if median is None:
            continue
        if median <= 0:
            continue
        day_total = daily_totals.get(day, 0.0)
        if day_total < 2 * median:
            continue
        if day_total < 50.0:
            continue
        # Top categories for this specific day
        cat_totals: dict[str, float] = {}
        for t in disc_history:
            if t["date"] == day:
                cat_totals[t["category"]] = cat_totals.get(t["category"], 0.0) + t["amount"]
        top_cats = sorted(
            [{"category": c, "total": round(v, 2)} for c, v in cat_totals.items()],
            key=lambda x: -x["total"],
        )[:3]
        qualifying.append({
            "date":           day.isoformat(),
            "weekday":        day.strftime("%A"),
            "amount":         round(day_total, 2),
            "usual":          round(median, 2),
            "multiple":       round(day_total / median, 1),
            "top_categories": top_cats,
        })

    if not qualifying:
        return None

    return qualifying[-1]


# ── G. Category-trends detail payload ────────────────────────────────────────

async def compute_pace_detail(uid: str, sts: dict | None = None, offset: int = 0) -> dict:
    """Full category-trends payload for the Trends page (/budget).

    Parameters
    ----------
    uid:
        User email / identifier.
    sts:
        Pre-computed safe-to-spend dict (only used when offset == 0).
    offset:
        0 = current pay period (default).
        -1 = the immediately preceding period, -2 = the one before that, etc.
        Clamped to [-60, 0].

    Returns
    -------
    dict
        ``{"status": "unavailable"}`` when the current period has no data.
        Otherwise see the return shape below.
    """
    offset = max(-60, min(0, int(offset)))
    closed = offset < 0

    # ── A. Resolve the target period ─────────────────────────────────────────
    prefs   = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today   = date.today()

    period_start, period_end = get_pay_period_for_date(today, pay_cfg)
    for _ in range(-offset):
        period_start, period_end = prev_pay_period(period_start, pay_cfg)

    # ── B. Branch A (current) vs Branch B (closed) ───────────────────────────
    # db_cutoff must be <= (period_start - 70d) so the loaded range always covers
    # the history_txns filter in section C.
    db_cutoff = period_start - timedelta(days=70)

    if not closed:
        # ── B-A. Current period: delegate to compute_pace for pot/state ──────
        pace_result = await compute_pace(uid, include_series=False, sts=sts)
        if pace_result.get("state") == "unavailable":
            return {"status": "unavailable"}

        days_elapsed = max(1, (today - period_start).days)
        days_left    = int(pace_result["days_left"])
        scan_end     = today

        pot        = float(pace_result["pot"])
        sustainable = float(pace_result["sustainable"])
        actual      = float(pace_result["actual"])
        state       = pace_result["state"]

    else:
        # ── B-B. Closed period: full-period length, no pot/sustainable ────────
        days_elapsed = (period_end - period_start).days + 1
        scan_end     = period_end

    # ── C. Load transactions (shared by both branches) ────────────────────────
    db_cutoff_dt = datetime(db_cutoff.year, db_cutoff.month, db_cutoff.day)

    _projection = {
        "merchant_name": 1, "description": 1, "amount": 1, "date": 1,
        "category": 1, "custom_category": 1, "account_id": 1, "planned": 1,
    }

    raw_docs: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        try:
            async for doc in col.find(
                {"user_id": uid, "transaction_type": "debit", "date": {"$gte": db_cutoff_dt}},
                _projection,
            ):
                raw_docs.append(doc)
        except Exception:
            logger.exception("pace_detail: failed fetching from %s for %s", col.name, uid)

    all_txns     = [_norm(d) for d in raw_docs]
    period_txns  = [t for t in all_txns if period_start <= t["date"] <= period_end]
    history_txns = [t for t in all_txns if (period_start - timedelta(days=70)) <= t["date"] <= period_end]

    cached   = await cashflow_cache_col.find_one({"_id": uid}) or {}
    patterns = cached.get("recurring_spend", [])

    # ── D. Classify and compute period totals ─────────────────────────────────
    disc_period, _, _, _ = _classify(period_txns, patterns, window_days=days_elapsed)

    discretionary_so_far = round(sum(t["amount"] for t in disc_period), 2)

    if closed:
        # For a closed period, actual is computed here; for the current period
        # actual comes from compute_pace above (same formula, avoids drift).
        actual = round(discretionary_so_far / max(days_elapsed, 1), 2)

    # ── E. Notable day ────────────────────────────────────────────────────────
    notable_day = _compute_notable_day(history_txns, patterns, period_start, scan_end)

    # ── F. choices — discretionary grouped by category ────────────────────────
    from app.services.cashflow import monthly_cashflow_cached
    from app.services.region import get_user_region
    region = await get_user_region(uid)
    cf = await monthly_cashflow_cached(uid, region, datetime.now() - timedelta(days=90))
    cf_cat = cf.get("cat", {})
    thin_history = cf.get("n_months", 3) < 2

    cat_spent: dict[str, float] = {}
    cat_count: dict[str, int]   = {}
    for t in disc_period:
        cat = t["category"]
        cat_spent[cat] = cat_spent.get(cat, 0.0) + t["amount"]
        cat_count[cat] = cat_count.get(cat, 0) + 1

    # Early-period multiples are volatile and misleading (e.g. £41 on day 2
    # renders "18.7× your usual").  Suppress multiple when fewer than 5 days
    # have elapsed — amounts and rates still compute normally.
    suppress_multiple = days_elapsed < 5

    choices = []
    for cat, spent in cat_spent.items():
        spent_r = round(spent, 2)
        txn_count = cat_count[cat]
        rate_per_day = round(spent / max(days_elapsed, 1), 2)

        monthly = cf_cat.get(cat, 0.0)
        if thin_history or monthly <= 0:
            usual_rate_per_day = None
            multiple = None
        else:
            usual_rate_per_day = round(monthly / 30, 2)
            multiple = None if suppress_multiple else round(rate_per_day / (monthly / 30), 1)

        share = (
            round(spent / discretionary_so_far, 4)
            if discretionary_so_far > 0 else None
        )

        choices.append({
            "category":               cat,
            "spent":                  spent_r,
            "txn_count":              txn_count,
            "rate_per_day":           rate_per_day,
            "usual_rate_per_day":     usual_rate_per_day,
            "multiple":               multiple,
            "share_of_discretionary": share,
        })

    choices.sort(key=lambda x: -x["spent"])

    # ── G. Assemble ───────────────────────────────────────────────────────────
    if not closed:
        return {
            "status": "ok",
            "period": {
                "start":        period_start.isoformat(),
                "end":          period_end.isoformat(),
                "days_elapsed": days_elapsed,
                "days_left":    days_left,
                "offset":       0,
                "closed":       False,
            },
            "pace": {
                "state":                state,
                "pot":                  pot,
                "sustainable":          sustainable,
                "actual":               actual,
                "discretionary_so_far": discretionary_so_far,
            },
            "choices":     choices,
            "notable_day": notable_day,
        }
    else:
        return {
            "status": "ok",
            "period": {
                "start":        period_start.isoformat(),
                "end":          period_end.isoformat(),
                "days_elapsed": days_elapsed,
                "offset":       offset,
                "closed":       True,
            },
            "pace": {
                "actual":               actual,
                "discretionary_so_far": discretionary_so_far,
            },
            "choices":     choices,
            "notable_day": notable_day,
        }
