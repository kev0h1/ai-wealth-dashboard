"""G387: transfer-review choices save immediately but flush one forecast rebuild."""
import asyncio
import pytest
from datetime import datetime

import app.routers.analytics as analytics
import app.services.derived_caches as derived


UID = "g387@example.com"


def _matches(doc, filt):
    for key, wanted in (filt or {}).items():
        if isinstance(wanted, dict) and "$lte" in wanted:
            if doc.get(key) is None or doc[key] > wanted["$lte"]:
                return False
        elif doc.get(key) != wanted:
            return False
    return True


class Cache:
    def __init__(self):
        self.docs = {}

    async def find_one(self, filt, projection=None):
        for doc in self.docs.values():
            if _matches(doc, filt):
                return dict(doc)
        return None

    async def update_one(self, filt, update, upsert=False):
        for doc in self.docs.values():
            if _matches(doc, filt):
                doc.update(update.get("$set", {}))
                for key in update.get("$unset", {}):
                    doc.pop(key, None)
                return
        if upsert:
            doc = {"_id": filt["_id"], **update.get("$set", {})}
            self.docs[doc["_id"]] = doc


def test_deferred_review_flushes_once_and_repeated_close_is_a_noop(monkeypatch):
    cache = Cache()
    calls = []

    async def invalidate(_uid):
        return None

    async def compute(uid, clear_ai_cache=False):
        calls.append((uid, clear_ai_cache))
        cache.docs[uid].pop("dirty_since", None)
        cache.docs[uid]["computed_from"] = datetime.now()
        return True

    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)

    asyncio.run(derived.defer_transfer_review_recompute(UID))
    asyncio.run(derived.defer_transfer_review_recompute(UID))
    assert cache.docs[UID]["dirty_since"]
    assert cache.docs[UID]["transfer_review_pending_since"]

    assert asyncio.run(derived.finish_transfer_review_recompute(UID)) == {"recomputed": True, "pending": False}
    assert calls == [(UID, False)]
    assert "transfer_review_pending_since" not in cache.docs[UID]
    assert asyncio.run(derived.finish_transfer_review_recompute(UID)) == {"recomputed": False, "pending": False}
    assert len(calls) == 1


def test_failed_flush_keeps_marker_for_retry(monkeypatch):
    cache = Cache()

    async def invalidate(_uid):
        return None

    async def compute(_uid, clear_ai_cache=False):
        # Mirrors compute_and_cache_cashflow swallowing a failure: dirty stays.
        return None

    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)
    asyncio.run(derived.defer_transfer_review_recompute(UID))

    result = asyncio.run(derived.finish_transfer_review_recompute(UID))
    assert result == {"recomputed": False, "pending": True, "failed": True}
    assert cache.docs[UID]["transfer_review_pending_since"]
    assert cache.docs[UID]["dirty_since"]


def test_newer_token_saved_during_flush_stays_pending_and_stale(monkeypatch):
    cache = Cache()

    async def invalidate(_uid):
        return None

    async def compute(uid, clear_ai_cache=False):
        # Simulate compute's normal write followed by a same-millisecond new
        # review decision: token, not a timestamp comparison, must win.
        cache.docs[uid].pop("dirty_since", None)
        cache.docs[uid]["computed_from"] = datetime.now()
        cache.docs[uid]["transfer_review_pending_token"] = "newer"
        return True

    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)
    asyncio.run(derived.defer_transfer_review_recompute(UID))

    assert asyncio.run(derived.finish_transfer_review_recompute(UID)) == {"recomputed": True, "pending": True}
    assert cache.docs[UID]["transfer_review_pending_token"] == "newer"
    assert cache.docs[UID]["dirty_since"]


def test_concurrent_close_coalesces_per_user_but_not_between_users(monkeypatch):
    cache = Cache()
    calls = []

    async def invalidate(_uid):
        return None

    async def compute(uid, clear_ai_cache=False):
        calls.append(uid)
        await asyncio.sleep(0)
        cache.docs[uid].pop("dirty_since", None)
        cache.docs[uid]["computed_from"] = datetime.now()
        return True

    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)

    async def run():
        await derived.defer_transfer_review_recompute(UID)
        await derived.defer_transfer_review_recompute("other@example.com")
        return await asyncio.gather(
            derived.finish_transfer_review_recompute(UID),
            derived.finish_transfer_review_recompute(UID),
            derived.finish_transfer_review_recompute("other@example.com"),
        )

    results = asyncio.run(run())
    assert calls.count(UID) == 1
    assert calls.count("other@example.com") == 1
    assert results.count({"recomputed": True, "pending": False}) == 2
    assert results.count({"recomputed": False, "pending": False}) == 1


def test_ten_pair_confirmations_save_now_and_recompute_once_on_finish(monkeypatch):
    """Exercise the real mutation and finish routes, not only the batching helper."""
    from app.routers import transactions
    from test_transfer_pairs import FakeCol, _fake_get_category_kinds, _t

    cache = Cache()
    rows = []
    for index in range(10):
        for side, category, account in (("credit", "Income", "destination"), ("debit", "Other", "source")):
            row = _t(f"{side}{index}", ttype=side, amount=25.0, date=datetime(2026, 10, 1),
                     account_id=account, desc="XFER", category=category)
            row["user_id"] = UID
            rows.append(row)
    accounts = [{"_id": name, "user_id": UID, "currency": "GBP", "type": "current"}
                for name in ("source", "destination")]
    calls = []

    async def invalidate(_uid):
        pass

    async def compute(uid, clear_ai_cache=False):
        calls.append(uid)
        assert all(row["category"] == "Transfer" for row in rows)
        cache.docs[uid].pop("dirty_since", None)
        cache.docs[uid]["computed_from"] = datetime.now()
        return True

    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", invalidate)
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(rows))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol(accounts))
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)

    async def run():
        for index in range(10):
            response = await analytics.confirm_transfer_pair({
                "credit_id": f"credit{index}", "debit_id": f"debit{index}", "defer_recompute": True,
            }, {"email": UID})
            assert response["ok"]
            assert rows[index * 2]["category"] == "Transfer"
            assert rows[index * 2 + 1]["category"] == "Transfer"
            await asyncio.sleep(0)  # An erroneously scheduled eager task would run here.
            assert not calls
        # Another user's close cannot consume this user's pending decision.
        assert not (await transactions.finish_transfer_review({"email": "other@example.com"}))["recomputed"]
        assert (await transactions.finish_transfer_review({"email": UID}))["recomputed"]
        assert not (await transactions.finish_transfer_review({"email": UID}))["recomputed"]

    asyncio.run(run())
    assert calls == [UID]


def test_ordinary_category_corrections_still_recompute_eagerly(monkeypatch):
    from app.routers import transactions
    calls = []

    async def mark(uid, **_kwargs):
        calls.append(("stale", uid))

    async def compute(uid, **_kwargs):
        calls.append(("compute", uid))

    monkeypatch.setattr(derived, "mark_stale", mark)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)

    async def run():
        await transactions._after_category_correction(UID, defer_recompute=False)
        await asyncio.sleep(0)

    asyncio.run(run())
    assert calls == [("stale", UID), ("compute", UID)]


@pytest.mark.parametrize("route", ["patch", "movement"])
def test_single_review_choices_save_without_eager_recompute(monkeypatch, route):
    from app.routers import transactions
    from test_recurring_correction import _TxnCol
    cache = Cache()
    calls = []

    class Col(_TxnCol):
        async def find_one(self, *_args, **_kwargs):
            if route == "movement":
                return {"_id": "single", "transaction_type": "debit"}
            return None

        async def insert_one(self, *_args, **_kwargs):
            pass

    async def noop(*_args, **_kwargs):
        pass

    async def compute(*_args, **_kwargs):
        calls.append("compute")
        return True

    col = Col()
    monkeypatch.setattr(transactions, "transactions_col", col)
    monkeypatch.setattr(transactions, "teaching_events_col", col)
    monkeypatch.setattr(transactions, "_log_teaching_event", noop)
    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", noop)
    monkeypatch.setattr(derived.response_cache, "invalidate", lambda *_args: None)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", compute)

    async def run():
        if route == "patch":
            await transactions.update_transaction("single", {"category": "Income", "defer_recompute": True}, {"email": UID})
        else:
            await transactions.resolve_movement("single", {"resolution": "mine-here", "defer_recompute": True}, {"email": UID})
        await asyncio.sleep(0)

    asyncio.run(run())
    assert col.sets[0]["$set"]["custom_category"] == ("Income" if route == "patch" else "Transfer")
    assert cache.docs[UID]["transfer_review_pending_token"]
    assert cache.docs[UID]["dirty_since"]
    assert not calls


def test_failed_compute_cannot_reuse_an_old_same_tick_watermark(monkeypatch):
    from app.routers import transactions
    from fastapi import HTTPException
    cache = Cache()
    now = derived._ms_now()
    cache.docs[UID] = {"_id": UID, "computed_from": now}

    async def noop(*_args, **_kwargs):
        pass

    monkeypatch.setattr(derived, "_ms_now", lambda: now)
    monkeypatch.setattr(derived, "cashflow_cache_col", cache)
    monkeypatch.setattr(derived.response_cache, "ainvalidate", noop)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", noop)
    asyncio.run(derived.defer_transfer_review_recompute(UID))
    with pytest.raises(HTTPException) as error:
        asyncio.run(transactions.finish_transfer_review({"email": UID}))
    assert error.value.status_code == 503
    assert cache.docs[UID]["transfer_review_pending_token"]
    assert cache.docs[UID]["dirty_since"]


def test_marker_write_failure_is_not_reported_as_saved(monkeypatch):
    class BrokenCache(Cache):
        async def update_one(self, *_args, **_kwargs):
            raise RuntimeError("Storage unavailable")

    monkeypatch.setattr(derived, "cashflow_cache_col", BrokenCache())
    with pytest.raises(RuntimeError, match="Storage unavailable"):
        asyncio.run(derived.defer_transfer_review_recompute(UID))
