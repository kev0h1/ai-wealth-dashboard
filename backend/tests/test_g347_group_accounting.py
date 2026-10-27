"""Group edits must not manufacture money or count a transfer twice."""
import asyncio
from datetime import date
from unittest.mock import AsyncMock

from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds, EXCLUDED
from app.services.money_shape import average_for_window, bucket_period
from app.services.spending import classify_flow

START, END = date(2026, 9, 1), date(2026, 9, 30)


def txn(key, amount, category, debit=True, account="current"):
    return {"_id": key, "amount": amount, "category": category, "is_debit": debit,
            "account_id": account, "date": "2026-09-12"}


def kinds(kind):
    return CategoryKinds({**BUILTIN_CATEGORY_KINDS, "Business": kind})


def bucket(rows, kind, own=frozenset(), cards=frozenset()):
    return bucket_period([txn("salary", 1000, "Income", False), *rows], kinds(kind),
                         {"savings"}, START, END, own, cards)


def test_not_counted_nets_refunds_but_never_creates_leftover_cash():
    rows = [txn("pay", 100, "Business"), txn("refund", 20, "Business", False), txn("bill", 100, "Bills")]
    before = bucket(rows, "discretionary")
    after = bucket(rows, EXCLUDED)
    assert before["free"] == 80 and after["free"] == 0
    assert after["not_counted"] == 80
    assert after["left"] == before["left"] == 820
    assert after["total_out"] == before["total_out"] == 180
    assert sum(after["shares"].values()) == 100
    row = next(r for r in after["group_evidence"] if r["name"] == "Business")
    assert row["excluded"] == row["editable_amount"] == 80
    assert classify_flow(kinds(EXCLUDED), "Business", True).signed(100) == 0


def test_declared_movement_and_savings_credit_count_once():
    result = bucket([txn("move", 200, "Business"), txn("credit", 200, "Income", False, "savings")], "movement")
    assert result["take_home"] == 1000
    assert result["moved"] == 200
    assert result["left"] == 800
    assert result["category_totals"]["moved"]["Business"] == 200


def test_exclusion_cannot_override_confirmed_own_account_move():
    result = bucket([txn("own", 35, "Business"), txn("purchase", 25, "Business")], EXCLUDED, {"own"})
    assert result["moved"] == 35
    assert result["not_counted"] == 25
    row = next(r for r in result["group_evidence"] if r["name"] == "Business")
    assert row["moved"] == 35 and row["excluded"] == row["editable_amount"] == 25


def test_mixed_debt_evidence_explains_both_loans_and_cards():
    result = bucket([txn("loan", 50, "Debt"), txn("card", 180, "Debt")], "discretionary", cards={"card"})
    row = next(r for r in result["group_evidence"] if r["name"] == "Debt")
    assert result["fixed"] == row["fixed"] == 50
    assert row["excluded"] == 180
    assert result["not_counted"] == 0  # repayments excluded to avoid double counting, not a user exclusion


def test_excluded_overshoot_and_average_still_reconcile():
    result = bucket([txn("large", 1500, "Business")], EXCLUDED)
    assert result["left"] == 0 and result["beyond"] == 500
    average = average_for_window([result, result], 3)
    assert average["not_counted"] == 1500
    assert average["total_out"] == 1500
    assert average["beyond"] == 500
    assert average["not_counted_share"] == 100


def test_inflight_shape_cannot_repopulate_cache_after_edit(monkeypatch):
    from app.services import money_shape as m
    collection = AsyncMock()
    monkeypatch.setattr(m, "money_shape_cache_col", collection)
    monkeypatch.setattr(m, "compute_money_shape", AsyncMock(return_value={"status": "thin"}))
    monkeypatch.setattr(m.data_version, "current", AsyncMock(side_effect=[1, 2, 2, 2, 2]))
    asyncio.run(m.compute_and_cache_money_shape("g347-cache-fixture"))
    collection.update_one.assert_awaited_once()
    assert collection.update_one.call_args.args[1]["$set"]["data_version"] == 2
    assert m.compute_money_shape.await_count == 2


def test_builtin_saving_and_investment_own_evidence_never_double_counts():
    result = bucket([txn("save", 100, "Savings"), txn("invest", 50, "Investment")], "discretionary", {"save", "invest"})
    assert result["moved"] == 150
    assert result["left"] == 850


def test_signed_exclusion_shares_still_reconcile_to_one_hundred():
    from app.services.money_shape import shares_of
    shares = shares_of(200, 100, 150, 575, 0, -25)
    assert shares["not_counted"] < 0
    assert sum(shares.values()) == 100
