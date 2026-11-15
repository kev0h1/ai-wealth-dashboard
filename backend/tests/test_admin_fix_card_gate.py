"""A196: POST /admin/fix-card-transactions is owner only. Calls the handler
directly with a plain dict for `current_user` (the tests/test_admin_sync_stats.py
convention), plus one HTTP-level check that an unauthenticated request is 401."""
import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import app.routers.admin as admin
from app.core.config import PRIMARY_EMAIL


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self.docs:
            yield d


class _Accounts:
    def find(self, filt, proj=None):
        return _Cursor([{"_id": "cc1"}])


class _Txns:
    def __init__(self):
        self.calls = []

    async def update_many(self, filt, upd):
        self.calls.append((filt, upd))

        class R:
            modified_count = 3

        return R()


@pytest.fixture
def cols(monkeypatch):
    txns = _Txns()
    monkeypatch.setattr(admin, "accounts_col", _Accounts())
    monkeypatch.setattr(admin, "transactions_col", txns)

    from app.services import transfer_review_store

    async def _stale(uid):
        return None

    monkeypatch.setattr(transfer_review_store, "mark_stale", _stale)
    return txns


def test_owner_is_allowed_and_route_behaves_as_before(cols):
    out = asyncio.run(admin.fix_card_transactions(user={"email": PRIMARY_EMAIL}))
    assert out["fixed"] == 3
    assert len(cols.calls) == 3


def test_normal_user_gets_403_and_nothing_changes(cols):
    with pytest.raises(HTTPException) as e:
        asyncio.run(admin.fix_card_transactions(user={"email": "someone.real@example.com"}))
    assert e.value.status_code == 403
    assert e.value.detail == "Not authorised"
    assert cols.calls == []


def test_bot_without_owner_email_gets_403(cols):
    with pytest.raises(HTTPException) as e:
        asyncio.run(admin.fix_card_transactions(user={"name": "Bot"}))
    assert e.value.status_code == 403
    assert cols.calls == []


def test_unauthenticated_gets_401():
    app = FastAPI()
    app.include_router(admin.router)
    r = TestClient(app).post("/admin/fix-card-transactions")
    assert r.status_code == 401
