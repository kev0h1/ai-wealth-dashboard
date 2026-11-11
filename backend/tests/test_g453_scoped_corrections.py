"""G453 counts, protected writes and retry receipts against disposable Mongo."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from bson import ObjectId
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import MONGO_DB, MONGO_URI
from app.db.guard import guarded_drop_collection
from app.routers import categories as rule_routes, transactions as routes
from app.services import categorisation, derived_caches, scoped_corrections as corrections

UID = "g453-owner@example.test"
NOW = datetime(2026, 11, 10)
KEY = categorisation.canonical_merchant_key("Saving Challenge", "")


def payment(row_id, date=NOW, **fields):
    return {
        "_id": row_id, "user_id": UID, "account_id": "test-current",
        "date": date, "merchant_name": "Saving Challenge", "description": "Saving Challenge",
        "merchant_key": KEY, "transaction_type": "debit", "currency": "GBP",
        "category": "Other", "custom_category": None, **fields,
    }


def request(scope="one", count=1, resolution="mine-savings", **fields):
    return {"operation_id": str(uuid4()), "scope": scope, "expected_count": count, "resolution": resolution, **fields}


@asynccontextmanager
async def correction_store(monkeypatch, rows):
    assert MONGO_DB.startswith("wealth_test_")
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    prefix = f"g453_{uuid4().hex}"
    names = ("transactions", "scoped_correction_operations", "user_rules", "manual_accounts", "commitments")
    collections = {name: client[MONGO_DB][f"{prefix}_{name}"] for name in names}
    try:
        for name, collection in collections.items():
            monkeypatch.setattr(corrections, f"{name}_col", collection)
        monkeypatch.setattr(rule_routes, "user_rules_col", collections["user_rules"])
        monkeypatch.setattr(routes, "scoped_correction_operations_col", collections["scoped_correction_operations"])
        if rows:
            await collections["transactions"].insert_many(rows)
        yield collections
    finally:
        for collection in collections.values():
            await guarded_drop_collection(client, MONGO_DB, collection.name)
        client.close()


@pytest.mark.parametrize(("scope", "expected"), [
    ("one", {"anchor"}),
    ("history", {"anchor", "old", "legacy"}),
    ("history-future", {"anchor", "old", "legacy", "later"}),
])
def test_exact_scopes_protect_booked_custom_categories(monkeypatch, scope, expected):
    async def scenario():
        earlier = NOW - timedelta(days=1)
        rows = [
            payment("anchor"), payment("old", earlier),
            payment("legacy", earlier, merchant_key=None),
            payment("later", NOW + timedelta(days=1)),
            payment("manual", earlier, custom_category="Shopping"),
            payment("empty-manual", earlier, custom_category=""),
            payment("pending", earlier, status="pending"),
            payment("planned", earlier, planned=True),
            payment("usd", earlier, currency="USD"),
            payment("incoming", earlier, transaction_type="credit"),
            payment("unrelated", earlier, merchant_key="another"),
            payment("different-owner", earlier, user_id="other@example.test"),
        ]
        async with correction_store(monkeypatch, rows) as store:
            summary = await corrections.scope_summary(UID, "anchor")
            assert summary == {
                "one_count": 1, "earlier_count": 2, "history_count": 3, "all_count": 4,
                "protected_count": 2, "can_save_rule": True, "selected_protected": False,
            }
            saved = await corrections.apply_scoped_correction(UID, "anchor", request(scope, len(expected)))
            assert set(saved["affected_ids"]) == expected
            assert saved["updated_count"] == len(expected)
            changed = await store["transactions"].find({"correction_scope": scope}).to_list(None)
            assert {row["_id"] for row in changed} == expected
            assert all(row["custom_category"] == "Savings" for row in changed)
            assert bool(saved["rule_id"]) == (scope == "history-future")
            for row_id, category in [("manual", "Shopping"), ("empty-manual", "")]:
                assert (await store["transactions"].find_one({"_id": row_id}))["custom_category"] == category
    asyncio.run(scenario())


def test_protected_anchor_and_booked_one_off_without_payee_identity(monkeypatch):
    async def scenario():
        anonymous = ObjectId()
        rows = [
            payment("anchor", custom_category="Travel"), payment("old", NOW - timedelta(days=1)),
            payment(anonymous, merchant_name=None, description="X", merchant_key=None),
        ]
        async with correction_store(monkeypatch, rows):
            summary = await corrections.scope_summary(UID, "anchor")
            assert summary["one_count"] == 0 and summary["selected_protected"]
            result = await corrections.apply_scoped_correction(UID, "anchor", request("history"))
            assert result["affected_ids"] == ["old"]
            summary = await corrections.scope_summary(UID, str(anonymous))
            assert summary["one_count"] == 1 and not summary["can_save_rule"]
            result = await corrections.apply_scoped_correction(UID, str(anonymous), request())
            assert result["affected_ids"] == [str(anonymous)]
    asyncio.run(scenario())


def test_stale_count_has_no_destination_or_payment_side_effects(monkeypatch):
    async def scenario():
        async with correction_store(monkeypatch, [payment("anchor")]) as store:
            with pytest.raises(HTTPException) as error:
                await corrections.apply_scoped_correction(UID, "anchor", request("history", 2, "mine-offline"))
            assert error.value.status_code == 409
            assert await store["manual_accounts"].count_documents({}) == 0
            assert await store["scoped_correction_operations"].count_documents({}) == 0
            assert (await store["transactions"].find_one({"_id": "anchor"}))["custom_category"] is None
    asyncio.run(scenario())


def test_lost_write_responses_keep_apply_and_undo_counts(monkeypatch):
    class LoseResponseOnce:
        def __init__(self, collection):
            self.collection = collection
            self.fail = True

        def __getattr__(self, name):
            return getattr(self.collection, name)

        async def bulk_write(self, *args, **kwargs):
            result = await self.collection.bulk_write(*args, **kwargs)
            if self.fail:
                self.fail = False
                raise ConnectionError("test lost acknowledgement")
            return result

    async def scenario():
        rows = [payment("anchor", category="Bills"), payment("old", NOW - timedelta(days=1), category="Travel")]
        async with correction_store(monkeypatch, rows) as store:
            lossy = LoseResponseOnce(store["transactions"])
            monkeypatch.setattr(corrections, "transactions_col", lossy)
            draft = request("history-future", 2, "mine-card")
            with pytest.raises(ConnectionError):
                await corrections.apply_scoped_correction(UID, "anchor", draft)
            saved = await corrections.apply_scoped_correction(UID, "anchor", draft)
            assert saved["updated_count"] == 2 and saved["rule_id"]
            assert await store["user_rules"].count_documents({}) == 1
            lossy.fail = True
            with pytest.raises(ConnectionError):
                await corrections.undo_scoped_correction(UID, "anchor", draft["operation_id"])
            undone = await corrections.undo_scoped_correction(UID, "anchor", draft["operation_id"])
            assert undone["restored_categories"] == {"anchor": "Bills", "old": "Travel"}
            assert undone["updated_count"] == 2
            assert (await rule_routes.get_rules({"email": UID}))["rules"] == []
    asyncio.run(scenario())


def test_undo_preserves_later_manual_edit_and_removed_rule(monkeypatch):
    async def scenario():
        rows = [payment("anchor", category="Bills"), payment("old", NOW - timedelta(days=1), category="Travel")]
        async with correction_store(monkeypatch, rows) as store:
            draft = request("history-future", 2)
            saved = await corrections.apply_scoped_correction(UID, "anchor", draft)
            await rule_routes.delete_rule(saved["rule_id"], {"email": UID})
            await store["transactions"].update_one(
                {"_id": "old"}, {"$set": {"custom_category": "Shopping", "custom_category_at": NOW}},
            )
            undone = await corrections.undo_scoped_correction(UID, "anchor", draft["operation_id"])
            assert undone["restored_categories"] == {"anchor": "Bills"}
            assert (await store["transactions"].find_one({"_id": "old"}))["custom_category"] == "Shopping"
            assert (await rule_routes.get_rules({"email": UID}))["rules"] == []
    asyncio.run(scenario())


def test_retry_does_not_resurrect_a_removed_rule(monkeypatch):
    class InterruptedReceipt:
        def __init__(self, collection):
            self.collection = collection
            self.interrupt = True

        def __getattr__(self, name):
            return getattr(self.collection, name)

        async def update_one(self, selector, update, **kwargs):
            if self.interrupt and update.get("$set", {}).get("status") == "applied":
                self.interrupt = False
                raise ConnectionError("test interrupted receipt")
            return await self.collection.update_one(selector, update, **kwargs)

    async def scenario():
        async with correction_store(monkeypatch, [payment("anchor")]) as store:
            interrupted = InterruptedReceipt(store["scoped_correction_operations"])
            monkeypatch.setattr(corrections, "scoped_correction_operations_col", interrupted)
            draft = request("history-future")
            with pytest.raises(ConnectionError):
                await corrections.apply_scoped_correction(UID, "anchor", draft)
            rule = await store["user_rules"].find_one({"uid": UID})
            await rule_routes.delete_rule(rule["_id"], {"email": UID})
            saved = await corrections.apply_scoped_correction(UID, "anchor", draft)
            assert saved["updated_count"] == 1 and saved["rule_conflict"]
            assert saved["rule_id"] is None
            assert (await rule_routes.get_rules({"email": UID}))["rules"] == []
    asyncio.run(scenario())


@pytest.mark.parametrize("failure_point", ["marker", "compute"])
def test_saved_refresh_failure_keeps_same_receipt(monkeypatch, failure_point):
    async def scenario():
        async with correction_store(monkeypatch, [payment("anchor")]) as store:
            calls = []
            async def mark(_uid):
                calls.append("marked")
            async def defer(_uid):
                calls.append("defer")
                if failure_point == "marker" and calls.count("defer") == 1:
                    raise ConnectionError("test marker failure")
            async def refresh(_uid):
                calls.append("refresh")
                return {"failed": failure_point == "compute" and calls.count("refresh") == 1}

            monkeypatch.setattr(routes._transfer_review_store, "mark_stale", mark)
            monkeypatch.setattr(derived_caches, "defer_transfer_review_recompute", defer)
            monkeypatch.setattr(derived_caches, "finish_transfer_review_recompute", refresh)
            body = routes.CorrectionRequest(**request())
            saved = await routes.apply_correction_scope("anchor", body, {"email": UID})
            assert saved["updated_count"] == 1 and saved["refresh_pending"]
            refreshed = await routes.refresh_correction_scope(
                "anchor", routes.CorrectionUndoRequest(operation_id=body.operation_id), {"email": UID},
            )
            assert not refreshed["refresh_pending"]
            replay = await routes.apply_correction_scope("anchor", body, {"email": UID})
            assert replay["affected_ids"] == saved["affected_ids"]
            assert await store["scoped_correction_operations"].count_documents({}) == 1
            assert calls.count("defer") == 2
            assert calls.count("refresh") == (2 if failure_point == "compute" else 1)
    asyncio.run(scenario())
