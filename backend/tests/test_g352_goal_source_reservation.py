"""G352: goals are reserved at their resolved SOURCE account in the cover
plan's per-source reservation (`reserved_by_source`), alongside set-asides.

  - `_goal_source_slices` / `_reserved_for_goals` resolve each goal's source
    exactly as the payday plan's `_plan_source_needs` does (stored usable,
    else inferred, else the salary account flagged assumed; "Not set" and a
    stored-but-unusable account count nowhere);
  - through `compute_today_items`, a goal's slice lowers its source's standing
    `headroom` in `account_eligibility_out` by exactly that slice;
  - a set-aside and a goal on one source sum in pence (no float drift);
  - the payday plan reads `_plan_source_needs`, never `reserved_by_source`, so
    its figures are unchanged by the new reservation.
"""
import asyncio
from datetime import date

import app.db.collections as collections
import app.routers.commitments as commitments
import app.services.companion as companion
from tests.test_allocation_source_reservation import (
    DEST_ACCT, SRC_ACCT, UID, _account, _base_patch, _run_payday_plan, _shortfall_bill,
)
from tests.test_g317_reservation_readers import ProjectionGoalCol, _manual_goal

POT = "pot"
OTHER = "acc-other"


def _goal_world(monkeypatch, docs):
    col = ProjectionGoalCol(list(docs))
    monkeypatch.setattr(collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: date(2026, 11, 1))
    monkeypatch.setattr(companion.timeutil, "user_today", lambda: date(2026, 11, 1))

    async def ledger(_uid, *, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}

    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)


def _goal(name, pence, *, source=SRC_ACCT, unset=False):
    return {**_manual_goal(name, pence), "user_id": UID, "source_account_id": source, "source_unset": unset}


def _amap():
    return {a["_id"]: a for a in [
        _account(SRC_ACCT, 1051.0, "Monzo"), _account(DEST_ACCT, 0.0, "Premier"),
        _account(OTHER, 0.0, "Other"), _account(POT, 0.0, "Pot"),
    ]}


def _reserved(monkeypatch, docs, salary=SRC_ACCT, inferred=None):
    _goal_world(monkeypatch, docs)

    async def history(_uid, wanted, _a):
        return {k: inferred for k in wanted} if inferred else {}

    monkeypatch.setattr(companion, "infer_plan_sources_batch", history)
    return asyncio.run(companion._reserved_for_goals(
        UID, {"type": "calendar_month"}, {POT: 0.0}, salary, _amap(),
    ))


# ── _reserved_for_goals resolution ──────────────────────────────────────────

def test_stored_usable_source_reserves_its_slice(monkeypatch):
    assert _reserved(monkeypatch, [_goal("Japan", 10025, source=OTHER)]) == {OTHER: 100.25}


def test_inferred_source_reserves_its_slice(monkeypatch):
    doc = {**_goal("Japan", 10025), "source_account_id": None}
    assert _reserved(monkeypatch, [doc], inferred=OTHER) == {OTHER: 100.25}


def test_assumed_source_lands_on_the_salary_account(monkeypatch):
    doc = {**_goal("Japan", 10025), "source_account_id": None}
    assert _reserved(monkeypatch, [doc], salary=DEST_ACCT) == {DEST_ACCT: 100.25}
    assert _reserved(monkeypatch, [doc], salary=None) == {}


def test_no_income_candidate_means_assumed_goal_reserves_nothing_in_headroom(monkeypatch):
    base = _headroom(monkeypatch, [])[SRC_ACCT]["headroom"]
    doc = {**_goal("Japan", 10025), "source_account_id": None}
    assert _headroom(monkeypatch, [doc])[SRC_ACCT]["headroom"] == base


def test_not_set_goal_reserves_nothing(monkeypatch):
    doc = {**_goal("Japan", 10025), "source_account_id": None, "source_unset": True}
    assert _reserved(monkeypatch, [doc]) == {}


def test_stored_but_unusable_source_reserves_nothing(monkeypatch):
    assert _reserved(monkeypatch, [_goal("Japan", 10025, source="gone-account")]) == {}


def test_goals_on_one_source_sum_in_pence(monkeypatch):
    docs = [_goal("Japan", 1010), _goal("Kitchen", 2020), _goal("Car", 1)]
    assert _reserved(monkeypatch, docs) == {SRC_ACCT: 30.31}


def test_failure_fails_open_to_empty(monkeypatch):
    async def boom(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(companion, "_goal_source_slices", boom)
    assert asyncio.run(companion._reserved_for_goals(UID, {}, {}, None, {})) == {}


def test_goal_source_slices_shape(monkeypatch):
    _goal_world(monkeypatch, [_goal("Japan", 10025)])
    out = asyncio.run(companion._goal_source_slices(UID, {"type": "calendar_month"}, {POT: 0.0}, SRC_ACCT, _amap()))
    assert out == [{"source": SRC_ACCT, "name": "Japan", "amount": 100.25, "assumed": False, "to": [POT]}]


# ── `_plan_source_needs` unchanged after the refactor ───────────────────────

def test_plan_source_needs_output_unchanged(monkeypatch):
    _goal_world(monkeypatch, [_goal("Japan", 10025, source=OTHER)])

    async def listed(_uid):
        return []

    monkeypatch.setattr(companion, "list_active_allocations", listed)
    needs = asyncio.run(companion._plan_source_needs(
        UID, {"type": "calendar_month"}, {POT: 0.0}, SRC_ACCT, False,
        account_map=_amap(), internal_inflows=[],
    ))
    assert needs == {OTHER: {
        "amount": 100.25, "source_assumed": False,
        "reasons": [{"name": "Japan", "kind": "goal", "amount": 100.25,
                     "source_assumed": False, "to": [POT]}],
    }}


# ── Through compute_today_items: standing headroom ──────────────────────────

def _headroom(monkeypatch, docs, allocations=()):
    accounts = [_account(DEST_ACCT, 0.0, "Premier"), _account(SRC_ACCT, 1051.0, "Monzo")]
    _base_patch(monkeypatch, accounts=accounts, bills=[_shortfall_bill()], allocations_list=list(allocations))
    _goal_world(monkeypatch, docs)

    async def history(_uid, wanted, _a):
        return {}

    monkeypatch.setattr(companion, "infer_plan_sources_batch", history)
    elig: dict = {}
    asyncio.run(companion.compute_today_items(UID, persist=False, account_eligibility_out=elig))
    return elig


def test_goal_lowers_its_sources_headroom_by_exactly_its_slice(monkeypatch):
    base = _headroom(monkeypatch, [])[SRC_ACCT]["headroom"]
    with_goal = _headroom(monkeypatch, [_goal("Japan", 10025)])[SRC_ACCT]["headroom"]
    assert round(base - with_goal, 2) == 100.25


def test_not_set_goal_leaves_headroom_alone(monkeypatch):
    base = _headroom(monkeypatch, [])[SRC_ACCT]["headroom"]
    doc = {**_goal("Japan", 10025), "source_account_id": None, "source_unset": True}
    assert _headroom(monkeypatch, [doc])[SRC_ACCT]["headroom"] == base


def test_set_aside_and_goal_on_one_source_sum_in_pence(monkeypatch):
    base = _headroom(monkeypatch, [])[SRC_ACCT]["headroom"]
    alloc = {"fill_account_id": DEST_ACCT, "remaining": 0.1, "amount_per_period": 0.1,
             "active": True, "completed": False, "pending": False}
    both = _headroom(monkeypatch, [_goal("Japan", 20)], allocations=[alloc])[SRC_ACCT]["headroom"]
    assert round(base - both, 2) == 0.3  # 0.1 + 0.2 would drift as floats


# ── The payday plan is not double counted ───────────────────────────────────

def test_payday_plan_figures_unchanged_by_goal_reservation(monkeypatch):
    _goal_world(monkeypatch, [])
    plan_without, _ = _run_payday_plan(monkeypatch, allocations_list=[])

    async def reserve_a_lot(*_a, **_k):
        return {"acc-salary": 500.0}

    monkeypatch.setattr(companion, "_reserved_for_goals", reserve_a_lot)
    plan_with, _ = _run_payday_plan(monkeypatch, allocations_list=[])
    assert plan_without is not None and plan_with is not None
    assert plan_with["total"] == plan_without["total"]
    assert plan_with["salary"]["stays"] == plan_without["salary"]["stays"]
