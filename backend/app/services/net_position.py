"""Net position — the shared "what happened to my position this period" fact.

Owner-approved fix (2026-08): three surfaces used to disagree because there
was no shared fact behind them. `compute_safe_to_spend` (analytics.py) is a
forward-looking cash runway to payday; it never saw credit-card balance
growth, so it could hand out spending permission the user was quietly
funding on a card. `pace.compute_pace` derives its sustainable-rate figure
from that same cash-only pot. `spend_impact.py` priced a payday-move promise
from a spend-vs-baseline rate delta with no cap against money that actually
exists. This module gives all three ONE shared fact to read instead of each
re-deriving its own.

Two frames, and they must NEVER be subtracted from each other:

  (a) `card_growth_by_card` / `card_growth_unpaid` — a STOCK fact. "How
      much credit-card growth exists right now?" It is reported beside the
      cash runway, not normally subtracted from it. Only growth on a card
      with no learned repayment series is reserved by Safe-to-Spend as a
      fail-closed fallback. Floored at zero: cards being paid DOWN must
      never inflate Safe-to-Spend (the cash cost of the paydown is already
      reflected in account balances).

  (b) `period_net` — the FLOW frame. "Income vs outflow so far this period,
      and the raw (unfloored, can be negative) card-growth figure that goes
      with it." Descriptive only, never reserved against a pot. Its only
      consumer is `spend_impact.compute_spend_impact`'s net-negative
      permission gate (owner decision, 2026-08: the Home card's
      period-to-date ledger that used to surface this on GET
      /safe-to-spend was removed from the frontend, and that attachment
      was removed here too — `compute_safe_to_spend`/`get_safe_to_spend`
      no longer call this function at all).

A previous version of the UI subtracted a 25-day FLOW figure from a 2-day
STOCK runway and produced a meaningless "£83 behind" — the pot answers "what
can I safely spend between now and payday", the period-net frame answers
"how has this period gone so far"; they are different questions on
different time bases and must stay that way.

Both helpers are failure-tolerant: any exception is logged and a zero/None
result is returned. Neither ever raises into its caller.
"""
from __future__ import annotations

import logging
from datetime import date

log = logging.getLogger(__name__)


async def card_growth_unpaid(
    uid: str,
    period_start: date,
    today: date,
    window_bills: list[dict] | None = None,
) -> float:
    """Unpaid credit-card balance growth this period, net of any card
    payment already sitting in the upcoming-bills window (double-count
    guard — see module docstring).

    Reuses `needle.py`'s existing credit-card identification and delta
    maths rather than reimplementing it (`_credit_card_account_ids`,
    `_txns_for_period`, `_card_delta`). `_card_delta` is debits minus
    credits over the card accounts for the period: positive = cards grew.

    Double-count guard: `compute_safe_to_spend` already walks upcoming
    bills between today and payday, and one of those bills may be a
    credit-card direct debit that will settle part of this growth. Bill
    dicts built at analytics.py:1904-1921 already carry an explicit
    `is_credit_card` boolean (set via `is_credit_card_account`) alongside
    `account_id` — that flag is the PRIMARY signal a bill resolves to a
    card, since `account_id` sets can differ in spelling/format across the
    two transaction collections (native + Yapily) the card-growth delta and
    the bills window are independently sourced from. `account_id in
    card_ids` is kept as a FALLBACK for bill dicts with no `is_credit_card`
    key at all (older callers/tests), so a card direct debit still gets
    caught when the id sets don't line up. Bill dicts with neither signal
    present cannot be resolved to a card account reliably, so the guard is
    skipped for that entry rather than risk a false match.

    Floored at zero: cards being paid DOWN must never inflate the pot.
    """
    rows = await card_growth_by_card(uid, period_start, today, window_bills)
    if rows is None:
        return 0.0
    observed_net = sum(float(row.get("net_change", row["growth"])) for row in rows)
    scheduled_repayments = sum(
        max(0.0, float(row["growth"]) - float(row["unpaid_growth"]))
        for row in rows
    )
    return round(max(0.0, observed_net - scheduled_repayments), 2)


async def card_growth_by_card(
    uid: str,
    period_start: date,
    today: date,
    window_bills: list[dict] | None = None,
) -> list[dict] | None:
    """Return positive card growth separately for each card.

    Each row contains the signed ``net_change``, positive ``growth`` for
    reserve decisions, and ``unpaid_growth`` after any forecast repayment
    already present in the cash window. Keeping the signed value means a
    paydown on one card offsets growth on another in the user-facing total,
    while the fallback reserve can still be applied to the exact unlearned
    card rather than guessed across the portfolio.

    The helper performs the same account and transaction reads as the old
    aggregate implementation, then groups in memory. ``None`` means the
    lookup failed; Safe-to-Spend treats that as degraded and fails closed.
    The compatibility wrapper above retains its historical zero-on-failure
    behaviour for any descriptive caller.
    """
    try:
        from app.services.needle import _card_delta, _credit_card_account_ids, _txns_for_period

        card_ids = await _credit_card_account_ids(uid)
        if not card_ids:
            return []

        txns = await _txns_for_period(uid, period_start, today, account_ids=card_ids)
        by_card: dict[str, list[dict]] = {card_id: [] for card_id in card_ids}
        for txn in txns:
            account_id = str(txn.get("account_id") or "")
            if account_id in by_card:
                by_card[account_id].append(txn)

        scheduled: dict[str, float] = {card_id: 0.0 for card_id in card_ids}
        for bill in (window_bills or []):
            destination = str(bill.get("card_dest_account_id") or "")
            if destination in card_ids:
                matched_id = destination
            else:
                account_id = str(bill.get("account_id") or "")
                is_card = bill.get("is_credit_card")
                if is_card is not False and account_id in card_ids:
                    matched_id = account_id
                elif is_card is True and len(card_ids) == 1:
                    # Backwards-compatible fallback for an older bill shape
                    # that identifies a card payment but cannot name its
                    # destination. With more than one card, guessing would
                    # make the per-card reserve unsafe, so leave it unmatched.
                    matched_id = next(iter(card_ids))
                else:
                    matched_id = ""
            if matched_id:
                scheduled[matched_id] += float(bill.get("amount") or 0.0)

        rows: list[dict] = []
        for card_id in sorted(card_ids):
            net_change = round(float(_card_delta(by_card[card_id])), 2)
            if net_change == 0:
                continue
            growth = round(max(0.0, net_change), 2)
            rows.append({
                "account_id": card_id,
                "net_change": net_change,
                "growth": growth,
                "unpaid_growth": round(max(0.0, growth - scheduled[card_id]), 2),
            })
        return rows
    except Exception:
        log.exception("card_growth_by_card failed for %s", uid)
        return None


async def period_net(uid: str) -> dict | None:
    """Period-to-date income/outflow/net, plus the raw (unfloored) signed
    card-growth figure. Returns None on any failure.

    income/outflow are numerically identical to the IN/OUT pills the Spend
    page already shows — computed via spend_verdict's own `_load_period_txns`
    + `bucket_transactions`, never a fresh query of this module's own, so
    the two surfaces can never drift apart. MOVEMENT-kind rows (savings
    transfers, credit-card payments) are deliberately excluded from both,
    same as the Spend page — they are position-neutral, not spend or income.

    `card_growth` here is the raw signed `_card_delta` for the period (NOT
    floored — this figure is descriptive, and may be negative when cards
    were paid down this period).
    """
    try:
        from app.db.collections import preferences_col
        from app.services.categories import get_category_kinds
        from app.services.needle import _card_delta, _credit_card_account_ids, _txns_for_period
        from app.services.pay_period import get_pay_period_for_date
        from app.services.spend_verdict import _load_period_txns, bucket_transactions

        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
        today = date.today()
        period_start, _period_end = get_pay_period_for_date(today, pay_cfg)

        txns = await _load_period_txns(uid, period_start, today)
        kind_map = await get_category_kinds(uid)
        cat_agg, _moved_groups, income_total = bucket_transactions(txns, kind_map)
        outflow = sum(row["spent"] for row in cat_agg.values())

        card_ids = await _credit_card_account_ids(uid)
        card_growth = 0.0
        if card_ids:
            card_txns = await _txns_for_period(uid, period_start, today, account_ids=card_ids)
            card_growth = _card_delta(card_txns)

        days_elapsed = (today - period_start).days + 1

        return {
            "income": round(income_total, 2),
            "outflow": round(outflow, 2),
            "net": round(income_total - outflow, 2),
            "card_growth": round(card_growth, 2),
            "period_start": period_start.isoformat(),
            "days_elapsed": days_elapsed,
        }
    except Exception:
        log.exception("period_net failed for %s — returning None", uid)
        return None


def short_reason_for(
    state: str,
    safe_to_spend_cash: float,
    card_growth_reserved: float,
) -> str | None:
    """Pure derivation of `compute_safe_to_spend`'s `short_reason` field,
    factored out here so it's unit-testable without the full
    `compute_safe_to_spend` DB fan-out.

    None unless `state == "short"`. "bills" means the cash-only figure was
    already non-positive, which is a genuine risk of not covering the pay
    period. "cards_unconfirmed" means cash was positive but the fail-closed
    reserve for a card with no learned repayment series consumed it.
    """
    if state != "short":
        return None
    if safe_to_spend_cash <= 0:
        return "bills"
    if card_growth_reserved > 0:
        return "cards_unconfirmed"
    return None
