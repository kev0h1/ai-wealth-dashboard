"""G266: a card repayment is a payment at risk for coverage, never a calm
"unfunded move", while staying MOVEMENT-kind so it is never spend.

Synthetic fixtures only; reuses the fake-Mongo plumbing of
test_internal_inflows.py.
"""
import asyncio
from datetime import timedelta

import app.core.timeutil as timeutil
import app.routers.analytics as analytics
from app.services.categories import MOVEMENT, is_card_repayment, is_spend
from app.services.companion import _gate_recommendation, _walk_events, walk_sort_key

from test_internal_inflows import (
    UID,
    _bill,
    _pattern,
    _run_at_risk,
    _run_build_response,
)


def _debt_pattern(**overrides):
    base = dict(
        key="NW WORLD MASTERCAR", category="Debt", account_id="cur", account_name="THE NUMBER ONE",
        dest_account_id=None, dest_account_name=None, dest_account_bank=None, dest_account_spendable=None,
        avg_amount=62.22, account_balance=93.49,
    )
    base.update(overrides)
    return _pattern(**base)


# ── the rule ────────────────────────────────────────────────────────────────

def test_rule_debt_category_without_own_destination_is_a_repayment():
    assert is_card_repayment("Debt") is True


def test_rule_learned_card_destination_always_qualifies():
    assert is_card_repayment("Transfer", card_dest_account_id="card1") is True


def test_rule_own_account_destination_makes_it_a_transfer():
    assert is_card_repayment("Debt", dest_account_id="sav") is False


def test_rule_savings_and_ordinary_bills_are_not_repayments():
    assert is_card_repayment("Savings") is False
    assert is_card_repayment("Bills") is False


def test_rule_a_debit_leaving_a_card_is_never_a_repayment():
    assert is_card_repayment("Debt", source_is_credit_card=True, card_dest_account_id="x") is False


# ── backend kind + flag on the forecast ─────────────────────────────────────

def test_debt_series_without_resolved_card_is_flagged_and_stays_movement(monkeypatch):
    bill = _run_build_response(monkeypatch, [_debt_pattern()])["upcoming_bills"][0]
    assert bill["kind"] == MOVEMENT
    assert bill["is_card_repayment"] is True
    assert bill["card_dest_account_id"] is None


def test_debt_series_with_resolved_card_is_flagged_and_carries_the_card(monkeypatch):
    pattern = _debt_pattern(card_dest_account_id="card1", card_dest_account_name="NW World Mastercard", card_dest_account_bank="natwest")
    bill = _run_build_response(monkeypatch, [pattern])["upcoming_bills"][0]
    assert bill["kind"] == MOVEMENT
    assert bill["is_card_repayment"] is True
    assert bill["card_dest_account_id"] == "card1"
    assert bill["card_dest_account_name"] == "NW World Mastercard"


def test_savings_transfer_and_ordinary_bill_are_not_flagged(monkeypatch):
    transfer = _pattern()  # Transfer category, learned own-account destination
    bill = _run_build_response(monkeypatch, [transfer])["upcoming_bills"][0]
    assert bill["kind"] == MOVEMENT and bill["is_card_repayment"] is False
    groceries = _run_build_response(monkeypatch, [_pattern(category="Groceries", dest_account_id=None)])["upcoming_bills"][0]
    assert groceries["is_card_repayment"] is False


# ── the shortfall walks agree ───────────────────────────────────────────────

def test_at_risk_count_counts_a_short_card_repayment_but_not_a_short_transfer(monkeypatch):
    repay = _bill("NW WORLD MASTERCAR", 5, 62.22, "cur", 50.0, kind=MOVEMENT)
    repay["is_card_repayment"] = True
    assert _run_at_risk(monkeypatch, [repay], []) == 1
    saving = _bill("Savings pot", 5, 62.22, "cur", 50.0, kind=MOVEMENT)
    assert _run_at_risk(monkeypatch, [saving], []) == 0


def test_gate_recommendation_keeps_a_bounced_card_repayment():
    repay = {"name": "NW WORLD MASTERCAR", "kind": MOVEMENT, "is_card_repayment": True, "days_away": 5, "amount": 62.22}
    saving = {"name": "Savings pot", "kind": MOVEMENT, "days_away": 4, "amount": 10.0}
    args = dict(dest_acct="cur", min_bal=-13.72, shortfall_bill={"cur": saving}, bounced_bills={"cur": [saving, repay]})
    result = _gate_recommendation(**{k: v for k, v in args.items() if k in _gate_recommendation.__code__.co_varnames})
    assert result is repay
    only_saving = _gate_recommendation(**{**{k: v for k, v in args.items() if k in _gate_recommendation.__code__.co_varnames}, "bounced_bills": {"cur": [saving]}})
    assert only_saving is None


# ── never spending, never double counted ────────────────────────────────────

def test_debt_category_is_not_spend():
    assert is_spend({"Debt": MOVEMENT}, "Debt") is False


def test_flag_does_not_change_pooled_safe_to_spend_arithmetic():
    plain = {"days_away": 3, "amount": 62.22, "kind": MOVEMENT, "dest_account_spendable": None}
    flagged = {**plain, "is_card_repayment": True}
    low_plain = analytics._safe_to_spend_lowest_projected_balance(93.49, [plain], [])
    low_flagged = analytics._safe_to_spend_lowest_projected_balance(93.49, [flagged], [])
    assert low_plain == low_flagged
    assert round(low_flagged, 2) == 31.27
