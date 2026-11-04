"""G418: committed categories are judged against their expected payments, never by day-N pace.

Pay periods start on different calendar dates (payday is the last Friday, so
periods run 28 to 35 days), but a fixed bill falls on a fixed calendar date.
The same mortgage payment therefore lands on day 3 of one period and day 7 of
another, so "spent by day N versus the usual by day N" reads a steady bill as
several times usual. For categories whose declared kind is ``commitment``
(app.services.categories, no hardcoded names) the pace multiple is withheld and
this module compares what was paid with the recurring payments the engine
already holds (the cashflow cache's ``recurring_spend`` series):

  as_expected  every payment matched its series at about its usual amount
  higher       a matched payment is clearly above its usual amount (named, with both amounts)
  new          a payment that matches no known recurring series, in a category that has some
  (nothing)    a committed category with no recurring series at all says nothing

Pure functions only; the caller supplies the transactions and the series.
"""
from __future__ import annotations

from app.services.categories import is_commitment, normalise_name

#: A matched payment is "higher" when it is above its usual amount by more than
#: this fraction and by at least HIGHER_MIN_POUNDS.
HIGHER_FRACTION = 0.10
HIGHER_MIN_POUNDS = 1.0
#: A payment under this is never flagged as new (rounding dust, small fees).
NEW_MIN_POUNDS = 5.0


def _closest(series: list[dict], amount: float) -> dict:
    return min(series, key=lambda s: abs(float(s.get("avg_amount") or 0) - amount))


def committed_findings(
    txns: list[dict],
    patterns: list[dict],
    kind_map,
    period_start,
    period_end,
    name_fn=None,
) -> dict[str, dict]:
    """Per committed category with recurring expectations, how this period compares.

    ``txns`` are spend records carrying ``date``, ``category``, ``amount``
    (debits positive), ``key`` (categorisation.series_key) and ``name``.
    ``patterns`` are the cashflow cache's ``recurring_spend`` series. Returns
    ``{category: {"status", "paid_count", "payments": [...]}}`` only for
    categories that have at least one recurring series; absent means silent.
    """
    by_key: dict[str, list[dict]] = {}
    cats_with_series: set[str] = set()
    for p in patterns or []:
        key = p.get("key")
        if key:
            by_key.setdefault(key, []).append(p)
        if p.get("category"):
            cats_with_series.add(normalise_name(p["category"]))

    out: dict[str, dict] = {}
    for t in txns:
        cat = t.get("category")
        if not cat or not period_start <= t["date"] <= period_end:
            continue
        amount = float(t.get("amount") or 0)
        if amount <= 0:
            continue  # refunds net elsewhere; they are never a payment to judge
        if not is_commitment(kind_map, cat):
            continue
        matched = by_key.get(t.get("key") or "")
        if not matched and normalise_name(cat) not in cats_with_series:
            continue  # nothing recurring is expected here: say nothing
        entry = out.setdefault(cat, {"status": "as_expected", "paid_count": 0, "payments": []})
        if matched:
            series = _closest(matched, amount)
            expected = float(series.get("avg_amount") or 0)
            if amount > expected * (1 + HIGHER_FRACTION) and amount - expected >= HIGHER_MIN_POUNDS:
                entry["payments"].append({
                    "kind": "higher",
                    "name": series.get("display_name") or series.get("key"),
                    "paid": round(amount, 2),
                    "expected": round(expected, 2),
                })
            else:
                entry["paid_count"] += 1
        elif amount >= NEW_MIN_POUNDS:
            label = (name_fn(t.get("name") or "") if name_fn else None) or t.get("name") or "A new payment"
            entry["payments"].append({"kind": "new", "name": label, "paid": round(amount, 2)})
        else:
            entry["paid_count"] += 1

    for entry in out.values():
        kinds = {p["kind"] for p in entry["payments"]}
        entry["status"] = "higher" if "higher" in kinds else "new" if "new" in kinds else "as_expected"
    return out
