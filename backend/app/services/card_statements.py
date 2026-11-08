"""G412: one optional, dated card-payment estimate, shared by every money view.

No dates means no change at all to learned repayments or the Home fallback.
A statement balance is a position, not a payment instruction. Only a known
in-full/fixed instruction with a usable payer can replace a learned debit.
Minimum/manual methods continue to need actual repayment evidence.
"""
from __future__ import annotations

from app.services.counted_accounts import is_counted
import calendar
import re
import math
import hashlib
import hmac
import secrets
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from app.core import timeutil
from app.services.account_kinds import is_credit_card_account, is_current_account, is_debt_account, is_savings_account

PAYMENT_FIELDS = (
    "statement_close_day", "payment_due_day", "payment_due_days_after_close",
    "payment_method", "payment_account_id", "fixed_payment_amount",
)
# G413: the optional rule that says which of the paying account's payments is
# this card's bill. Kept out of PAYMENT_FIELDS: those six describe the dated
# instruction, this one only links it to a payment in the ledger.
MATCH_FIELD = "payment_match"
# G441: the person's own figure for ONE statement, {"close_date": "YYYY-MM-DD",
# "amount": 123.45}. It applies only to the statement that closes on that date,
# so it expires by itself once the next close passes. Not one of the payment
# fields: it is never part of the dated instruction.
OVERRIDE_FIELD = "statement_amount_override"
OVERRIDE_MAX = 100000.0


def valid_statement_override(raw, close: date) -> float | None:
    """The overridden amount when it is well formed and belongs to this close."""
    if not isinstance(raw, dict) or raw.get("close_date") != close.isoformat():
        return None
    amount = raw.get("amount")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or not _finite(amount) or not 0 < float(amount) <= OVERRIDE_MAX:
        return None
    return _money(amount)


def _squash(text) -> str:
    """Lowercase letters and digits only, so spacing and hyphens never matter."""
    return "".join(ch for ch in str(text or "").lower() if ch.isalnum())


_LONG_DIGITS = re.compile(r"(?<!\d)\d(?:[- ]?\d){11,}(?!\d)")


def mask_long_digits(text) -> str:
    """Privacy: a run of 12 or more digits (a card number, hyphens and spaces
    allowed) keeps only its last five, as "…20001". Applied to any stored or
    shown rule label."""
    return _LONG_DIGITS.sub(lambda m: "…" + re.sub(r"\D", "", m.group(0))[-5:], str(text or ""))


def _exact_fingerprint(text: str, salt: str) -> str:
    # Whole description, ignoring capitals and whitespace noise only. Unlike
    # contains, punctuation is meaningful. A random salt prevents cross-rule
    # correlation; full card references are not copied into the terms record.
    canonical = " ".join(str(text or "").split()).casefold()
    return hashlib.sha256(f"card-payment-exact-v1:{salt}:{canonical}".encode()).hexdigest()


def normalise_match_rule(rule) -> dict | None:
    """The stored shape of a match rule, or None when absent or unusable.

    {"kind": "contains", "text": "20001"} matches any payment from the paying
    account whose narrative contains that text. {"kind": "payment",
    "series_key": "...", "label": "..."} matches the recurring series of one
    payment the user picked from that account. Never raises."""
    if not isinstance(rule, dict):
        return None
    kind = rule.get("kind")
    if kind == "contains":
        text = " ".join(str(rule.get("text") or "").split())
        return {"kind": "contains", "text": text} if len(_squash(text)) >= 3 and len(text) <= 240 else None
    if kind == "exact":
        text = " ".join(str(rule.get("text") or "").split())
        if not 3 <= len(_squash(text)) or len(text) > 240:
            return None
        fingerprint, salt = rule.get("fingerprint"), rule.get("salt")
        if fingerprint is not None or salt is not None:
            if not isinstance(fingerprint, str) or not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
                return None
            if not isinstance(salt, str) or not re.fullmatch(r"[a-f0-9]{32}", salt):
                return None
        else:
            # A masked label is not the original description. It must retain
            # its prepared identity or be chosen again from real history.
            if "…" in text:
                return None
            salt = secrets.token_hex(16)
            fingerprint = _exact_fingerprint(text, salt)
        return {"kind": "exact", "text": mask_long_digits(text), "fingerprint": fingerprint, "salt": salt}
    if kind == "payment":
        key = " ".join(str(rule.get("series_key") or "").split())[:80]
        if not key:
            return None
        out = {"kind": "payment", "series_key": key}
        label = mask_long_digits(" ".join(str(rule.get("label") or "").split()))[:80]
        if label:
            out["label"] = label
        return out
    return None


def _narrative(row: dict) -> str:
    return f"{row.get('merchant_name') or ''} {row.get('description') or ''}".strip()


def row_matches_rule(row: dict, rule: dict | None) -> bool:
    """Does one ledger row satisfy the rule? Pure; the caller scopes the row to
    the paying account and to debits."""
    rule = normalise_match_rule(rule)
    if rule is None:
        return False
    if rule["kind"] == "contains":
        return _squash(rule["text"]) in _squash(_narrative(row))
    if rule["kind"] == "exact":
        description = row.get("description") or row.get("merchant_name") or ""
        return hmac.compare_digest(rule["fingerprint"], _exact_fingerprint(description, rule["salt"]))
    from app.services.own_account_transfers import series_key_forms
    return rule["series_key"] in series_key_forms(row)


def _money(value) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _finite(value) -> bool:
    try:
        return value is not None and not isinstance(value, bool) and math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


UNSETTLED_STATUSES = frozenset(("pending", "cancelled", "canceled", "reversed", "failed", "declined", "rejected"))


def is_settled_row(row: dict) -> bool:
    """Shared booked-ledger test; zero can establish history, never payment."""
    return (not row.get("is_pending")
            and str(row.get("status") or "").strip().lower() not in UNSETTLED_STATUSES
            and _finite(row.get("amount")))


def is_settled_payment(row: dict) -> bool:
    """Repayment evidence must be non-zero and denominated in GBP."""
    return (is_settled_row(row) and abs(float(row["amount"])) > 0
            and str(row.get("currency") or "GBP").upper() == "GBP")


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
        and is_counted(account)
        and _finite(account.get("balance"))
    )


def estimate_statement(
    card: dict, terms: dict, rows: list[dict], accounts: dict[str, dict],
    today: date, *, next_payday: date | None = None, pairs: list[tuple] | None = None,
    series_cards: dict[str, str] | None = None,
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
    booked = [r for r in card_rows if is_settled_row(r) and r.get("transaction_type") in ("credit", "debit") and str(r.get("currency") or card.get("currency") or "GBP").upper() == str(card.get("currency") or "GBP").upper()]
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
    rule = normalise_match_rule(terms.get(MATCH_FIELD))
    rule_hits: list[dict] = []
    if rule is not None and source_id:
        payer_debits = [r for r in rows if str(r.get("account_id")) == source_id
                        and r.get("transaction_type") == "debit" and is_settled_payment(r)
                        and (_day(r.get("date")) or date.max) <= today]
        matching = [r for r in payer_debits if row_matches_rule(r, rule)]
        keys = {rule["series_key"]} if rule["kind"] == "payment" else set()
        from app.services.own_account_transfers import series_key_forms, series_key as _series_key
        ambiguous = False
        if rule["kind"] in ("contains", "exact"):
            # Distinct series the text names. More than one is ambiguous: claim
            # only a series no other card owns, and if that is still not one
            # series, claim nothing (a wrong claim would hide another card's bill).
            by_series: dict[str, set[str]] = {}
            for r in matching:
                by_series.setdefault(_series_key(r), set()).update(series_key_forms(r))
            if len(by_series) > 1:
                owned = series_cards or {}
                narrowed = {k: f for k, f in by_series.items() if (owned.get(k) or "") in ("", aid)}
                by_series = narrowed if len(narrowed) == 1 else {}
                ambiguous = not by_series
                matching = [r for r in matching if _series_key(r) in by_series]
            for forms in by_series.values():
                keys.update(forms)
        else:
            for r in matching:
                keys.update(series_key_forms(r))
        result["rule_series_keys"] = sorted(k for k in keys if k)
        # Two statements back: the quiet "nothing matched" line needs enough
        # payer history to say so honestly, otherwise the answer is unknown.
        lookback = _month_day(close, -2, terms["statement_close_day"])
        payer_start = min((_day(r["date"]) for r in payer_debits if _day(r.get("date"))), default=None)
        if ambiguous:
            result["rule_status"] = "unmatched"
        elif any((_day(r["date"]) or date.min) >= lookback for r in matching):
            result["rule_status"] = "matched"
        elif payer_start is not None and payer_start <= lookback:
            result["rule_status"] = "unmatched"
        else:
            result["rule_status"] = "unknown"
        rule_hits = [r for r in matching if (_day(r["date"]) or date.min) > close]
    if str(card.get("currency") or "GBP").upper() != "GBP":
        result.update(status="source_unavailable", reason="A payment estimate is not available for this card currency.")
        return result
    next_close = _month_day(close, 1, terms["statement_close_day"])
    # G441: the live signed balance with the movements since the close backed
    # out needs only the card's current balance and its transactions since the
    # close. It does not need the whole previous statement window (a rebuilt or
    # reconnected card may not have it), so history before the close is no
    # longer asked for. What can still make the answer unreliable is a pending
    # item dated on or before the close, which may yet post into the closed
    # statement; later pending items are outside the closed bill.
    pending_in_statement = any(
        (r.get("is_pending") or str(r.get("status") or "").strip().lower() == "pending")
        and (_day(r.get("date")) or date.max) <= close
        for r in card_rows)
    enough_history = _finite(card.get("balance")) and not pending_in_statement
    entered = valid_statement_override(terms.get(OVERRIDE_FIELD), close) if method == "full" else None
    if entered is not None:
        # G441: the person's own figure for this statement wins over any estimate.
        enough_history = True
        result["estimated_bill"] = entered
        result["user_entered"] = True
        result["reason"] = None
    elif enough_history:
        result["estimated_bill"] = _money(max(0.0, -float(card["balance"]) - after_debits + after_credits))
    elif not _finite(card.get("balance")):
        result["reason"] = "This card has no balance from your bank yet, so the statement cannot be estimated."
    else:
        result["reason"] = "A card payment from the statement period is still pending, so the statement cannot be estimated yet."
    # A fixed cash instruction is known independently of the statement
    # balance. For in-full DD, overlapping cycles make the payable statement
    # ambiguous, so retain learned evidence instead of inventing a total.
    if due >= next_close and method == "full":
        result["reason"] = "This due rule overlaps statement periods. Check the bill on your card statement."
        return result
    if pairs is None:
        from app.services.own_account_transfers import select_unique_pairs
        pairs = select_unique_pairs([r for r in rows if is_settled_payment(r)], accounts, [], set())
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
               and c.get("transaction_type") == "credit" and d.get("transaction_type") == "debit"
               and is_settled_payment(c) and is_settled_payment(d))
    result["paid_since_close"] = _money(paid)
    if not usable_payer(source):
        result.update(status="source_unavailable", reason="The paying account is not available in the cash estimate.")
        return result
    if method == "full":
        if not enough_history:
            # G441 (G413): a defined bill whose rule names a real payment still
            # replaces the learned series. The payment that already arrived
            # settles it; otherwise the amount is unknown and the learned
            # amount stands in provisionally (see apply_statement_bills).
            if result.get("rule_series_keys"):
                landed = [r for r in rule_hits if payment_floor <= (_day(r["date"]) or date.min)]
                if landed:
                    latest = max(landed, key=lambda r: _day(r["date"]) or date.min)
                    value = _money(abs(float(latest["amount"])))
                    result.update(payment_amount=value, payment_remaining=0.0, paid_since_close=value,
                                  status="paid", reason=None)
                else:
                    result.update(status="amount_unknown", reason=(
                        "Amount not known yet. Your usual payment from past months is used until this statement can be read."))
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
    # card. Only ONE unmatched post-close credit, dated within 14 days of the
    # due date and at least what is left (within 2 pounds of the arranged
    # amount for a fixed payment), is treated as the payment. Credits are
    # never summed, so refunds stay conservative. Minimum and manual methods
    # never reach here: they stay on repayment evidence.
    paired = {id(c) for c, _ in pairs}
    left = amount - paid
    if amount > 0 and left > 0:
        for r in after:
            if r["transaction_type"] != "credit" or id(r) in paired or not is_settled_payment(r):
                continue
            value, when = abs(float(r["amount"])), _day(r["date"])
            if when is None or abs((when - due).days) > 14 or value < left:
                continue
            if method == "fixed" and abs(value - amount) > 2:
                continue
            paid = amount
            result["paid_since_close"] = _money(paid)
            break
    # G413: the actual payment arriving and matching the user's rule marks the
    # bill paid, whatever amount the bank took. One payment, never two bills.
    if rule_hits and amount > 0 and paid < amount and any(
            payment_floor <= (_day(r["date"]) or date.min) for r in rule_hits):
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
    from app.db.collections import accounts_col, card_terms_col, cashflow_cache_col, preferences_col, transactions_col, pending_transactions_col
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
    pairs = select_unique_pairs([r for r in rows if is_settled_payment(r)], accounts, [], set())
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    confirmed = get_confirmed_payday(prefs, today)
    payday = confirmed[0] if confirmed else _next_payday(today, prefs.get("pay_period_config") or {"type": "calendar_month"})
    # Which card each learned series is attributed to, only read when a card
    # has a match rule (an ambiguous rule narrows by it). Failure means no
    # narrowing information, never a failed bill.
    series_cards: dict[str, str] = {}
    if any(normalise_match_rule(t.get(MATCH_FIELD)) for t in configured.values()):
        try:
            doc = await cashflow_cache_col.find_one({"_id": uid}) or {}
            series_cards = {p["key"]: str(p["card_dest_account_id"]) for p in (doc.get("recurring_spend") or [])
                            if isinstance(p, dict) and p.get("key") and p.get("card_dest_account_id")}
        except Exception:
            series_cards = {}
    result = {}
    for card in cards:
        aid = str(card["_id"])
        if aid not in configured or aid not in accounts:
            continue
        bill = estimate_statement(card, configured[aid], [*rows, *pending], accounts, today, next_payday=payday, pairs=pairs,
                                  series_cards=series_cards)
        if bill:
            result[aid] = bill
    # No two defined cards may claim the same payer's learned payment. A new
    # rule is checked on save too, but later bank evidence can expose a
    # previously invisible collision. Fall back to learned evidence until
    # the person distinguishes the rules; never pick an owner by item order.
    owners: dict[tuple[str, str], set[str]] = {}
    for aid, bill in result.items():
        for key in bill.get("rule_series_keys") or ():
            owners.setdefault((str(bill.get("payment_account_id") or ""), key), set()).add(aid)
    conflicts = set().union(*(ids for ids in owners.values() if len(ids) > 1)) if owners else set()
    for aid in conflicts:
        card = accounts[aid]
        baseline = estimate_statement(card, {**configured[aid], MATCH_FIELD: None}, [*rows, *pending], accounts,
                                      today, next_payday=payday, pairs=pairs, series_cards=series_cards)
        if baseline:
            baseline.update(status="payment_unverified", payment_amount=None, payment_remaining=None,
                            rule_series_keys=[], rule_status="unmatched", rule_conflict=True,
                            reason="This payment rule also matches another card. Choose the payment for this card.")
            result[aid] = baseline
    await response_cache.aput("card_statement_bills", uid, result, version=version)
    return result


def statement_card_for_bill(bill: dict, statements: dict[str, dict], resolved: set[str]) -> str:
    """The card whose defined bill replaces this learned occurrence, or "".

    G413: a user-defined match rule wins. A learned series the paying account
    makes, whose key the card's rule names, belongs to that card whatever its
    own card attribution says (two cards once merged into one series). With no
    rule hit the card attribution decides, exactly as G412 did."""
    name = str(bill.get("name") or "")
    account = str(bill.get("account_id") or "")
    if name and account:
        for aid in sorted(resolved):
            st = statements.get(aid) or {}
            if str(st.get("payment_account_id") or "") == account and name in (st.get("rule_series_keys") or ()):
                return aid
    return str(bill.get("card_dest_account_id") or "")


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
    # G441 (G413): a defined bill whose rule matched a real payment but whose
    # amount cannot be estimated still REPLACES that card's learned series. The
    # learned amount stays as ONE provisional occurrence on the defined due date,
    # flagged amount_basis "statement_unknown" so every surface can say the
    # amount is not known yet. Never 0 (false comfort), never the old row left
    # in place unchanged and never both.
    unknown = {aid for aid, bill in statements.items() if bill.get("status") == "amount_unknown"}
    known = resolved | unknown
    provisional_done: set[str] = set()
    kept = []
    for original in raw_bills:
        aid = statement_card_for_bill(original, statements, known)
        if aid not in known or original.get("planned"):
            kept.append(original)
            continue
        # An unclosed NEXT statement has no exact bill yet. Preserve its
        # existing learned estimate, re-anchored to the user's due rule,
        # rather than reusing the last closed balance or silently dropping
        # next period's payment from the payday plan.
        next_due = date.fromisoformat(statements[aid]["next_payment_due"])
        original_day = _day(original.get("expected_date"))
        due_this = date.fromisoformat(statements[aid]["payment_due"])
        later_statement = bool(original_day and original_day > due_this + timedelta(days=14))
        if later_statement:
            if next_due <= window_end and not any(b.get("card_dest_account_id") == aid for b in kept):
                payer_id = statements[aid]["payment_account_id"]
                payer = accounts[payer_id]
                kept.append({**original, "expected_date": next_due.isoformat(),
                             "days_away": (next_due - today).days,
                             "account_id": payer_id, "account_balance": float(payer["balance"]),
                             "account_name": payer.get("nickname") or payer.get("name"),
                             "account_bank": payer.get("provider"), "amount_basis": "balance_estimate"})
        elif aid in unknown and due_this <= window_end and aid not in provisional_done:
            provisional_done.add(aid)
            payer_id = statements[aid]["payment_account_id"]
            payer = accounts[payer_id]
            display_day = max(due_this, today)
            kept.append({**original, "expected_date": display_day.isoformat(),
                         "days_away": (display_day - today).days,
                         "account_id": payer_id, "account_balance": float(payer["balance"]),
                         "account_name": payer.get("nickname") or payer.get("name"),
                         "account_bank": payer.get("provider"), "amount_basis": "statement_unknown",
                         "card_dest_account_id": aid})
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
        if any(statement_card_for_bill(p, statements, resolved) == aid
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
            "amount_basis": ("user_entered" if bill.get("user_entered") and bill["payment_method"] == "full"
                             else "statement_estimate" if bill["payment_method"] == "full" else "fixed_payment"),
            "statement_close": bill["statement_close"], "statement_start": bill["statement_start"],
            "edited": False, "rule_label": None, "pending": due <= today,
            "days_past_due": max(0, (today - due).days),
            "original_date": due.isoformat() if due != display_day else None,
            "dest_account_id": None, "dest_account_spendable": None,
        })
    return kept, known
