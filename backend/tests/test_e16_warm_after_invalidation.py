"""E16: a genuine invalidation enqueues one worker warm for that user, a warm
never enqueues another, and the day-rollover cron warms only recently active
users at 00:05 London in both BST and GMT. All fakes; no database, queue or
model is touched."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import app.workers.queue as queue
import app.workers.sync_worker as sync_worker
from app.services import data_version, response_cache, warm_schedule, warmup
from tests.test_response_cache_v2 import FakeVersionCol

UID = "e16-warm@example.com"


def _run(coro):
    """Run `coro`, then drain the fire-and-forget warm enqueues it scheduled
    (they are background tasks on the same loop)."""
    async def go():
        out = await coro
        pending = list(data_version._background_tasks)
        if pending:
            await asyncio.gather(*pending)
        return out
    return asyncio.run(go())


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(data_version, "user_data_version_col", FakeVersionCol())
    data_version._memo.clear()
    queue.recorded_jobs.clear()
    warmup._inflight.clear()
    yield
    queue.recorded_jobs.clear()
    warmup._inflight.clear()


def _warm_jobs():
    return [(n, a, kw) for n, a, kw in queue.recorded_jobs if n == "task_warm_user"]


def test_bump_enqueues_one_deferred_warm():
    _run(data_version.bump(UID))
    jobs = _warm_jobs()
    assert len(jobs) == 1
    name, args, kw = jobs[0]
    assert args == (UID,)
    assert kw["_job_id"] == f"warm:{UID}"
    assert 0 < kw["_defer_by"] <= 10


def test_burst_of_bumps_enqueues_once(monkeypatch):
    """arq refuses a live job id; the fake pool honours that, so the burst
    lands as exactly one queued warm."""
    live: dict = {}

    class Pool:
        async def enqueue_job(self, name, *args, _job_id=None, **kw):
            if _job_id in live:
                return None
            live[_job_id] = (name, args, kw)
            return object()

    async def get_pool(*, shared=True):
        return Pool()

    monkeypatch.setattr(queue, "get_pool", get_pool)

    async def burst():
        for _ in range(5):
            await data_version.bump(UID)
        await response_cache.ainvalidate(UID)

    _run(burst())
    assert list(live) == [f"warm:{UID}"]


def test_invalidate_paths_all_go_through_bump():
    async def go():
        await response_cache.ainvalidate(UID)
        response_cache.invalidate(UID + ".sync")
        await asyncio.sleep(0.05)

    _run(go())
    ids = sorted(kw["_job_id"] for _n, _a, kw in _warm_jobs())
    assert ids == sorted([f"warm:{UID + '.sync'}", f"warm:{UID}"])


def test_warm_does_not_enqueue_another_warm(monkeypatch):
    async def fake(uid):
        # a compute step that invalidates, like a router that self-heals
        await response_cache.ainvalidate(uid)
        return {"status": "ok"}

    for n in ("_compute_today", "_compute_cover_plan", "_compute_safe_to_spend",
              "_compute_spend_verdict", "_compute_miscategorised_count",
              "_compute_miscategorised_list", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, fake)
    out = _run(warmup.warm_user(UID))
    assert not out["failed"]
    assert _warm_jobs() == []
    # the suppression is scoped to the warm: a later write enqueues again
    _run(data_version.bump(UID))
    assert len(_warm_jobs()) == 1


def test_failed_queue_never_fails_the_bump_and_resets_the_pool(monkeypatch):
    async def boom(*a, **k):
        raise ConnectionError("redis down")

    resets = []
    monkeypatch.setattr(queue, "enqueue", boom)
    monkeypatch.setattr(queue, "reset_pool", lambda: resets.append(1))
    assert _run(data_version.bump(UID)) == 1
    assert resets == [1]


def test_bump_returns_without_waiting_for_a_slow_enqueue(monkeypatch):
    state = {}

    async def slow(*a, **k):
        state["started"] = True
        await state["gate"].wait()

    monkeypatch.setattr(queue, "enqueue", slow)

    async def go():
        state["gate"] = asyncio.Event()
        v = await asyncio.wait_for(data_version.bump(UID), 0.5)   # would time out if awaited inline
        assert v == 1
        assert len(data_version._background_tasks) == 1
        state["gate"].set()
        await asyncio.gather(*list(data_version._background_tasks))
        assert state["started"]

    asyncio.run(go())


def test_bump_without_a_running_loop_context_is_a_noop_schedule():
    data_version._schedule_warm(UID)   # no loop: must not raise
    assert _warm_jobs() == []


def test_sync_task_internal_bump_enqueues_no_warm(monkeypatch):
    async def fake_sync(*a, **k):
        return ["x"], 0

    async def noop(*a, **k):
        return None

    async def bumping(*a, **k):
        await data_version.bump(UID)

    for name, fn in (("sync_connection", fake_sync), ("apply_rules_bulk", bumping),
                     ("categorise_others_bg", noop), ("apply_mirror_rules", noop),
                     ("_enqueue_weekly_insight_refresh", noop), ("_warm_after_sync", noop),
                     ("open_banking_paused", noop)):
        monkeypatch.setattr(sync_worker, name, fn)
    import app.services.derived_caches as dc
    monkeypatch.setattr(dc, "recompute_derived_caches", noop)
    _run(sync_worker.task_sync_truelayer({}, "conn", UID))
    assert _warm_jobs() == []
    # suppression ended with the task
    _run(data_version.bump(UID))
    assert len(_warm_jobs()) == 1


def test_worker_task_calls_warm_user_with_cover_plan(monkeypatch):
    calls = []

    async def fake_warm(uid, include_cover_plan=True):
        calls.append((uid, include_cover_plan))
        return {"warmed": ["today"], "failed": [], "version": 3}

    monkeypatch.setattr(warmup, "warm_user", fake_warm)

    async def same(uid, fresh=False):
        return 3

    monkeypatch.setattr(data_version, "current", same)
    out = _run(sync_worker.task_warm_user({}, UID))
    assert calls == [(UID, True)]
    assert out == {"warmed": 1, "failed": 0}
    assert _warm_jobs() == []


def test_worker_task_requeues_once_when_a_write_landed_mid_warm(monkeypatch):
    async def fake_warm(uid, include_cover_plan=True):
        return {"warmed": [], "failed": [], "version": 3}

    async def moved(uid, fresh=False):
        return 4

    monkeypatch.setattr(warmup, "warm_user", fake_warm)
    monkeypatch.setattr(data_version, "current", moved)
    _run(sync_worker.task_warm_user({}, UID))
    jobs = _warm_jobs()
    assert len(jobs) == 1 and jobs[0][2]["_job_id"] == f"warm:{UID}:again"
    queue.recorded_jobs.clear()
    _run(sync_worker.task_warm_user({}, UID, True))   # the follow-up never chains
    assert _warm_jobs() == []


def test_worker_registers_task_and_cron():
    ws = sync_worker.WorkerSettings
    names = {getattr(f, "name", getattr(f, "__name__", "")) for f in ws.functions}
    assert {"task_warm_user", "task_warm_rollover"} <= names
    assert any(c.name == "cron:task_warm_rollover" or "task_warm_rollover" in c.name
               for c in ws.cron_jobs)


@pytest.mark.parametrize("utc,expected", [
    (datetime(2026, 7, 14, 23, 5, tzinfo=timezone.utc), True),    # BST: 00:05 London
    (datetime(2026, 7, 15, 0, 5, tzinfo=timezone.utc), False),    # BST: 01:05 London
    (datetime(2026, 12, 15, 0, 5, tzinfo=timezone.utc), True),    # GMT: 00:05 London
    (datetime(2026, 12, 14, 23, 5, tzinfo=timezone.utc), False),  # GMT: 23:05 London
])
def test_rollover_runs_only_at_london_midnight(utc, expected, monkeypatch):
    seen = []

    async def fake(now_utc=None, **kw):
        seen.append(now_utc)
        return {"users": 0, "warmed": 0, "failed": 0}

    monkeypatch.setattr(warm_schedule, "warm_recent_users", fake)
    out = _run(sync_worker.task_warm_rollover({}, utc))
    assert bool(seen) is expected
    assert ("skipped" in out) is (not expected)


class _Col:
    def __init__(self, docs):
        self.docs = docs

    def find(self, filt, proj=None):
        async def gen():
            for d in self.docs:
                ok = all(
                    d.get(k) == v if not isinstance(v, dict) else (d.get(k) is not None and d[k] >= v["$gte"])
                    for k, v in filt.items()
                )
                if ok:
                    yield dict(d)
        return gen()


def test_rollover_selects_only_users_active_in_the_last_7_days(monkeypatch):
    from app.db import collections as cols
    now = datetime(2026, 12, 15, 0, 5, tzinfo=timezone.utc)
    recent = (now - timedelta(days=2)).replace(tzinfo=None)
    old = (now - timedelta(days=9)).replace(tzinfo=None)
    monkeypatch.setattr(cols, "user_profiles_col", _Col([
        {"_id": "seen@example.com", "last_active_at": recent},
        {"_id": "stale@example.com", "last_active_at": old},
        {"_id": "never@example.com"},
        {"_id": "not-a-person", "last_active_at": recent},
    ]))
    monkeypatch.setattr(cols, "connections_col", _Col([
        {"user_id": "tl@example.com", "last_synced": recent},
        {"user_id": "stale@example.com", "last_synced": old},
    ]))
    monkeypatch.setattr(cols, "finexer_consents_col", _Col([
        {"user_id": "fx@example.com", "status": "authorized", "last_synced": recent},
        {"user_id": "revoked@example.com", "status": "revoked", "last_synced": recent},
    ]))
    assert _run(warm_schedule.select_recent_users(now)) == [
        "fx@example.com", "seen@example.com", "tl@example.com"]


def test_rollover_warms_one_at_a_time_and_skips_failures(monkeypatch):
    order, active = [], []

    async def users(now_utc=None, days=7):
        return ["a@x", "b@x", "c@x"]

    async def fake_warm(uid, include_cover_plan=True):
        active.append(uid)
        assert len(active) == 1 and include_cover_plan is True
        await asyncio.sleep(0)
        order.append(uid)
        active.clear()
        if uid == "b@x":
            raise RuntimeError("boom")
        return {}

    monkeypatch.setattr(warm_schedule, "select_recent_users", users)
    monkeypatch.setattr(warmup, "warm_user", fake_warm)
    out = _run(warm_schedule.warm_recent_users(pause=0))
    assert order == ["a@x", "b@x", "c@x"]
    assert out == {"users": 3, "warmed": 2, "skipped": 0, "failed": 1}


def test_rollover_stops_at_the_time_budget(monkeypatch):
    now = [0.0]
    warmed = []

    async def users(now_utc=None, days=7):
        return ["a@x", "b@x", "c@x", "d@x"]

    async def fake_warm(uid, include_cover_plan=True):
        warmed.append(uid)
        now[0] += 300.0   # each warm takes 300 s on the fake clock
        return {}

    monkeypatch.setattr(warm_schedule, "select_recent_users", users)
    monkeypatch.setattr(warmup, "warm_user", fake_warm)
    out = asyncio.run(warm_schedule.warm_recent_users(pause=0, budget=500.0, clock=lambda: now[0]))
    assert warmed == ["a@x", "b@x"]
    assert out == {"users": 4, "warmed": 2, "skipped": 2, "failed": 0}


def test_rollover_orders_most_recent_activity_first(monkeypatch):
    from app.db import collections as cols
    now = datetime(2026, 12, 15, 0, 5, tzinfo=timezone.utc)
    t = lambda h: (now - timedelta(hours=h)).replace(tzinfo=None)
    monkeypatch.setattr(cols, "user_profiles_col", _Col([
        {"_id": "old@example.com", "last_active_at": t(100)},
        {"_id": "new@example.com", "last_active_at": t(1)},
    ]))
    monkeypatch.setattr(cols, "connections_col", _Col([
        {"user_id": "old@example.com", "last_synced": t(50)},
        {"user_id": "mid@example.com", "last_synced": t(10)},
    ]))
    monkeypatch.setattr(cols, "finexer_consents_col", _Col([]))
    assert asyncio.run(warm_schedule.select_recent_users(now)) == [
        "new@example.com", "mid@example.com", "old@example.com"]


def test_no_model_call_from_api_path():
    """Warm enqueue is an arq job only: the API process gate stays closed and
    the bump path never touches a model client."""
    from app.services import recurring_judge
    recurring_judge.forbid_model_calls()
    try:
        _run(data_version.bump(UID))
    finally:
        recurring_judge.allow_model_calls()
    assert [n for n, _a, _k in queue.recorded_jobs] == ["task_warm_user"]
