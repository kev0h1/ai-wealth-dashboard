"""Exercise the link CAS predicates on the suite's disposable Mongo database.

The route regressions use deterministic fakes; these checks additionally pin
Mongo's real array-equality and missing-versus-null matching behaviour. Each
test owns its client/loop and documents, never the UAT database or app client.
"""
import asyncio
from copy import deepcopy

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import MONGO_DB, MONGO_URI
from app.services.account_plan_sources import source_link_snapshot
import app.routers.commitments as commitments


@pytest.mark.parametrize("before,concurrent", [
    ({}, {"$set": {"source_account_id": None}}),
    ({"source_account_id": None}, {"$unset": {"source_account_id": ""}}),
    ({"source_account_id": "payer"}, {"$set": {"fill_account_id": "payer"}}),
    ({"funding_pots": [{"account_id": "pot"}]}, {"$set": {"funding_pots": [{"account_id": "payer"}]}}),
    ({"funding_account_id": "pot"}, {"$set": {"funding_account_id": "payer"}}),
    ({}, {"$set": {"user_id": "another-user"}}),
])
def test_source_link_snapshot_rejects_real_mongo_concurrent_changes(before, concurrent):
    async def check():
        assert MONGO_DB.startswith("wealth_test_"), "Only the suite's disposable database is permitted"
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        col = client[MONGO_DB]["g176_source_cas"]
        doc = {"_id": ObjectId(), "user_id": "g176-cas-fixture", "fill_account_id": "pot", **deepcopy(before)}
        try:
            await col.insert_one(doc)
            query = {"_id": doc["_id"], "user_id": doc["user_id"], **source_link_snapshot(
                doc, "source_account_id", "fill_account_id", "funding_pots", "funding_account_id",
            )}
            # The same snapshot matches before another request changes it.
            assert (await col.update_one(query, {"$set": {"probe": True}})).matched_count == 1
            await col.update_one({"_id": doc["_id"]}, concurrent)
            assert (await col.update_one(query, {"$set": {"source_account_id": "new-payer"}})).matched_count == 0
            assert (await col.find_one({"_id": doc["_id"]})).get("source_account_id") != "new-payer"
        finally:
            await col.delete_one({"_id": doc["_id"]})
            client.close()
    asyncio.run(check())


def test_legacy_list_migration_cannot_overwrite_a_concurrently_relinked_goal(monkeypatch):
    async def check():
        assert MONGO_DB.startswith("wealth_test_"), "Only the suite's disposable database is permitted"
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        col = client[MONGO_DB]["g176_source_cas"]
        doc = {"_id": ObjectId(), "user_id": "g176-cas-fixture", "funding_account_id": "old-pot", "baseline_balance": 0}
        monkeypatch.setattr(commitments, "commitments_col", col)
        try:
            await col.insert_one(doc)
            # A list request is still holding `doc` while PATCH changes the
            # destination and picks the former pot as its (now valid) payer.
            await col.update_one({"_id": doc["_id"]}, {"$set": {
                "funding_account_id": "new-pot", "source_account_id": "old-pot",
                "funding_pots": [{"account_id": "new-pot", "baseline": 0}],
            }})
            await commitments._migrate_legacy(doc)
            stored = await col.find_one({"_id": doc["_id"]})
            assert stored["funding_pots"][0]["account_id"] == "new-pot"
            assert stored["source_account_id"] == "old-pot"
        finally:
            await col.delete_one({"_id": doc["_id"]})
            client.close()
    asyncio.run(check())
