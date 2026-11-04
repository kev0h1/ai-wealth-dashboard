"""G418: committed categories are judged against their expected payments, never by day-N pace.

Pay periods start on different calendar dates (payday is the last Friday, so
periods run 28 to 35 days), but a fixed bill falls on a fixed calendar date.
The same mortgage payment therefore lands on day 3 of one period and day 7 of
another, so "spent by day N versus the usual by day N" reads a steady bill as
several times usual. For a category judged as committed (see ``committed_findings``: commitment kind
with a recurring series, or every payment matching a series; no hardcoded names)
the pace multiple is withheld and
this module compares what was paid with the recurring payments the engine
already holds (the cashflow cache's ``recurring_spend`` series):

  as_expected  every payment matched its series at about its usual amount
  higher       a matched payment is clearly above its usual amount (named, with both amounts)
  new          a payment that matches no known recurring series (never one the user dismissed)

Pure functions only; the caller supplies the transactions and the series.
"""
from __future__ import annotations

import re

from app.services.categories import is_commitment

#: A matched payment is "higher" when it is above its usual amount by more than
#: this fraction and by at least HIGHER_MIN_POUNDS.
HIGHER_FRACTION = 0.10
HIGHER_MIN_POUNDS = 1.0
#: A commitment category is judged against its series only when matched series
#: payments are at least this share of its spend this period, by amount.
JUDGED_MATCHED_SHARE = 0.8
#: A payment under this is never flagged as new (rounding dust, small fees).
NEW_MIN_POUNDS = 5.0


_DIGIT_RUN = re.compile(r"\d{6,}")


def _visible_name(raw, name_fn, category: str) -> str:
    """A label safe to show: cleaned by the engine's display helper, and never
    raw bank narrative. None from the cleaner, or six or more consecutive
    digits left in the result, falls back to "a payment in <category>"."""
    cleaned = None
    if raw and name_fn is not None:
        try:
            cleaned = name_fn(str(raw))
        except Exception:
            cleaned = None
    if not cleaned or _DIGIT_RUN.search(cleaned):
        return f"a payment in {category}"
    return cleaned


def _closest(series: list[dict], amount: float) -> dict:
    return min(series, key=lambda s: abs(float(s.get("avg_amount") or 0) - amount))


def committed_findings(
    txns: list[dict],
    patterns: list[dict],
    kind_map,
    period_start,
    period_end,
    name_fn=None,
    dismissed=None,
) -> dict[str, dict]:
    """Per judged category, how this period compares with its expected payments.

    A category is judged this way (and so never by day-N pace) when EITHER every
    debit in it this period matches a recurring series (this covers subscriptions,
    which are discretionary by kind but recurring), OR it is commitment kind and
    matched series payments are at least 80% of its spend by amount. Anything
    else, Groceries or Transport with a single rail pass or milk delivery for
    instance, is absent from the result, keeps day-N pace and gets no line. A
    payment is only ever called new inside a judged category.

    ``txns`` are spend records carrying ``date``, ``category``, ``amount``
    (debits positive), ``key`` (categorisation.series_key) and ``name``.
    ``patterns`` are the cashflow cache's ``recurring_spend`` series.
    ``dismissed`` is the set of series keys the user dismissed: a payment that
    matches one is never called new (and never counts as matching a live series).
    Returns ``{category: {"status", "paid_count", "payments": [...]}}``.
    """
    dismissed = dismissed or frozenset()
    by_key: dict[str, list[dict]] = {}
    for p in patterns or []:
        key = p.get("key")
        if key:
            by_key.setdefault(key, []).append(p)

    by_cat: dict[str, list[dict]] = {}
    for t in txns:
        cat = t.get("category")
        if not cat or not period_start <= t["date"] <= period_end:
            continue
        if float(t.get("amount") or 0) <= 0:
            continue  # refunds net elsewhere; they are never a payment to judge
        by_cat.setdefault(cat, []).append(t)

    out: dict[str, dict] = {}
    for cat, rows in by_cat.items():
        matched_flags = [bool(by_key.get(r.get("key") or "")) for r in rows]
        total = sum(float(r["amount"]) for r in rows)
        matched_total = sum(float(r["amount"]) for r, m in zip(rows, matched_flags) if m)
        share_ok = total > 0 and matched_total / total >= JUDGED_MATCHED_SHARE
        judged = all(matched_flags) or (is_commitment(kind_map, cat) and any(matched_flags) and share_ok)
        if not judged:
            continue
        entry = {"status": "as_expected", "paid_count": 0, "payments": []}
        for t, matched in zip(rows, matched_flags):
            amount = float(t["amount"])
            if matched:
                series = _closest(by_key[t["key"]], amount)
                expected = float(series.get("avg_amount") or 0)
                if amount > expected * (1 + HIGHER_FRACTION) and amount - expected >= HIGHER_MIN_POUNDS:
                    entry["payments"].append({
                        "kind": "higher",
                        "name": _visible_name(series.get("display_name") or series.get("key"), name_fn, cat),
                        "paid": round(amount, 2),
                        "expected": round(expected, 2),
                    })
                else:
                    entry["paid_count"] += 1
            elif amount >= NEW_MIN_POUNDS and (t.get("key") or "") not in dismissed:
                entry["payments"].append({"kind": "new", "name": _visible_name(t.get("name"), name_fn, cat), "paid": round(amount, 2)})
            else:
                entry["paid_count"] += 1
        kinds = {p["kind"] for p in entry["payments"]}
        entry["status"] = "higher" if "higher" in kinds else "new" if "new" in kinds else "as_expected"
        out[cat] = entry
    return out
