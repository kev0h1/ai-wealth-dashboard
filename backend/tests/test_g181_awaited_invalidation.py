"""G181 — five transaction-correction endpoints used to invalidate the
response cache with the synchronous, name-scoped `response_cache.invalidate`,
whose `data_version.bump_soon` schedules the version bump as a fire-and-forget
task on the running loop instead of awaiting it:

  - transactions.resolve_movement (category_changed branch)
  - analytics.confirm_transfer_pair
  - analytics.dismiss_miscategorised
  - analytics.dismiss_miscategorised_series
  - analytics.dismiss_transfer_pair

Only `update_transaction` already used the correct pattern, `await
response_cache.ainvalidate(uid)` — a full wipe of the memory layer plus an
AWAITED version bump (`await data_version.bump(uid)`), so by the time the
endpoint's coroutine returns, `data_version._memo[uid]` is GUARANTEED to
already hold the new version.

The bug: `response_cache.invalidate(uid, name)` only drops the NAMED cache(s)
from the memory layer synchronously, then calls `data_version.bump_soon(uid)`,
which does `loop.create_task(...)` and returns immediately WITHOUT yielding
control to the event loop. A plain `await some_coro()` with no genuine
suspension point (no real I/O, no `asyncio.sleep`) never gives that scheduled
task a chance to run — so a caller who awaits the endpoint and then
IMMEDIATELY (no sleep) reads `data_version.current(uid)` still gets the
1-second in-process memo's OLD value, which still matches the version stamped
on any OTHER cached entry for this user (e.g. the Home brief, cached under
"today") that was primed before the write. That entry is served as if it
were still fresh — exactly the staleness this ticket closes.

These tests exercise the REAL app.services.response_cache /
app.services.data_version modules (not a fake stand-in — unlike
test_transfer_pairs.py's FakeResponseCache, which always invalidates
synchronously and so cannot reproduce this race at all), with
`response_cache_col` / `user_data_version_col` swapped for tiny in-memory
fakes (same convention as test_response_cache_v2.py: no mongomock available
in this environment). Every test calls the real router function directly
(current_user's `user` dict is passed as a plain `{"email": uid}`, matching
test_transfer_pairs.py's own convention) and reads back with NO sleep and NO
manual event-loop tick — a real regression must show the stale read with the
event loop exactly as idle as it would be after the endpoint's HTTP response
went out.
"""
import asyncio
from datetime import datetime

import app.routers.analytics as analytics
import app.routers.transactions as transactions
import app.services.data_version as data_version
import app.services.response_cache as response_cache

UID = "kevin@example.com"
OTHER_UID = "other@example.com"
D0 = datetime(2026, 8, 10)


# ── Real response_cache / data_version plumbing, fake Mongo underneath ─────

class FakeVersionCol:
    def __init__(self):
        self.docs: dict = {}

    async def find_one_and_update(self, filt, update, upsert=False, return_document=None):
        _id = filt["_id"]
        doc = self.docs.get(_id)
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": _id, "version": 0}
        for k, v in (update.get("$inc") or {}).items():
            doc[k] = doc.get(k, 0) + v
        for k, v in (update.get("$set") or {}).items():
            doc[k] = v
        self.docs[_id] = doc
        return dict(doc)

    async def find_one(self, filt, max_time_ms=None):
        doc = self.docs.get(filt.get("_id"))
        return dict(doc) if doc else None


class FakeResponseCacheCol:
    def __init__(self):
        self.docs: dict = {}

    async def find_one(self, filt, max_time_ms=None):
        doc = self.docs.get((filt["user_id"], filt["name"]))
        return dict(doc) if doc else None

    async def replace_one(self, filt, doc, upsert=False):
        self.docs[(filt["user_id"], filt["name"])] = dict(doc)

    async def delete_many(self, filt):
        self.docs.clear()

    async def delete_one(self, filt):
        self.docs.pop((filt["user_id"], filt["name"]), None)


def _patch_cache_plumbing(monkeypatch, day="2026-09-05"):
    monkeypatch.setattr(data_version, "user_data_version_col", FakeVersionCol())
    monkeypatch.setattr(response_cache, "response_cache_col", FakeResponseCacheCol())
    monkeypatch.setattr(response_cache, "local_day", lambda: day)
    # Every test in this file gets a clean process-local memory layer and
    # memo — the real modules are bare globals, so state would otherwise
    # leak between tests.
    response_cache._caches.clear()
    data_version._memo.clear()


async def _prime_home_brief(uid: str):
    """Stand-in for the cached Home brief (the real cache name is "today") —
    primed BEFORE the write under test, so a stale read after the write
    would still return this exact payload."""
    v = await response_cache.snapshot(uid)
    payload = {"pre_write": True, "uid": uid}
    await response_cache.aput("today", uid, payload, version=v)
    return payload


# ── Generic fake-Mongo collection (subset matcher), same shape as
# tests/test_transfer_pairs.py's own FakeCol ────────────────────────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$in" in cond and val not in cond["$in"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _Cursor:
    """Supports both `.to_list(n)` and `async for` — confirm_transfer_pair
    iterates accounts_col.find(...) with `async for`."""
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        docs = [d for d in self.docs if _match(d, query)]
        return _Cursor(docs)

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new = dict(filt)
            self._apply(new, update)
            self.docs.append(new)

    async def delete_many(self, filt):
        self.docs = [d for d in self.docs if not _match(d, filt)]

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$unset") or {}).items():
            d.pop(k, None)
        for k, v in (update.get("$setOnInsert") or {}).items():
            d.setdefault(k, v)
        for k, v in (update.get("$addToSet") or {}).items():
            d.setdefault(k, [])
            if v not in d[k]:
                d[k].append(v)


async def _fake_get_category_kinds(uid):
    from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


# ── resolve_movement (transactions.py) ──────────────────────────────────────

def test_resolve_movement_category_changed_invalidates_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)

    txn = {
        "_id": "t1", "user_id": UID, "transaction_type": "debit",
        "amount": 12.5, "date": D0, "merchant_name": "Some Shop",
        "description": "SOME SHOP PAYMENT", "category": "Shopping", "custom_category": None,
    }
    monkeypatch.setattr(transactions, "transactions_col", FakeCol([txn]))
    monkeypatch.setattr(transactions, "teaching_events_col", FakeCol([]))
    # The category_changed branch also fires a detached
    # compute_and_cache_cashflow(uid) background task (unrelated to this
    # ticket) — stub it out so the test isn't reaching for the real,
    # unmocked cashflow_cache_col.
    async def _noop_cashflow(uid, clear_ai_cache=True):
        return None
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", _noop_cashflow)

    async def go():
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        await transactions.resolve_movement(
            "t1", {"resolution": "mine-here"}, {"email": UID},
        )

        # No sleep, no manual event-loop tick — reads exactly as cold as the
        # loop is right after the endpoint's HTTP response went out.
        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before, (
            "resolve_movement's category_changed branch left the cached "
            "Home brief stale for an immediate refetch"
        )
        # Another user's cache is untouched by this write.
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

    asyncio.run(go())


# ── confirm_transfer_pair (analytics.py) ────────────────────────────────────

def test_confirm_transfer_pair_invalidates_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)

    credit_txn = {
        "_id": "c1", "user_id": UID, "transaction_type": "credit", "amount": 100.0,
        "date": D0, "account_id": "accCredit", "merchant_name": None,
        "description": "PAIRTOKEN CREDIT LEG", "category": "Income", "custom_category": None,
    }
    debit_txn = {
        "_id": "d1", "user_id": UID, "transaction_type": "debit", "amount": 100.0,
        "date": D0, "account_id": "accDebit", "merchant_name": None,
        "description": "PAIRTOKEN DEBIT LEG", "category": "Other", "custom_category": None,
    }
    monkeypatch.setattr(analytics, "transactions_col", FakeCol([credit_txn, debit_txn]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([]))
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)

    async def go():
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        result = await analytics.confirm_transfer_pair(
            {"credit_id": "c1", "debit_id": "d1"}, {"email": UID},
        )
        assert result["ok"] is True

        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before, (
            "confirm_transfer_pair left the cached Home brief stale for an "
            "immediate refetch"
        )
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

    asyncio.run(go())


# ── dismiss_miscategorised / dismiss_miscategorised_series (analytics.py) ──

def test_dismiss_miscategorised_invalidates_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)
    monkeypatch.setattr(
        analytics, "preferences_col",
        FakeCol([{"user_id": UID, "dismissed_miscategorised": []}]),
    )

    async def go():
        # Prime the exact caches this endpoint targets, plus the Home brief,
        # so a stale read is provable on any of them.
        v = await response_cache.snapshot(UID)
        await response_cache.aput("miscategorised_count", UID, {"count": 3}, version=v)
        await response_cache.aput("miscategorised_list", UID, {"items": ["old"]}, version=v)
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        result = await analytics.dismiss_miscategorised("t1", {"email": UID})
        assert result == {"ok": True}

        assert await response_cache.aget("miscategorised_count", UID) is None
        assert await response_cache.aget("miscategorised_list", UID) is None
        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

    asyncio.run(go())


def test_dismiss_miscategorised_series_invalidates_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)
    monkeypatch.setattr(
        analytics, "preferences_col",
        FakeCol([{"user_id": UID, "dismissed_miscategorised_series": []}]),
    )

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("miscategorised_count", UID, {"count": 3}, version=v)
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        result = await analytics.dismiss_miscategorised_series(
            {"series_key": "To Kevin Maingi"}, {"email": UID},
        )
        assert result == {"ok": True}

        assert await response_cache.aget("miscategorised_count", UID) is None
        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

    asyncio.run(go())


# ── dismiss_transfer_pair (analytics.py) ────────────────────────────────────

def test_dismiss_transfer_pair_invalidates_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)
    monkeypatch.setattr(
        analytics, "preferences_col",
        FakeCol([{"user_id": UID, "dismissed_transfer_pairs": []}]),
    )

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("transfer_pair_suggestions", UID, {"items": ["old"]}, version=v)
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        result = await analytics.dismiss_transfer_pair(
            {"pair_key": "c1:d1"}, {"email": UID},
        )
        assert result == {"ok": True}

        assert await response_cache.aget("transfer_pair_suggestions", UID) is None
        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

    asyncio.run(go())


# ── Direct mechanism proof, independent of any one endpoint ────────────────
# Demonstrates the exact race the fix closes, isolated from any router: the
# narrow, synchronous `invalidate()` schedules its version bump via
# `bump_soon` and returns before that task runs, so an immediate same-process
# read still sees the pre-bump memo — while the full, awaited `ainvalidate()`
# guarantees the bump has already landed by the time it returns.

def test_narrow_sync_invalidate_still_races_the_memo(monkeypatch):
    """This is the mechanism `resolve_movement` et al used to rely on
    (before G181) and is kept here as a permanent regression guard on
    response_cache.invalidate/data_version.bump_soon's own documented
    trade-off — NOT a claim that any endpoint should still call it this way."""
    _patch_cache_plumbing(monkeypatch)

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, {"pre_write": True}, version=v)

        response_cache.invalidate(UID, "miscategorised_count")  # sync, narrow

        # No sleep: the scheduled bump_soon task has not had a chance to run.
        stale = await response_cache.aget("today", UID)
        assert stale == {"pre_write": True}, (
            "expected the narrow fire-and-forget invalidate to still race "
            "the 1s memo on an immediate read"
        )

    asyncio.run(go())


def test_full_awaited_invalidate_never_races_the_memo(monkeypatch):
    """The fixed pattern: ainvalidate's version bump is awaited inline, so
    by the time it returns the process memo already holds the new version —
    an immediate read of ANY cached entry for this user is a guaranteed
    miss, no sleep required."""
    _patch_cache_plumbing(monkeypatch)

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, {"pre_write": True}, version=v)

        await response_cache.ainvalidate(UID)

        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())
