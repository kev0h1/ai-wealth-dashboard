"""Pure G412 statement-payment engine contract tests."""
from datetime import date, timedelta

import pytest

from app.services.card_statements import (
    apply_statement_bills,
    estimate_statement,
    has_statement_dates,
    statement_dates,
)


TODAY = date(2026, 3, 20)


def _card(balance=-1840.50, account_id="card"):
    return {"_id": account_id, "name": "NatWest card", "provider": "NatWest",
            "type": "credit_card", "subtype": "CREDIT_CARD", "balance": balance}


def _payer(account_id="cash"):
    return {"_id": account_id, "name": "Current account", "provider": "NatWest",
            "type": "bank", "subtype": "TRANSACTION", "currency": "GBP",
            "balance": 5000, "include_in_safe_to_spend": True}


def _terms(**changes):
    terms = {"statement_close_day": 15, "payment_due_days_after_close": 25,
             "payment_due_day": None, "payment_method": "full",
             "payment_account_id": "cash", "fixed_payment_amount": None}
    terms.update(changes)
    return terms


def _row(account_id, when, amount, transaction_type, **extra):
    return {"account_id": account_id, "date": when, "amount": amount,
            "transaction_type": transaction_type, "is_pending": False, **extra}


def _history(*after_rows):
    # History reaches the statement start (16 February), so this is a closed
    # statement position rather than a sum of current-period purchases.
    return [_row("card", date(2026, 2, 16), -1, "debit"), *after_rows]


def _estimate(card=None, terms=None, rows=None, accounts=None, **kwargs):
    card = card or _card()
    accounts = accounts or {"card": card, "cash": _payer()}
    return estimate_statement(card, terms or _terms(), _history() if rows is None else rows, accounts, TODAY, **kwargs)


def test_closed_statement_reverses_post_close_spend_from_live_card_balance():
    bill = _estimate(rows=_history(_row("card", date(2026, 3, 17), -64.25, "debit")))

    assert bill["statement_close"] == "2026-03-15"
    assert bill["estimated_bill"] == 1776.25
    assert bill["payment_amount"] == 1776.25
    assert bill["payment_remaining"] == 1776.25
    assert bill["spending_since_close"] == 64.25


def test_position_retains_opening_debt_and_statement_fees_but_reverses_later_refund():
    rows = [
        _row("card", date(2026, 2, 1), -700, "debit"),
        _row("card", date(2026, 2, 16), -10, "debit"),  # statement fee
        _row("card", date(2026, 3, 17), -40, "debit"),
        _row("card", date(2026, 3, 19), 15, "credit"),  # later refund
    ]
    bill = _estimate(card=_card(-1000), rows=rows)

    assert bill["estimated_bill"] == 975.0
    assert bill["spending_since_close"] == 40.0


@pytest.mark.parametrize(
    ("today", "close_day", "expected_start", "expected_close"),
    [
        (date(2024, 3, 1), 29, "2024-01-30", "2024-02-29"),
        (date(2025, 3, 1), 29, "2025-01-30", "2025-02-28"),
        (date(2025, 3, 1), 30, "2025-01-31", "2025-02-28"),
        (date(2025, 3, 1), 31, "2025-02-01", "2025-02-28"),
    ],
)
def test_statement_close_days_clamp_per_month(today, close_day, expected_start, expected_close):
    start, close, _, next_due = statement_dates(today, _terms(statement_close_day=close_day))

    assert start.isoformat() == expected_start
    assert close.isoformat() == expected_close
    assert next_due > close


def test_closing_today_is_not_treated_as_a_completed_statement():
    start, close, due, next_due = statement_dates(date(2026, 3, 15), _terms())

    assert (start, close) == (date(2026, 1, 16), date(2026, 2, 15))
    assert due == date(2026, 3, 12)
    assert next_due == date(2026, 4, 9)


def test_offset_due_rule_crosses_months_exactly():
    _, close, due, _ = statement_dates(
        date(2026, 2, 1), _terms(statement_close_day=31, payment_due_days_after_close=33)
    )

    assert close == date(2026, 1, 31)
    assert due == close + timedelta(days=33)


def test_due_on_payday_is_not_counted_as_before_payday():
    bill = _estimate(next_payday=date(2026, 4, 9))

    assert bill["payment_due"] == "2026-04-09"
    assert bill["due_before_payday"] is False


def test_verified_after_close_card_and_source_pair_marks_payment_paid():
    card = _card(0)
    payer = _payer()
    card_credit = _row("card", date(2026, 3, 16), 100, "credit")
    cash_debit = _row("cash", date(2026, 3, 16), -100, "debit")
    bill = _estimate(card=card, rows=_history(card_credit), accounts={"card": card, "cash": payer}, pairs=[(card_credit, cash_debit)])

    assert bill["estimated_bill"] == 100.0
    assert bill["paid_since_close"] == 100.0
    assert bill["payment_remaining"] == 0.0
    assert bill["status"] == "paid"


@pytest.mark.parametrize("proof", ["refund", "wrong_source", "ambiguous"])
def test_unverified_or_wrong_payment_evidence_does_not_clear_a_statement(proof):
    card = _card(0)
    payer, other = _payer(), _payer("other")
    card_credit = _row("card", date(2026, 3, 16), 100, "credit")
    wrong_debit = _row("other", date(2026, 3, 16), -100, "debit")
    # The reconciler supplies only unique verified pairs. Refunds and
    # ambiguous candidates reach this pure engine as no verified pair.
    pairs = [(card_credit, wrong_debit)] if proof == "wrong_source" else []
    bill = _estimate(card=card, rows=_history(card_credit), accounts={"card": card, "cash": payer, "other": other}, pairs=pairs)

    assert bill["paid_since_close"] == 0.0
    assert bill["payment_remaining"] == 100.0
    assert bill["status"] == "estimated"


def test_payment_methods_use_only_their_knowable_amounts():
    full = _estimate(card=_card(-250), terms=_terms(payment_method="full"))
    fixed = _estimate(card=_card(-250), terms=_terms(payment_method="fixed", fixed_payment_amount=100))
    minimum = _estimate(card=_card(-250), terms=_terms(payment_method="minimum"))
    manual = _estimate(card=_card(-250), terms=_terms(payment_method="manual"))

    assert full["payment_amount"] == 250.0
    assert fixed["payment_amount"] == 100.0
    assert minimum["status"] == "payment_unverified" and minimum["payment_amount"] is None
    assert manual["status"] == "payment_unverified" and manual["payment_amount"] is None


def test_fixed_instruction_is_dated_without_a_statement_estimate_but_full_is_not():
    fixed = _estimate(terms=_terms(payment_method="fixed", fixed_payment_amount=100), rows=[])
    full = _estimate(terms=_terms(payment_method="full"), rows=[])

    assert fixed["payment_due"] == "2026-04-09"
    assert fixed["estimated_bill"] is None
    assert fixed["payment_amount"] == 100.0
    assert fixed["payment_remaining"] == 100.0
    assert full["payment_amount"] is None
    assert full["status"] == "incomplete_history"


def test_natwest_fixed_instruction_with_33_day_offset_remains_a_valid_dated_payment():
    card, payer = _card(-250), _payer()
    terms = _terms(
        statement_close_day=31, payment_due_days_after_close=33,
        payment_method="fixed", fixed_payment_amount=100,
    )
    bill = estimate_statement(card, terms, [], {"card": card, "cash": payer}, date(2026, 2, 1))

    assert bill["statement_close"] == "2026-01-31"
    assert bill["payment_due"] == "2026-03-05"
    assert bill["payment_amount"] == 100.0
    assert bill["payment_remaining"] == 100.0


def test_missing_dates_is_a_strict_no_op():
    terms = _terms(statement_close_day=None)

    assert has_statement_dates(terms) is False
    assert _estimate(terms=terms) is None


def _statement(due="2026-04-09", remaining=100, method="fixed"):
    return {
        "statement_close": "2026-03-15", "statement_start": "2026-02-16",
        "payment_due": due, "next_payment_due": "2026-05-09", "payment_remaining": remaining,
        "payment_account_id": "cash", "payment_method": method,
        "status": "estimated",
    }


def test_apply_replaces_only_the_resolved_cards_learned_repayment():
    accounts = {"cash": _payer(), "card": _card(), "other": _card(account_id="other")}
    raw = [
        {"name": "learned card", "card_dest_account_id": "card"},
        {"name": "other card", "card_dest_account_id": "other"},
    ]
    applied, resolved = apply_statement_bills(raw, {"card": _statement()}, accounts, TODAY, date(2026, 4, 30))

    assert resolved == {"card"}
    assert [row["name"] for row in applied[:-1]] == ["other card"]
    assert applied[-1]["card_dest_account_id"] == "card"
    assert applied[-1]["amount"] == 100


def test_due_beyond_window_replaces_stale_learning_but_does_not_emit_a_debit():
    accounts = {"cash": _payer(), "card": _card()}
    raw = [{"name": "old learning", "card_dest_account_id": "card"}]
    applied, resolved = apply_statement_bills(raw, {"card": _statement(due="2026-05-09")}, accounts, TODAY, date(2026, 4, 30))

    assert resolved == {"card"}
    assert applied == []


def test_matching_pending_repayment_is_display_only_not_a_second_cash_debit():
    accounts = {"cash": _payer(), "card": _card()}
    pending = [{"account_id": "cash", "card_dest_account_id": "card", "amount": 100}]
    applied, resolved = apply_statement_bills([], {"card": _statement()}, accounts, TODAY, date(2026, 4, 30), observed_pending=pending)

    assert resolved == {"card"}
    assert applied == []


def test_insufficient_history_and_overlapping_due_rules_fail_honestly():
    insufficient = _estimate(rows=[])
    overlapping = _estimate(
        terms=_terms(statement_close_day=1, payment_due_days_after_close=33),
        rows=[_row("card", date(2026, 2, 2), -1, "debit")],
    )

    assert insufficient["status"] == "incomplete_history"
    assert "not enough settled" in insufficient["reason"]
    assert overlapping["status"] == "incomplete_history"
    assert "overlaps statement periods" in overlapping["reason"]


def test_future_unclosed_statement_does_not_duplicate_the_last_closed_full_bill():
    bill = _estimate(card=_card(-250))
    accounts = {"cash": _payer(), "card": _card(-250)}
    applied, _ = apply_statement_bills([], {"card": bill}, accounts, TODAY, date(2026, 5, 10))

    assert bill["payment_due"] == "2026-04-09"
    assert bill["next_payment_due"] == "2026-05-10"
    assert len(applied) == 1
    assert applied[0]["expected_date"] == "2026-04-09"
