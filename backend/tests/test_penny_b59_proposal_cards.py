"""B59 step 3: proposal turns keep their card and show before and after."""
import asyncio
from datetime import datetime, timedelta

import app.routers.can_i as can_i
import app.services.penny_tools as penny_tools_module
from app.services import penny_conversations as svc
from app.services.penny_tools import execute_tool
from tests.penny_proposal_fakes import FakeCollection as _FakeCol
from tests.test_penny_conversations import cols  # noqa: F401  (fixture)
from tests.test_penny_proposals import (
    UID, _patch_get_categories, _patch_recat_txn_col, _txn_doc,
)
from tests.test_penny_proposals_twins import (
    _alloc_item, _commitment_item, _patch_list_allocations, _patch_list_commitments,
)

run = asyncio.run


def _store(monkeypatch):
    col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", col)
    monkeypatch.setattr(penny_tools_module, "preferences_col", _FakeCol([{"user_id": UID, "penny_agent_consent": "x"}]))
    return col


def test_recategorise_proposal_carries_before_after_and_entity(monkeypatch):
    col = _store(monkeypatch)
    _patch_recat_txn_col(monkeypatch, [_txn_doc(
        _id="T1", merchant="BRITISH GAS", desc="BRITISH GAS", amount=159.70, category="Bills", day="2026-10-01")])
    _patch_get_categories(monkeypatch)
    res = run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "T1", "new_category": "Eating Out", "scope": "just_once"}))
    assert (res["before"], res["after"], res["entity"]) == ("Bills", "Eating Out", "BRITISH GAS")
    assert col.docs[0]["before"] == "Bills" and col.docs[0]["after"] == "Eating Out"


def test_allocation_update_states_the_changed_field(monkeypatch):
    _store(monkeypatch)
    _patch_list_allocations(monkeypatch, [_alloc_item()])
    res = run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "Holiday", "amount_per_period": 150}))
    assert res["before"] == "£120.00 per period" and res["after"] == "£150.00 per period"
    assert res["entity"] == "Holiday"
    res = run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "Holiday", "paused": True}))
    assert (res["before"], res["after"]) == ("Active", "Paused")


def test_commitment_update_states_the_changed_field(monkeypatch):
    _store(monkeypatch)
    _patch_list_commitments(monkeypatch, [_commitment_item()])
    res = run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "Japan trip", "amount": 2500}))
    assert (res["before"], res["after"]) == ("£2,000.00", "£2,500.00")


def test_other_proposals_leave_before_and_after_empty(monkeypatch):
    _store(monkeypatch)
    _patch_list_allocations(monkeypatch, [_alloc_item()])
    res = run(execute_tool(UID, "propose_delete_allocation", {"allocation_ref": "Holiday"}))
    assert res["before"] is None and res["after"] is None


def test_clean_proposal_validates_and_caps():
    assert svc.clean_proposal({"proposal_id": "p", "summary": "s"}) is None
    block = svc.clean_proposal({"proposal_id": "p", "kind": "k", "summary": "s", "consequence": "c",
                                "before": "x" * 200, "after": None, "status": "bogus", "params": {"secret": 1}})
    assert len(block["before"]) == 80 and block["after"] is None
    assert block["status"] == "pending" and "params" not in block
    proposal = {"proposal_id": "p", "summary": "s", "consequence": "c"}
    assert svc.clean_turn("user", "hi", proposal=proposal).get("proposal") is None  # assistant turns only
    assert svc.clean_turn("assistant", "hi", proposal=proposal)["proposal"]["status"] == "pending"


def _proposal_result(pid="p1"):
    return {"reply": "File it. Changes only this transaction.", "headline": "File it", "proposal": {
        "proposal_id": pid, "kind": "recategorise_transaction", "summary": "File it", "consequence": "Changes only this transaction.",
        "before": "Bills", "after": "Software", "entity": "BRITISH GAS", "destructive": False,
        "params": {"transaction_id": "T1"}}}


def test_stored_proposal_turn_restores_with_live_status(cols, monkeypatch):  # noqa: F811
    convs, props = cols
    cid = run(svc.create_conversation(UID))["id"]
    now = datetime.now()
    props.docs.extend([
        {"_id": "p1", "user_id": UID, "executed_at": now, "cancelled_at": None, "expires_at": now + timedelta(minutes=5)},
        {"_id": "p2", "user_id": UID, "executed_at": None, "cancelled_at": now, "expires_at": now + timedelta(minutes=5)},
        {"_id": "p3", "user_id": UID, "executed_at": None, "cancelled_at": None, "expires_at": now - timedelta(minutes=1)},
        {"_id": "p4", "user_id": UID, "executed_at": None, "cancelled_at": None, "expires_at": now + timedelta(minutes=5)},
    ])
    for pid in ("p1", "p2", "p3", "p4"):
        run(can_i._record_exchange(UID, cid, "Put it under Software", _proposal_result(pid)))
    turns = [t for t in run(svc.get_conversation(UID, cid))["turns"] if t["role"] == "assistant"]
    assert [t["proposal"]["status"] for t in turns] == ["executed", "cancelled", "expired", "pending"]
    assert turns[0]["proposal"]["before"] == "Bills" and turns[0]["proposal"]["after"] == "Software"
    assert turns[0]["proposal_id"] == "p1" and "params" not in turns[0]["proposal"]
