"""G245: compound growth (`future_value`) and the `calculate` growth branch.

Convention under test: monthly compounding at annual/12, contributions at the
END of each month, starting balance compounding from month one."""
import asyncio

import pytest

from app.services.penny_tools import execute_tool
from app.services.safe_calc import MAX_GROWTH_MONTHS, evaluate, future_value


def test_kevins_figure_300_a_month_at_6_5_for_a_year():
    out = future_value(300, 6.5, 12)
    print("G245 exact:", out["future_value"], out["total_contributed"], out["growth"])
    assert out["ok"]
    assert out["future_value"] == 3709.21
    assert out["total_contributed"] == 3600.0
    assert out["growth"] == 109.21
    assert [y["year"] for y in out["years"]] == [1]


def test_zero_rate_is_plain_saving():
    out = future_value(100, 0, 24)
    assert out["future_value"] == 2400.0 and out["growth"] == 0.0
    assert [y["balance"] for y in out["years"]] == [1200.0, 2400.0]


def test_starting_balance_compounds_from_month_one():
    out = future_value(300, 6.5, 12, 1000)
    assert out["total_contributed"] == 4600.0
    assert out["future_value"] == pytest.approx(3709.21 + 1000 * (1 + 0.065 / 12) ** 12, abs=0.01)
    # money strings and the Penny money shape are accepted
    assert future_value("£300", 6.5, 12, "£1,000")["future_value"] == out["future_value"]


def test_zero_months_is_the_starting_balance():
    out = future_value(300, 6.5, 0, 500)
    assert out["future_value"] == 500.0 and out["years"] == [] and out["growth"] == 0.0


def test_part_years_get_a_final_row_and_years_table_is_consistent():
    out = future_value(300, 6.5, 30)
    assert [y["months"] for y in out["years"]] == [12, 24, 30]
    assert out["years"][-1]["balance"] == out["future_value"]


@pytest.mark.parametrize("args", [
    (1e12, 5, 12), (300, 5, MAX_GROWTH_MONTHS + 1), (300, 150, 12), (300, -1, 12),
    (-5, 5, 12), (300, 5, 12.5), ("abc", 5, 12), (300, 5, 12, 1e12), (300, float("inf"), 12),
    (300, float("nan"), 12), (True, 5, 12),
])
def test_huge_or_bad_inputs_are_rejected_cleanly(args):
    out = future_value(*args)
    assert out["ok"] is False and out["error"]


def test_longest_allowed_horizon_is_bounded_and_fast():
    assert future_value(1000, 100, MAX_GROWTH_MONTHS)["ok"] is False  # exceeds the result cap
    assert future_value(1000, 5, MAX_GROWTH_MONTHS)["ok"] is True


def test_future_value_inside_an_expression_matches():
    assert evaluate("future_value(300, 6.5, 12)")["result"] == 3709.21
    assert evaluate("future_value(300, 6.5, 12, 1000) - 1000")["ok"]
    assert evaluate("future_value(300, 6.5)")["ok"] is False
    assert evaluate("future_value(300, 6.5, 9999)")["ok"] is False


def test_calculate_tool_growth_branch_formats_and_hedges():
    out = asyncio.run(execute_tool("u", "calculate", {
        "growth": {"monthly_contribution": 300, "annual_rate_pct": 6.5, "months": 12},
    }))
    assert out["ok"] and out["result"] == 3709.21
    g = out["growth"]
    assert g["future_value_formatted"] == "£3,709.21"
    assert g["total_contributed_formatted"] == "£3,600.00"
    assert g["growth_formatted"] == "£109.21"
    assert "not guaranteed" in g["hedge"] and "capital is at risk" in g["hedge"]
    assert "6.5%" in g["hedge"]
    assert g["assumptions"]["contribution_timing"] == "end of each month"


def test_calculate_tool_growth_errors_do_not_raise():
    bad = asyncio.run(execute_tool("u", "calculate", {"growth": {"monthly_contribution": 1, "annual_rate_pct": 5, "months": 99999}}))
    assert bad["ok"] is False and bad["error"] and "growth" not in bad
    notdict = asyncio.run(execute_tool("u", "calculate", {"growth": "lots"}))
    assert notdict["ok"] is False
