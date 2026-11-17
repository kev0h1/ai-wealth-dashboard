"""G475: card repayment plans, one per card, stored as a commitment-shaped record.

A plan is a commitment (same collection, same schedule types, same tracking
rule, same paying account) whose target is a credit card instead of a savings
pot:

    plan_kind          "card_repayment"
    card_account_id    the card (one ACTIVE plan per card)
    source_account_id  the account the repayments leave (pay from)
    schedule           any goal schedule; the sheet's fixed amount is an
                       arithmetic schedule with a step of 0
    fill_rule          the payment that counts as this period's repayment

Because it is an ordinary scheduled commitment, every reader of plan reserves
(Left to spend, the per-account walk and Available, Upcoming, cover moves, the
payday plan) already reserves "planned minus paid this period" at the paying
account (G465). This module owns the other half of the rule: a card that has a
plan has NO other repayment. `replace_planned_card_bills` removes that card's
learned repayment AND its statement estimate from the one list of occurrences
every money view reads, so the plan is the only reserve for the card, and
`plan_month_amounts` hands the debt plan the same schedule so "would clear by"
follows the plan. A paused, done or cancelled plan replaces nothing: the
prediction comes straight back.

Nothing here writes. Figures are estimates; callers hedge them.
"""
from __future__ import annotations

import logging
import math
import re
from datetime import date, datetime, timedelta, timezone

from app.core import timeutil
from app.services import goal_schedule
from app.services.pay_period import get_pay_period_for_date

logger = logging.getLogger(__name__)

PLAN_KIND = "card_repayment"
DEFAULT_PLAN_PERIODS = 12
_MAX_RULE = 80
_LONG_RUN = re.compile(r"(?<!\d)\d(?:[- ]?\d){11,}(?!\d)")


def is_card_plan(doc: dict | None) -> bool:
    return bool(doc) and doc.get("plan_kind") == PLAN_KIND


def replaces_prediction(doc: dict | None) -> bool:
    """Only a live plan stands in for the prediction: active and not paused."""
    return (
        is_card_plan(doc)
        and (doc.get("status") or "active") == "active"
        and doc.get("paused") is not True
        and bool(doc.get("card_account_id"))
        and goal_schedule.is_scheduled(doc.get("schedule"))
    )


async def active_card_plans(uid: str, today: date | None = None) -> dict[str, dict]:
    """{card_account_id: plan doc} for every plan that replaces its card's
    prediction. The oldest plan wins if a duplicate ever slipped through. A plan
    whose schedule has run out (the last pay period it asks for is over) stops
    replacing anything, so the card's usual payment counts again rather than the
    card having no repayment at all."""
    from app.db.collections import commitments_col, preferences_col

    today = today or timeutil.user_today()
    docs = await commitments_col.find(
        {"user_id": uid, "plan_kind": PLAN_KIND, "status": "active"}
    ).to_list(None)
    candidates = sorted((d for d in docs if replaces_prediction(d)), key=lambda d: str(d.get("_id")))
    if not candidates:
        return {}
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    cfg = prefs.get("pay_period_config") or {"type": "calendar_month"}
    out: dict[str, dict] = {}
    period_end = get_pay_period_for_date(today, cfg)[1]
    for doc in candidates:
        last = goal_schedule.end_date(doc["schedule"], cfg)
        first = min((due for due, _a in goal_schedule.events(doc["schedule"], cfg)), default=None)
        # A plan that asks for nothing yet (its first payment is in a later pay
        # period) reserves nothing, so it must not hide the card's prediction.
        if last is not None and last >= today and first is not None and first <= period_end:
            out.setdefault(str(doc["card_account_id"]), doc)
    return out


async def owed_balance(uid: str, card_id: str) -> float | None:
    """What the card owes now, from the same signed balance the debt plan and the
    statement code read (a negative balance is debt). None when the card cannot
    be read, so a failed read never caps a reserve to zero."""
    from app.db.collections import accounts_col, manual_accounts_col, yapily_accounts_col

    for col in (accounts_col, yapily_accounts_col, manual_accounts_col):
        for key in {card_id, _oid(card_id)}:
            if key is None:
                continue
            doc = await col.find_one({"_id": key, "user_id": uid}, {"balance": 1})
            if doc:
                try:
                    raw = float(doc.get("balance") or 0.0)
                except (TypeError, ValueError):
                    return None
                return max(0.0, -raw)
    return None


def _oid(value: str):
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def replace_planned_card_bills(
    bills: list[dict], plan_card_ids: set[str], statements: dict[str, dict] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Split `bills` into (kept, dropped): `dropped` is every occurrence that
    belongs to a card with a plan, whether it is the learned repayment series
    or a statement estimate. One-off planned payments (`planned`) are never
    touched, and a bill with no card attribution is never guessed at.

    The same attribution the statement bills use decides the card:
    `statement_card_for_bill` (a defined rule wins), else the bill's own
    `card_dest_account_id`."""
    if not plan_card_ids:
        return list(bills), []
    from app.services.card_statements import statement_card_for_bill

    known = set(statements or {})
    kept: list[dict] = []
    dropped: list[dict] = []
    for bill in bills:
        if bill.get("planned"):
            kept.append(bill)
            continue
        card = str(bill.get("card_dest_account_id") or "")
        if statements:
            card = statement_card_for_bill(bill, statements, known) or card
        (dropped if card and card in plan_card_ids else kept).append(bill)
    return kept, dropped


def plan_month_amounts(schedule: dict, cfg: dict, today: date, horizon: int) -> dict[int, float]:
    """{month index 1..horizon: pounds} for the debt plan's month walk, from the
    schedule's own events. Month 1 is next month (an event still to come this
    month counts in month 1, as the debt plan's other predicted payments do).
    Months after the schedule ends are 0: the plan pays nothing there, so the
    walk never falls back to a usual payment the plan has replaced."""
    out = {i: 0.0 for i in range(1, horizon + 1)}
    for due, pence in goal_schedule.events(schedule, cfg):
        if due < today:
            continue
        i = max(1, (due.year * 12 + due.month) - (today.year * 12 + today.month))
        if i <= horizon:
            out[i] = round(out[i] + pence / 100, 2)
    return out


def fixed_schedule(amount_pence: int, start: date, count: int) -> dict:
    """The sheet's "fixed amount": the same amount every pay period."""
    return goal_schedule.validate({
        "type": "arithmetic", "start_pence": int(amount_pence), "step_pence": 0,
        "step_unit": "period", "start_date": start.isoformat(),
        "count": max(1, min(int(count), goal_schedule.MAX_PERIODS)), "end_date": None,
    })


def periods_to_clear(owed: float | None, amount_pence: int) -> int:
    """How many equal repayments cover the balance before interest, at least 1."""
    if not owed or owed <= 0 or amount_pence <= 0:
        return DEFAULT_PLAN_PERIODS
    return max(1, min(goal_schedule.MAX_PERIODS, math.ceil(owed * 100 / amount_pence)))


def _mask_rule_text(text: str) -> str:
    """A rule never stores a card number: a run of 12 or more digits keeps only
    its last five."""
    match = _LONG_RUN.search(text)
    if not match:
        return text
    return re.sub(r"\D", "", match.group(0))[-5:]


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return timeutil.to_user_date(value)
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _rule_from_debit(txn: dict) -> dict | None:
    """The narrowest "contains" text that matches this payment: the tail of a
    card reference in its narrative (so one card's payment never claims
    another card's from the same bank), else the whole narrative, else the
    cleaned payee name. A card number is never kept beyond its last five
    digits. None when no text reproduces a match."""
    from app.services.plan_fulfilment import display_name, rule_matches

    description = " ".join(str(txn.get("description") or "").split())
    run = _LONG_RUN.search(description)
    candidates = [re.sub(r"\D", "", run.group(0))[-5:]] if run else []
    candidates += [_mask_rule_text(description), _mask_rule_text(display_name(txn))]
    for raw in candidates:
        value = str(raw or "").strip()[:_MAX_RULE]
        rule = {"match_type": "description_contains", "match_value": value}
        if value and rule_matches(rule, txn):
            return rule
    return None


async def _recent_debits(uid: str, account_id: str, days: int = 120) -> list[dict]:
    from app.db.collections import transactions_col, yapily_transactions_col

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)  # naive-ok: lookback window, not a calendar date
    query = {"user_id": uid, "account_id": account_id, "transaction_type": "debit", "date": {"$gte": cutoff}}
    rows: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        rows += await col.find(query).to_list(None)
    return sorted(rows, key=lambda r: r.get("date") or datetime.min, reverse=True)


async def owned_card(uid: str, card_id: str) -> dict | None:
    """The user's own credit card with this id, else None."""
    from app.services.account_kinds import is_credit_card_account
    from app.services.account_plan_sources import owned_account_map

    card = (await owned_account_map(uid)).get(str(card_id or ""))
    if card is None:
        return None
    if is_credit_card_account(card) or card.get("account_type") == "credit_card":
        return card
    return None


def card_display_name(card: dict) -> str:
    from app.services.account_names import display_account_name

    return display_account_name(card.get("nickname") or card.get("display_name") or card.get("name") or "Card")


async def prefill(uid: str, card_id: str, today: date | None = None) -> dict | None:
    """What the app already knows about how this card is repaid, so the plan
    sheet opens filled in. None when the card is not the user's own card.

    Where a field is not known it is None and the sheet asks. Order of evidence
    for each field:
      pay from      the card's saved payment account, else the account the
                    detected repayment series leaves from;
      amount        a fixed payment, else the statement estimate (both from the
                    dated card payment), else the detected direct debit's usual
                    amount;
      tracking      the saved payment rule, else the latest payment of the
                    detected series (card numbers masked to five digits);
      start         the next expected payment of the series, so a payment
                    already made this period is never reserved a second time.
    Every amount is an estimate and says so."""
    from app.db.collections import card_terms_col, cashflow_cache_col, commitments_col
    from app.services.account_plan_sources import (
        account_label, eligible_source_account_map, owned_account_map,
    )
    from app.services.card_statements import load_statement_bills, normalise_match_rule, row_matches_rule
    from app.services.counted_accounts import is_counted

    today = today or timeutil.user_today()
    account_map = await owned_account_map(uid)
    card = await owned_card(uid, card_id)
    if card is None:
        return None
    cid = str(card_id)
    existing = await commitments_col.find_one(
        {"user_id": uid, "plan_kind": PLAN_KIND, "card_account_id": cid, "status": "active"}, {"_id": 1},
    )
    terms = await card_terms_col.find_one({"user_id": uid, "account_id": cid}) or {}
    try:
        cache = await cashflow_cache_col.find_one({"_id": uid}) or {}
    except Exception:
        cache = {}
    series = [
        p for p in (cache.get("recurring_spend") or [])
        if isinstance(p, dict) and str(p.get("card_dest_account_id") or "") == cid and p.get("account_id")
    ]
    series.sort(key=lambda p: (str(p.get("next_date") or ""), float(p.get("avg_amount") or 0)), reverse=True)
    detected = series[0] if series else None

    statement = None
    try:
        statement = (await load_statement_bills(uid, today=today)).get(cid)
    except Exception:
        logger.warning("card plan prefill: statement bill unavailable", exc_info=True)
    if statement and statement.get("status") not in ("estimated", "paid"):
        statement = None

    eligible = {
        aid: doc for aid, doc in eligible_source_account_map(account_map, set()).items() if is_counted(doc)
    }
    source_id = None
    for candidate in (terms.get("payment_account_id"), (detected or {}).get("account_id")):
        if candidate is not None and str(candidate) in eligible:
            source_id = str(candidate)
            break

    amount, basis = None, None
    if statement and statement.get("payment_amount") and float(statement["payment_amount"]) > 0:
        amount = float(statement["payment_amount"])
        basis = "fixed_payment" if statement.get("payment_method") == "fixed" else "statement_estimate"
    elif detected and float(detected.get("avg_amount") or 0) > 0:
        amount, basis = float(detected["avg_amount"]), "direct_debit"
    if amount is not None:
        amount = round(amount, 2)

    rule = None
    debits = await _recent_debits(uid, source_id) if source_id else []
    saved = normalise_match_rule(terms.get("payment_match"))
    if saved and saved.get("kind") == "contains" and saved.get("text"):
        rule = {"match_type": "description_contains", "match_value": _mask_rule_text(saved["text"])[:_MAX_RULE]}
    elif saved and saved.get("kind") == "payment":
        hit = next((t for t in debits if row_matches_rule(t, saved)), None)
        rule = _rule_from_debit(hit) if hit else None
    if rule is None and detected and detected.get("account_id") and str(detected["account_id"]) == source_id:
        key = str(detected.get("key") or "")
        from app.services.own_account_transfers import series_key, series_key_forms
        hit = next((t for t in debits if key and (key == series_key(t) or key in series_key_forms(t))), None)
        rule = _rule_from_debit(hit) if hit else None

    start = None
    if detected and _day(detected.get("next_date")) and _day(detected["next_date"]) >= today:
        start = _day(detected["next_date"])
    elif statement and _day(statement.get("payment_due")) and _day(statement["payment_due"]) >= today:
        start = _day(statement["payment_due"])

    owed = max(0.0, -float(card.get("balance") or 0.0)) if card.get("balance") is not None else None
    amount_pence = int(round(amount * 100)) if amount else 0
    suggested = None
    if amount_pence > 0:
        suggested = fixed_schedule(amount_pence, start or today, periods_to_clear(owed, amount_pence))
    return {
        "card_account_id": cid,
        "card_name": card_display_name(card),
        "existing_plan_id": str(existing["_id"]) if existing else None,
        "balance_owed": None if owed is None else round(owed, 2),
        "source_account_id": source_id,
        "source_account_name": account_label(account_map.get(source_id)) if source_id else None,
        "amount": amount,
        "amount_basis": basis,
        "estimated": basis in ("statement_estimate", "direct_debit"),
        "tracking_start": (start or today).isoformat(),
        "start_is_detected": start is not None,
        "fill_rule": rule,
        "schedule": suggested,
        "detected": bool(source_id or amount or rule),
    }
