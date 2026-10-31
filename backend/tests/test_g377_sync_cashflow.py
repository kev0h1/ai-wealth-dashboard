"""Exercise first-connection reconciliation and the real cashflow input path."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import pytest

from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds
from app.services.own_account_transfers import build_match_metadata


def test_first_connection_reconciles_after_rows_arrive(monkeypatch):
    from app.services import truelayer_sync as sync, own_account_transfers as transfers
    calls = []

    @asynccontextmanager
    async def progress(*_):
        yield

    async def fetch(connection, user, from_date):
        calls.append(("fetch", connection, user))
        return ["account"]

    async def reconcile(user):
        calls.append(("reconcile", user))
        return 2

    monkeypatch.setattr(sync, "sync_in_progress", progress)
    monkeypatch.setattr(sync, "_sync_connection", fetch)
    monkeypatch.setattr(transfers, "reconcile_own_account_transfers", reconcile)
    assert asyncio.run(sync.sync_connection("connection", "owner")) == ["account"]
    assert calls == [("fetch", "connection", "owner"), ("reconcile", "owner")]


class Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, _): return self.rows


class Collection:
    def __init__(self, rows): self.rows = rows
    def find(self, query, projection):
        # Honour projections: missing evidence fields must break the test.
        return Cursor([{k: v for k, v in row.items() if k == "_id" or projection.get(k)} for row in self.rows])
    async def find_one(self, *_): return None


@pytest.mark.parametrize("change", [None, "category_reset", "counterpart_spending", "counterpart_deleted", "pending", "account_removed"])
def test_cashflow_revalidates_transfer_and_retains_source_outflow(monkeypatch, change):
    from app.routers import analytics
    now = datetime.now() - timedelta(days=1)
    credit = {"_id": "credit", "account_id": "target", "amount": 150.98,
              "date": now, "transaction_type": "credit", "category": "Income",
              "description": "FROM A/C MAINGI KM VIA MOBILE XFER", "currency": "GBP"}
    debit = {**credit, "_id": "debit", "account_id": "source", "transaction_type": "debit",
             "category": "Other", "description": "TO MAINGI KM MOBILE TRANSFER"}
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer")
    debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer")
    credit["category"] = debit["category"] = "Transfer"
    # Legacy rows use account currency. Marker signatures describe the same
    # canonical evidence even when the transaction omitted the field.
    credit.pop("currency")
    debit.pop("currency")
    if change == "category_reset": credit["category"] = "Income"
    if change == "counterpart_spending": debit["custom_category"] = "Shopping"
    if change == "pending": debit["is_pending"] = True
    salary = {**credit, "_id": "salary", "description": "ACME PAYROLL", "category": "Income"}
    salary.pop("own_transfer_match")
    rows = [credit, salary] + ([] if change == "counterpart_deleted" else [debit])
    accounts = [{"_id": id_, "currency": "GBP", "type": "current", "balance": 500} for id_ in ("target", "source")]
    if change == "account_removed": accounts.pop()
    monkeypatch.setattr(analytics, "transactions_col", Collection(rows))
    monkeypatch.setattr(analytics, "yapily_transactions_col", Collection([]))
    monkeypatch.setattr(analytics, "accounts_col", Collection(accounts))
    monkeypatch.setattr(analytics, "yapily_accounts_col", Collection([]))
    monkeypatch.setattr(analytics, "preferences_col", Collection([]))

    async def kinds(_): return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
    async def judge(*_): return {}
    monkeypatch.setattr(analytics, "get_category_kinds", kinds)
    monkeypatch.setattr(analytics, "judge_suspect_series", judge)
    seen = {}

    class Captured(Exception): pass

    def detect(txns, *, is_income, **kwargs):
        seen[is_income] = txns
        if is_income: raise Captured
        return []

    monkeypatch.setattr(analytics, "_detect_recurring", detect)
    with pytest.raises(Captured): asyncio.run(analytics._compute_cashflow_patterns("owner"))
    expected = {"salary"} if change in (None, "category_reset") else {"credit", "salary"}
    assert {row["_id"] for row in seen[True]} == expected
    assert {row["_id"] for row in seen[False]} == (set() if change == "counterpart_deleted" else {"debit"})
