"""G412: one optional, dated card-payment estimate, shared by every money view.

No dates means no change at all to learned repayments or the Home fallback.
A statement balance is a position, not a payment instruction. Only a known
in-full/fixed instruction with a usable payer can replace a learned debit.
Minimum/manual methods continue to need actual repayment evidence.
"""
from __future__ import annotations

import calendar
import math
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from app.core import timeutil
from app.services.account_kinds import is_credit_card_account, is_current_account, is_debt_account, is_savings_account

PAYMENT_FIELDS = (
    "statement_close_day", "payment_due_day", "payment_due_days_after_close",
    "payment_method", "payment_account_id", "fixed_payment_amount",
)


def _money(value) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _finite(value) -> bool:
    try:
        return value is not None and math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return timeutil.to_user_date(value)
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _month_day(anchor: date, delta: int, day: int) -> date:
    month = anchor.year * 12 + anchor.month - 1 + delta
    year, month = divmod(month, 12)
    month += 1
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def has_statement_dates(terms: dict) -> bool:
    close, due, offset = (terms.get(k) for k in PAYMENT_FIELDS[:3])
    whole = lambda v, maximum: type(v) is int and 1 <= v <= maximum
    return whole(close, 31) and (
        (whole(due, 31) and offset is None) or (whole(offset, 366) and due is None)
    )


def due_for_close(close: date, terms: dict) -> date:
    offset = terms.get("payment_due_days_after_close")
    if offset is not None:
        return close + timedelta(days=offset)
    due = _month_day(close, 0, terms["payment_due_day"])
    return due if due > close else _month_day(close, 1, terms["payment_due_day"])


def statement_dates(today: date, terms: dict) -> tuple[date, date, date, date]:
    """Closing day completes at the end of the London day, never mid-day.

    Day 29/30/31 clamps independently in each month; the inclusive statement
    starts the day after the previous (also clamped) close. Due ON payday is
    deliberately not a debit in the current window, per pay_period.
    """
    close = _month_day(today, 0, terms["statement_close_day"])
    if close >= today:
        close = _month_day(today, -1, terms["statement_close_day"])
    previous = _month_day(close, -1, terms["statement_close_day"])
    next_close = _month_day(close, 1, terms["statement_close_day"])
    return previous + timedelta(days=1), close, due_for_close(close, terms), due_for_close(next_close, terms)


def usable_payer(account: dict | None) -> bool:
    return bool(
        account and not is_credit_card_account(account) and not is_debt_account(account)
        and is_current_account(account) and not is_savings_account(account)
        and str(account.get("currency") or "GBP").upper() == "GBP"
        and account.get("include_in_safe_to_spend") is not False
        and _finite(account.get("balance"))
    )


def estimate_statement(
    card: dict, terms: dict, rows: list[dict], accounts: dict[str, dict],
    today: date, *, next_payday: date | None = None, pairs: list[tuple] | None = None,
) -> dict | None:
    """Estimate a CLOSED statement; never sum current purchases as its bill.

    Reverse booked movements since close out of the live signed card balance.
    This retains opening carried debt, fees and interest, unlike summing just
    this statement's purchases. Coverage before the statement start is a
    conservative history floor, not a claim of a bank-verified statement.
    After-close refunds restore the closed balance but do NOT automatically
    cancel its DD. Only the shared reconciler's unique, verified repayment
    pair releases a payment. Pending card data cannot establish a balance.
    """
    if not has_statement_dates(terms):
        return None
    aid = str(card["_id"])
    start, close, due, next_due = statement_dates(today, terms)
    source_id = str(terms.get("payment_account_id") or "")
    source = accounts.get(source_id)
    method = terms.get("payment_method")
    card_rows = [r for r in rows if str(r.get("account_id")) == aid and (_day(r.get("date")) or date.max) <= today]
    booked = [r for r in card_rows if not r.get("is_pending") and r.get("transaction_type") in ("credit", "debit") and _finite(r.get("amount"))]
    after = [r for r in booked if _day(r["date"]) > close]
    after_debits = sum(abs(float(r["amount"])) for r in after if r["transaction_type"] == "debit")
    after_credits = sum(abs(float(r["amount"])) for r in after if r["transaction_type"] == "credit")
    result = {
        "statement_start": start.isoformat(), "statement_close": close.isoformat(),
        "payment_due": due.isoformat(), "next_payment_due": next_due.isoformat(),
        "payment_method": method, "payment_account_id": source_id or None,
        "estimated_bill": None, "payment_amount": None, "payment_remaining": None,
        "paid_since_close": 0.0, "spending_since_close": _money(after_debits),
        "estimated": True, "status": "incomplete_history", "reason": None,
        "next_payday": next_payday.isoformat() if next_payday else None,
        "due_before_payday": due < next_payday if next_payday else None,
    }
    if str(card.get("currency") or "GBP").upper() != "GBP":
        result.update(status="source_unavailable", reason="A payment estimate is not available for this card currency.")
        return result
    earliest = min((_day(r["date"]) for r in booked), default=None)
    next_close = _month_day(close, 1, terms["statement_close_day"])
    enough_history = (_finite(card.get("balance")) and earliest is not None and earliest <= start
                      and not any(r.get("is_pending") for r in card_rows))
    if enough_history:
        result["estimated_bill"] = _money(max(0.0, -float(card["balance"]) - after_debits + after_credits))
    else:
        result["reason"] = "There is not enough settled card history to estimate this statement yet."
    # A fixed cash instruction is known independently of the statement
    # balance. For in-full DD, overlapping cycles make the payable statement
    # ambiguous, so retain learned evidence instead of inventing a total.
    if due >= next_close and method == "full":
        result["reason"] = "This due rule overlaps statement periods. Check the bill on your card statement."
        return result
    if pairs is None:
        from app.services.own_account_transfers import select_unique_pairs
        pairs = select_unique_pairs(rows, accounts, [], set())
    # Credit belongs to this card; its matching cash debit must be from the
    # chosen payer. Never recognise a merchant refund or a balance transfer
    # as proof that a current-account payment already left the balance.
    payment_floor = close + timedelta(days=1)
    if due >= next_close:
        # Overlapping fixed-payment periods can otherwise allocate the old
        # cycle's late debit to the next one. Outside the normal observation
        # window, keep the known instruction rather than claiming it paid.
        payment_floor = max(payment_floor, due - timedelta(days=14))
    paid = sum(abs(float(c["amount"])) for c, d in pairs
               if str(c.get("account_id")) == aid and str(d.get("account_id")) == source_id
               and close < (_day(c.get("date")) or date.min) <= today
               and payment_floor <= (_day(d.get("date")) or date.min)
               and (_day(d.get("date")) or date.max) <= today
               and not c.get("is_pending") and not d.get("is_pending"))
    result["paid_since_close"] = _money(paid)
    if not usable_payer(source):
        result.update(status="source_unavailable", reason="The paying account is not available in the cash estimate.")
        return result
    if method == "full":
        if not enough_history:
            return result
        amount = result["estimated_bill"]
    elif method == "fixed" and _finite(terms.get("fixed_payment_amount")) and float(terms["fixed_payment_amount"]) > 0:
        amount = _money(terms["fixed_payment_amount"])
    else:
        result.update(status="payment_unverified", reason=(
            "The minimum needs to be checked on your card statement. Existing repayment evidence is used."
            if method == "minimum" else "Manual payments are counted only when there is repayment evidence."
        ))
        return result
    # A direct debit the pair reconciler missed still shows as a credit on the
    # card. A card-side credit after the close that covers what is left is the
    # payment in practice; smaller unmatched credits (refunds) never reduce it.
    paired = {id(c) for c, _ in pairs}
    unmatched = sum(abs(float(r["amount"])) for r in after
                    if r["transaction_type"] == "credit" and id(r) not in paired)
    if amount > 0 and paid < amount and unmatched >= amount - paid:
        paid = amount
        result["paid_since_close"] = _money(paid)
    remaining = _money(max(0.0, amount - paid))
    result.update(payment_amount=amount, payment_remaining=remaining,
                  status="paid" if remaining == 0 else "estimated")
    return result


async def load_statement_bills(uid: str, *, cards=None, terms=None, today=None) -> dict[str, dict]:
    """One version/day-pinned read model; shared by details and all forecasts.

    Legacy users with no complete statement rule incur no transaction scan.
    Everything is scoped to uid, including the source debit used as payment
    evidence. No account type or business label implies who pays a card.
    """
    from app.db.collections import accounts_col, card_terms_col, preferences_col, transactions_col, pending_transactions_col
    from app.services import response_cache
    from app.services.income import get_confirmed_payday
    from app.services.pay_period import _next_payday
    from app.services.own_account_transfers import select_unique_pairs

    today = today or timeutil.user_today()
    if terms is None:
        terms = {d.get("account_id"): d async for d in card_terms_col.find({"user_id": uid})}
    configured = {str(aid): t for aid, t in terms.items() if has_statement_dates(t)}
    if not configured:
        return {}
    cached = await response_cache.aget("card_statement_bills", uid)
    if cached is not None:
        return cached
    version = await response_cache.snapshot(uid)
    account_rows = await accounts_col.find({"user_id": uid}).to_list(None)
    accounts = {str(a["_id"]): a for a in account_rows}
    cards = cards if cards is not None else [a for a in account_rows if is_credit_card_account(a)]
    # Last closed statement starts at most 62 days ago. A 100-day scan gives
    # an older-history guard without fetching the user's entire ledger.
    cutoff = datetime.combine(today - timedelta(days=100), time.min, tzinfo=timezone.utc)
    query = {"user_id": uid, "account_id": {"$in": list(accounts)}, "date": {"$gte": cutoff}}
    rows = await transactions_col.find(query).to_list(None)
    pending = await pending_transactions_col.find(query).to_list(None)
    # Payment evidence uses the established deterministic issuer/tail/pair
    # reconciler; it does not write or make an LLM call.
    pairs = select_unique_pairs(rows, accounts, [], set())
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    confirmed = get_confirmed_payday(prefs, today)
    payday = confirmed[0] if confirmed else _next_payday(today, prefs.get("pay_period_config") or {"type": "calendar_month"})
    result = {}
    for card in cards:
        aid = str(card["_id"])
        if aid not in configured or aid not in accounts:
            continue
        bill = estimate_statement(card, configured[aid], [*rows, *pending], accounts, today, next_payday=payday, pairs=pairs)
        if bill:
            result[aid] = bill
    await response_cache.aput("card_statement_bills", uid, result, version=version)
    return result


def apply_statement_bills(
    raw_bills: list[dict], statements: dict[str, dict], accounts: dict[str, dict],
    today: date, window_end: date, *, observed_pending: list[dict] = (),
) -> tuple[list[dict], set[str]]:
    """Replace one card's learned repayments, never another card's bill.

    Dated rules dominate only when amount/source are actually known. A rule
    beyond the window still replaces its stale learned projection but emits
    no debit here. No forecast is invented for an unclosed next statement.
    """
    resolved = {aid for aid, bill in statements.items() if bill.get("status") in ("estimated", "paid")}
    kept = []
    for original in raw_bills:
        aid = str(original.get("card_dest_account_id") or "")
        if aid not in resolved or original.get("planned"):
            kept.append(original)
            continue
        # An unclosed NEXT statement has no exact bill yet. Preserve its
        # existing learned estimate, re-anchored to the user's due rule,
        # rather than reusing the last closed balance or silently dropping
        # next period's payment from the payday plan.
        next_due = date.fromisoformat(statements[aid]["next_payment_due"])
        original_day = _day(original.get("expected_date"))
        if original_day and original_day > date.fromisoformat(statements[aid]["payment_due"]) + timedelta(days=14):
            if next_due <= window_end and not any(b.get("card_dest_account_id") == aid for b in kept):
                payer_id = statements[aid]["payment_account_id"]
                payer = accounts[payer_id]
                kept.append({**original, "expected_date": next_due.isoformat(),
                             "days_away": (next_due - today).days,
                             "account_id": payer_id, "account_balance": float(payer["balance"]),
                             "account_name": payer.get("nickname") or payer.get("name"),
                             "account_bank": payer.get("provider"), "amount_basis": "balance_estimate"})
    for aid in sorted(resolved):
        bill = statements[aid]
        due = date.fromisoformat(bill["payment_due"])
        remaining = bill["payment_remaining"]
        if remaining is None or remaining <= 0 or due > window_end:
            continue
        payer_id = bill["payment_account_id"]
        payer, card = accounts[payer_id], accounts[aid]
        # A matched, bank-pending repayment is already in cash balances. It
        # stays display-only, exactly like the existing learned occurrence.
        if any(str(p.get("card_dest_account_id") or "") == aid
               and str(p.get("account_id") or "") == payer_id
               and _finite(p.get("amount")) and _money(p["amount"]) >= remaining for p in observed_pending):
            continue
        from app.services.account_names import display_account_name
        display_day = max(due, today)
        kept.append({
            "name": f"card-statement:{aid}:{bill['statement_close']}",
            "display_name": f"{display_account_name(card.get('nickname') or card.get('name') or 'Card')} payment",
            "amount": remaining, "expected_date": display_day.isoformat(),
            "days_away": (display_day - today).days, "account_id": payer_id,
            "account_name": display_account_name(payer.get("nickname") or payer.get("name") or "Account"),
            "account_bank": payer.get("provider"), "account_balance": float(payer["balance"]),
            "is_credit_card": False, "category": "Debt", "kind": "movement",
            "is_card_repayment": True, "card_dest_account_id": aid,
            "card_dest_account_name": display_account_name(card.get("nickname") or card.get("name") or "Card"),
            "card_dest_account_bank": card.get("provider"),
            "amount_basis": "statement_estimate" if bill["payment_method"] == "full" else "fixed_payment",
            "statement_close": bill["statement_close"], "statement_start": bill["statement_start"],
            "edited": False, "rule_label": None, "pending": due <= today,
            "days_past_due": max(0, (today - due).days),
            "original_date": due.isoformat() if due != display_day else None,
            "dest_account_id": None, "dest_account_spendable": None,
        })
    return kept, resolved
