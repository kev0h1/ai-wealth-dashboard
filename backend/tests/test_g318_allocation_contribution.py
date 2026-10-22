"""G318: an intended set-aside contribution is a current-period reserve only."""
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.allocations as allocations
from tests.test_allocations import (
    USER, UID, PERIOD_END, _FixedDate, _UpdateResult, _account, _create, _setup, _txn, FakeCol,
)


def run(awaitable):
    return asyncio.run(awaitable)


def made(monkeypatch, *, amount=100, txns=None):
    _setup(monkeypatch, accounts=[_account("monzo-1")], txns=txns)
    return _create(amount=amount)


def preview(item, pence, user=USER):
    return run(allocations.preview_allocation_contribution(item["id"], pence, user))


def save(item, pence, user=USER, checked=None):
    checked = checked or preview(item, pence, user)
    return run(allocations.set_allocation_contribution(item["id"], {
        "contribution_pence": pence,
        "period_end": checked["period_end"],
        "preview_token": checked["preview_token"],
    }, user))


def test_preview_and_save_keep_more_less_zero_and_exact_pennies(monkeypatch):
    item = made(monkeypatch)
    ordinary = preview(item, 10000)
    assert ordinary["unchanged"] is True
    assert save(item, 10000, checked=ordinary)["current_period_contribution"] is None
    for pence, expected in ((10025, 100.25), (5010, 50.10), (0, 0.0)):
        checked = preview(item, pence)
        assert checked["requested_contribution"] == expected
        assert checked["contribution"] == expected
        assert checked["reserved"] == expected
        assert checked["matched_this_period"] == 0
        assert checked["next_contribution"] == 100
        out = save(item, pence, checked=checked)
        assert out["amount_per_period"] == 100
        assert out["period_amount"] == expected
        assert out["remaining"] == expected
        assert out["current_period_contribution"] == {
            "period_start": ordinary["period_start"], "period_end": ordinary["period_end"],
            "requested_contribution": expected, "contribution": expected,
            "reserved": expected, "matched_this_period": 0.0,
            "next_contribution": 100.0, "unchanged": True,
        }


def test_matched_payment_reduces_manual_total_once_to_the_penny(monkeypatch):
    item = made(monkeypatch, txns=[_txn("monzo-1", 50.10, "credit")])
    checked = preview(item, 10025)
    assert checked["matched_this_period"] == 50.10
    assert checked["reserved"] == 50.15
    out = save(item, 10025, checked=checked)
    assert out["period_amount"] == 100.25
    assert out["remaining"] == 50.15


def test_manual_contribution_wins_over_legacy_reduction_then_lapses(monkeypatch):
    item = made(monkeypatch)
    doc = allocations.allocations_col.docs[0]
    doc["period_overrides"] = {PERIOD_END.isoformat(): 5000}
    assert save(item, 10025)["period_amount"] == 100.25
    with pytest.raises(HTTPException) as exc:
        run(allocations.set_period_override(item["id"], {"amount": 50}, USER))
    assert exc.value.status_code == 409 and exc.value.detail == "Change this period from your plan"
    current = run(allocations._serialise(doc, _FixedDate.today().replace(day=1), PERIOD_END))
    assert current["period_override"] == 50
    next_start = (_FixedDate.today().replace(day=1) + timedelta(days=32)).replace(day=1)
    next_end = (next_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    later = run(allocations._serialise(doc, next_start, next_end))
    assert later["period_amount"] == 100 and later["remaining"] == 100


def test_noop_confirmation_does_not_write_or_invalidate(monkeypatch):
    item = made(monkeypatch)
    save(item, 10025)
    calls = []

    async def invalidate(uid):
        calls.append(uid)

    monkeypatch.setattr(allocations.response_cache, "ainvalidate", invalidate)
    checked = preview(item, 10025)
    assert checked["unchanged"] is True
    assert save(item, 10025, checked=checked)["remaining"] == 100.25
    assert calls == []


def test_changed_recurring_amount_clears_the_live_manual_total(monkeypatch):
    item = made(monkeypatch)
    save(item, 10025)
    out = run(allocations.update_allocation(item["id"], {"amount_per_period": 80}, USER))
    assert out["amount_per_period"] == 80 and out["current_period_contribution"] is None
    assert out["remaining"] == 80
    assert allocations.allocations_col.docs[0].get("period_contributions", {}) == {}


def test_amount_edit_guards_an_absent_manual_contribution_against_a_race(monkeypatch):
    item = made(monkeypatch)
    col = allocations.allocations_col

    async def reject_if_absent_snapshot(query, _update, upsert=False):
        assert query["period_contributions"] == {"$exists": False}
        return _UpdateResult(0)

    monkeypatch.setattr(col, "update_one", reject_if_absent_snapshot)
    with pytest.raises(HTTPException) as exc:
        run(allocations.update_allocation(item["id"], {"amount_per_period": 80}, USER))
    assert exc.value.status_code == 409


def test_preview_save_rechecks_ownership_period_and_full_financial_snapshot(monkeypatch):
    item = made(monkeypatch)
    with pytest.raises(HTTPException) as wrong_owner:
        preview(item, 100, {"email": "other"})
    assert getattr(wrong_owner.value, "status_code", None) == 404

    checked = preview(item, 10025)
    allocations.allocations_col.docs[0]["amount_per_period"] = 80
    with pytest.raises(HTTPException) as stale:
        save(item, 10025, checked=checked)
    assert getattr(stale.value, "status_code", None) == 409


def test_save_cas_rejects_a_financial_change_after_preview_recheck(monkeypatch):
    item = made(monkeypatch)
    checked = preview(item, 10025)
    col = allocations.allocations_col
    write = col.update_one

    async def change_before_write(query, update, upsert=False):
        col.docs[0]["amount_per_period"] = 80
        return await write(query, update, upsert)

    monkeypatch.setattr(col, "update_one", change_before_write)
    with pytest.raises(HTTPException) as exc:
        save(item, 10025, checked=checked)
    assert exc.value.status_code == 409


@pytest.mark.parametrize("bad", [-1, True, 1.5, "100", None])
def test_contribution_requires_strict_integer_pence(monkeypatch, bad):
    item = made(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        preview(item, bad)
    assert exc.value.status_code == 422


def test_save_rechecks_a_changed_pay_config_immediately_before_writing(monkeypatch):
    item = made(monkeypatch)
    checked = preview(item, 10025)
    real = allocations._pay_cfg
    calls = 0

    async def changing_cfg(uid):
        nonlocal calls
        calls += 1
        cfg = await real(uid)
        return cfg if calls < 2 else {**cfg, "changed_during_review": True}

    monkeypatch.setattr(allocations, "_pay_cfg", changing_cfg)
    with pytest.raises(HTTPException) as exc:
        save(item, 10025, checked=checked)
    assert exc.value.status_code == 409


@pytest.mark.parametrize("change", [
    {"active": False},
    {"recurrence": "once"},
    {"effective_from": datetime.combine(_FixedDate.today() + timedelta(days=1), datetime.min.time())},
])
def test_only_active_current_recurring_allocations_accept_contributions(monkeypatch, change):
    item = made(monkeypatch)
    allocations.allocations_col.docs[0].update(change)
    with pytest.raises(HTTPException) as exc:
        preview(item, 100)
    assert getattr(exc.value, "status_code", None) == 409


def test_completed_once_allocation_cannot_take_a_contribution(monkeypatch):
    item = made(monkeypatch)
    doc = allocations.allocations_col.docs[0]
    past = _FixedDate.today() - timedelta(days=60)
    doc.update({
        "recurrence": "once",
        "created_period_start": past.replace(day=1),
        "created_period_end": past,
    })
    with pytest.raises(HTTPException) as exc:
        preview(item, 100)
    assert exc.value.status_code == 409


def test_manual_category_tracking_still_allows_an_explicit_contribution(monkeypatch):
    item = made(monkeypatch)
    doc = allocations.allocations_col.docs[0]
    doc.update({
        "tracking_mode": "manual",
        "fill_account_id": "",
        "category_tracking": {"category": "Savings", "destination_account_ids": []},
    })
    checked = preview(item, 5010)
    assert checked["matched_this_period"] == 0 and checked["reserved"] == 50.10
    assert save(item, 5010, checked=checked)["remaining"] == 50.10


def test_total_reserve_and_account_plan_row_keep_manual_pennies(monkeypatch):
    item = made(monkeypatch)
    save(item, 10025)
    assert run(allocations.total_reserved_remaining(UID)) == (100.25, 1)

    async def accounts(_uid):
        return {"monzo-1": {"_str_id": "monzo-1", "name": "Monzo", "balance": 0.0}}

    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "commitments_col", FakeCol([]))
    row = next(entry for entry in run(allocations.list_account_plans(USER))["items"]
               if entry["kind"] == "allocation")
    assert row["period_amount"] == 100.25 and row["remaining"] == 100.25


def test_recurring_edit_does_not_revive_an_older_hidden_reduction(monkeypatch):
    item = made(monkeypatch)
    doc = allocations.allocations_col.docs[0]
    doc["period_overrides"] = {PERIOD_END.isoformat(): 5000}
    save(item, 7500)
    result = run(allocations.update_allocation(item["id"], {"amount_per_period": 120}, USER))
    assert result["amount_per_period"] == 120 and result["period_amount"] == 120
    assert result["current_period_contribution"] is None and result["period_override"] is None
    assert PERIOD_END.isoformat() not in doc["period_overrides"]
