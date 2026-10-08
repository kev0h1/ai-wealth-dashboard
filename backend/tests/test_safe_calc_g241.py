"""G241 additions to app.services.safe_calc: named inputs, currency strings
and the Unicode minus, the extra functions, and the safety properties that
must survive them (no names without an input, no function-name inputs, no
attribute or subscript escape, never raises)."""
import pytest

from app.services.safe_calc import evaluate, parse_amount


# ── parse_amount ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("£1,250.00", 1250.0), ("−£380", -380.0), ("-£380.50", -380.5), ("£-380", -380.0),
    (" 42 ", 42.0), (7, 7.0), (2.5, 2.5), ({"raw": 12.5, "formatted": "£12.50"}, 12.5),
    ("–£5", -5.0),
])
def test_parse_amount_accepts_money_shapes(raw, expected):
    assert parse_amount(raw) == expected


@pytest.mark.parametrize("raw", ["abc", "", None, True, "1e999", float("inf"), [], "£", "12 pounds"])
def test_parse_amount_rejects_non_numbers(raw):
    assert parse_amount(raw) is None


# ── currency literals in the expression ──────────────────────────────────

def test_currency_strings_and_unicode_minus_in_expression():
    assert evaluate("£4,310.50 − £1,250.00")["result"] == 3060.5
    assert evaluate("−£380 + £1,000")["result"] == 620.0
    assert evaluate("£132.60 ÷ 4")["result"] == 33.15
    assert evaluate("£12 × 52")["result"] == 624.0


def test_bare_thousands_comma_is_not_swallowed_into_one_number():
    # max(1,250) is a two-argument call, not 1250.
    assert evaluate("max(1,250)")["result"] == 250


# ── named inputs ─────────────────────────────────────────────────────────

def test_inputs_resolve_money_strings_raw_numbers_and_money_dicts():
    r = evaluate("a + b + c", {"a": "£1,250.00", "b": 4310.5, "c": {"raw": -380, "formatted": "−£380"}})
    assert r["ok"] and r["result"] == 5180.5
    assert r["inputs_used"] == {"a": 1250.0, "b": 4310.5, "c": -380.0}


def test_inputs_used_lists_only_names_the_expression_referenced():
    r = evaluate("a * 2", {"a": 5, "unused": 99})
    assert r["inputs_used"] == {"a": 5.0}


def test_no_inputs_used_key_when_none_referenced():
    assert evaluate("2 + 3") == {"ok": True, "result": 5, "error": None}


def test_unknown_name_is_rejected_without_inputs():
    r = evaluate("target - saved")
    assert not r["ok"] and "not one of the inputs" in r["error"]


def test_name_not_in_supplied_inputs_is_rejected():
    assert not evaluate("a + b", {"a": 1})["ok"]


@pytest.mark.parametrize("bad_name", ["round", "sum", "avg", "pct", "1x", "a b", "a.b", "", "x" * 40])
def test_bad_or_function_named_inputs_are_rejected(bad_name):
    r = evaluate("1 + 1", {bad_name: 1})
    assert not r["ok"]


def test_non_numeric_input_value_is_rejected():
    r = evaluate("a + 1", {"a": "about nine"})
    assert not r["ok"] and "not a number" in r["error"]


def test_too_many_inputs_rejected():
    assert not evaluate("a0", {f"a{i}": i for i in range(21)})["ok"]


@pytest.mark.parametrize("expr", [
    "a.real", "a[0]", "(lambda: 1)()", "__import__('os').system('ls')",
    "[a for a in range(3)]", "a if a else 1", "getattr(a, 'real')", "a and 1", "not a",
    "a; b", "a == 1", "'text'", "sum(a for a in (1,2))",
])
def test_names_never_unlock_anything_else(expr):
    r = evaluate(expr, {"a": 1, "b": 2})
    assert r["ok"] is False


# ── new functions ────────────────────────────────────────────────────────

def test_sum_and_avg():
    assert evaluate("sum(1, 2, 3.5)")["result"] == 6.5
    assert evaluate("avg(10, 20, 60)")["result"] == 30.0
    assert not evaluate("sum()")["ok"]
    assert not evaluate("avg()")["ok"]


def test_shortfall_is_how_much_more_and_never_negative():
    assert evaluate("shortfall(2000, 1250)")["result"] == 750
    assert evaluate("shortfall(2000, 2500)")["result"] == 0


def test_periods_to_reach_rounds_up_and_handles_edges():
    assert evaluate("periods_to_reach(2000, 1250, 150)")["result"] == 5
    assert evaluate("periods_to_reach(2000, 1250, 400)")["result"] == 2
    assert evaluate("periods_to_reach(1000, 1250, 150)")["result"] == 0
    r = evaluate("periods_to_reach(2000, 1250, 0)")
    assert not r["ok"] and "above zero" in r["error"]
    assert not evaluate("periods_to_reach(2000, 1250, -5)")["ok"]
    assert not evaluate("periods_to_reach(1e9, 0, 1)")["ok"]


def test_per_week_pct_change_share():
    assert evaluate("per_week(1020, 90)")["result"] == pytest.approx(79.3333333333)
    assert not evaluate("per_week(100, 0)")["ok"]
    assert evaluate("pct_change(331.15, 286.40)")["result"] == pytest.approx(-13.5135, abs=1e-3)
    assert not evaluate("pct_change(0, 5)")["ok"]
    assert evaluate("share(286.40, 1812.30)")["result"] == pytest.approx(15.8026, abs=1e-3)
    assert not evaluate("share(1, 0)")["ok"]


def test_wrong_arity_is_a_clean_error_not_an_exception():
    for expr in ("shortfall(1)", "periods_to_reach(1, 2)", "pct_change(1)", "share(1)", "per_week(1)"):
        assert not evaluate(expr)["ok"]


def test_evaluate_never_raises_on_garbage():
    for junk in ("", "   ", "((((", "1 +", "£", "£,", "1,2,3", "−", "9" * 500, "a" * 50):
        out = evaluate(junk, {"a": 1})
        assert set(out) >= {"ok", "result", "error"}
