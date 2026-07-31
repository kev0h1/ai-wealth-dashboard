"""Shared monthly cash-flow aggregation with one-off-spike smoothing.

Instead of summing a 90-day window and dividing by 3 (which lets a single
bonus / refund / loan inflate the average), we bucket transactions into the
last three 30-day months and take the MEDIAN month, so a one-off spike in any
single month doesn't distort the typical monthly figure. On accounts with less
than 3 months of history we average over the months actually present.
"""
from datetime import datetime

from app.db.collections import cashflow_cache_col, transactions_col, yapily_transactions_col
from app.services.region import get_kenya_transactions

_NON_DISC = {"Transfer", "Savings", "Debt", "Income"}

# Only the fields the maths below actually touches — keeps the 90-day scan
# from dragging full transaction documents over the wire.
_CF_PROJECTION = {"amount": 1, "date": 1, "category": 1,
                  "custom_category": 1, "transaction_type": 1}


def _median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _months_of_data(dates: list[datetime], now: datetime) -> int:
    """How many 30-day months of history we actually have (1..3)."""
    if not dates:
        return 3
    days = (now - min(dates)).days
    return max(1, min(3, days // 30 + 1))


def _median_monthly(txns: list[dict], now: datetime, n_months: int) -> float:
    """Median of the per-month (30-day bucket) totals over the active months."""
    buckets = [0.0, 0.0, 0.0]
    for t in txns:
        days = (now - t["date"]).days
        b = min(2, max(0, days // 30))
        buckets[b] += t.get("amount", 0)
    return _median(buckets[:n_months])


async def monthly_cashflow(uid: str, region: str, cutoff: datetime) -> dict:
    """Spike-smoothed typical-month cash-flow. Returns:
      income   – median monthly "Income" credits
      spending – median monthly everyday spend (excludes Transfer/Savings/Debt/Income)
      debt     – median monthly "Debt" repayments
      cat      – median monthly total per debit category
      n_months – months of history used (1..3)
    """
    now = datetime.now()
    if region == "Kenya":
        all_txns    = await get_kenya_transactions(uid, cutoff)
        income_txns = [t for t in all_txns if t.get("transaction_type") == "credit" and
                       (t.get("custom_category") or t.get("category")) == "Income"]
        debit_txns  = [t for t in all_txns if t.get("transaction_type") == "debit"]
    else:
        income_txns = await transactions_col.find(
            {"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}},
            _CF_PROJECTION,
        ).to_list(None)
        income_txns += await yapily_transactions_col.find(
            {"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}},
            _CF_PROJECTION,
        ).to_list(None)
        debit_txns  = await transactions_col.find(
            {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}},
            _CF_PROJECTION,
        ).to_list(None)
        debit_txns += await yapily_transactions_col.find(
            {"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}},
            _CF_PROJECTION,
        ).to_list(None)

    n_months = _months_of_data([t["date"] for t in income_txns + debit_txns], now)

    monthly_income = round(_median_monthly(income_txns, now, n_months), 2)

    by_cat: dict[str, list[dict]] = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        by_cat.setdefault(cat, []).append(t)
    monthly_cat = {cat: round(_median_monthly(txns, now, n_months), 2) for cat, txns in by_cat.items()}

    monthly_spending = round(sum(v for k, v in monthly_cat.items() if k not in _NON_DISC), 2)
    monthly_debt     = round(monthly_cat.get("Debt", 0.0), 2)

    return {
        "income":   monthly_income,
        "spending": monthly_spending,
        "debt":     monthly_debt,
        "cat":      monthly_cat,
        "n_months": n_months,
    }


_MONTHLY_CF_TTL_SECONDS = 6 * 3600


async def monthly_cashflow_cached(uid: str, region: str, cutoff: datetime) -> dict:
    """Memoised `monthly_cashflow` for per-request callers (6 h TTL).

    The result is stored as a `monthly_cf` blob on the user's cashflow cache
    doc — refreshed by `compute_and_cache_cashflow` after every sync (which
    runs in both the API and worker processes, so the memo stays consistent
    across processes via Mongo). Falls back to a live compute + write-back
    when the blob is missing, stale, or was computed for a different region.

    All current callers use the standard 90-day cutoff; the maths in
    `monthly_cashflow` itself is unchanged.
    """
    doc = await cashflow_cache_col.find_one({"_id": uid}, {"monthly_cf": 1})
    blob = (doc or {}).get("monthly_cf") or {}
    at = blob.get("computed_at")
    if (
        blob.get("region") == region
        and isinstance(at, datetime)
        and (datetime.now() - at).total_seconds() < _MONTHLY_CF_TTL_SECONDS
        and blob.get("data")
    ):
        return blob["data"]

    data = await monthly_cashflow(uid, region, cutoff)
    await cashflow_cache_col.update_one(
        {"_id": uid},
        {"$set": {"monthly_cf": {"data": data, "region": region, "computed_at": datetime.now()}}},
        upsert=True,
    )
    return data
