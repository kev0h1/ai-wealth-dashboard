"""B59 step 2: entity focus carried server-side across turns."""
import asyncio

import app.services.penny_agent as penny_agent_module
from app.services import penny_conversations as svc
from app.services import penny_focus
from tests.test_penny_agent import _ScriptedAsyncClient, _final_payload, _tool_call_payload
from tests.test_penny_conversations import cols  # noqa: F401  (fixture)

TXN_FOCUS = {
    "tool": "search_transactions", "kind": "transaction", "args": {}, "ids": ["T1"],
    "labels": {"T1": "BRITISH GAS 2026-10-01 £159.70"},
}
ALLOC_FOCUS = {
    "tool": "get_set_asides", "kind": "allocation", "args": {}, "ids": ["A1", "A2", "A3"],
    "labels": {"A1": "Saving Challenge (2026)", "A2": "Holiday", "A3": "Digital saver"},
}


def _calls_executor(replies):
    calls = []

    async def execute(uid, name, args):
        calls.append((name, dict(args)))
        return replies.pop(0) if replies else {"proposal": True, "proposal_id": "p"}
    return execute, calls


def run(coro):
    return asyncio.run(coro)


def test_clean_focus_validates_kind_and_caps():
    assert penny_focus.clean_focus({"tool": "get_set_asides", "kind": "transaction", "ids": ["a"]}) is None
    assert penny_focus.clean_focus({"tool": "search_transactions", "ids": ["a"]})["kind"] == "transaction"
    out = penny_focus.clean_focus({**ALLOC_FOCUS, "ids": [f"a{i}" for i in range(300)]})
    assert len(out["ids"]) == 200


def test_focus_from_result_records_each_producer():
    f = penny_focus.focus_from_result("get_set_asides", {"set_asides": [{"id": "A1", "name": "Holiday"}]})
    assert f["kind"] == "allocation" and f["ids"] == ["A1"] and f["labels"] == {"A1": "Holiday"}
    f = penny_focus.focus_from_result("get_accounts", {"accounts": [{"id": "x", "name": "Monzo"}]})
    assert f["kind"] == "account" and f["ids"] == ["x"]
    f = penny_focus.focus_from_result("get_goals", {"goals": [{"name": "Car"}]})
    assert f["kind"] == "commitment" and f["ids"] == ["Car"]
    f = penny_focus.focus_from_result("get_upcoming_bills", {"upcoming_bills": [{"name": "Netflix"}]})
    assert f["kind"] == "occurrence"
    f = penny_focus.focus_from_result("get_recurring_payments", {"series": [{"name": "Netflix"}]})
    assert f["kind"] == "recurring"
    assert penny_focus.focus_from_result("get_safe_to_spend", {}) is None


def test_latest_focus_looks_back_past_turns_without_one(cols):  # noqa: F811
    cid = run(svc.create_conversation("a"))["id"]
    run(svc.append_turns("a", cid, [svc.clean_turn("user", "q1"), svc.clean_turn("assistant", "a1", last_result=TXN_FOCUS)]))
    for i in range(3):
        run(svc.append_turns("a", cid, [svc.clean_turn("user", f"q{i}"), svc.clean_turn("assistant", f"a{i}")]))
    assert run(svc.latest_focus("a", cid))["ids"] == ["T1"]
    assert run(svc.latest_focus("b", cid)) is None


def test_latest_focus_gives_up_after_twelve_turns(cols):  # noqa: F811
    cid = run(svc.create_conversation("a"))["id"]
    run(svc.append_turns("a", cid, [svc.clean_turn("user", "q"), svc.clean_turn("assistant", "a", last_result=TXN_FOCUS)]))
    for i in range(6):
        run(svc.append_turns("a", cid, [svc.clean_turn("user", f"q{i}"), svc.clean_turn("assistant", f"a{i}")]))
    assert run(svc.latest_focus("a", cid)) is None


def test_single_focused_transaction_resolves_without_a_merchant():
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", "propose_recategorise_transaction",
                                   {"new_category": "Software", "scope": "just_once", "_focus": TXN_FOCUS}, execute))
    assert calls[0][1]["transaction_id"] == "T1" and "_focus" not in calls[0][1]


def test_focused_transaction_preferred_over_merchant_and_date():
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", "propose_recategorise_transaction", {
        "merchant": "British Gas", "date": "2026-10-02", "amount": 160, "new_category": "Software",
        "scope": "just_once", "_focus": TXN_FOCUS}, execute))
    assert calls[0][1]["transaction_id"] == "T1"


def test_failed_text_match_falls_back_to_the_single_focused_id():
    execute, calls = _calls_executor([{"error": "no transaction found matching 'gas co' on 2026-10-01"}])
    res = run(penny_focus.run_with_focus("u", "propose_recategorise_transaction", {
        "merchant": "Some other name", "date": "2026-10-01", "new_category": "Software",
        "scope": "just_once", "_focus": TXN_FOCUS}, execute))
    assert res["proposal"] is True
    assert [c[1].get("transaction_id") for c in calls] == [None, "T1"]


def test_several_focused_ids_narrow_by_name_and_never_guess():
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", "propose_update_allocation",
                                   {"allocation_ref": "that Holiday pot", "amount_per_period": 50, "_focus": ALLOC_FOCUS}, execute))
    assert calls[0][1]["allocation_ref"] == "A2"
    execute, calls = _calls_executor([{"error": "no allocation matching 'it'"}])
    res = run(penny_focus.run_with_focus("u", "propose_update_allocation",
                                         {"allocation_ref": "it", "amount_per_period": 50, "_focus": ALLOC_FOCUS}, execute))
    assert len(calls) == 1 and "error" in res


def test_a_focus_of_another_kind_is_ignored():
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", "propose_update_allocation",
                                   {"allocation_ref": "Holiday", "_focus": TXN_FOCUS}, execute))
    assert calls[0][1]["allocation_ref"] == "Holiday"


def test_agent_injects_focus_into_propose_calls_and_carries_it_on_the_proposal(monkeypatch):
    seen = []

    async def fake_execute(uid, name, args):
        seen.append((name, args))
        return {"proposal": True, "proposal_id": "p1", "kind": "recategorise_transaction",
                "summary": "s", "consequence": "c", "params": {}}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute)
    client = _ScriptedAsyncClient([_tool_call_payload("propose_recategorise_transaction",
                                                      {"new_category": "Software", "scope": "just_once"})])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def consented(query, proj=None):
        return {"penny_agent_consent": True}

    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", consented)
    out = run(penny_agent_module.run_penny_agent("u", "Put it under Software", [], "home", "", last_result=TXN_FOCUS))
    assert seen[0][1]["_focus"]["ids"] == ["T1"]
    assert out["last_result"]["ids"] == ["T1"]
    assert "FOCUS:" in str(client.calls[0]["messages"])


def test_prompt_carries_the_followup_rule():
    assert "just this one" in penny_agent_module._WRITE_TOOLS_ADDENDUM
    assert "never search again by a rounded amount" in penny_agent_module._WRITE_TOOLS_ADDENDUM


# ── Review fix: whole-token matching, a defined "generic" ───────────────────

def _alloc(labels):
    ids = [f"A{i}" for i in range(len(labels))]
    return {"tool": "get_set_asides", "kind": "allocation", "args": {}, "ids": ids, "labels": dict(zip(ids, labels))}


def _picked(focus, ref, tool="propose_update_allocation", arg="allocation_ref", **extra):
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", tool, {arg: ref, **extra, "_focus": focus}, execute))
    return calls[0][1][arg]


def test_generic_reference_never_picks_among_several():
    two = _alloc(["Holiday", "Digital saver"])
    assert _picked(two, "it") == "it"
    assert _picked(two, "that pot") == "that pot"
    assert _picked(_alloc(["Holiday"]), "it") == "A0"


def test_explicit_non_matching_name_is_not_overridden():
    assert _picked(_alloc(["Car", "Holiday"]), "Car insurance") == "Car insurance"


def test_named_reference_matches_whole_tokens_only():
    f = _alloc(["Saving Challenge (2026)", "Holiday", "Digital saver"])
    assert _picked(f, "that Holiday pot") == "A1"
    assert _picked(f, "holiday") == "A1"
    assert _picked(f, "Digital") == "A2"
    assert _picked(f, "digi") == "digi"  # a fragment is not a token


def test_transaction_merchant_matches_by_tokens():
    f = {"tool": "search_transactions", "kind": "transaction", "args": {}, "ids": ["T1", "T2"],
         "labels": {"T1": "BRITISH GAS 2026-10-01 £159.70", "T2": "TESCO 2026-10-02 £10.00"}}
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", "propose_recategorise_transaction",
                                   {"merchant": "British Gas", "new_category": "Software", "scope": "just_once", "_focus": f}, execute))
    assert calls[0][1]["transaction_id"] == "T1"
    two_gas = {**f, "labels": {"T1": "BRITISH GAS 2026-10-01 £159.70", "T2": "BRITISH GAS 2026-09-01 £150.00"}}
    execute, calls = _calls_executor([])
    run(penny_focus.run_with_focus("u", "propose_recategorise_transaction",
                                   {"merchant": "gas", "new_category": "Software", "scope": "just_once", "_focus": two_gas}, execute))
    assert "transaction_id" not in calls[0][1]


def test_a_new_lookup_that_finds_nothing_clears_the_focus(monkeypatch):
    async def fake_execute(uid, name, args):
        return {"transactions": [], "count": 0}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute)
    client = _ScriptedAsyncClient([_tool_call_payload("search_transactions", {"merchants": "Nothing"}),
                                   _final_payload("HEADLINE: Nothing found\nREPLY: I found no payments to Nothing.")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)
    out = run(penny_agent_module.run_penny_agent("u", "Anything from Nothing", [], "home", "", last_result=TXN_FOCUS))
    assert "last_result" not in out
