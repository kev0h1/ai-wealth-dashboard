"""Tests for backlog E2: task_reconcile_truelayer spreads the jobs it
enqueues across RECONCILE_SPREAD_MINUTES (via arq's `_defer_by`) instead of
firing them all in one burst, so a connection count that has scaled up
(Railway Pro + replicas, once D4 is done) doesn't slam Finexer's API.

Same fakes-only approach as tests/test_reconcile_cadence.py (no mongomock
in this environment) — collections are tiny in-memory FakeCol/FakeArq
stand-ins, `get_subscription` is monkeypatched per-test.
"""
import asyncio
import logging
from datetime import datetime, timedelta

import app.workers.sync_worker as sync_worker
from app.core.subscription import Subscription, Tier

NOW = datetime(2026, 9, 6, 12, 0, 0)


# ── fakes (mirrors tests/test_reconcile_cadence.py) ─────────────────────

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
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def find(self, filt, proj=None):
        return _FakeCursor([dict(d) for d in self.docs if _matches(d, filt)])

    async def count_documents(self, filt, limit=None):
        n = sum(1 for d in self.docs if _matches(d, filt))
        return min(n, limit) if limit is not None else n

    async def find_one(self, filt):
        for d in self.docs:
            if _matches(d, filt):
                return dict(d)
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _matches(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return
        if upsert:
            new_doc = {k: v for k, v in filt.items() if not isinstance(v, dict)}
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


class FakeArq:
    def __init__(self):
        self.calls: list = []

    async def enqueue_job(self, task_name, **kwargs):
        self.calls.append((task_name, kwargs))


def _ctx(arq):
    return {"redis": arq}


def _make_subscription_lookup(tiers: dict):
    async def _fake_get_subscription(uid):
        return Subscription(tiers[uid])
    return _fake_get_subscription


def _patch_common(monkeypatch, *, connections=None, accounts=None, finexer=None, worker_runs=None):
    monkeypatch.setattr(sync_worker, "connections_col", connections or FakeCol())
    monkeypatch.setattr(sync_worker, "accounts_col", accounts or FakeCol())
    monkeypatch.setattr(sync_worker, "finexer_consents_col", finexer or FakeCol())
    monkeypatch.setattr(sync_worker, "webhook_events_col", FakeCol())
    monkeypatch.setattr(sync_worker, "worker_runs_col", worker_runs if worker_runs is not None else FakeCol())

    async def _no_op_cull():
        return None
    monkeypatch.setattr(sync_worker, "cull_orphaned_connections", _no_op_cull)


def _patch_now(monkeypatch, now=NOW):
    class _FixedDatetime(datetime):
        @classmethod
        def utcnow(cls):
            return now
    monkeypatch.setattr(sync_worker, "datetime", _FixedDatetime)


def _many_tl_connections(n: int, *, uid: str = "std@example.com", stale_hours: int = 5):
    conns = [
        {
            "_id": f"conn-{i}", "user_id": uid,
            "last_synced": NOW - timedelta(hours=stale_hours),
            "access_token": "tok", "created_at": NOW - timedelta(days=1, minutes=i),
        }
        for i in range(n)
    ]
    accounts = [{"_id": f"a-{i}", "connection_id": f"conn-{i}"} for i in range(n)]
    return FakeCol(conns), FakeCol(accounts)


# ── _spread_offsets unit tests ───────────────────────────────────────────

def test_spread_offsets_empty():
    offsets, overflow = sync_worker._spread_offsets(
        0, max_per_minute=40, min_gap_seconds=2, spread_minutes=210,
    )
    assert offsets == []
    assert overflow == 0


def test_spread_offsets_100_at_40_per_minute_never_exceeds_ceiling_and_respects_gap():
    offsets, overflow = sync_worker._spread_offsets(
        100, max_per_minute=40, min_gap_seconds=2, spread_minutes=210,
    )
    assert len(offsets) == 100
    assert overflow == 0
    # offsets strictly increasing by at least the min gap
    for a, b in zip(offsets, offsets[1:]):
        assert b - a >= 2

    # no 60-second bucket holds more than 40 jobs
    from collections import Counter
    buckets = Counter(o // 60 for o in offsets)
    assert all(count <= 40 for count in buckets.values())


def test_spread_offsets_overflow_beyond_window_still_schedules_everything():
    # A tiny window forces overflow, but nothing is dropped.
    offsets, overflow = sync_worker._spread_offsets(
        50, max_per_minute=40, min_gap_seconds=2, spread_minutes=1,  # 60s window
    )
    assert len(offsets) == 50
    window_seconds = 60
    expected_overflow = sum(1 for o in offsets if o > window_seconds)
    assert overflow == expected_overflow
    assert overflow > 0


def test_spread_offsets_zero_or_negative_max_per_minute_falls_back_to_min_gap():
    offsets, _ = sync_worker._spread_offsets(3, max_per_minute=0, min_gap_seconds=5, spread_minutes=210)
    assert offsets == [0, 5, 10]


# ── task_reconcile_truelayer integration: spread + ceiling ──────────────

def test_100_candidates_spread_respects_40_per_minute_ceiling(monkeypatch):
    connections, accounts = _many_tl_connections(100)
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"std@example.com": Tier.STANDARD}),
    )
    monkeypatch.setattr(sync_worker, "RECONCILE_MAX_PER_MINUTE", 40)
    monkeypatch.setattr(sync_worker, "RECONCILE_MIN_GAP_SECONDS", 2)
    monkeypatch.setattr(sync_worker, "RECONCILE_SPREAD_MINUTES", 210)
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert result["reconciled"] == 100
    assert len(arq.calls) == 100
    from collections import Counter
    seconds = [c[1]["_defer_by"].total_seconds() for c in arq.calls]
    buckets = Counter(int(s) // 60 for s in seconds)
    assert all(count <= 40 for count in buckets.values())
    assert result["overflow"] == 0
    assert result["spread_minutes"] == 210


def test_priority_users_get_earliest_offsets(monkeypatch):
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
    offsets = [c[1]["_defer_by"].total_seconds() for c in arq.calls]
    assert offsets[0] < offsets[1]
    assert result["reconciled"] == 2


def test_dedupe_job_id_kept_alongside_defer_by(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-a", "user_id": "std@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=1)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-a"}])
    finexer = FakeCol([
        {"_id": "fx-a", "user_id": "std@example.com", "status": "authorized",
         "last_synced": NOW - timedelta(hours=5), "created_at": NOW - timedelta(days=1)},
    ])
    _patch_common(monkeypatch, connections=connections, accounts=accounts, finexer=finexer)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"std@example.com": Tier.STANDARD}),
    )
    arq = FakeArq()

    asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    job_ids = {c[1]["_job_id"] for c in arq.calls}
    assert job_ids == {"reconcile:conn-a", "fx_reconcile:fx-a"}
    for _, kwargs in arq.calls:
        assert "_defer_by" in kwargs
        assert isinstance(kwargs["_defer_by"], timedelta)


def test_overflow_logged_as_warning_and_all_jobs_still_scheduled(monkeypatch, caplog):
    connections, accounts = _many_tl_connections(10)
    _patch_common(monkeypatch, connections=connections, accounts=accounts)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"std@example.com": Tier.STANDARD}),
    )
    # Force overflow with a tiny window relative to the candidate count.
    monkeypatch.setattr(sync_worker, "RECONCILE_MAX_PER_MINUTE", 40)
    monkeypatch.setattr(sync_worker, "RECONCILE_MIN_GAP_SECONDS", 2)
    monkeypatch.setattr(sync_worker, "RECONCILE_SPREAD_MINUTES", 0)  # 0-minute window: everything overflows but conn-0 (offset 0)
    arq = FakeArq()

    with caplog.at_level(logging.WARNING, logger="app.workers.sync_worker"):
        result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert len(arq.calls) == 10  # nothing dropped
    assert result["overflow"] == 9
    assert any("overflow" not in "" and "past the" in rec.message for rec in caplog.records)


def test_summary_doc_written_to_worker_runs_col(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-a", "user_id": "std@example.com", "last_synced": NOW - timedelta(hours=5),
         "access_token": "tok", "created_at": NOW - timedelta(days=1)},
    ])
    accounts = FakeCol([{"_id": "a1", "connection_id": "conn-a"}])
    worker_runs = FakeCol()
    _patch_common(monkeypatch, connections=connections, accounts=accounts, worker_runs=worker_runs)
    _patch_now(monkeypatch)
    monkeypatch.setattr(
        sync_worker, "get_subscription",
        _make_subscription_lookup({"std@example.com": Tier.STANDARD}),
    )
    arq = FakeArq()

    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))

    assert len(worker_runs.docs) == 1
    stored = worker_runs.docs[0]
    assert stored["_id"] == "task_reconcile_truelayer"
    assert stored["summary"]["reconciled"] == result["reconciled"]
    assert stored["summary"]["spread_minutes"] == result["spread_minutes"]
    assert stored["summary"]["overflow"] == result["overflow"]
