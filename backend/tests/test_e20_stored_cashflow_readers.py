"""E20: at_risk_count and compute_today_items follow the E18 contract: a dirty,
old-version or model-work-pending doc is served as it stands and the worker
recompute is enqueued; only a missing doc computes (judge-free) and enqueues.
Everything is faked on module-level names; no database, queue or model."""
import asyncio
from datetime import datetime

import pytest

import app.routers.analytics as analytics
import app.services.companion as companion
import app.services.derived_caches as derived_caches
import app.services.recurring_judge as recurring_judge
from app.services import response_cache

UID = "e20-readers@example.com"


class Halt(Exception):
    """Raised by the faked response builder: the read under test is done."""


class Col:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, filt=None, proj=None):
        d = self.docs.get((filt or {}).get("_id"))
        return dict(d) if d else None

    async def update_one(self, filt, update, upsert=False):
        d = self.docs.setdefault(filt["_id"], {"_id": filt["_id"]})
        d.update(update.get("$set") or {})


class FakePool:
    def __init__(self):
        self.jobs: dict[str, tuple] = {}

    async def enqueue_job(self, name, _job_id=None, **kw):
        if _job_id in self.jobs:
            return None
        self.jobs[_job_id] = (name, kw)
        return object()


@pytest.fixture(autouse=True)
def _gate():
    recurring_judge.allow_model_calls()
    recurring_judge._pending_model_work.clear()
    yield
    recurring_judge.allow_model_calls()
    recurring_judge._pending_model_work.clear()


@pytest.fixture
def env(monkeypatch):
    cache = Col()
    pool = FakePool()
    computes: list = []
    seen: list = []

    async def fake_patterns(uid):
        computes.append(uid)
        return {"upcoming_bills": [], "recurring_spend": []}

    async def fake_build(cached, uid=None, prefs=None):
        seen.append(cached)
        raise Halt()

    async def noop(*_a, **_k):
        return None

    async def fake_pool():
        return pool

    async def fake_monthly_cf(uid, cutoff):
        return {}

    async def boom(*_a, **_k):
        raise AssertionError("model called from a request path")

    import app.services.cashflow as cashflow_service
    for mod in (analytics, derived_caches, companion):
        monkeypatch.setattr(mod, "cashflow_cache_col", cache)
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_build)
    monkeypatch.setattr(companion, "_build_cashflow_response", fake_build)
    monkeypatch.setattr(companion, "preferences_col", Col())
    monkeypatch.setattr(analytics, "preferences_col", Col())
    monkeypatch.setattr(response_cache, "ainvalidate", noop)
    monkeypatch.setattr(response_cache, "invalidate", lambda *_a, **_k: None)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow", fake_monthly_cf)
    monkeypatch.setattr(derived_caches, "_get_arq_pool", fake_pool)
    monkeypatch.setattr(derived_caches, "_enqueued_recently", {})
    monkeypatch.setattr(derived_caches, "_model_work_failed_at", {})
    monkeypatch.setattr(recurring_judge, "openrouter_chat", boom)
    monkeypatch.setattr(analytics, "openrouter_chat", boom)
    recurring_judge.forbid_model_calls()
    return {"cache": cache, "pool": pool, "computes": computes, "seen": seen}


def _doc(**extra):
    d = {"_id": UID, "computed_at": datetime.now(), "patterns_version": analytics.PATTERNS_VERSION,
         "upcoming_bills": [{"name": "Rent", "amount": 700.0}], "recurring_spend": []}
    d.update(extra)
    return d


def _at_risk():
    async def run():
        try:
            return await analytics.at_risk_count(user={"email": UID})
        except Halt:
            return "halted"
    return asyncio.run(run())


def _today():
    async def run():
        try:
            return await companion.compute_today_items(UID, persist=False)
        except Halt:
            return "halted"
    return asyncio.run(run())


READERS = [("at_risk_count", _at_risk), ("compute_today_items", _today)]
STALE = {
    "dirty": {"dirty_since": datetime.now()},
    "patterns_version": {"patterns_version": analytics.PATTERNS_VERSION - 1},
    "model_work": {"model_work_pending": True},
}


@pytest.mark.parametrize("name,reader", READERS)
@pytest.mark.parametrize("kind", list(STALE))
def test_stale_doc_is_served_unchanged_and_enqueues_once(env, name, reader, kind):
    stored = _doc(**STALE[kind])
    env["cache"].docs[UID] = dict(stored)
    assert reader() == "halted"
    assert reader() == "halted"
    assert env["computes"] == []
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]
    assert env["pool"].jobs[f"recompute:{UID}"][0] == "task_recompute_cashflow"
    # the figures the reader built from are the stored ones, untouched
    assert env["seen"] and all(s["upcoming_bills"] == stored["upcoming_bills"] for s in env["seen"])
    assert env["cache"].docs[UID].get("patterns_version") == stored["patterns_version"]


@pytest.mark.parametrize("name,reader", READERS)
def test_fresh_doc_enqueues_nothing(env, name, reader):
    env["cache"].docs[UID] = _doc()
    assert reader() == "halted"
    assert env["computes"] == [] and env["pool"].jobs == {}


@pytest.mark.parametrize("name,reader", READERS)
def test_missing_doc_computes_once_judge_free_and_enqueues(env, monkeypatch, name, reader):
    reader()
    assert env["computes"] == [UID]
    assert UID in env["cache"].docs
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]


def test_at_risk_count_returns_zero_when_even_the_compute_leaves_no_doc(env, monkeypatch):
    async def nothing(uid, clear_ai_cache=True):
        return False
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", nothing)
    assert _at_risk() == {"count": 0}


def test_today_items_survives_an_enqueue_failure(env, monkeypatch):
    env["cache"].docs[UID] = _doc(dirty_since=datetime.now())

    async def broken(uid, reason):
        raise RuntimeError("queue down")
    monkeypatch.setattr(derived_caches, "enqueue_cashflow_recompute", broken)
    assert _today() == "halted"


def test_missing_doc_with_owed_model_work_enqueues_as_model_work(env, monkeypatch):
    calls = []

    async def fake_compute(uid, clear_ai_cache=True):
        calls.append(clear_ai_cache)
        env["cache"].docs[uid] = _doc(model_work_pending=True)
        return True

    reasons = []

    async def fake_enqueue(uid, *, reason):
        reasons.append(reason)
        return True
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", fake_compute)
    monkeypatch.setattr(derived_caches, "enqueue_cashflow_recompute", fake_enqueue)
    assert _at_risk() == "halted"
    assert calls == [False]
    assert reasons == ["model_work"]


def test_missing_doc_without_owed_work_enqueues_as_no_cache(env, monkeypatch):
    reasons = []

    async def fake_enqueue(uid, *, reason):
        reasons.append(reason)
        return True
    monkeypatch.setattr(derived_caches, "enqueue_cashflow_recompute", fake_enqueue)
    _at_risk()
    assert reasons == ["no_cache"]
