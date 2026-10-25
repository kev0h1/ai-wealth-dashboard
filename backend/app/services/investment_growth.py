"""Investment account value and daily snapshots (G271, G277, G333, G338).

THE account value is account_value(): units x the shared latest price, cash and
unpriced holdings at statement value, plus funds bought by contract note. G338
removed the growth, gain and anchor views; the value, the date of its prices
and the daily valuation snapshot (written by the price worker, kept for the
history) remain.

One snapshot per account per London day: the document id is
`<account_id>|<YYYY-MM-DD>`, so a re-run the same day overwrites rather than
duplicates. Every document carries `user_id`, so erase_user removes them.
"""
import logging
from datetime import date, datetime

from app.core.timeutil import user_today
from app.db.collections import (
    investment_accounts_col, investment_holdings_col, investment_notes_col,
    investment_valuations_col,
)
from app.services import investment_anchor as ia
from app.services.investment_prices import (
    best_match, get_instruments, holding_value, instrument_key, norm_name as _norm, note_only_instruments,
)

logger = logging.getLogger(__name__)



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


async def account_value(acc: dict, holdings: list[dict] | None = None, notes: list[dict] | None = None,
                        insts: dict | None = None) -> tuple[float, dict]:
    """G333: THE account value, used by the Accounts header, the growth card,
    the holdings list and the daily snapshot. It is build_positions()["value"]:
    units x latest price for everything priced (including funds bought by
    contract note after the statement), cash and unpriced holdings at their
    statement value. Loads whatever it is not given. Returns (value, positions)."""
    if holdings is None:
        holdings = await investment_holdings_col.find({"account_id": acc["_id"]}).to_list(None)
    if notes is None:
        notes = await investment_notes_col.find({"account_id": acc["_id"]}).to_list(None)
    keys = [h.get("instrument_key") for h in holdings] + [instrument_key(None, None, n.get("fund_name")) for n in notes]
    insts = dict(insts or {})
    missing = [k for k in keys if k and k not in insts]
    if missing:
        insts.update(await get_instruments(missing))
    pos = build_positions(_as_date(acc.get("statement_date")), holdings, notes, insts,
                          ia.all_fee_lines(acc.get("statement_periods") or []))
    pos["insts"] = insts  # the instruments used, so callers (price_dating) need not query again
    return pos["value"], pos


def price_dating(insts: dict, holdings: list[dict], notes: list[dict], stmt_date) -> dict:
    """G333: how fresh the prices behind the account value are. Looks at the
    priced instruments of the holdings and of note-only funds."""
    keys = {h.get("instrument_key") for h in holdings}
    for key, _name in note_only_instruments(stmt_date, holdings, notes):
        keys.add(key)
    priced = [insts[k] for k in keys if k and insts.get(k) and insts[k].get("price") and insts[k].get("price_date")]
    dates = sorted(str(i["price_date"])[:10] for i in priced)
    low = any(i.get("confidence") == "low" or i.get("source") in ("legacy", "migrated") for i in priced)
    return {"prices_as_of": dates[-1] if dates else None, "prices_oldest": dates[0] if dates else None,
            "price_confidence": "low" if low else "normal"}


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

    # G333: the canonical account value (post-statement notes at units x price).
    value, _pos = await account_value(acc, holdings, notes, insts)
    doc = {
        "_id": _doc_id(account_id, today), "user_id": acc.get("user_id"),
        "account_id": account_id, "date": today.isoformat(),
        # Kept for the G276 reset; the headline no longer reads it (G277).
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


def _num(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def build_positions(stmt_date: date | None, holdings: list[dict], notes: list[dict], insts: dict,
                    fee_lines: list[dict] | None = None) -> dict:
    """Pure (G277). One row per holding, plus one per fund bought by contract
    note that is not a statement holding. Cost is only ever what is known:
    the statement's book cost, or the contract notes' amounts. A holding with
    neither has cost None and contributes no gain. Notes dated after the
    statement are not in the statement's units, so they add their own part
    (units x shared price when both are known, otherwise at cost)."""
    rows: list[dict] = []
    for h in holdings:
        inst = insts.get(h.get("instrument_key"))
        cur = holding_value(h, inst)
        stmt = h.get("statement_value") or 0
        bc = _num(h.get("book_cost"))
        cost = bc if bc is not None and bc >= 0 else None
        rows.append({
            "id": h["_id"], "name": h.get("name"), "isin": h.get("isin"), "type": h.get("type", "Fund"),
            "value": cur if cur is not None else stmt, "statement_value": stmt,
            "price_date": (inst or {}).get("price_date") if cur is not None else None,
            "cost": cost, "cost_source": (h.get("book_cost_source") or "statement") if cost is not None else None,
            "_nk": _norm(h.get("name")), "_contribs": [(None, cost)] if cost is not None else [],
            "_units": h.get("units"), "_key": h.get("instrument_key"), "_parts": [], "_known": cost is not None,
            "_held": h.get("units") or None,
        })
    adj_value = 0.0
    fee_adj = 0.0  # fees taken by selling units: value falls, cost does not
    for n in sorted(notes, key=lambda x: str(x.get("trade_date"))):
        d = _as_date(n.get("trade_date"))
        if stmt_date is not None and d is not None and d <= stmt_date:
            continue  # already inside the statement's value
        amt = n.get("amount") or 0.0
        nk = _norm(n.get("fund_name"))
        idx = best_match(nk, [r["_nk"] for r in rows])
        row = rows[idx] if idx is not None else None
        if ia.is_fee_note(n, fee_lines):
            # G278: a fee-driven sale is a fee. It lowers value but is neither a
            # withdrawal nor a sale that removes cost.
            if row is None:
                fee_adj += amt
                continue
            row["value"] = round(row["value"] + amt, 2)
            fu = _num(n.get("units"))
            if row["_held"] and fu:
                row["_held"] = max(0.0, row["_held"] - fu)
            continue
        if row is None and amt > 0 and nk:
            key = instrument_key(None, None, n.get("fund_name"))
            row = {
                "id": f"note:{key}", "name": n.get("fund_name"), "isin": None, "type": "Fund", "value": 0.0,
                "statement_value": 0, "price_date": None, "cost": 0.0, "cost_source": "contract_notes",
                "_nk": nk, "_contribs": [], "_units": None, "_key": key, "_parts": [], "_known": True,
                "_held": 0.0,
            }
            rows.append(row)
        if row is None:
            adj_value += amt  # a sale of something not held: value and cost move together
            continue
        inst = insts.get(row["_key"]) or insts.get(instrument_key(None, None, n.get("fund_name")))
        units, price = _num(n.get("units")), (inst or {}).get("price")
        part = round(units * price, 2) if units and price and amt > 0 else amt
        value_before = row["value"]
        row["value"] = round(row["value"] + part, 2)
        row["_parts"].append((d, n.get("units"), amt))
        n_units = _num(n.get("units"))
        held_before = row["_held"]
        if amt > 0:
            row["_held"] = held_before + n_units if held_before is not None and n_units else None
        if row["_known"]:
            if amt > 0:
                row["cost"] = round((row["cost"] or 0.0) + amt, 2)
                row["_contribs"].append((d, amt))
                if row["cost_source"] is None:
                    row["cost_source"] = "contract_notes"
            else:
                # A sale removes its share of the cost, not the proceeds:
                # units sold over units held, else proceeds over value before.
                if n_units and held_before:
                    ratio = min(1.0, n_units / held_before)
                elif value_before > 0:
                    ratio = min(1.0, -amt / value_before)
                else:
                    ratio = None
                if ratio is None:
                    row["_known"] = False
                else:
                    cut = round((row["cost"] or 0.0) * ratio, 2)
                    row["cost"] = max(0.0, round((row["cost"] or 0.0) - cut, 2))
                    row["_contribs"].append((d, -cut))
                    if held_before:
                        row["_held"] = max(0.0, held_before - n_units) if n_units else None
        elif amt < 0 and held_before and n_units:
            row["_held"] = max(0.0, held_before - n_units)
        if inst and inst.get("price_date") and not row["price_date"]:
            row["price_date"] = inst["price_date"]
    for r in rows:
        r["value"] = round(r["value"], 2)
        known = r["cost"] is not None and r["_known"]
        if not known:
            r["cost"] = r["cost_source"] = None
        # since the last statement (kept for older clients)
        r["change_abs"] = round(r["value"] - r["statement_value"], 2) if r["price_date"] and r["statement_value"] else None
        r["change_pct"] = (round(r["change_abs"] / r["statement_value"] * 100, 2)
                           if r["change_abs"] is not None and r["statement_value"] > 0 else None)
        # G278: every holding lists its units and price (None reads "no price yet")
        held = r["_held"]
        r["units"] = round(held, 4) if held is not None and held > 0 else None
        px = (insts.get(r["_key"]) or {}).get("price")
        r["price"] = px if px and r["units"] else None
    value = round(sum(r["value"] for r in rows) + adj_value + fee_adj, 2)
    return {"rows": rows, "value": value, "adj": round(adj_value, 2), "stmt_date": stmt_date, "fees_after": round(fee_adj, 2)}
