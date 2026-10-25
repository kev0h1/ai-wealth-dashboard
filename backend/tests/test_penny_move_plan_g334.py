"""G334: the move-plan card block (validator, agent loop pop, storage). Offline."""
import asyncio
import copy
import json

import pytest

import app.services.penny_agent as penny_agent_module
from app.services import penny_conversations, penny_move_plan
from app.services.penny_move_plan import MovePlanInvalid, validate_move_plan
from tests.test_penny_golden_eval import _FinalResponse, _ToolCallResponse

UID = "kevin@example.com"


def _block():
    return {
        "kind": "move_plan",
        "target": {"name": "Your Barclays account", "bank": "Barclays", "provider": "ob-barclays"},
        "legs": [
            {"name": "NatWest Select", "bank": "NatWest", "provider": "ob-natwest", "amount": 146.0, "keeps": 0.0},
            {"name": "Starling Personal", "bank": "Starling", "provider": "ob-starling", "amount": 54.0, "keeps": 0.0},
        ],
        "total": 200.0, "pool": 236.0, "requested": None, "shortfall": 0.0,
        "summary": "You could move up to £200.00 into your Barclays account: £146.00 from NatWest Select and £54.00 from Starling Personal.",
        "skipped": [{"name": "Your HSBC account", "reason": "nothing_spare"}],
    }


def test_valid_block_round_trips():
    out = validate_move_plan(_block())
    assert out == _block()
    assert out is not _block()


def test_pool_and_requested_may_be_null_and_skipped_optional():
    b = _block()
    b["pool"] = None
    del b["skipped"]
    out = validate_move_plan(b)
    assert out["pool"] is None and out["skipped"] == []


@pytest.mark.parametrize("mutate", [
    lambda b: b.update(extra=1),
    lambda b: b.update(kind="chart"),
    lambda b: b["legs"].clear(),
    lambda b: b.update(legs=b["legs"] * 5),
    lambda b: b["legs"][0].update(amount=-1),
    lambda b: b["legs"][0].update(amount=float("nan")),
    lambda b: b["legs"][0].update(amount=float("inf")),
    lambda b: b["legs"][0].update(amount="146"),
    lambda b: b["legs"][0].update(secret="x"),
    lambda b: b["target"].update(name="<script>"),
    lambda b: b["target"].update(name=""),
    lambda b: b.update(total=-5),
    lambda b: b.update(summary="<b>hi</b>"),
    lambda b: b["skipped"][0].update(reason="because"),
    lambda b: b.update(skipped="x"),
    lambda b: b.update(legs="x"),
])
def test_invalid_blocks_are_rejected(mutate):
    b = copy.deepcopy(_block())
    mutate(b)
    with pytest.raises(MovePlanInvalid):
        validate_move_plan(b)
    assert penny_move_plan.validate_or_none(b) is None


def test_eight_legs_ok_nine_rejected():
    b = _block()
    leg = b["legs"][0]
    b["legs"] = [dict(leg) for _ in range(8)]
    validate_move_plan(b)
    b["legs"].append(dict(leg))
    with pytest.raises(MovePlanInvalid):
        validate_move_plan(b)


def test_marker_has_summary_and_label_not_legs():
    m = penny_move_plan.marker_for_model(validate_move_plan(_block()))
    assert m["label"] == "[move plan card attached: 2 legs, total £200.00]"
    assert m["summary"].startswith("You could move up to £200.00")
    assert "legs" in m and isinstance(m["legs"], int)
    assert "never offer to move the money" in m["instruction"]


class _Client:
    def __init__(self):
        self.calls = []

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        if len(self.calls) == 1:
            return _ToolCallResponse("plan_consolidation", "c1", {"target_account_id_or_name": "barclays"})
        return _FinalResponse("HEADLINE: Moving into Barclays\nREPLY: You could move up to £200.00, the route is below.")


def test_loop_attaches_move_plan_and_model_sees_marker_only(monkeypatch):
    client = _Client()
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_exec(uid, name, args):
        return {"summary": _block()["summary"], "_move_plan": _block()}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_exec)
    out = asyncio.run(penny_agent_module.run_penny_agent(UID, "how much can I move into Barclays", [], "home", ""))
    assert out["move_plan"]["total"] == 200.0 and len(out["move_plan"]["legs"]) == 2
    tool_msg = next(m for m in client.calls[1]["messages"] if m["role"] == "tool")
    body = json.loads(tool_msg["content"])
    assert "_move_plan" not in body and body["move_plan"]["shown"] is True
    assert "ob-natwest" not in tool_msg["content"]


def test_loop_drops_invalid_move_plan(monkeypatch):
    client = _Client()
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_exec(uid, name, args):
        bad = _block()
        bad["legs"][0]["amount"] = -3
        return {"summary": "x", "_move_plan": bad}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_exec)
    out = asyncio.run(penny_agent_module.run_penny_agent(UID, "move money into Barclays", [], "home", ""))
    assert "move_plan" not in out


def test_system_prompt_has_the_consolidation_rule():
    p = penny_agent_module._SYSTEM_PROMPT
    assert "plan_consolidation" in p and "never offer to move the money" in p


def test_clean_turn_stores_valid_move_plan_on_assistant_turns_only():
    t = penny_conversations.clean_turn("assistant", "Here you go.", move_plan=_block())
    assert t["move_plan"] == _block() and set(t) == {"role", "text", "ts", "move_plan"}
    assert "move_plan" not in penny_conversations.clean_turn("user", "x", move_plan=_block())
    bad = _block()
    bad["legs"][0]["amount"] = -1
    assert "move_plan" not in penny_conversations.clean_turn("assistant", "Here you go.", move_plan=bad)
    assert "move_plan" not in penny_conversations.clean_turn("assistant", "Here you go.")
