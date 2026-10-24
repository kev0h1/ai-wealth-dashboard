"""E11: once-a-minute user-present refresh limit. Fakes and an injected clock."""
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

import app.db.collections as colls
import app.routers.accounts as accounts_router
from app.services import sync_throttle

UID = "e11-throttle@example.com"
T0 = datetime(2026, 10, 24, 12, 0, 0)


class Cursorless:
    def __init__(self, docs=None, fail=False):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}
        self.fail = fail

    async def count_documents(self, filt, limit=None):
        if self.fail:
            raise RuntimeError("down")
        n = 0
        for d in self.docs.values():
            if d.get("user_id") != filt.get("user_id"):
                continue
            if filt.get("status") and d.get("status") != filt["status"]:
                continue
            if "last_synced" in filt and (("last_synced" in d) != filt["last_synced"]["$exists"]):
                continue
            n += 1
        return n

    async def find_one_and_update(self, filt, upd, upsert=False):
        if self.fail:
            raise RuntimeError("down")
        d = self.docs.get(filt["_id"])
        if d is not None and not (d["last_at"] < filt["last_at"]["$lt"]):
            raise DuplicateKeyError("dup")
        self.docs[filt["_id"]] = {"_id": filt["_id"], **upd["$set"]}

    async def find_one(self, filt, proj=None):
        return self.docs.get(filt["_id"])


@pytest.fixture
def cols(monkeypatch):
    runs = Cursorless()
    monkeypatch.setattr(colls, "worker_runs_col", runs)
    monkeypatch.setattr(colls, "connections_col", Cursorless([{"_id": "c", "user_id": UID, "last_synced": T0}]))
    monkeypatch.setattr(colls, "finexer_consents_col", Cursorless([
        {"_id": "f", "user_id": UID, "status": "authorized", "last_synced": T0}]))
    return runs


def run(c):
    return asyncio.run(c)


def test_second_refresh_inside_a_minute_is_refused_with_seconds(cols):
    assert run(sync_throttle.check_user_sync(UID, T0)) == 0
    assert run(sync_throttle.check_user_sync(UID, T0 + timedelta(seconds=20))) == 40
    assert run(sync_throttle.check_user_sync(UID, T0 + timedelta(seconds=59))) == 1


def test_allowed_again_after_a_minute(cols):
    assert run(sync_throttle.check_user_sync(UID, T0)) == 0
    assert run(sync_throttle.check_user_sync(UID, T0 + timedelta(seconds=61))) == 0


def test_other_user_has_own_window(cols):
    assert run(sync_throttle.check_user_sync(UID, T0)) == 0
    assert run(sync_throttle.check_user_sync("other@example.com", T0)) == 0


def test_first_sync_after_connect_is_exempt(monkeypatch, cols):
    monkeypatch.setattr(colls, "finexer_consents_col", Cursorless([
        {"_id": "f", "user_id": UID, "status": "authorized"}]))  # never synced
    assert run(sync_throttle.check_user_sync(UID, T0)) == 0
    assert run(sync_throttle.check_user_sync(UID, T0 + timedelta(seconds=1))) == 0
    assert cols.docs == {}


def test_storage_failure_fails_open(monkeypatch, cols):
    monkeypatch.setattr(colls, "worker_runs_col", Cursorless(fail=True))
    assert run(sync_throttle.check_user_sync(UID, T0)) == 0


def test_route_returns_429_with_retry_after(monkeypatch):
    async def deny(uid):
        return 37

    async def not_paused(*_a, **_k):
        return False

    monkeypatch.setattr(accounts_router.sync_throttle, "check_user_sync", deny)
    monkeypatch.setattr(accounts_router, "open_banking_paused", not_paused)
    with pytest.raises(HTTPException) as e:
        run(accounts_router.sync_all(user={"email": UID}))
    assert e.value.status_code == 429
    assert e.value.headers["Retry-After"] == "37"
    assert e.value.detail == "Refreshed less than a minute ago"
