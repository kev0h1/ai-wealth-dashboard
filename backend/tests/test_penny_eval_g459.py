"""G459: the multi-turn eval set is well formed and its scoring works (offline, no model)."""
import asyncio

import penny_eval.cases as eval_cases
from penny_eval import history, scoring
from penny_eval.runner import run_case
from penny_eval.world import World
from app.services import penny_tools

NAMES = {t["function"]["name"] for t in penny_tools.TOOL_SCHEMAS + penny_tools.PROPOSE_TOOL_SCHEMAS}


def _walk(checks):
    for c in checks:
        if c["kind"] == "any_of":
            yield from _walk(c["checks"])
        else:
            yield c


def test_cases_are_well_formed():
    ids = set()
    for case in eval_cases.CASES:
        assert case["id"] not in ids
        ids.add(case["id"])
        assert case["turns"][-1].get("checks"), "the last turn is always the scored one"
        for turn in case["turns"]:
            assert ("checks" in turn) != ("reply" in turn or turn.get("kind") == "proposal")
            for c in _walk(turn.get("checks", [])):
                assert c["rubric"] in scoring.RUBRICS
                for n in c.get("names", []) + ([c["tool"]] if "tool" in c else []):
                    assert n in NAMES, n
    assert eval_cases.live_turn_count() >= 25
    covered = {c["rubric"] for case in eval_cases.CASES for t in case["turns"] for c in _walk(t.get("checks", []))}
    assert covered == set(scoring.RUBRICS)


def test_history_is_cut_exactly_like_production():
    msgs = [{"role": "user", "content": f"q{i}"} if i % 2 == 0 else {"role": "assistant", "content": "x" * 500} for i in range(10)]
    h = history.production_history(msgs)
    assert len(h) == 6 and all(len(e["content"]) <= 300 for e in h)
    assert history.production_history([{"role": "assistant", "kind": "proposal", "summary": "S", "status": "pending"}])[0]["content"] == "I proposed: S (pending)."


def test_closing_question_and_fourth_bill_fall_beyond_the_cut():
    assert eval_cases.LONG_PLAN_REPLY.index(f"is it the {eval_cases.GOAL} pot") > 300
    assert eval_cases.LONG_BILLS_REPLY.index("Council tax") > 300
    case = next(c for c in eval_cases.CASES if c["id"] == "chal-02-yes-after-long-reply")
    seen = {}

    async def stub(uid, q, hist, screen, ctx, last_result=None):
        seen["hist"] = hist
        return {"headline": "", "reply": f"Setting up the {eval_cases.GOAL} plan."}
    asyncio.run(run_case(stub, case, "u", penny_tools.execute_tool))
    assert eval_cases.GOAL not in seen["hist"][-1]["content"] and len(seen["hist"][-1]["content"]) == 300


def test_challenge_maths_in_the_fixture_engine():
    w = World(penny_tools.execute_tool)
    out = asyncio.run(w.execute("u", "preview_goal_schedule", dict(start_amount=11.24, step_amount=0.04, step_unit="day", count=85)))
    assert out["total"]["raw"] == 1098.20


def test_scoring_rules():
    ok = {"reply": "Tomorrow is £11.24 and the total is £1,098.20.", "answered": True, "tools": ["calculate"], "results": [], "thread_text": "£11.20"}
    c_all = dict(rubric="arithmetic", name="n", kind="regex_all", patterns=[r"11\.24", r"1,?098\.20"])
    assert scoring.run_check(c_all, ok)[0]
    bad = dict(ok, reply="Tomorrow is £11.32 and the total is £1,111.00.")
    assert not scoring.run_check(c_all, bad)[0]
    fig = dict(rubric="grounding", name="f", kind="figures")
    assert not scoring.run_check(fig, ok)[0]  # 11.24 and 1,098.20 are in neither results nor thread
    assert scoring.run_check(dict(fig, extra=[11.24, 1098.20]), ok)[0]
    assert scoring.run_check(dict(fig), dict(ok, reply="About £1,098 in total.", results=[{"t": 1098.20}]))[0]
    none = dict(rubric="grounding", name="x", kind="regex_none", patterns=[r"already track"])
    assert not scoring.run_check(none, dict(ok, reply="Yes, the goal already tracks it."))[0]
    assert not scoring.run_check(c_all, dict(ok, answered=False, reply=""))[0]
    anyof = dict(rubric="context", name="a", kind="any_of", checks=[
        dict(rubric="context", name="r", kind="regex_any", patterns=["Stack"]),
        dict(rubric="context", name="t", kind="tools_any", names=["get_upcoming_bills"])])
    assert scoring.run_check(anyof, dict(ok, tools=["get_upcoming_bills"]))[0]
    rates = scoring.pass_rates([{"rubric": "tools", "passed": True}, {"rubric": "tools", "passed": False}])
    assert rates["tools"]["rate"] == 0.5 and rates["context"]["rate"] is None


def test_no_propose_tool_and_first_tool_checks():
    o = {"reply": "x", "answered": True, "tools": ["get_goals", "propose_create_account_rule"], "results": [], "thread_text": ""}
    assert not scoring.run_check(dict(rubric="tools", name="n", kind="no_propose_tool"), o)[0]
    assert scoring.run_check(dict(rubric="tools", name="n", kind="no_propose_tool"), dict(o, tools=["get_goals"]))[0]
    assert scoring.run_check(dict(rubric="tools", name="n", kind="first_tool", tool="get_goals"), o)[0]


def test_wrong_total_regex_allows_only_the_agreed_total():
    import re
    pat = [c for case in eval_cases.CASES if case["id"] == "chal-01-maths" for c in case["turns"][0]["checks"] if c["kind"] == "regex_none"][0]["patterns"][0]
    assert not re.search(pat, "The total is £1,098.20 over 85 days.")
    assert re.search(pat, "The total is £1,112.44 over 86 days.")
    assert not re.search(pat, "Tomorrow is £11.24, then £11.28.")
