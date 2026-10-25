"""Statement periods and fee classification (G278).

Pure helpers, no database. G338: the provider anchor flow was removed (any
stored anchor data is left untouched and is no longer read or shown).

Statement periods come from the statement parser and are never estimated: a
field the statement does not show stays None.
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
