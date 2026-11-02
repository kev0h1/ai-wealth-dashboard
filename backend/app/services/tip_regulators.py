"""G405: the "Typical" line comes from a regulator, never from a hardcoded figure.

A small table maps a tip category to a regulator that may state a typical
figure. Today it holds one row: energy, from Ofgem. Ofgem's stable pages carry
no figure; only the quarterly price cap press release does ("The current price
cap for a typical household paying by direct debit for gas and electricity is
£1,663 ... will rise by £60 per year (or £5 per month) to £1,723"). So the
research runs ONE extra Tavily search restricted to ofgem.gov.uk, fetches the
ofgem.gov.uk pages it returns (`tip_pages`) and reads the figure with a strict,
model-free rule. When the wording is absent, ambiguous or unreadable, nothing
is stored and the card has no Typical line.

Stored: {"figure_annual": 1723.0, "period_start": "2026-10-01", "source_host": "ofgem.gov.uk", "source_name": "Ofgem",
         "source_url": "https://www.ofgem.gov.uk/...", "read_on": "2026-11-02"}
The card shows "Typical: £144 a month (Ofgem price cap £1,723 a year from 1 October 2026, read 2 Nov 2026)."
with the monthly figure derived as annual divided by 12, rounded to the pound,
at compose time.

Ofcom (mobile, broadband) has no row: ofcom.org.uk refuses generic clients and
its figures sit in PDFs. The table is extensible: add a Regulator and, if its
figure is not annual, extend `monthly_for`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Awaitable, Callable, Optional

from app.services import tip_facts, tip_pages

Search = Callable[[str], Awaitable[Optional[tuple[list[str], list[str]]]]]


@dataclass(frozen=True)
class Regulator:
    host: str
    query: str
    # every phrase must appear (case-insensitive) in the WINDOW characters before the figure
    must_have: tuple[str, ...]
    low: float   # plausibility bounds on the stated ANNUAL figure, pounds
    high: float
    max_pages: int = 2


WINDOW = 200

REGULATORS: dict[str, Regulator] = {
    "energy": Regulator(
        "ofgem.gov.uk", 'site:ofgem.gov.uk "price cap" "typical household"',
        ("price cap", "typical household", "direct debit"), 600, 4000,
    ),
}

_POUND_RE = re.compile(r"£\s*(\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d{1,2})?")


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")
_RISE_RE = re.compile(r"will\s+(?:rise|fall|go\s+up|go\s+down|increase|decrease)\b", re.IGNORECASE)
_TO_RE = re.compile(r"\bto\s+$", re.IGNORECASE)
# a rise or fall sentence that gives a new level: "will rise by £60 per year (or £5 per month) to £1,723"
_RISE_TO_RE = re.compile(
    r"will\s+(?:rise|fall|go\s+up|go\s+down|increase|decrease)\b.{0,250}?\bto\s+£", re.IGNORECASE | re.DOTALL,
)
_HOUSEHOLD_RE = re.compile(r"typical(?:\s+\w+)?\s+household", re.IGNORECASE)
TO_WINDOW = 350


def current_period(today: date) -> tuple[date, date]:
    """The Ofgem price cap period (a calendar quarter, 1 Jan, 1 Apr, 1 Jul or
    1 Oct) that `today` falls in: (first day, last day)."""
    start = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    end_month = start.month + 2
    end_day = 30 if end_month in (6, 9) else 31
    return start, date(start.year, end_month, end_day)


def names_period(text: str, start: date, end: date) -> bool:
    """True when `text` (page text, title included) names the period: the start
    month with its year ("October 2026"), or the "1 October" and "31 December"
    pair."""
    low = (text or "").lower()
    sm, em = MONTHS[start.month - 1].lower(), MONTHS[end.month - 1].lower()
    return f"{sm} {start.year}" in low or (f"1 {sm}" in low and f"{end.day} {em}" in low)


def extract_annual(category: str, text: str, today: date) -> Optional[tuple[float, date]]:
    """(annual figure, period start) for `category` from `text`, or None. No model.
    Period-aware: the page must name the CURRENT cap period (see names_period),
    else it is a stale or future release and yields None.
    On an accepted page a sentence "... will rise/fall/go up/go down/increase/
    decrease ... to £Y" with "price cap", "direct debit" and "typical household"
    (or "typical domestic household") in the 350 characters before Y gives Y (the level for the named period);
    otherwise the "is £X" figure, but ONLY on a page with no rise/fall sentence
    at all (a page that says the cap will change and gives no readable new level
    yields None, never the outgoing cap), whose phrases must all sit in the 200
    characters before it and whose window never reaches back past an earlier
    pound figure of any kind. Bounds £600 to £4,000; exactly one distinct
    qualifying figure, else None."""
    reg = REGULATORS.get(category)
    if reg is None or not text:
        return None
    start, end = current_period(today)
    if not names_period(text, start, end):
        return None
    to_figs: set[float] = set()
    is_figs: set[float] = set()
    prev_end = 0
    for m in _POUND_RE.finditer(text):
        try:
            value = float(m.group(0).replace("£", "").replace(",", "").strip())
        except ValueError:
            continue
        in_bounds = reg.low <= value <= reg.high
        long_window = text[max(0, m.start() - TO_WINDOW):m.start()]
        if _TO_RE.search(long_window) and _RISE_RE.search(long_window) and all(
            p in long_window.lower() for p in ("price cap", "direct debit")
        ) and _HOUSEHOLD_RE.search(long_window):
            if in_bounds:
                to_figs.add(round(value, 2))
        else:
            # the window never reaches back past the previous pound figure, so one
            # figure's wording cannot qualify the next one
            window = text[max(prev_end, m.start() - WINDOW):m.start()].lower()
            if in_bounds and all(p in window for p in reg.must_have):
                is_figs.add(round(value, 2))
        prev_end = m.end()
    if not to_figs and _RISE_TO_RE.search(text):
        return None  # the page announces a change we could not read: never the outgoing cap
    chosen = to_figs or is_figs
    return (next(iter(chosen)), start) if len(chosen) == 1 else None


def monthly_for(figure_annual: float) -> int:
    """Annual divided by 12, to the pound."""
    return int(figure_annual / 12 + 0.5)


def _plain_url(url: str) -> str:
    from urllib.parse import urlparse
    p = urlparse(url)
    return f"https://{p.netloc}{p.path}"


async def fetch_typical(
    category: str, stats: dict, today: date, search: Search, client=None,
) -> Optional[dict]:
    """The `typical_regulated` value for `category`, or None. `search` runs the
    one restricted search (the caller's Tavily wrapper, which counts the call).
    Counts the read in `stats`. Never raises. A category with no regulator
    returns None with no search, no request and no count."""
    reg = REGULATORS.get(category)
    if reg is None:
        return None
    name = tip_facts.allowed_source_name(reg.host)
    if name is None:
        return None
    result = None
    try:
        searched = await search(reg.query)
        urls = [
            u for u in (searched[1] if searched else [])
            if (h := tip_pages.safe_https_host(u)) and (h == reg.host or h.endswith("." + reg.host))
        ][:reg.max_pages]
        if urls:
            import httpx
            own = client is None
            c = client or httpx.AsyncClient(timeout=tip_pages.TIMEOUT)
            try:
                for u in urls:
                    try:
                        found = extract_annual(category, await tip_pages.fetch_url_text(c, u), today)
                    except Exception:
                        found = None
                    if found is not None:
                        result = {"figure_annual": found[0], "period_start": found[1].isoformat(),
                                  "source_host": reg.host, "source_name": name,
                                  "source_url": _plain_url(u), "read_on": today.isoformat()}
                        break
            finally:
                if own:
                    try:
                        await c.aclose()
                    except Exception:
                        pass
    except Exception:
        result = None
    stats["regulator_read" if result else "regulator_failed"] += 1
    return result


def valid_typical(category: str, value, today: Optional[date] = None) -> Optional[dict]:
    """`value` (a stored typical_regulated) if it is well formed and from the
    category's own regulator, else None. Used at compose time."""
    reg = REGULATORS.get(category)
    if reg is None or not isinstance(value, dict):
        return None
    fig = value.get("figure_annual")
    if isinstance(fig, bool) or not isinstance(fig, (int, float)) or not (reg.low <= fig <= reg.high):
        return None
    if value.get("source_host") != reg.host:
        return None
    if value.get("source_name") != tip_facts.allowed_source_name(reg.host):
        return None
    uh = tip_pages.safe_https_host(str(value.get("source_url") or "")) or ""
    if uh != reg.host and not uh.endswith("." + reg.host):
        return None
    try:
        date.fromisoformat(str(value.get("read_on")))
        period = date.fromisoformat(str(value.get("period_start")))
    except ValueError:
        return None
    if today is not None and period != current_period(today)[0]:
        return None  # the cap period has moved on since it was read
    return value
