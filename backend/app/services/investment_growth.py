"""Portfolio growth for investment accounts (G271, reworked by G277).

Headline growth is cost versus value (G277): paid in is the sum of known
costs (a statement's book cost, plus contract notes dated after it), current
value is units x the shared price, and gain is the difference over the holdings
whose cost is known. A holding with no known cost reads "Cost not known" and
adds no gain. A sale removes its proportional share of cost, not its proceeds.
That is deliberately not a time-weighted return; the API labels it "simple".

A daily valuation snapshot per account is still written by the daily price
worker after prices refresh; it feeds the chart series. Its `paid_in_to_date`
is no longer read for the headline and is kept only for the G276 reset.

One snapshot per account per London day: the document id is
`<account_id>|<YYYY-MM-DD>`, so a re-run the same day overwrites rather than
duplicates. Every document carries `user_id`, so erase_user removes them.
"""
import logging
import re
from datetime import date, datetime, timedelta

from app.core.timeutil import user_today
from app.db.collections import (
    investment_accounts_col, investment_holdings_col, investment_notes_col,
    investment_valuations_col,
)
from app.services import investment_anchor as ia
from app.services.investment_prices import (
    best_match, get_instruments, holding_value, instrument_key, norm_name as _norm,
)

logger = logging.getLogger(__name__)

RANGE_DAYS = {"1m": 30, "3m": 91, "6m": 182, "1y": 365, "all": None}
METHOD = "simple"
METHOD_LABEL = "Simple gain, not a time-weighted return"


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
            "_cost_date": None, "_held": h.get("units") or None,
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
                "_cost_date": None, "_held": 0.0,
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
                if d is not None and (row["_cost_date"] is None or d < row["_cost_date"]):
                    row["_cost_date"] = d
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
        r["gain_abs"] = round(r["value"] - r["cost"], 2) if known else None
        r["gain_pct"] = round(r["gain_abs"] / r["cost"] * 100, 2) if known and r["cost"] > 0 else None
        # since the last statement (kept for older clients)
        r["change_abs"] = round(r["value"] - r["statement_value"], 2) if r["price_date"] and r["statement_value"] else None
        r["change_pct"] = (round(r["change_abs"] / r["statement_value"] * 100, 2)
                           if r["change_abs"] is not None and r["statement_value"] > 0 else None)
        # G278: every holding lists its units and price (None reads "no price yet")
        held = r["_held"]
        r["units"] = round(held, 4) if held is not None and held > 0 else None
        px = (insts.get(r["_key"]) or {}).get("price")
        r["price"] = px if px and r["units"] else None
    known_rows = [r for r in rows if r["cost"] is not None]
    value = round(sum(r["value"] for r in rows) + adj_value + fee_adj, 2)
    out = {"rows": rows, "value": value, "adj": round(adj_value, 2), "stmt_date": stmt_date, "fees_after": round(fee_adj, 2),
           "holdings_total": len(rows), "holdings_with_cost": len(known_rows)}
    if known_rows:
        paid_in = round(sum(r["cost"] for r in known_rows) + adj_value, 2)
        known_value = round(sum(r["value"] for r in known_rows) + adj_value, 2)
        gain = round(known_value - paid_in, 2)
        dates = [r["_cost_date"] for r in known_rows if r["_cost_date"]]
        out.update(paid_in=paid_in, growth_abs=gain, growth_pct=round(gain / paid_in * 100, 2) if paid_in > 0 else None,
                   since=min(dates).isoformat() if dates else None)
    else:
        out.update(paid_in=None, growth_abs=None, growth_pct=None, since=None)
    return out


def coverage_label(with_cost: int, total: int) -> str | None:
    """"over 2 of 3 holdings" when only some holdings have a known cost."""
    return f"over {with_cost} of {total} holdings" if 0 < with_cost < total else None


def _paid_in_at(rows: list[dict], adj: float, d: date) -> float:
    total = adj
    for r in rows:
        if r["cost"] is None:
            continue
        total += sum(a for cd, a in r["_contribs"] if cd is None or cd <= d)
    return round(total, 2)


def _price_lookup(inst: dict | None):
    hist = sorted(((p["price_date"], p["price"]) for p in (inst or {}).get("history") or [] if p.get("price") and p.get("price_date")))
    def at(d: date):
        iso = d.isoformat()
        best = None
        for pd_, pr in hist:
            if pd_ > iso:
                break
            best = pr
        return best
    return at, bool(hist)


def backfill_values(rows: list[dict], insts: dict, start: date, end: date) -> dict[str, float]:
    """Portfolio value per history date from the shared price history. Returns
    {} unless every row with units can be priced from history, so a half
    priced portfolio never draws a misleadingly low line."""
    lookups = []
    dates: set[str] = set()
    for r in rows:
        inst = insts.get(r["_key"])
        at, has = _price_lookup(inst)
        if r["_units"] and not has:
            return {}
        if r["_units"] or r["_parts"]:
            lookups.append((r, at, has))
        if has:
            dates.update(p["price_date"] for p in inst["history"] if start.isoformat() <= p["price_date"] <= end.isoformat())
    out: dict[str, float] = {}
    for iso in sorted(dates):
        d = date.fromisoformat(iso)
        # holdings with no units (cash, unpriced) stay at their statement value
        total = sum(r["statement_value"] for r in rows if not r["_units"])
        for r, at, has in lookups:
            px = at(d) if has else None
            if r["_units"]:
                if px is None:
                    break
                total += r["_units"] * px
            for nd, nu, amt in r["_parts"]:
                if nd is not None and nd > d:
                    continue
                n_units = _num(nu)
                total += round(n_units * px, 2) if n_units and px and amt > 0 else amt
        else:
            out[iso] = round(total, 2)
    return out


def build_series(snapshots: list[dict], pos: dict, insts: dict, range_key: str, today: date) -> list[dict]:
    """Chart points: stored daily snapshots, backfilled from shared price
    history where it covers the holdings, filled forward daily otherwise, and
    ending on the current value. paid_in is null when only some holdings have
    a known cost (a paid-in line over part of the value would mislead)."""
    rows = pos["rows"]
    by_date = {p["date"]: p["value"] for p in snapshots}
    cost_dates = [r["_cost_date"] for r in rows if r["_cost_date"]]
    # The chart starts where the user's holding starts: the statement date, or
    # an earlier note date; with neither, the first stored snapshot, else today.
    anchors = ([pos["stmt_date"]] if pos.get("stmt_date") else []) + cost_dates
    if anchors:
        start = min(anchors)
    else:
        start = date.fromisoformat(min(by_date)) if by_date else today
    for iso, v in backfill_values(rows, insts, start, today).items():
        by_date.setdefault(iso, v)
    by_date[today.isoformat()] = pos["value"]  # today is always the live figure
    complete = pos["holdings_total"] > 0 and pos["holdings_with_cost"] == pos["holdings_total"]
    pts, last = [], None
    cur = date.fromisoformat(min(by_date))
    while cur <= today:
        iso = cur.isoformat()
        last = by_date.get(iso, last)
        if last is not None:
            pts.append({"date": iso, "value": last,
                        "paid_in": _paid_in_at(rows, pos["adj"], cur) if complete else None})
        cur += timedelta(days=1)
    days = RANGE_DAYS[range_key]
    if days is not None:
        cutoff = (today - timedelta(days=days)).isoformat()
        pts = [p for p in pts if p["date"] >= cutoff]
    return pts


def build_growth(snapshots: list[dict], pos: dict, insts: dict, range_key: str, today: date) -> dict:
    """Pure: headline figures from cost versus value (not from snapshots),
    plus the chart series for one range."""
    points = build_series(snapshots, pos, insts, range_key, today)
    n, m = pos["holdings_with_cost"], pos["holdings_total"]
    return {
        "range": range_key, "method": METHOD, "method_label": METHOD_LABEL, "points": points,
        "since": pos["since"], "as_of": points[-1]["date"] if points else today.isoformat(),
        "value": pos["value"] if m else None, "paid_in": pos["paid_in"],
        "growth_abs": pos["growth_abs"], "growth_pct": pos["growth_pct"],
        "holdings_with_cost": n, "holdings_total": m, "cost_coverage": coverage_label(n, m),
    }


def public_rows(pos: dict) -> list[dict]:
    keys = ("id", "name", "isin", "type", "units", "price", "value", "statement_value", "cost", "cost_source",
            "gain_abs", "gain_pct", "change_abs", "change_pct", "price_date")
    out = [{k: r[k] for k in keys} for r in pos["rows"]]
    out.sort(key=lambda r: -(r["value"] or 0))
    return out


def since_statement(pos: dict, holdings: list[dict], notes: list[dict], fee_lines: list[dict]) -> dict | None:
    """Growth since the last statement: value now minus the statement's value
    minus money paid in since (contract notes dated after it, fees excluded,
    sales counted as money out). Needs a statement date and statement values."""
    sd = pos.get("stmt_date")
    if sd is None or not holdings:
        return None
    closing = round(sum((h.get("statement_value") or 0) for h in holdings), 2)
    paid = 0.0
    for n in notes:
        d = _as_date(n.get("trade_date"))
        if d is None or d <= sd or ia.is_fee_note(n, fee_lines):
            continue
        paid += n.get("amount") or 0.0
    paid = round(paid, 2)
    growth = round(pos["value"] - closing - paid, 2)
    return {"date": sd.isoformat(), "closing_value": closing, "paid_in": paid, "growth_abs": growth,
            "fees": round(-pos.get("fees_after", 0.0), 2)}


def build_purchases(periods: list[dict], notes: list[dict], rows: list[dict], insts: dict) -> list[dict]:
    """Every dated purchase with units and cost: statement 'Bought' lines and
    contract notes, de-duplicated on date and amount. Gain is units x today's
    price minus the amount, only when both units and a price are known."""
    fee_lines = ia.all_fee_lines(periods)
    seen: set = set()
    out: list[dict] = []

    def add(d, name, units, amount, source):
        key = (d.isoformat() if d else None, round(amount, 2))
        if key in seen:
            return
        seen.add(key)
        nk = _norm(name)
        idx = best_match(nk, [r["_nk"] for r in rows]) if nk else None
        inst = insts.get(rows[idx]["_key"]) if idx is not None else None
        if inst is None and name:
            inst = insts.get(instrument_key(None, None, name))
        price = (inst or {}).get("price")
        u = _num(units)
        value = round(u * price, 2) if u and price else None
        out.append({
            "date": d.isoformat() if d else None, "fund_name": name, "units": u, "amount": round(amount, 2),
            "price": price, "value": value,
            "gain_abs": round(value - amount, 2) if value is not None else None,
            "gain_pct": round((value - amount) / amount * 100, 2) if value is not None and amount > 0 else None,
            "source": source,
        })
    for n in notes:
        amt = _num(n.get("amount"))
        if amt is None or amt <= 0 or ia.is_fee_note(n, fee_lines):
            continue
        add(_as_date(n.get("trade_date")), n.get("fund_name"), n.get("units"), amt, "contract_note")
    for p in periods:
        for b in p.get("purchases") or []:
            add(_as_date(b.get("date")), b.get("fund_name"), b.get("units"), b["amount"], "statement")
    out.sort(key=lambda x: x["date"] or "", reverse=True)
    return out


def _fmt_day(d: str) -> str:
    dd = date.fromisoformat(d)
    return f"{dd.day} {dd.strftime('%b')}"


def _money(n: float) -> str:
    return f"£{n:,.2f}"


async def account_growth(acc: dict, range_key: str, today: date | None = None) -> dict:
    today = today or user_today()
    snaps = await investment_valuations_col.find({"account_id": acc["_id"]}).to_list(None)
    holdings = await investment_holdings_col.find({"account_id": acc["_id"]}).to_list(None)
    notes = await investment_notes_col.find({"account_id": acc["_id"]}).to_list(None)
    keys = [h.get("instrument_key") for h in holdings] + [instrument_key(None, None, n.get("fund_name")) for n in notes]
    insts = await get_instruments(keys)
    stmt = _as_date(acc.get("statement_date"))
    periods = acc.get("statement_periods") or []
    pos = build_positions(stmt, holdings, notes, insts, ia.all_fee_lines(periods))
    anchor = acc.get("anchor") or None
    anchor_d = _as_date(anchor.get("date")) if anchor else None
    growth = build_growth(snaps, pos, insts, range_key, today)

    # The anchor date's value on our side: today's figure, else the chart's.
    ours_on_anchor = None
    if anchor_d is not None:
        if anchor_d >= today:
            ours_on_anchor = pos["value"]
        else:
            full = growth["points"] if range_key == "all" else build_series(snaps, pos, insts, "all", today)
            ours_on_anchor = next((p["value"] for p in full if p["date"] == anchor_d.isoformat()), None)
    override = bool(anchor and anchor.get("use_provider_value") and anchor_d is not None)
    value_now = pos["value"]
    if override and anchor_d == today:
        value_now = anchor["provider_value"]  # display only, for that date only
    provider = acc.get("provider")
    lifetime = ia.build_lifetime(anchor, pos["value"] if growth["value"] is not None else None, notes, periods,
                                 today, provider, ours_on_anchor)
    if lifetime and override and anchor_d == today:
        lifetime = ia.build_lifetime(anchor, value_now, notes, periods, today, provider, ours_on_anchor)
    if lifetime and lifetime["reconciliation"]:
        rc = lifetime["reconciliation"]
        who = provider or "Your provider"
        rc["text"] = (f"Sorted shows {_money(rc['ours'])}, {who} showed {_money(rc['provider_value'])} "
                      f"on {_fmt_day(rc['date'])}, likely price timing.")
    if override and anchor_d is not None:
        for p in growth["points"]:
            if p["date"] == anchor_d.isoformat():
                p["value"] = anchor["provider_value"]
    # Header value (the Accounts row) counts later contract notes at cost; say so when it differs.
    header = round((acc.get("total_value") or 0.0) + ia_after_statement(notes, stmt), 2) if stmt else None
    # No pre-formatted pounds: the client builds the sentence so hide-balances can mask it.
    value_note_kind = None
    if header is not None and growth["value"] is not None and abs(header - value_now) >= 0.01:
        value_note_kind = "notes_at_cost"
    if growth["value"] is not None:
        growth["value"] = value_now
    periods_out = [g for g in (ia.period_growth(p) for p in sorted(periods, key=lambda p: p.get("closing_date") or "")) if g]
    return {
        "account_id": acc["_id"], "currency": acc.get("currency", "GBP"), "provider": provider,
        "statement_date": stmt.isoformat() if stmt else None,
        **growth,
        "value_source": "provider" if override and anchor_d == today else "sorted",
        "header_value": header, "value_note_kind": value_note_kind,
        "undated_payment_lines": _undated_lines(periods),
        "lifetime": lifetime, "anchor": ({k: v for k, v in anchor.items()} if anchor else None),
        "anchor_history": acc.get("anchor_history") or [],
        "since_statement": since_statement(pos, holdings, notes, ia.all_fee_lines(periods)),
        "statement_periods": periods_out,
        "periods_chain": ia.chain_periods(periods),
        "purchases": build_purchases(periods, notes, pos["rows"], insts),
        "holdings": public_rows(pos),
    }


def _undated_lines(periods: list[dict]) -> int:
    """Statement payment lines with no date: they cannot be placed against the
    anchor date, so they are not counted as contributions, and the count is surfaced."""
    n = sum(1 for p in periods for k in ("payments_in_lines", "withdrawal_lines")
            for ln in (p.get(k) or []) if _as_date(ln.get("date")) is None)
    if n:
        logger.debug("investment growth: %d undated statement payment line(s) not counted", n)
    return n


def ia_after_statement(notes: list[dict], stmt: date | None) -> float:
    """What the Accounts row adds to the statement total: every contract note dated after it, at cost."""
    return net_contributions(notes, stmt, date.max)
