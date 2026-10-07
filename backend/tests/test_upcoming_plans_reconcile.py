"""G227: Home's Safe-to-Spend and Upcoming's "Projected at payday" agree on
goal plan contributions, line by line.

Safe-to-Spend subtracts `commitments_reserved` (total_reserved_slices). GET
/cashflow now carries the same figure as `plans_reserved`, so Upcoming can show
it as its own "Plans this period" line and subtract it from the runway.
"""
import asyncio

import app.routers.analytics as analytics
import app.routers.commitments as commitments_router
from tests.test_cashflow_live_balance_overlay import UID, _fixture


def _plans(monkeypatch, amount, count):
    async def reserved(_uid):
        return amount, count

    monkeypatch.setattr(commitments_router, "total_reserved_slices", reserved)


def test_upcoming_and_safe_to_spend_agree_line_by_line_including_plans(monkeypatch):
    bills, income = _fixture(monkeypatch)
    _plans(monkeypatch, 80, 1)
    cash = asyncio.run(analytics.get_cashflow({"email": UID}))
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))

    bills_total = round(sum(b["amount"] for b in bills), 2)
    income_total = round(sum(i["amount"] for i in income), 2)
    allocations = round(sum(a["remaining"] for a in cash["allocations"]), 2)

    # Shared lines, one number each.
    assert sts["spendable_now"] == cash["spendable_balance"]
    assert sts["bills_total"] == bills_total
    assert sts["income_before_payday"] == income_total
    assert sts["allocations_reserved"] == allocations
    assert sts["commitments_reserved"] == cash["plans_reserved"] == 80
    assert sts["commitments_count"] == cash["plans_count"] == 1
    assert cash["plans_available"] is True

    # Upcoming runway exactly as PlanningPage.tsx computes it.
    runway = round(cash["spendable_balance"] + income_total - bills_total
                   - allocations - cash["plans_reserved"], 2)

    # Safe-to-Spend's only legitimate differences: the buffer (Home-only, G16;
    # zero in this fixture) and the walk's low point, which lands before the
    # income, so runway - safe_to_spend == income before payday.
    assert sts["buffer"] == 0
    assert sts["safe_to_spend"] == round(
        cash["spendable_balance"] - bills_total - allocations - 80, 2)
    assert round(runway - sts["safe_to_spend"], 2) == income_total


def test_plans_figure_is_zero_and_flagged_when_the_reserve_cannot_be_read(monkeypatch):
    _fixture(monkeypatch)

    async def boom(_uid):
        raise RuntimeError("db down")

    monkeypatch.setattr(commitments_router, "total_reserved_slices", boom)
    cash = asyncio.run(analytics.get_cashflow({"email": UID}))
    assert cash["plans_reserved"] == 0
    assert cash["plans_count"] == 0
    assert cash["plans_available"] is False
