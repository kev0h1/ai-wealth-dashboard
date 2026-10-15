"""Provider anchor, statement periods and fee classification (G278).

Pure helpers, no database. The anchor is the user's own copy of what the
provider shows on a date (value and return, or total paid in). It is the
PRIMARY lifetime figure: net paid in at the anchor is the provider's value
minus the provider's return (or the total paid in the user typed), and
everything after the anchor date is tracked forward from contract notes and
statements. The provider's personal rate of return is money-weighted, so it is
only ever shown as entered and dated, never recomputed.

Statement periods (SECONDARY) come from the statement parser and are never
estimated: a field the statement does not show stays None.
"""
import math
import re
from datetime import date, datetime

ANCHOR_SOURCE = "user"
FEE_SALE_MAX = 50.0  # a sale smaller than this that matches a statement fee line is a fee
FEE_DAY_WINDOW = 7
_FEE_WORDS = re.compile(r"\b(fees?|charges?)\b", re.I)


def as_date(v) -> date | None:
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


def _num(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) else None


# ── Anchor ────────────────────────────────────────────────────────────────

def check_anchor(body: dict, today: date) -> tuple[dict | None, str | None]:
    """Validate a user-entered anchor: (stored shape, None) or (None, a sentence
    fit to show the user). `entered_at` is stamped by the router."""
    d = as_date(body.get("date"))
    if d is None:
        return None, "Enter the date your provider showed these figures."
    if d > today:
        return None, "The anchor date cannot be in the future."
    if d < date(2000, 1, 1):
        return None, "That anchor date looks too old."
    value = _num(body.get("provider_value"))
    if value is None or value <= 0 or value > 1e9:
        return None, "Enter the account value your provider shows, as a number above zero."
    ret = _num(body.get("provider_return"))
    paid = _num(body.get("total_paid_in"))
    if body.get("provider_return") is not None and ret is None:
        return None, "The return must be a number."
    if body.get("total_paid_in") is not None and paid is None:
        return None, "Total paid in must be a number."
    if (ret is None) == (paid is None):
        return None, "Enter either the return or the total paid in, not both and not neither."
    if paid is not None and (paid < 0 or paid > 1e9):
        return None, "Total paid in cannot be negative."
    if ret is not None and abs(ret) > 1e9:
        return None, "That return looks wrong."
    net = round(paid, 2) if paid is not None else round(value - ret, 2)
    if net < 0:
        return None, "The return is larger than the value, so paid in would be negative. Check the figures."
    rate = None
    if body.get("provider_rate_of_return_pct") not in (None, ""):
        rate = _num(body.get("provider_rate_of_return_pct"))
        if rate is None or rate < -100 or rate > 10000:
            return None, "The rate of return should be a percentage such as 5.0."
        rate = round(rate, 2)
    return {
        "date": d.isoformat(), "provider_value": round(value, 2),
        "provider_return": round(ret, 2) if ret is not None else None,
        "total_paid_in": round(paid, 2) if paid is not None else None,
        "provider_rate_of_return_pct": rate, "source": ANCHOR_SOURCE,
        "use_provider_value": False,
    }, None


def validate_anchor(body: dict, today: date) -> dict:
    """check_anchor for callers that want an exception (tests, scripts)."""
    anchor, problem = check_anchor(body, today)
    if anchor is None:
        raise ValueError(problem)
    return anchor


def anchor_net_paid_in(anchor: dict) -> float | None:
    """Net paid in at the anchor date: the typed total paid in, else value minus return."""
    paid = _num(anchor.get("total_paid_in"))
    if paid is not None:
        return round(paid, 2)
    value, ret = _num(anchor.get("provider_value")), _num(anchor.get("provider_return"))
    if value is None or ret is None:
        return None
    return round(value - ret, 2)


def replace_anchor(current: dict | None, new_anchor: dict, history: list | None) -> tuple[dict, list]:
    """Re-anchoring replaces the anchor and keeps the previous one in history."""
    hist = list(history or [])
    if current:
        hist.append({**{k: v for k, v in current.items() if k != "use_provider_value"}, "replaced_at": new_anchor.get("entered_at")})
    return new_anchor, hist[-20:]


# ── Fees ──────────────────────────────────────────────────────────────────

def is_fee_note(n: dict, fee_lines: list[dict] | None = None) -> bool:
    """A fee-driven sale is a fee, not a purchase and not a withdrawal. It is a
    fee when the note says so (kind fee, or fee wording in its text), or it is
    a small sale matching a statement fee line (the provider sells a sliver of
    units to pay its fee). A purchase is never a fee."""
    amt = _num(n.get("amount"))
    if amt is None or amt >= 0:
        return False
    if str(n.get("kind") or "").lower() == "fee":
        return True
    text = " ".join(str(n.get(k) or "") for k in ("description", "reference", "fund_name", "narrative"))
    if _FEE_WORDS.search(text):
        return abs(amt) <= 500.0
    d = as_date(n.get("trade_date"))
    if d is None or abs(amt) > FEE_SALE_MAX:
        return False
    for f in fee_lines or []:
        fd, fa = as_date(f.get("date")), _num(f.get("amount"))
        if fd is None or fa is None:
            continue
        if abs((fd - d).days) <= FEE_DAY_WINDOW and abs(amt) <= abs(fa) + 0.01:
            return True
    return False


def all_fee_lines(periods: list[dict]) -> list[dict]:
    return [f for p in periods or [] for f in (p.get("fee_lines") or [])]


# ── Statement periods ─────────────────────────────────────────────────────

def _lines(v) -> list[dict]:
    out = []
    for x in v if isinstance(v, list) else []:
        if not isinstance(x, dict):
            continue
        a = _num(x.get("amount"))
        if a is None:
            continue
        d = as_date(x.get("date"))
        out.append({"date": d.isoformat() if d else None, "amount": round(abs(a), 2)})
    return out


def clean_period(parsed: dict, closing_value: float | None, closing_date: date | None) -> dict | None:
    """The stored statement period from the parser's `period` object. Returns
    None when there is no closing date. Nothing is estimated: a missing
    opening value or date stays None and the period reports no growth."""
    if closing_date is None:
        return None
    raw = parsed.get("period") if isinstance(parsed.get("period"), dict) else {}
    opening = _num(raw.get("opening_value"))
    opening_date = as_date(raw.get("start_date") or raw.get("opening_date"))
    pay_in, pay_out = _lines(raw.get("payments_in")), _lines(raw.get("withdrawals"))
    fees, interest = _lines(raw.get("fees")), _lines(raw.get("interest"))
    purchases = []
    for p in raw.get("purchases") if isinstance(raw.get("purchases"), list) else []:
        if not isinstance(p, dict):
            continue
        amt, units, d = _num(p.get("amount")), _num(p.get("units")), as_date(p.get("date"))
        name = str(p.get("fund_name") or "").strip()
        if amt is None or not name or d is None:
            continue
        purchases.append({"date": d.isoformat(), "fund_name": name, "units": units if units and units > 0 else None,
                          "amount": round(abs(amt), 2)})
    return {
        "opening_value": round(opening, 2) if opening is not None else None,
        "opening_date": opening_date.isoformat() if opening_date else None,
        "closing_value": round(closing_value, 2) if closing_value is not None else None,
        "closing_date": closing_date.isoformat(),
        "payments_in": round(sum(x["amount"] for x in pay_in), 2), "payments_in_lines": pay_in,
        "payments_in_shown": bool(pay_in),
        "withdrawals": round(sum(x["amount"] for x in pay_out), 2), "withdrawal_lines": pay_out,
        "fees": round(sum(x["amount"] for x in fees), 2), "fee_lines": fees,
        "interest": round(sum(x["amount"] for x in interest), 2),
        "purchases": purchases,
    }


def upsert_period(periods: list[dict] | None, period: dict) -> list[dict]:
    """Idempotent: one period per closing date, newest data wins."""
    out = [p for p in (periods or []) if p.get("closing_date") != period.get("closing_date")]
    out.append(period)
    out.sort(key=lambda p: p.get("closing_date") or "")
    return out[-60:]


def period_growth(p: dict) -> dict | None:
    """closing - opening - payments in + withdrawals. Fees and interest are
    already part of it and are returned as their own lines. None when the
    statement did not show an opening or closing value."""
    o, c = _num(p.get("opening_value")), _num(p.get("closing_value"))
    if o is None or c is None:
        return None
    pin, pout = p.get("payments_in") or 0.0, p.get("withdrawals") or 0.0
    growth = round(c - o - pin + pout, 2)
    fees, interest = p.get("fees") or 0.0, p.get("interest") or 0.0
    return {
        "from": p.get("opening_date"), "to": p.get("closing_date"),
        "opening_value": o, "closing_value": c, "payments_in": pin, "withdrawals": pout,
        "growth_abs": growth, "growth_pct": round(growth / o * 100, 2) if o > 0 else None,
        "fees": fees, "interest": interest,
        "before_fees_and_interest": round(growth + fees - interest, 2),
    }


def chain_periods(periods: list[dict]) -> dict | None:
    """Growth since the earliest statement in the unbroken run of periods that
    ends at the latest one. A period joins the run when it opens within five
    days of the previous close. Returns None with no usable period."""
    rows = [(p, period_growth(p)) for p in sorted(periods or [], key=lambda p: p.get("closing_date") or "")]
    rows = [(p, g) for p, g in rows if g is not None]
    if not rows:
        return None
    run = [rows[-1]]
    for p, g in reversed(rows[:-1]):
        nxt = run[0][0]
        od, cd = as_date(nxt.get("opening_date")), as_date(p.get("closing_date"))
        if od is None or cd is None or abs((od - cd).days) > 5:
            break
        run.insert(0, (p, g))
    total = round(sum(g["growth_abs"] for _, g in run), 2)
    return {
        "from": run[0][1]["from"], "to": run[-1][1]["to"], "periods": len(run), "growth_abs": total,
        "fees": round(sum(g["fees"] for _, g in run), 2), "interest": round(sum(g["interest"] for _, g in run), 2),
        "payments_in": round(sum(g["payments_in"] for _, g in run), 2),
    }


# ── Lifetime from the anchor ──────────────────────────────────────────────

def contributions_after(anchor_date: date, notes: list[dict], periods: list[dict], today: date) -> dict:
    """Money paid in and taken out after the anchor date, no double counting.
    Dates up to the latest statement that shows payments in come from that
    statement's lines; later dates come from contract notes (purchases in,
    non-fee sales out). A fee is neither."""
    fee_lines = all_fee_lines(periods)
    covered = None
    paid_in = out = 0.0
    for p in sorted(periods or [], key=lambda p: p.get("closing_date") or ""):
        cd = as_date(p.get("closing_date"))
        if cd is None or cd <= anchor_date or not p.get("payments_in_shown"):
            continue
        covered = cd
        for ln in p.get("payments_in_lines") or []:
            d = as_date(ln.get("date"))
            if d is not None and anchor_date < d <= cd:
                paid_in += ln["amount"]
        for ln in p.get("withdrawal_lines") or []:
            d = as_date(ln.get("date"))
            if d is not None and anchor_date < d <= cd:
                out += ln["amount"]
    for n in notes:
        d, amt = as_date(n.get("trade_date")), _num(n.get("amount"))
        if d is None or amt is None or d <= anchor_date or d > today or (covered is not None and d <= covered):
            continue
        if is_fee_note(n, fee_lines):
            continue
        if amt > 0:
            paid_in += amt
        else:
            out += -amt
    return {"paid_in": round(paid_in, 2), "withdrawn": round(out, 2)}


def build_lifetime(anchor: dict | None, value: float | None, notes: list[dict], periods: list[dict],
                   today: date, provider: str | None, value_on_anchor_date: float | None) -> dict | None:
    """The PRIMARY lifetime figure, or None without an anchor."""
    if not anchor or value is None:
        return None
    net = anchor_net_paid_in(anchor)
    ad = as_date(anchor.get("date"))
    if net is None or ad is None:
        return None
    after = contributions_after(ad, notes, periods, today)
    paid_in = round(net + after["paid_in"] - after["withdrawn"], 2)
    gain = round(value - paid_in, 2)
    name = provider or "your provider"
    out = {
        "anchor": {k: anchor.get(k) for k in ("date", "provider_value", "provider_return", "total_paid_in",
                                               "provider_rate_of_return_pct", "source", "entered_at", "use_provider_value")},
        "provider": name, "net_paid_in_at_anchor": net, "paid_in_after": after["paid_in"], "withdrawn_after": after["withdrawn"],
        "paid_in": paid_in, "growth_abs": gain, "growth_pct": round(gain / paid_in * 100, 2) if paid_in > 0 else None,
        "since": anchor.get("date"),
        "rate_of_return": None, "reconciliation": None,
    }
    if anchor.get("provider_rate_of_return_pct") is not None:
        pct = anchor["provider_rate_of_return_pct"]
        out["rate_of_return"] = {"pct": pct, "as_of": anchor.get("date"), "label": f"from {name}",
                                 "note": "Money-weighted, as shown by your provider. Sorted does not recompute it."}
    pv = anchor["provider_value"]
    if value_on_anchor_date is not None and abs(value_on_anchor_date - pv) >= 0.01:
        out["reconciliation"] = {
            "date": anchor.get("date"), "ours": round(value_on_anchor_date, 2), "provider_value": pv,
            "difference": round(value_on_anchor_date - pv, 2), "override": bool(anchor.get("use_provider_value")),
        }
    return out
