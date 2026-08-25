"""Unit tests for app.services.needle's provider union — owner-approved fix,
2026-08. `_credit_card_account_ids` and `_txns_for_period` used to query
`accounts_col`/`transactions_col` only (TrueLayer/Finexer), so a
Yapily-connected credit card was invisible to every caller of these helpers
(net_position's card-growth reserve, the needle month-close movement fact,
and the cards-story/companion/cycle-story Mirror surfaces) — silently, with
no exception, reproducing the exact bug net_position.py exists to close.
`compute_safe_to_spend` (analytics.py:2188-2213) and spend_verdict's
`_load_period_txns` already union both providers; these two helpers now
match them.

No mongomock is available in this environment (see test_notifications.py's
own note); small purpose-built fake collections stand in, following the
monkeypatch-the-module-level-name pattern test_notifications.py and
test_transfer_pairs.py already established.
"""
import asyncio
from datetime import date, datetime

import app.services.needle as needle
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

def test_credit_card_account_ids_unions_yapily(monkeypatch):
    # Yapily account docs (yapily_sync.py) store a lowercased `type` only,
    # never a `subtype` — is_credit_card_account's fallback already covers
    # that shape (see its docstring), confirmed here end-to-end.
    native = [{"user_id": "kevin", "account_id": "native-current", "type": "bank", "subtype": "TRANSACTION"}]
    yapily = [{"user_id": "kevin", "_id": "yapily-card-1", "type": "credit_card"}]
    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol(native))
    monkeypatch.setattr(needle, "yapily_accounts_col", _FakeAccountsCol(yapily))

    ids = asyncio.run(needle._credit_card_account_ids("kevin"))
    assert ids == {"yapily-card-1"}


def test_credit_card_account_ids_native_only_still_works(monkeypatch):
    # Regression guard: widening to Yapily must not disturb the pre-existing
    # native-only path.
    native = [{"user_id": "kevin", "account_id": "native-card", "type": "credit_card", "subtype": ""}]
    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol(native))
    monkeypatch.setattr(needle, "yapily_accounts_col", _FakeAccountsCol([]))

    ids = asyncio.run(needle._credit_card_account_ids("kevin"))
    assert ids == {"native-card"}


def test_credit_card_account_ids_excludes_yapily_current_account(monkeypatch):
    yapily = [{"user_id": "kevin", "_id": "yapily-current", "type": "transaction"}]
    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol([]))
    monkeypatch.setattr(needle, "yapily_accounts_col", _FakeAccountsCol(yapily))

    ids = asyncio.run(needle._credit_card_account_ids("kevin"))
    assert ids == set()


# ── _txns_for_period ─────────────────────────────────────────────────────────

def test_txns_for_period_unions_yapily(monkeypatch):
    native_txns = [
        {"user_id": "kevin", "account_id": "native-card", "amount": 100.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
    ]
    yapily_txns = [
        {"user_id": "kevin", "account_id": "yapily-card-1", "amount": 40.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 10)},
    ]
    monkeypatch.setattr(needle, "transactions_col", _FakeTxnsCol(native_txns))
    monkeypatch.setattr(needle, "yapily_transactions_col", _FakeTxnsCol(yapily_txns))

    txns = asyncio.run(needle._txns_for_period("kevin", date(2026, 8, 1), date(2026, 8, 25)))
    assert {t["account_id"] for t in txns} == {"native-card", "yapily-card-1"}


def test_txns_for_period_account_id_filter_applies_across_both_providers(monkeypatch):
    native_txns = [
        {"user_id": "kevin", "account_id": "native-card", "amount": 100.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
        {"user_id": "kevin", "account_id": "native-current", "amount": 999.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
    ]
    yapily_txns = [
        {"user_id": "kevin", "account_id": "yapily-card-1", "amount": 40.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 10)},
        {"user_id": "kevin", "account_id": "yapily-current", "amount": 500.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 10)},
    ]
    monkeypatch.setattr(needle, "transactions_col", _FakeTxnsCol(native_txns))
    monkeypatch.setattr(needle, "yapily_transactions_col", _FakeTxnsCol(yapily_txns))

    card_ids = {"native-card", "yapily-card-1"}
    txns = asyncio.run(
        needle._txns_for_period("kevin", date(2026, 8, 1), date(2026, 8, 25), account_ids=card_ids)
    )
    assert {t["account_id"] for t in txns} == {"native-card", "yapily-card-1"}


# ── End-to-end: the exact bug the coordinator reproduced ────────────────────

def test_card_growth_unpaid_not_silently_zero_for_yapily_only_card(monkeypatch):
    """A user whose ONLY credit card is Yapily-connected must still get a
    real reserve, not the pre-fix silent £0 (`if not card_ids: return 0.0`
    early-out — no exception, nothing in the logs)."""
    yapily_accounts = [{"user_id": "kevin", "_id": "yapily-card-1", "type": "credit_card"}]
    yapily_txns = [
        {"user_id": "kevin", "account_id": "yapily-card-1", "amount": 200.0,
         "transaction_type": "debit", "date": datetime(2026, 8, 5)},
    ]
    monkeypatch.setattr(needle, "accounts_col", _FakeAccountsCol([]))
    monkeypatch.setattr(needle, "yapily_accounts_col", _FakeAccountsCol(yapily_accounts))
    monkeypatch.setattr(needle, "transactions_col", _FakeTxnsCol([]))
    monkeypatch.setattr(needle, "yapily_transactions_col", _FakeTxnsCol(yapily_txns))

    result = asyncio.run(card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25)))
    assert result == 200.0
