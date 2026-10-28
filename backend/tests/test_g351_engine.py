"""G351 step 2: the engine and every reservation reader follow a goal's schedule."""
import asyncio
from datetime import date

import pytest
from fastapi import HTTPException

import app.db.collections as collections
import app.routers.allocations as allocations
import app.routers.commitments as commitments
import app.services.companion as companion
from app.services import goal_schedule as gs
from tests.test_commitments_a86 import _doc
from tests.test_g176_account_plan_sources import _accounts, _Collection
from tests.test_g317_goal_contribution import GoalCol, USER, UID
from tests.test_g317_reservation_readers import ProjectionGoalCol
from tests.test_plan_easing import _setup, _today

CAL = {"type": "calendar_month"}
KEVIN = {"type": "arithmetic", "start_pence": 4, "step_pence": 4, "step_unit": "day",
         "start_date": "2026-01-01", "count": 365, "end_date": None}
NOV = date(2026, 11, 1)
NOV_PENCE = 4 * sum(range(305, 335))      # days 305..334 are November
DEC_PENCE = 4 * sum(range(335, 366))
DUE_BY_1_NOV = 4 * sum(range(1, 306))     # day 305 is 1 November


def run(awaitable):
    return asyncio.run(awaitable)


def challenge(monkeypatch, **extra):
    _today(monkeypatch, NOV)
    doc = _doc("Saving Challenge", amount=2671.80, target_date="2026-12-31", schedule=dict(KEVIN), **extra)
    _setup(monkeypatch, [doc])
    col = GoalCol([doc])
    monkeypatch.setattr(commitments, "commitments_col", col)
    return doc


def get(doc):
    return run(commitments._serialise_one_with_siblings(UID, doc))


def test_the_slice_is_the_schedule_period_sum_not_an_equal_share(monkeypatch):
    doc = challenge(monkeypatch)
    out = get(doc)
    assert NOV_PENCE == 38_340
    assert out["per_period_slice"] == NOV_PENCE / 100
    assert out["this_period_amount"] == NOV_PENCE / 100
    assert out["usual_slice"] == NOV_PENCE / 100 and out["planned_per_period_slice"] == NOV_PENCE / 100
    assert out["periods_left"] == 2
    assert out["next_periods"] == [{"start": "2026-12-01", "end": "2026-12-31", "amount": DEC_PENCE / 100}]
    assert out["scheduled_total"] == 2671.80
    assert out["schedule_label"] == "4p a day, rising by 4p a day, from 1 Jan 2026 for 365 days"
    assert out["schedule"]["type"] == "arithmetic"
    assert out["later_slice"] == DEC_PENCE / 100


def test_slice_never_exceeds_what_is_left(monkeypatch):
    doc = challenge(monkeypatch, contributed=2671.80 - 100)
    assert get(doc)["per_period_slice"] == 100


def test_easing_one_period_keeps_later_periods_on_the_schedule(monkeypatch):
    doc = challenge(monkeypatch)
    opts = run(commitments.preview_ease(str(doc["_id"]), 3000, USER))
    assert opts["keep_date"]["later_slice"] == DEC_PENCE / 100
    assert opts["keep_date"]["date_moves_periods"] == 0 and opts["keep_amount"]["date_moves_periods"] == 0
    out = run(commitments.ease_commitment(str(doc["_id"]), {"contribution_pence": 3000, "mode": "keep_date"}, USER))
    assert out["per_period_slice"] == 30 and out["eased_this_period"] == 30
    assert out["usual_slice"] == NOV_PENCE / 100
    assert out["later_slice"] == DEC_PENCE / 100
    assert out["next_periods"][0]["amount"] == DEC_PENCE / 100
    assert doc["target_date"] == "2026-12-31"
    assert run(commitments.total_reserved_slices(UID))[0] == 30


def test_manual_total_overrides_this_period_only(monkeypatch):
    doc = challenge(monkeypatch)
    checked = run(commitments.preview_goal_contribution(str(doc["_id"]), 10000, USER))
    assert checked["later_contribution"] == DEC_PENCE / 100 and checked["reserved"] == 100
    out = run(commitments.set_goal_contribution(str(doc["_id"]), {
        "contribution_pence": 10000, "period_end": checked["period_end"],
        "preview_token": checked["preview_token"]}, USER))
    assert out["per_period_slice"] == 100 and out["usual_slice"] == NOV_PENCE / 100


@pytest.mark.parametrize("contributed,expected", [(DUE_BY_1_NOV / 100, True), (100.0, False), (2000.0, True)])
def test_on_track_is_measured_against_the_schedule(monkeypatch, contributed, expected):
    doc = challenge(monkeypatch, contributed=contributed)
    out = get(doc)
    assert out["on_track"] is expected
    assert out["planned_to_date"] == DUE_BY_1_NOV / 100


def test_reservation_readers_use_the_scheduled_figure(monkeypatch):
    doc = challenge(monkeypatch)
    assert run(commitments.total_reserved_slices(UID))[0] == NOV_PENCE / 100

    pot_doc = _doc("Saving Challenge", amount=2671.80, target_date="2026-12-31", schedule=dict(KEVIN),
                   funding_pots=[{"account_id": "pot", "kind": "connected", "baseline": 0, "count_existing": False}])
    col = ProjectionGoalCol([pot_doc])
    monkeypatch.setattr(collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(companion.timeutil, "user_today", lambda: NOV)

    async def ledger(_uid, *, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}

    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    result = run(companion._active_commitment_slices(UID, CAL, {"pot": 0.0}))
    assert result == {"pot": {"slice_total": NOV_PENCE / 100, "names": ["Saving Challenge"]}}


def test_account_plan_goal_row_carries_the_scheduled_period_amount(monkeypatch):
    doc = challenge(monkeypatch, source_account_id="current",
                    funding_pots=[{"account_id": "pot", "baseline": 0, "count_existing": False}])
    monkeypatch.setattr(allocations, "commitments_col", _Collection([doc]))
    monkeypatch.setattr(allocations, "allocations_col", _Collection())

    async def accounts(_uid):
        return {"current": _accounts()["current"], "pot": {**_accounts()["saving"], "balance": 0}}

    async def config(_uid):
        return CAL

    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", config)
    row = run(allocations.list_account_plans(USER))["items"][0]
    assert row["record_id"] == str(doc["_id"])
    assert row["period_amount"] == NOV_PENCE / 100


def test_create_and_patch_validate_the_schedule(monkeypatch):
    _today(monkeypatch, NOV)
    _setup(monkeypatch, [])
    monkeypatch.setattr(commitments, "commitments_col", GoalCol([]))
    sched = {**KEVIN, "start_date": "2026-11-01", "count": 30}
    out = run(commitments.create_commitment({"name": "Challenge", "schedule": sched}, None, USER))
    assert out["amount"] == 4 * sum(range(1, 31)) / 100 and out["target_date"] == "2026-11-30"
    assert out["this_period_amount"] == out["amount"] and out["periods_left"] == 1
    with pytest.raises(HTTPException) as exc:
        run(commitments.create_commitment({"name": "Bad", "schedule": {**sched, "start_pence": 0}}, None, USER))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        run(commitments.create_commitment({"name": "Old", "schedule": {**KEVIN, "count": 30}}, None, USER))
    assert exc.value.status_code == 400  # ended in January, already finished


def test_patch_changes_the_schedule_and_refuses_a_conflicting_amount(monkeypatch):
    doc = challenge(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        run(commitments.update_commitment(str(doc["_id"]), {"amount": 500}, USER))
    assert exc.value.status_code == 400 and "schedule" in exc.value.detail
    # An unchanged amount and date, as the edit sheet sends them, is a no-op.
    run(commitments.update_commitment(str(doc["_id"]), {"name": "Challenge", "amount": 2671.80, "target_date": "2026-12-31"}, USER))
    new = {**KEVIN, "start_pence": 10, "step_pence": 0, "start_date": "2026-11-01", "count": 40}
    out = run(commitments.update_commitment(str(doc["_id"]), {"schedule": new}, USER))
    assert out["amount"] == 4.00 and out["target_date"] == "2026-12-10"
    assert out["this_period_amount"] == 3.00
