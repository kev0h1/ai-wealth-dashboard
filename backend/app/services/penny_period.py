"""G265: the period a Penny tool result covers, and the guard that keeps the
reply honest about it.

Two jobs, both deterministic, neither touching the model:

1. Labels. `period` on a tool result carries `{label, start, end, months,
   kind}`, built here from real dates ("6 months, 11 Apr to 11 Oct", "this
   pay period, 25 Sep to 29 Oct"). Table and chart titles come from that label,
   never from model text.

2. The guard. After the final reply, any period phrase the model wrote ("last
   6 months", "this pay period", "this month", "over 3 months") is compared with
   the periods the tools actually returned. A phrase that matches none is
   replaced by the tool's own label and counted, so a false claim about the
   user's own numbers cannot reach the screen. Model output is untrusted: it
   never computes or labels a period.
"""
from __future__ import annotations

import logging
import re
from datetime import date

from dateutil.relativedelta import relativedelta

logger = logging.getLogger(__name__)

# Rewrites made by the guard since process start (a metric to read from logs
# or a debug shell; the log line below is the durable record).
GUARD_REWRITES = 0


def months_back(today: date, months: int) -> date:
    """`months` calendar months before `today` (clamped to month length)."""
    return today - relativedelta(months=months)


def fmt_day(d: date, with_year: bool = False) -> str:
    return f"{d.day} {d:%b}" + (f" {d.year}" if with_year else "")


def _span(start: date, end: date) -> str:
    with_year = start.year != end.year
    return f"{fmt_day(start, with_year)} to {fmt_day(end, with_year)}"


def window_label(months: int, start: date, end: date) -> str:
    """"6 months, 11 Apr to 11 Oct" (singular for one month)."""
    unit = "month" if months == 1 else "months"
    return f"{months} {unit}, {_span(start, end)}"


def window_period(months: int, today: date) -> dict:
    """The rolling window of `months` calendar months ending today."""
    start = months_back(today, months)
    return {
        "label": window_label(months, start, today),
        "start": start.isoformat(), "end": today.isoformat(),
        "months": months, "kind": "rolling_months",
    }


def pay_period_period(start: date, end: date, offset: int = 0) -> dict:
    """A pay period; offset 0 is the current one."""
    if offset == 0:
        lead = "this pay period"
    elif offset == -1:
        lead = "last pay period"
    else:
        lead = f"{abs(offset)} pay periods ago"
    return {
        "label": f"{lead}, {_span(start, end)}",
        "start": start.isoformat(), "end": end.isoformat(),
        "months": None, "kind": "pay_period", "offset": offset,
    }


def range_period(start: date | None, end: date | None) -> dict | None:
    """An explicit date range a search or activity lookup was bounded to. None
    when neither bound was given (all time). `months` is set only when the range
    is an exact whole number of calendar months ending where it ends."""
    if start is None and end is None:
        return None
    if start and end:
        label = _span(start, end)
        months = None
        for n in range(1, 61):
            if months_back(end, n) == start:
                months = n
                break
    elif start:
        label = f"from {fmt_day(start, True)}"
        months = None
    else:
        label = f"up to {fmt_day(end, True)}"
        months = None
    return {
        "label": label,
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "months": months, "kind": "range",
    }


# ── the reply guard ───────────────────────────────────────────────────────
_NUM_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "eighteen": 18,
    "twenty-four": 24, "twenty four": 24,
}
_NUM = r"(?P<n>\d{1,2}|" + "|".join(sorted((re.escape(w) for w in _NUM_WORDS), key=len, reverse=True)) + r")"

# Order does not matter (overlaps are resolved below). Each regex has a named
# group `p`: the span that is replaced, so a leading preposition is kept
# ("across the last 6 months" becomes "across <label>").
_PHRASES: list[tuple[re.Pattern, str]] = [
    (re.compile(rf"\b(?P<p>(?:the\s+)?(?:last|past|previous|preceding)\s+{_NUM}[\s-]months?)\b", re.I), "months"),
    (re.compile(rf"\b(?:over|across|during|within)\s+(?P<p>{_NUM}[\s-]months?)\b", re.I), "months"),
    (re.compile(r"\b(?P<p>(?:the\s+)?(?:last|past|previous)\s+month)\b", re.I), "month1"),
    (re.compile(r"\b(?P<p>(?:this|the\s+current)\s+pay[\s-]?period)\b", re.I), "pay_period"),
    (re.compile(r"\b(?P<p>(?:this|the\s+current)\s+period)\b", re.I), "pay_period"),
    (re.compile(r"\b(?P<p>this\s+month)\b", re.I), "calendar_month"),
]


def _count(token: str) -> int | None:
    token = token.lower()
    if token.isdigit():
        return int(token)
    return _NUM_WORDS.get(token)


def _matches(kind: str, n: int | None, p: dict) -> bool:
    if kind == "months":
        return p.get("months") == n
    if kind == "month1":
        return p.get("months") == 1
    if kind == "pay_period":
        return p.get("kind") == "pay_period" and (p.get("offset") or 0) == 0
    return False  # "this month" is never what a window or pay period is


def guard_text(text: str, periods: list[dict]) -> tuple[str, int]:
    """(text, rewrites). Every period phrase in `text` that matches none of the
    `periods` the tools returned is replaced with the label of the most recent
    one. No periods, or no period phrase: the text is returned untouched."""
    global GUARD_REWRITES
    usable = [p for p in periods if isinstance(p, dict) and isinstance(p.get("label"), str) and p["label"]]
    if not text or not usable:
        return text, 0
    label = usable[-1]["label"]
    count = 0
    spans: list[tuple[int, int]] = []
    out: list[str] = []
    cursor = 0
    hits: list[tuple[int, int, str, int | None]] = []
    for pattern, kind in _PHRASES:
        for m in pattern.finditer(text):
            n = _count(m.group("n")) if kind == "months" else None
            if kind == "months" and n is None:
                continue
            hits.append((m.start("p"), m.end("p"), kind, n))
    # Resolve overlaps: earliest start wins, then the longest.
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0])))
    for start, end, kind, n in hits:
        if spans and start < spans[-1][1]:
            continue
        spans.append((start, end))
        if any(_matches(kind, n, p) for p in usable):
            continue
        out.append(text[cursor:start])
        out.append(label)
        cursor = end
        count += 1
    if not count:
        return text, 0
    out.append(text[cursor:])
    GUARD_REWRITES += count
    return "".join(out), count


def guard_reply(headline: str, reply: str, periods: list[dict], uid: str = "") -> tuple[str, str]:
    """Apply `guard_text` to the headline and reply; log one line per rewrite
    pass so the metric is greppable (`penny_period_guard_rewrite`)."""
    new_headline, h = guard_text(headline, periods)
    new_reply, r = guard_text(reply, periods)
    if h or r:
        logger.warning(
            "penny_period_guard_rewrite uid=%s rewrites=%d label=%r total=%d",
            uid, h + r, [p for p in periods if isinstance(p, dict)][-1].get("label"), GUARD_REWRITES,
        )
    return new_headline, new_reply


def collect_periods(result) -> list[dict]:
    """The labelled periods a tool result states: its top-level `period`, plus
    any one level down (`this_period.period`, `last_n_months.period`). The
    top-level one is last, so the guard falls back to the headline period."""
    if not isinstance(result, dict):
        return []
    found: list[dict] = []
    for value in result.values():
        if isinstance(value, dict) and isinstance(value.get("period"), dict) and value["period"].get("label"):
            if value["period"] not in found:
                found.append(value["period"])
    top = result.get("period")
    if isinstance(top, dict) and top.get("label"):
        if top in found:
            found.remove(top)
        found.append(top)
    return found
