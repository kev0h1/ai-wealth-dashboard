"""G375: `_goal_source_slices` must read each goal's schedule, so a scheduled
goal is sized at what its schedule asks for in the live pay period (G351),
not as equal slices. The fake collection drops any field the projection does
not ask for, so omitting `schedule` from the query fails these tests.
"""
import asyncio
from datetime import date

import app.db.collections as collections
import app.routers.commitments as commitments
import app.services.companion as companion
from tests.test_g317_reservation_readers import ProjectionGoalCol, _manual_goal
from tests.test_g352_goal_source_reservation import POT, SRC_ACCT, UID, _amap

CFG = {"type": "calendar_month"}

# Day-of-year steps of 4p rising 4p a day from 1 Jan: 1 to 30 Nov is days 305
# to 334, so 30 x (305 + 334) / 2 = 9,585 steps of 4p = 383.40.
SCHEDULE = {
    "type": "arithmetic", "start_pence": 4, "step_pence": 4, "step_unit": "day",
    "start_date": "2026-01-01", "count": 365, "end_date": None,
}


class ScheduleRequiredCol(ProjectionGoalCol):
    required_projection = ProjectionGoalCol.required_projection | {"schedule"}


def _world(monkeypatch, docs):
    col = ScheduleRequiredCol(list(docs))
    monkeypatch.setattr(collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: date(2026, 11, 1))
    monkeypatch.setattr(companion.timeutil, "user_today", lambda: date(2026, 11, 1))

    async def ledger(_uid, *, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}

    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)


def _goal(name, **extra):
    doc = {**_manual_goal(name, 1000), "user_id": UID, "source_account_id": SRC_ACCT,
           "source_unset": False, "amount": 2671.8, "target_date": "2026-12-31",
           "period_contributions": {}}
    doc.update(extra)
    return doc


def _slices(monkeypatch, docs):
    _world(monkeypatch, docs)
    return asyncio.run(companion._goal_source_slices(UID, CFG, {POT: 0.0}, SRC_ACCT, _amap()))


def test_scheduled_goal_is_sized_by_its_schedule(monkeypatch):
    out = _slices(monkeypatch, [_goal("4p challenge", schedule=SCHEDULE)])
    assert [(s["name"], s["amount"]) for s in out] == [("4p challenge", 383.4)]


def test_unscheduled_goal_keeps_the_equal_slice(monkeypatch):
    out = _slices(monkeypatch, [_goal("Plain")])
    assert len(out) == 1
    # Equal slice: 2,671.80 over this period and the one starting 1 Dec, not the schedule's 383.40.
    assert out[0]["amount"] != 383.4
    assert out[0]["amount"] > 383.4
