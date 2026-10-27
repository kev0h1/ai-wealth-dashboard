"""Not counted is neither spending nor a transfer in Penny's read tools."""
import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import penny_tools
from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds

KINDS = CategoryKinds({**BUILTIN_CATEGORY_KINDS, "Business": "excluded"})


@pytest.mark.parametrize("with_context", [False, True])
def test_account_cash_still_reconciles_without_calling_excluded_money_a_transfer(with_context):
    rows = [
        {"_id": key, "category": category, "amount": amount, "transaction_type": direction,
         "date": datetime(2026, 10, 12)}
        for key, category, amount, direction in [
            ("excluded", "Business", 100, "debit"), ("excluded-refund", "Business", 20, "credit"),
            ("spend", "Shopping", 40, "debit"), ("refund", "Shopping", 10, "credit"),
            ("transfer", "Transfer", 70, "debit"), ("own", "Business", 30, "debit"),
        ]
    ]
    ctx = SimpleNamespace(is_own_move=lambda key: key == "own", is_card_repayment=lambda key: False) if with_context else None
    account = SimpleNamespace(id="current", name="Current", balance=1000)
    result = penny_tools._summarise_account_activity(account, rows, KINDS, ctx)
    assert result["money_out_spend"]["raw"] == 40
    assert result["money_out_movement"]["raw"] == (100 if with_context else 70)
    assert result["money_out_not_counted"]["raw"] == (100 if with_context else 130)
    assert result["money_out"]["raw"] == sum(result[key]["raw"] for key in ("money_out_spend", "money_out_movement", "money_out_not_counted")) == 240
    assert result["money_in"]["raw"] == 30
    assert result["net"]["raw"] == -210


def test_excluded_category_history_is_not_returned_as_spending(monkeypatch):
    monkeypatch.setattr(penny_tools, "get_category_kinds", AsyncMock(return_value=KINDS))
    context = AsyncMock()
    monkeypatch.setattr(penny_tools, "build_spending_context", context)
    rows = asyncio.run(penny_tools._category_txn_rows("fixture", "Business", datetime(2026, 9, 1), datetime(2026, 9, 30)))
    assert rows == []
    context.assert_not_awaited()


def test_penny_explains_why_excluded_category_has_no_spend_total(monkeypatch):
    monkeypatch.setattr(penny_tools, "_resolve_user_category", AsyncMock(return_value=("Business", list(KINDS))))
    monkeypatch.setattr(penny_tools, "get_category_kinds", AsyncMock(return_value=KINDS))
    verdict = AsyncMock()
    monkeypatch.setattr(penny_tools, "compute_spend_verdict", verdict)
    result = asyncio.run(penny_tools._exec_get_category_spend("fixture", "Business", 3))
    assert result["counted_in_spending"] is False
    assert "Not counted" in result["note"]
    assert "cash effects are still recorded" in result["note"]
    verdict.assert_not_awaited()


def test_penny_correction_targets_match_the_apps_spend_picker(monkeypatch):
    from app.routers import categories
    monkeypatch.setattr(categories, "get_categories", AsyncMock(return_value={
        "all": ["Business", "Shopping", "Transfer", "Income", "Other"], "kinds": KINDS,
    }))
    valid, _ = asyncio.run(penny_tools._recat_valid_categories("fixture"))
    assert valid == ["Shopping"]


def test_stacked_spend_chart_explains_the_excluded_category(monkeypatch):
    from app.core import timeutil
    async def resolve(uid, name):
        return name, list(KINDS)
    async def category_rows(uid, name, start, end):
        return [] if name == "Business" else [{"amount": 40, "transaction_type": "debit", "date": datetime.combine(timeutil.user_today(), datetime.min.time())}]
    monkeypatch.setattr(penny_tools, "_resolve_user_category", resolve)
    monkeypatch.setattr(penny_tools, "get_category_kinds", AsyncMock(return_value=KINDS))
    monkeypatch.setattr(penny_tools, "_category_txn_rows", category_rows)
    result = asyncio.run(penny_tools._stacked_category_chart("fixture", ["Business", "Shopping"], 3, {"type": "stacked_bar"}))
    assert result["not_counted_categories"] == ["Business"]
    assert "Business: marked Not counted" in result["_chart"]["note"]


def test_penny_does_not_guess_spending_when_category_meaning_is_unavailable(monkeypatch):
    monkeypatch.setattr(penny_tools, "_resolve_user_category", AsyncMock(return_value=("Business", list(KINDS))))
    monkeypatch.setattr(penny_tools, "get_category_kinds", AsyncMock(side_effect=RuntimeError("offline")))
    verdict = AsyncMock()
    monkeypatch.setattr(penny_tools, "compute_spend_verdict", verdict)
    result = asyncio.run(penny_tools._exec_get_category_spend("fixture", "Business", 3))
    assert result["error"] == "category meaning lookup failed"
    assert "spent" not in result
    verdict.assert_not_awaited()
    with pytest.raises(RuntimeError, match="offline"):
        asyncio.run(penny_tools._category_txn_rows("fixture", "Business", datetime(2026, 9, 1), datetime(2026, 9, 30)))
