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


def test_yapily_credit_card_is_ineligible_despite_never_setting_subtype(monkeypatch):
    """G55 blocker 1 (rejected review, 2026-09-12): `services/yapily_sync.py`'s
    `sync_yapily_consent` stores the provider's real account type lowercased
    straight into `type` (`"type": acc.get("type", "TRANSACTION").lower()`)
    and never writes a `subtype`/`account_subtype` key at all for a
    `yapily_accounts_col` doc. Removing the frontend's own type/subtype
    string heuristic without also fixing this router's Yapily branch would
    have been a REGRESSION, not a neutral omission: a Yapily credit card the
    old heuristic correctly hid would start showing as an eligible toggle --
    exactly the screen-disagrees-with-engine bug this item exists to close,
    reintroduced by the fix itself. The engine still refuses to use it (so
    no money moves), which is precisely why this is easy to miss without a
    fixture shaped like the real sync output.
    """
    async def uk_region(_uid):
        return "UK"

    # Shape matches yapily_sync.py's real write for a credit card exactly:
    # type="credit_card" (provider enum, lowercased), no subtype key.
    yapily_credit_doc = {
        "_id": "yap-cc", "user_id": "kevin", "name": "Yapily credit card",
        "type": "credit_card", "balance": -200, "currency": "GBP",
        "institution_id": "Open Bank", "consent": "consent-1", "status": "connected",
    }

    monkeypatch.setattr(accounts_router, "get_user_region", uk_region)
    monkeypatch.setattr(accounts_router, "accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "statement_accounts_col", _Collection())
    monkeypatch.setattr(
        accounts_router, "yapily_consents_col",
        _Collection([{"user_id": "kevin", "status": "AUTHORIZED"}]),
    )
    monkeypatch.setattr(accounts_router, "yapily_accounts_col", _Collection([yapily_credit_doc]))
    monkeypatch.setattr(accounts_router, "manual_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "account_rates_col", _Collection())

    result = asyncio.run(accounts_router.get_accounts({"email": "kevin"}))
    eligibility = {account.id: account.cover_source_eligible for account in result}

    assert is_credit_card_account(yapily_credit_doc) is True
    assert eligibility["yap-cc"] is False


def test_settings_eligibility_matches_the_engines_full_source_predicate(monkeypatch):
    """G55 blocker 2 (rejected review, 2026-09-12): companion.py's
    `source_capacity` build excludes credit cards AND THEN requires
    `_is_current(acc) or _is_savings(acc) or _is_offline(acc)` (see
    `services/companion.py` around line 1802-1810). A router that reuses
    only the credit-card half agrees with the engine today for one
    accidental reason -- Finexer funnels every unrecognised account class
    into the bank bucket and `_is_current` has an unconditional BANK
    fallback -- so the first provider or product type that writes
    something outside bank/credit_card reopens this bug invisibly.

    These fixtures deliberately fall outside BOTH halves of that accidental
    agreement: a loan-typed account, and a doc with an empty `type` and no
    `subtype` at all (accounts_col always carries a `type` key in practice,
    just not always a recognised one). Asserted against companion.py's own
    `_is_current`/`_is_savings`
    (imported from the same `services/card_rates.py` functions this router
    now shares -- see `_engine_source_eligible` in `routers/accounts.py` --
    not restated here), so this fails again the instant the two sides
    diverge, rather than only for the one shape this review happened to
    catch.
    """
    async def uk_region(_uid):
        return "UK"

    loan_doc = {
        "_id": "loan", "user_id": "kevin", "name": "Personal loan",
        "type": "loan", "subtype": "LOAN", "balance": -5000,
        "currency": "GBP", "provider": "Test Bank", "status": "connected",
    }
    blank_doc = {
        "_id": "blank", "user_id": "kevin", "name": "Unrecognised product",
        "type": "", "balance": 10, "currency": "GBP", "provider": "Test Bank",
        "status": "connected",
    }

    monkeypatch.setattr(accounts_router, "get_user_region", uk_region)
    monkeypatch.setattr(accounts_router, "accounts_col", _Collection([loan_doc, blank_doc]))
    monkeypatch.setattr(accounts_router, "statement_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "yapily_consents_col", _Collection())
    monkeypatch.setattr(accounts_router, "yapily_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "manual_accounts_col", _Collection())
    monkeypatch.setattr(accounts_router, "account_rates_col", _Collection())

    result = asyncio.run(accounts_router.get_accounts({"email": "kevin"}))
    eligibility = {account.id: account.cover_source_eligible for account in result}

    for doc in (loan_doc, blank_doc):
        expected = not is_credit_card_account(doc) and (
            companion._is_current(doc) or companion._is_savings(doc)
        )
        assert eligibility[doc["_id"]] == expected, doc["_id"]

    # Concretely: neither shape is a credit card, but neither clears the
    # engine's inclusion gate either (a loan is neither current nor
    # savings; the blank doc has no subtype and an empty `type`, not
    # "BANK") -- both must resolve False, which a router restating only
    # the credit-card half of the rule would get wrong (it would say True).
    assert eligibility["loan"] is False
    assert eligibility["blank"] is False
