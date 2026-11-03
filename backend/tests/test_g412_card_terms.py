"""G412 statement facts and payment-source persistence contract."""
import asyncio
from copy import deepcopy

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import app.routers.analytics as analytics
import app.routers.card_terms as card_terms
import app.services.card_statements as card_statements
from tests.penny_proposal_fakes import FakeCollection


UID = "g412@example.test"
USER = {"email": UID}
CARD_ID = "card-1"
SOURCE_ID = "current-1"


def _card(**extra):
    return {
        "_id": CARD_ID,
        "user_id": UID,
        "type": "credit_card",
        "subtype": "CREDIT_CARD",
        "currency": "GBP",
        **extra,
    }


def _current(**extra):
    return {
        "_id": SOURCE_ID,
        "user_id": UID,
        "type": "bank",
        "subtype": "TRANSACTION",
        "currency": "GBP",
        **extra,
    }


@pytest.fixture
def stores(monkeypatch):
    accounts = FakeCollection([_card(), _current()])
    terms = FakeCollection()
    refreshed = []

    async def refresh(uid):
        refreshed.append(uid)

    monkeypatch.setattr(card_terms, "accounts_col", accounts)
    monkeypatch.setattr(card_terms, "card_terms_col", terms)
    monkeypatch.setattr(analytics, "_refresh_after_override", refresh)
    return accounts, terms, refreshed


def _save(body):
    return asyncio.run(card_terms.save_card_terms(CARD_ID, body, USER))


def test_legacy_save_preserves_payment_settings_and_refreshes(stores):
    _accounts, terms, refreshed = stores
    terms.docs.append({
        "_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
        "apr_pct": 19.9, "promos": [], "bt_offers": [], "status": "confirmed",
        "statement_close_day": 15, "payment_due_days_after_close": 25,
        "payment_method": "full", "payment_account_id": SOURCE_ID,
        "fixed_payment_amount": None,
    })

    result = _save(card_terms.CardTermsBody(apr_pct=21.9))

    saved = terms.docs[0]
    assert result["terms"]["payment_method"] == "full"
    assert saved["statement_close_day"] == 15
    assert saved["payment_due_days_after_close"] == 25
    assert saved["payment_account_id"] == SOURCE_ID
    assert saved["usage"] == "clear_monthly"
    assert refreshed == [UID]


def test_legacy_apr_save_needs_no_payment_source(stores):
    _accounts, terms, _refreshed = stores

    result = _save(card_terms.CardTermsBody(apr_pct=21.9))

    assert result["terms"]["apr_pct"] == 21.9
    assert terms.docs[0]["payment_account_id"] is None


def test_legacy_apr_save_keeps_a_removed_payer_without_revalidating_it(stores):
    accounts, terms, _refreshed = stores
    accounts.docs = [_card()]
    terms.docs.append({
        "_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
        "apr_pct": 19.9, "promos": [], "bt_offers": [], "status": "confirmed",
        "statement_close_day": 15, "payment_due_days_after_close": 25,
        "payment_method": "full", "payment_account_id": "disconnected-account",
    })

    _save(card_terms.CardTermsBody(apr_pct=21.9))

    assert terms.docs[0]["apr_pct"] == 21.9
    assert terms.docs[0]["payment_account_id"] == "disconnected-account"


def test_explicit_null_clears_only_the_named_statement_fields(stores):
    _accounts, terms, _refreshed = stores
    terms.docs.append({
        "_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
        "statement_close_day": 15, "payment_due_day": 9,
        "payment_method": "minimum", "payment_account_id": SOURCE_ID,
    })

    _save(card_terms.CardTermsBody(
        apr_pct=20.0,
        statement_close_day=None,
        payment_due_day=None,
    ))

    saved = terms.docs[0]
    assert saved["statement_close_day"] is None
    assert saved["payment_due_day"] is None
    assert saved["payment_method"] == "minimum"
    assert saved["payment_account_id"] == SOURCE_ID


def test_due_rules_are_mutually_exclusive_without_a_partial_write(stores):
    _accounts, terms, _refreshed = stores

    with pytest.raises(HTTPException, match="choose either"):
        _save(card_terms.CardTermsBody(
            statement_close_day=1,
            payment_due_day=15,
            payment_due_days_after_close=25,
        ))

    assert terms.docs == []


def test_partial_statement_dates_can_be_saved_without_claiming_a_bill(stores, monkeypatch):
    _accounts, terms, _refreshed = stores
    calls = []

    async def loader(*_args, **_kwargs):
        calls.append(True)
        return {}

    monkeypatch.setattr(card_statements, "load_statement_bills", loader)

    result = _save(card_terms.CardTermsBody(statement_close_day=15))

    assert result["terms"]["statement_close_day"] == 15
    assert result["terms"]["payment_due_day"] is None
    assert terms.docs[0]["payment_due_days_after_close"] is None
    assert asyncio.run(card_terms.list_card_terms(USER))["cards"][0]["statement_bill"] is None
    assert calls == []


@pytest.mark.parametrize("source", [
    _card(_id="other-card"),
    _current(currency="USD"),
    _current(include_in_safe_to_spend=False),
    _current(_id="other-user", user_id="somebody-else"),
    {"_id": "savings", "user_id": UID, "type": "bank", "subtype": "SAVINGS", "currency": "GBP"},
])
def test_payment_source_must_be_an_owned_counted_gbp_current_account(stores, source):
    accounts, terms, _refreshed = stores
    accounts.docs = [_card(), deepcopy(source)]
    source_id = str(source["_id"])

    with pytest.raises(HTTPException):
        _save(card_terms.CardTermsBody(payment_account_id=source_id))

    assert terms.docs == []


def test_business_charge_card_can_use_a_personal_current_account(stores):
    accounts, terms, _refreshed = stores
    accounts.docs[0] = _card(account_class="charge_card", business=True)

    _save(card_terms.CardTermsBody(
        statement_close_day=1,
        payment_due_days_after_close=25,
        payment_method="fixed",
        fixed_payment_amount=75.0,
        payment_account_id=SOURCE_ID,
    ))

    saved = terms.docs[0]
    assert saved["payment_account_id"] == SOURCE_ID
    assert saved["usage"] == "carry"


def test_non_gbp_cards_can_save_apr_but_not_a_full_or_fixed_cash_instruction(stores):
    accounts, terms, _refreshed = stores
    accounts.docs[0] = _card(currency="USD")

    _save(card_terms.CardTermsBody(apr_pct=21.9))
    assert terms.docs[0]["apr_pct"] == 21.9

    with pytest.raises(HTTPException, match="GBP card"):
        _save(card_terms.CardTermsBody(
            payment_method="full",
            payment_account_id=SOURCE_ID,
        ))

    # The rejected instruction did not replace the saved APR answer.
    assert terms.docs[0]["apr_pct"] == 21.9


def test_fixed_payment_and_day_inputs_are_strict_and_finite(stores):
    _accounts, terms, _refreshed = stores
    with pytest.raises(ValidationError):
        card_terms.CardTermsBody(statement_close_day=1.5)
    with pytest.raises(ValidationError):
        card_terms.CardTermsBody(payment_method="fixed", fixed_payment_amount=True)
    with pytest.raises(HTTPException, match="fixed_payment_amount"):
        _save(card_terms.CardTermsBody(payment_method="fixed", fixed_payment_amount=float("nan")))
    with pytest.raises(HTTPException, match="fixed_payment_amount"):
        _save(card_terms.CardTermsBody(payment_method="fixed", fixed_payment_amount=0))
    assert terms.docs == []


def test_skipping_terms_preserves_existing_statement_and_payment_facts(stores):
    _accounts, terms, _refreshed = stores
    terms.docs.append({
        "_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
        "statement_close_day": 15, "payment_due_day": 9,
        "payment_method": "manual", "payment_account_id": SOURCE_ID,
    })

    result = _save(card_terms.CardTermsBody(status="skipped"))

    assert result["terms"]["status"] == "skipped"
    assert result["terms"]["statement_close_day"] == 15
    assert result["terms"]["payment_due_day"] == 9
    assert result["terms"]["payment_method"] == "manual"
    assert terms.docs[0]["payment_account_id"] == SOURCE_ID


def test_list_attaches_a_statement_bill_but_keeps_terms_readable_if_it_fails(stores, monkeypatch):
    _accounts, terms, _refreshed = stores
    terms.docs.append({
        "_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
        "statement_close_day": 15, "payment_due_days_after_close": 25,
        "payment_method": "manual",
    })

    async def bill(*_args, **_kwargs):
        return {CARD_ID: {"status": "payment_unverified", "estimated_bill": 120.0}}

    monkeypatch.setattr(card_statements, "load_statement_bills", bill)
    response = asyncio.run(card_terms.list_card_terms(USER))
    assert response["cards"][0]["statement_bill"]["estimated_bill"] == 120.0

    async def unavailable(*_args, **_kwargs):
        raise RuntimeError("temporary read failure")

    monkeypatch.setattr(card_statements, "load_statement_bills", unavailable)
    response = asyncio.run(card_terms.list_card_terms(USER))
    assert response["cards"][0]["terms"]["statement_close_day"] == 15
    assert response["cards"][0]["statement_bill"] is None


@pytest.mark.parametrize(("stored", "expected"), [("charge_card", "charge_card"), ("Credit_Card", "credit_card"), (None, None)])
def test_list_exposes_the_stored_card_class_and_never_guesses_from_the_name(stores, stored, expected):
    accounts, _terms, _refreshed = stores
    accounts.docs[0].update(name="Business Charge Card", finexer_class=stored)
    response = asyncio.run(card_terms.list_card_terms(USER))
    assert response["cards"][0]["card_class"] == expected
