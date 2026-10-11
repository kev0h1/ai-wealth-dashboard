"""Unit tests for app.services.needle's account/transaction helpers
(`_credit_card_account_ids`, `_txns_for_period`). H87 removed a retired
provider, so both helpers read accounts_col / transactions_col only.

No mongomock is available in this environment (see test_notifications.py's
own note); small purpose-built fake collections stand in, following the
monkeypatch-the-module-level-name pattern test_notifications.py and
test_transfer_pairs.py already established.
"""
import asyncio
from datetime import date, datetime

import app.services.categories as categories
import app.services.needle as needle
from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.net_position import card_growth_unpaid


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class _FakeAccountsCol:
    """Matches on user_id only — sufficient here, every test uses one user."""

    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None):
        query = query or {}
        uid = query.get("user_id")
        return _FakeCursor([d for d in self.docs if uid is None or d.get("user_id") == uid])


class _FakeTxnsCol:
    """Matches user_id and, if present, account_id $in. Ignores the date
    range filter — every fixture transaction already falls inside the
    queried window, which is all these tests need."""

    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None):
        query = query or {}
        uid = query.get("user_id")
        acct_filter = (query.get("account_id") or {}).get("$in")
        out = []
        for d in self.docs:
            if uid is not None and d.get("user_id") != uid:
                continue
            if acct_filter is not None and d.get("account_id") not in acct_filter:
                continue
            out.append(d)
        return _FakeCursor(out)


# ── _credit_card_account_ids ────────────────────────────────────────────────

def test_credit_card_account_ids_returns_native_cards(monkeypatch):
    native = [{"user_id": "kevin", "account_id": "native-card", "type": "credit_card", "subtype": ""}]
    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol(native))

    ids = asyncio.run(needle._credit_card_account_ids("kevin"))
    assert ids == {"native-card"}


def test_credit_card_account_ids_never_leaks_another_users_card(monkeypatch):
    # G27 (2026-09-10): a card that looked "missing" from one user's Cards
    # page turned out to belong to a different user_id in the same shared
    # accounts_col — both are `type: credit_card` docs, but
    # `_credit_card_account_ids` is called with one uid at a time and every
    # query it runs is `{"user_id": uid}`. This pins that isolation
    # explicitly: two users' credit-card accounts sitting in the same
    # collection must never mix into a single caller's result, however
    # similar their shape (same provider, same doc structure).
    accounts = [
        {"user_id": "kevin", "account_id": "kevin-card", "type": "credit_card", "subtype": ""},
        {"user_id": "someone-else", "account_id": "someone-elses-card", "type": "credit_card", "subtype": ""},
    ]
    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol(accounts))

    kevin_ids = asyncio.run(needle._credit_card_account_ids("kevin"))
    other_ids = asyncio.run(needle._credit_card_account_ids("someone-else"))

    assert kevin_ids == {"kevin-card"}
    assert other_ids == {"someone-elses-card"}


# ── _txns_for_period ─────────────────────────────────────────────────────────

def test_txns_for_period_account_id_filter_applies(monkeypatch):
    native_txns = [
        {"user_id": "kevin", "account_id": "native-card", "amount": 100.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
        {"user_id": "kevin", "account_id": "native-current", "amount": 999.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
    ]
    monkeypatch.setattr(needle, "transactions_col", _FakeTxnsCol(native_txns))

    txns = asyncio.run(
        needle._txns_for_period("kevin", date(2026, 8, 1), date(2026, 8, 25), account_ids={"native-card"})
    )
    assert {t["account_id"] for t in txns} == {"native-card"}


# ── End-to-end: the exact bug the coordinator reproduced ────────────────────

def test_card_growth_unpaid_for_a_native_only_card(monkeypatch):
    """A user whose card lives in accounts_col must get a real reserve, not a
    silent GBP 0 (`if not card_ids: return 0.0` early-out)."""
    accounts = [{"user_id": "kevin", "_id": "native-card-1", "type": "credit_card"}]
    txns = [
        {"user_id": "kevin", "account_id": "native-card-1", "amount": 200.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
    ]
    async def fake_kinds(uid):
        return dict(BUILTIN_CATEGORY_KINDS)

    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol(accounts))
    monkeypatch.setattr(needle, "transactions_col", _FakeTxnsCol(txns))
    # G24: card_growth_by_card (which this exercises via card_growth_unpaid)
    # now also reads category kinds to split out new_spend — mock it so
    # this stays a pure unit test rather than a real DB call.
    monkeypatch.setattr(categories, "get_category_kinds", fake_kinds)

    result = asyncio.run(card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25)))
    assert result == 200.0
