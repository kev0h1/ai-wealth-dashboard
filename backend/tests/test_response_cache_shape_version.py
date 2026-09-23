"""G148: a cached payload built under an OLDER response shape is a miss.

`response_cache` had three freshness checks: the user's data version, the
local calendar day, and a 6h TTL bound. All three answer "is this payload
out of date for this user?". None of them answers "was this payload built
by a version of the CODE that emitted the same fields?".

That gap is what made the G148 defect invisible and long-lived. G110 added
`account_eligibility` to `GET /today` on 2026-09-16; every `today` entry
already persisted in Mongo was still version-current and day-current for
its user, so it stayed valid and kept being served as a payload with the
old shape. The same thing happens on every deploy that adds a field to any
cached response: the readers are new, the writers are new, and the stored
payloads are old, with nothing in the entry recording which is which.

`SHAPE_VERSION` closes it. It is stamped into every entry `aput` writes,
in both the memory and the Mongo layer, and checked on every read. Bumping
the constant is a one-line, whole-population invalidation at deploy time:
every persisted entry becomes a miss immediately, for every user, without
waiting out a TTL or a calendar day and without touching data versions.

Entries written before this change carry no `shape` key at all, so they are
rejected by the same check with no migration step (see
`test_pre_shape_version_documents_are_rejected` below) — including the one
that was serving Kevin a today payload with no account_eligibility in it.

Fakes and helpers follow test_response_cache_v2.py's own conventions (no
mongomock in this environment; the collections are replaced at their source
modules).
"""
import asyncio
from datetime import datetime, timezone

import app.services.data_version as data_version
import app.services.response_cache as response_cache

from tests.test_response_cache_v2 import (
    FakeResponseCacheCol,
    FakeVersionCol,
    UID,
)


def _patch_cols(monkeypatch):
    version_col = FakeVersionCol()
    cache_col = FakeResponseCacheCol()
    monkeypatch.setattr(data_version, "user_data_version_col", version_col)
    monkeypatch.setattr(response_cache, "response_cache_col", cache_col)
    return version_col, cache_col


def _patch_day(monkeypatch, day="2026-09-23"):
    box = {"day": day}
    monkeypatch.setattr(response_cache, "local_day", lambda: box["day"])
    return box


def _clear_memory():
    response_cache._caches.clear()


def test_shape_version_is_stamped_on_both_layers(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    _clear_memory()

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, {"status": "ok", "items": []}, version=v)

        memory_entry = response_cache._caches["today"][UID]
        assert memory_entry["shape"] == response_cache.SHAPE_VERSION

        doc = await response_cache.response_cache_col.find_one({"user_id": UID, "name": "today"})
        assert doc["shape"] == response_cache.SHAPE_VERSION

    asyncio.run(go())


def test_old_shape_document_is_rejected_rather_than_used(monkeypatch):
    """The headline guarantee, built the way the bug actually presents.

    A `today` payload persisted in the OLD shape (no `account_eligibility`)
    that is otherwise perfectly fresh — right user, current data version,
    today's calendar day, written seconds ago — must not be served.
    """
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch, "2026-09-23")
    _clear_memory()

    stale_payload = {"status": "ok", "items": [{"id": "move-1"}]}

    async def go():
        version = await data_version.current(UID, fresh=True)
        # Written directly into the collection in the old shape, exactly as
        # a pre-G148 process would have left it: every existing freshness
        # field current, only the shape stamp missing.
        await response_cache.response_cache_col.replace_one(
            {"user_id": UID, "name": "today"},
            {
                "user_id": UID,
                "name": "today",
                "version": version,
                "day": response_cache.local_day(),
                "payload": stale_payload,
                "computed_at": datetime.now(timezone.utc),
                "shape": response_cache.SHAPE_VERSION - 1,
            },
            upsert=True,
        )

        # Sanity: every PRE-EXISTING freshness check passes on this doc, so
        # the shape stamp is genuinely the only thing rejecting it.
        doc = await response_cache.response_cache_col.find_one({"user_id": UID, "name": "today"})
        assert doc["version"] == version
        assert doc["day"] == response_cache.local_day()

        assert await response_cache.aget("today", UID) is None, (
            "a payload built under an older response shape was served as fresh"
        )

    asyncio.run(go())


def test_pre_shape_version_documents_are_rejected(monkeypatch):
    """No migration step: an entry with no `shape` key at all is a miss.

    This is the literal state of every `response_cache` document in UAT and
    production at the moment this ships, including the 2026-09-23 06:00:38
    `today` entry that was serving Kevin a payload with no
    account_eligibility.
    """
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch, "2026-09-23")
    _clear_memory()

    async def go():
        version = await data_version.current(UID, fresh=True)
        await response_cache.response_cache_col.replace_one(
            {"user_id": UID, "name": "today"},
            {
                "user_id": UID,
                "name": "today",
                "version": version,
                "day": response_cache.local_day(),
                "payload": {"status": "ok", "items": []},
                "computed_at": datetime.now(timezone.utc),
            },
            upsert=True,
        )
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


def test_memory_layer_rejects_an_old_shape_entry_too(monkeypatch):
    """Both layers, not just Mongo.

    A long-lived API process holds `_caches` across a deploy only in the
    sense that it is restarted on deploy, but an entry promoted into memory
    from a stale Mongo doc would otherwise outlive the doc check for the
    rest of its TTL, so the memory freshness test carries the same stamp.
    """
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch, "2026-09-23")
    _clear_memory()

    async def go():
        version = await data_version.current(UID, fresh=True)
        response_cache._caches.setdefault("today", {})[UID] = {
            "version": version,
            "day": response_cache.local_day(),
            "ts": __import__("time").monotonic(),
            "payload": {"status": "ok", "items": []},
            "shape": response_cache.SHAPE_VERSION - 1,
        }
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


def test_current_shape_round_trips_through_both_layers(monkeypatch):
    """The guard must not reject entries the CURRENT code wrote."""
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch, "2026-09-23")
    _clear_memory()

    payload = {
        "status": "ok",
        "items": [],
        "account_eligibility": {"acc-1": {"short": False, "headroom": 74.85}},
    }

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, payload, version=v)

        assert await response_cache.aget("today", UID) == payload  # memory layer

        _clear_memory()
        assert await response_cache.aget("today", UID) == payload  # Mongo layer

    asyncio.run(go())
