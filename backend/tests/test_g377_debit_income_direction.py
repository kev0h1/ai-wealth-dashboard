"""G377: automatic Income rules respect bank transaction direction."""

import asyncio
from datetime import datetime

from app.services.categorisation import rule_categorise_directed


class _Transactions:
    """Enough of the unified collection for the two real sync upsert paths."""

    def __init__(self):
        self.rows = {}

    async def find_one_and_update(self, filt, update, *, upsert, **_kwargs):
        txn_id = filt["_id"]
        before = self.rows.get(txn_id)
        row = dict(before or {})
        row.update(update.get("$setOnInsert") or {} if before is None else {})
        row.update(update.get("$set") or {})
        self.rows[txn_id] = row
        return before


def test_reward_rule_is_income_only_for_a_credit():
    assert rule_categorise_directed("", "PERKS REWARD", is_credit=True) == "Income"
    assert rule_categorise_directed("", "PERKS REWARD", is_credit=False) is None


def test_truelayer_upsert_keeps_perks_debit_out_of_income_and_credit_in_income(monkeypatch):
    from app.services import truelayer_sync as sync

    rows = _Transactions()
    monkeypatch.setattr(sync, "transactions_col", rows)
    now = datetime(2026, 10, 31, 9, 0).isoformat() + "Z"
    txns = [
        {"transaction_id": "tl-debit", "amount": -9, "currency": "GBP", "timestamp": now,
         "description": "PERKS REWARD"},
        {"transaction_id": "tl-credit", "amount": 9, "currency": "GBP", "timestamp": now,
         "description": "PERKS REWARD"},
    ]

    asyncio.run(sync._upsert_walk(txns, "account", "user", False, None, {"changed": False}))

    assert rows.rows["tl-debit"]["transaction_type"] == "debit"
    assert rows.rows["tl-debit"]["category"] is None
    assert rows.rows["tl-credit"]["transaction_type"] == "credit"
    assert rows.rows["tl-credit"]["category"] == "Income"


def test_finexer_upsert_keeps_perks_debit_out_of_income_and_credit_in_income(monkeypatch):
    from app.services import finexer_sync as sync

    rows = _Transactions()
    monkeypatch.setattr(sync, "transactions_col", rows)
    when = datetime(2026, 10, 31, 9, 0).isoformat()
    txns = [
        {"id": "fx-debit", "amount": -9, "currency": "GBP", "date": when,
         "description": "PERKS REWARD"},
        {"id": "fx-credit", "amount": 9, "currency": "GBP", "date": when,
         "description": "PERKS REWARD"},
    ]

    asyncio.run(sync._upsert_finexer_walk(txns, "account", "user", None, {"changed": False}))

    assert rows.rows["fx-debit"]["transaction_type"] == "debit"
    assert rows.rows["fx-debit"]["category"] is None
    assert rows.rows["fx-credit"]["transaction_type"] == "credit"
    assert rows.rows["fx-credit"]["category"] == "Income"


def test_sync_preserves_an_explicit_income_category_on_a_debit(monkeypatch):
    """A real income reversal can be a user-selected debit Income row."""
    from app.services import truelayer_sync as sync

    rows = _Transactions()
    rows.rows["chosen"] = {"_id": "chosen", "custom_category": "Income", "category": "Income"}
    monkeypatch.setattr(sync, "transactions_col", rows)
    txn = {
        "transaction_id": "chosen", "amount": -20, "currency": "GBP",
        "timestamp": datetime(2026, 10, 31, 9, 0).isoformat() + "Z",
        "description": "PERKS REWARD",
    }

    asyncio.run(sync._upsert_walk([txn], "account", "user", False, None, {"changed": False}))

    assert rows.rows["chosen"]["category"] is None
    assert rows.rows["chosen"]["custom_category"] == "Income"
