"""Backlog B1: GET /grow caches a payload whose "period_gate" is DERIVED
from Safe-to-Spend (see grow._period_gate / grow.grow_view's period-gate
comment), but grow's own cached "grow" entry and GET /safe-to-spend's own
cached "safe_to_spend" entry are independent response_cache rows that
happen to share the same data version. Two live reads hours apart with no
intervening write (no sync, no version bump) could therefore cache two
different Safe-to-Spend "moments" — one embedded inside "grow", a fresher
one under "safe_to_spend" — and Home/Planning would disagree even though
nothing version-tracked actually changed (the £1,053.91 vs £749 report on
2026-09-06 that prompted this item).

The fix: GET /safe-to-spend's write path (`app.routers.analytics.
get_safe_to_spend`) calls `response_cache.adrop("grow", uid)` right after
caching a fresh entry, forcing the next `/grow` read to recompute against
that same fresh moment rather than serving an older one for up to 6h.

No mongomock available in this environment — same tiny in-memory fakes as
tests/test_response_cache_v2.py and tests/test_grow.py, monkeypatched at
their source modules.
"""
import asyncio

import app.routers.analytics as analytics
import app.routers.grow as grow
import app.services.data_version as data_version
import app.services.response_cache as response_cache

UID = "kevin@example.com"


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


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None

    def find(self, query=None, projection=None):
        return _FakeCursor(self.docs)


def _patch_cols(monkeypatch):
    version_col = FakeVersionCol()
    cache_col = FakeResponseCacheCol()
    monkeypatch.setattr(data_version, "user_data_version_col", version_col)
    monkeypatch.setattr(response_cache, "response_cache_col", cache_col)
    return version_col, cache_col


def _patch_day(monkeypatch, day="2026-09-06"):
    monkeypatch.setattr(response_cache, "local_day", lambda: day)


def _patch_grow_collaborators(monkeypatch):
    """Everything grow_view touches besides the period gate — same fakes
    as tests/test_grow.py's own `_patch_grow_common`, inlined here so this
    file doesn't depend on another test module's internals."""
    monkeypatch.setattr(grow, "preferences_col", _FakeCol([{}]))
    monkeypatch.setattr(grow, "savings_goals_col", _FakeCol([]))
    monkeypatch.setattr(grow, "investment_accounts_col", _FakeCol([]))

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(grow, "get_user_region", fake_region)

    async def fake_cashflow(uid, region, cutoff):
        return 2000.0, 1934.0, 66.0

    monkeypatch.setattr(grow, "_cashflow", fake_cashflow)

    async def fake_current_savings(uid, goal):
        return 500.0

    monkeypatch.setattr(grow, "_current_savings", fake_current_savings)

    def fake_target_amount(goal, monthly_spending_):
        return round(monthly_spending_ * 3, 2)

    monkeypatch.setattr(grow, "_target_amount", fake_target_amount)

    async def fake_debt_plan(uid):
        return {"cards": [], "totals": {"debt": 0.0}}

    monkeypatch.setattr(grow, "get_debt_plan_cached", fake_debt_plan)


def test_fresh_safe_to_spend_write_retires_cached_grow_payload(monkeypatch):
    """The scenario behind backlog B1: grow caches a payload built from an
    OLDER Safe-to-Spend moment; a later GET /safe-to-spend computes and
    caches a NEWER moment (same data version — no sync happened in
    between). The grow cache must not survive that write."""
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    _patch_grow_collaborators(monkeypatch)

    moment_a = {"status": "ok", "state": "short", "safe_to_spend": -1053.91, "next_payday": "2026-09-25"}
    moment_b = {"status": "ok", "state": "short", "safe_to_spend": -749.0, "next_payday": "2026-09-25"}

    # No "safe_to_spend" cache entry exists yet, so grow_view's period gate
    # falls through to a direct (uncached) compute_safe_to_spend call —
    # exactly get_cached_safe_to_spend's documented "computes fresh, writes
    # nothing" behaviour.
    async def fake_compute_sts(uid):
        return moment_a

    monkeypatch.setattr(analytics, "compute_safe_to_spend", fake_compute_sts)

    async def go():
        # 1. Planning loads first: grow_view computes fresh, embeds moment_a's
        #    period gate, and caches its OWN payload.
        first = await grow.grow_view({"email": UID})
        assert first["period_gate"]["to_cover"] == 1053.91
        assert await response_cache.aget("grow", UID) is not None

        # 2. Home loads later: GET /safe-to-spend computes a fresher moment
        #    and caches it — same data version, no sync in between.
        async def fake_build_response(uid, include_series=False):
            return moment_b

        monkeypatch.setattr(analytics, "build_safe_to_spend_response", fake_build_response)
        sts_response = await analytics.get_safe_to_spend(include="", user={"email": UID})
        assert sts_response["safe_to_spend"] == -749.0

        # 3. grow's stale copy must be gone — not merely re-servable until a
        #    version bump or the 6h TTL.
        assert await response_cache.aget("grow", UID) is None
        # Safe-to-Spend's own fresh entry must survive (adrop is targeted,
        # not a version-bumping full invalidate).
        assert await response_cache.aget("safe_to_spend", UID) == moment_b

        # 4. The next /grow read recomputes and now agrees with Home: it
        #    reads the freshly cached "safe_to_spend" entry (moment_b)
        #    instead of recomputing (or re-caching) moment_a.
        async def fail_if_called(uid):
            raise AssertionError("compute_safe_to_spend should not be called — safe_to_spend cache is warm")

        monkeypatch.setattr(analytics, "compute_safe_to_spend", fail_if_called)
        second = await grow.grow_view({"email": UID})
        assert second["period_gate"]["to_cover"] == 749.0

    asyncio.run(go())


def test_safe_to_spend_write_does_not_touch_grow_when_status_not_ok(monkeypatch):
    """A degraded/insufficient-data Safe-to-Spend result is never cached
    (existing `if result.get("status") == "ok"` guard) — so it must not
    drop grow's cache either; there is no fresher moment to replace it
    with."""
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    v = asyncio.run(response_cache.snapshot(UID))
    asyncio.run(response_cache.aput("grow", UID, {"verdict": "ok"}, version=v))

    async def fake_build_response(uid, include_series=False):
        return {"status": "insufficient_data"}

    monkeypatch.setattr(analytics, "build_safe_to_spend_response", fake_build_response)

    async def go():
        await analytics.get_safe_to_spend(include="", user={"email": UID})
        assert await response_cache.aget("grow", UID) == {"verdict": "ok"}

    asyncio.run(go())
