"""The account picker must expose only sources the settled cover engine reads."""

import asyncio

import app.routers.accounts as accounts_router
import app.services.companion as companion
from app.services.card_rates import is_credit_card_account


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    async def to_list(self, _limit=None):
        return list(self.docs)


class _Collection:
    def __init__(self, docs=()):
        self.docs = list(docs)

    def find(self, query=None, projection=None):
        query = query or {}
        matches = [
            doc for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ]
        return _Cursor(matches)

    async def count_documents(self, query=None):
        query = query or {}
        return sum(
            all(doc.get(key) == value for key, value in query.items())
            for doc in self.docs
        )


def _account(account_id, *, name, subtype="TRANSACTION"):
    return {
        "_id": account_id,
        "user_id": "kevin",
        "name": name,
        "type": "bank",
        "subtype": subtype,
        "balance": 100,
        "currency": "GBP",
        "provider": "Test Bank",
        "status": "connected",
    }


def test_manual_accounts_keep_real_class_and_credit_is_ineligible():
    savings = accounts_router._manual_to_account(
        {"_id": "cash", "name": "Cash reserve", "account_type": "savings", "balance": 90},
        "GBP",
    )
    current = accounts_router._manual_to_account(
        {"_id": "wallet", "name": "Travel wallet", "account_type": "current", "balance": 40},
        "GBP",
    )
    credit = accounts_router._manual_to_account(
        {"_id": "card", "name": "Manual card", "account_type": "credit_card", "balance": 30},
        "GBP",
    )

    assert (savings.subtype, savings.manual, savings.cover_source_eligible) == ("SAVINGS", True, True)
    assert (current.subtype, current.manual, current.cover_source_eligible) == ("TRANSACTION", True, True)
    assert (credit.subtype, credit.manual, credit.cover_source_eligible) == ("CREDIT_CARD", True, False)


def test_uk_account_listing_marks_engine_sources_and_statement_accounts(monkeypatch):
    async def uk_region(_uid):
        return "UK"

    monkeypatch.setattr(accounts_router, "get_user_region", uk_region)
    monkeypatch.setattr(
        accounts_router,
        "accounts_col",
        _Collection([_account("linked", name="Linked current")]),
    )
    monkeypatch.setattr(
        accounts_router,
        "statement_accounts_col",
        _Collection([{
            **_account("statement", name="Uploaded statement"),
            "region": "UK",
        }]),
    )
    monkeypatch.setattr(
        accounts_router,
        "yapily_consents_col",
        _Collection([{"user_id": "kevin", "status": "AUTHORIZED"}]),
    )
    monkeypatch.setattr(
        accounts_router,
        "yapily_accounts_col",
        _Collection([{
            **_account("yapily", name="Open banking savings", subtype="SAVINGS"),
            "institution_id": "Open Bank",
            "consent": "consent-1",
        }]),
    )
    monkeypatch.setattr(
        accounts_router,
        "manual_accounts_col",
        _Collection([{
            "_id": "manual",
            "user_id": "kevin",
            "name": "Cash reserve",
            "account_type": "savings",
            "balance": 50,
        }]),
    )
    monkeypatch.setattr(accounts_router, "account_rates_col", _Collection())

    result = asyncio.run(accounts_router.get_accounts({"email": "kevin"}))
    eligibility = {account.id: account.cover_source_eligible for account in result}

    assert eligibility == {
        "linked": True,
        "statement": False,
        "yapily": True,
        "manual": True,
    }


def test_uk_credit_card_eligibility_matches_the_real_engine_classifier(monkeypatch):
    """G55: `cover_source_eligible` on a TrueLayer/Finexer doc must mean
    exactly what companion.py's `source_capacity` build means, so the
    Settings toggle list and the engine agree by construction rather than
    by coincidence of the current account taxonomy.

    Pins the two together via the SAME classifier both call
    (`is_credit_card_account` from `app.services.card_rates`) rather than
    restating the credit-detection rule (a subtype/type string match) here
    -- if either side's exclusion test ever changes, this test changes
    with it instead of silently going stale.
    """
    async def uk_region(_uid):
        return "UK"

    credit_doc = {**_account("cc", name="Amex Platinum", subtype="CREDIT_CARD"), "type": "credit_card"}
    current_doc = _account("current", name="Everyday current")
    savings_doc = _account("savings", name="Rainy day", subtype="SAVINGS")

    monkeypatch.setattr(accounts_router, "get_user_region", uk_region)
    monkeypatch.setattr(
        accounts_router, "accounts_col",
        _Collection([credit_doc, current_doc, savings_doc]),
    )
    monkeypatch.setattr(accounts_router, "statement_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "yapily_consents_col", _Collection())
    monkeypatch.setattr(accounts_router, "yapily_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "manual_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "account_rates_col", _Collection())

    result = asyncio.run(accounts_router.get_accounts({"email": "kevin"}))
    eligibility = {account.id: account.cover_source_eligible for account in result}

    # Sanity: the fixtures actually exercise both sides of the real
    # classifier before trusting any conclusion drawn from it.
    assert is_credit_card_account(credit_doc) is True
    assert is_credit_card_account(current_doc) is False
    assert is_credit_card_account(savings_doc) is False

    # The account the real engine classifier excludes from
    # `source_capacity` (companion.py: `if is_credit_card_account(acc):
    # continue`) must not be offered on Settings.
    assert eligibility["cc"] is False
    # The accounts it does NOT exclude on that test must be offered, and
    # must also actually clear the type-inclusion gate `source_capacity`
    # additionally applies (`_is_current(acc) or _is_savings(acc) or
    # _is_offline(acc)`), so a "true" here really does mean "the engine
    # would consider this account a source", not merely "not a credit
    # card".
    assert eligibility["current"] is True
    assert companion._is_current(current_doc) is True
    assert eligibility["savings"] is True
    assert companion._is_savings(savings_doc) is True
