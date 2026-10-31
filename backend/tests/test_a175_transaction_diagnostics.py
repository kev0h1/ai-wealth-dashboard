"""A175: per-account transaction sync diagnostics for Finexer, and their
serialisation on the accounts API.

A 200 with no rows used to leave no trace, so an empty pot could not be told
apart from a sync that never ran. The success fields are written only on a
successful walk; a failure records transactions_fetch_failed_at and leaves
the last known good values alone.
"""
import asyncio
import logging
from datetime import datetime

import app.routers.accounts as accounts_router
import app.services.finexer_sync as finexer_sync
from tests.test_finexer_malformed_upstream import (
    FakeCol, FakeExcludedCol, FakeResp,
)

class FakeAccounts(FakeCol):
    async def update_many(self, filt, update, upsert=False):
        ids = (filt.get("_id") or {}).get("$in") or []
        for d in self.docs:
            if d["_id"] in ids:
                d.update(update.get("$set") or {})


UID = "u-a175"
CONSENT = "fx-a175"


class _Client:
    def __init__(self, txn_response, balance=1656.98, acc_class="savings"):
        self._txn = txn_response
        self._balance = balance
        self._class = acc_class

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        if url.startswith("/consents/"):
            return FakeResp(200, {"status": "authorized"})
        if url == "/bank_accounts":
            return FakeResp(200, {"data": [{"id": "pot1", "class": self._class, "provider": "monzo"}]})
        if url.endswith("/balance"):
            return FakeResp(200, {"data": [{"type": "actual", "current": self._balance}]})
        if url.endswith("/transactions"):
            # A176: the status=pending fetch is a second walk; it is empty here.
            if (params or {}).get("status") == "pending":
                return FakeResp(200, {"data": []})
            return self._txn
        raise AssertionError(f"unexpected GET {url}")


def _wire(monkeypatch, txn_response, accounts=None, **kw):
    consents = FakeCol([{"_id": CONSENT, "user_id": UID, "status": "authorized", "last_synced": None}])
    accts = accounts if accounts is not None else FakeAccounts([])
    monkeypatch.setattr(finexer_sync, "finexer_consents_col", consents)
    monkeypatch.setattr(finexer_sync, "accounts_col", accts)
    monkeypatch.setattr(finexer_sync, "_client", lambda: _Client(txn_response, **kw))
    monkeypatch.setattr("app.db.collections.excluded_accounts_col", FakeExcludedCol())

    async def _no_identity(uid):
        return None

    async def _providers(counter=None):
        return []

    async def _upsert(txns, account_id, user_id, identity=None):
        return [t for t in txns if t.get("status") != "pending"], [t for t in txns if t.get("status") == "pending"]

    async def _pending(rows, account_id, user_id, provider=None, account_currency=None):
        return None

    monkeypatch.setattr(finexer_sync, "user_identity", _no_identity)
    monkeypatch.setattr(finexer_sync, "list_providers", _providers)
    monkeypatch.setattr(finexer_sync, "_upsert_finexer_transactions", _upsert)
    monkeypatch.setattr(finexer_sync, "replace_pending_for_account", _pending)
    return accts


def _doc(accts):
    return next(d for d in accts.docs if d["_id"] == "pot1")


def test_success_with_rows_sets_both_fields(monkeypatch):
    accts = _wire(monkeypatch, FakeResp(200, {"data": [{"id": "t1"}, {"id": "t2", "status": "pending"}]}))
    asyncio.run(finexer_sync.sync_finexer_consent(CONSENT, UID))
    d = _doc(accts)
    assert d["transactions_last_count"] == 2
    assert isinstance(d["transactions_synced_at"], datetime)
    assert "transactions_fetch_failed_at" not in d


def test_zero_rows_sets_count_zero_and_logs_without_identity(monkeypatch, caplog):
    accts = _wire(monkeypatch, FakeResp(200, {"data": []}))
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        asyncio.run(finexer_sync.sync_finexer_consent(CONSENT, UID))
    d = _doc(accts)
    assert d["transactions_last_count"] == 0
    assert isinstance(d["transactions_synced_at"], datetime)
    msgs = [r.getMessage() for r in caplog.records if "no transactions" in r.getMessage()]
    assert len(msgs) == 1
    assert "savings" in msgs[0]
    assert UID not in msgs[0]


def test_zero_rows_with_zero_balance_does_not_log(monkeypatch, caplog):
    _wire(monkeypatch, FakeResp(200, {"data": []}), balance=0)
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        asyncio.run(finexer_sync.sync_finexer_consent(CONSENT, UID))
    assert not [r for r in caplog.records if "no transactions" in r.getMessage()]


def test_failure_sets_failed_at_and_keeps_old_success_values(monkeypatch):
    old = datetime(2026, 10, 1, 12, 0, 0)
    accts = FakeAccounts([{"_id": "pot1", "transactions_synced_at": old, "transactions_last_count": 7}])
    _wire(monkeypatch, FakeResp(500, {}), accounts=accts)
    asyncio.run(finexer_sync.sync_finexer_consent(CONSENT, UID))
    d = _doc(accts)
    assert isinstance(d["transactions_fetch_failed_at"], datetime)
    assert d["transactions_synced_at"] == old
    assert d["transactions_last_count"] == 7


def test_serialisation_exposes_iso_and_count_and_null_when_absent():
    out = accounts_router._transaction_diagnostics(
        {"transactions_synced_at": datetime(2026, 10, 29, 9, 30, 0), "transactions_last_count": 0}
    )
    assert out == {"transactions_synced_at": "2026-10-29T09:30:00Z", "transactions_last_count": 0, "bank_synced_to": None}
    assert accounts_router._transaction_diagnostics({}) == {
        "transactions_synced_at": None, "transactions_last_count": None, "bank_synced_to": None,
    }


def test_get_accounts_rows_carry_the_diagnostics(monkeypatch):
    docs = [
        {"_id": "pot1", "user_id": UID, "name": "Pot", "type": "bank", "subtype": "SAVINGS",
         "balance": 5.0, "provider": "Monzo",
         "transactions_synced_at": datetime(2026, 10, 29, 9, 30, 0), "transactions_last_count": 0},
        {"_id": "old1", "user_id": UID, "name": "Old", "type": "bank", "subtype": "TRANSACTION",
         "balance": 5.0, "provider": "Monzo"},
    ]

    class _Col:
        def __init__(self, d):
            self.d = d

        def find(self, *a, **k):
            return self

        async def to_list(self, n):
            return list(self.d)

        async def count_documents(self, *a, **k):
            return 0

    async def _paused(uid):
        return False

    async def _aprs(uid, result):
        return result

    monkeypatch.setattr(accounts_router, "accounts_col", _Col(docs))
    monkeypatch.setattr(accounts_router, "statement_accounts_col", _Col([]))
    monkeypatch.setattr(accounts_router, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(accounts_router, "yapily_consents_col", _Col([]))
    monkeypatch.setattr(accounts_router, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(accounts_router, "open_banking_paused", _paused)
    monkeypatch.setattr(accounts_router, "_attach_aprs", _aprs)
    rows = {r.id: r for r in asyncio.run(accounts_router.get_accounts({"email": UID}))}
    assert rows["pot1"].transactions_last_count == 0
    assert rows["pot1"].transactions_synced_at == "2026-10-29T09:30:00Z"
    assert rows["old1"].transactions_last_count is None
    assert rows["old1"].transactions_synced_at is None
