"""G390: the transfers review candidates are computed at sync, stored per
user, and served from storage; decisions survive a recompute."""
import asyncio

import app.routers.analytics as analytics
import app.services.transfer_review_store as store
from app.db import collections
from app.services import warmup
from test_transfer_pairs import UID, _run_confirm, _setup_pair_and_series


def _count_builds(monkeypatch):
    calls = {"n": 0}
    original = analytics._build_review_state

    async def counting(uid):
        calls["n"] += 1
        return await original(uid)

    monkeypatch.setattr(analytics, "_build_review_state", counting)
    return calls


def _doc():
    docs = store.transfer_review_store_col.docs
    return docs[0] if docs else None


def test_refresh_at_sync_builds_the_store_and_endpoints_serve_from_it(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(store.refresh(UID))
    assert calls["n"] == 1
    doc = _doc()
    assert doc["_id"] == UID and doc["user_id"] == UID
    assert [p["pair_key"] for p in doc["state"]["pairs"]] == ["c1:d1"]
    assert [t["_id"] for t in doc["state"]["flagged"]] == ["d2"]

    # Both endpoints, even after a generic cache wipe, read storage only.
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    listing = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    count = asyncio.run(analytics.get_miscategorised_count(offset=0, user={"email": UID}))
    assert calls["n"] == 1
    assert [i["ids"] for i in listing["items"]] == [["d2"]]
    assert count["review_total"] == 2


def test_store_absent_recomputes_inline_then_saves(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    assert _doc() is None
    first = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 1 and _doc() is not None
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    second = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 1
    assert first == second


def test_response_shape_matches_the_direct_computation(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    pairs = asyncio.run(analytics._transfer_pair_suggestions(UID))
    separate = asyncio.run(analytics._separate_pair_review_items(UID))
    excluded = analytics._pair_leg_ids(pairs) | frozenset(i["id"] for i in separate)
    direct = analytics._group_miscategorised(
        asyncio.run(analytics._flagged_miscategorised(UID, exclude_ids=excluded)))[:50]
    served = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert served == {"items": direct, "separate_items": separate}
    assert asyncio.run(analytics.get_transfer_pair_suggestions({"email": UID})) == {"items": pairs}


def test_count_equals_the_list(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    listing = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    state = asyncio.run(analytics.get_review_state(UID))
    count = asyncio.run(analytics.get_miscategorised_count(offset=0, user={"email": UID}))
    shown = len(listing["items"]) + len(state["pairs"]) + len(listing["separate_items"])
    assert count["review_total"] == shown == 2


def test_decisions_survive_recompute(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(store.refresh(UID))
    asyncio.run(analytics.dismiss_miscategorised_series({"series_key": "To Kevin Maingi"}, {"email": UID}))
    asyncio.run(analytics.dismiss_transfer_pair({"pair_key": "c1:d1"}, {"email": UID}))
    # Decisions changed the fingerprint: next read rebuilds from the same prefs.
    listing = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 2
    assert [i["ids"] for i in listing["items"]] == []
    assert {i["id"] for i in listing["separate_items"]} == {"c1", "d1"}
    # A sync marks the store stale; the recompute still honours every decision.
    asyncio.run(store.mark_stale(UID))
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    again = asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 3
    assert again == listing
    state = asyncio.run(analytics.get_review_state(UID))
    assert state["pairs"] == [] and state["flagged"] == []


def test_confirmed_pair_is_kept_after_sync_and_recompute(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    asyncio.run(store.refresh(UID))
    _run_confirm(monkeypatch, rows, "c1", "d1")
    asyncio.run(store.mark_stale(UID))
    state = asyncio.run(analytics.get_review_state(UID))
    assert state["pairs"] == []
    assert "c1" not in {t["_id"] for t in state["flagged"]}


def test_only_transaction_changes_invalidate_not_cache_wipes(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(store.refresh(UID))
    for _ in range(3):
        asyncio.run(analytics.response_cache.ainvalidate(UID))
        asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 1
    asyncio.run(store.mark_stale(UID))
    asyncio.run(analytics.response_cache.ainvalidate(UID))
    asyncio.run(analytics.get_miscategorised_transactions({"email": UID}))
    assert calls["n"] == 2


def test_stale_mark_during_a_build_is_not_overwritten(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    original = analytics._build_review_state

    async def build_then_sync_lands(uid):
        state = await original(uid)
        await store.mark_stale(uid)
        return state

    monkeypatch.setattr(analytics, "_build_review_state", build_then_sync_lands)
    asyncio.run(analytics.get_review_state(UID))
    assert not store.is_valid(_doc(), asyncio.run(analytics._review_inputs_fingerprint(UID)))


def test_new_transaction_count_invalidates_without_a_hook(monkeypatch):
    rows = _setup_pair_and_series(monkeypatch)
    calls = _count_builds(monkeypatch)
    asyncio.run(analytics.get_review_state(UID))
    analytics.transactions_col.docs.append({**rows[2], "_id": "d3", "amount": 51.0})
    asyncio.run(analytics.get_review_state(UID))
    assert calls["n"] == 2


def test_store_is_erased_with_the_user():
    assert "transfer_review_store_col" in collections.ERASURE_MANIFEST
    assert collections.transfer_review_store_col.name in collections.managed_collection_names()


def test_warm_user_warms_the_list_alongside_the_count(monkeypatch):
    _setup_pair_and_series(monkeypatch)
    names = []

    async def noop(uid):
        return {"ok": True}

    async def record_list(uid):
        names.append("list")
        return await original_list(uid)

    original_list = warmup._compute_miscategorised_list
    for n in ("_compute_today", "_compute_safe_to_spend", "_compute_spend_verdict",
              "_compute_miscategorised_count", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, noop)
    monkeypatch.setattr(warmup, "_compute_miscategorised_list", record_list)

    class _Bump:
        async def bump(self, uid):
            return 1

    monkeypatch.setattr(warmup, "data_version", _Bump())
    result = asyncio.run(warmup._warm_user_impl(UID)) if hasattr(warmup, "_warm_user_impl") else asyncio.run(warmup.warm_user(UID))
    assert "miscategorised_list" in result["warmed"]
    assert names == ["list"]
    assert _doc() is not None
