"""G446 exact historical-credit drill-in contracts."""
import asyncio
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

import app.routers.transactions as routes
from app.core.config import MONGO_DB, MONGO_URI


@pytest.fixture
def mongo(monkeypatch):
    assert MONGO_DB.startswith("wealth_test_")
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    db = client[MONGO_DB]
    for name, col in (("transactions_col", db["transactions"]),
                      ("yapily_transactions_col", db["yapily_transactions"]),
                      ("statement_transactions_col", db["statement_transactions"])):
        monkeypatch.setattr(routes, name, col)
    yield db
    client.close()


def _uid():
    return f"g446-{uuid4().hex}@example.test"


def _credit(uid, when, raw_id, *, category="Income"):
    return {
        "_id": raw_id, "user_id": uid, "account_id": f"account-{uuid4().hex}",
        "date": when, "activity_date": when, "amount": 100.0, "currency": "GBP",
        "description": "PAYMENT", "category": category, "custom_category": None,
        "transaction_type": "credit", "provider": "test",
    }


async def _search(uid, **overrides):
    args = {
        "q": None, "page": 1, "page_size": 20, "category": None, "categories": None,
        "transaction_id": None, "merchants": None, "days": None, "date_from": None,
        "date_to": None, "txn_type": "credit", "activity_order": True,
        "pending_page": 1, "user": {"email": uid},
    }
    args.update(overrides)
    return await routes.search_transactions(**args)


def test_exact_source_history_scopes_all_collections_and_keeps_amended_rows(mongo):
    async def scenario():
        uid, other = _uid(), _uid()
        now = datetime.utcnow()
        legacy_id, object_id, statement_id, stale_id = "legacy-credit", ObjectId(), "statement-credit", "stale-pending-credit"
        await routes.transactions_col.insert_one(_credit(uid, now - timedelta(days=1), legacy_id, category="Salary"))
        # This correction must not make the original historical source vanish.
        await routes.yapily_transactions_col.insert_one(_credit(uid, now, object_id, category="Other"))
        await routes.statement_transactions_col.insert_one(_credit(uid, now - timedelta(days=2), statement_id, category="Gift"))
        await routes.transactions_col.insert_one({**_credit(uid, now + timedelta(days=2), stale_id), "is_pending": True})
        await routes.transactions_col.insert_one(_credit(other, now + timedelta(days=1), "forged-credit"))
        result = await _search(uid, transaction_id=[legacy_id, str(object_id), statement_id, stale_id, "forged-credit"])
        assert result["total"] == 3
        assert {row.id for row in result["items"]} == {legacy_id, str(object_id), statement_id}
        assert result["pending_items"] == [] and result["pending_total"] == 0
    asyncio.run(scenario())


def test_exact_source_history_paginates_with_global_totals(mongo):
    async def scenario():
        uid, now = _uid(), datetime.utcnow()
        ids = [f"credit-{n}" for n in range(3)]
        for index, collection in enumerate((routes.transactions_col, routes.yapily_transactions_col, routes.statement_transactions_col)):
            await collection.insert_one(_credit(uid, now - timedelta(days=index), ids[index]))
        first = await _search(uid, transaction_id=ids, page_size=2)
        second = await _search(uid, transaction_id=ids, page=2, page_size=2)
        assert first["total"] == 3 and first["pages"] == 2
        assert len(first["items"]) == 2 and len(second["items"]) == 1
        assert "pending_items" not in second
    asyncio.run(scenario())


@pytest.mark.parametrize("transaction_ids", [[], [""], ["   "], ["bad\x00id"], ["x" * 201], ["ok"] * 101, "not-a-list"])
def test_exact_source_history_rejects_invalid_ids_without_widening(transaction_ids):
    with pytest.raises(HTTPException) as error:
        routes._source_transaction_id_values(transaction_ids)
    assert error.value.status_code == 422
