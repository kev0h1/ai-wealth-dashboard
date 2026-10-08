"""G241 — deterministic half of the arithmetic corpus (tests/
penny_arithmetic_corpus.py), plus registration and shape checks for the
extended `calculate` tool. Pass bar for these rows: 100%, because the
calculator is code, not model judgement. The live (OpenRouter) half is
scripts/penny_live_eval.py and is never run here."""
import asyncio
import pathlib

import pytest

import penny_arithmetic_corpus as corpus
from app.services import penny_agent as penny_agent_module
from app.services import penny_tools
from app.services.penny_tools import PROPOSE_TOOL_SCHEMAS, TOOL_SCHEMAS, execute_tool

REFERENCE_CASES = [c for c in corpus.CASES if c.get("reference")]


def _run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("case", REFERENCE_CASES, ids=[c["id"] for c in REFERENCE_CASES])
def test_reference_expression_gives_the_expected_value(case):
    ref = case["reference"]
    args = {"expression": ref["expression"], "inputs": ref["inputs"]}
    if ref.get("project"):
        args.update(project_from=ref["project"]["from_date"], period=ref["project"]["period"])
    out = _run(execute_tool("corpus-uid", "calculate", args))
    assert out["ok"], f"{case['id']}: {out['error']}"
    assert out["result"] == pytest.approx(ref["expected"], abs=1e-6)
    if ref.get("projected_date"):
        assert out["projected_date"] == ref["projected_date"]


def test_every_non_control_row_has_a_reference_and_every_row_an_id():
    ids = [c["id"] for c in corpus.CASES]
    assert len(ids) == len(set(ids))
    for c in corpus.CASES:
        if c["kind"] != "control":
            assert c.get("reference"), f"{c['id']} has no deterministic reference"
            assert c.get("expect_any") or c.get("expect_all"), f"{c['id']} has no expected figure"


# ── tool shape ───────────────────────────────────────────────────────────

def test_calculate_output_shape_success():
    out = _run(execute_tool("u", "calculate", {
        "expression": "shortfall(target, saved)",
        "inputs": {"target": "£2,000", "saved": {"raw": 1250, "formatted": "£1,250"}},
        "unit": "gbp",
    }))
    assert out == {
        "expression": "shortfall(target, saved)", "ok": True, "result": 750.0, "error": None,
        "inputs_used": {"target": 2000.0, "saved": 1250.0}, "result_formatted": "£750",
    }


def test_calculate_formats_pence_negatives_and_other_units():
    gbp = _run(execute_tool("u", "calculate", {"expression": "0 - 380.5", "unit": "gbp"}))
    assert gbp["result_formatted"] == "−£380.50"  # the currency minus, never a hyphen
    pct = _run(execute_tool("u", "calculate", {"expression": "share(286.4, 1812.3)", "unit": "percent"}))
    assert pct["result_formatted"] == "15.8%"
    days = _run(execute_tool("u", "calculate", {"expression": 'days_between("2026-10-08", "2026-10-17")', "unit": "days"}))
    assert days["result_formatted"] == "9 days"
    assert "result_formatted" not in _run(execute_tool("u", "calculate", {"expression": "1 + 1"}))
    assert "result_formatted" not in _run(execute_tool("u", "calculate", {"expression": "1 + 1", "unit": "bogus"}))


def test_calculate_failure_shape_has_no_result_and_a_plain_error():
    out = _run(execute_tool("u", "calculate", {"expression": "import os"}))
    assert out["ok"] is False and out["result"] is None and out["error"]
    assert "result_formatted" not in out and "projected_date" not in out


def test_projection_is_hedged_and_calendar_correct():
    out = _run(execute_tool("u", "calculate", {
        "expression": "periods_to_reach(2000, 1250, 150)", "project_from": "2026-10-08", "period": "month",
    }))
    assert out["projected_date"] == "2027-03-08"
    assert "At the same rate, roughly March 2027" in out["projected_text"]
    assert "not a promise" in out["projected_text"]
    week = _run(execute_tool("u", "calculate", {
        "expression": "periods_to_reach(100, 0, 25)", "project_from": "2026-10-08", "period": "week",
    }))
    assert week["projected_date"] == "2026-11-05" and "5 November 2026" in week["projected_text"]


def test_month_projection_clamps_to_month_end():
    assert penny_tools._add_months(__import__("datetime").date(2026, 1, 31), 1).isoformat() == "2026-02-28"
    assert penny_tools._add_months(__import__("datetime").date(2026, 11, 30), 3).isoformat() == "2027-02-28"


@pytest.mark.parametrize("project_from,period", [("not-a-date", "month"), ("2026-10-08", "decade")])
def test_bad_projection_arguments_report_an_error_without_hiding_the_result(project_from, period):
    out = _run(execute_tool("u", "calculate", {
        "expression": "periods_to_reach(2000, 1250, 150)", "project_from": project_from, "period": period,
    }))
    assert out["ok"] and out["result"] == 5 and out["projection_error"]
    assert "projected_date" not in out


def test_calculate_with_missing_expression_does_not_raise():
    out = _run(execute_tool("u", "calculate", {}))
    assert out["ok"] is False


# ── registration ─────────────────────────────────────────────────────────

def _schema(name):
    return next(t["function"] for t in TOOL_SCHEMAS if t["function"]["name"] == name)


def test_calculate_is_registered_read_only_with_the_new_parameters():
    fn = _schema("calculate")
    assert set(fn["parameters"]["properties"]) == {"expression", "inputs", "unit", "project_from", "period"}
    assert fn["parameters"]["required"] == ["expression"]
    assert "calculate" not in [t["function"]["name"] for t in PROPOSE_TOOL_SCHEMAS]
    assert "verbatim" in fn["description"]


def test_system_prompt_routes_arithmetic_through_calculate_and_never_declines_it():
    prompt = penny_agent_module._SYSTEM_PROMPT
    assert "Basic arithmetic is NEVER out of scope" in prompt
    assert "calculate" in prompt and "shortfall" in prompt and "projected_text" in prompt
    # the off-topic sentinel is still there for genuinely unrelated questions
    assert "OUT_OF_SCOPE" in prompt and "weather" in prompt


def test_penny_tools_md_lists_every_read_tool_and_the_g241_entry():
    text = (pathlib.Path(__file__).resolve().parent.parent.parent / "PENNY_TOOLS.md").read_text(encoding="utf-8")
    for t in TOOL_SCHEMAS:
        name = t["function"]["name"]
        assert f"`{name}" in text, f"{name} is missing from PENNY_TOOLS.md"
    assert "G241" in text and "periods_to_reach" in text


# ── the other small read-tool fixes G241 made ────────────────────────────

class _FakeAggCollection:
    def __init__(self, groups):
        self._groups = groups

    def aggregate(self, pipeline):
        groups = self._groups

        class _Cursor:
            async def to_list(self, n):
                return groups
        return _Cursor()


def test_search_totals_sum_every_match_not_just_the_returned_rows(monkeypatch):
    monkeypatch.setattr(penny_tools, "_SEARCH_COLLECTIONS", (
        _FakeAggCollection([{"_id": "debit", "total": 300.0, "n": 25}, {"_id": "credit", "total": 40.0, "n": 1}]),
        _FakeAggCollection([{"_id": "debit", "total": 60.25, "n": 5}]),
        _FakeAggCollection([]),
    ))
    out = _run(penny_tools._search_totals({"user_id": "u"}))
    assert out["matched_count"] == 31
    assert out["matched_spent"] == {"raw": 360.25, "formatted": "£360.25"}
    assert out["matched_received"] == {"raw": 40.0, "formatted": "£40.00"}


def test_search_totals_failure_is_swallowed_so_rows_still_return(monkeypatch):
    class _Boom:
        def aggregate(self, pipeline):
            raise RuntimeError("db down")
    monkeypatch.setattr(penny_tools, "_SEARCH_COLLECTIONS", (_Boom(),))
    assert _run(penny_tools._search_totals({})) is None


# ── routing through the B38 fake-model harness ───────────────────────────
# The corpus rows join the golden eval's catalogue gate: each row's expected
# tool sequence (its data tools, then `calculate` unless the row is a pure
# lookup) must be reachable against the REAL catalogue and descriptions, and
# every tool involved must have a pinned description hash. As with the other
# golden cases this pins the CATALOGUE, not a live model's judgement; the live
# half is scripts/penny_live_eval.py.
import test_penny_golden_eval as golden

ROUTED_CASES = [c for c in corpus.CASES if c["kind"] != "control"]


def _expected_sequence(case):
    seq = list(case["tools"])
    if case.get("must_calc", True):
        seq.append("calculate")
    return seq


@pytest.mark.parametrize("case", ROUTED_CASES, ids=[c["id"] for c in ROUTED_CASES])
def test_corpus_rows_route_through_the_golden_harness(monkeypatch, case):
    expected = _expected_sequence(case)
    for tool in expected:
        assert tool in golden.PINNED_TOOL_DESCRIPTION_HASHES, f"{case['id']}: no pinned hash for {tool}"
    client, dispatched, result = golden.run_case(monkeypatch, case["question"], case["screen"], expected)
    assert client.outcome == "ok", f"{case['id']}: {client.detail or client.outcome}"
    assert dispatched == expected
    assert result is not None


def test_pass_bar_is_every_deterministic_row():
    """The stated bar: 100% of rows with a deterministic reference. This test
    is the tally, so a regression names itself in one place."""
    failures = []
    for case in REFERENCE_CASES:
        ref = case["reference"]
        out = _run(execute_tool("bar-uid", "calculate", {"expression": ref["expression"], "inputs": ref["inputs"]}))
        if not out["ok"] or abs(out["result"] - ref["expected"]) > 1e-6:
            failures.append(case["id"])
    assert failures == [], f"deterministic rows failing: {failures}"
    assert len(REFERENCE_CASES) >= 15
