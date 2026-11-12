"""G461 source-payment tracking for editable set-asides."""
import asyncio
from datetime import date, datetime

from fastapi import HTTPException
import pytest

import app.routers.allocations as allocations
import app.services.plan_tracking as plan_tracking
from app.services.spending import SpendingContext


UID = "owner"
START, END = date(2026, 11, 1), date(2026, 11, 30)


class Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, _): return list(self.rows)


class Transactions:
    def __init__(self, rows): self.rows = rows
    def find(self, query, *_):
        return Cursor([row for row in self.rows if all(
            row.get(key) == value or (isinstance(value, dict) and
                (key != "date" or value["$gte"] <= row[key] <= value["$lte"]))
            for key, value in query.items()
        )])


def debit(amount, name="Monzo Savings Challenge", account="current", uid=UID):
    return {"user_id": uid, "account_id": account, "transaction_type": "debit", "amount": amount,
            "merchant_name": name, "description": name, "date": datetime(2026, 11, 12)}


def credit(amount, name="Monzo Savings Challenge", account="pot"):
    return {**debit(amount, name, account), "transaction_type": "credit"}


def test_manual_payment_rule_matches_only_outgoing_source_debits(monkeypatch):
    rows = [debit(12), debit(9, "Coffee"), credit(12), debit(80, uid="someone-else")]
    monkeypatch.setattr(allocations, "transactions_col", Transactions(rows))
    monkeypatch.setattr(allocations, "yapily_transactions_col", Transactions([]))
    async def no_rivals(*_args): return []
    monkeypatch.setattr(allocations, "_source_debit_rivals", no_rivals)
    doc = {"_id": "manual", "user_id": UID, "amount_per_period": 20, "tracking_mode": "manual",
           "source_account_id": "current", "fill_rule": {"match_type": "description_contains", "match_value": "Savings Challenge"},
           "effective_from": START, "recurrence": "every_period"}
    result = asyncio.run(allocations._serialise(doc, START, END))
    assert result["filled_this_period"] == 12
    assert result["remaining"] == 8
    assert result["fill_rule"] == doc["fill_rule"]


def test_manual_rule_is_fail_closed_and_legacy_inbound_is_unchanged(monkeypatch):
    rows = [debit(12), credit(12)]
    monkeypatch.setattr(allocations, "transactions_col", Transactions(rows))
    monkeypatch.setattr(allocations, "yapily_transactions_col", Transactions([]))
    async def no_rivals(*_args): return []
    monkeypatch.setattr(allocations, "_source_debit_rivals", no_rivals)
    malformed = {"_id": "malformed", "user_id": UID, "amount_per_period": 20, "tracking_mode": "manual", "source_account_id": "current",
                 "fill_rule": {"match_type": "all", "match_value": ""}, "effective_from": START, "recurrence": "every_period"}
    legacy = {"_id": "legacy", "user_id": UID, "amount_per_period": 20, "tracking_mode": "existing_payment", "fill_account_id": "pot",
              "match_type": "description_contains", "match_value": "Savings Challenge", "effective_from": START, "recurrence": "every_period"}
    assert asyncio.run(allocations._serialise(malformed, START, END))["remaining"] == 20
    assert asyncio.run(allocations._serialise(legacy, START, END))["filled_this_period"] == 12


def test_source_payment_rule_excludes_category_evidence_for_the_same_debit():
    row = {**debit(12), "_id": "payment", "category": "Groceries"}
    current = {"_id": "category", "_kind": "set-aside", "source_account_id": "current",
               "category_tracking": {"category": "Groceries"}}
    payment = {"_id": "payment-plan", "_kind": "set-aside", "tracking_mode": "manual",
               "source_account_id": "current", "fill_rule": {"match_type": "description_contains", "match_value": "Savings Challenge"}}
    context = SpendingContext.from_docs([row], {"Groceries": "discretionary"}, {"name_tokens": [], "own_ids": set(), "own_map": {}})
    assert plan_tracking.summarise_activity([row], current, [], START, END, context)["amount"] == 12
    assert plan_tracking.summarise_activity([row], current, [payment], START, END, context)["amount"] == 0


def test_source_rule_arbitration_uses_goal_priority_then_created_order(monkeypatch):
    rows = [debit(20)]
    monkeypatch.setattr(allocations, "transactions_col", Transactions(rows))
    monkeypatch.setattr(allocations, "yapily_transactions_col", Transactions([]))
    rule = {"match_type": "description_contains", "match_value": "Savings Challenge"}
    older = {"_id": "older", "created_at": datetime(2026, 1, 1), "source_account_id": "current"}
    newer = {"_id": "newer", "created_at": datetime(2026, 2, 1), "source_account_id": "current"}
    older_context = {"doc": older, "rule": rule, "expected_pence": 3000}
    newer_context = {"doc": newer, "rule": rule, "expected_pence": 3000}
    assert asyncio.run(allocations.source_debits_this_period(UID, "current", rule, START, END, doc=older, expected_pence=3000, rivals=[newer_context])) == 20
    assert asyncio.run(allocations.source_debits_this_period(UID, "current", rule, START, END, doc=newer, expected_pence=3000, rivals=[older_context])) == 0
    goal = {"doc": {"_id": "goal"}, "rule": rule, "expected_pence": 0, "goal_priority": True}
    assert asyncio.run(allocations.source_debits_this_period(UID, "current", rule, START, END, doc=older, expected_pence=2000, rivals=[goal])) == 0


def test_source_payment_excludes_future_dated_debits(monkeypatch):
    rows = [debit(12), {**debit(40), "date": datetime(2026, 11, 30)}]
    monkeypatch.setattr(allocations, "transactions_col", Transactions(rows))
    monkeypatch.setattr(allocations, "yapily_transactions_col", Transactions([]))
    monkeypatch.setattr(allocations.timeutil, "user_today", lambda: date(2026, 11, 12))
    rule = {"match_type": "description_contains", "match_value": "Savings Challenge"}
    assert asyncio.run(allocations.source_debits_this_period(UID, "current", rule, START, END)) == 12


def test_empty_source_rule_is_rejected():
    with pytest.raises(HTTPException):
        allocations.validate_fill_rule({"match_type": "description_contains", "match_value": ""})
