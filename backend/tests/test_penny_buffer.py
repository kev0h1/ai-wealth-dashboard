"""B60 step 3: the safety buffer view fields and the set and clear proposals."""
import asyncio
from types import SimpleNamespace

import app.routers.accounts as accounts_module
import app.routers.can_i as can_i_module
import app.routers.savings as savings_module
import app.services.penny_buffer as penny_buffer
import app.services.penny_tools as penny_tools
from app.services.penny_tools import PROPOSE_TOOL_NAMES, execute_tool
from tests.penny_proposal_fakes import FakeCollection as _FakeCol
from tests.test_penny_proposals import _live_doc, _patch_consented_prefs

UID = "b60-buffer"


def _world(monkeypatch, goal=None, spending=2000.0):
    goals = _FakeCol([goal] if goal else [])

    async def fake_cashflow(uid, cutoff):
        return 3000.0, spending, 100.0

    async def fake_insights(user):
        return {"configured": True}

    async def fake_accounts(user):
        return [SimpleNamespace(id="a1", name="Marcus Savings", provider="marcus"),
                SimpleNamespace(id="a2", name="HSBC Savings", provider="hsbc")]

    async def fake_bank(uid):
        return [{"_id": "a1", "name": "Marcus Savings", "provider": "marcus"}]

    async def fake_manual(uid):
        return []

    async def fake_tokens(uid):
        return []

    import app.services.notifications as notifications_module
    for mod in (savings_module,):
        monkeypatch.setattr(mod, "savings_goals_col", goals)
        monkeypatch.setattr(mod, "_cashflow", fake_cashflow)
        monkeypatch.setattr(mod, "savings_insights", fake_insights)
        monkeypatch.setattr(mod, "_bank_accounts", fake_bank)
        monkeypatch.setattr(mod, "_manual_accounts", fake_manual)
    monkeypatch.setattr(accounts_module, "get_accounts", fake_accounts)
    monkeypatch.setattr(notifications_module, "_user_name_tokens", fake_tokens)
    monkeypatch.setattr(penny_tools, "penny_proposals_col", _FakeCol())
    monkeypatch.setattr(penny_tools, "preferences_col", _FakeCol([{"user_id": UID}]))
    return goals


def test_savings_position_carries_the_goal_fields(monkeypatch):
    goals = _world(monkeypatch, {"_id": UID, "target_type": "months", "target_months": 3, "account_ids": ["a1"]})
    monkeypatch.setattr(penny_tools, "savings_goals_col", goals)
    monkeypatch.setattr(penny_tools, "_cashflow", savings_module._cashflow)

    async def current(uid, goal):
        return 1500.0
    monkeypatch.setattr(penny_tools, "_current_savings", current)

    async def sts(uid):
        return {"status": "insufficient_data"}
    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", sts)
    res = asyncio.run(penny_tools._exec_get_savings_position(UID))
    assert res["configured"] is True and res["target_type"] == "months" and res["target_months"] == 3
    assert res["account_names"] == ["Marcus Savings"]
    assert res["days_covered"] == round(1500.0 / (2000.0 / 30.44))


def test_set_proposal_for_months_has_summary_before_after(monkeypatch):
    _world(monkeypatch, {"_id": UID, "target_type": "amount", "target_amount": 1000.0, "account_ids": ["a1"]})
    res = asyncio.run(execute_tool(UID, "propose_set_savings_goal", {"target_type": "months", "target_months": 3}))
    assert res["kind"] == "set_savings_goal"
    assert res["summary"] == "Set your safety buffer to 3 months of spending (about £6,000)"
    assert res["before"] == "£1,000" and res["after"] == "3 months of spending (about £6,000)"
    assert res["params"] == {"target_type": "months", "account_ids": ["a1"], "target_months": 3}


def test_set_proposal_for_amount_resolves_accounts_and_handles_not_set(monkeypatch):
    _world(monkeypatch)
    res = asyncio.run(execute_tool(UID, "propose_set_savings_goal",
                                   {"target_type": "amount", "target_amount": 2000, "account_names": ["hsbc"]}))
    assert res["summary"] == "Set your safety buffer to £2,000" and res["before"] == "Not set"
    assert res["params"]["account_ids"] == ["a2"] and res["params"]["target_amount"] == 2000.0


def test_set_proposal_ambiguous_account_and_invalid_values(monkeypatch):
    _world(monkeypatch)
    res = asyncio.run(execute_tool(UID, "propose_set_savings_goal",
                                   {"target_type": "amount", "target_amount": 2000, "account_names": ["savings"]}))
    assert res["ambiguous"] is True and len(res["matches"]) == 2
    bad = asyncio.run(execute_tool(UID, "propose_set_savings_goal", {"target_type": "months", "target_months": 99}))
    assert "error" in bad
    bad = asyncio.run(execute_tool(UID, "propose_set_savings_goal", {"target_type": "amount", "target_amount": -5}))
    assert "error" in bad


def test_clear_proposal_needs_a_goal(monkeypatch):
    _world(monkeypatch)
    assert "error" in asyncio.run(execute_tool(UID, "propose_clear_savings_goal", {}))
    _world(monkeypatch, {"_id": UID, "target_type": "months", "target_months": 6, "account_ids": []})
    res = asyncio.run(execute_tool(UID, "propose_clear_savings_goal", {}))
    assert res["kind"] == "clear_savings_goal" and res["after"] == "Not set" and res["destructive"] is False
    assert res["before"].startswith("6 months of spending")


def test_executors_write_through_the_real_routes(monkeypatch):
    goals = _world(monkeypatch)
    monkeypatch.setattr(savings_module.response_cache, "invalidate", lambda uid: None)
    _patch_consented_prefs(monkeypatch)
    props = _FakeCol([_live_doc("set_savings_goal", {"target_type": "months", "target_months": 4, "account_ids": ["a1"]})])
    props.docs[0]["user_id"] = UID
    monkeypatch.setattr(can_i_module, "penny_proposals_col", props)
    monkeypatch.setattr(can_i_module, "preferences_col", _FakeCol([{"user_id": UID, "penny_agent_consent": "x"}]))
    asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert goals.docs[0]["target_months"] == 4 and goals.docs[0]["target_type"] == "months" and goals.docs[0]["account_ids"] == ["a1"]
    assert goals.docs[0]["target_amount"] is None

    props.docs[:] = [_live_doc("clear_savings_goal", {})]
    props.docs[0]["user_id"] = UID
    asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert goals.docs == []


def test_new_propose_tools_are_registered_and_grouped():
    assert {"propose_set_savings_goal", "propose_clear_savings_goal"} <= PROPOSE_TOOL_NAMES
    assert {"set_savings_goal", "clear_savings_goal"} <= set(can_i_module._PROPOSAL_EXECUTORS)
    from app.services.penny_agent import _propose_tool_catalogue
    assert "safety buffer: propose_set_savings_goal, propose_clear_savings_goal" in _propose_tool_catalogue()
    assert penny_buffer.PROPOSE_SET_SAVINGS_GOAL_SCHEMA["function"]["name"] in PROPOSE_TOOL_NAMES
