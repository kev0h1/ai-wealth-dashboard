"""G183 — POST /rules (categories.add_rule) applied the new rule
synchronously via `apply_single_rule`, but only bumped the response-cache
data version inside a DETACHED asyncio task (`_apply_rules_bulk_and_bump`)
that also sweeps every sibling transaction over the user's whole transaction
set. A Home brief refetched right after `POST /rules` returns could keep
being served the stale cached "today" payload for however long that sweep
takes to get scheduled and finish — unbounded, since it's a full scan, not a
fixed delay. This is the same shape G181 closed for five other write
endpoints: a write completes and returns before the response cache's
version bump has actually landed, so an immediate re-read (no sleep) still
hits the 1s in-process `data_version` memo's stale value.

`companion.dismiss_today_item` was the one remaining narrow synchronous
`response_cache.invalidate(uid, "today")` call G181 didn't touch; it's
already `async def`, so the fix there is switching to the awaited full
`response_cache.ainvalidate(uid)`.

Same test convention as `test_g181_awaited_invalidation.py` (and, one level
further back, `test_response_cache_v2.py`): exercise the REAL
`app.services.response_cache` / `app.services.data_version` modules with
`response_cache_col` / `user_data_version_col` swapped for tiny in-memory
fakes (no mongomock in this environment). Every test calls the real router
function directly (`current_user`'s `user` dict passed as a plain
`{"email": uid}`), and reads back with NO sleep and NO manual event-loop
tick.

Verified red against the pre-fix router code (categories.py / companion.py
copied in from `origin/main` via `git show`, then restored to this branch's
fixed versions via `git checkout HEAD --`) before this file was committed —
see the build report for the exact commands; not baked into the test itself
since a stale-cache race can't be reproduced by dynamically re-importing an
old module body without also duplicating its whole dependency surface.
"""
import asyncio
from datetime import datetime

import app.routers.categories as categories
import app.routers.companion as companion
import app.services.companion as companion_service
import app.services.data_version as data_version
import app.services.response_cache as response_cache

UID = "kevin@example.com"
OTHER_UID = "other@example.com"
D0 = datetime(2026, 8, 10)


# ── Real response_cache / data_version plumbing, fake Mongo underneath ─────
# (identical shape to test_response_cache_v2.py / test_g181_awaited_invalidation.py)

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
    # Bare-module globals — clear per test so nothing leaks between tests.
    response_cache._caches.clear()
    data_version._memo.clear()


async def _prime_home_brief(uid: str):
    """Stand-in for the cached Home brief (the real cache name is "today"),
    primed BEFORE the write under test — a stale read after the write would
    still return this exact payload."""
    v = await response_cache.snapshot(uid)
    payload = {"pre_write": True, "uid": uid}
    await response_cache.aput("today", uid, payload, version=v)
    return payload


# ── Generic fake-Mongo collection (subset matcher) ──────────────────────────

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


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return [d for d in self.docs if _match(d, query)]

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
        for k, v in (update.get("$addToSet") or {}).items():
            d.setdefault(k, [])
            if v not in d[k]:
                d[k].append(v)


async def _drain_background_tasks():
    """Await whatever `add_rule`'s detached `_apply_rules_bulk_and_bump`
    task scheduled onto `categories._background_tasks`, so the test doesn't
    leave a dangling task / emit "Task was destroyed" warnings. This runs
    AFTER the assertions below that must see the state exactly as it is the
    instant the endpoint's coroutine returns — draining it later doesn't
    retroactively change what those assertions already observed."""
    pending = list(categories._background_tasks)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


# ── add_rule (categories.py) ────────────────────────────────────────────────

def test_add_rule_invalidates_response_cache_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)

    monkeypatch.setattr(categories, "user_rules_col", FakeCol([]))
    monkeypatch.setattr(categories, "user_categories_col", FakeCol([]))

    async def _fake_apply_single_rule(uid, pattern, category):
        return [{"id": "t1", "category": category}]

    bulk_calls = []

    async def _fake_apply_rules_bulk(uid, structural=False):
        bulk_calls.append(uid)
        return 0

    monkeypatch.setattr(categories, "apply_single_rule", _fake_apply_single_rule)
    monkeypatch.setattr(categories, "apply_rules_bulk", _fake_apply_rules_bulk)

    async def go():
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        result = await categories.add_rule(
            {"description": "Coffee", "pattern": "costa", "category": "Eating Out"},
            {"email": UID},
        )
        assert result["affected"] == [{"id": "t1", "category": "Eating Out"}]

        # No sleep, no manual event-loop tick — reads exactly as cold as the
        # loop is right after the endpoint's HTTP response went out.
        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before, (
            "add_rule left the cached Home brief stale for an immediate "
            "refetch right after the response returned"
        )
        # The second user's cached entries are untouched by this write.
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

        await _drain_background_tasks()
        # The detached bulk sweep still ran (it sweeps siblings the awaited
        # single-rule apply doesn't touch) — this fix must not have removed
        # that behaviour, only added the awaited invalidate ahead of it.
        assert bulk_calls == [UID]

    asyncio.run(go())


def test_add_rule_missing_fields_rejected_before_any_write(monkeypatch):
    """Guard against a trivial regression: validation still runs, and still
    raises, before anything touches the cache."""
    _patch_cache_plumbing(monkeypatch)
    monkeypatch.setattr(categories, "user_rules_col", FakeCol([]))
    monkeypatch.setattr(categories, "user_categories_col", FakeCol([]))

    async def go():
        from fastapi import HTTPException
        try:
            await categories.add_rule({"description": "", "pattern": "", "category": ""}, {"email": UID})
            assert False, "expected HTTPException"
        except HTTPException as e:
            assert e.status_code == 400

    asyncio.run(go())


# ── dismiss_today_item (companion.py) ───────────────────────────────────────

def test_dismiss_today_item_invalidates_response_cache_before_returning(monkeypatch):
    _patch_cache_plumbing(monkeypatch)
    monkeypatch.setattr(companion_service, "companion_items_col", FakeCol([]))

    async def go():
        home_before = await _prime_home_brief(UID)
        other_home_before = await _prime_home_brief(OTHER_UID)

        result = await companion.dismiss_today_item({"item_id": "move-1"}, {"email": UID})
        assert result == {"ok": True}

        home_after = await response_cache.aget("today", UID)
        assert home_after is None or home_after != home_before, (
            "dismiss_today_item left the cached Home brief stale for an "
            "immediate refetch right after the response returned"
        )
        assert await response_cache.aget("today", OTHER_UID) == other_home_before

    asyncio.run(go())
