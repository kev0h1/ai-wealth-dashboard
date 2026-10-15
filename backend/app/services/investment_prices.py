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

from app.core.config import OPENROUTER_API_KEY, TAVILY_API_KEY
from app.core.llm import openrouter_chat
from app.core.timeutil import as_utc, to_user_date, user_today
from app.db.collections import (
    instrument_prices_col, investment_accounts_col, investment_holdings_col, investment_notes_col,
)

logger = logging.getLogger(__name__)

HISTORY_MAX = 400  # roughly 18 months of trading days, bounded for G271
MAX_DAILY_MOVE = 0.40  # reject a new price more than 40 percent from the last known one


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


def norm_name(name: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def _same_fund(a: str, b: str) -> bool:
    """Contract notes carry a fund name, not an ISIN, so match on the
    normalised name (equal, or one contained in the other)."""
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 8 and short in long_


def best_match(nk: str, names: list[str]) -> int | None:
    """Index of the best name match: an exact match wins, otherwise the
    longest matching name, otherwise the first of equals."""
    best, best_len = None, -1
    for i, n in enumerate(names):
        if not _same_fund(nk, n):
            continue
        if n == nk:
            return i
        if len(n) > best_len:
            best, best_len = i, len(n)
    return best


def note_only_instruments(stmt_date, holdings: list[dict], notes: list[dict]) -> list[tuple[str, str]]:
    """(instrument key, fund name) for every fund bought by a contract note
    dated after the statement that matches no holding. Shared by the growth
    helper and both price refresh paths so such a fund is actually priced."""
    sd = stmt_date.date() if isinstance(stmt_date, datetime) else stmt_date
    names = [norm_name(h.get("name")) for h in holdings]
    out: list[tuple[str, str]] = []
    for n in sorted(notes, key=lambda x: str(x.get("trade_date"))):
        td = n.get("trade_date")
        d = td.date() if isinstance(td, datetime) else td
        if sd is not None and d is not None and d <= sd:
            continue
        nk = norm_name(n.get("fund_name"))
        if not nk or (n.get("amount") or 0) <= 0 or best_match(nk, names) is not None:
            continue
        names.append(nk)
        out.append((instrument_key(None, None, n.get("fund_name")), n.get("fund_name")))
    return out


def sanitise_name(name: str | None, limit: int = 80) -> str:
    """The first uploader's fund name feeds a prompt shown for every holder, so
    keep letters, digits, spaces and basic punctuation only, and cap length."""
    return re.sub(r"[^A-Za-z0-9 .,&()'/+-]", "", name or "").strip()[:limit]


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

    @property
    def configured(self) -> bool:
        return bool(TAVILY_API_KEY and OPENROUTER_API_KEY)

    async def fetch(self, instrument: dict) -> PriceQuote | None:
        if not self.configured:
            return None
        name = sanitise_name(instrument.get("name"))
        isin = instrument.get("isin")
        ticker = instrument.get("ticker")
        ident = isin or ticker
        # ISIN or ticker is the primary term; the name only helps when neither exists.
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
            f'Extract the current unit/NAV price in GBP for the instrument with identifier {ident or "N/A"} (name: "{name}").\n'
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
    return datetime.now(timezone.utc)  # naive-ok: tz-aware persisted timestamp


def _same_day(dt: datetime | None, today: date) -> bool:
    if dt is None:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    from app.core.timeutil import LONDON
    return dt.astimezone(LONDON).date() == today


async def ensure_instrument(key: str, *, isin=None, ticker=None, name=None, currency="GBP", seed: dict | None = None) -> dict:
    """Create the instrument document if absent, optionally seeded from a
    holding's legacy price (see legacy_seed). An existing document with no
    price is seeded too; one with a price is never overwritten. Never takes a
    user id."""
    doc = await instrument_prices_col.find_one({"_id": key})
    if doc:
        if seed and not doc.get("price"):
            hist = [{"price_date": seed["price_date"], "price": seed["price"], "source": seed["source"]}]
            await instrument_prices_col.update_one({"_id": key}, {"$set": {**seed, "history": hist}})
            doc = {**doc, **seed, "history": hist}
        return doc
    doc = {
        "_id": key,
        "isin": None if key.startswith(("TICKER:", "NAME:")) else key,
        "ticker": (ticker or "").strip().upper() or None,
        "name": name, "currency": currency,
        "price": None, "price_date": None, "source": None, "confidence": None,
        "fetched_at": None, "last_attempt_at": None, "history": [],
    }
    if seed:
        doc.update(seed)
        doc["history"] = [{"price_date": seed["price_date"], "price": seed["price"], "source": seed["source"]}]
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
    """Refresh one instrument. Returns "fetched", "skipped", "failed" or
    "unavailable".

    Skipped when already attempted today (a success or a failure), so a day
    costs at most one fetch per instrument across all users. A failure keeps
    the last price and its date and only stamps the attempt. When no source
    is configured (missing API keys) nothing is stamped and the status is
    "unavailable", so the day is not burned. A quote more than 40 percent
    from the last known price is rejected as implausible."""
    today = today or user_today()
    doc = await instrument_prices_col.find_one({"_id": key})
    if doc is None:
        return "failed"
    if _same_day(doc.get("fetched_at"), today) or _same_day(doc.get("last_attempt_at"), today):
        return "skipped"
    usable = [s for s in (sources if sources is not None else default_sources()) if getattr(s, "configured", True)]
    if not usable:
        return "unavailable"
    last = doc.get("price")
    if doc.get("source") in ("legacy", "migrated"):
        last = None  # a seed is not a real quote: the first real one replaces it, the bound applies after
    for src in usable:
        try:
            quote = await src.fetch(doc)
        except Exception:
            logger.warning("instrument price fetch failed: key=%s source=%s", key, getattr(src, "name", "?"), exc_info=True)
            continue
        if not (quote and quote.price and quote.price > 0):
            continue
        if last and abs(quote.price / last - 1) > MAX_DAILY_MOVE:
            logger.warning(
                "instrument price rejected as implausible: key=%s source=%s old=%s new=%s",
                key, getattr(src, "name", "?"), last, quote.price,
            )
            continue
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


def legacy_price(h: dict) -> float | None:
    """The per-holding price the app stored before G270, if any."""
    p = h.get("current_price")
    if p:
        return p
    units, val = h.get("units"), h.get("current_value")
    return round(val / units, 6) if units and val else None


def legacy_seed(h: dict, source: str = "legacy") -> dict | None:
    """Instrument fields that carry what the user already saw: the legacy
    price, dated as the London day of its last refresh, confidence "low"."""
    price, lr = legacy_price(h), h.get("last_refreshed")
    if not price or not lr:
        return None
    lr_utc = as_utc(lr)
    return {"price": price, "price_date": to_user_date(lr_utc).isoformat(), "source": source,
            "confidence": "low", "fetched_at": lr_utc}


def holding_value(h: dict, inst: dict | None) -> float | None:
    """units x shared price. With no shared price, fall back to the holding's
    legacy current_value, then legacy price x units, so an unpriced instrument
    never drops the figure below what the user already saw. None when nothing
    is known (callers then use statement_value)."""
    units = h.get("units")
    price = (inst or {}).get("price")
    if units and price:
        return round(units * price, 2)
    if h.get("current_value") is not None:
        return h["current_value"]
    lp = legacy_price(h)
    if units and lp:
        return round(units * lp, 2)
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
        await ensure_instrument(key, isin=h.get("isin"), ticker=h.get("ticker"), name=h.get("name"),
                                seed=legacy_seed(h))


async def _recompute_for_keys(keys: set, insts: dict) -> set:
    """Recompute every account (any user) holding one of `keys` from the
    shared prices. Returns the users whose total moved."""
    holdings = await investment_holdings_col.find({"instrument_key": {"$in": sorted(keys)}}).to_list(None)
    acc_ids = {h["account_id"] for h in holdings}
    changed: set = set()
    for acc_id in sorted(acc_ids):
        acc = await investment_accounts_col.find_one({"_id": acc_id})
        if not acc:
            continue
        hs = await investment_holdings_col.find({"account_id": acc_id}).to_list(None)
        await _link_holdings(hs)
        before = acc.get("total_value")
        after = await _recompute_account(acc, hs, insts)
        if before != after and acc.get("user_id"):
            changed.add(acc["user_id"])
    return changed


async def _bump(users: set) -> None:
    from app.services import data_version
    for uid in users:
        try:
            await data_version.bump(uid)
        except Exception:
            logger.exception("investment price refresh: version bump failed")


def _status(outcomes: list[str]) -> str:
    if "fetched" in outcomes:
        return "updated"
    if outcomes and all(o == "unavailable" for o in outcomes):
        return "unavailable"
    if outcomes and all(o == "skipped" for o in outcomes):
        return "skipped"
    return "failed" if "failed" in outcomes else "skipped"


async def _link_note_only(acc: dict, holdings: list[dict], notes: list[dict]) -> set:
    keys = set()
    for key, name in note_only_instruments(acc.get("statement_date"), holdings, notes):
        await ensure_instrument(key, name=sanitise_name(name))
        keys.add(key)
    return keys


async def refresh_account_prices(acc: dict, sources: list[PriceSource] | None = None) -> dict:
    """User-triggered refresh for one account: refreshes only the instruments
    it holds (each at most once a day, shared), then recomputes the total of
    every account holding them and bumps those users' data version.
    Returns {"updated": int, "new_total": float, "status": "updated" |
    "skipped" | "failed" | "unavailable"}."""
    holdings = await investment_holdings_col.find({"account_id": acc["_id"]}).to_list(None)
    await _link_holdings(holdings)
    keys = {h["instrument_key"] for h in holdings if h.get("instrument_key")}
    notes = await investment_notes_col.find({"account_id": acc["_id"]}).to_list(None)
    keys |= await _link_note_only(acc, holdings, notes)  # G277
    outcomes = [await refresh_instrument(key, sources) for key in sorted(keys)]
    insts = await get_instruments(keys)
    changed = await _recompute_for_keys(keys, insts) if keys else set()
    total = await _recompute_account(acc, holdings, insts)  # also covers accounts with no linkable holdings
    await _bump(changed)
    return {"updated": outcomes.count("fetched"), "new_total": total, "status": _status(outcomes)}


async def refresh_all_instruments(sources: list[PriceSource] | None = None) -> dict:
    """Worker job: iterate DISTINCT instruments, not users. Afterwards every
    account total is recomputed from the shared prices. Returns counts and the
    set of users whose figures moved (for data_version bumps)."""
    holdings = await investment_holdings_col.find({}).to_list(None)
    await _link_holdings(holdings)
    keys = {h["instrument_key"] for h in holdings if h.get("instrument_key")}
    all_notes = await investment_notes_col.find({}).to_list(None)
    notes_by_acc: dict[str, list[dict]] = {}
    for n in all_notes:
        notes_by_acc.setdefault(n.get("account_id"), []).append(n)
    hold_by_acc: dict[str, list[dict]] = {}
    for h in holdings:
        hold_by_acc.setdefault(h["account_id"], []).append(h)
    for acc_ in await investment_accounts_col.find({}).to_list(None):  # G277: note-only funds
        keys |= await _link_note_only(acc_, hold_by_acc.get(acc_["_id"], []), notes_by_acc.get(acc_["_id"], []))
    outcomes = [await refresh_instrument(key, sources) for key in sorted(keys)]
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
        if before != after and acc.get("user_id"):
            changed_users.add(acc["user_id"])
    return {"instruments": len(keys), "fetched": outcomes.count("fetched"),
            "failed": outcomes.count("failed"), "unavailable": outcomes.count("unavailable"),
            "changed_users": changed_users}
