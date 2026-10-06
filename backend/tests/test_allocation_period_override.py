"""G217: reduce a set-aside for THIS pay period only (`period_overrides`).

The recurring `amount_per_period` never moves. The override is keyed by the
period's end date, so it lapses when the next period starts. Every reader goes
through `_serialise`, so the reserve in Safe to Spend, `remaining` and the
account sheet's plan rows all follow it.
"""
import asyncio
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

import app.routers.allocations as allocations
from tests.test_allocations import USER, UID, FakeCol, _FixedDate, _account, _create, _setup


def _set(alloc_id, amount):
    return asyncio.run(allocations.set_period_override(alloc_id, {"amount": amount}, USER))


def _made(monkeypatch, amount=200):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    return _create(amount=amount)


def test_reduce_this_period_changes_remaining_not_the_recurring_amount(monkeypatch):
    created = _made(monkeypatch)
    out = _set(created["id"], 161.6)
    assert out["amount_per_period"] == 200
    assert out["period_amount"] == 161.6 and out["period_override"] == 161.6
    assert out["remaining"] == 161.6
    reserved, _ = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 161.6  # Safe to Spend's reserve follows the override


def test_override_lapses_when_the_next_period_starts(monkeypatch):
    created = _made(monkeypatch)
    _set(created["id"], 120)
    doc = allocations.allocations_col.docs[0]
    nxt_start = _FixedDate.today().replace(day=1) + timedelta(days=32)
    nxt_start = nxt_start.replace(day=1)
    nxt_end = (nxt_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    out = asyncio.run(allocations._serialise(doc, nxt_start, nxt_end))
    assert out["period_override"] is None and out["period_amount"] == 200 and out["remaining"] == 200


def test_zero_skips_the_period_and_negative_is_refused(monkeypatch):
    created = _made(monkeypatch)
    assert _set(created["id"], 0)["remaining"] == 0
    with pytest.raises(HTTPException) as exc:
        _set(created["id"], -1)
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        _set(created["id"], "abc")


def test_clearing_restores_the_recurring_amount(monkeypatch):
    created = _made(monkeypatch)
    _set(created["id"], 50)
    out = asyncio.run(allocations.clear_period_override(created["id"], USER))
    assert out["period_override"] is None and out["remaining"] == 200


def test_override_is_per_user(monkeypatch):
    created = _made(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.set_period_override(created["id"], {"amount": 10}, {"email": "someone-else"}))
    assert exc.value.status_code == 404


def test_account_sheet_plan_row_follows_the_override(monkeypatch):
    created = _made(monkeypatch)
    _set(created["id"], 161.6)

    async def accounts(_):
        return {"monzo-1": {"_str_id": "monzo-1", "name": "Monzo", "balance": 0.0}}

    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "commitments_col", FakeCol([]))
    rows = asyncio.run(allocations.list_account_plans(USER))["items"]
    row = next(r for r in rows if r["kind"] == "allocation")
    assert row["period_amount"] == 161.6 and row["remaining"] == 161.6


def test_override_above_the_recurring_amount_is_refused_with_422(monkeypatch):
    created = _made(monkeypatch, amount=200)
    with pytest.raises(HTTPException) as exc:
        _set(created["id"], 200.01)
    assert exc.value.status_code == 422
    assert exc.value.detail == "A one-period amount cannot be more than the recurring amount"
    assert _set(created["id"], 200)["period_override"] == 200  # equal is allowed


def test_clear_with_another_users_id_is_404(monkeypatch):
    created = _made(monkeypatch)
    _set(created["id"], 100)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.clear_period_override(created["id"], {"email": "someone-else"}))
    assert exc.value.status_code == 404
    assert allocations.allocations_col.docs[0]["period_overrides"]  # untouched


def test_put_prunes_stale_earlier_period_keys(monkeypatch):
    created = _made(monkeypatch)
    allocations.allocations_col.docs[0]["period_overrides"] = {"2020-01-31": 5000, "2020-02-29": 6000}
    _set(created["id"], 100)
    keys = sorted(allocations.allocations_col.docs[0]["period_overrides"])
    assert len(keys) == 1 and keys[0] >= _FixedDate.today().isoformat()
