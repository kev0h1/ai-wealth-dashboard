"""Tests for app.services.safe_calc, the generic arithmetic tool behind
Penny's `calculate` (owner-approved 2026-08-30, see PENNY_TOOLS.md's
`calculate` row and safe_calc.py's own module docstring for the full
whitelist and bounds this pins).

Two halves: CORRECTNESS (the whitelist actually computes the right answer
for every allowed shape, including the owner's own arithmetic-series case)
and SAFETY (everything not on the whitelist is rejected cleanly, never
raises, never hangs). Every safety case is wrapped in a wall-clock
assertion to prove termination, not just correctness of the returned shape
- `evaluate` has no internal timeout of its own (see the module docstring's
"Bounds" section for why the AST-node/exponent/count caps make one
unnecessary), so a genuinely hanging construction would show up here as a
slow test, not a hung one.
"""
import time

from app.services.safe_calc import (
    MAX_AST_NODES, MAX_EXPONENT_ABS, MAX_EXPR_LEN, MAX_SERIES_COUNT, evaluate,
)

_TERMINATION_BUDGET_S = 2.0


def _timed_evaluate(expression: str) -> dict:
    """Runs evaluate() and asserts it returned within the termination
    budget, proving the call didn't hang, before handing back the result
    for the caller's own assertions."""
    started = time.monotonic()
    result = evaluate(expression)
    elapsed = time.monotonic() - started
    assert elapsed < _TERMINATION_BUDGET_S, (
        f"evaluate({expression!r}) took {elapsed:.2f}s, exceeding the "
        f"{_TERMINATION_BUDGET_S}s termination budget"
    )
    return result


# ── Correctness ──────────────────────────────────────────────────────────

def test_operator_precedence():
    r = evaluate("2 + 3 * 4")
    assert r == {"ok": True, "result": 14, "error": None}


def test_parentheses_override_precedence():
    r = evaluate("(2 + 3) * 4")
    assert r == {"ok": True, "result": 20, "error": None}


def test_floats():
    r = evaluate("1.5 + 2.25")
    assert r["ok"] is True
    assert r["result"] == 3.75


def test_unary_minus():
    r = evaluate("-5 + 10")
    assert r == {"ok": True, "result": 5, "error": None}


def test_floor_div_and_mod():
    assert evaluate("7 // 2")["result"] == 3
    assert evaluate("7 % 2")["result"] == 1


def test_round_one_and_two_arg_forms():
    assert evaluate("round(2.5678)")["result"] == 3
    r = evaluate("round(2.5678, 2)")
    assert r["ok"] is True
    assert r["result"] == 2.57


def test_min_and_max():
    assert evaluate("min(4, 2, 9)")["result"] == 2
    assert evaluate("max(4, 2, 9)")["result"] == 9


def test_abs():
    assert evaluate("abs(-7)")["result"] == 7


def test_series_sum_owner_exact_case():
    # Owner's own worked example: a first payment of £8.96, rising 4p (0.04)
    # a day, for 27 days. True value, computed independently of the
    # implementation: count*first + step*count*(count-1)/2
    #   = 27*8.96 + 0.04*27*26/2 = 241.92 + 14.04 = 255.96
    expected = 27 * 8.96 + 0.04 * 27 * 26 / 2
    assert round(expected, 2) == 255.96
    r = evaluate("series_sum(8.96, 0.04, 27)")
    assert r["ok"] is True
    assert round(r["result"], 2) == 255.96


def test_series_sum_zero_step_is_flat_total():
    r = evaluate("series_sum(10, 0, 5)")
    assert r == {"ok": True, "result": 50.0, "error": None}


def test_series_sum_negative_step_descends():
    # first=100, falling by 10 each time, 4 payments: 100+90+80+70 = 340
    r = evaluate("series_sum(100, -10, 4)")
    assert r["ok"] is True
    assert r["result"] == 340.0


def test_days_between_across_month_boundary():
    # 2026-01-28 -> 2026-02-03: Jan has 31 days, so this spans 6 whole days
    # (29, 30, 31 Jan, then 1, 2, 3 Feb), inclusive of the start date,
    # exclusive of the end date (see safe_calc's own docstring for the
    # convention and why).
    r = evaluate("days_between('2026-01-28', '2026-02-03')")
    assert r == {"ok": True, "result": 6, "error": None}


def test_days_between_same_date_is_zero():
    r = evaluate("days_between('2026-01-01', '2026-01-01')")
    assert r["result"] == 0


def test_pct():
    r = evaluate("pct(200, 15)")
    assert r == {"ok": True, "result": 30.0, "error": None}


def test_nested_expression_combining_series_sum_and_arithmetic():
    # A realistic Penny use: the series total plus a flat top-up.
    r = evaluate("round(series_sum(8.96, 0.04, 27) + 10, 2)")
    assert r["ok"] is True
    assert r["result"] == 265.96


# ── Safety ───────────────────────────────────────────────────────────────

def test_dunder_import_rejected():
    r = _timed_evaluate("__import__('os')")
    assert r["ok"] is False
    assert r["result"] is None
    assert r["error"]


def test_dunder_import_with_attribute_call_rejected():
    r = _timed_evaluate("__import__('os').system('ls')")
    assert r["ok"] is False
    assert r["error"]


def test_bare_name_rejected():
    r = _timed_evaluate("x + 1")
    assert r["ok"] is False
    assert r["error"]


def test_attribute_access_rejected():
    r = _timed_evaluate("abs.__class__")
    assert r["ok"] is False
    assert r["error"]


def test_subscript_rejected():
    r = _timed_evaluate("[1, 2, 3][0]")
    assert r["ok"] is False
    assert r["error"]


def test_list_comprehension_rejected():
    r = _timed_evaluate("[x for x in range(3)]")
    assert r["ok"] is False
    assert r["error"]


def test_generator_expression_rejected():
    r = _timed_evaluate("sum(x for x in range(3))")
    assert r["ok"] is False
    assert r["error"]


def test_lambda_rejected():
    r = _timed_evaluate("(lambda x: x)(5)")
    assert r["ok"] is False
    assert r["error"]


def test_huge_exponent_rejected():
    r = _timed_evaluate(f"2 ** {MAX_EXPONENT_ABS + 1}")
    assert r["ok"] is False
    assert r["error"]


def test_exponent_at_bound_is_allowed():
    r = _timed_evaluate(f"2 ** {MAX_EXPONENT_ABS}")
    assert r["ok"] is True
    assert r["result"] == 2 ** MAX_EXPONENT_ABS


def test_tower_of_powers_shape_rejected_and_terminates():
    # Right-associative: 10 ** (10 ** 10). The inner power is well within
    # bound and computes fine (a 10-digit int); the OUTER power's own
    # exponent (10 billion) is checked against MAX_EXPONENT_ABS BEFORE the
    # outer ** is ever attempted, so this returns fast rather than hanging
    # or blowing up memory.
    r = _timed_evaluate("10 ** 10 ** 10")
    assert r["ok"] is False
    assert r["error"]


def test_absurd_series_count_rejected():
    r = _timed_evaluate(f"series_sum(1, 1, {MAX_SERIES_COUNT + 1})")
    assert r["ok"] is False
    assert r["error"]


def test_series_count_at_bound_is_allowed():
    r = _timed_evaluate(f"series_sum(1, 0, {MAX_SERIES_COUNT})")
    assert r["ok"] is True


def test_expression_over_max_length_rejected():
    expr = "1" + "+1" * ((MAX_EXPR_LEN // 2) + 5)
    assert len(expr) > MAX_EXPR_LEN
    r = _timed_evaluate(expr)
    assert r["ok"] is False
    assert r["error"]


def test_expression_at_max_length_boundary_is_not_rejected_for_length_alone():
    # Exactly at the char cap should not be rejected by the LENGTH check
    # (it may still be rejected by the AST-node cap depending on shape, but
    # must never be rejected with the "too long" message specifically).
    expr = "1" + "+1" * ((MAX_EXPR_LEN - 1) // 2)
    assert len(expr) <= MAX_EXPR_LEN
    r = _timed_evaluate(expr)
    assert r["error"] != f"that expression is too long, keep it under {MAX_EXPR_LEN} characters"


def test_too_many_ast_nodes_rejected():
    expr = "+".join(["1"] * 100)  # 199 nodes, well under the char cap
    assert len(expr) <= MAX_EXPR_LEN
    r = _timed_evaluate(expr)
    assert r["ok"] is False
    assert r["error"]


def test_string_literal_outside_days_between_rejected():
    r = _timed_evaluate("'2026-01-01'")
    assert r["ok"] is False
    assert r["error"]


def test_string_argument_to_other_function_rejected():
    r = _timed_evaluate("round('5')")
    assert r["ok"] is False
    assert r["error"]


def test_computed_string_argument_to_days_between_rejected():
    # days_between's arguments must be literal date strings, not an
    # expression that merely evaluates to a string.
    r = _timed_evaluate("days_between('2026-01-0' + '1', '2026-01-02')")
    assert r["ok"] is False
    assert r["error"]


def test_nested_forbidden_call_inside_allowed_call_rejected():
    r = _timed_evaluate("round(__import__('os').system('ls'))")
    assert r["ok"] is False
    assert r["error"]


def test_division_by_zero_rejected_cleanly():
    r = _timed_evaluate("10 / 0")
    assert r == {"ok": False, "result": None, "error": r["error"]}
    assert "zero" in r["error"]


def test_floor_division_by_zero_rejected_cleanly():
    r = _timed_evaluate("10 // 0")
    assert r["ok"] is False
    assert "zero" in r["error"]


def test_modulo_by_zero_rejected_cleanly():
    r = _timed_evaluate("10 % 0")
    assert r["ok"] is False
    assert "zero" in r["error"]


def test_result_over_bound_rejected():
    r = _timed_evaluate("999999999999999999999999999999999999999999999999 ** 12")
    assert r["ok"] is False
    assert r["error"]


def test_unknown_function_rejected():
    r = _timed_evaluate("sqrt(4)")
    assert r["ok"] is False
    assert r["error"]


def test_keyword_arguments_rejected():
    r = _timed_evaluate("round(2.5, ndigits=1)")
    assert r["ok"] is False
    assert r["error"]


def test_empty_expression_rejected():
    r = _timed_evaluate("")
    assert r["ok"] is False
    assert r["error"]


def test_unparseable_expression_rejected():
    r = _timed_evaluate("2 +* 3")
    assert r["ok"] is False
    assert r["error"]


def test_boolean_literal_rejected():
    r = _timed_evaluate("True + 1")
    assert r["ok"] is False
    assert r["error"]


def test_non_expression_statement_rejected():
    r = _timed_evaluate("import os")
    assert r["ok"] is False
    assert r["error"]
