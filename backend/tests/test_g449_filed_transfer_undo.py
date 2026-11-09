"""G449 whole-series reversal on the suite's disposable database only."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

import app.routers.card_terms  # noqa: F401; pre-import before collection patches
import app.services.debt_plan  # noqa: F401
from app.core.config import MONGO_DB, MONGO_URI
from app.services import filed_transfer_undo as undo, own_account_transfers as oat
from app.services import derived_caches, response_cache, transfer_review_store
from app.services.categories import BUILTIN_CATEGORY_KINDS

UID = "g449-undo@example.com"
MOVEMENTS = {name for name, kind in BUILTIN_CATEGORY_KINDS.items() if kind == "movement"}
ACCOUNTS = [{"_id": "a", "user_id": UID, "name": "Everyday", "currency": "GBP"},
            {"_id": "b", "user_id": UID, "name": "Savings", "currency": "GBP"}]


def pair(n=0, *, actor="sorted", source=None):
    base = {"user_id": UID, "amount": 80.25, "currency": "GBP", "custom_category": None,
            "date": datetime(2026, 10 - n, 26), "is_pending": False, "merchant_name": None}
    credit = {**base, "_id": f"c{n}", "account_id": "b", "transaction_type": "credit", "description": "Received own transfer", "category": "Income"}
    debit = {**base, "_id": f"d{n}", "account_id": "a", "transaction_type": "debit", "description": "Sent own transfer", "category": "Other"}
    cm = oat.build_match_metadata(credit, debit, "Transfer", confirmed=actor == "user", source=source)
    dm = oat.build_match_metadata(debit, credit, "Transfer", confirmed=actor == "user", source=source)
    return [{**credit, "category": "Transfer", "own_transfer_match": cm}, {**debit, "category": "Transfer", "own_transfer_match": dm}]


@asynccontextmanager
async def environment(monkeypatch, rows):
    assert MONGO_DB.startswith("wealth_test_"), "Only the suite's disposable database is permitted"
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    names = ("accounts", "transactions", "preferences", "confirmed_transfer_pairs", "own_transfer_judgements", "user_profiles")
    cols = {name: client[MONGO_DB][f"g449_undo_{name}"] for name in names}
    calls = []
    try:
        for col in cols.values():
            await col.delete_many({})
        await cols["accounts"].insert_many(deepcopy(ACCOUNTS))
        await cols["transactions"].insert_many(deepcopy(rows))
        for name, col in cols.items():
            if hasattr(undo, f"{name}_col"):
                monkeypatch.setattr(undo, f"{name}_col", col)
        async def categories(_): return dict(BUILTIN_CATEGORY_KINDS)
        async def deferred(uid): calls.append(("defer", uid))
        async def stale(uid): calls.append(("stale", uid))
        async def invalidate(uid): calls.append(("invalidate", uid))
        monkeypatch.setattr(undo, "get_category_kinds", categories)
        monkeypatch.setattr(derived_caches, "defer_transfer_review_recompute", deferred)
        monkeypatch.setattr(transfer_review_store, "mark_stale", stale)
        monkeypatch.setattr(transfer_review_store, "refresh_soon", lambda uid: calls.append(("refresh", uid)))
        monkeypatch.setattr(response_cache, "ainvalidate", invalidate)
        yield cols, calls
    finally:
        for col in cols.values():
            await col.drop()
        client.close()


@pytest.mark.parametrize("actor,source", [("sorted", None), ("sorted", "ai"), ("user", None)])
def test_complete_series_restores_exact_prior_categories_and_queues_both_legs(monkeypatch, actor, source):
    async def run():
        rows = pair(0, actor=actor, source=source) + pair(1, actor=actor, source=source)
        signature = oat.series_signature(rows[0], rows[1])
        async with environment(monkeypatch, rows) as (cols, calls):
            # An existing human learned rule is not owned by this confirmation.
            await cols["confirmed_transfer_pairs"].insert_one({"_id": "human-rule", "user_id": UID, "key_a": "received own transfer", "key_b": "sent own transfer"})
            aa, ab = oat.ai_pair_keys(rows[0], rows[1])
            await cols["confirmed_transfer_pairs"].insert_one({"_id": "ai-rule", "user_id": UID, "key_a": aa, "key_b": ab, "source": "ai"})
            out = await undo.undo_filed_series(UID, f"{actor}:{signature}")
            assert out["undone"] == 2 and set(out["transaction_ids"]) == {"c0", "d0", "c1", "d1"}
            saved = await cols["transactions"].find({"user_id": UID}).to_list(None)
            assert all("own_transfer_match" not in row for row in saved)
            assert {row["category"] for row in saved if row["transaction_type"] == "credit"} == {"Income"}
            assert {row["category"] for row in saved if row["transaction_type"] == "debit"} == {"Other"}
            prefs = await cols["preferences"].find_one({"user_id": UID})
            assert len(prefs["separate_transfer_pair_reviews"]) == 2 and "dismissed_transfer_pairs" not in prefs
            queued = await oat.active_separate_review_ids(UID, saved, {a["_id"]: a for a in ACCOUNTS}, preference_collection=cols["preferences"], movement_categories=MOVEMENTS)
            assert queued == {"c0", "d0", "c1", "d1"}
            assert await cols["confirmed_transfer_pairs"].find_one({"_id": "human-rule"})
            assert await cols["confirmed_transfer_pairs"].find_one({"_id": "ai-rule"}) is None
            assert await cols["own_transfer_judgements"].count_documents({"kind": "undo", "series_sig": signature}) == 1
            assert calls.count(("defer", UID)) == 1
            # Retrying the old series cannot silently mutate anything again.
            with pytest.raises(ValueError):
                await undo.undo_filed_series(UID, f"{actor}:{signature}")
    asyncio.run(run())


def test_later_custom_choice_and_cross_user_ids_cannot_be_undone(monkeypatch):
    async def run():
        rows = pair()
        signature = oat.series_signature(*rows)
        rows[1]["custom_category"] = "Groceries"
        async with environment(monkeypatch, rows) as (cols, calls):
            with pytest.raises(ValueError): await undo.undo_filed_series(UID, f"sorted:{signature}")
            with pytest.raises(ValueError): await undo.undo_filed_series("other@example.com", f"sorted:{signature}")
            assert (await cols["transactions"].find_one({"_id": "d0"}))["custom_category"] == "Groceries"
            assert await cols["own_transfer_judgements"].count_documents({}) == 0 and calls == []
    asyncio.run(run())


@pytest.mark.parametrize("fail_at", [1, 2, 3])
def test_guarded_mid_series_failure_compensates_only_own_writes(monkeypatch, fail_at):
    async def run():
        rows = pair() + pair(1)
        signature = oat.series_signature(*rows[:2])
        async with environment(monkeypatch, rows) as (cols, calls):
            real = cols["transactions"]
            class ConcurrentChange:
                attempts = 0
                def find(self, *a, **kw): return real.find(*a, **kw)
                async def update_one(self, query, update, **kw):
                    if "$unset" in update:
                        self.attempts += 1
                        if self.attempts == fail_at:
                            await real.update_one({"_id": query["_id"]}, {"$set": {"custom_category": "Groceries"}})
                            return SimpleNamespace(matched_count=0)
                    return await real.update_one(query, update, **kw)
            monkeypatch.setattr(undo, "transactions_col", ConcurrentChange())
            with pytest.raises(ValueError, match="Reload history"):
                await undo.undo_filed_series(UID, f"sorted:{signature}")
            actual = await real.find({"user_id": UID}).to_list(None)
            assert all(row["category"] == "Transfer" and row.get("own_transfer_match") for row in actual)
            assert sum(row.get("custom_category") == "Groceries" for row in actual) == 1
            assert await cols["own_transfer_judgements"].count_documents({"kind": {"$in": ["undo", "pair"]}}) == 0
            prefs = await cols["preferences"].find_one({"user_id": UID})
            assert prefs["separate_transfer_pair_reviews"] == []
            assert (await cols["own_transfer_judgements"].find_one({"kind": "undo_attempt"}))["state"] == "rolled_back"
            assert calls.count(("defer", UID)) == 1 and ("invalidate", UID) in calls
    asyncio.run(run())


def test_missing_prior_evidence_and_pending_or_nonreciprocal_pair_is_read_only():
    credit, debit = pair()
    accounts = {a["_id"]: a for a in ACCOUNTS}
    assert undo.reversible_pair(credit, debit, accounts, MOVEMENTS)
    for change in ("prior", "pending", "counterpart"):
        c, d = deepcopy((credit, debit))
        if change == "prior": d["own_transfer_match"].pop("previous_category")
        elif change == "pending": c["is_pending"] = True
        else: d["own_transfer_match"]["counterpart_id"] = "someone-else"
        assert not undo.reversible_pair(c, d, accounts, MOVEMENTS)


def test_real_recorded_history_has_global_scope_count_reason_and_safe_undo(monkeypatch):
    from app.services import filed_transfers as history
    async def run():
        rows = pair() + pair(1)
        signature = oat.series_signature(*rows[:2])
        async with environment(monkeypatch, rows) as (cols, _):
            for name in ("transactions", "accounts", "own_transfer_judgements"):
                monkeypatch.setattr(history, f"{name}_col", cols[name])
            monkeypatch.setattr(history, "yapily_transactions_col", cols["user_profiles"])
            async def categories(_): return dict(BUILTIN_CATEGORY_KINDS)
            async def period(_uid, start, end):
                return [{"id": row["_id"], "date": row["date"].date(), "category": row["category"],
                         "amount": row["amount"], "debit": row["transaction_type"] == "debit"}
                        for row in rows if start <= row["date"].date() <= end]
            monkeypatch.setattr(history, "get_category_kinds", categories)
            monkeypatch.setattr(history, "_load_period_txns", period)
            await cols["own_transfer_judgements"].insert_one({"user_id": UID, "kind": "pair", "series_sig": signature, "reason": "Both entries name the same accounts."})
            out = await history.list_filed_transfers(UID, start=datetime(2026, 10, 26).date(), end=datetime(2026, 10, 26).date())
            assert out["total_series"] == 1 and out["scope_total"] == 80.25
            assert out["items"][0]["total_amount"] == 80.25 and out["items"][0]["count"] == 1
            assert out["items"][0]["undo_count"] == 2 and out["items"][0]["can_undo"]
            assert out["items"][0]["reason"] == "Both entries name the same accounts."
            # A stale older member must not leave a whole-series action on
            # the still-current visible period.
            await cols["transactions"].update_one({"_id": "d1"}, {"$set": {"description": "Bank amended this record"}})
            out = await history.list_filed_transfers(UID, start=datetime(2026, 10, 26).date(), end=datetime(2026, 10, 26).date())
            assert not out["complete"] and not out["items"][0]["can_undo"]
    asyncio.run(run())
