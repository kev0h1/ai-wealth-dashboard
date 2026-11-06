"""H148: no test can reach the shared arq/Redis queue.

The E18 enqueue helper leaked `recompute:<fake-uid>` jobs onto the live UAT
queue from the test suite. Every API-process enqueue now goes through
`app.workers.queue`, which hands tests a recording double. These tests patch
the real pool factory and arq's own `create_pool` to raise, then drive the
three request paths that enqueue, and assert nothing reached Redis and the
in-memory record received the jobs."""
import asyncio
import pathlib
import re
from datetime import datetime

import pytest

import app.routers.analytics as analytics
import app.services.derived_caches as derived_caches
import app.services.penny_tools as penny_tools
import app.workers.queue as queue
from app.services import response_cache
from tests.test_e18_cashflow_off_request_path import Col

UID = "h148-guard@example.com"
APP = pathlib.Path(analytics.__file__).resolve().parents[1]


@pytest.fixture
def guarded(monkeypatch):
    live_calls: list = []

    async def boom(*_a, **_k):
        live_calls.append(1)
        raise AssertionError("a test reached the real arq/Redis pool")

    import arq
    monkeypatch.setattr(queue, "_create_real_pool", boom)
    monkeypatch.setattr(arq, "create_pool", boom)
    monkeypatch.setattr(queue, "_pool", None)
    monkeypatch.setattr(derived_caches, "_enqueued_recently", {})
    monkeypatch.setattr(derived_caches, "_model_work_failed_at", {})
    queue.recorded_jobs.clear()

    cache = Col()

    async def fake_patterns(uid):
        return {"upcoming_bills": [], "recurring_spend": []}

    async def fake_build(cached, uid=None, prefs=None):
        return {"upcoming_bills": []}

    async def noop(*_a, **_k):
        return None

    async def fake_monthly_cf(uid, cutoff):
        return {}

    import app.services.cashflow as cashflow_service
    for mod in (analytics, derived_caches, penny_tools):
        monkeypatch.setattr(mod, "cashflow_cache_col", cache)
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(penny_tools, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_build)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", noop)
    monkeypatch.setattr(analytics, "_live_pool_balances", lambda a: {})
    monkeypatch.setattr(analytics, "_overlay_live_account_balances", lambda r, a: None)
    monkeypatch.setattr(analytics, "preferences_col", Col())
    monkeypatch.setattr(response_cache, "ainvalidate", noop)
    monkeypatch.setattr(response_cache, "invalidate", lambda *_a, **_k: None)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow", fake_monthly_cf)
    yield {"cache": cache, "live_calls": live_calls}
    queue.recorded_jobs.clear()


def _get():
    async def run():
        try:
            return await analytics.get_cashflow(user={"email": UID})
        except Exception as exc:  # the payday augmentation needs more of the DB than this fakes
            return exc
    return asyncio.run(run())


def _jobs():
    return [(n, kw.get("_job_id")) for n, _a, kw in queue.recorded_jobs]


def test_test_mode_is_detected():
    assert queue.is_test_process()


def test_dirty_doc_enqueues_into_the_record_only(guarded):
    guarded["cache"].docs[UID] = {
        "_id": UID, "computed_at": datetime.now(), "patterns_version": analytics.PATTERNS_VERSION,
        "upcoming_bills": [], "recurring_spend": [], "recurring_income": [],
        "dirty_since": datetime.now(),
    }
    _get()
    assert guarded["live_calls"] == []
    assert _jobs() == [("task_recompute_cashflow", f"recompute:{UID}")]


def test_missing_doc_enqueues_into_the_record_only(guarded):
    _get()
    assert guarded["live_calls"] == []
    assert _jobs() == [("task_recompute_cashflow", f"recompute:{UID}")]


def test_penny_cashflow_loader_enqueues_into_the_record_only(guarded, monkeypatch):
    class Found(Col):
        async def find_one(self, filt=None, proj=None):
            return {"_id": "x"}

    monkeypatch.setattr(penny_tools, "accounts_col", Found())
    asyncio.run(penny_tools._load_cashflow_cache(UID))
    assert guarded["live_calls"] == []
    assert _jobs() == [("task_recompute_cashflow", f"recompute:{UID}")]


def test_real_pool_is_never_built_in_test_mode(guarded):
    async def run():
        pool = await queue.get_pool()
        assert isinstance(pool, queue.RecordingPool)
        pool2 = await queue.get_pool(shared=False)
        assert isinstance(pool2, queue.RecordingPool)
        await queue.enqueue("task_sync_finexer", shared=False, consent_id="c", _defer_by=1)
    asyncio.run(run())
    assert guarded["live_calls"] == []
    assert queue.recorded_jobs[-1][0] == "task_sync_finexer"


def test_forbid_env_makes_the_real_factory_raise(monkeypatch):
    monkeypatch.setenv(queue.FORBID_ENV, "1")
    with pytest.raises(queue.LiveQueueForbidden):
        asyncio.run(queue._create_real_pool())


def test_no_module_enqueues_except_the_choke_point():
    """Static: API-process code calls `enqueue_job` only in app/workers/queue.py
    (worker-side code in app/workers uses the worker's own ctx["redis"])."""
    offenders = []
    for path in APP.rglob("*.py"):
        rel = path.relative_to(APP).as_posix()
        if rel == "workers/queue.py" or rel.startswith("workers/"):
            continue
        text = path.read_text()
        if re.search(r"\benqueue_job\b|\barq\s+import\s+create_pool|\bcreate_pool\s*\(", text):
            offenders.append(rel)
    assert offenders == [], f"enqueue/pool creation outside the choke point: {offenders}"
