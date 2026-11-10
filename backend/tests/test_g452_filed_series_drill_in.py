"""G452 persisted receipt bounds and provider-qualified drill-ins."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta
from urllib.parse import quote
from uuid import uuid4

import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import MONGO_DB, MONGO_URI
from app.db.guard import guarded_drop_collection
from app.routers import transactions as routes
from app.services import filed_transfers as history, own_account_transfers as oat
from app.services.categories import BUILTIN_CATEGORY_KINDS

UID = "g452-owner@example.com"
OTHER_UID = "g452-other@example.com"
ACCOUNTS = [
    {"_id": "g452-from", "user_id": UID, "name": "Everyday", "currency": "GBP"},
    {"_id": "g452-to", "user_id": UID, "name": "Savings", "currency": "GBP"},
]


def run(coro):
    return asyncio.run(coro)


@asynccontextmanager
async def receipt_environment(monkeypatch):
    """Use unique collections in pytest's disposable database only."""
    assert MONGO_DB.startswith("wealth_test_"), "G452 tests require the disposable database"
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    prefix = f"g452_{uuid4().hex}_"
    names = ("accounts", "transactions", "yapily", "statements", "judgements", "rules", "store")
    cols = {name: client[MONGO_DB][prefix + name] for name in names}
    try:
        for collection in cols.values():
            await collection.delete_many({})
        await cols["accounts"].insert_many(deepcopy(ACCOUNTS))
        monkeypatch.setattr(history, "accounts_col", cols["accounts"])
        monkeypatch.setattr(history, "transactions_col", cols["transactions"])
        monkeypatch.setattr(history, "yapily_transactions_col", cols["yapily"])
        monkeypatch.setattr(history, "own_transfer_judgements_col", cols["judgements"])
        monkeypatch.setattr(history, "confirmed_transfer_pairs_col", cols["rules"])
        monkeypatch.setattr(history, "filed_transfer_store_col", cols["store"])
        monkeypatch.setattr(routes, "transactions_col", cols["transactions"])
        monkeypatch.setattr(routes, "yapily_transactions_col", cols["yapily"])
        monkeypatch.setattr(routes, "statement_transactions_col", cols["statements"])
        yield cols
    finally:
        for collection in cols.values():
            await guarded_drop_collection(client, MONGO_DB, collection.name)
        client.close()


def transfer_pair(index, *, when=None):
    when = when or datetime(2026, 11, 9) - timedelta(days=index)
    common = {"user_id": UID, "amount": 11.88, "currency": "GBP", "date": when,
              "is_pending": False, "merchant_name": None, "custom_category": None}
    debit = {**common, "_id": f"d{index}", "account_id": "g452-from", "transaction_type": "debit",
             "description": "Savings transfer out", "category": "Transfer"}
    credit = {**common, "_id": f"c{index}", "account_id": "g452-to", "transaction_type": "credit",
              "description": "Savings transfer in", "category": "Transfer"}
    debit["own_transfer_match"] = oat.build_match_metadata(debit, credit, "Transfer", source="user")
    credit["own_transfer_match"] = oat.build_match_metadata(credit, debit, "Transfer", source="user")
    return debit, credit


def _period_rows(rows, start, end):
    return [{"id": str(row["_id"]), "account_id": row["account_id"], "date": row["date"].date(),
             "category": row["category"], "amount": row["amount"],
             "debit": row["transaction_type"] == "debit"}
            for row in rows if start <= row["date"].date() <= end]


def test_builder_keeps_full_evidence_but_public_receipt_is_ten_recent(monkeypatch):
    async def scenario():
        rows = [row for index in range(170) for row in transfer_pair(index)]
        rows.append({"_id": "single-yapily", "user_id": UID, "account_id": "g452-from",
                     "date": datetime(2026, 11, 8), "amount": 4.0, "currency": "GBP",
                     "transaction_type": "debit", "description": "Pot sweep", "category": "Transfer",
                     "is_pending": False})
        async with receipt_environment(monkeypatch) as cols:
            await cols["transactions"].insert_many(deepcopy(rows[:-1]))
            await cols["yapily"].insert_one(deepcopy(rows[-1]))
            async def categories(_uid): return dict(BUILTIN_CATEGORY_KINDS)
            async def period(_uid, start, end): return _period_rows(rows, start, end)
            monkeypatch.setattr(history, "get_category_kinds", categories)
            monkeypatch.setattr(history, "_load_period_txns", period)

            all_time = await history._build_filed_transfers(UID, page_size=1000)
            own = next(item for item in all_time["items"] if item["kind"] == "own_transfer")
            other = next(item for item in all_time["items"] if item["kind"] == "other")
            assert own["count"] == own["all_time_count"] == 170
            assert len(own["_series_membership"]) == 340
            assert own["transactions_href"] == "/transactions?filed_series=" + quote(own["series_key"], safe="")
            assert other["all_time_count"] == 1
            assert other["_series_membership"] == [{"source": "yapily", "id": "single-yapily"}]

            scoped = await history._build_filed_transfers(UID, start=date(2026, 11, 9), end=date(2026, 11, 9), page_size=1000)
            scoped_own = next(item for item in scoped["items"] if item["kind"] == "own_transfer")
            assert scoped_own["count"] == 1 and scoped_own["all_time_count"] == 170
            assert len(scoped_own["_series_membership"]) == 340

            await cols["store"].insert_one({"_id": history._store_id(UID, None, None), "user_id": UID,
                "shape": history._STORE_SHAPE, "stale": False, "state": all_time})
            monkeypatch.setattr(history, "_build_filed_transfers", lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError("GET rebuilt")))
            public = await history.list_filed_transfers(UID, page_size=1000)
            public_own = next(item for item in public["items"] if item["kind"] == "own_transfer")
            assert len(public_own["occurrences"]) == 10
            assert public_own["all_time_count"] == 170
            assert "_series_membership" not in public_own

            # Deployment may first warm only the currently selected period.
            # Its one visible occurrence still carries all 340 exact legs,
            # allowing the hub link to span the complete all-date series.
            scope_start = scope_end = date(2026, 11, 9)
            await cols["store"].delete_many({})
            await cols["store"].insert_one({
                "_id": history._store_id(UID, scope_start, scope_end), "user_id": UID,
                "shape": history._STORE_SHAPE, "stale": False, "built_at": datetime(2026, 11, 10),
                "state": scoped,
            })
            membership = await history.filed_series_membership(UID, scoped_own["series_key"])
            assert len(membership["transactions"]) == 340
            monkeypatch.setattr(routes, "_doc_to_tx", lambda document: document)
            drilled = await routes.search_transactions(filed_series=scoped_own["series_key"], page_size=100,
                                                       user={"email": UID})
            oldest_page = await routes.search_transactions(filed_series=scoped_own["series_key"], page=4, page_size=100,
                                                           user={"email": UID})
            assert drilled["total"] == 340 and len(drilled["items"]) == 100
            assert oldest_page["items"] and min(item["date"] for item in oldest_page["items"]) < datetime(2026, 6, 1)
    run(scenario())


def _receipt(uid, key="sorted:exact", *, shape=None, stale=False, complete=True, history_complete=True, membership=None):
    return {"_id": history._store_id(uid, None, None), "user_id": uid,
            "shape": history._STORE_SHAPE if shape is None else shape, "stale": stale,
            "state": {"complete": complete, "items": [{"series_key": key,
                "history_complete": history_complete,
                "_series_membership": membership if membership is not None else [{"source": "transactions", "id": "one"}]}]}}


def test_series_membership_fails_closed_for_bad_or_unavailable_receipts(monkeypatch):
    async def scenario():
        async with receipt_environment(monkeypatch) as cols:
            for hostile in ("", " ", "x" * 501, "sorted\x00bad", "sorted\nkey"):
                with pytest.raises(ValueError): await history.filed_series_membership(UID, hostile)
            with pytest.raises(LookupError): await history.filed_series_membership(UID, "sorted:unknown")
            cases = ({"shape": history._STORE_SHAPE - 1}, {"membership": []},
                     {"membership": [{"source": "statement", "id": "one"}]},
                     {"membership": [{"source": "transactions", "id": "bad\x00id"}]})
            for kwargs in cases:
                await cols["store"].delete_many({})
                await cols["store"].insert_one(_receipt(UID, **kwargs))
                with pytest.raises(LookupError): await history.filed_series_membership(UID, "sorted:exact")
            await cols["store"].delete_many({})
            await cols["store"].insert_one(_receipt(OTHER_UID))
            with pytest.raises(LookupError): await history.filed_series_membership(UID, "sorted:exact")
    run(scenario())


def test_stale_or_incomplete_receipts_remain_exact_read_only_history(monkeypatch):
    async def scenario():
        async with receipt_environment(monkeypatch) as cols:
            await cols["transactions"].insert_many([
                {"_id": "known", "user_id": UID, "account_id": "g452-from", "date": datetime(2026, 11, 9),
                 "amount": 12.0, "currency": "GBP", "transaction_type": "debit", "description": "Known", "category": "Transfer", "is_pending": False},
                {"_id": "unrelated", "user_id": UID, "account_id": "g452-from", "date": datetime(2026, 11, 8),
                 "amount": 12.0, "currency": "GBP", "transaction_type": "debit", "description": "Unrelated", "category": "Transfer", "is_pending": False},
            ])
            monkeypatch.setattr(routes, "_doc_to_tx", lambda document: document)
            for receipt_kwargs in ({"stale": True}, {"complete": False, "history_complete": False}):
                await cols["store"].delete_many({})
                await cols["store"].insert_one(_receipt(UID, membership=[{"source": "transactions", "id": "known"}], **receipt_kwargs))
                assert await history.filed_series_membership(UID, "sorted:exact") == {"transactions": ["known"], "yapily": []}
                result = await routes.search_transactions(filed_series="sorted:exact", user={"email": UID})
                assert result["total"] == 1 and [item["_id"] for item in result["items"]] == ["known"]
    run(scenario())


def test_filed_series_search_is_exact_provider_scoped_and_paginated(monkeypatch):
    async def scenario():
        object_id = ObjectId()
        async with receipt_environment(monkeypatch) as cols:
            members = [{"source": "transactions", "id": str(object_id)},
                       {"source": "transactions", "id": "credit-string"},
                       {"source": "transactions", "id": "pending-member"},
                       {"source": "transactions", "id": "foreign-credit"},
                       {"source": "yapily", "id": "same-id"}]
            await cols["store"].insert_one(_receipt(UID, membership=members))
            def row(_id, source, when, *, uid=UID, pending=False, description="Exact transfer"):
                return {"_id": _id, "user_id": uid, "account_id": f"{source}-account", "date": when,
                        "amount": 12.0, "currency": "GBP", "transaction_type": "debit",
                        "description": description, "category": "Transfer", "is_pending": pending}
            await cols["transactions"].insert_many([
                row(object_id, "transactions", datetime(2026, 1, 1)),
                row("credit-string", "transactions", datetime(2026, 11, 9)),
                row("pending-member", "transactions", datetime(2026, 11, 10), pending=True),
                row("foreign-credit", "transactions", datetime(2026, 11, 11), uid=OTHER_UID),
                row("unrelated", "transactions", datetime(2026, 11, 12)),
            ])
            await cols["yapily"].insert_many([row("same-id", "yapily", datetime(2026, 6, 1)), row("unrelated-yapily", "yapily", datetime(2026, 11, 13))])
            await cols["statements"].insert_one(row("same-id", "statement", datetime(2026, 11, 14)))
            monkeypatch.setattr(routes, "_doc_to_tx", lambda document: document)
            monkeypatch.setattr(history, "_build_filed_transfers", lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError("GET rebuilt")))

            result = await routes.search_transactions(filed_series="sorted:exact", q="Exact", page_size=10, activity_order=True, user={"email": UID})
            assert result["total"] == 3 and result["pending_total"] == 0
            assert {str(item["_id"]) for item in result["items"]} == {str(object_id), "credit-string", "same-id"}
            assert all(item["user_id"] == UID and not item["is_pending"] for item in result["items"])
            page_one = await routes.search_transactions(filed_series="sorted:exact", q="Exact", page=1, page_size=1, activity_order=True, user={"email": UID})
            page_two = await routes.search_transactions(filed_series="sorted:exact", q="Exact", page=2, page_size=1, activity_order=True, user={"email": UID})
            assert page_one["total"] == page_two["total"] == 3
            assert len(page_one["items"]) == len(page_two["items"]) == 1
            assert str(page_one["items"][0]["_id"]) != str(page_two["items"][0]["_id"])
            for key in ("sorted:missing", "sorted\x00bad"):
                with pytest.raises(routes.HTTPException) as raised:
                    await routes.search_transactions(filed_series=key, user={"email": UID})
                assert raised.value.status_code in {404, 422}
    run(scenario())
