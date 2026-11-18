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

    for col, manual in ((accounts_col, False), (yapily_accounts_col, False), (manual_accounts_col, True)):
        for key in {card_id, _oid(card_id)}:
            if key is None:
                continue
            doc = await col.find_one(
                {"_id": key, "user_id": uid}, {"balance": 1, "current_balance": 1, "available_balance": 1},
            )
            if not doc:
                continue
            # The field precedence the plan balance reader uses: balance, then
            # current_balance, then available_balance (a manual record only has
            # `balance`). A field that is absent or None is skipped, and if none
            # is readable the answer is None, never 0, so a missing balance can
            # not drop the reserve.
            for field in (("balance",) if manual else ("balance", "current_balance", "available_balance")):
                value = doc.get(field)
                if value is None:
                    continue
                try:
                    raw = float(value)
                except (TypeError, ValueError):
                    return None
                return max(0.0, -raw) if raw == raw else None
            return None
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


_MONTHS = r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"
_DATE_TOKEN = re.compile(
    rf"^(?:\d{{1,4}}[/.-]\d{{1,2}}(?:[/.-]\d{{2,4}})?|\d{{1,2}}(?:st|nd|rd|th)?|(?:{_MONTHS})|\d{{2,4}})$", re.I,
)
_REF_MARKER = {"REF", "REFERENCE", "REF:", "ID", "NO", "NO.", "NUMBER", "ON", "DATED", "DATE", "FROM", "TO", "AT", "-"}
_MIN_STABLE = 8


def stable_narrative(description: str) -> str | None:
    """The part of a payment narrative that stays the same month to month: the
    leading words, up to the first token that looks like a date or a reference
    (anything with a digit), with trailing reference markers ("REF", "ON")
    dropped. None when too little is left to be a meaningful rule."""
    kept: list[str] = []
    for token in " ".join(str(description or "").split()).split(" "):
        if any(ch.isdigit() for ch in token) or _DATE_TOKEN.match(token):
            break
        kept.append(token)
    while kept and kept[-1].upper() in _REF_MARKER:
        kept.pop()
    value = " ".join(kept)
    return value if len(value) >= _MIN_STABLE and re.search(r"[A-Za-z]{3}", value) else None


def rule_and_kind(txn: dict) -> tuple[dict, bool] | None:
    """(rule, exact_wording). The rule is the narrowest "contains" text that
    matches this payment AND the same payee's later payments: the tail of a card
    reference (so one card's payment never claims another card's), else the
    stable leading part of the narrative (dates, long digit runs and trailing
    reference tokens removed), else, with exact_wording True, the whole
    narrative or cleaned payee name. A card number is never kept beyond its last
    five digits. None when no text reproduces a match."""
    from app.services.plan_fulfilment import display_name, rule_matches

    description = " ".join(str(txn.get("description") or "").split())
    run = _LONG_RUN.search(description)
    candidates: list[tuple[str, bool]] = []
    if run:
        candidates.append((re.sub(r"\D", "", run.group(0))[-5:], False))
    stable = stable_narrative(description) if not run else None
    if stable:
        candidates.append((stable, False))
    candidates += [(_mask_rule_text(description), True), (_mask_rule_text(display_name(txn)), True)]
    for raw, exact in candidates:
        value = str(raw or "").strip()[:_MAX_RULE]
        rule = {"match_type": "description_contains", "match_value": value}
        if value and rule_matches(rule, txn):
            return rule, exact
    return None


def _rule_from_debit(txn: dict) -> dict | None:
    found = rule_and_kind(txn)
    return found[0] if found else None


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


# ── G476: what the card's own history says ───────────────────────────────────

HISTORY_DAYS = 180
CREDIT_DAYS = 90
RECENT_REPAYMENTS = 6
RECENT_CREDITS = 8
SEARCH_PAGE = 20
SEARCH_MAX_PAGE = 50
SEARCH_MAX_TEXT = 60
_PAYMENT_LOOKING = re.compile(
    r"payment\s+received|card\s+(?:payment|pymt)|(?<![a-z])pymt|repayment|thank\s+you|direct\s+debit", re.I,
)
_NOT_A_REPAYMENT = re.compile(r"refund|reversal|cashback|chargeback", re.I)
_PLAN_SUFFIX = " repayment plan"
_NAME_MAX = 40


def default_plan_name(card_name: str) -> str:
    """"<card name> repayment plan", cut from the card name (never the suffix)
    so it always fits the 40 characters a plan name may have."""
    base = " ".join(str(card_name or "Card").split())[: _NAME_MAX - len(_PLAN_SUFFIX)].rstrip()
    return f"{base or 'Card'}{_PLAN_SUFFIX}"


def safe_card_name(card: dict) -> str:
    """The card's display name, never a person's name (G473)."""
    from app.services.account_names import holder_safe_name

    return holder_safe_name(card) or card_display_name(card)


def safe_account_name(account: dict | None) -> str:
    from app.services.account_names import holder_safe_name
    from app.services.account_plan_sources import account_label

    return (holder_safe_name(account) if account else None) or account_label(account)


def _mask(text) -> str:
    from app.services.card_statements import mask_long_digits

    return mask_long_digits(" ".join(str(text or "").split()))[:120]


def _pence(row: dict) -> int | None:
    try:
        value = abs(float(row.get("amount")))
    except (TypeError, ValueError):
        return None
    return int(round(value * 100)) if value == value else None


def _row_id(row: dict) -> str:
    return str(row.get("_id") or row.get("id") or "")


async def _rows(uid: str, account_ids: list[str], days: int, kind: str | None = None) -> list[dict]:
    """The caller's own rows on exactly these accounts, newest first. The user
    id is always in the query, so another user's account id returns nothing."""
    from app.db.collections import transactions_col, yapily_transactions_col

    if not account_ids:
        return []
    start = timeutil.user_today() - timedelta(days=days)
    cutoff = datetime(start.year, start.month, start.day)
    query: dict = {"user_id": uid, "account_id": {"$in": list(account_ids)}, "date": {"$gte": cutoff}}
    if kind:
        query["transaction_type"] = kind
    rows: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        rows += [r for r in await col.find(query).to_list(None) if not r.get("is_pending")]
    return sorted(rows, key=lambda r: r.get("date") or datetime.min, reverse=True)


def _stamped_to_other_card(debit: dict, card_id: str) -> bool:
    marker = debit.get("own_transfer_match")
    link = marker.get("card_repayment") if isinstance(marker, dict) else None
    return isinstance(link, dict) and bool(link.get("card_account_id")) and str(link["card_account_id"]) != str(card_id)


def pair_card_legs(credits: list[dict], debits: list[dict], card_id: str, accounts: dict[str, dict]) -> list[tuple[dict, dict | None]]:
    """[(credit into the card, the paying account's debit or None)], newest
    credit first. The legs pair on the same amount, within the card's posting
    lag (`pair_timing_ok`: CARD_REPAY_DAYS for a card), and may post on
    different days. Each debit pairs once; the nearest in time wins."""
    from app.services.own_account_transfers import pair_gap, pair_timing_ok

    used: set[str] = set()
    out: list[tuple[dict, dict | None]] = []
    for credit in credits:
        cp = _pence(credit)
        best, best_gap = None, None
        for debit in debits:
            if (cp is None or _pence(debit) != cp or _row_id(debit) in used or str(debit.get("account_id")) == str(card_id)
                    or _stamped_to_other_card(debit, card_id)):
                continue
            if not pair_timing_ok(credit, debit, accounts):
                continue
            gap = pair_gap(credit, debit)
            if best is None or (gap is not None and (best_gap is None or gap < best_gap)):
                best, best_gap = debit, gap
        if best is not None:
            used.add(_row_id(best))
        out.append((credit, best))
    return out


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else round((ordered[mid - 1] + ordered[mid]) / 2, 2)


def _looks_like_repayment(credit: dict) -> bool:
    text = f"{credit.get('description') or ''} {credit.get('merchant_name') or ''}"
    if _NOT_A_REPAYMENT.search(text):
        return False
    return bool(_PAYMENT_LOOKING.search(text)) or isinstance(credit.get("own_transfer_match"), dict)


def _credit_item(credit: dict, debit: dict | None, accounts: dict[str, dict]) -> dict:
    source = accounts.get(str(debit.get("account_id"))) if debit else None
    when = debit if debit is not None else credit
    return {
        "id": _row_id(credit),
        "date": _day(when.get("date")).isoformat() if _day(when.get("date")) else None,
        "card_date": _day(credit.get("date")).isoformat() if _day(credit.get("date")) else None,
        "debit_date": _day(debit.get("date")).isoformat() if debit is not None and _day(debit.get("date")) else None,
        "amount": round((_pence(credit) or 0) / 100, 2),
        "source_account_id": str(debit.get("account_id")) if debit is not None else None,
        "source_account_name": safe_account_name(source) if source else None,
        "matched": debit is not None,
        "narrative": _mask(credit.get("description") or credit.get("merchant_name")),
        "fill_rule": _rule_from_debit(debit) if debit is not None else None,
        "rule_is_exact": bool(debit is not None and (rule_and_kind(debit) or (None, False))[1]),
    }


def latest_leg_match(repayments: list[dict], source_id: str | None) -> dict | None:
    """The newest repayment whose card credit pairs with a debit from this paying
    account and whose debit gives a rule that matches it, else None."""
    if not source_id:
        return None
    return next((r for r in repayments if r["matched"] and r["source_account_id"] == str(source_id) and r["fill_rule"]), None)


def eligible_sources(account_map: dict[str, dict]) -> dict[str, dict]:
    """The accounts a card plan may be paid from: the plan source rule plus
    counted in Left to spend. Prefill and search share this one test."""
    from app.services.counted_accounts import is_counted
    from app.services.account_plan_sources import eligible_source_account_map

    return {aid: doc for aid, doc in eligible_source_account_map(account_map, set()).items() if is_counted(doc)}


async def card_history(uid: str, card_id: str, account_map: dict[str, dict], eligible: dict[str, dict]) -> dict:
    """The card's recent repayments from both legs, and its recent credits.

    `repayments`: the last few payments into the card (a matched pair, or a
    payment-looking credit whose paying debit was not found), newest first.
    `sources`: the paying accounts those pairs came from, with a usual amount.
    `recent_credits`: every recent credit on the card, for the fallback list."""
    cid = str(card_id)
    credits = await _rows(uid, [cid], HISTORY_DAYS, "credit")
    pay_ids = [aid for aid in eligible if aid != cid]
    debits = await _rows(uid, pay_ids, HISTORY_DAYS, "debit")
    pairs = pair_card_legs(credits, debits, cid, account_map)
    items = [_credit_item(c, d, account_map) for c, d in pairs]
    repayments = [
        item for item, (credit, debit) in zip(items, pairs)
        if debit is not None or _looks_like_repayment(credit)
    ][:RECENT_REPAYMENTS]
    by_source: dict[str, list[dict]] = {}
    for item in repayments:
        if item["source_account_id"]:
            by_source.setdefault(item["source_account_id"], []).append(item)
    sources = [
        {
            "account_id": aid, "name": rows[0]["source_account_name"], "count": len(rows),
            "usual_amount": _median([r["amount"] for r in rows]), "last_date": rows[0]["date"],
        }
        for aid, rows in by_source.items()
    ]
    sources.sort(key=lambda s: (s["count"], s["last_date"] or ""), reverse=True)
    cutoff = timeutil.user_today() - timedelta(days=CREDIT_DAYS)
    recent_credits = [
        item for item in items if (_day(item["card_date"]) or date.min) >= cutoff
    ][:RECENT_CREDITS]
    return {"repayments": repayments, "sources": sources, "recent_credits": recent_credits}


def _amount_query(text: str) -> int | None:
    cleaned = re.sub(r"[£,\s]", "", text)
    if not re.fullmatch(r"\d+(?:\.\d{1,2})?", cleaned):
        return None
    return int(round(float(cleaned) * 100))


def _squash(text) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text or "").lower())


def _exact_for(row: dict, debit: dict | None, on_card: bool) -> bool:
    leg = debit if on_card else row
    found = rule_and_kind(leg) if leg is not None else None
    return bool(found and found[1])


async def search(uid: str, card_id: str, source_id: str, query: str, *, limit: int = SEARCH_PAGE, skip: int = 0,
                 account_map: dict[str, dict] | None = None) -> dict | None:
    """G476: search the card's and the paying account's own transactions by text
    or amount, matching the raw bank narrative as well as the cleaned name.

    Scoped to the two accounts only, and only when both are the caller's own
    (None when the card is not theirs). A row from the card side carries the
    rule of the paying account's debit it pairs with, if one is found. Narratives
    shown have long digit runs cut to their last five."""
    from app.services.account_plan_sources import owned_account_map
    from app.services.plan_fulfilment import display_name

    accounts = account_map if account_map is not None else await owned_account_map(uid)
    card = await owned_card(uid, card_id)
    source = eligible_sources(accounts).get(str(source_id))
    if card is None or source is None or source.get("_account_plan_manual") or str(source_id) == str(card_id):
        return None
    cid, sid = str(card_id), str(source_id)
    text = " ".join(str(query or "").split())[:SEARCH_MAX_TEXT]
    limit = max(1, min(int(limit), SEARCH_MAX_PAGE))
    skip = max(0, int(skip))
    rows = await _rows(uid, [cid, sid], HISTORY_DAYS)
    pairs = pair_card_legs(
        [r for r in rows if str(r.get("account_id")) == cid and r.get("transaction_type") == "credit"],
        [r for r in rows if str(r.get("account_id")) == sid and r.get("transaction_type") == "debit"],
        cid, accounts,
    )
    paired_debit = {_row_id(c): d for c, d in pairs if d is not None}
    want_pence = _amount_query(text) if text else None
    squashed = _squash(text)
    hits = []
    for row in rows:
        if str(row.get("account_id")) not in (cid, sid):
            continue  # never another account's row, whatever the query returned
        if text:
            hay = f"{row.get('description') or ''} {row.get('merchant_name') or ''} {display_name(row)}"
            by_text = text.lower() in hay.lower() or (len(squashed) >= 3 and squashed in _squash(hay))
            if not by_text and (want_pence is None or _pence(row) != want_pence):
                continue
        hits.append(row)
    page = hits[skip: skip + limit]
    items = []
    for row in page:
        on_card = str(row.get("account_id")) == cid
        rule = _rule_from_debit(paired_debit[_row_id(row)]) if on_card and _row_id(row) in paired_debit else (
            None if on_card else _rule_from_debit(row) if row.get("transaction_type") == "debit" else None
        )
        items.append({
            "id": _row_id(row),
            "account_id": str(row.get("account_id")),
            "account_name": safe_card_name(card) if on_card else safe_account_name(source),
            "on_card": on_card,
            "date": _day(row.get("date")).isoformat() if _day(row.get("date")) else None,
            "amount": round((_pence(row) or 0) / 100, 2),
            "direction": "in" if row.get("transaction_type") == "credit" else "out",
            "narrative": _mask(row.get("description") or row.get("merchant_name")),
            "display_name": _mask(display_name(row)),
            "fill_rule": rule,
            "rule_is_exact": bool(rule) and _exact_for(row, paired_debit.get(_row_id(row)), on_card),
        })
    return {"items": items, "total": len(hits), "limit": limit, "skip": skip, "has_more": skip + limit < len(hits)}


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
        account_label, owned_account_map,
    )
    from app.services.card_statements import load_statement_bills, normalise_match_rule, row_matches_rule

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

    eligible = eligible_sources(account_map)
    try:
        history = await card_history(uid, cid, account_map, eligible)
    except Exception:
        logger.warning("card plan prefill: card history unavailable", exc_info=True)
        history = {"repayments": [], "sources": [], "recent_credits": []}
    sources = history["sources"]
    # A paying account the user saved wins. Repayments from SEVERAL accounts are
    # offered grouped, never picked for the user. Otherwise the detected series'
    # account, else the one account the history shows.
    source_id = None
    saved_source = terms.get("payment_account_id")
    if saved_source is not None and str(saved_source) in eligible:
        source_id = str(saved_source)
    elif len(sources) <= 1:
        for candidate in ((detected or {}).get("account_id"), sources[0]["account_id"] if sources else None):
            if candidate is not None and str(candidate) in eligible:
                source_id = str(candidate)
                break
    usual = next((x for x in sources if x["account_id"] == source_id), None)

    amount, basis = None, None
    if statement and statement.get("payment_amount") and float(statement["payment_amount"]) > 0 and statement.get("payment_method") == "fixed":
        amount, basis = float(statement["payment_amount"]), "fixed_payment"
    elif usual and (usual["count"] >= 2 or not (statement or detected)):
        amount, basis = float(usual["usual_amount"]), "usual_repayments"
    elif statement and statement.get("payment_amount") and float(statement["payment_amount"]) > 0:
        amount, basis = float(statement["payment_amount"]), "statement_estimate"
    elif detected and float(detected.get("avg_amount") or 0) > 0:
        amount, basis = float(detected["avg_amount"]), "direct_debit"
    elif usual:
        amount, basis = float(usual["usual_amount"]), "usual_repayments"
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
    leg_match = latest_leg_match(history["repayments"], source_id)
    if rule is None and leg_match:
        rule = leg_match["fill_rule"]
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
        "card_name": safe_card_name(card),
        "default_name": default_plan_name(safe_card_name(card)),
        "existing_plan_id": str(existing["_id"]) if existing else None,
        "balance_owed": None if owed is None else round(owed, 2),
        "source_account_id": source_id,
        "source_account_name": account_label(account_map.get(source_id)) if source_id else None,
        "amount": amount,
        "amount_basis": basis,
        "estimated": basis in ("statement_estimate", "direct_debit", "usual_repayments"),
        "tracking_start": (start or today).isoformat(),
        "start_is_detected": start is not None,
        "fill_rule": rule,
        "schedule": suggested,
        "detected": bool(source_id or amount or rule),
        "repayments": history["repayments"],
        "sources": sources,
        "source_choice_needed": len(sources) > 1 and source_id is None,
        "card_leg_match": leg_match,
        "recent_credits": history["recent_credits"],
    }
