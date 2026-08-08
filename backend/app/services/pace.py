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
from app.services.categorisation import series_key

logger = logging.getLogger(__name__)

# Categories whose debits are not real discretionary spend.
# Mirrors _NON_DISC in app.services.cashflow (imported lazily to avoid cycles).
_NON_SPEND = {"Transfer", "Savings", "Investment", "Debt", "Income"}

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

    key = series_key(raw)
    cat = (raw.get("custom_category") or raw.get("category") or "Other")

    return {
        "date":       d_obj,
        "amount":     abs(float(raw.get("amount") or 0)),
        "key":        key,
        "category":   cat,
        "account_id": str(raw.get("account_id") or ""),
        "planned":    bool(raw.get("planned")),
        "id":         str(raw.get("_id") or ""),
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


_BASELINE_DAYS = 90

_SPEND_PROJ = {
    "amount": 1, "date": 1, "category": 1, "custom_category": 1,
    "transaction_type": 1,
}


async def load_spend_txns(uid: str, start: date, end: date | None = None) -> list[dict]:
    """Every spend-category transaction in [start, end], signed.

    Debits are positive; credits are refunds and net negative — exactly the
    basis the Spend page's category tiles use. Categories in _NON_SPEND
    (Transfer/Savings/Debt/Income) are excluded: they are not spending.

    Returns [{"date": date, "category": str, "amount": float}].
    """
    start_dt = datetime(start.year, start.month, start.day)
    date_filter: dict = {"$gte": start_dt}
    if end is not None:
        date_filter["$lte"] = datetime(end.year, end.month, end.day, 23, 59, 59)

    raw_docs: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        try:
            async for doc in col.find(
                {
                    "user_id": uid,
                    "transaction_type": {"$in": ["debit", "credit"]},
                    "date": date_filter,
                },
                _SPEND_PROJ,
            ):
                raw_docs.append(doc)
        except Exception:
            logger.exception("load_spend_txns: failed fetching from %s for %s", col.name, uid)

    result: list[dict] = []
    for doc in raw_docs:
        raw_date = doc.get("date")
        if hasattr(raw_date, "date"):
            d_obj = raw_date.date()
        elif isinstance(raw_date, date):
            d_obj = raw_date
        else:
            d_obj = date.today()

        cat = doc.get("custom_category") or doc.get("category") or "Other"
        if cat in _NON_SPEND:
            continue

        amt = abs(float(doc.get("amount") or 0))
        if doc.get("transaction_type") == "credit":
            amt = -amt

        result.append({"date": d_obj, "category": cat, "amount": amt})

    return result


def _total_baseline(
    txns: list[dict],
    period_start: date,
) -> tuple[dict[str, float], int]:
    """Median 30-day TOTAL spend per category over the 90 days immediately
    BEFORE *period_start*.

    This is the TOTAL basis — all spend-category transactions, refunds netted,
    commitments included. It is the baseline that belongs beside a total, never
    beside a discretionary numerator. Takes already-total-basis txns (from
    load_spend_txns) so there is no _classify call and no patterns argument.

    Returns ({category: median 30-day total}, n_months) where n_months is how
    many 30-day buckets the loaded data actually covers (1..3, 0 when empty).
    """
    window = [
        t for t in txns
        if period_start - timedelta(days=_BASELINE_DAYS) <= t["date"] < period_start
    ]
    if not window:
        return {}, 0

    n_months = max(1, min(3, (period_start - min(t["date"] for t in window)).days // 30 + 1))

    buckets: dict[str, list[float]] = {}
    counts:  dict[str, int] = {}
    for t in window:
        cat = t["category"]
        b = min(2, (period_start - t["date"]).days // 30)
        buckets.setdefault(cat, [0.0, 0.0, 0.0])[b] += t["amount"]
        counts[cat] = counts.get(cat, 0) + 1

    out: dict[str, float] = {}
    for cat, arr in buckets.items():
        if counts[cat] < 3:
            continue
        med = statistics.median(arr[:n_months])
        if med > 0:
            out[cat] = round(med, 2)
    return out, n_months


# ── Memoised total baseline ───────────────────────────────────────────────────
#
# `_total_baseline` itself is cheap arithmetic; what costs is the 90-day
# transaction load it forces. A median of three 30-day buckets moves very
# slowly — nothing inside a period can change it, because the window ends the
# instant the period starts. Memoising it (same 6 h discipline as
# `monthly_cashflow_cached`) lets the caller load only the period window,
# which is where the real saving is. Stored per baseline window on the user's
# cashflow cache doc so the memo is shared across the API and worker
# processes.

_BASELINE_TTL_SECONDS = 6 * 3600


async def _read_cached_baseline(
    uid: str, window_key: str
) -> tuple[dict[str, float], int] | None:
    """Fresh memoised ({category: median 30-day total}, n_months), or None.

    A baseline is stale when it is older than the TTL, or when a sync has
    landed since it was computed (`synced_at` is stamped on every sync path,
    including ones that never reach `compute_and_cache_cashflow`).
    """
    try:
        doc = await cashflow_cache_col.find_one(
            {"_id": uid}, {"total_baselines": 1, "synced_at": 1}
        ) or {}
    except Exception:
        logger.exception("_read_cached_baseline: read failed for %s", uid)
        return None

    blob = (doc.get("total_baselines") or {}).get(window_key)
    if not isinstance(blob, dict):
        return None

    at = blob.get("computed_at")
    if not isinstance(at, datetime):
        return None
    if (datetime.now() - at).total_seconds() >= _BASELINE_TTL_SECONDS:
        return None

    synced_at = doc.get("synced_at")
    if isinstance(synced_at, datetime) and synced_at > at:
        return None

    data = blob.get("data")
    months = blob.get("months")
    if not isinstance(data, dict) or not isinstance(months, int):
        return None
    return {k: float(v) for k, v in data.items()}, months


async def _write_cached_baseline(
    uid: str, window_key: str, baseline: dict[str, float], months: int
) -> None:
    """Memoise a freshly computed baseline. Never raises."""
    try:
        await cashflow_cache_col.update_one(
            {"_id": uid},
            {"$set": {f"total_baselines.{window_key}": {
                "data": baseline, "months": months, "computed_at": datetime.now(),
            }}},
            upsert=True,
        )
    except Exception:
        logger.exception("_write_cached_baseline: write failed for %s", uid)


def _discretionary_baseline(
    txns: list[_Txn],
    patterns: list[dict],
    period_start: date,
) -> tuple[dict[str, float], int]:
    """Median 30-day discretionary spend per category over the 90 days
    immediately BEFORE *period_start*.

    Mirrors cashflow.py's median-of-30-day-buckets discipline so one spike
    month can't distort the baseline — but classifies with pace.py's own
    commitment matcher first, so the baseline is discretionary-only, on
    exactly the same basis as the numerator it will be compared against.

    Returns ({category: median 30-day total}, n_months) where n_months is how
    many 30-day buckets the loaded data actually covers (1..3, 0 when empty).
    """
    window = [
        t for t in txns
        if period_start - timedelta(days=_BASELINE_DAYS) <= t["date"] < period_start
    ]
    if not window:
        return {}, 0

    n_months = max(1, min(3, (period_start - min(t["date"] for t in window)).days // 30 + 1))
    disc, _, _, _ = _classify(window, patterns, window_days=_BASELINE_DAYS)

    buckets: dict[str, list[float]] = {}
    counts:  dict[str, int] = {}
    for t in disc:
        b = min(2, (period_start - t["date"]).days // 30)
        buckets.setdefault(t["category"], [0.0, 0.0, 0.0])[b] += t["amount"]
        counts[t["category"]] = counts.get(t["category"], 0) + 1

    out: dict[str, float] = {}
    for cat, arr in buckets.items():
        # Too few discretionary transactions to call anything "usual".
        if counts[cat] < 3:
            continue
        med = statistics.median(arr[:n_months])
        if med > 0:
            out[cat] = round(med, 2)
    return out, n_months


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
    # db_cutoff must cover BOTH the 70-day notable-day history window AND the
    # 90-day discretionary baseline window — use the larger of the two.
    db_cutoff = period_start - timedelta(days=_BASELINE_DAYS)

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
        "_id": 1, "merchant_name": 1, "description": 1, "amount": 1, "date": 1,
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
    # Baseline is discretionary-only, classified on the same basis as the
    # numerator (pace.py's own commitment matcher), so commitments never
    # inflate the usual_rate_per_day for discretionary categories.
    baseline, baseline_months = _discretionary_baseline(all_txns, patterns, period_start)
    thin_history = baseline_months < 2

    cat_spent:   dict[str, float]       = {}
    cat_count:   dict[str, int]         = {}
    cat_txn_ids: dict[str, list[str]]   = {}
    for t in disc_period:
        cat = t["category"]
        cat_spent[cat]   = cat_spent.get(cat, 0.0) + t["amount"]
        cat_count[cat]   = cat_count.get(cat, 0) + 1
        cat_txn_ids.setdefault(cat, []).append(t["id"])

    # Early-period multiples are volatile and misleading (e.g. £41 on day 2
    # renders "18.7× your usual").  Suppress multiple when fewer than 5 days
    # have elapsed — amounts and rates still compute normally.
    suppress_multiple = days_elapsed < 5

    choices = []
    for cat, spent in cat_spent.items():
        spent_r = round(spent, 2)
        txn_count = cat_count[cat]
        rate_per_day = round(spent / max(days_elapsed, 1), 2)

        usual_30d = baseline.get(cat)
        if thin_history or not usual_30d:
            usual_rate_per_day = None
            multiple = None
        else:
            usual_rate_per_day = round(usual_30d / 30, 2)
            multiple = None if suppress_multiple else round(rate_per_day / (usual_30d / 30), 1)

        share = (
            round(spent / discretionary_so_far, 4)
            if discretionary_so_far > 0 else None
        )

        choices.append({
            "category":               cat,
            "spent":                  spent_r,
            "txn_count":              txn_count,
            "txn_ids":                cat_txn_ids.get(cat, []),
            "rate_per_day":           rate_per_day,
            "usual_rate_per_day":     usual_rate_per_day,
            "multiple":               multiple,
            "share_of_discretionary": share,
        })

    choices.sort(key=lambda x: -x["spent"])

    # ── The Door — consent-gated aim fields ──────────────────────────────────
    # The Consent Rule: no aim language may appear for a category that has no
    # checkpoint. These four fields are the ONLY channel through which aim
    # language becomes possible. They are always set (stable contract) and
    # checkpoint/intent/door_engaged are always None/False on closed periods;
    # suggested_aim is always derived for the CURRENT period (look-forward aim).
    if not closed:
        # Initialise all Door variables before the try so the fallback is
        # genuinely safe: even if the import or the awaits raise, the loop
        # below always has every name bound and derive_aim is callable only
        # when it was successfully imported.
        cp_map:     dict       = {}
        intent_map: dict       = {}
        engaged:    set        = set()
        _derive_aim            = None   # bound to derive_aim only on success
        period_days            = (period_end - period_start).days + 1  # pure date math

        try:
            from app.services.checkpoints import (
                checkpoint_map_for_period,
                derive_aim as _derive_aim,
                engaged_categories,
                intent_map_for_period,
            )
            # Trends' cat_spent is discretionary; checkpoints are total basis — never mix.
            cp_map     = await checkpoint_map_for_period(
                uid, period_start, period_end,
                days_left=days_left, cat_spent=None,
            )
            intent_map = await intent_map_for_period(uid, period_end)
            engaged    = await engaged_categories(uid, period_end)
        except Exception:
            logger.exception("pace_detail: Door attachment failed for %s", uid)

        for entry in choices:
            cat = entry["category"]
            urpd = entry.get("usual_rate_per_day")
            entry["checkpoint"]    = cp_map.get(cat) or None
            entry["intent"]        = intent_map.get(cat) or None
            entry["door_engaged"]  = cat in engaged
            entry["suggested_aim"] = (
                _derive_aim(urpd, period_days)
                if (_derive_aim is not None and urpd is not None)
                else None
            )
    else:
        # suggested_aim always references the CURRENT period — review last period,
        # set an aim for this one.
        _cur_start, _cur_end = get_pay_period_for_date(today, pay_cfg)
        _cur_period_days = (_cur_end - _cur_start).days + 1
        _derive_aim_closed = None
        try:
            from app.services.checkpoints import derive_aim as _derive_aim_closed
        except Exception:
            logger.exception("pace_detail: derive_aim import failed for closed period %s", uid)
        for entry in choices:
            urpd = entry.get("usual_rate_per_day")
            entry["checkpoint"]    = None
            entry["intent"]        = None
            entry["door_engaged"]  = False
            entry["suggested_aim"] = (
                _derive_aim_closed(urpd, _cur_period_days)
                if (_derive_aim_closed is not None and urpd is not None)
                else None
            )

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


# ── H. Per-category Spend-tile signals (total basis) ─────────────────────────

async def compute_category_signals(uid: str, offset: int = 0) -> dict:
    """Total-basis per-category readings for the Spend page tiles.

    Computes × your usual multiples and Door (consent-gated aim) fields on
    TOTAL spend — the same basis the Spend tiles show. Standalone: never calls
    compute_pace or safe-to-spend so a signal can never go blank because the
    pot is unavailable.

    Returns a dict with keys "period" and "signals".
    """
    offset = max(-60, min(0, int(offset)))
    closed = offset < 0

    # ── Resolve the target period ─────────────────────────────────────────────
    prefs   = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today   = date.today()

    period_start, period_end = get_pay_period_for_date(today, pay_cfg)
    for _ in range(-offset):
        period_start, period_end = prev_pay_period(period_start, pay_cfg)

    # Current period (always needed for suggested_aim)
    cur_start, cur_end = get_pay_period_for_date(today, pay_cfg)
    current_period_days = (cur_end - cur_start).days + 1

    # ── Load transactions + baseline ──────────────────────────────────────────
    # The baseline window ([period_start - 90d, period_start)) is closed — it
    # cannot change while the period runs — so it is memoised (6 h, invalidated
    # by any sync). With a fresh memo we load only the period itself instead of
    # 90 days + period, which is the bulk of this endpoint's database work.
    # The Door fields below are always live; only the baseline is cached.
    baseline_window_key = period_start.isoformat()
    cached_baseline = await _read_cached_baseline(uid, baseline_window_key)

    if cached_baseline is not None:
        baseline, baseline_months = cached_baseline
        txns = await load_spend_txns(uid, period_start, period_end)
    else:
        txns = await load_spend_txns(
            uid,
            period_start - timedelta(days=_BASELINE_DAYS),
            period_end,
        )
        baseline, baseline_months = _total_baseline(txns, period_start)
        await _write_cached_baseline(
            uid, baseline_window_key, baseline, baseline_months
        )

    # ── Period totals ─────────────────────────────────────────────────────────
    cat_spent: dict[str, float] = {}
    for t in txns:
        if period_start <= t["date"] <= period_end:
            cat = t["category"]
            cat_spent[cat] = cat_spent.get(cat, 0.0) + t["amount"]

    # ── Elapsed / left ────────────────────────────────────────────────────────
    if not closed:
        days_elapsed = max(1, (today - period_start).days)
        days_left: int | None = max(0, (period_end - today).days + 1)
    else:
        days_elapsed = (period_end - period_start).days + 1
        days_left = None

    suppress_multiple = days_elapsed < 5

    thin_history = baseline_months < 2

    # ── Door variables (current period only) ─────────────────────────────────
    if not closed:
        cp_map:     dict = {}
        intent_map: dict = {}
        engaged:    set  = set()
        _derive_aim      = None

        try:
            from app.services.checkpoints import (
                checkpoint_map_for_period,
                derive_aim as _derive_aim,
                engaged_categories,
                intent_map_for_period,
            )
            cp_map     = await checkpoint_map_for_period(
                uid, period_start, period_end,
                days_left=days_left, cat_spent=cat_spent,
            )
            intent_map = await intent_map_for_period(uid, period_end)
            engaged    = await engaged_categories(uid, period_end)
        except Exception:
            logger.exception("compute_category_signals: Door attachment failed for %s", uid)
    else:
        _derive_aim_closed = None
        try:
            from app.services.checkpoints import derive_aim as _derive_aim_closed
        except Exception:
            logger.exception(
                "compute_category_signals: derive_aim import failed for closed period %s", uid
            )

    # ── Build per-category signals ────────────────────────────────────────────
    signals: dict[str, dict] = {}
    for cat, spent in cat_spent.items():
        rate_per_day = spent / max(days_elapsed, 1)
        usual_30d = baseline.get(cat)

        if thin_history or not usual_30d:
            usual_rate_per_day: float | None = None
            multiple: float | None = None
        else:
            usual_rate_per_day = round(usual_30d / 30, 2)
            multiple = None if suppress_multiple else round(rate_per_day / (usual_30d / 30), 1)

        # suggested_aim always references the CURRENT period
        if usual_rate_per_day is not None:
            if not closed:
                suggested_aim: float | None = (
                    _derive_aim(usual_rate_per_day, current_period_days)
                    if _derive_aim is not None else None
                )
            else:
                suggested_aim = (
                    _derive_aim_closed(usual_rate_per_day, current_period_days)
                    if _derive_aim_closed is not None else None
                )
        else:
            suggested_aim = None

        if not closed:
            signals[cat] = {
                "usual_rate_per_day": usual_rate_per_day,
                "multiple":           multiple,
                "suggested_aim":      suggested_aim,
                "checkpoint":         cp_map.get(cat) or None,
                "intent":             intent_map.get(cat) or None,
                "door_engaged":       cat in engaged,
            }
        else:
            signals[cat] = {
                "usual_rate_per_day": usual_rate_per_day,
                "multiple":           multiple,
                "suggested_aim":      suggested_aim,
                "checkpoint":         None,
                "intent":             None,
                "door_engaged":       False,
            }

    return {
        "period": {
            "start":        period_start.isoformat(),
            "end":          period_end.isoformat(),
            "days_elapsed": days_elapsed,
            "days_left":    days_left,
            "offset":       offset,
            "closed":       closed,
        },
        "signals": signals,
    }
