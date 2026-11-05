"""G421 (H145): cancelling or deleting a planned payment, a set-aside or a goal
plan refreshes the stored results before it returns (awaited invalidate then
warm, as G399), and never uses the fire-and-forget invalidate.

No database: tiny in-memory fakes."""
import asyncio

import pytest
from bson import ObjectId

import app.routers.allocations as allocations
import app.routers.commitments as commitments
import app.routers.planned as planned
import app.services.warmup as warmup
from app.services import response_cache

UID = "fixture-user@example.com"
USER = {"email": UID}


class _Result:
    def __init__(self, n):
        self.deleted_count = n
        self.matched_count = n


class _Col:
    def __init__(self, docs):
        self.docs = list(docs)

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if all(d.get(k) == v for k, v in (q or {}).items())), None)

    async def delete_one(self, q):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not all(d.get(k) == v for k, v in q.items())]
        return _Result(before - len(self.docs))

    async def update_one(self, q, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                d.update(update.get("$set") or {})
                return _Result(1)
        return _Result(0)


@pytest.fixture
def calls(monkeypatch):
    log: list[str] = []

    async def ainvalidate(uid):
        log.append("ainvalidate")

    def invalidate(uid):
        log.append("invalidate")

    async def warm(uid):
        log.append("warm_user")
        return {}

    monkeypatch.setattr(response_cache, "ainvalidate", ainvalidate)
    monkeypatch.setattr(response_cache, "invalidate", invalidate)
    monkeypatch.setattr(warmup, "warm_user", warm)
    return log


def _assert_refreshed(log):
    assert "invalidate" not in log
    assert log.index("ainvalidate") < log.index("warm_user")


def test_delete_planned_deletes_then_refreshes(calls, monkeypatch):
    oid = ObjectId()
    col = _Col([{"_id": oid, "user_id": UID}])
    monkeypatch.setattr(planned, "planned_expenses_col", col)
    assert asyncio.run(planned.delete_planned_expense(str(oid), USER)) == {"ok": True}
    assert col.docs == []
    _assert_refreshed(calls)


def test_delete_planned_missing_does_not_refresh(calls, monkeypatch):
    monkeypatch.setattr(planned, "planned_expenses_col", _Col([]))
    with pytest.raises(planned.HTTPException) as e:
        asyncio.run(planned.delete_planned_expense(str(ObjectId()), USER))
    assert e.value.status_code == 404
    assert calls == []


def test_update_planned_refreshes(calls, monkeypatch):
    from datetime import datetime
    oid = ObjectId()
    col = _Col([{"_id": oid, "user_id": UID, "name": "Boiler", "amount": 100.0,
                 "date": datetime(2026, 11, 20), "status": "planned"}])
    monkeypatch.setattr(planned, "planned_expenses_col", col)
    asyncio.run(planned.update_planned_expense(str(oid), {"name": "Boiler service"}, USER))
    assert col.docs[0]["name"] == "Boiler service"
    _assert_refreshed(calls)


def test_delete_allocation_refreshes(calls, monkeypatch):
    oid = ObjectId()
    col = _Col([{"_id": oid, "user_id": UID}])

    async def owned(uid, allocation_id):
        return col.docs[0]

    monkeypatch.setattr(allocations, "allocations_col", col)
    monkeypatch.setattr(allocations, "_get_owned", owned)
    out = asyncio.run(allocations.delete_allocation(str(oid), USER))
    assert out["deleted"] is True and col.docs == []
    _assert_refreshed(calls)


def test_cancel_commitment_refreshes(calls, monkeypatch):
    oid = ObjectId()
    col = _Col([{"_id": oid, "user_id": UID, "status": "active"}])

    async def owned(uid, commitment_id):
        return col.docs[0]

    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments, "_get_owned", owned)
    out = asyncio.run(commitments.delete_commitment(str(oid), USER))
    assert out["status"] == "cancelled" and col.docs[0]["status"] == "cancelled"
    _assert_refreshed(calls)


def test_warm_failure_never_fails_the_cancel(calls, monkeypatch):
    oid = ObjectId()
    monkeypatch.setattr(planned, "planned_expenses_col", _Col([{"_id": oid, "user_id": UID}]))

    async def boom(uid):
        raise RuntimeError("warm failed")

    monkeypatch.setattr(warmup, "warm_user", boom)
    assert asyncio.run(planned.delete_planned_expense(str(oid), USER)) == {"ok": True}
