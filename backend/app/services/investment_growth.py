"""Portfolio growth over time for investment accounts (G271).

A daily valuation snapshot per account (what the holdings are worth at the
shared end-of-day prices, plus anything bought since the statement) is
written by the daily price worker after prices refresh. Each snapshot also
carries `paid_in_to_date`, the money put in so far, so growth is the simple
difference: value minus paid in. That is deliberately not a money-weighted
return; the API labels it "simple".

What "paid in" means here, honestly: a statement states a value, not what was
deposited to reach it. The first statement value is therefore the opening
paid-in figure (the point tracking starts from), and every contract note
dated after it (a purchase adds, a sale subtracts) moves paid in from there.

One snapshot per account per London day: the document id is
`<account_id>|<YYYY-MM-DD>`, so a re-run the same day overwrites rather than
duplicates. Every document carries `user_id`, so erase_user removes them.
"""
import logging
from datetime import date, datetime, timedelta

from app.core.timeutil import user_today
from app.db.collections import (
    investment_accounts_col, investment_holdings_col, investment_notes_col,
    investment_valuations_col,
)
from app.services.investment_prices import get_instruments, holding_value

logger = logging.getLogger(__name__)

RANGE_DAYS = {"1m": 30, "3m": 91, "6m": 182, "1y": 365, "all": None}
METHOD = "simple"
METHOD_LABEL = "Value minus money paid in"


def _as_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def holdings_value(holdings: list[dict], insts: dict) -> float:
    """Sum of units x shared price, falling back to the statement value for a
    holding that is unlinked or unpriced (the same rule the account total uses)."""
    total = 0.0
    for h in holdings:
        v = holding_value(h, insts.get(h.get("instrument_key")))
        total += v if v is not None else (h.get("statement_value") or 0)
    return round(total, 2)


def net_contributions(notes: list[dict], after: date | None, upto: date) -> float:
    """Signed contract-note amounts dated in (after, upto]. A sale is stored
    negative, so this is money in minus money out."""
    total = 0.0
    for n in notes:
        d = _as_date(n.get("trade_date"))
        if d is None or d > upto or (after is not None and d <= after):
            continue
        total += n.get("amount") or 0.0
    return round(total, 2)


def _doc_id(account_id: str, d: date) -> str:
    return f"{account_id}|{d.isoformat()}"


async def snapshot_account(acc: dict, holdings: list[dict], insts: dict, today: date | None = None) -> dict | None:
    """Write (or overwrite) today's snapshot for one account. Returns the
    snapshot, or None when there is nothing to value."""
    today = today or user_today()
    account_id = acc["_id"]
    notes = await investment_notes_col.find({"account_id": account_id}).to_list(None)
    if not holdings and not notes:
        return None
    stmt_date = _as_date(acc.get("statement_date"))
    baseline = round(sum((h.get("statement_value") or 0) for h in holdings), 2)

    prior_docs = await investment_valuations_col.find({"account_id": account_id}).to_list(None)
    prior_docs = sorted((p for p in prior_docs if p["date"] < today.isoformat()), key=lambda p: p["date"])

    if not prior_docs and stmt_date is not None and stmt_date < today and holdings:
        # First ever snapshot: seed the series at the statement itself so the
        # chart starts from the value the user uploaded.
        seed = {
            "_id": _doc_id(account_id, stmt_date), "user_id": acc.get("user_id"),
            "account_id": account_id, "date": stmt_date.isoformat(),
            "value": baseline, "paid_in_to_date": baseline, "seeded": True,
        }
        await investment_valuations_col.update_one({"_id": seed["_id"]}, {"$set": seed}, upsert=True)
        prior_docs = [seed]

    if prior_docs:
        last = prior_docs[-1]
        paid_in = last["paid_in_to_date"] + net_contributions(notes, _as_date(last["date"]), today)
    else:
        paid_in = net_contributions(notes, None, today)

    # Notes dated after the statement are bought but not yet in the holdings'
    # units, so they join the value at cost (the same rule the account card
    # uses for display_value).
    value = holdings_value(holdings, insts) + net_contributions(notes, stmt_date, today)
    doc = {
        "_id": _doc_id(account_id, today), "user_id": acc.get("user_id"),
        "account_id": account_id, "date": today.isoformat(),
        "value": round(value, 2), "paid_in_to_date": round(paid_in, 2),
    }
    await investment_valuations_col.update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)
    return doc


async def snapshot_all_accounts(today: date | None = None) -> dict:
    """Worker job, run after the shared prices refresh. One failing account
    never blocks the rest."""
    today = today or user_today()
    accs = await investment_accounts_col.find({}).to_list(None)
    all_holdings = await investment_holdings_col.find({}).to_list(None)
    by_acc: dict[str, list[dict]] = {}
    for h in all_holdings:
        by_acc.setdefault(h["account_id"], []).append(h)
    insts = await get_instruments(h.get("instrument_key") for h in all_holdings)
    written = failed = 0
    for acc in accs:
        try:
            if await snapshot_account(acc, by_acc.get(acc["_id"], []), insts, today):
                written += 1
        except Exception:
            failed += 1
            logger.exception("investment snapshot failed for %s", acc.get("_id"))
    return {"written": written, "failed": failed}


def _holding_changes(holdings: list[dict], insts: dict) -> list[dict]:
    """Per-holding change since the last statement: current value minus the
    statement value. Only meaningful for a holding priced from the shared
    table; an unpriced one is reported with change None."""
    out = []
    for h in holdings:
        inst = insts.get(h.get("instrument_key"))
        stmt = h.get("statement_value") or 0
        cur = holding_value(h, inst)
        change = round(cur - stmt, 2) if cur is not None else None
        pct = round(change / stmt * 100, 2) if change is not None and stmt > 0 else None
        out.append({
            "id": h["_id"], "name": h.get("name"), "isin": h.get("isin"),
            "type": h.get("type", "Fund"), "value": cur if cur is not None else stmt,
            "statement_value": stmt, "change_abs": change, "change_pct": pct,
            "price_date": (inst or {}).get("price_date") if cur is not None else None,
        })
    out.sort(key=lambda r: -(r["value"] or 0))
    return out


def build_growth(snapshots: list[dict], range_key: str, today: date) -> dict:
    """Pure: series, paid in and simple growth for one range."""
    days = RANGE_DAYS[range_key]
    snaps = sorted(snapshots, key=lambda p: p["date"])
    if days is not None:
        cutoff = (today - timedelta(days=days)).isoformat()
        snaps = [p for p in snaps if p["date"] >= cutoff]
    points = [{"date": p["date"], "value": p["value"], "paid_in": p["paid_in_to_date"]} for p in snaps]
    base = {"range": range_key, "method": METHOD, "method_label": METHOD_LABEL, "points": points}
    if not points:
        return {**base, "since": None, "as_of": None, "value": None, "paid_in": None,
                "growth_abs": None, "growth_pct": None}
    first, last = points[0], points[-1]
    growth = round((last["value"] - last["paid_in"]) - (first["value"] - first["paid_in"]), 2)
    # Capital at the start of the range plus what was added during it.
    capital = first["value"] + (last["paid_in"] - first["paid_in"])
    pct = round(growth / capital * 100, 2) if capital > 0 else None
    return {**base, "since": first["date"], "as_of": last["date"], "value": last["value"],
            "paid_in": last["paid_in"], "growth_abs": growth, "growth_pct": pct}


async def account_growth(acc: dict, range_key: str, today: date | None = None) -> dict:
    today = today or user_today()
    snaps = await investment_valuations_col.find({"account_id": acc["_id"]}).to_list(None)
    holdings = await investment_holdings_col.find({"account_id": acc["_id"]}).to_list(None)
    insts = await get_instruments(h.get("instrument_key") for h in holdings)
    stmt = _as_date(acc.get("statement_date"))
    return {
        "account_id": acc["_id"], "currency": acc.get("currency", "GBP"),
        "statement_date": stmt.isoformat() if stmt else None,
        **build_growth(snaps, range_key, today),
        "holdings": _holding_changes(holdings, insts),
    }
