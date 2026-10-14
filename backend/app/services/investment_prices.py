"""Shared instrument prices (G270).

One document per instrument in `instrument_prices`, keyed by ISIN with a
fallback to the exchange ticker (and, only for holdings that carry neither,
a normalised name). The collection holds NO user data: holdings reference an
instrument by `instrument_key` and keep their own units; the price lives
here once, however many users hold the fund.

Refresh rule: each instrument is attempted at most once per London day,
shared across users. A failed fetch keeps the last price and its date (never
zero). Sources sit behind the `PriceSource` interface; the Tavily plus LLM
web-search path is the fallback source and is always marked confidence
"low". See docs/investments/price-sources.md for the evaluation.
"""
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Protocol

import httpx

from app.core.config import TAVILY_API_KEY
from app.core.llm import openrouter_chat
from app.core.timeutil import user_today
from app.db.collections import (
    instrument_prices_col, investment_accounts_col, investment_holdings_col,
)

logger = logging.getLogger(__name__)

HISTORY_MAX = 400  # roughly 18 months of trading days, bounded for G271


# ── Identity ────────────────────────────────────────────────────────────────

_ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def instrument_key(isin: str | None, ticker: str | None = None, name: str | None = None) -> str | None:
    """ISIN first, then exchange ticker. A holding with neither falls back to a
    normalised name so it is still priced once rather than never."""
    i = (isin or "").strip().upper().replace(" ", "")
    if _ISIN_RE.match(i):
        return i
    t = (ticker or "").strip().upper()
    if t:
        return f"TICKER:{t}"
    n = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
    return f"NAME:{n}" if n else None


# ── Sources ─────────────────────────────────────────────────────────────────

@dataclass
class PriceQuote:
    price: float
    price_date: str          # YYYY-MM-DD, the day the price is for
    currency: str
    source: str
    confidence: str          # "high" | "medium" | "low"


class PriceSource(Protocol):
    name: str

    async def fetch(self, instrument: dict) -> PriceQuote | None:
        """Return a quote, or None when this source cannot price the
        instrument. May raise; the caller treats a raise as a failed fetch."""
        ...


class LlmSearchSource:
    """Fallback: Tavily web search plus an LLM extraction. Fragile and
    quota-hungry, so it is only reached when no better source quotes, and its
    result is always confidence "low"."""

    name = "web_search"

    async def fetch(self, instrument: dict) -> PriceQuote | None:
        if not TAVILY_API_KEY:
            return None
        name = instrument.get("name") or ""
        isin = instrument.get("isin")
        ticker = instrument.get("ticker")
        ident = isin or ticker
        query = f"{ident} fund unit price GBP" if ident else f"{name} fund unit price GBP today"
        async with httpx.AsyncClient(timeout=60) as client:
            tr = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": TAVILY_API_KEY, "query": query, "search_depth": "basic", "max_results": 3},
            )
        if tr.status_code != 200:
            return None
        results = tr.json().get("results", [])
        if not results:
            return None
        snippets = "\n\n".join(
            f"Source: {res.get('url', '')}\n{res.get('content', '')[:500]}" for res in results[:3]
        )
        prompt = (
            f'Extract the current unit/NAV price in GBP for this holding: "{name}" (ISIN: {isin or "N/A"}).\n'
            f"Search results:\n{snippets}\n\n"
            f"Return ONLY a JSON number (e.g. 289.95) or null if the price cannot be determined. No other text."
        )
        lr = await openrouter_chat(
            {"model": "google/gemini-2.5-flash", "messages": [{"role": "user", "content": prompt}], "temperature": 0},
            user_id=None, pipeline="investment_prices", timeout=30,
        )
        if lr.status_code != 200:
            return None
        raw = lr.json()["choices"][0]["message"]["content"].strip().strip("`").strip()
        try:
            price = float(raw) if raw.lower() != "null" else None
        except ValueError:
            price = None
        if not price or price <= 0:
            return None
        return PriceQuote(
            price=price, price_date=user_today().isoformat(),
            currency=instrument.get("currency") or "GBP", source=self.name, confidence="low",
        )


def default_sources() -> list[PriceSource]:
    """Ordered best first. No free keyless end-of-day source has terms that
    clearly allow this use (docs/investments/price-sources.md), so only the
    low-confidence web-search fallback ships. Add an adapter here to promote
    a better source ahead of it."""
    return [LlmSearchSource()]


# ── Store ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _same_day(dt: datetime | None, today: date) -> bool:
    if dt is None:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    from app.core.timeutil import LONDON
    return dt.astimezone(LONDON).date() == today


async def ensure_instrument(key: str, *, isin=None, ticker=None, name=None, currency="GBP") -> dict:
    """Create the instrument document if absent (no price yet). Never takes a
    user id."""
    doc = await instrument_prices_col.find_one({"_id": key})
    if doc:
        return doc
    doc = {
        "_id": key,
        "isin": None if key.startswith(("TICKER:", "NAME:")) else key,
        "ticker": (ticker or "").strip().upper() or None,
        "name": name, "currency": currency,
        "price": None, "price_date": None, "source": None, "confidence": None,
        "fetched_at": None, "last_attempt_at": None, "history": [],
    }
    await instrument_prices_col.update_one({"_id": key}, {"$setOnInsert": {k: v for k, v in doc.items() if k != "_id"}}, upsert=True)
    return doc


async def record_quote(key: str, quote: PriceQuote, *, current: dict | None = None) -> None:
    """Write a price, appending to the bounded history (one point per day)."""
    cur = current if current is not None else (await instrument_prices_col.find_one({"_id": key})) or {}
    history = [p for p in (cur.get("history") or []) if p.get("price_date") != quote.price_date]
    history.append({"price_date": quote.price_date, "price": quote.price, "source": quote.source})
    history.sort(key=lambda p: p["price_date"])
    history = history[-HISTORY_MAX:]
    now = _utcnow()
    await instrument_prices_col.update_one(
        {"_id": key},
        {"$set": {
            "price": quote.price, "price_date": quote.price_date, "currency": quote.currency,
            "source": quote.source, "confidence": quote.confidence,
            "fetched_at": now, "last_attempt_at": now, "history": history,
        }},
        upsert=True,
    )


async def refresh_instrument(key: str, sources: list[PriceSource] | None = None, *, today: date | None = None) -> str:
    """Refresh one instrument. Returns "fetched", "skipped" or "failed".

    Skipped when already attempted today (a success or a failure), so a day
    costs at most one fetch per instrument across all users. A failure keeps
    the last price and its date and only stamps the attempt."""
    today = today or user_today()
    doc = await instrument_prices_col.find_one({"_id": key})
    if doc is None:
        return "failed"
    if _same_day(doc.get("fetched_at"), today) or _same_day(doc.get("last_attempt_at"), today):
        return "skipped"
    for src in (sources if sources is not None else default_sources()):
        try:
            quote = await src.fetch(doc)
        except Exception:
            logger.warning("instrument price fetch failed: key=%s source=%s", key, getattr(src, "name", "?"), exc_info=True)
            continue
        if quote and quote.price and quote.price > 0:
            await record_quote(key, quote, current=doc)
            return "fetched"
    await instrument_prices_col.update_one({"_id": key}, {"$set": {"last_attempt_at": _utcnow()}})
    return "failed"


async def get_instruments(keys) -> dict:
    keys = sorted({k for k in keys if k})
    if not keys:
        return {}
    docs = await instrument_prices_col.find({"_id": {"$in": keys}}).to_list(None)
    return {d["_id"]: d for d in docs}


def holding_value(h: dict, inst: dict | None) -> float | None:
    """units x shared price, or None when either is missing."""
    units = h.get("units")
    price = (inst or {}).get("price")
    if units and price:
        return round(units * price, 2)
    return None


async def _recompute_account(acc: dict, holdings: list[dict], insts: dict) -> float:
    total = 0.0
    for h in holdings:
        v = holding_value(h, insts.get(h.get("instrument_key")))
        total += v if v is not None else (h.get("statement_value") or 0)
    await investment_accounts_col.update_one(
        {"_id": acc["_id"]}, {"$set": {"total_value": round(total, 2), "last_refreshed": _utcnow()}},
    )
    return round(total, 2)


async def _link_holdings(holdings: list[dict]) -> None:
    """Make sure every holding has an instrument and a key (lazy link for
    holdings created before the migration or without an ISIN)."""
    for h in holdings:
        key = h.get("instrument_key") or instrument_key(h.get("isin"), h.get("ticker"), h.get("name"))
        if not key:
            continue
        if h.get("instrument_key") != key:
            await investment_holdings_col.update_one({"_id": h["_id"]}, {"$set": {"instrument_key": key}})
            h["instrument_key"] = key
        await ensure_instrument(key, isin=h.get("isin"), ticker=h.get("ticker"), name=h.get("name"))


async def refresh_account_prices(acc: dict, sources: list[PriceSource] | None = None) -> dict:
    """User-triggered refresh for one account: refreshes only the instruments
    it holds (each at most once a day, shared), then recomputes the total.
    Returns {"updated": int, "new_total": float}."""
    holdings = await investment_holdings_col.find({"account_id": acc["_id"]}).to_list(None)
    await _link_holdings(holdings)
    keys = {h["instrument_key"] for h in holdings if h.get("instrument_key")}
    updated = 0
    for key in sorted(keys):
        if await refresh_instrument(key, sources) == "fetched":
            updated += 1
    insts = await get_instruments(keys)
    total = await _recompute_account(acc, holdings, insts)
    return {"updated": updated, "new_total": total}


async def refresh_all_instruments(sources: list[PriceSource] | None = None) -> dict:
    """Worker job: iterate DISTINCT instruments, not users. Afterwards every
    account total is recomputed from the shared prices. Returns counts and the
    set of users whose figures moved (for data_version bumps)."""
    holdings = await investment_holdings_col.find({}).to_list(None)
    await _link_holdings(holdings)
    keys = {h["instrument_key"] for h in holdings if h.get("instrument_key")}
    fetched = failed = 0
    for key in sorted(keys):
        outcome = await refresh_instrument(key, sources)
        fetched += outcome == "fetched"
        failed += outcome == "failed"
    insts = await get_instruments(keys)
    by_acc: dict[str, list[dict]] = {}
    for h in holdings:
        by_acc.setdefault(h["account_id"], []).append(h)
    changed_users: set = set()
    accs = await investment_accounts_col.find({}).to_list(None)
    for acc in accs:
        hs = by_acc.get(acc["_id"])
        if not hs:
            continue
        before = acc.get("total_value")
        after = await _recompute_account(acc, hs, insts)
        if fetched and before != after and acc.get("user_id"):
            changed_users.add(acc["user_id"])
    return {"instruments": len(keys), "fetched": fetched, "failed": failed, "changed_users": changed_users}
