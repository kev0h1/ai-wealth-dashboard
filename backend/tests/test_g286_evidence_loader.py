"""Focused G286 contracts for complete, auditable checkpoint evidence."""

import asyncio
from datetime import date, datetime

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.routers import checkpoints as router
from app.services import checkpoints, pace
from app.services.pace import SpendTransactionLoadError
from app.services.spending import SpendingContext


class _AsyncCursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for doc in self.docs:
            yield doc


class _Collection:
    def __init__(self, name, docs=(), error=None):
        self.name, self.docs, self.error = name, list(docs), error
        self.projections = []

    def find(self, _query, projection):
        self.projections.append(projection)
        if self.error:
            raise self.error
        return _AsyncCursor(self.docs)


def _run(coro):
    return asyncio.run(coro)


def _docs():
    return [
        {"_id": ObjectId("000000000000000000000001"), "date": datetime(2026, 10, 2),
         "amount": 25, "category": "Eating Out", "transaction_type": "debit",
         "merchant_name": "Cafe"},
        {"_id": ObjectId("000000000000000000000002"), "date": datetime(2026, 10, 3),
         "amount": 5, "category": "Eating Out", "transaction_type": "credit",
         "description": "Refund"},
        {"_id": ObjectId("000000000000000000000003"), "date": datetime(2026, 10, 4),
         "amount": 40, "category": "Eating Out", "transaction_type": "debit",
         "merchant_name": "Own move"},
    ]


def test_g286_evidence_projection_preserves_ids_names_and_signed_totals(monkeypatch):
    first, second = _Collection("bank", _docs()[:2]), _Collection("yapily", _docs()[2:])
    ctx = SpendingContext(kinds={"Eating Out": "discretionary"}, own_move_ids={str(_docs()[2]["_id"])})
    monkeypatch.setattr(pace, "transactions_col", first)
    monkeypatch.setattr(pace, "yapily_transactions_col", second)
    monkeypatch.setattr(pace, "get_category_kinds", lambda _uid: _run_value({"Eating Out": "discretionary"}))
    monkeypatch.setattr(pace, "build_spending_context", lambda *a, **kw: _run_value(ctx))

    default = _run(pace.load_spend_txns("u", date(2026, 10, 1), date(2026, 10, 5)))
    evidence = _run(pace.load_spend_txns("u", date(2026, 10, 1), date(2026, 10, 5), include_evidence=True))
    assert default == [{"date": date(2026, 10, 2), "category": "Eating Out", "amount": 25},
                       {"date": date(2026, 10, 3), "category": "Eating Out", "amount": -5}]
    assert evidence == [dict(default[0], id=str(_docs()[0]["_id"]), name="Cafe"),
                        dict(default[1], id=str(_docs()[1]["_id"]), name="Refund")]
    assert "merchant_name" not in first.projections[0]
    assert first.projections[-1]["merchant_name"] == 1
    assert first.projections[-1]["description"] == 1
    assert first.projections[-1]["name"] == 1


def _run_value(value):
    async def result():
        return value
    return result()


def test_g286_strict_loader_never_returns_partial_results(monkeypatch):
    monkeypatch.setattr(pace, "transactions_col", _Collection("bank", _docs()[:1]))
    monkeypatch.setattr(pace, "yapily_transactions_col", _Collection("yapily", error=RuntimeError("offline")))
    monkeypatch.setattr(pace, "get_category_kinds", lambda _uid: _run_value({"Eating Out": "spend"}))
    monkeypatch.setattr(pace, "build_spending_context", lambda *a, **kw: _run_value(SpendingContext(kinds={})))
    with pytest.raises(SpendTransactionLoadError):
        _run(pace.load_spend_txns("u", date(2026, 10, 1), require_complete=True))
    assert len(_run(pace.load_spend_txns("u", date(2026, 10, 1)))) == 1


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), None, False, True, "", "missing"])
def test_g286_strict_loader_rejects_invalid_bank_values(monkeypatch, invalid):
    row = {**_docs()[0], "amount": invalid}
    if invalid == "missing":
        row.pop("amount")
    monkeypatch.setattr(pace, "transactions_col", _Collection("bank", [row]))
    monkeypatch.setattr(pace, "yapily_transactions_col", _Collection("yapily"))
    monkeypatch.setattr(pace, "build_spending_context", lambda *a, **kw: _run_value(SpendingContext(kinds={})))
    with pytest.raises(SpendTransactionLoadError):
        _run(pace.load_spend_txns("u", date(2026, 10, 1), kind_map={}, require_complete=True))


def test_g286_resolve_due_strict_failure_makes_no_checkpoint_updates(monkeypatch):
    due = {"_id": ObjectId(), "user_id": "u", "status": "active", "ref": "Eating Out",
           "period_start": "2026-09-01", "period_end": "2026-09-30", "aim_amount": 50}
    class Col:
        def find(self, _query):
            return _Cursor([due])
        async def update_one(self, *_args, **_kwargs):
            pytest.fail("strict evidence failure must not update checkpoint")
    class _Cursor:
        def __init__(self, docs): self.docs = docs
        async def to_list(self, _limit): return self.docs
    monkeypatch.setattr(checkpoints, "checkpoints_col", Col())
    monkeypatch.setattr(checkpoints, "get_category_kinds", lambda _uid: _run_value({"Eating Out": "spend"}))
    async def fail(*_args, **_kwargs): raise SpendTransactionLoadError("offline")
    monkeypatch.setattr(checkpoints, "category_total_spend", fail)
    assert _run(checkpoints.resolve_due("u")) == []


def test_g286_evidence_endpoint_maps_loader_failure_to_503(monkeypatch):
    async def fail(*_args, **_kwargs): raise SpendTransactionLoadError("offline")
    monkeypatch.setattr(router, "checkpoint_evidence", fail)
    with pytest.raises(HTTPException) as exc:
        _run(router.get_checkpoint_evidence(str(ObjectId()), {"email": "u"}))
    assert exc.value.status_code == 503
