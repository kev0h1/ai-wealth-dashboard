"""G336: replay Kevin's two move conversations (stored 2026-10-24, answered by
code that predated plan_consolidation) through the real agent loop with a
scripted model. Real execute_tool + real planner over the Kevin fixture; only
the database loaders are patched. Proves routing arguments, the card, the
exclusion, and that a reply carrying figures the tool never returned (the old
"£414" and "£650") is replaced by the tool's own summary.

Phrasings are Kevin's, verbatim."""
import asyncio
import json
from types import SimpleNamespace

import pytest

import app.services.penny_agent as penny_agent_module
import app.services.penny_consolidation as pc
import app.services.penny_tools as penny_tools_module
from app.services.penny_agent import run_penny_agent
from app.services.penny_reply_guards import UNCHANGED_SENTENCE
from test_penny_agent import _ScriptedAsyncClient, _final_payload, _tool_call_payload

OLD_ANSWER_BALANCES = (
    "You have £414 across NatWest, Starling and HSBC right now, plus £1,594 in your Monzo pot and savings at Barclays."
)
OLD_FALSE_CLAIM = "If you move it into Barclays Premier, your left to spend rises from £236 to £650."

THREAD_ONE = [
    {"role": "user", "content": "Which accounts have the left to spend and how can I consolidate it in my premier account"},
    {"role": "assistant", "content": OLD_ANSWER_BALANCES},
    {"role": "user", "content": "No I don't want to touch my savings"},
    {"role": "assistant", "content": OLD_ANSWER_BALANCES + " " + OLD_FALSE_CLAIM},
    {"role": "user", "content": "Isn't the Monzo money already account for in a plan"},
    {"role": "assistant", "content": "The Monzo pot is set aside for a plan. " + OLD_FALSE_CLAIM},
]
QUESTION_ONE = "Visualise that move to my Barclays account"

THREAD_TWO = [
    {"role": "user", "content": "I know I can spend a certain amount from certain accounts which have some money left to spend, but I'd rather spend from my Barclays premier account, how much can I move to it from the other accounts"},
    {"role": "assistant", "content": OLD_ANSWER_BALANCES},
    {"role": "user", "content": "Where does the 414 come from"},
    {"role": "assistant", "content": "The £414 is the sum of the balances of NatWest, Starling and HSBC. " + OLD_FALSE_CLAIM},
    {"role": "user", "content": "Okay if I want to spend what's left to spend from my Barclays account, how can I move the money"},
    {"role": "assistant", "content": OLD_ANSWER_BALANCES},
]
QUESTION_TWO = "Which accounts should I move the 236 from"


def _acc(aid, name, provider, subtype="TRANSACTION", typ="bank"):
    return {"id": aid, "name": name, "provider": provider, "subtype": subtype, "type": typ}


def _elig(head):
    return {"short": False, "headroom": head, "spend_from_headroom": head, "account_headroom_raw": head}


@pytest.fixture
def kevin_world(monkeypatch):
    accounts = [
        _acc("bar", "Barclays Premier", "ob-barclays"), _acc("nat", "NatWest Select", "ob-natwest"),
        _acc("star", "Starling Personal", "ob-starling"), _acc("hsbc", "HSBC Maingi K M", "ob-hsbc"),
        _acc("monzo", "Monzo Pot", "ob-monzo", subtype="SAVINGS"),
        _acc("bsav", "Barclays Savings", "ob-barclays", subtype="SAVINGS"),
    ]
    elig = {"bar": _elig(40), "nat": _elig(146), "star": _elig(54), "hsbc": _elig(0),
            "monzo": _elig(1594), "bsav": _elig(900)}

    async def resolve(uid, name):
        return {"account": SimpleNamespace(id="bar", name="Barclays Premier")}

    async def today(uid):
        return {"account_eligibility": elig}

    async def pool(uid):
        return 236.0

    async def accs(uid):
        return accounts

    async def pots(uid):
        return {"monzo"}

    async def tokens(uid):
        return ["maingi", "k", "m"]

    import app.routers.companion as rc
    import app.services.notifications as notifications
    monkeypatch.setattr(penny_tools_module, "_resolve_account_for_propose", resolve)
    monkeypatch.setattr(pc, "_load_today", today)
    monkeypatch.setattr(pc, "_load_accounts", accs)
    monkeypatch.setattr(pc, "_load_pot_ids", pots)
    monkeypatch.setattr(rc, "_pooled_safe_to_spend", pool)
    monkeypatch.setattr(notifications, "_user_name_tokens", tokens)

    calls: list[tuple[str, dict]] = []
    real = penny_agent_module.execute_tool

    async def spy(uid, name, args):
        calls.append((name, args))
        return await real(uid, name, args)

    monkeypatch.setattr(penny_agent_module, "execute_tool", spy)
    return calls


def _run(monkeypatch, history, question, model_script):
    client = _ScriptedAsyncClient(model_script)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)
    result = asyncio.run(run_penny_agent("kevin", question, history, "home", ""))
    return result, client


def _summary_for(result):
    return result["move_plan"]["summary"]


def test_thread_one_routes_to_plan_consolidation_with_savings_excluded(monkeypatch, kevin_world):
    script = [
        _tool_call_payload("plan_consolidation", {
            "target_account_id_or_name": "Barclays Premier",
            "exclude_account_ids_or_names": ["Barclays Savings", "Monzo Pot"],
        }),
        _final_payload("HEADLINE: Move up to £200\nREPLY: PLACEHOLDER"),
    ]
    # The scripted final answer quotes the summary verbatim, so build it from a dry run first.
    result, client = _run(monkeypatch, THREAD_ONE, QUESTION_ONE, script)
    summary = _summary_for(result)
    script[1] = _final_payload(f"HEADLINE: Move up to £200\nREPLY: {summary}")
    kevin_world.clear()
    result, client = _run(monkeypatch, THREAD_ONE, QUESTION_ONE, script)

    assert kevin_world[0][0] == "plan_consolidation"
    args = kevin_world[0][1]
    assert args["target_account_id_or_name"] == "Barclays Premier"
    assert "Barclays Savings" in args["exclude_account_ids_or_names"]
    # the stored thread, false claim included, really was in front of the model
    sent = json.dumps(client.calls[0]["messages"])
    assert "No I don't want to touch my savings" in sent and "rises from" in sent

    block = result["move_plan"]
    assert block["kind"] == "move_plan" and block["target"]["name"] == "Barclays Premier"
    assert [l["name"] for l in block["legs"]] == ["NatWest Select", "Starling Personal"]
    assert block["total"] == 200.0
    names = {l["name"] for l in block["legs"]}
    assert "Barclays Savings" not in names and "Monzo Pot" not in names
    assert {"name": "Barclays Savings", "reason": "excluded_by_user"} in block["skipped"]
    assert result["tools_used"] == ["plan_consolidation"]
    assert summary in result["reply"] and UNCHANGED_SENTENCE in result["reply"]
    assert "left out as you asked" in result["reply"]
    assert "£414" not in result["reply"] and "£650" not in result["reply"]


def test_thread_two_final_question_gets_the_plan_and_savings_stay_out(monkeypatch, kevin_world):
    script = [
        _tool_call_payload("plan_consolidation", {"target_account_id_or_name": "Barclays Premier"}),
        _final_payload("HEADLINE: Move up to £200\nREPLY: PLACEHOLDER"),
    ]
    dry, _ = _run(monkeypatch, THREAD_TWO, QUESTION_TWO, script)
    summary = _summary_for(dry)
    script[1] = _final_payload(f"HEADLINE: Move up to £200\nREPLY: {summary}")
    result, client = _run(monkeypatch, THREAD_TWO, QUESTION_TWO, script)
    assert "Where does the 414 come from" in json.dumps(client.calls[0]["messages"])
    legs = [l["name"] for l in result["move_plan"]["legs"]]
    assert legs == ["NatWest Select", "Starling Personal"]
    reasons = {s["name"]: s["reason"] for s in result["move_plan"]["skipped"]}
    assert reasons["Barclays Savings"] == "savings" and reasons["Monzo Pot"] == "set_aside_pot"
    assert result["reply"] == summary and UNCHANGED_SENTENCE in result["reply"]


@pytest.mark.parametrize("thread,question", [(THREAD_ONE, QUESTION_ONE), (THREAD_TWO, QUESTION_TWO)])
def test_model_answering_from_balances_after_the_tool_is_replaced(monkeypatch, kevin_world, thread, question):
    stray = ("HEADLINE: Your balances\nREPLY: Your accounts hold £414 between them. "
             "Move it all and your left to spend would rise from £236 to £650.")
    script = [
        _tool_call_payload("plan_consolidation", {"target_account_id_or_name": "Barclays Premier"}),
        _final_payload(stray),
    ]
    result, _ = _run(monkeypatch, thread, question, script)
    assert "£414" not in result["reply"] and "£650" not in result["reply"]
    assert "would rise" not in result["reply"]
    assert result["reply"] == result["move_plan"]["summary"]
    assert result["move_plan"]["total"] == 200.0  # the card is untouched by the guard


def test_would_rise_sentence_replaced_even_without_the_tool(monkeypatch, kevin_world):
    script = [_final_payload(
        "HEADLINE: About that move\nREPLY: You could shift money across. "
        "Your left to spend would rise to £650 if you move it. Nothing else changes."
    )]
    result, _ = _run(monkeypatch, THREAD_ONE, QUESTION_ONE, script)
    assert "£650" not in result["reply"] and "would rise" not in result["reply"]
    assert UNCHANGED_SENTENCE in result["reply"]
    assert result["reply"].startswith("You could shift money across.") and result["reply"].endswith("Nothing else changes.")
