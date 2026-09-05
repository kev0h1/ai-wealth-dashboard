"""Unit tests for the phase-2 rewrite of app.services.response_cache +
app.services.data_version — per-user, version-pinned cache backed by Mongo,
replacing the old 90s in-process-only TTL cache.

No mongomock is available in this environment (see test_notifications.py's
own note, and tests/conftest.py's own docstring on the "Event loop is
closed" landmine with the real Motor client) — `response_cache_col` and
`user_data_version_col` are replaced with tiny in-memory fakes, monkeypatched
at their SOURCE modules (app.services.response_cache /
app.services.data_version), matching the rest of this suite's convention
(see tests/test_grow.py's own docstring).
"""
import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import app.services.data_version as data_version
import app.services.response_cache as response_cache
import app.services.warmup as warmup

UID = "kevin@example.com"


class FakeVersionCol:
    """Stand-in for `user_data_version_col`: `_id`-keyed, supports the two
    real ops data_version.py performs (`find_one_and_update` with $inc/$set,
    upsert, return_document=AFTER; plain `find_one`). Both accept and ignore
    `max_time_ms` (production passes it; this fake has no timeout concept)."""

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
    """Stand-in for `response_cache_col`: keyed (user_id, name), supports
    `find_one` and the upserting `replace_one` aput performs."""

    def __init__(self):
        self.docs: dict = {}

    async def find_one(self, filt, max_time_ms=None):
        doc = self.docs.get((filt["user_id"], filt["name"]))
        return dict(doc) if doc else None

    async def replace_one(self, filt, doc, upsert=False):
        self.docs[(filt["user_id"], filt["name"])] = dict(doc)

    async def delete_many(self, filt):
        self.docs.clear()


def _patch_cols(monkeypatch):
    version_col = FakeVersionCol()
    cache_col = FakeResponseCacheCol()
    monkeypatch.setattr(data_version, "user_data_version_col", version_col)
    monkeypatch.setattr(response_cache, "response_cache_col", cache_col)
    return version_col, cache_col


def _patch_day(monkeypatch, day="2026-09-05"):
    """`local_day` is a plain module-level function (no monkeypatchable
    `date` object in response_cache.py's own namespace — it computes off
    Europe/London wall-clock time), so tests move "today" by replacing the
    function itself, in a mutable box so a test can move it again later."""
    box = {"day": day}
    monkeypatch.setattr(response_cache, "local_day", lambda: box["day"])
    return box


def _patch_clock(monkeypatch):
    """Controllable `time.monotonic()` for TTL tests — a mutable single-item
    list so the closure can rewrite it."""
    clock = [1_000.0]
    monkeypatch.setattr(response_cache.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(data_version.time, "monotonic", lambda: clock[0])
    return clock


# ── version mismatch invalidates (read-time) ────────────────────────────────

def test_version_mismatch_invalidates(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, {"v": 1}, version=v)
        assert await response_cache.aget("today", UID) == {"v": 1}
        # A write elsewhere bumps the version — the cached entry (stamped
        # with the OLD version) must stop being served, from memory or Mongo.
        await data_version.bump(UID)
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


# ── version-pinning race: a stale pin must not be stored at write time ─────

def test_aput_skips_write_when_version_raced(monkeypatch):
    """Demonstrates the write-time race response_cache.aput's version pin
    closes: pin `v` BEFORE a (simulated) slow compute, let something else
    bump the version WHILE that compute is "running", then aput with the
    now-stale pinned `v` — the write (both memory and Mongo) must be
    skipped entirely, not stored under the new version."""
    _, cache_col = _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    async def go():
        v = await response_cache.snapshot(UID)  # pinned BEFORE "compute"
        # ... slow compute happens here ...
        await data_version.bump(UID)  # someone else invalidates mid-compute
        payload = {"v": "computed-under-stale-version"}
        await response_cache.aput("today", UID, payload, version=v)

        assert response_cache._caches.get("today", {}).get(UID) is None
        assert cache_col.docs.get((UID, "today")) is None
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


# ── day change invalidates ──────────────────────────────────────────────────

def test_day_change_invalidates(monkeypatch):
    _patch_cols(monkeypatch)
    box = _patch_day(monkeypatch)

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, {"v": 1}, version=v)
        assert await response_cache.aget("today", UID) == {"v": 1}
        box["day"] = "2026-09-06"
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


# ── TTL expiry ───────────────────────────────────────────────────────────────

def test_ttl_expiry_memory_layer(monkeypatch):
    _, cache_col = _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    clock = _patch_clock(monkeypatch)

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, {"v": 1}, version=v)
        assert await response_cache.aget("today", UID) == {"v": 1}
        # Isolate the MEMORY layer's TTL check: the Mongo doc's own
        # "computed_at" is a real wall-clock timestamp the mocked
        # `time.monotonic()` clock above doesn't move, so leaving it in
        # place would let aget's Mongo fallback serve a "fresh" hit and mask
        # the memory-layer expiry this test is isolating (Mongo-layer TTL
        # has its own dedicated test below).
        cache_col.docs.clear()
        clock[0] += response_cache.TTL_SECONDS + 1
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


def test_ttl_expiry_mongo_layer_when_memory_cold(monkeypatch):
    """A doc that's version+day-valid but older than the TTL must still be
    treated as a miss when read straight from Mongo (memory cold)."""
    _, cache_col = _patch_cols(monkeypatch)
    _patch_day(monkeypatch, "2026-09-05")

    async def go():
        stale_computed_at = datetime.now(timezone.utc) - timedelta(
            seconds=response_cache.TTL_SECONDS + 60
        )
        cache_col.docs[(UID, "today")] = {
            "user_id": UID, "name": "today", "version": 0,
            "day": "2026-09-05",
            "payload": {"v": "stale"}, "computed_at": stale_computed_at,
        }
        assert await response_cache.aget("today", UID) is None

    asyncio.run(go())


# ── invalidate() bumps the version ──────────────────────────────────────────

def test_invalidate_bumps_version(monkeypatch):
    _patch_cols(monkeypatch)

    async def go():
        before = await data_version.current(UID)
        response_cache.invalidate(UID)
        # bump_soon fires a background task on this running loop — give it
        # one tick to actually run before checking.
        await asyncio.sleep(0)
        after = await data_version.current(UID)
        assert after == before + 1

    asyncio.run(go())


def test_ainvalidate_bumps_version_immediately(monkeypatch):
    _patch_cols(monkeypatch)

    async def go():
        before = await data_version.current(UID)
        await response_cache.ainvalidate(UID)
        after = await data_version.current(UID)
        assert after == before + 1

    asyncio.run(go())


# ── aget falls back to Mongo when memory is cold ────────────────────────────

def test_aget_falls_back_to_mongo_when_memory_cold(monkeypatch):
    _, cache_col = _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    async def go():
        # Written directly to the fake Mongo layer — memory has never seen it.
        version = await data_version.current(UID)
        cache_col.docs[(UID, "grow")] = {
            "user_id": UID, "name": "grow", "version": version,
            "day": response_cache.local_day(),
            "payload": {"verdict": "ok"}, "computed_at": datetime.now(timezone.utc),
        }
        assert response_cache._caches.get("grow", {}).get(UID) is None  # memory cold
        result = await response_cache.aget("grow", UID)
        assert result == {"verdict": "ok"}
        # A same-process repeat read is now served from memory (populated
        # by the Mongo hit above).
        cache_col.docs.clear()
        assert await response_cache.aget("grow", UID) == {"verdict": "ok"}

    asyncio.run(go())


# ── memory and Mongo layers must return identical shapes ───────────────────

def test_memory_and_mongo_hits_return_identical_encoded_shape(monkeypatch):
    """aput encodes ONCE (jsonable_encoder) and stores the SAME encoded
    value in both layers — a memory-hit right after aput and a Mongo-hit
    (memory forced cold) must be byte-for-byte the same shape, for a
    payload containing a date, a Decimal, a tuple and an int-keyed dict —
    none of which are natively BSON/JSON in their raw Python form."""
    _, cache_col = _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    payload = {
        "computed_on": datetime(2026, 9, 5).date(),
        "amount": Decimal("12.50"),
        "pair": (1, 2, 3),
        "by_year": {2024: "a", 2025: "b"},
    }

    async def go():
        v = await response_cache.snapshot(UID)
        await response_cache.aput("today", UID, payload, version=v)

        memory_hit = await response_cache.aget("today", UID)

        response_cache._caches["today"].pop(UID, None)  # force memory cold
        mongo_hit = await response_cache.aget("today", UID)

        assert memory_hit == mongo_hit
        # And it's the ENCODED shape, not the raw Python objects — proves
        # both layers hold the same jsonable_encoder output, not the memory
        # layer secretly keeping the pre-encoding payload.
        assert memory_hit["computed_on"] == "2026-09-05"
        assert memory_hit["pair"] == [1, 2, 3]
        assert isinstance(memory_hit["amount"], float)
        assert memory_hit["by_year"] == {"2024": "a", "2025": "b"}

    asyncio.run(go())


# ── warm_user writes the six entries under the new version ─────────────────

def test_warm_user_writes_six_entries_under_new_version(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    calls = []

    def _mock(cache_name, payload, *, self_caching):
        """`self_caching=True` mimics a router (grow_view, list_commitments,
        get_miscategorised_count) that already pins its OWN snapshot and
        writes its own cache entry — warm_user must NOT aput on top of
        those; `self_caching=False` mimics a pure compute (
        compute_today_items, build_safe_to_spend_response,
        compute_spend_verdict) that warm_user itself is responsible for
        pinning (via the version it captured right after its own bump) and
        aput-ing."""
        async def _compute(uid):
            calls.append(cache_name)
            assert uid == UID
            if self_caching:
                v = await response_cache.snapshot(uid)
                await response_cache.aput(cache_name, uid, payload, version=v)
            return payload
        return _compute

    monkeypatch.setattr(warmup, "_compute_today", _mock("today", {"status": "ok", "items": []}, self_caching=False))
    monkeypatch.setattr(warmup, "_compute_safe_to_spend", _mock("safe_to_spend", {"status": "ok"}, self_caching=False))
    monkeypatch.setattr(warmup, "_compute_spend_verdict", _mock("spend_verdict:0", {"reading": "under"}, self_caching=False))
    monkeypatch.setattr(warmup, "_compute_miscategorised_count", _mock("miscategorised_count:0", {"count": 0}, self_caching=True))
    monkeypatch.setattr(warmup, "_compute_grow", _mock("grow", {"verdict": "ok"}, self_caching=True))
    monkeypatch.setattr(warmup, "_compute_commitments", _mock("commitments", {"items": []}, self_caching=True))

    async def go():
        before = await data_version.current(UID)
        result = await warmup.warm_user(UID)
        assert result["failed"] == []
        assert sorted(result["warmed"]) == sorted(
            ["today", "safe_to_spend", "spend_verdict:0", "miscategorised_count:0", "grow", "commitments"]
        )
        after = await data_version.current(UID)
        assert after == before + 1  # warm_user's own bump, nothing else touched it

        for name in ("today", "safe_to_spend", "spend_verdict:0", "miscategorised_count:0", "grow", "commitments"):
            cached = await response_cache.aget(name, UID)
            assert cached is not None, f"{name} was not warmed"

    asyncio.run(go())
    assert set(calls) == {
        "today", "safe_to_spend", "spend_verdict:0", "miscategorised_count:0", "grow", "commitments",
    }


def test_warm_user_tolerates_one_step_failing(monkeypatch):
    """One broken compute step must not stop the rest from warming."""
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    async def _boom(uid):
        raise RuntimeError("grow computation exploded")

    async def _ok(uid):
        return {"ok": True}

    monkeypatch.setattr(warmup, "_compute_today", _ok)
    monkeypatch.setattr(warmup, "_compute_safe_to_spend", _ok)
    monkeypatch.setattr(warmup, "_compute_spend_verdict", _ok)
    monkeypatch.setattr(warmup, "_compute_miscategorised_count", _ok)
    monkeypatch.setattr(warmup, "_compute_grow", _boom)
    monkeypatch.setattr(warmup, "_compute_commitments", _ok)

    async def go():
        result = await warmup.warm_user(UID)
        assert result["failed"] == ["grow"]
        assert "grow" not in result["warmed"]
        assert await response_cache.aget("today", UID) == {"ok": True}
        assert await response_cache.aget("grow", UID) is None

    asyncio.run(go())


# ── warm_user single-flight ──────────────────────────────────────────────────

def test_warm_user_single_flight_shares_one_run(monkeypatch):
    """A second concurrent warm_user(uid) call must await the SAME in-flight
    run rather than starting a fresh one (and a fresh bump)."""
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    call_count = {"n": 0}
    started = asyncio.Event()
    release = asyncio.Event()

    async def _slow_today(uid):
        call_count["n"] += 1
        started.set()
        await release.wait()
        return {"status": "ok", "items": []}

    async def _ok(uid):
        return {"ok": True}

    monkeypatch.setattr(warmup, "_compute_today", _slow_today)
    monkeypatch.setattr(warmup, "_compute_safe_to_spend", _ok)
    monkeypatch.setattr(warmup, "_compute_spend_verdict", _ok)
    monkeypatch.setattr(warmup, "_compute_miscategorised_count", _ok)
    monkeypatch.setattr(warmup, "_compute_grow", _ok)
    monkeypatch.setattr(warmup, "_compute_commitments", _ok)

    async def go():
        before = await data_version.current(UID)
        t1 = asyncio.ensure_future(warmup.warm_user(UID))
        await started.wait()
        t2 = asyncio.ensure_future(warmup.warm_user(UID))
        await asyncio.sleep(0)  # let t2 reach the single-flight check
        release.set()
        r1, r2 = await asyncio.gather(t1, t2)

        assert call_count["n"] == 1  # only ONE real run happened
        assert r1 is r2  # the second call got the SAME result object
        after = await data_version.current(UID)
        assert after == before + 1  # only one bump, not two

    asyncio.run(go())
