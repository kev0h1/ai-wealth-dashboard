"""G413: a user-defined match rule links a card's defined bill to the paying
account's own payment, so the defined bill replaces that payment, arrival marks
it paid, and nothing is ever counted twice. Invented references and amounts."""
import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.card_terms import (
    CardTermsBody, PaymentMatch, _validate_payment_settings, normalise_payment_settings,
)
from app.services.card_statements import (
    apply_statement_bills, estimate_statement, normalise_match_rule, row_matches_rule,
)

TODAY = date(2026, 3, 20)
REF_A = "AMERICAN EXPRESS 3799-111111-20001"
REF_B = "AMERICAN EXPRESS 3799-111111-20002"


def _card(account_id="card", balance=-300.0):
    return {"_id": account_id, "name": "Example Card", "provider": "amex",
            "type": "credit_card", "subtype": "CREDIT_CARD", "balance": balance}


def _payer():
    return {"_id": "cash", "name": "Example Current", "provider": "natwest", "type": "bank",
            "subtype": "TRANSACTION", "currency": "GBP", "balance": 5000, "include_in_safe_to_spend": True}


def _terms(**changes):
    terms = {"statement_close_day": 15, "payment_due_days_after_close": 25, "payment_due_day": None,
             "payment_method": "full", "payment_account_id": "cash", "fixed_payment_amount": None,
             "payment_match": {"kind": "contains", "text": "20001"}}
    terms.update(changes)
    return terms


def _row(account_id, when, amount, kind, **extra):
    return {"account_id": account_id, "date": when, "amount": amount, "transaction_type": kind,
            "is_pending": False, **extra}


def _rows(*extra):
    return [_row("card", date(2026, 2, 16), 1.0, "debit"), *extra]


def _estimate(rows, terms=None):
    accounts = {"card": _card(), "cash": _payer()}
    return estimate_statement(_card(), terms or _terms(), rows, accounts, TODAY, pairs=[])


def test_rule_shapes_are_validated_and_normalised():
    assert normalise_match_rule({"kind": "contains", "text": "  20001 "}) == {"kind": "contains", "text": "20001"}
    assert normalise_match_rule({"kind": "contains", "text": "ab"}) is None
    assert normalise_match_rule({"kind": "payment", "series_key": "American Express 20001", "label": "AMEX DD"}) == {
        "kind": "payment", "series_key": "American Express 20001", "label": "AMEX DD"}
    assert normalise_match_rule({"kind": "payment"}) is None
    assert normalise_match_rule(None) is None and normalise_match_rule("20001") is None


def test_contains_ignores_spacing_and_hyphens_and_payment_kind_uses_the_series():
    row = {"description": REF_A, "merchant_name": "American Express"}
    assert row_matches_rule(row, {"kind": "contains", "text": "3799 111111 20001"})
    assert not row_matches_rule(row, {"kind": "contains", "text": "20002"})
    assert row_matches_rule(row, {"kind": "payment", "series_key": "American Express 20001"})
    assert not row_matches_rule(row, {"kind": "payment", "series_key": "American Express 20002"})


def test_rule_series_keys_cover_only_the_matching_payment_series():
    bill = _estimate(_rows(
        _row("cash", date(2026, 2, 9), 120.0, "debit", description=REF_A, merchant_name="American Express"),
        _row("cash", date(2026, 2, 9), 75.0, "debit", description=REF_B, merchant_name="American Express"),
    ))
    assert bill["rule_series_keys"] == ["American Express 20001"]
    assert bill["rule_status"] == "matched"


def test_defined_bill_replaces_its_matching_series_and_keeps_the_other_card_series():
    statement = _estimate(_rows(
        _row("cash", date(2026, 2, 9), 120.0, "debit", description=REF_A, merchant_name="American Express"),
    ))
    accounts = {"card": _card(), "cash": _payer()}
    raw = [
        # Learned from the paying account, attributed to the WRONG card by the
        # old merged-series bug: the rule still claims it for this card.
        {"name": "American Express 20001", "account_id": "cash", "card_dest_account_id": "other"},
        {"name": "American Express 20002", "account_id": "cash", "card_dest_account_id": "other"},
    ]
    applied, resolved = apply_statement_bills(raw, {"card": statement}, accounts, TODAY, date(2026, 4, 30))
    assert resolved == {"card"}
    names = [b["name"] for b in applied]
    assert "American Express 20001" not in names           # replaced, never doubled
    assert "American Express 20002" in names               # the other card's series is untouched
    assert sum(1 for b in applied if b["name"].startswith("card-statement:")) == 1


def test_a_series_from_another_account_is_never_claimed_by_the_rule():
    statement = _estimate(_rows(
        _row("cash", date(2026, 2, 9), 120.0, "debit", description=REF_A, merchant_name="American Express"),
    ))
    accounts = {"card": _card(), "cash": _payer()}
    raw = [{"name": "American Express 20001", "account_id": "elsewhere"}]
    applied, _ = apply_statement_bills(raw, {"card": statement}, accounts, TODAY, date(2026, 4, 30))
    assert [b["name"] for b in applied if not b["name"].startswith("card-statement:")] == ["American Express 20001"]


def test_arrival_of_a_matching_payment_marks_the_bill_paid_and_leaves_no_bill():
    rows = _rows(
        _row("cash", date(2026, 2, 9), 120.0, "debit", description=REF_A, merchant_name="American Express"),
        _row("cash", date(2026, 3, 18), 301.0, "debit", description=REF_A, merchant_name="American Express"),
    )
    statement = _estimate(rows)
    assert statement["status"] == "paid" and statement["payment_remaining"] == 0.0
    accounts = {"card": _card(), "cash": _payer()}
    raw = [{"name": "American Express 20001", "account_id": "cash"}]
    applied, resolved = apply_statement_bills(raw, {"card": statement}, accounts, TODAY, date(2026, 4, 30))
    assert resolved == {"card"} and applied == []


def test_a_payment_that_does_not_match_the_rule_does_not_mark_it_paid():
    rows = _rows(_row("cash", date(2026, 3, 18), 301.0, "debit", description=REF_B, merchant_name="American Express"))
    statement = _estimate(rows)
    assert statement["status"] == "estimated" and statement["payment_remaining"] == 300.0


def test_a_matching_payment_before_the_close_is_last_cycles_and_does_not_mark_this_one_paid():
    rows = _rows(_row("cash", date(2026, 3, 10), 301.0, "debit", description=REF_A, merchant_name="American Express"))
    assert _estimate(rows)["status"] == "estimated"


def test_unmatched_rule_is_reported_quietly_only_with_enough_history():
    old_other = _row("cash", date(2026, 1, 10), 50.0, "debit", description="COUNCIL TAX")
    assert _estimate(_rows(old_other))["rule_status"] == "unmatched"
    assert _estimate(_rows(_row("cash", date(2026, 3, 1), 50.0, "debit", description="COUNCIL TAX")))["rule_status"] == "unknown"


def test_without_a_rule_g412_attribution_behaves_exactly_as_before():
    statement = _estimate(_rows(), terms=_terms(payment_match=None))
    assert "rule_series_keys" not in statement and "rule_status" not in statement
    accounts = {"card": _card(), "cash": _payer()}
    raw = [{"name": "learned card", "account_id": "cash", "card_dest_account_id": "card"},
           {"name": "American Express 20001", "account_id": "cash"}]
    applied, _ = apply_statement_bills(raw, {"card": statement}, accounts, TODAY, date(2026, 4, 30))
    assert [b["name"] for b in applied if not b["name"].startswith("card-statement:")] == ["American Express 20001"]


def test_route_validation_needs_the_paying_account_and_a_usable_rule():
    base = {"statement_close_day": None, "payment_due_day": None, "payment_due_days_after_close": None,
            "payment_method": None, "payment_account_id": None, "fixed_payment_amount": None}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_validate_payment_settings("kev", {**base, "payment_match": {"kind": "contains", "text": "20001"}}))
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_validate_payment_settings("kev", {**base, "payment_match": {"kind": "contains", "text": "x"}}))
    assert exc.value.status_code == 400
    assert asyncio.run(_validate_payment_settings("kev", {**base, "payment_match": None}))["payment_match"] is None


def test_body_merge_keeps_an_existing_rule_and_lets_null_clear_it():
    existing = {"payment_match": {"kind": "contains", "text": "20001"}}
    keep = normalise_payment_settings(existing, CardTermsBody(status="confirmed"))
    assert keep["payment_match"] == {"kind": "contains", "text": "20001"}
    clear = normalise_payment_settings(existing, CardTermsBody(status="confirmed", payment_match=None))
    assert clear["payment_match"] is None
    new = normalise_payment_settings({}, CardTermsBody(status="confirmed", payment_match=PaymentMatch(kind="payment", series_key="K")))
    assert new["payment_match"] == {"kind": "payment", "series_key": "K"}


# ── route round trip and the recent-payments picker ──────────────────────────
from datetime import datetime, timedelta, timezone

import app.db.collections as collections
import app.routers.analytics as analytics
import app.routers.card_terms as card_terms
from tests.penny_proposal_fakes import FakeCollection

UID = "g413@example.test"
USER = {"email": UID}
CARD_ID, SOURCE_ID = "card-1", "current-1"


@pytest.fixture
def stores(monkeypatch):
    accounts = FakeCollection([
        {"_id": CARD_ID, "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"},
        {"_id": SOURCE_ID, "user_id": UID, "type": "bank", "subtype": "TRANSACTION", "currency": "GBP"},
    ])
    terms = FakeCollection()

    async def refresh(uid):
        return None

    monkeypatch.setattr(card_terms, "accounts_col", accounts)
    monkeypatch.setattr(card_terms, "card_terms_col", terms)
    monkeypatch.setattr(analytics, "_refresh_after_override", refresh)
    return accounts, terms


def _save(body):
    return asyncio.run(card_terms.save_card_terms(CARD_ID, body, USER))


def test_saving_a_rule_round_trips_and_a_legacy_save_keeps_it(stores):
    _accounts, terms = stores
    saved = _save(CardTermsBody(status="confirmed", payment_account_id=SOURCE_ID,
                                payment_match=PaymentMatch(kind="contains", text=" 20001 ")))
    assert saved["terms"]["payment_match"] == {"kind": "contains", "text": "20001"}
    assert terms.docs[0]["payment_match"] == {"kind": "contains", "text": "20001"}
    again = _save(CardTermsBody(status="confirmed", apr_pct=19.9))
    assert again["terms"]["payment_match"] == {"kind": "contains", "text": "20001"}
    cleared = _save(CardTermsBody(status="confirmed", payment_match=None))
    assert cleared["terms"]["payment_match"] is None


def test_a_rule_without_a_paying_account_is_refused_and_nothing_is_saved(stores):
    _accounts, terms = stores
    with pytest.raises(HTTPException) as exc:
        _save(CardTermsBody(status="confirmed", payment_match=PaymentMatch(kind="contains", text="20001")))
    assert exc.value.status_code == 422
    assert terms.docs == []


def test_recent_payments_lists_one_row_per_series_for_the_users_own_payer(stores, monkeypatch):
    now = datetime.now(timezone.utc)
    def tx(days, description, amount, account=SOURCE_ID, user=UID, kind="debit"):
        return {"user_id": user, "account_id": account, "transaction_type": kind, "amount": amount,
                "date": now - timedelta(days=days), "description": description, "merchant_name": "American Express"}
    txns = FakeCollection([
        tx(40, REF_A, 120.0), tx(10, REF_A, 130.0), tx(12, REF_B, 75.0),
        tx(5, REF_A, 99.0, user="someone-else@example.test"),
        tx(3, "SALARY", 2000.0, kind="credit"),
    ])
    monkeypatch.setattr(collections, "transactions_col", txns)
    result = asyncio.run(card_terms.recent_payer_payments(CARD_ID, SOURCE_ID, USER))
    keys = [p["series_key"] for p in result["payments"]]
    assert keys == ["American Express 20001", "American Express 20002"]
    assert result["payments"][0]["last_amount"] == 130.0
    with pytest.raises(HTTPException) as exc:
        asyncio.run(card_terms.recent_payer_payments(CARD_ID, CARD_ID, USER))
    assert exc.value.status_code == 422


# ── review fixes: ambiguity, stamped-key robustness, privacy ─────────────────
from app.services.card_statements import mask_long_digits

STAMP_ID = "64f1a2b3c4d5e6f708192a3b"
STAMP = {"card_repayment": {"issuer": "american_express", "card_account_id": STAMP_ID}}


def _estimate_with(rows, terms, series_cards=None):
    accounts = {"card": _card(), "cash": _payer()}
    return estimate_statement(_card(), terms, rows, accounts, TODAY, pairs=[], series_cards=series_cards)


def _two_card_rows():
    return _rows(
        _row("cash", date(2026, 2, 9), 120.0, "debit", description=REF_A, merchant_name="American Express"),
        _row("cash", date(2026, 2, 9), 75.0, "debit", description=REF_B, merchant_name="American Express"),
    )


def test_a_short_rule_matching_both_cards_claims_nothing_and_reports_unmatched():
    terms = _terms(payment_match={"kind": "contains", "text": "3799"})
    bill = _estimate_with(_two_card_rows(), terms)
    assert bill["rule_series_keys"] == [] and bill["rule_status"] == "unmatched"
    accounts = {"card": _card(), "cash": _payer()}
    raw = [{"name": "American Express 20001", "account_id": "cash"}, {"name": "American Express 20002", "account_id": "cash"}]
    applied, _ = apply_statement_bills(raw, {"card": bill}, accounts, TODAY, date(2026, 4, 30))
    assert [b["name"] for b in applied if not b["name"].startswith("card-statement:")] == [
        "American Express 20001", "American Express 20002"], "an ambiguous rule never hides a bill"


def test_an_ambiguous_rule_narrows_to_the_series_no_other_card_owns():
    terms = _terms(payment_match={"kind": "contains", "text": "3799"})
    bill = _estimate_with(_two_card_rows(), terms, series_cards={"American Express 20002": "other-card"})
    assert bill["rule_series_keys"] == ["American Express 20001"] and bill["rule_status"] == "matched"
    both_ours = _estimate_with(_two_card_rows(), terms, series_cards={"American Express 20001": "card", "American Express 20002": "card"})
    assert both_ours["rule_series_keys"] == [] and both_ours["rule_status"] == "unmatched"


def test_a_payment_rule_saved_as_a_tail_key_still_matches_once_the_payment_is_stamped():
    rule = {"kind": "payment", "series_key": "American Express 20001"}
    stamped = _row("cash", date(2026, 3, 18), 301.0, "debit", description=REF_A, merchant_name="American Express",
                   own_transfer_match=STAMP)
    bill = _estimate_with(_rows(stamped), _terms(payment_match=rule))
    assert bill["status"] == "paid" and bill["payment_remaining"] == 0.0
    stamp_key = f"American Express {STAMP_ID}"
    assert stamp_key in bill["rule_series_keys"] and "American Express 20001" in bill["rule_series_keys"]
    accounts = {"card": _card(), "cash": _payer()}
    applied, _ = apply_statement_bills([{"name": stamp_key, "account_id": "cash"}], {"card": bill}, accounts, TODAY, date(2026, 4, 30))
    assert applied == [], "the learned series now named by the stamp is still the one the rule claims"


def test_a_payment_rule_saved_as_a_stamp_key_matches_an_unstamped_row_with_the_card_number():
    rule = {"kind": "payment", "series_key": f"American Express {STAMP_ID}"}
    stamped = _row("cash", date(2026, 3, 18), 301.0, "debit", description=REF_A, merchant_name="American Express",
                   own_transfer_match=STAMP)
    assert _estimate_with(_rows(stamped), _terms(payment_match=rule))["status"] == "paid"


def test_long_digit_runs_are_masked_in_any_stored_or_shown_label():
    assert mask_long_digits("AMERICAN EXPRESS 3799-111111-20001") == "AMERICAN EXPRESS …20001"
    assert mask_long_digits("REF 3799 1111 1111 2000 1 x") == "REF …20001 x"
    assert mask_long_digits("order 20001 on 12/03") == "order 20001 on 12/03"
    saved = normalise_match_rule({"kind": "payment", "series_key": "K", "label": "AMERICAN EXPRESS 3799-111111-20001"})
    assert saved["label"] == "AMERICAN EXPRESS …20001" and "3799" not in saved["label"]


def test_the_recent_payments_picker_masks_card_numbers(stores, monkeypatch):
    now = datetime.now(timezone.utc)
    txns = FakeCollection([{"user_id": UID, "account_id": SOURCE_ID, "transaction_type": "debit", "amount": 120.0,
                            "date": now - timedelta(days=5), "description": REF_A, "merchant_name": "American Express"}])
    monkeypatch.setattr(collections, "transactions_col", txns)
    result = asyncio.run(card_terms.recent_payer_payments(CARD_ID, SOURCE_ID, USER))
    assert result["payments"][0]["label"] == "AMERICAN EXPRESS …20001"
    assert "3799" not in str(result)


def test_penny_summary_never_echoes_a_pasted_card_number():
    from app.services.penny_tools import _describe_card_terms_changes
    text = _describe_card_terms_changes({"payment_match": {"kind": "contains", "text": "3799-111111-20001"}})
    assert "…20001" in text and "3799" not in text
