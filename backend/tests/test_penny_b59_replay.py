"""B59: replay Kevin's two UAT threads (2026-10-25) through the real route, the
real agent loop and the real tools with a scripted model. Only the database
loaders and the model are faked.

Thread A (British Gas, 159.70, Bills): the search row says £159.70, the chat
keeps the transaction in focus, "Put it under Software" and "change it back"
resolve to it, and each proposal turn keeps its summary, its before and after,
and a stored proposal block.
Thread B (set-asides): the new read tool lists the pots, "Can I edit it here"
becomes a propose_update_allocation on the focused pot, and Penny is never
told, or tells the user, that set-asides cannot be edited here."""
import asyncio
import json
from datetime import date, datetime
from types import SimpleNamespace

import pytest

import app.routers.accounts as accounts_module
import app.routers.allocations as allocations_module
import app.routers.can_i as can_i_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_set_asides as penny_set_asides
import app.services.penny_tools as penny_tools_module
from app.services import penny_conversations as svc
from tests.penny_proposal_fakes import FakeCollection as _FakeCol
from tests.test_penny_agent import _ScriptedAsyncClient, _final_payload, _tool_call_payload
from tests.test_penny_conversations import cols  # noqa: F401  (fixture)
from tests.test_penny_proposals import (
    _categories_payload, _patch_get_categories, _patch_recat_txn_col, _txn_doc,
)
from tests.test_penny_proposals_twins import _alloc_item
from tests.test_penny_search_totals import _install as _install_search, _row

UID = "kevin-b59"
USER = {"email": UID}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def world(monkeypatch, cols):  # noqa: F811
    convs, props = cols
    penny_proposals = _FakeCol()

    async def allowance(uid):
        return None

    async def consented(query, proj=None):
        return {"penny_agent_consent": True}

    monkeypatch.setattr(can_i_module, "penny_allowance", allowance)
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", consented)
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", penny_proposals)
    monkeypatch.setattr(penny_tools_module, "preferences_col", _FakeCol([{"user_id": UID, "penny_agent_consent": "x"}]))
    return SimpleNamespace(cid=run(svc.create_conversation(UID))["id"], convs=convs, clients=[])


def ask(world, monkeypatch, question, script, history=None):
    client = _ScriptedAsyncClient(script)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)
    world.clients.append(client)
    body = {"question": question, "conversation_id": world.cid, "history": history or []}
    return run(can_i_module.can_i(body, USER))


def assistant_turns(world):
    return [t for t in world.convs.docs[0]["turns"] if t["role"] == "assistant"]


# ── Thread A ────────────────────────────────────────────────────────────────

def _thread_a_world(monkeypatch, category="Bills"):
    _install_search(monkeypatch, [_row(1, 159.70, "GBP", _id="T1", id="T1", description="BRITISH GAS",
                                       merchant_key="british gas", uid=UID, date=datetime(2026, 10, 1))])
    doc = _txn_doc(_id="T1", merchant="BRITISH GAS", desc="BRITISH GAS", amount=159.70, category=category, day="2026-10-01",
                   merchant_key="british gas", uid=UID)
    _patch_recat_txn_col(monkeypatch, [doc])
    _patch_get_categories(monkeypatch, _categories_payload())
    return doc


@pytest.mark.parametrize("propose_args", [
    {"transaction_id": "T1"},
    {"merchant": "British Gas", "date": "2026-10-01", "amount": 160},  # the rounded figure Kevin's thread failed on
    {},  # no reference at all: the focus alone
], ids=["by-id", "by-rounded-amount", "by-focus-alone"])
def test_thread_a_recategorise_and_change_it_back(monkeypatch, world, propose_args):
    doc = _thread_a_world(monkeypatch)

    # Turn 1: the search row quotes the pence, the focus is stored.
    first = ask(world, monkeypatch, "What was the last transaction from British gas", [
        _tool_call_payload("search_transactions", {"merchants": "British Gas"}),
        _final_payload("HEADLINE: Latest British Gas\nREPLY: Your most recent British Gas transaction was £159.70 on 1 October 2026."),
    ])
    tool_message = next(m for m in world.clients[0].calls[1]["messages"] if m["role"] == "tool")
    row = json.loads(tool_message["content"])["transactions"][0]
    assert row["amount"] == {"raw": 159.7, "formatted": "£159.70"}
    assert "£159.70" in first["reply"]
    stored = assistant_turns(world)[0]["last_result"]
    assert stored["kind"] == "transaction" and stored["ids"] == ["T1"] and "BRITISH GAS" in stored["labels"]["T1"]

    # Turns 2 and 3: answers without a tool call (the category, the clarifying question).
    ask(world, monkeypatch, "What category was this", [_final_payload("HEADLINE: Bills\nREPLY: That one is categorised as Bills.")])
    ask(world, monkeypatch, "Can I change it", [_final_payload(
        "HEADLINE: Yes\nREPLY: Yes. Just this one, or should I always file British Gas under a new category?")])
    for turn in assistant_turns(world)[1:]:  # the clarifying turns carried no focus: the lookback must still find T1
        turn.pop("last_result", None)

    # Turn 4: "Put it under Software" with the client-built history text.
    history = [
        {"role": "user", "content": "What was the last transaction from British gas"},
        {"role": "assistant", "content": "Your most recent British Gas transaction was £159.70 on 1 October 2026."},
        {"role": "user", "content": "Just this one"},
        {"role": "assistant", "content": "Which category should I file it under?"},
    ]
    second = ask(world, monkeypatch, "Put it under Software", [
        _tool_call_payload("propose_recategorise_transaction", {**propose_args, "new_category": "Software", "scope": "just_once"}),
    ], history)
    assert "FOCUS:" in json.dumps(world.clients[-1].calls[0]["messages"]), "the model is told what the chat is about"
    proposal = second["proposal"]
    assert proposal["params"]["transaction_id"] == "T1"
    assert (proposal["before"], proposal["after"], proposal["entity"]) == ("Bills", "Software", "BRITISH GAS")
    assert second["reply"] == f"{proposal['summary']} Changes only this transaction."
    assert "File the BRITISH GAS £159.70 on 1 Oct as Software instead of Bills." in second["reply"]
    block = assistant_turns(world)[-1]["proposal"]
    assert block["proposal_id"] == proposal["proposal_id"] and block["before"] == "Bills" and block["after"] == "Software"
    assert block["status"] == "pending"
    assert assistant_turns(world)[-1]["last_result"]["ids"] == ["T1"], "a proposal turn does not erase the focus"

    # Turn 5: the user confirmed it, then asks for it back. The focus carries through.
    doc["category"] = "Software"
    third = ask(world, monkeypatch, "Actually this is a mistake change it back", [
        _tool_call_payload("propose_recategorise_transaction", {"new_category": "Bills", "scope": "just_once"}),
    ], history)
    back = third["proposal"]
    assert back["params"]["transaction_id"] == "T1"
    assert (back["before"], back["after"]) == ("Software", "Bills")
    assert back["summary"] in third["reply"] and back["proposal_id"] != proposal["proposal_id"]
    assert "Bills" in back["summary"] and "Software" in back["summary"]

    restored = [t for t in run(svc.get_conversation(UID, world.cid))["turns"] if t["role"] == "assistant" and t.get("proposal")]
    assert [t["proposal"]["after"] for t in restored] == ["Software", "Bills"]


def test_thread_a_no_focus_still_asks_for_a_reference(monkeypatch, world):
    _thread_a_world(monkeypatch)
    res = ask(world, monkeypatch, "Put it under Software", [
        _tool_call_payload("propose_recategorise_transaction", {"new_category": "Software", "scope": "just_once"}),
        _final_payload("HEADLINE: Which one\nREPLY: Which transaction do you mean? Tell me the merchant and the date."),
    ])
    assert "proposal" not in res and "Which transaction" in res["reply"]


# ── Thread B ────────────────────────────────────────────────────────────────

def _thread_b_world(monkeypatch):
    items = [_alloc_item(id_="a1", name="Saving Challenge (2026)", amount_per_period=50.0),
             _alloc_item(id_="a2", name="Holiday", amount_per_period=120.0),
             _alloc_item(id_="a3", name="Digital saver", amount_per_period=30.0)]

    async def fake_list(user):
        return {"items": items}

    async def fake_accounts(user):
        return [SimpleNamespace(id="acc1", name="HSBC Savings")]

    async def fake_cfg(uid):
        return {}

    async def fake_conflicts(*a, **k):
        return False

    monkeypatch.setattr(allocations_module, "list_allocations", fake_list)
    monkeypatch.setattr(allocations_module, "_pay_cfg", fake_cfg)
    monkeypatch.setattr(allocations_module, "_conflicts", fake_conflicts)
    monkeypatch.setattr(accounts_module, "get_accounts", fake_accounts)
    monkeypatch.setattr(penny_set_asides, "get_pay_period_for_date", lambda today, cfg: (date(2026, 9, 25), date(2026, 10, 29)))
    monkeypatch.setattr(penny_set_asides.timeutil, "user_today", lambda: date(2026, 10, 25))


def test_thread_b_set_asides_can_be_edited_here(monkeypatch, world):
    _thread_b_world(monkeypatch)
    first = ask(world, monkeypatch, "What are my set asides for the month", [
        _tool_call_payload("get_set_asides", {}),
        _final_payload("HEADLINE: Three set-asides\nREPLY: You have Saving Challenge (2026), Holiday and Digital saver set aside this pay period."),
    ])
    tool_message = next(m for m in world.clients[0].calls[1]["messages"] if m["role"] == "tool")
    for name in ("Saving Challenge (2026)", "Holiday", "Digital saver"):
        assert name in tool_message["content"]
    assert "Ask me to change it, or open Upcoming in the app." in tool_message["content"]
    focus = assistant_turns(world)[0]["last_result"]
    assert focus["kind"] == "allocation" and focus["ids"] == ["a1", "a2", "a3"]
    assert "Holiday" in first["reply"]

    ask(world, monkeypatch, "Can I edit this", [_final_payload(
        "HEADLINE: Yes\nREPLY: Yes. Tell me which set-aside and what to change, and I will set it up for you to confirm.")])
    system = json.dumps(world.clients[-1].calls[0]["messages"][0])
    assert "21. Nothing the app can do is out of your reach" in system
    assert "propose_update_allocation" in system

    third = ask(world, monkeypatch, "Can I edit it here", [
        _tool_call_payload("propose_update_allocation", {"allocation_ref": "that Holiday pot", "amount_per_period": 150}),
    ])
    proposal = third["proposal"]
    assert proposal["params"]["allocation_id"] == "a2"
    assert (proposal["before"], proposal["after"]) == ("£120.00 per period", "£150.00 per period")
    for text in (third["reply"], third["headline"]):
        assert "cannot be edited" not in text and "can't be edited" not in text and "Accounts page" not in text
    assert assistant_turns(world)[-1]["proposal"]["entity"] == "Holiday"
