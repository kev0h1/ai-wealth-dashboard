"""Tests for B14 (B12 stage 1, 2026-09-08): edit/delete propose-tool twins
for the covered creates — planned one-offs, allocations, commitments,
checkpoints (delete only, no PATCH exists), and recurring-occurrence
skip/edit/clear-override. See docs/penny/action-inventory.md and
PENNY_TOOLS.md's "Write tools (propose-only)" table for the doctrine these
extend; app.services.penny_tools' own module docstring for the
IMPORT RULE (never import app.routers.can_i from penny_tools.py).

Same fakes/conventions as tests/test_penny_proposals.py (no mongomock in
this environment — `_FakeCol` stands in for a Motor collection), copied
rather than imported so this file stays independently runnable. CORE
PRINCIPLE under test throughout, unchanged from that file: Penny PROPOSES,
never executes — every new `_exec_propose_*` executor here must return a
stored proposal dict (never mutate real data), and only
POST /penny/proposals/{id}/execute (replaying the SAME router-level
function the app's own confirm sheet calls) ever turns one into a real
write.
"""
import asyncio
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.can_i as can_i_module
import app.services.penny_tools as penny_tools_module
from app.services.penny_tools import execute_tool

UID = "kevin"


class _FakeCol:
    """Twin of test_penny_proposals.py's own _FakeCol — enough of
    find_one()/insert_one()/update_one() (exact-key-equality query
    matching, sufficient for every use here) to drive the real
    proposal/execute code without touching real Mongo."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


def _live_doc(kind, params, **overrides):
    now = datetime.now()
    doc = {
        "_id": "p-test", "user_id": UID, "kind": kind, "params": params,
        "summary": "s", "consequence": "c",
        "created_at": now, "expires_at": now + timedelta(minutes=15),
        "executed_at": None, "result": None, "cancelled_at": None,
    }
    doc.update(overrides)
    return doc


def _patch_consented_prefs(monkeypatch) -> "_FakeCol":
    fake_prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}])
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)
    return fake_prefs


# ═════════════════════════════════════════════════════════════════════════
# Section A — propose_update_planned / propose_delete_planned
# ═════════════════════════════════════════════════════════════════════════

def _planned_item(id_="pl1", name="Car service", amount=150.0, date_str=None):
    return {
        "id": id_, "name": name, "amount": amount,
        "date": date_str or (date.today() + timedelta(days=10)).isoformat(),
        "account_id": None, "created_at": None, "created_via": None,
    }


def _patch_list_planned(monkeypatch, items):
    import app.routers.planned as planned_module

    async def fake_list(user):
        return items

    monkeypatch.setattr(planned_module, "list_planned_expenses", fake_list)


def test_propose_update_planned_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    future = (date.today() + timedelta(days=10)).isoformat()
    _patch_list_planned(monkeypatch, [_planned_item(date_str=future)])

    result = asyncio.run(execute_tool(UID, "propose_update_planned", {
        "planned_ref": "Car service", "amount": 180,
    }))

    assert result["proposal"] is True
    assert result["kind"] == "update_planned"
    assert result["params"] == {"planned_id": "pl1", "amount": 180.0}
    assert "£150" in result["summary"] and "£180" in result["summary"]


def test_propose_update_planned_by_id(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_planned(monkeypatch, [_planned_item()])

    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "pl1", "name": "Car MOT"}))
    assert result["proposal"] is True
    assert result["params"]["name"] == "Car MOT"


def test_propose_update_planned_no_fields_is_tool_error(monkeypatch):
    _patch_list_planned(monkeypatch, [_planned_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "Car service"}))
    assert "error" in result


def test_propose_update_planned_negative_amount_is_tool_error(monkeypatch):
    _patch_list_planned(monkeypatch, [_planned_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "Car service", "amount": -5}))
    assert "error" in result


def test_propose_update_planned_past_date_is_tool_error(monkeypatch):
    _patch_list_planned(monkeypatch, [_planned_item()])
    past = (date.today() - timedelta(days=5)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "Car service", "date": past}))
    assert "error" in result


def test_propose_update_planned_grandfathered_same_date_ok(monkeypatch):
    # A rolled-past-due item can be re-saved unchanged on its own (now past)
    # date, exactly like the router's own grandfathering.
    past = (date.today() - timedelta(days=2)).isoformat()
    _patch_list_planned(monkeypatch, [_planned_item(date_str=past)])
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)

    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "Car service", "date": past}))
    assert result["proposal"] is True


def test_propose_update_planned_ambiguous_name(monkeypatch):
    _patch_list_planned(monkeypatch, [
        _planned_item(id_="pl1", name="Car service"),
        _planned_item(id_="pl2", name="Car servicing plan"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "car serv", "amount": 50}))
    assert result.get("ambiguous") is True
    assert len(result["matches"]) == 2


def test_propose_update_planned_unknown_ref_is_tool_error(monkeypatch):
    _patch_list_planned(monkeypatch, [_planned_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_planned", {"planned_ref": "nonexistent", "amount": 10}))
    assert "error" in result


def test_propose_delete_planned_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_planned(monkeypatch, [_planned_item()])

    result = asyncio.run(execute_tool(UID, "propose_delete_planned", {"planned_ref": "Car service"}))
    assert result["proposal"] is True
    assert result["kind"] == "delete_planned"
    assert result["params"] == {"planned_id": "pl1"}
    assert "Car service" in result["summary"]


def test_execute_update_planned_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("update_planned", {"planned_id": "pl1", "amount": 180.0})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.planned as planned_module

    captured = {}

    async def fake_update(planned_id, body, user):
        captured["planned_id"] = planned_id
        captured["body"] = body
        return {"id": planned_id, "amount": body["amount"]}

    monkeypatch.setattr(planned_module, "update_planned_expense", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"planned_id": "pl1", "body": {"amount": 180.0}}
    assert result["result"]["amount"] == 180.0


def test_execute_delete_planned_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_planned", {"planned_id": "pl1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.planned as planned_module

    captured = {}

    async def fake_delete(planned_id, user):
        captured["planned_id"] = planned_id
        return {"ok": True}

    monkeypatch.setattr(planned_module, "delete_planned_expense", fake_delete)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"planned_id": "pl1"}
    assert result["result"] == {"ok": True}


# ═════════════════════════════════════════════════════════════════════════
# Section B — propose_update_allocation / propose_delete_allocation
# ═════════════════════════════════════════════════════════════════════════

def _alloc_item(id_="a1", name="Holiday", amount_per_period=120.0, active=True,
                fill_account_id="acc1", match_type="description_contains", match_value="Saving"):
    return {
        "id": id_, "name": name, "amount_per_period": amount_per_period,
        "fill_account_id": fill_account_id, "match_type": match_type, "match_value": match_value,
        "fill_display_name": match_value, "effective_from": date.today().isoformat(),
        "recurrence": "every_period", "completed": False, "pending": False, "active": active,
        "filled_this_period": 0.0, "remaining": amount_per_period,
        "period_start": date.today().isoformat(), "period_end": date.today().isoformat(),
        "created_via": None,
    }


def _patch_list_allocations(monkeypatch, items, *, conflicts=False):
    import app.routers.allocations as allocations_module

    async def fake_list(user):
        return {"items": items}

    async def fake_conflicts(uid, fill_account_id, match_type, match_value, exclude_id=None):
        return conflicts

    monkeypatch.setattr(allocations_module, "list_allocations", fake_list)
    monkeypatch.setattr(allocations_module, "_conflicts", fake_conflicts)


def test_propose_update_allocation_pause_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_allocations(monkeypatch, [_alloc_item()])

    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "Holiday", "paused": True}))
    assert result["proposal"] is True
    assert result["kind"] == "update_allocation"
    assert result["params"] == {"allocation_id": "a1", "active": False}
    assert "Pause" in result["summary"]
    assert "£120" in result["summary"]


def test_propose_update_allocation_resume_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_allocations(monkeypatch, [_alloc_item(active=False)])

    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "Holiday", "paused": False}))
    assert result["proposal"] is True
    assert result["params"] == {"allocation_id": "a1", "active": True}
    assert "Resume" in result["summary"]


def test_propose_update_allocation_amount_and_recurrence_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_allocations(monkeypatch, [_alloc_item()])

    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {
        "allocation_ref": "Holiday", "amount_per_period": 150, "recurrence": "once",
    }))
    assert result["proposal"] is True
    assert result["params"]["amount_per_period"] == 150.0
    assert result["params"]["recurrence"] == "once"


def test_propose_update_allocation_no_fields_is_tool_error(monkeypatch):
    _patch_list_allocations(monkeypatch, [_alloc_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "Holiday"}))
    assert "error" in result


def test_propose_update_allocation_invalid_amount_is_tool_error(monkeypatch):
    _patch_list_allocations(monkeypatch, [_alloc_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {
        "allocation_ref": "Holiday", "amount_per_period": 0,
    }))
    assert "error" in result


def test_propose_update_allocation_invalid_recurrence_is_tool_error(monkeypatch):
    _patch_list_allocations(monkeypatch, [_alloc_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {
        "allocation_ref": "Holiday", "recurrence": "monthly",
    }))
    assert "error" in result


def test_propose_update_allocation_conflict_is_tool_error(monkeypatch):
    _patch_list_allocations(monkeypatch, [_alloc_item(active=False)], conflicts=True)
    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "Holiday", "paused": False}))
    assert "error" in result
    assert "already fills" in result["error"]


def test_propose_update_allocation_ambiguous_name(monkeypatch):
    _patch_list_allocations(monkeypatch, [
        _alloc_item(id_="a1", name="Holiday"),
        _alloc_item(id_="a2", name="Holiday fund"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "holiday", "paused": True}))
    assert result.get("ambiguous") is True
    assert len(result["matches"]) == 2


def test_propose_update_allocation_unknown_ref_is_tool_error(monkeypatch):
    _patch_list_allocations(monkeypatch, [_alloc_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_allocation", {"allocation_ref": "nope", "paused": True}))
    assert "error" in result


def test_propose_delete_allocation_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_allocations(monkeypatch, [_alloc_item()])

    result = asyncio.run(execute_tool(UID, "propose_delete_allocation", {"allocation_ref": "Holiday"}))
    assert result["proposal"] is True
    assert result["kind"] == "delete_allocation"
    assert result["params"] == {"allocation_id": "a1"}
    assert result["summary"] == "Delete the Holiday envelope (£120 per pay period)"


def test_execute_update_allocation_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("update_allocation", {"allocation_id": "a1", "active": False})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.allocations as allocations_module

    captured = {}

    async def fake_update(allocation_id, body, user):
        captured["allocation_id"] = allocation_id
        captured["body"] = body
        return {"id": allocation_id, "active": body["active"]}

    monkeypatch.setattr(allocations_module, "update_allocation", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"allocation_id": "a1", "body": {"active": False}}
    assert result["result"]["active"] is False


def test_execute_delete_allocation_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_allocation", {"allocation_id": "a1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.allocations as allocations_module

    captured = {}

    async def fake_delete(allocation_id, user):
        captured["allocation_id"] = allocation_id
        return {"id": allocation_id, "deleted": True}

    monkeypatch.setattr(allocations_module, "delete_allocation", fake_delete)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"allocation_id": "a1"}
    assert result["result"]["deleted"] is True


# ═════════════════════════════════════════════════════════════════════════
# Section C — propose_update_commitment / propose_delete_commitment
# ═════════════════════════════════════════════════════════════════════════

def _commitment_item(id_="c1", name="Japan trip", amount=2000.0, target_date=None):
    return {
        "id": id_, "name": name, "amount": amount,
        "target_date": target_date or (date.today() + timedelta(days=200)).isoformat(),
        "status": "active",
    }


def _patch_list_commitments(monkeypatch, items):
    import app.routers.commitments as commitments_module

    async def fake_list(user):
        return {"items": items}

    monkeypatch.setattr(commitments_module, "list_commitments", fake_list)


def test_propose_update_commitment_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_list_commitments(monkeypatch, [_commitment_item()])

    result = asyncio.run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "Japan trip", "amount": 2500}))
    assert result["proposal"] is True
    assert result["kind"] == "update_commitment"
    assert result["params"] == {"commitment_id": "c1", "amount": 2500.0}
    assert "£2,000" in result["summary"] and "£2,500" in result["summary"]


def test_propose_update_commitment_no_fields_is_tool_error(monkeypatch):
    _patch_list_commitments(monkeypatch, [_commitment_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "Japan trip"}))
    assert "error" in result


def test_propose_update_commitment_invalid_amount_is_tool_error(monkeypatch):
    _patch_list_commitments(monkeypatch, [_commitment_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "Japan trip", "amount": -1}))
    assert "error" in result


def test_propose_update_commitment_past_target_date_is_tool_error(monkeypatch):
    _patch_list_commitments(monkeypatch, [_commitment_item()])
    past = (date.today() - timedelta(days=3)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_update_commitment", {
        "commitment_ref": "Japan trip", "target_date": past,
    }))
    assert "error" in result


def test_propose_update_commitment_ambiguous_name(monkeypatch):
    _patch_list_commitments(monkeypatch, [
        _commitment_item(id_="c1", name="Japan trip"),
        _commitment_item(id_="c2", name="Japan trip 2027"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "japan", "amount": 100}))
    assert result.get("ambiguous") is True
    assert len(result["matches"]) == 2


def test_propose_update_commitment_unknown_ref_is_tool_error(monkeypatch):
    _patch_list_commitments(monkeypatch, [_commitment_item()])
    result = asyncio.run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "nope", "amount": 100}))
    assert "error" in result


def test_propose_delete_commitment_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    target = (date.today() + timedelta(days=200)).isoformat()
    _patch_list_commitments(monkeypatch, [_commitment_item(target_date=target)])

    result = asyncio.run(execute_tool(UID, "propose_delete_commitment", {"commitment_ref": "Japan trip"}))
    assert result["proposal"] is True
    assert result["kind"] == "delete_commitment"
    assert result["params"] == {"commitment_id": "c1"}
    assert "Cancel" in result["summary"] and "Japan trip" in result["summary"]


def test_execute_update_commitment_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("update_commitment", {"commitment_id": "c1", "amount": 2500.0})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.commitments as commitments_module

    captured = {}

    async def fake_update(commitment_id, body, user):
        captured["commitment_id"] = commitment_id
        captured["body"] = body
        return {"id": commitment_id, "amount": body["amount"]}

    monkeypatch.setattr(commitments_module, "update_commitment", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"commitment_id": "c1", "body": {"amount": 2500.0}}
    assert result["result"]["amount"] == 2500.0


def test_execute_delete_commitment_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_commitment", {"commitment_id": "c1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.commitments as commitments_module

    captured = {}

    async def fake_delete(commitment_id, user):
        captured["commitment_id"] = commitment_id
        return {"id": commitment_id, "status": "cancelled"}

    monkeypatch.setattr(commitments_module, "delete_commitment", fake_delete)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"commitment_id": "c1"}
    assert result["result"]["status"] == "cancelled"


# ═════════════════════════════════════════════════════════════════════════
# Section D — propose_delete_checkpoint (no PATCH exists — delete twin only)
# ═════════════════════════════════════════════════════════════════════════

def _checkpoint_item(id_="cp1", ref="Groceries", aim_amount=150.0):
    return {"id": id_, "ref": ref, "aim_amount": aim_amount, "basis": "usual_rate",
            "period_start": date.today().isoformat(), "period_end": date.today().isoformat(),
            "status": "active", "result_amount": None, "resolved_at": None}


def _patch_active_checkpoints(monkeypatch, items):
    async def fake_list_active(uid):
        return items

    monkeypatch.setattr(penny_tools_module, "_list_active_checkpoints", fake_list_active)


def test_propose_delete_checkpoint_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_active_checkpoints(monkeypatch, [_checkpoint_item()])

    result = asyncio.run(execute_tool(UID, "propose_delete_checkpoint", {"checkpoint_ref": "Groceries"}))
    assert result["proposal"] is True
    assert result["kind"] == "delete_checkpoint"
    assert result["params"] == {"checkpoint_id": "cp1"}
    assert "Groceries" in result["summary"]


def test_propose_delete_checkpoint_by_id(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_active_checkpoints(monkeypatch, [_checkpoint_item()])

    result = asyncio.run(execute_tool(UID, "propose_delete_checkpoint", {"checkpoint_ref": "cp1"}))
    assert result["proposal"] is True


def test_propose_delete_checkpoint_ambiguous(monkeypatch):
    _patch_active_checkpoints(monkeypatch, [
        _checkpoint_item(id_="cp1", ref="Eating Out"),
        _checkpoint_item(id_="cp2", ref="Eating Out Delivery"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_delete_checkpoint", {"checkpoint_ref": "eating"}))
    assert result.get("ambiguous") is True
    assert len(result["matches"]) == 2


def test_propose_delete_checkpoint_not_found_is_tool_error(monkeypatch):
    _patch_active_checkpoints(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_delete_checkpoint", {"checkpoint_ref": "Groceries"}))
    assert "error" in result


def test_execute_delete_checkpoint_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_checkpoint", {"checkpoint_id": "cp1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.checkpoints as checkpoints_module

    captured = {}

    async def fake_delete(checkpoint_id, user):
        captured["checkpoint_id"] = checkpoint_id
        return {"ok": True}

    monkeypatch.setattr(checkpoints_module, "delete_checkpoint", fake_delete)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"checkpoint_id": "cp1"}
    assert result["result"] == {"ok": True}


# ═════════════════════════════════════════════════════════════════════════
# Section E — propose_skip_occurrence / propose_edit_occurrence /
# propose_clear_override
# ═════════════════════════════════════════════════════════════════════════

def _patch_recurring_series(monkeypatch, names):
    async def fake_recurring(uid):
        return {"series": [{"name": n} for n in names]}

    monkeypatch.setattr(penny_tools_module, "_exec_get_recurring_payments", fake_recurring)


def _patch_occurrence_detail(monkeypatch, detail):
    async def fake_detail(uid, key, date_str):
        return detail

    monkeypatch.setattr(penny_tools_module, "_find_occurrence_detail", fake_detail)


def test_propose_skip_occurrence_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_recurring_series(monkeypatch, ["Netflix"])
    _patch_occurrence_detail(monkeypatch, {"amount": 10.0})

    result = asyncio.run(execute_tool(UID, "propose_skip_occurrence", {"key_or_name": "Netflix", "date": "2026-09-14"}))
    assert result["proposal"] is True
    assert result["kind"] == "skip_occurrence"
    assert result["params"] == {"key": "Netflix", "date": "2026-09-14"}
    assert "Netflix" in result["summary"] and "£10" in result["summary"]


def test_propose_skip_occurrence_no_detail_falls_back(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_recurring_series(monkeypatch, ["Netflix"])
    _patch_occurrence_detail(monkeypatch, None)

    result = asyncio.run(execute_tool(UID, "propose_skip_occurrence", {"key_or_name": "Netflix", "date": "2026-09-14"}))
    assert result["proposal"] is True
    assert "Netflix" in result["summary"]


def test_propose_skip_occurrence_invalid_date_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Netflix"])
    result = asyncio.run(execute_tool(UID, "propose_skip_occurrence", {"key_or_name": "Netflix", "date": "not-a-date"}))
    assert "error" in result


def test_propose_skip_occurrence_missing_key_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_skip_occurrence", {"key_or_name": "", "date": "2026-09-14"}))
    assert "error" in result


def test_propose_skip_occurrence_ambiguous_key(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Netflix", "Netgear Sub"])
    result = asyncio.run(execute_tool(UID, "propose_skip_occurrence", {"key_or_name": "net", "date": "2026-09-14"}))
    assert result.get("ambiguous") is True


def test_propose_skip_occurrence_unknown_key_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Netflix"])
    result = asyncio.run(execute_tool(UID, "propose_skip_occurrence", {"key_or_name": "Spotify", "date": "2026-09-14"}))
    assert "error" in result


def test_propose_edit_occurrence_happy_path_amount(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_recurring_series(monkeypatch, ["Car insurance"])
    _patch_occurrence_detail(monkeypatch, {"amount": 320.0})

    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "Car insurance", "date": "2026-10-14", "new_amount": 350, "scope": "one",
    }))
    assert result["proposal"] is True
    assert result["kind"] == "edit_occurrence"
    assert result["params"] == {
        "key": "Car insurance", "date": "2026-10-14", "scope": "one",
        "new_date": None, "new_amount": 350.0,
    }
    assert result["summary"] == "Change the Car insurance payment on 14 Oct from £320 to £350"


def test_propose_edit_occurrence_happy_path_date(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_recurring_series(monkeypatch, ["Car insurance"])
    _patch_occurrence_detail(monkeypatch, None)

    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "Car insurance", "date": "2026-10-14", "new_date": "2026-10-20", "scope": "future",
    }))
    assert result["proposal"] is True
    assert result["params"]["new_date"] == "2026-10-20"
    assert result["params"]["scope"] == "future"
    assert "every future occurrence" in result["summary"]


def test_propose_edit_occurrence_invalid_scope_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Car insurance"])
    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "Car insurance", "date": "2026-10-14", "new_amount": 350, "scope": "all",
    }))
    assert "error" in result


def test_propose_edit_occurrence_no_changes_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Car insurance"])
    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "Car insurance", "date": "2026-10-14", "scope": "one",
    }))
    assert "error" in result


def test_propose_edit_occurrence_negative_amount_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Car insurance"])
    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "Car insurance", "date": "2026-10-14", "new_amount": -10, "scope": "one",
    }))
    assert "error" in result


def test_propose_edit_occurrence_invalid_new_date_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Car insurance"])
    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "Car insurance", "date": "2026-10-14", "new_date": "not-a-date", "scope": "one",
    }))
    assert "error" in result


def test_propose_edit_occurrence_ambiguous_key(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Netflix", "Netgear Sub"])
    result = asyncio.run(execute_tool(UID, "propose_edit_occurrence", {
        "key_or_name": "net", "date": "2026-09-14", "new_amount": 10, "scope": "one",
    }))
    assert result.get("ambiguous") is True


def test_propose_clear_override_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_recurring_series(monkeypatch, ["Netflix"])

    result = asyncio.run(execute_tool(UID, "propose_clear_override", {"key_or_name": "Netflix", "date": "2026-09-14"}))
    assert result["proposal"] is True
    assert result["kind"] == "clear_override"
    assert result["params"] == {"key": "Netflix", "date": "2026-09-14"}


def test_propose_clear_override_missing_date_is_tool_error(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Netflix"])
    result = asyncio.run(execute_tool(UID, "propose_clear_override", {"key_or_name": "Netflix", "date": ""}))
    assert "error" in result


def test_propose_clear_override_non_iso_date_still_accepted(monkeypatch):
    # Mirrors app.routers.analytics.clear_override's own (lack of)
    # validation exactly — that endpoint never checks the date is a valid
    # ISO date, only that it's non-blank, so neither does this tool.
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_recurring_series(monkeypatch, ["Netflix"])

    result = asyncio.run(execute_tool(UID, "propose_clear_override", {"key_or_name": "Netflix", "date": "whenever"}))
    assert result["proposal"] is True
    assert result["params"] == {"key": "Netflix", "date": "whenever"}


def test_propose_clear_override_ambiguous_key(monkeypatch):
    _patch_recurring_series(monkeypatch, ["Netflix", "Netgear Sub"])
    result = asyncio.run(execute_tool(UID, "propose_clear_override", {"key_or_name": "net", "date": "2026-09-14"}))
    assert result.get("ambiguous") is True


def test_execute_skip_occurrence_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("skip_occurrence", {"key": "Netflix", "date": "2026-09-14"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.analytics as analytics_module

    captured = {}

    async def fake_skip(body, user):
        captured.update(body)
        return {"ok": True}

    monkeypatch.setattr(analytics_module, "skip_occurrence", fake_skip)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"key": "Netflix", "date": "2026-09-14"}
    assert result["result"] == {"ok": True}


def test_execute_edit_occurrence_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("edit_occurrence", {
        "key": "Car insurance", "date": "2026-10-14", "scope": "one", "new_date": None, "new_amount": 350.0,
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.analytics as analytics_module

    captured = {}

    async def fake_edit(body, user):
        captured.update(body)
        return {"ok": True}

    monkeypatch.setattr(analytics_module, "edit_upcoming", fake_edit)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {
        "key": "Car insurance", "date": "2026-10-14", "scope": "one", "new_date": None, "new_amount": 350.0,
    }
    assert result["result"] == {"ok": True}


def test_execute_clear_override_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("clear_override", {"key": "Netflix", "date": "2026-09-14"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.analytics as analytics_module

    captured = {}

    async def fake_clear(body, user):
        captured.update(body)
        return {"ok": True}

    monkeypatch.setattr(analytics_module, "clear_override", fake_clear)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"key": "Netflix", "date": "2026-09-14"}
    assert result["result"] == {"ok": True}


# ═════════════════════════════════════════════════════════════════════════
# Section F — registration + consent gate (unchanged doctrine, new tools)
# ═════════════════════════════════════════════════════════════════════════

_NEW_TOOL_NAMES = {
    "propose_update_planned", "propose_delete_planned",
    "propose_update_allocation", "propose_delete_allocation",
    "propose_update_commitment", "propose_delete_commitment",
    "propose_delete_checkpoint",
    "propose_skip_occurrence", "propose_edit_occurrence", "propose_clear_override",
}

_NEW_KIND_NAMES = {
    "update_planned", "delete_planned",
    "update_allocation", "delete_allocation",
    "update_commitment", "delete_commitment",
    "delete_checkpoint",
    "skip_occurrence", "edit_occurrence", "clear_override",
}


def test_all_new_tools_registered_in_propose_tool_names():
    assert _NEW_TOOL_NAMES <= penny_tools_module.PROPOSE_TOOL_NAMES


def test_all_new_kinds_registered_in_proposal_executors():
    assert _NEW_KIND_NAMES <= set(can_i_module._PROPOSAL_EXECUTORS.keys())


def test_no_guardrail_queue_tool_leaked_into_new_set():
    banned_substrings = ("transfer_pair", "miscategorised", "resolve_movement")
    for name in _NEW_TOOL_NAMES:
        for bad in banned_substrings:
            assert bad not in name


# Consent gate itself is generic (keyed on PROPOSE_TOOL_NAMES membership in
# app.services.penny_agent's dispatch loop, not per-tool) — one
# representative new tool exercises the same run_penny_agent path
# test_penny_proposals.py's own
# test_run_penny_agent_consent_required_when_propose_tool_attempted_without_consent
# already covers for the original eight.
def test_consent_required_for_new_propose_tool_without_consent(monkeypatch):
    import json

    import app.services.penny_agent as penny_agent_module
    from app.services.penny_agent import run_penny_agent

    class _FakeResponse:
        def __init__(self, payload):
            self.status_code = 200
            self._payload = payload

        def json(self):
            return self._payload

    class _ScriptedAsyncClient:
        def __init__(self, responses):
            self._responses = list(responses)
            self.calls = []

        def __call__(self, *a, **kw):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            self.calls.append(json)
            return self._responses[min(len(self.calls) - 1, len(self._responses) - 1)]

    async def fake_find_one(query, proj=None):
        return None  # not consented

    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", fake_find_one)

    tool_call_payload = _FakeResponse({
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": [{
                    "id": "call_1", "type": "function",
                    "function": {"name": "propose_delete_planned", "arguments": json.dumps({"planned_ref": "pl1"})},
                }],
            },
        }],
    })
    client = _ScriptedAsyncClient([tool_call_payload])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("must never execute a propose tool without consent")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent(UID, "delete my car service plan", [], None, ""))
    assert result == {"consent_required": True}
