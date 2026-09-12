"""The account picker must expose only sources the settled cover engine reads."""

import asyncio

import app.routers.accounts as accounts_router


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
