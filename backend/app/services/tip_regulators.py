"""G405: the "Typical" line comes from a regulator, never from a hardcoded figure.

A small table maps a tip category to the regulator page that may state a
typical monthly figure. The research fetches that page (`tip_pages`), and a
strict, model-free rule reads one figure from it. When the wording is absent,
ambiguous or the page cannot be read, nothing is stored and the card has no
Typical line. The stored value is
  {"amount": 94.5, "source_host": "ofgem.gov.uk", "source_name": "Ofgem", "read_on": "2026-11-02"}
and the card shows "Typical: £94.50 a month (Ofgem, 2 Nov 2026)".

The page URLs below could not be checked against the live sites from this
build (no live calls from tests or tooling); a wrong URL simply fails to
fetch and yields no line.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Optional

from app.services import tip_facts, tip_pages


@dataclass(frozen=True)
class Regulator:
    url: str
    host: str
    # every phrase must appear (case-insensitive) in the WINDOW characters before the figure
    must_have: tuple[str, ...]
    low: float   # plausibility bounds, pounds a month
    high: float


WINDOW = 200

REGULATORS: dict[str, Regulator] = {
    "energy": Regulator(
        "https://www.ofgem.gov.uk/energy-price-cap", "ofgem.gov.uk",
        ("price cap", "typical household"), 20, 500,
    ),
    "mobile": Regulator(
        "https://www.ofcom.org.uk/phones-and-broadband/saving-money/average-household-spend", "ofcom.org.uk",
        ("average", "monthly", "mobile"), 5, 100,
    ),
    "broadband": Regulator(
        "https://www.ofcom.org.uk/phones-and-broadband/saving-money/average-household-spend", "ofcom.org.uk",
        ("average", "monthly", "broadband"), 10, 150,
    ),
}

_MONTHLY_FIGURE_RE = re.compile(
    r"£\s*(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:per month|a month|each month|/\s*month)", re.IGNORECASE,
)


def extract_monthly(category: str, text: str) -> Optional[float]:
    """The one labelled monthly figure on `text` for `category`, or None.
    Strict: the figure must be followed by "per month" or "a month", the
    category's required phrases must all sit within the WINDOW characters
    before it, it must be inside the plausibility bounds, and when two
    different qualifying figures appear the page is ambiguous and yields None.
    An annual figure is never converted."""
    reg = REGULATORS.get(category)
    if reg is None or not text:
        return None
    found: set[float] = set()
    for m in _MONTHLY_FIGURE_RE.finditer(text):
        window = text[max(0, m.start() - WINDOW):m.end()].lower()
        if not all(p in window for p in reg.must_have):
            continue
        try:
            value = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if reg.low <= value <= reg.high:
            found.add(round(value, 2))
    return next(iter(found)) if len(found) == 1 else None


async def fetch_typical(category: str, stats: dict, today: date, client=None) -> Optional[dict]:
    """The `typical_regulated` value for `category`, or None. Counts the read
    in `stats`. Never raises. Categories with no regulator return None without
    a request or a count."""
    reg = REGULATORS.get(category)
    if reg is None:
        return None
    name = tip_facts.allowed_source_name(reg.host)
    if name is None:
        return None
    own = client is None
    try:
        import httpx
        c = client or httpx.AsyncClient(timeout=tip_pages.TIMEOUT)
    except Exception:
        stats["regulator_failed"] += 1
        return None
    try:
        text = await tip_pages.fetch_url_text(c, reg.url)
        amount = extract_monthly(category, text)
    except Exception:
        amount = None
    finally:
        if own:
            try:
                await c.aclose()
            except Exception:
                pass
    if amount is None:
        stats["regulator_failed"] += 1
        return None
    stats["regulator_read"] += 1
    return {"amount": amount, "source_host": reg.host, "source_name": name, "read_on": today.isoformat()}


def valid_typical(category: str, value) -> Optional[dict]:
    """`value` (a stored typical_regulated) if it is well formed and from the
    category's own regulator, else None. Used at compose time."""
    reg = REGULATORS.get(category)
    if reg is None or not isinstance(value, dict):
        return None
    amount = value.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not (reg.low <= amount <= reg.high):
        return None
    if value.get("source_host") != reg.host:
        return None
    if value.get("source_name") != tip_facts.allowed_source_name(reg.host):
        return None
    try:
        date.fromisoformat(str(value.get("read_on")))
    except ValueError:
        return None
    return value
