"""G230: a goal plan records (or infers) the current account it is paid from.

Covers the write path (static 422s for a card or an excluded account), the
read-only inference from transfers into the sink pot, the account-plans rows,
the pooled Safe to Spend invariant, and the allocation-gap engine.
"""
import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.routers.allocations as allocations
import app.routers.commitments as commitments
import app.services.account_plan_sources as sources
import app.services.companion as companion
from app.core import timeutil
from app.services.allocation_shortfall import compute_allocation_gaps, has_plan_source
from tests.test_g176_account_plan_sources import _Collection, _accounts

UID = "u"


def _goal(**extra):
    return {"_id": ObjectId(), "user_id": UID, "name": "Japan", "status": "active",
            "amount": 1000, "target_date": (timeutil.user_today() + timedelta(days=400)).isoformat(),
            "funding_pots": [{"account_id": "saving", "baseline": 0, "count_existing": False}],
            **extra}


class _Txns:
    def __init__(self, docs=()):
        self.docs = docs
        self.calls = 0

    def find(self, query, *args):
        self.calls += 1

        def ok(d):
            for k in ("user_id", "account_id", "transaction_type"):
                if k not in query:
                    continue
                v = query[k]
                if isinstance(v, dict) and "$in" in v:
                    if d.get(k) not in v["$in"]:
                        return False
                elif d.get(k) != v:
                    return False
            return True
        cursor = SimpleNamespace()

        async def to_list(_):
            return [dict(d) for d in self.docs if ok(d)]
        cursor.to_list = to_list
        return cursor


def _transfer_pair(amount=80.0, days_ago=3, source="current", sink="saving"):
    when = datetime.combine(timeutil.user_today() - timedelta(days=days_ago), datetime.min.time())
    return [
        {"user_id": UID, "account_id": source, "transaction_type": "debit",
         "amount": amount, "date": when, "description": "To Japan pot"},
        {"user_id": UID, "account_id": sink, "transaction_type": "credit",
         "amount": amount, "date": when, "description": "From current"},
    ]


def _rows(monkeypatch, goal, accounts=None, txns=(), slice_=80):
    monkeypatch.setattr(allocations, "allocations_col", _Collection())
    monkeypatch.setattr(allocations, "commitments_col", _Collection([goal]))
    monkeypatch.setattr(companion, "transactions_col", _Txns(txns))
    monkeypatch.setattr(companion, "yapily_transactions_col", _Txns())
    accts = accounts or {k: v for k, v in _accounts().items()}
    accts = {**accts, "saving": {**accts["saving"], "balance": 100}}

    async def amap(_): return accts
    async def cfg(_): return {"type": "calendar_month"}
    async def ledger(uid, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}
    async def slc(*_): return {"per_period_slice": slice_}
    monkeypatch.setattr(allocations, "owned_account_map", amap)
    monkeypatch.setattr(sources, "owned_account_map", amap)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    if slice_ is not None:
        monkeypatch.setattr(commitments, "_pot_progress_and_slice", slc)
    return asyncio.run(allocations.list_account_plans({"email": UID}))["items"]


def test_explicit_source_is_used_and_not_flagged_inferred(monkeypatch):
    rows = _rows(monkeypatch, _goal(source_account_id="current"), txns=_transfer_pair(source="manual"))
    row = rows[0]
    assert row["source_account_id"] == "current"
    assert row["source_basis"] == "chosen"
    assert row["inferred"] is False


def test_source_inferred_from_transfers_is_flagged_and_never_persisted(monkeypatch):
    goal = _goal()
    rows = _rows(monkeypatch, goal, txns=_transfer_pair())
    row = rows[0]
    assert row["source_account_id"] == "current"
    assert row["inferred"] is True
    assert row["source_basis"] == "recent-transfers"
    col = allocations.commitments_col
    assert "source_account_id" not in col.docs[0]  # a read never writes


def test_no_source_and_no_transfers_stays_pooled_only(monkeypatch):
    row = _rows(monkeypatch, _goal(), txns=[])[0]
    assert row["source_account_id"] is None
    assert row["inferred"] is False


def test_legacy_null_is_inferred(monkeypatch):
    row = _rows(monkeypatch, _goal(source_account_id=None), txns=_transfer_pair())[0]
    assert row["source_account_id"] == "current"
    assert row["inferred"] is True


def test_deliberate_not_set_is_never_inferred(monkeypatch):
    row = _rows(monkeypatch, _goal(source_account_id=None, source_unset=True), txns=_transfer_pair())[0]
    assert row["source_account_id"] is None
    assert row["inferred"] is False


def test_inference_skips_an_excluded_account(monkeypatch):
    accts = _accounts()
    accts["current"] = {**accts["current"], "include_in_safe_to_spend": False}
    row = _rows(monkeypatch, _goal(), accounts=accts, txns=_transfer_pair())[0]
    assert row["source_account_id"] is None


def test_eased_slice_is_the_amount_the_row_carries(monkeypatch):
    # The real _pot_progress_and_slice, with a live period_eased entry.
    _s, end = commitments.get_pay_period_for_date(timeutil.user_today(), {"type": "calendar_month"})
    doc = _goal(source_account_id="current", period_eased={
        end.isoformat(): {"contribution_pence": 3000, "usual_pence": 10000, "mode": "keep_date"}})
    row = _rows(monkeypatch, doc, slice_=None)[0]
    assert row["period_amount"] == 30 and row["remaining"] == 30
    plain = _rows(monkeypatch, _goal(source_account_id="current"), slice_=None)[0]
    assert plain["period_amount"] > 30


def test_unassigned_goals_are_inferred_with_one_query_per_collection(monkeypatch):
    goals = [_goal(name=f"G{i}", funding_pots=[{"account_id": "saving"}]) for i in range(3)]
    txns = _Txns(_transfer_pair())
    monkeypatch.setattr(companion, "transactions_col", txns)
    monkeypatch.setattr(companion, "yapily_transactions_col", _Txns())
    accts = {k: v for k, v in _accounts().items()}

    async def amap(_): return accts
    monkeypatch.setattr(sources, "owned_account_map", amap)
    import app.services.account_plan_sources as aps
    monkeypatch.setattr(aps, "owned_account_map", amap)
    items = [{} for _ in goals]
    asyncio.run(commitments._attach_sources(UID, items, goals))
    assert [i["source_account_id"] for i in items] == ["current"] * 3
    assert all(i["source_inferred"] for i in items)
    # one credit query and one debit query, whatever the number of goals
    assert txns.calls == 2


def test_validation_refuses_a_card_and_an_excluded_account_with_static_422s():
    accts = _accounts()
    accts["current"] = {**accts["current"], "include_in_safe_to_spend": False}
    with pytest.raises(HTTPException) as card:
        sources.validate_source_account("card", accts, {"saving"})
    assert card.value.status_code == 422
    assert card.value.detail == "A card cannot pay a plan."
    with pytest.raises(HTTPException) as excl:
        sources.validate_source_account("current", accts, {"saving"})
    assert excl.value.status_code == 422
    assert "current" not in excl.value.detail
    assert "Safe to Spend" in excl.value.detail


def test_create_writes_the_unset_marker_only_for_not_set(monkeypatch):
    col = _Collection()
    monkeypatch.setattr(commitments, "commitments_col", col)
    async def amap(_): return _accounts()
    async def pots(_): return []
    async def serial(*_): return {"ok": True}
    monkeypatch.setattr(commitments, "owned_account_map", amap)
    monkeypatch.setattr(commitments, "_build_pots", pots)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    body = {"name": "Trip", "amount": 100, "target_date": "2099-01-01"}
    mk = lambda name, **kw: asyncio.run(commitments.create_commitment({**body, "name": name, **kw}, user={"email": UID}))
    mk("A")
    mk("B", source_account_id=None, source_unset=True)
    mk("C", source_account_id="current")
    assert "source_account_id" not in col.docs[0] and "source_unset" not in col.docs[0]
    assert col.docs[1]["source_account_id"] is None and col.docs[1]["source_unset"] is True
    assert col.docs[2]["source_account_id"] == "current" and col.docs[2]["source_unset"] is False


def test_picking_an_account_clears_the_unset_marker(monkeypatch):
    doc = _goal(source_account_id=None, source_unset=True)
    col = _Collection([doc])
    monkeypatch.setattr(commitments, "commitments_col", col)
    async def amap(_): return _accounts()
    async def serial(*_): return {"ok": True}
    monkeypatch.setattr(commitments, "owned_account_map", amap)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serial)
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {"source_account_id": "current"}, {"email": UID}))
    assert col.docs[0]["source_account_id"] == "current"
    assert col.docs[0]["source_unset"] is False


def test_account_plans_goal_slice_counts_for_its_source_only():
    goal = {"kind": "goal", "active": True, "source_account_id": "current",
            "source_basis": "recent-transfers", "inferred": True, "record_id": "g",
            "name": "Japan", "period_amount": 80, "remaining": 80, "filled_amount": None,
            "destination_account_ids": ["saving"]}
    assert has_plan_source(goal)
    assert not has_plan_source({**goal, "source_account_id": None})


def test_allocation_gap_engine_never_raises_a_card_for_a_plan_slice_alone():
    goal = {"kind": "goal", "active": True, "source_account_id": "current",
            "source_basis": "recent-transfers", "inferred": True, "record_id": "g",
            "name": "Japan", "period_amount": 80, "remaining": 80, "filled_amount": None,
            "destination_account_ids": ["saving"]}
    # A plan slice alone: no set-aside to reduce, so no card.
    assert compute_allocation_gaps([goal], {"current": 10.0}) == []
    # An inferred goal slice is never offered for easing (it writes to the plan).
    assert compute_allocation_gaps([goal], {"current": 10.0}, require_allocation=False) == []
    chosen = {**goal, "source_basis": "chosen", "inferred": False}
    out = compute_allocation_gaps([chosen], {"current": 10.0}, require_allocation=False)
    assert out and out[0]["goals"][0]["id"] == "g"


def test_pooled_safe_to_spend_total_does_not_depend_on_the_source(monkeypatch):
    import app.routers.analytics as analytics
    from tests.test_cashflow_live_balance_overlay import UID as CASH_UID, _fixture

    _fixture(monkeypatch)
    seen = []
    # total_reserved_slices (the pooled figure behind Safe to Spend and the
    # Upcoming hero) takes only the user id: a plan's source cannot change it.
    import inspect
    import pathlib
    src = pathlib.Path(commitments.__file__).read_text()
    body = src[src.index("async def total_reserved_slices"):src.index("# ── Validation")]
    assert "source_account_id" not in body and "resolve_goal_source" not in body

    async def reserved(_uid):
        return 80, 1
    monkeypatch.setattr(commitments, "total_reserved_slices", reserved)
    for _ in range(2):
        cash = asyncio.run(analytics.get_cashflow({"email": CASH_UID}))
        seen.append((cash["plans_reserved"], cash["spendable_balance"]))
    assert seen[0] == seen[1] and seen[0][0] == 80
