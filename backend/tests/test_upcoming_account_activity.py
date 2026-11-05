"""G420: the by-account activity rule (synthetic data only)."""
from app.services.upcoming_account_activity import account_has_period_activity, by_account_with_activity

BILLS = [{"account_id": "a1", "account_name": "Everyday", "account_bank": "Examplebank", "name": "Rent"}]
INCOME = [{"account_id": "a2", "account_name": "Main", "account_bank": "Samplebank", "name": "Pay"}]


def test_account_with_nothing_is_omitted():
    assert not account_has_period_activity("idle", bills=BILLS, income=INCOME, position={"plans_reserved": 0, "after_payments": 30.0, "low_point": 30.0})


def test_each_trigger_counts():
    assert account_has_period_activity("a1", bills=BILLS)
    assert account_has_period_activity("a2", income=INCOME)
    assert account_has_period_activity("x", plans=[{"source_account_id": "x", "active": True, "source_basis": "chosen"}])
    assert account_has_period_activity("x", position={"plans_reserved": 12.0})
    assert account_has_period_activity("x", position={"earmarks_out": [{"to_account_id": "y", "amount": 5}]})
    assert account_has_period_activity("x", position={"covered_by_move": {"amount": 5}})
    assert account_has_period_activity("x", position={"after_payments": -4.0})


def test_inactive_plan_does_not_count():
    assert not account_has_period_activity("x", plans=[{"source_account_id": "x", "active": False}])


def test_by_account_list_omits_idle_accounts():
    positions = {"idle": {"plans_reserved": 0, "after_payments": 9.0, "low_point": 9.0}, "move": {"covered_by_move": {"amount": 20}}}
    rows = by_account_with_activity(BILLS, INCOME, positions=positions)
    assert sorted(r["account_id"] for r in rows) == ["a1", "a2", "move"]


def test_tool_by_account_has_only_active_accounts():
    rows = by_account_with_activity(BILLS, INCOME)
    assert [r["account_id"] for r in rows] == ["a1", "a2"]
    assert rows[0]["bills"] == 1 and rows[1]["income"] == 1


def test_plan_only_and_earmark_only_accounts_are_listed_idle_is_not():
    plans = [{"source_account_id": "planacc", "active": True, "source_basis": "chosen", "period_amount": 50, "filled_amount": 0, "remaining": 50}]
    positions = {
        "planacc": {"plans_reserved": 0},
        "earmarkacc": {"earmarks_out": [{"to_account_id": "z", "amount": 10}], "earmarked_total": 10},
        "idleacc": {"plans_reserved": 0, "after_payments": 5.0, "low_point": 5.0},
    }
    rows = by_account_with_activity([], [], plans=plans, positions=positions)
    assert sorted(r["account_id"] for r in rows) == ["earmarkacc", "planacc"]


def _plan(source, remaining, active=True):
    return {"source_account_id": source, "active": active, "source_basis": "chosen", "period_amount": 50, "filled_amount": 50 - remaining, "remaining": remaining}


def test_filled_active_plan_does_not_list_an_idle_account():
    assert not account_has_period_activity("x", plans=[_plan("x", 0)])
    assert account_has_period_activity("x", plans=[_plan("x", 20)])
    assert account_has_period_activity("x", plans=[{**_plan("x", 20), "remaining": None}]), "unreadable plan is listed"


# ── tool level ──────────────────────────────────────────────────────────────
import asyncio
from types import SimpleNamespace

import app.services.penny_tools as pt


def _run_tool(monkeypatch, *, bills=(), income=(), inflows=(), eligibility=None, plans=(), accounts=()):
    async def cache(uid):
        return {"x": 1}

    async def resp(cached, uid=None):
        return {"upcoming_bills": list(bills), "upcoming_income": list(income), "internal_inflows": list(inflows)}

    async def today(uid):
        return {"account_eligibility": eligibility or {}}

    async def load_plans(uid, goals=False, strict=False):
        return list(plans)

    async def get_accounts(user=None):
        return [SimpleNamespace(id=i, name=n, provider=b, include_in_safe_to_spend=inc) for i, n, b, inc in accounts]

    import app.services.penny_consolidation as pc
    import app.services.companion as comp
    import app.routers.accounts as racc
    monkeypatch.setattr(pt, "_load_cashflow_cache", cache)
    monkeypatch.setattr(pt, "_build_cashflow_response", resp)
    monkeypatch.setattr(pc, "_load_today", today)
    monkeypatch.setattr(comp, "_load_account_plans", load_plans)
    monkeypatch.setattr(racc, "get_accounts", get_accounts)
    return asyncio.run(pt._exec_get_upcoming_bills("u"))["by_account"]


def test_tool_by_account_matches_the_ui_walk(monkeypatch):
    accounts = [("card", "Card acct", "Examplebank", True), ("pend", "Pending acct", "Examplebank", True), ("excl", "Excluded acct", "Examplebank", False),
                ("inflow", "Inflow acct", "Samplebank", True), ("planacc", "Plan acct", "Samplebank", True), ("earmark", "Earmark acct", "Samplebank", True), ("idle", "Idle acct", "Samplebank", True)]
    bills = [
        {"account_id": "card", "is_credit_card": True, "name": "Card charge"},
        {"account_id": "pend", "observed_pending": True, "name": "Settling"},
        {"account_id": "excl", "name": "Bill on excluded"},
    ]
    rows = _run_tool(
        monkeypatch, bills=bills,
        inflows=[{"account_id": "inflow", "expected_date": "2026-11-10"}],
        eligibility={"planacc": {"plans_reserved": 0}, "earmark": {"earmarks_out": [{"to_account_id": "inflow", "amount": 10}]}, "idle": {"plans_reserved": 0, "after_payments": 4.0, "low_point": 4.0}},
        plans=[_plan("planacc", 30)], accounts=accounts,
    )
    by_id = {r["account_id"]: r for r in rows}
    assert sorted(by_id) == ["earmark", "inflow", "planacc"]
    assert by_id["planacc"]["account_name"] == "Plan acct" and by_id["planacc"]["account_bank"] == "Samplebank"
    assert by_id["earmark"]["account_name"] == "Earmark acct"
    assert by_id["inflow"]["transfers_in"] == 1
