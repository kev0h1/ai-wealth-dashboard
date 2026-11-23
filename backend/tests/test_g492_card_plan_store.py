"""G492's stored-read boundary: all database and queue collaborators are fakes."""
import asyncio
import sys
import types
from datetime import date, datetime, timezone

import pytest

import app.services.card_plan_store as store
import app.workers.queue as queue
import app.workers.sync_worker as sync_worker


UID = "g492@example.com"


class _Result:
    def __init__(self, matched=0, upserted=None):
        self.matched_count = matched
        self.upserted_id = upserted


class _Col:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}
        self.replacements = []

    async def find_one(self, query, projection=None):
        return dict(self.docs[query["_id"]]) if query.get("_id") in self.docs else None

    async def replace_one(self, query, replacement, upsert=False):
        key = query["_id"]
        old = self.docs.get(key)
        allowed = old is None
        if old is not None:
            def matches(part):
                for key, wanted in part.items():
                    actual = old.get(key)
                    if isinstance(wanted, dict):
                        if "$exists" in wanted and (key in old) != wanted["$exists"]:
                            return False
                        if "$lt" in wanted and not (actual < wanted["$lt"]):
                            return False
                    elif actual != wanted:
                        return False
                return True
            allowed = any(matches(part) for part in query.get("$or", []))
        if not allowed:
            return _Result()
        self.docs[key] = dict(replacement)
        self.replacements.append(dict(replacement))
        return _Result(matched=1 if old else 0, upserted=None if old else key)

    async def distinct(self, key, query=None):
        if query and query.get("plan_kind") == "card_repayment":
            rows = [d for d in self.docs.values() if d.get("plan_kind") == "card_repayment" and d.get("status") == "active"]
        else:
            rows = self.docs.values()
        return [d.get(key) for d in rows]


@pytest.fixture(autouse=True)
def _fakes(monkeypatch):
    progress = _Col()
    versions = _Col([{"_id": UID, "version": 7}])
    commitments = _Col([{"_id": "plan", "user_id": UID, "plan_kind": "card_repayment", "status": "active"}])
    monkeypatch.setattr(store, "card_plan_progress_col", progress)
    monkeypatch.setattr(store, "user_data_version_col", versions)
    monkeypatch.setattr(store, "commitments_col", commitments)
    today = {"value": date(2026, 11, 23)}
    monkeypatch.setattr(store.timeutil, "user_today", lambda: today["value"])
    module = types.ModuleType("app.services.card_plan_progress")

    async def compute(uid, previous=None):
        assert uid == UID
        return {"plans": {"plan": {"marker": "stored"}}, "baselines": {}}

    module.compute_progress = compute
    monkeypatch.setitem(sys.modules, "app.services.card_plan_progress", module)
    return progress, versions, commitments, today, module


def _run(coro):
    return asyncio.run(coro)


def test_read_missing_is_pending_and_never_calculates(monkeypatch):
    calls = []

    async def queued(uid, **kwargs):
        calls.append((uid, kwargs))
        return True

    monkeypatch.setattr(store, "enqueue_refresh", queued)
    result = _run(store.read(UID))
    assert result == {"status": "pending", "as_of": None, "plans": {}}
    assert calls == [(UID, {})]


def test_read_stale_and_error_hide_old_facts(_fakes, monkeypatch):
    progress, _versions, _commitments, _today, _module = _fakes
    progress.docs[UID] = {
        "_id": UID, "status": "ok", "shape": store.SHAPE_VERSION,
        "input_version": 6, "as_of_day": "2026-11-23",
        "computed_at": datetime(2026, 11, 22, tzinfo=timezone.utc),
        "payload": {"plans": {"plan": {"marker": "old"}}},
    }
    queued = []

    async def enqueue(uid, **kwargs):
        queued.append(uid)
        return True

    monkeypatch.setattr(store, "enqueue_refresh", enqueue)
    stale = _run(store.read(UID))
    assert stale["status"] == "stale" and stale["plans"] == {}
    progress.docs[UID]["status"] = "error"
    unavailable = _run(store.read(UID))
    assert unavailable["status"] == "unavailable" and unavailable["plans"] == {}
    assert queued == [UID, UID]


def test_refresh_writes_only_current_version_and_day(_fakes):
    progress, _versions, _commitments, _today, _module = _fakes
    out = _run(store.refresh(UID))
    assert out["status"] == "ok"
    saved = progress.docs[UID]
    assert saved["input_version"] == 7
    assert saved["as_of_day"] == "2026-11-23"
    assert saved["payload"]["plans"]["plan"]["marker"] == "stored"
    read = _run(store.read(UID))
    assert read["status"] == "ok" and read["plans"] == saved["payload"]["plans"]


@pytest.mark.parametrize('bad_version', [True, -1, 7.5, '7'])
def test_malformed_version_is_unavailable_not_coerced_to_a_current_counter(_fakes, bad_version):
    _progress, versions, _commitments, _today, _module = _fakes
    versions.docs[UID]['version'] = bad_version
    result = _run(store.read(UID))
    assert result['status'] == 'unavailable' and result['plans'] == {}


def test_snapshot_needs_a_real_build_stamp_and_normalises_mongo_utc(_fakes, monkeypatch):
    progress, _versions, _commitments, _today, _module = _fakes

    async def enqueue(*args, **kwargs): return True
    monkeypatch.setattr(store, 'enqueue_refresh', enqueue)
    assert _run(store.refresh(UID))['status'] == 'ok'
    progress.docs[UID]['computed_at'] = datetime(2026, 11, 23, 10, 0)
    assert _run(store.read(UID))['as_of'] == '2026-11-23T10:00:00+00:00'
    del progress.docs[UID]['computed_at']
    result = _run(store.read(UID))
    assert result['status'] == 'stale' and result['plans'] == {}


def test_refresh_rejects_race_and_lower_version_writer(_fakes):
    progress, versions, _commitments, _today, module = _fakes

    async def races(uid, previous=None):
        versions.docs[UID]["version"] = 8
        return {"plans": {"plan": {}}, "baselines": {}}

    module.compute_progress = races
    assert _run(store.refresh(UID))["status"] == "superseded"
    assert progress.docs == {}

    versions.docs[UID]["version"] = 7
    progress.docs[UID] = {"_id": UID, "input_version": 8, "payload": {"plans": {}}, "status": "ok"}
    assert _run(store.refresh(UID))["status"] == "superseded"
    assert progress.docs[UID]["input_version"] == 8


def test_same_version_slow_success_and_error_cannot_overwrite_newer_build(_fakes, monkeypatch):
    progress, _versions, _commitments, _today, module = _fakes
    starts = iter((100, 200, 300, 400))
    monkeypatch.setattr(store.time, "time_ns", lambda: next(starts))
    first_started = asyncio.Event()
    release_first = asyncio.Event()
    calls = 0

    async def success_then_slow(uid, previous=None):
        nonlocal calls
        calls += 1
        if calls == 1:
            first_started.set()
            await release_first.wait()
            return {"plans": {"plan": {"writer": "slow"}}, "baselines": {}}
        return {"plans": {"plan": {"writer": "new"}}, "baselines": {}}

    module.compute_progress = success_then_slow

    async def run_success_race():
        slow = asyncio.create_task(store.refresh(UID))
        await first_started.wait()
        fast = await store.refresh(UID)
        release_first.set()
        return fast, await slow

    fast, slow = _run(run_success_race())
    assert fast["status"] == "ok" and slow["status"] == "superseded"
    assert progress.docs[UID]["payload"]["plans"]["plan"]["writer"] == "new"

    first_started = asyncio.Event()
    release_first = asyncio.Event()
    calls = 0
    progress.docs.clear()

    async def error_then_success(uid, previous=None):
        nonlocal calls
        calls += 1
        if calls == 1:
            first_started.set()
            await release_first.wait()
            raise RuntimeError("slow failure")
        return {"plans": {"plan": {"writer": "new"}}, "baselines": {}}

    module.compute_progress = error_then_success

    async def run_error_race():
        slow = asyncio.create_task(store.refresh(UID))
        await first_started.wait()
        fast = await store.refresh(UID)
        release_first.set()
        return fast, await slow

    fast, slow = _run(run_error_race())
    assert fast["status"] == "ok" and slow["status"] == "unavailable"
    assert progress.docs[UID]["status"] == "ok"
    assert progress.docs[UID]["payload"]["plans"]["plan"]["writer"] == "new"


def test_day_ordering_fence_rejects_an_older_day_at_same_version(_fakes):
    progress, _versions, _commitments, _today, _module = _fakes
    progress.docs[UID] = {
        "_id": UID, "input_version": 7, "as_of_day": "2026-11-24",
        "build_started_ns": 1_000, "status": "ok", "payload": {"plans": {}},
    }
    replacement = {"_id": UID, "input_version": 7, "as_of_day": "2026-11-23", "build_started_ns": 2_000}
    result = _run(progress.replace_one(store._write_filter(UID, 7, "2026-11-23", 2_000), replacement, upsert=True))
    assert result.matched_count == 0 and result.upserted_id is None
    assert progress.docs[UID]["as_of_day"] == "2026-11-24"


def test_enqueue_timeout_returns_false_without_inline_work(monkeypatch):
    gate = asyncio.Event()

    async def slow_enqueue(*args, **kwargs):
        await gate.wait()

    monkeypatch.setattr(queue, "enqueue", slow_enqueue)
    assert _run(store.enqueue_refresh(UID)) is False


def test_queue_task_and_relevant_user_rollover_are_worker_only(_fakes, monkeypatch):
    progress, _versions, commitments, _today, _module = _fakes
    progress.docs["old@example.com"] = {"_id": "old@example.com"}
    commitments.docs["other"] = {"_id": "other", "user_id": "other@example.com", "plan_kind": "card_repayment", "status": "active"}
    queue.recorded_jobs.clear()
    assert _run(store.enqueue_refresh(UID)) is True
    name, args, kwargs = queue.recorded_jobs[-1]
    assert (name, args, kwargs["_job_id"]) == (store.TASK_NAME, (UID, False), f"card-plan-progress:{UID}")

    queued = []

    async def enqueue(uid, **kwargs):
        queued.append(uid)
        return True

    monkeypatch.setattr(store, "enqueue_refresh", enqueue)
    london_midnight = datetime(2026, 11, 23, 0, 7, tzinfo=timezone.utc)
    out = _run(sync_worker.task_card_plan_progress_rollover({}, london_midnight))
    assert out["users"] == 3 and set(queued) == {UID, "old@example.com", "other@example.com"}
    assert any(
        getattr(f, "__name__", "") == "task_refresh_card_plan_progress"
        or getattr(f, "name", "") == "task_refresh_card_plan_progress"
        for f in sync_worker.WorkerSettings.functions
    )
