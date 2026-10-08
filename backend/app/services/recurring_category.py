"""G190: one place that decides a recurring series' category.

Engine doctrine (ENGINE.md): the user corrects, the engine applies it. A
user correction is recorded on the transaction as a non-empty
`custom_category` (the sync paths only ever insert it as None; the engine
writes the separate `category` field), stamped with `custom_category_at`
by the correction endpoints in routers/transactions.py. That field is the
marker; no heuristic is involved.

Rules:
  (a) the most recent user-corrected row's category wins over any vote;
  (b) conflicting corrections on the same series: the most recent wins and
      the other rows keep their own row-level override untouched;
  (c) with no corrections, the majority category stands, ties broken by the
      most recent row (deterministic, unlike max(set(...)) over a set).
"""
from __future__ import annotations

from datetime import datetime

_MIN = datetime.min


def _row_cat(t: dict) -> str:
    return t.get("custom_category") or t.get("category") or "Other"


def _naive(d):
    if isinstance(d, datetime):
        return d.replace(tzinfo=None)
    return _MIN


def _correction_order(t: dict):
    # Recency of the correction itself; rows corrected before the stamp
    # existed fall back to their transaction date.
    return (_naive(t.get("custom_category_at")), _naive(t.get("date")))


def series_category(rows: list[dict], corrected_pool: list[dict] | None = None) -> str:
    """Category for a recurring series made of `rows`.

    `corrected_pool` (default `rows`) is the wider set searched for user
    corrections, so a correction on an older row the acceptance gate later
    trimmed away still decides the series."""
    pool = corrected_pool if corrected_pool is not None else rows
    corrected = [t for t in pool if t.get("custom_category")]
    if corrected:
        return max(corrected, key=_correction_order)["custom_category"]
    if not rows:
        return "Other"
    cats = [_row_cat(t) for t in rows]
    counts = {c: cats.count(c) for c in set(cats)}
    top = max(counts.values())
    tied = {c for c, n in counts.items() if n == top}
    for t in sorted(rows, key=lambda r: _naive(r.get("date")), reverse=True):
        if _row_cat(t) in tied:
            return _row_cat(t)
    return "Other"
