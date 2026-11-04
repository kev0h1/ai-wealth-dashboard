"""G414: plans and payments share one cover recommendation per account."""
from tests.test_allocation_shortfall import _account, _bill, _plan, _run


def _moves(items, account_id):
    return [item for item in items if item.get("type") == "move" and (
        (item.get("plan_dest") or {}).get("account_id") == account_id or any(
            (row.get("move_map") or {}).get("to", {}).get("account_id") == account_id
            for row in item.get("moves") or []
        )
    )]


def test_payment_and_set_aside_shortfall_make_one_combined_move(monkeypatch):
    accounts = [_account("monzo", 50.0, name="Monzo"), _account("barclays", 1000.0, name="Barclays")]
    items = _run(monkeypatch, [_bill("Phone", 3, 100.0, "monzo", 50.0)],
                 [_plan("alloc-monzo-travel", "Travel", "monzo", 150.0)], accounts)
    cards = _moves(items, "monzo")
    assert len(cards) == 1
    card = cards[0]
    assert card["amount"] == 210.0  # £50 payment + £150 plan + one £10 cushion
    assert len(card["moves"]) == 1
    assert card["moves"][0]["amount"] == 210.0
    assert card["moves"][0]["move_map"]["from"]["account_id"] == "barclays"
    assert card["plan_shortfall"]["plans"] == [{
        "id": "alloc-monzo-travel", "name": "Travel", "remaining": 150.0,
        "period_amount": 150.0, "kind": "allocation",
    }]


def test_goal_only_shortfall_gets_the_same_cover_and_edit_metadata(monkeypatch):
    accounts = [_account("monzo", 50.0, name="Monzo"), _account("barclays", 1000.0, name="Barclays")]
    cards = _moves(_run(monkeypatch, [], [_plan("goal-home", "Home deposit", "monzo", 150.0, kind="goal")], accounts), "monzo")
    assert len(cards) == 1
    assert cards[0]["amount"] == 110.0
    assert cards[0]["plan_shortfall"]["plans"][0]["id"] == "goal-home"
    assert cards[0]["plan_shortfall"]["plans"][0]["kind"] == "goal"


def test_combined_move_partial_cover_does_not_keep_the_payment_only_success(monkeypatch):
    accounts = [_account("monzo", 50.0, name="Monzo"), _account("barclays", 100.0, name="Barclays")]
    items = _run(monkeypatch, [_bill("Phone", 3, 100.0, "monzo", 50.0)],
                 [_plan("travel", "Travel", "monzo", 150.0)], accounts)
    cards = _moves(items, "monzo")
    assert len(cards) == 1
    card = cards[0]
    assert card["amount"] == 90.0  # source keeps its £10 safety buffer
    assert card["covered"] is False  # £200 combined gap, not just the £50 payment gap
    assert len(card["moves"]) == 1
    assert "£110" in card["residual"]


def test_source_plan_reservation_is_not_spent_twice(monkeypatch):
    import app.services.companion as companion
    accounts = [_account("monzo", 0.0, name="Monzo"), _account("barclays", 200.0, name="Barclays")]
    plans = [_plan("source-goal", "Emergency fund", "barclays", 180.0, kind="goal"),
             _plan("monzo-plan", "Travel", "monzo", 100.0)]
    async def _goal_reserve(uid, pay_cfg, live_balances, salary_acct, account_map, **kwargs):
        return {"barclays": 180.0}

    monkeypatch.setattr(companion, "_reserved_for_goals", _goal_reserve)
    cards = _moves(_run(monkeypatch, [], plans, accounts), "monzo")
    assert len(cards) == 1
    assert sum(row["amount"] for row in cards[0]["moves"]) == 10.0
    assert cards[0]["amount"] == 10.0
