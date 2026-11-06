"""G419 exact card-payment rules: opaque identity and statement safeguards."""
import asyncio
import re
from datetime import date, datetime, timezone

import app.db.collections as collections
import app.services.card_statements as card_statements
import app.services.response_cache as response_cache
from app.services.card_payment_matching import debit_choice, matching_evidence
from app.services.card_statements import (
    estimate_statement,
    normalise_match_rule,
    row_matches_rule,
)
from tests.penny_proposal_fakes import FakeCollection


TODAY = date(2026, 3, 20)
REF_A = "AMERICAN EXPRESS 3799-111111-20001"
REF_B = "AMERICAN EXPRESS 3799-111111-20002"


def _card():
    return {"_id": "card", "type": "credit_card", "subtype": "CREDIT_CARD",
            "currency": "GBP", "balance": -300.0}


def _payer():
    return {"_id": "cash", "type": "bank", "subtype": "TRANSACTION", "currency": "GBP",
            "balance": 5_000.0, "include_in_safe_to_spend": True}


def _row(when, amount, kind="debit", **extra):
    return {"account_id": "cash", "date": when, "amount": amount,
            "transaction_type": kind, "is_pending": False, **extra}


def _terms(rule):
    return {"statement_close_day": 15, "payment_due_days_after_close": 25,
            "payment_due_day": None, "payment_method": "full",
            "payment_account_id": "cash", "fixed_payment_amount": None,
            "payment_match": rule}


def _bill(*rows):
    # The card's pre-close settled movement establishes a statement history.
    all_rows = [{"account_id": "card", "date": date(2026, 2, 16), "amount": 1.0,
                 "transaction_type": "debit", "is_pending": False}, *rows]
    return estimate_statement(_card(), _terms(normalise_match_rule({"kind": "exact", "text": REF_A})),
                              all_rows, {"card": _card(), "cash": _payer()}, TODAY, pairs=[])


def _bill_for(rule, *rows, pairs=()):
    all_rows = [{"account_id": "card", "date": date(2026, 2, 16), "amount": 1.0,
                 "transaction_type": "debit", "is_pending": False}, *rows]
    return estimate_statement(_card(), _terms(normalise_match_rule(rule)), all_rows,
                              {"card": _card(), "cash": _payer()}, TODAY, pairs=list(pairs))


def test_exact_rule_is_whole_description_not_substring_and_keeps_hyphens_significant():
    rule = normalise_match_rule({"kind": "exact", "text": "  American   Express 3799-111111-20001 "})

    assert rule["kind"] == "exact"
    assert rule["text"] == "American Express …20001"
    assert len(rule["fingerprint"]) == 64 and len(rule["salt"]) == 32
    assert row_matches_rule({"description": "american express 3799-111111-20001"}, rule)
    assert row_matches_rule({"description": "AMERICAN  EXPRESS   3799-111111-20001"}, rule)
    assert not row_matches_rule({"description": "AMERICAN EXPRESS 379911111120001"}, rule)
    assert not row_matches_rule({"description": f"PAYMENT {REF_A}"}, rule)


def test_exact_long_number_is_opaque_and_prepared_identity_round_trips():
    prepared = normalise_match_rule({"kind": "exact", "text": REF_A})

    # fingerprint and salt are random hex, so a short digit fragment can match
    # them by coincidence (about 1 in 2,500 runs). Check the human-readable
    # fields for the digits, and the whole structure only for the full raw
    # number, which cannot collide by chance.
    random_fields = {"fingerprint", "salt"}
    assert random_fields <= prepared.keys()
    for field in random_fields:
        assert re.fullmatch(r"[0-9a-f]+", prepared[field])
    readable = {k: v for k, v in prepared.items() if k not in random_fields}
    assert "3799" not in str(readable)
    assert "111111" not in str(readable)
    assert "3799-111111-20001" not in str(prepared)
    assert "3799111111" not in str(prepared)
    assert prepared["text"].endswith("20001")
    unchanged = normalise_match_rule(prepared)
    assert unchanged == prepared
    assert normalise_match_rule({"kind": "exact", "text": prepared["text"]}) is None
    assert normalise_match_rule({"kind": "exact", "text": prepared["text"], "salt": prepared["salt"]}) is None


def test_two_distinct_amex_exact_references_never_conflate():
    first = normalise_match_rule({"kind": "exact", "text": REF_A})
    second = normalise_match_rule({"kind": "exact", "text": REF_B})

    assert first["fingerprint"] != second["fingerprint"]
    assert row_matches_rule({"description": REF_A}, first)
    assert not row_matches_rule({"description": REF_B}, first)
    assert row_matches_rule({"description": REF_B}, second)


def test_exact_settled_arrival_marks_statement_paid_but_wrong_payer_credit_or_pending_does_not():
    paid = _bill(_row(date(2026, 3, 18), 301.0, description=REF_A))
    assert paid["status"] == "paid" and paid["payment_remaining"] == 0.0

    wrong_payer = _bill({"account_id": "other", "date": date(2026, 3, 18), "amount": 301.0,
                         "transaction_type": "debit", "is_pending": False, "description": REF_A})
    credit = _bill(_row(date(2026, 3, 18), 301.0, "credit", description=REF_A))
    pending = _bill(_row(date(2026, 3, 18), 301.0, description=REF_A, is_pending=True))

    for bill in (wrong_payer, credit, pending):
        assert bill["status"] == "estimated"
        assert bill["payment_remaining"] == 300.0


def test_exact_and_contains_ignore_unsettled_or_invalid_payment_rows():
    rules = ({"kind": "exact", "text": REF_A}, {"kind": "contains", "text": "20001"})
    rejected = ["pending", "cancelled", "canceled", "reversed", "failed", "declined", "rejected"]
    invalid_amounts = (0, float("nan"), float("inf"), True)

    for rule in rules:
        for status in rejected:
            bill = _bill_for(rule, _row(date(2026, 3, 18), 301.0, description=REF_A, status=status))
            assert bill["status"] == "estimated", (rule, status)
            assert bill["payment_remaining"] == 300.0
        for amount in invalid_amounts:
            bill = _bill_for(rule, _row(date(2026, 3, 18), amount, description=REF_A))
            assert bill["status"] == "estimated", (rule, amount)
            assert bill["payment_remaining"] == 300.0
        usd = _bill_for(rule, _row(date(2026, 3, 18), 301.0, description=REF_A, currency="USD"))
        assert usd["status"] == "estimated" and usd["payment_remaining"] == 300.0


def test_paired_or_direct_card_credit_cannot_bypass_settlement_or_currency_guards():
    terms = {**_terms({"kind": "contains", "text": "20001"}), "payment_method": "fixed",
             "fixed_payment_amount": 75.0}
    credit = {"account_id": "card", "date": date(2026, 3, 18), "amount": 75.0,
              "transaction_type": "credit", "is_pending": False}
    base = {"account_id": "cash", "date": date(2026, 3, 18), "amount": 75.0,
            "transaction_type": "debit", "is_pending": False, "description": REF_A}

    for bad in ({**base, "status": "reversed"}, {**base, "currency": "USD"}):
        bill = estimate_statement(_card(), terms, [
            {"account_id": "card", "date": date(2026, 2, 16), "amount": 1.0,
             "transaction_type": "debit", "is_pending": False}, credit, bad,
        ], {"card": _card(), "cash": _payer()}, TODAY, pairs=[(credit, bad)])
        assert bill["status"] == "estimated"
        assert bill["paid_since_close"] == 0.0 and bill["payment_remaining"] == 75.0


def test_contains_preserves_the_whole_safe_description_and_rejects_oversized_text():
    prefix = "payment reference " + "x" * 80
    left = prefix + " first-ending"
    right = prefix + " other-ending"
    rule = normalise_match_rule({"kind": "contains", "text": left})

    assert rule == {"kind": "contains", "text": left}
    assert row_matches_rule({"description": left}, rule)
    assert not row_matches_rule({"description": right}, rule)
    assert normalise_match_rule({"kind": "contains", "text": "x" * 241}) is None


def test_debit_choice_uses_full_safe_contains_text_or_an_empty_unsafe_one():
    safe = "annual card payment " + "reference-" * 12
    safe_choice = debit_choice(_row(date(2026, 3, 18), 75.0, description=safe, _id="safe"))
    long_choice = debit_choice(_row(date(2026, 3, 18), 75.0, description="x" * 241, _id="long"))
    masked = debit_choice(_row(date(2026, 3, 18), 75.0, description=REF_A, _id="masked"))

    assert safe_choice["contains_text"] == safe
    assert long_choice["contains_text"] == ""
    assert masked["contains_text"] == "20001"


def test_two_cards_claiming_one_payer_series_are_both_unverified_not_arbitrarily_owned(monkeypatch):
    uid = "g419-conflict@test"
    second_card = {**_card(), "_id": "card-two"}
    shared = _row(datetime(2026, 3, 18, tzinfo=timezone.utc), 301.0, description=REF_A, user_id=uid)
    ledger = FakeCollection([
        {"account_id": "card", "date": datetime(2026, 2, 16, tzinfo=timezone.utc), "amount": 1.0,
         "transaction_type": "debit", "is_pending": False, "user_id": uid},
        {"account_id": "card-two", "date": datetime(2026, 2, 16, tzinfo=timezone.utc), "amount": 1.0,
         "transaction_type": "debit", "is_pending": False, "user_id": uid},
        shared,
    ])
    accounts = FakeCollection([{**_card(), "user_id": uid}, {**second_card, "user_id": uid},
                               {**_payer(), "user_id": uid}])
    monkeypatch.setattr(collections, "accounts_col", accounts)
    monkeypatch.setattr(collections, "transactions_col", ledger)
    monkeypatch.setattr(collections, "pending_transactions_col", FakeCollection())
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCollection())
    monkeypatch.setattr(collections, "preferences_col", FakeCollection())

    async def no_cached(*_args, **_kwargs):
        return None

    async def snapshot(*_args, **_kwargs):
        return 1

    async def stored(*_args, **_kwargs):
        return None

    monkeypatch.setattr(response_cache, "aget", no_cached)
    monkeypatch.setattr(response_cache, "snapshot", snapshot)
    monkeypatch.setattr(response_cache, "aput", stored)
    terms = {"card": _terms({"kind": "contains", "text": "20001"}),
             "card-two": _terms({"kind": "contains", "text": "20001"})}

    bills = asyncio.run(card_statements.load_statement_bills(
        uid, cards=[_card(), second_card], terms=terms, today=TODAY))

    assert set(bills) == {"card", "card-two"}
    assert all(bill["status"] == "payment_unverified" for bill in bills.values())
    assert all(bill["rule_conflict"] is True for bill in bills.values())
    assert all(bill["payment_remaining"] is None for bill in bills.values())


def test_latest_evidence_uses_booking_time_not_identifier_order():
    from datetime import datetime, timezone
    older = _row(date(2026, 3, 18), 10.0, description="card bill", _id="zzz")
    newer = _row(date(2026, 3, 18), 25.0, description="card bill", _id="aaa")
    older["date"] = datetime(2026, 3, 18, 8, tzinfo=timezone.utc)
    newer["date"] = datetime(2026, 3, 18, 15, tzinfo=timezone.utc)
    evidence = matching_evidence([older, newer], {"kind": "contains", "text": "card bill"},
                                 {"from": "2025-09-20", "through": "2026-03-20", "history_from": "2025-09-20", "history_complete": True})
    assert evidence["latest"]["amount"] == -25.0
