"""Corrections must survive income filtering and confirmed fallback."""
from datetime import datetime, timedelta

from app.services.income_evidence import select_income_evidence
from app.services.income_payer import payer_key


def credit(account="monzo", category="Income", **extra):
    return {"merchant_name": "TEST", "description": "TEST", "account_id": account,
            "transaction_type": "credit", "category": category, "date": datetime(2026, 10, 30),
            "amount": 320, **extra}


def test_latest_correction_suppresses_old_income_only_on_its_account():
    older = credit(date=datetime(2026, 9, 30))
    correction = credit(custom_category="Transfer", custom_category_at=datetime(2026, 10, 31))
    separate = credit(account="barclays")
    evidence = select_income_evidence([older, correction, separate])
    assert evidence.credits == [separate]
    assert evidence.blocked == {payer_key(correction)}
    # Account-specific confirmations cannot alias across to the real income.
    streams = {payer_key(older): {}, payer_key(separate): {}}
    assert evidence.confirmed(streams) == {payer_key(separate): {}}
    # A legacy confirmation without account information cannot move its
    # schedule from the corrected account onto another same-named payer.
    assert evidence.confirmed({"TEST": {}}) == {}


def test_later_income_correction_restores_without_mutating_transfer_rows():
    transfer = credit(custom_category="Transfer", custom_category_at=datetime(2026, 10, 30))
    income = credit(date=datetime(2026, 9, 30), custom_category="Income",
                    custom_category_at=datetime(2026, 10, 31))
    evidence = select_income_evidence([transfer, income])
    assert evidence.credits == [income]
    assert not evidence.blocked
    assert transfer["custom_category"] == "Transfer"


def test_old_correction_still_governs_a_newer_uncorrected_row():
    corrected = credit(date=datetime(2026, 7, 1), custom_category="Transfer")
    assert not select_income_evidence([corrected, credit()]).credits


def test_corrected_raw_and_token_alias_confirmations_cannot_return():
    evidence = select_income_evidence([credit(custom_category="Transfer")])
    streams = {"TEST": {}, "0001 TEST BGC": {}, "OTHER COMPANY": {}, "manual": {}}
    assert evidence.confirmed(streams) == {"OTHER COMPANY": {}, "manual": {}}
    assert set(streams) == {"TEST", "0001 TEST BGC", "OTHER COMPANY", "manual"}


def test_no_evidence_or_provider_other_does_not_cancel_confirmed_salary():
    streams = {"TEST": {"status": "confirmed"}}
    assert select_income_evidence([]).confirmed(streams) == streams
    assert select_income_evidence([credit(category="Other")]).confirmed(streams) == streams
    assert select_income_evidence([credit(category=None)]).confirmed(streams) == streams


def test_validated_own_transfers_cannot_resurrect_but_do_not_teach_other_receipts():
    # These are copies after resolve_transfer_evidence has checked both legs.
    moves = [credit(category="Transfer", own_transfer_match={"counterpart_id": str(i)},
                    date=datetime(2026, 10, 30) - timedelta(days=14 * i)) for i in range(3)]
    evidence = select_income_evidence(moves)
    assert not evidence.credits
    assert not evidence.confirmed({"TEST": {}})
    real_income = credit()
    mixed = select_income_evidence(moves + [real_income])
    assert mixed.credits == [real_income]
    assert mixed.confirmed({"TEST": {}}) == {"TEST": {}}


def test_debit_or_pending_correction_cannot_cancel_booked_income():
    salary = credit()
    debit = credit(transaction_type="debit", custom_category="Transfer")
    pending = credit(is_pending=True, custom_category="Transfer")
    evidence = select_income_evidence([salary, debit, pending])
    assert evidence.credits == [salary]
    assert not evidence.blocked


def test_custom_non_income_correction_cannot_seed_income():
    for category in ["My transfers", "Not counted", "Savings", "Shopping"]:
        assert not select_income_evidence([credit(), credit(custom_category=category)]).credits
