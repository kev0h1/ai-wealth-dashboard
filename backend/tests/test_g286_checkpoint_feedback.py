"""G286 checkpoint feedback contracts.

The integration suite owns database fixtures; these focused tests keep the
public contract explicit for later work on the Mirror feedback surface.
"""
import math
import asyncio
from functools import wraps
from datetime import date
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.services import checkpoints as service
from app.routers import checkpoints as router


def _run_async(test):
    @wraps(test)
    def run(*args, **kwargs):
        return asyncio.run(test(*args, **kwargs))
    return run


def test_g286_history_rejects_non_finite_values():
    assert service._finite_number(12) == 12.0
    assert service._finite_number(float("nan")) is None
    assert service._finite_number(float("inf")) is None
    assert service._finite_number(False) is None
    assert service._finite_number("not-a-number") is None


def test_g286_finite_helper_never_leaks_nan():
    value = service._finite_number("3.50")
    assert value == 3.5
    assert math.isfinite(value)


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *_args):
        return self

    def limit(self, _limit):
        return self

    async def to_list(self, limit):
        return self.docs[:limit] if limit is not None else self.docs


class _HistoryCollection:
    def __init__(self, completed):
        self.completed = completed
        self.queries = []

    def find(self, query, *_args):
        self.queries.append(query)
        # resolve_due asks for active checkpoints first.
        if query.get("status") == "active":
            return _Cursor([])
        return _Cursor(self.completed)


@_run_async
async def test_g286_history_is_owned_completed_and_preserves_recorded_result(monkeypatch):
    completed = {
        "_id": ObjectId(), "user_id": "me@example.test", "kind": "category",
        "ref": "Eating Out", "aim_amount": 120, "basis": "custom",
        "period_start": "2026-09-01", "period_end": "2026-09-30",
        "status": "met", "result_amount": 99, "resolved_at": "2026-10-01T00:00:00+00:00",
    }
    malformed = {**completed, "_id": ObjectId(), "result_amount": float("nan")}
    col = _HistoryCollection([completed, malformed])
    monkeypatch.setattr(service, "checkpoints_col", col)
    monkeypatch.setattr(service, "get_category_kinds", lambda _uid: _async_value({}))
    history = await service.list_history("me@example.test", 12)
    assert history == [{
        "id": str(completed["_id"]), "ref": "Eating Out", "aim_amount": 120.0,
        "basis": "custom", "period_start": "2026-09-01", "period_end": "2026-09-30",
        "status": "met", "result_amount": 99.0, "resolved_at": "2026-10-01T00:00:00+00:00",
    }]
    assert col.queries[-1]["user_id"] == "me@example.test"
    assert col.queries[-1]["status"] == {"$in": ["met", "missed"]}


class _EvidenceCollection:
    def __init__(self, doc):
        self.doc = doc
        self.find_one_query = None

    def find(self, _query, *_args):
        return _Cursor([])  # no overdue active documents during lazy resolution

    async def find_one(self, query):
        self.find_one_query = query
        return self.doc


@_run_async
async def test_g286_evidence_reconciles_refunds_late_data_and_complete_weeks(monkeypatch):
    monkeypatch.setattr(service.timeutil, "user_today", lambda: date(2026, 11, 1))
    checkpoint_id = ObjectId()
    doc = {
        "_id": checkpoint_id, "user_id": "me@example.test", "kind": "category",
        "ref": "Eating Out", "period_start": "2026-10-01", "period_end": "2026-10-31",
        "status": "met", "result_amount": 50.0, "aim_amount": 80,
    }
    col = _EvidenceCollection(doc)
    txns = [
        {"id": str(i), "category": "Eating Out", "date": date(2026, 10, day), "amount": amount,
         "description": f"Merchant {i}"}
        for i, (day, amount) in enumerate(((31, 20), (30, 10), (26, -5), (20, 15), (13, 10), (6, 5)), 1)
    ]
    monkeypatch.setattr(service, "checkpoints_col", col)
    monkeypatch.setattr(service, "get_category_kinds", lambda _uid: _async_value({}))
    monkeypatch.setattr(service, "load_spend_txns", lambda *_args, **_kwargs: _async_value(txns))
    result = await service.checkpoint_evidence("me@example.test", str(checkpoint_id))
    assert col.find_one_query["user_id"] == "me@example.test"
    assert result["total"] == 55.0
    assert result["recorded_result"] == 50.0
    assert result["changed_since_result"] is True
    assert len(result["transactions"]) == 5
    assert result["remainder_count"] == 1
    assert round(sum(row["amount"] for row in result["transactions"]) + result["remainder_amount"], 2) == result["total"]
    assert result["weekly_counts"] == [
        {"period_start": "2026-10-04", "period_end": "2026-10-10", "count": 1},
        {"period_start": "2026-10-11", "period_end": "2026-10-17", "count": 1},
        {"period_start": "2026-10-18", "period_end": "2026-10-24", "count": 1},
        {"period_start": "2026-10-25", "period_end": "2026-10-31", "count": 2},
    ]


async def _async_value(value):
    return value


@_run_async
async def test_g286_evidence_foreign_id_does_not_resolve_or_load(monkeypatch):
    class ForeignCollection:
        async def find_one(self, query):
            assert query["user_id"] == "me@example.test"
            return None

    monkeypatch.setattr(service, "checkpoints_col", ForeignCollection())
    monkeypatch.setattr(service, "resolve_due", lambda _uid: pytest.fail("must not resolve foreign records"))
    monkeypatch.setattr(service, "load_spend_txns", lambda *_args, **_kwargs: pytest.fail("must not load foreign records"))
    assert await service.checkpoint_evidence("me@example.test", str(ObjectId())) is None


@_run_async
async def test_g286_evidence_rejects_invalid_period_and_nonfinite_completed_result(monkeypatch):
    bad_period = {
        "_id": ObjectId(), "user_id": "me@example.test", "kind": "category", "ref": "Eating Out",
        "period_start": "2026-10-31", "period_end": "2026-10-01", "status": "met", "result_amount": 1,
    }
    col = _EvidenceCollection(bad_period)
    monkeypatch.setattr(service, "checkpoints_col", col)
    assert await service.checkpoint_evidence("me@example.test", str(bad_period["_id"])) is None
    bad_result = {**bad_period, "_id": ObjectId(), "period_start": "2026-10-01", "result_amount": float("nan")}
    monkeypatch.setattr(service, "checkpoints_col", _EvidenceCollection(bad_result))
    assert await service.checkpoint_evidence("me@example.test", str(bad_result["_id"])) is None


@_run_async
async def test_g286_update_is_idempotent_but_never_updates_expired_period(monkeypatch):
    class Updates:
        def __init__(self, matched):
            self.matched = matched
            self.query = None

        async def update_one(self, query, _update):
            self.query = query
            return SimpleNamespace(matched_count=self.matched, modified_count=0)

    current = date(2026, 10, 1), date(2026, 10, 31)
    monkeypatch.setattr(service, "current_period", lambda _uid: _async_value(current))
    col = Updates(1)
    monkeypatch.setattr(service, "checkpoints_col", col)
    assert await service.update_checkpoint("me@example.test", str(ObjectId()), 100) is True
    assert col.query["period_end"] == "2026-10-31"
    with pytest.raises(ValueError):
        await service.update_checkpoint("me@example.test", str(ObjectId()), float("nan"))
    expired = Updates(0)
    monkeypatch.setattr(service, "checkpoints_col", expired)
    assert await service.update_checkpoint("me@example.test", str(ObjectId()), 100) is False


@_run_async
async def test_g286_resolve_due_cas_does_not_overwrite_a_concurrent_edit(monkeypatch):
    due = {
        "_id": ObjectId(), "user_id": "me@example.test", "status": "active", "kind": "category",
        "ref": "Eating Out", "aim_amount": 80, "period_start": "2026-09-01", "period_end": "2026-09-30",
    }

    class CasCollection:
        def __init__(self):
            self.query = None

        def find(self, _query, *_args):
            return _Cursor([due])

        async def update_one(self, query, _update):
            self.query = query
            return SimpleNamespace(modified_count=0)  # edit/cancel won the race

    col = CasCollection()
    monkeypatch.setattr(service, "checkpoints_col", col)
    monkeypatch.setattr(service.timeutil, "user_today", lambda: date(2026, 10, 2))
    monkeypatch.setattr(service, "category_total_spend", lambda *_args, **_kwargs: _async_value(70))
    assert await service.resolve_due("me@example.test", kind_map={}) == []
    assert col.query["status"] == "active"
    assert col.query["aim_amount"] == 80


@_run_async
async def test_g286_router_id_guards_and_history_response(monkeypatch):
    with pytest.raises(HTTPException) as invalid:
        await router.get_checkpoint_evidence("not-an-object-id", {"email": "me@example.test"})
    assert invalid.value.status_code == 400
    monkeypatch.setattr(router, "checkpoint_evidence", lambda *_args: _async_value(None))
    with pytest.raises(HTTPException) as absent:
        await router.get_checkpoint_evidence(str(ObjectId()), {"email": "me@example.test"})
    assert absent.value.status_code == 404
    seen = {}
    monkeypatch.setattr(router, "list_history", lambda uid, limit: _history_stub(seen, uid, limit))
    assert await router.get_checkpoint_history(3, {"email": "me@example.test"}) == {"checkpoints": []}
    assert seen == {"uid": "me@example.test", "limit": 3}


async def _history_stub(seen, uid, limit):
    seen.update(uid=uid, limit=limit)
    return []
