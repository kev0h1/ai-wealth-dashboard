"""Tests for backlog B7: task_reconcile_truelayer respects each user's
subscription tier's `refresh` cadence (app.core.subscription TIER_LIMITS)
instead of syncing every connection on the same 4-hourly window.

No mongomock in this environment (see tests/conftest.py's own note) — every
collection the cron touches is replaced with a tiny in-memory FakeCol,
following the same pattern as tests/test_retention.py. `get_subscription`
is monkeypatched directly on the sync_worker module (it's imported there
as `from app.core.subscription import get_subscription`), keyed by a
per-test uid -> Subscription map, so tests can control each user's tier
without touching a subscriptions collection at all.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.workers.sync_worker as sync_worker
from app.core.subscription import Subscription, Tier

NOW = datetime(2026, 9, 6, 12, 0, 0)


# ── fakes ────────────────────────────────────────────────────────────────

def _matches(doc: dict, filt: dict) -> bool:
    for key, cond in filt.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            ok = True
            if "$exists" in cond:
                exists = key in doc and doc.get(key) is not None
                ok = ok and (exists == cond["$exists"])
            if "$in" in cond:
                ok = ok and (val in cond["$in"])
            if "$lt" in cond:
                ok = ok and (val is not None and val < cond["$lt"])
            if not ok:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, n):
        return list(self._docs) if n is None else list(self._docs)[:n]


class FakeCol:
    """Stand-in for a Motor collection: supports exactly the ops
    task_reconcile_truelayer performs (find/sort/to_list, count_documents,
    update_one with $set)."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def find(self, filt, proj=None):
        return _FakeCursor([dict(d) for d in self.docs if _matches(d, filt)])

    async def count_documents(self, filt, limit=None):
        n = sum(1 for d in self.docs if _matches(d, filt))
        return min(n, limit) if limit is not None else n

    async def update_one(self, filt, update):
        for d in self.docs:
            if _matches(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return


class FakeArq:
    def __init__(self):
        self.calls: list = []

    async def enqueue_job(self, task_name, **kwargs):
        self.calls.append((task_name, kwargs))


def _ctx(arq):
    return {"redis": arq}


def _make_subscription_lookup(tiers: dict, *, raise_for: set = frozenset()):
    """tiers: uid -> Tier. raise_for: uids for which get_subscription should
    raise, to exercise the fail-open fallback path."""
    async def _fake_get_subscription(uid):
        if uid in raise_for:
            raise RuntimeError("subscriptions read failed")
        return Subscription(tiers[uid])
    return _fake_get_subscription


def _patch_common(monkeypatch, *, connections=None, accounts=None, finexer=None):
    monkeypatch.setattr(sync_worker, "connections_col", connections or FakeCol())
    monkeypatch.setattr(sync_worker, "accounts_col", accounts or FakeCol())
    monkeypatch.setattr(sync_worker, "finexer_consents_col", finexer or FakeCol())
    monkeypatch.setattr(sync_worker, "webhook_events_col", FakeCol())

    async def _no_op_cull():
        return None
    monkeypatch.setattr(sync_worker, "cull_orphaned_connections", _no_op_cull)


def _patch_now(monkeypatch, now=NOW):
    class _FixedDatetime(datetime):
        @classmethod
        def utcnow(cls):
            return now
    monkeypatch.setattr(sync_worker, "datetime", _FixedDatetime)


# ── _refresh_window unit tests ──────────────────────────────────────────

def test_refresh_window_4h_and_priority_unchanged():
    assert sync_worker._refresh_window("4h") == timedelta(hours=3, minutes=30)
    assert sync_worker._refresh_window("priority") == timedelta(hours=3, minutes=30)


def test_refresh_window_daily_is_23h30():
    assert sync_worker._refresh_window("daily") == timedelta(hours=23, minutes=30)


def test_refresh_window_on_upload_is_none():
    assert sync_worker._refresh_window("on_upload") is None


def test_refresh_window_unknown_or_none_fails_open_to_4h(caplog):
    assert sync_worker._refresh_window(None) == timedelta(hours=3, minutes=30)
    assert sync_worker._refresh_window("weekly") == timedelta(hours=3, minutes=30)


# ── task_reconcile_truelayer: TrueLayer cadence ─────────────────────────

def test_lite_connection_synced_5h_ago_not_enqueued(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-lite", "user_id": "lite@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=1)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-lite"}])
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"lite@example.com": Tier.LITE}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert arq.calls == []
    assert result["reconciled"] == 0
    assert result["skipped_fresh"] == 1


def test_lite_connection_synced_24h_ago_is_enqueued(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-lite", "user_id": "lite@example.com", "last_synced": NOW - timedelta(hours=24),
         "access_token": "tok", "created_at": NOW - timedelta(days=2)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-lite"}])
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"lite@example.com": Tier.LITE}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert len(arq.calls) == 1
    task_name, kwargs = arq.calls[0]
    assert task_name == "task_sync_truelayer"
    assert kwargs["connection_id"] == "conn-lite"
    assert result["reconciled"] == 1
    assert result["skipped_fresh"] == 0


def test_standard_connection_synced_5h_ago_is_enqueued(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-std", "user_id": "std@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=1)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-std"}])
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"std@example.com": Tier.STANDARD}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert len(arq.calls) == 1
    assert arq.calls[0][1]["connection_id"] == "conn-std"
    assert result["reconciled"] == 1


def test_statements_connection_never_enqueued(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-stmt", "user_id": "stmt@example.com", "last_synced": NOW - timedelta(days=30),
         "access_token": "tok", "created_at": NOW - timedelta(days=40)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-stmt"}])
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"stmt@example.com": Tier.STATEMENTS}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert arq.calls == []
    assert result["reconciled"] == 0
    assert result["skipped_on_upload"] == 1
    assert result["skipped_fresh"] == 0


def test_priority_tier_enqueued_before_standard(monkeypatch):
    # Standard connection appears first in the (oldest-first) query result,
    # but the Max/priority user's job must still be enqueued first.
    connections = FakeCol([
        {"_id": "conn-std", "user_id": "std@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=2)},
        {"_id": "conn-max", "user_id": "max@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=1)},
    ])
    accounts = FakeCol([
        {"_id": "a1", "connection_id": "conn-std"},
        {"_id": "a2", "connection_id": "conn-max"},
    ])
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({
            "std@example.com": Tier.STANDARD,
            "max@example.com": Tier.MAX,
        }),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert [c[1]["connection_id"] for c in arq.calls] == ["conn-max", "conn-std"]
    assert result["reconciled"] == 2


def test_get_subscription_failure_falls_back_to_4h_window(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-x", "user_id": "broken@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=1)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-x"}])
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({}, raise_for={"broken@example.com"}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    # 5h ago is stale under the fallback 3h30 window, so it still gets synced.
    assert len(arq.calls) == 1
    assert arq.calls[0][1]["connection_id"] == "conn-x"
    assert result["reconciled"] == 1


# ── task_reconcile_truelayer: Finexer cadence ───────────────────────────

def test_finexer_lite_consent_synced_5h_ago_not_enqueued(monkeypatch):
    finexer = FakeCol([
        {"_id": "fx-1", "user_id": "lite@example.com", "status": "authorized",
         "last_synced": NOW - timedelta(hours=5), "created_at": NOW - timedelta(days=1)},
    ])
    _patch_common(monkeypatch, finexer=finexer)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"lite@example.com": Tier.LITE}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert arq.calls == []
    assert result["skipped_fresh"] == 1


def test_finexer_lite_consent_synced_24h_ago_is_enqueued(monkeypatch):
    finexer = FakeCol([
        {"_id": "fx-1", "user_id": "lite@example.com", "status": "authorized",
         "last_synced": NOW - timedelta(hours=24), "created_at": NOW - timedelta(days=2)},
    ])
    _patch_common(monkeypatch, finexer=finexer)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"lite@example.com": Tier.LITE}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert len(arq.calls) == 1
    assert arq.calls[0][0] == "task_sync_finexer"
    assert arq.calls[0][1]["consent_id"] == "fx-1"
    assert result["reconciled"] == 1
