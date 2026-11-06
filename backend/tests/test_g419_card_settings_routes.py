"""G419 separate card Payment and Rates route contracts."""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.routers.analytics as analytics
import app.routers.card_terms as card_terms
import app.db.collections as collections
from tests.penny_proposal_fakes import FakeCollection


UID = "g419@example.test"
USER = {"email": UID}
CARD_ID = "card-1"
PAYER_ID = "current-1"
TODAY = date(2026, 3, 20)
REF_A = "AMERICAN EXPRESS 3799-111111-20001"
REF_B = "AMERICAN EXPRESS 3799-111111-20002"


def _card(**extra):
    return {"_id": CARD_ID, "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD",
            "currency": "GBP", **extra}


def _payer(**extra):
    return {"_id": PAYER_ID, "user_id": UID, "type": "bank", "subtype": "TRANSACTION",
            "currency": "GBP", "include_in_safe_to_spend": True, **extra}


def _tx(days, description, amount=100.0, *, account=PAYER_ID, user=UID, kind="debit", pending=False):
    return {"_id": f"{user}:{account}:{days}:{description}", "user_id": user, "account_id": account,
            "transaction_type": kind, "amount": amount, "is_pending": pending,
            "date": datetime.combine(TODAY - timedelta(days=days), datetime.min.time(), tzinfo=timezone.utc),
            "description": description, "merchant_name": "American Express"}


class _HistoryCollection(FakeCollection):
    async def find_one(self, query=None, projection=None, sort=None):
        rows = [doc for doc in self.docs if self._match(doc, query)]
        if sort:
            key, direction = sort[0]
            rows.sort(key=lambda row: row.get(key), reverse=direction < 0)
        return dict(rows[0]) if rows else None


@pytest.fixture
def stores(monkeypatch):
    accounts = FakeCollection([_card(), _payer(), _payer(_id="uncounted", include_in_safe_to_spend=False)])
    terms = FakeCollection()
    transactions = _HistoryCollection()
    refreshed = []

    async def refresh(uid):
        refreshed.append(uid)

    monkeypatch.setattr(card_terms, "accounts_col", accounts)
    monkeypatch.setattr(card_terms, "card_terms_col", terms)
    monkeypatch.setattr(collections, "accounts_col", accounts)
    monkeypatch.setattr(collections, "transactions_col", transactions)
    monkeypatch.setattr(analytics, "_refresh_after_override", refresh)
    monkeypatch.setattr(card_terms.timeutil, "user_today", lambda: TODAY)
    return accounts, terms, transactions, refreshed


def test_payment_accounts_exclude_cards_uncounted_and_non_gbp_sources(stores):
    accounts, _terms, _transactions, _refreshed = stores
    accounts.docs.extend([_payer(_id="usd", currency="USD"), _card(_id="other-card")])

    result = asyncio.run(card_terms.list_payment_accounts(CARD_ID, USER))

    assert result["status"] == "ok"
    assert result["accounts"] == [{"id": PAYER_ID, "name": "Current account", "provider": "Bank"}]


def test_history_searches_before_pagination_and_keeps_a_london_six_calendar_month_window(stores):
    _accounts, _terms, transactions, _refreshed = stores
    transactions.docs.extend([_tx(day, f"merchant {day}") for day in range(1, 56)])
    transactions.docs.append(_tx(56, "needle payment"))
    transactions.docs.extend([
        _tx(3, "PENDING", pending=True), _tx(3, "CREDIT", kind="credit"),
        _tx(-1, "FUTURE"), _tx(3, "OTHER", account="other"), _tx(3, "OTHER USER", user="other@example.test"),
    ])

    body = card_terms.CardPaymentHistoryBody(payer_id=PAYER_ID, query="needle", offset=0)
    result = asyncio.run(card_terms.payment_history(CARD_ID, body, USER))

    assert result["from"] == "2025-09-20" and result["through"] == "2026-03-20"
    assert result["history_from"] == "2026-01-23" and result["history_complete"] is False
    assert [row["description"] for row in result["payments"]] == ["needle payment"]
    assert result["payments"][0]["amount"] == -100.0
    assert result["next_offset"] is None


def test_history_masks_long_reference_and_exposes_safe_contains_and_prepared_exact(stores):
    _accounts, _terms, transactions, _refreshed = stores
    transactions.docs.append(_tx(1, REF_A))

    result = asyncio.run(card_terms.payment_history(
        CARD_ID, card_terms.CardPaymentHistoryBody(payer_id=PAYER_ID), USER))
    payment = result["payments"][0]

    assert payment["description"] == "AMERICAN EXPRESS …20001"
    assert payment["contains_text"] == "20001"
    assert payment["exact_match"]["kind"] == "exact"
    # fingerprint and salt are random hex and can contain "3799" by chance,
    # so check only the readable fields for the fragment (as H149 did).
    random_fields = {"fingerprint", "salt"}
    readable = {k: v for k, v in payment["exact_match"].items() if k not in random_fields}
    assert "3799" not in str(readable)
    assert "3799-111111-20001" not in str(payment["exact_match"])
    assert len(payment["exact_match"]["fingerprint"]) == 64


def test_preview_distinguishes_no_history_from_partial_history_and_marks_competing_exact_rules_ambiguous(stores):
    _accounts, _terms, transactions, _refreshed = stores
    rule = {"kind": "exact", "text": REF_A}
    empty = asyncio.run(card_terms.preview_payment_match(
        CARD_ID, card_terms.CardPaymentPreviewBody(payer_id=PAYER_ID, rule=rule), USER))
    assert empty["history_from"] is None and empty["history_complete"] is False
    assert empty["reason"] and empty["match_count"] == 0

    transactions.docs.extend([_tx(1, REF_A), _tx(2, REF_B)])
    broad = asyncio.run(card_terms.preview_payment_match(
        CARD_ID, card_terms.CardPaymentPreviewBody(payer_id=PAYER_ID, rule={"kind": "contains", "text": "AMERICAN EXPRESS"}), USER))
    assert broad["ambiguous"] is True and broad["reason"]


def test_payment_and_rates_save_are_atomic_separate_patches_and_invalid_payment_has_no_write(stores):
    _accounts, terms, _transactions, refreshed = stores
    terms.docs.append({"_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
                       "apr_pct": 19.9, "promos": [{"kind": "purchases", "apr_pct": 0, "until": "2026-12-31"}],
                       "payment_account_id": PAYER_ID, "payment_method": "manual"})

    rates = asyncio.run(card_terms.save_card_rates(
        CARD_ID, card_terms.CardRatesBody(apr_pct=21.9), USER))
    assert rates["terms"]["apr_pct"] == 21.9
    assert terms.docs[0]["payment_account_id"] == PAYER_ID

    payment = asyncio.run(card_terms.save_card_payment(
        CARD_ID, card_terms.CardPaymentBody(payment_method="fixed", fixed_payment_amount=75.0), USER))
    assert payment["terms"]["payment_method"] == "fixed"
    assert terms.docs[0]["apr_pct"] == 21.9

    before = dict(terms.docs[0])
    with pytest.raises(HTTPException):
        asyncio.run(card_terms.save_card_payment(
            CARD_ID, card_terms.CardPaymentBody(payment_method="fixed", fixed_payment_amount=0), USER))
    assert terms.docs[0] == before
    assert refreshed == [UID, UID]


def test_rate_only_save_does_not_revalidate_an_unchanged_removed_payer(stores):
    accounts, terms, _transactions, _refreshed = stores
    accounts.docs = [_card()]
    terms.docs.append({"_id": f"{UID}:{CARD_ID}", "user_id": UID, "account_id": CARD_ID,
                       "payment_account_id": "removed-current", "payment_method": "full"})

    result = asyncio.run(card_terms.save_card_rates(
        CARD_ID, card_terms.CardRatesBody(apr_pct=21.9), USER))

    assert result["terms"]["apr_pct"] == 21.9
    assert terms.docs[0]["payment_account_id"] == "removed-current"
