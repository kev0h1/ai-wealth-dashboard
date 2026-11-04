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
    plans = [{"source_account_id": "planacc", "active": True, "source_basis": "chosen"}]
    positions = {
        "planacc": {"plans_reserved": 0},
        "earmarkacc": {"earmarks_out": [{"to_account_id": "z", "amount": 10}], "earmarked_total": 10},
        "idleacc": {"plans_reserved": 0, "after_payments": 5.0, "low_point": 5.0},
    }
    rows = by_account_with_activity([], [], plans=plans, positions=positions)
    assert sorted(r["account_id"] for r in rows) == ["earmarkacc", "planacc"]
