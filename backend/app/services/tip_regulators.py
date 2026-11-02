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

Stored: {"figure_annual": 1663.0, "source_host": "ofgem.gov.uk", "source_name": "Ofgem",
         "source_url": "https://www.ofgem.gov.uk/...", "read_on": "2026-11-02"}
The card shows "Typical: £139 a month (Ofgem price cap £1,663 a year, 2 Nov 2026)."
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


def extract_annual(category: str, text: str) -> Optional[float]:
    """The one annual figure on `text` for `category`, or None. Strict: the
    category's phrases must all sit within the WINDOW characters before the
    figure; the window never reaches back past an earlier pound figure of any
    kind (so "...is £1,663 ... will rise by £60 per year to £1,723" qualifies
    only £1,663); the value must be inside the plausibility bounds; two
    different qualifying figures mean the page is ambiguous and yield None."""
    reg = REGULATORS.get(category)
    if reg is None or not text:
        return None
    found: set[float] = set()
    prev_end = 0
    for m in _POUND_RE.finditer(text):
        window = text[max(prev_end, m.start() - WINDOW):m.start()].lower()
        prev_end = m.end()
        if not all(p in window for p in reg.must_have):
            continue
        try:
            value = float(m.group(0).replace("£", "").replace(",", "").strip())
        except ValueError:
            continue
        if reg.low <= value <= reg.high:
            found.add(round(value, 2))
    return next(iter(found)) if len(found) == 1 else None


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
                        figure = extract_annual(category, await tip_pages.fetch_url_text(c, u))
                    except Exception:
                        figure = None
                    if figure is not None:
                        result = {"figure_annual": figure, "source_host": reg.host, "source_name": name,
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


def valid_typical(category: str, value) -> Optional[dict]:
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
    except ValueError:
        return None
    return value
