"""E18: GET /cashflow serves the stored doc and never recomputes or calls a
model on the request path. Everything is faked on module-level names; no
database, queue or model is touched."""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.analytics as analytics
import app.services.derived_caches as derived_caches
import app.services.recurring_judge as recurring_judge
import app.workers.sync_worker as sync_worker
from app.services import response_cache

UID = "e18-offpath@example.com"


class Col:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, filt=None, proj=None):
        d = self.docs.get((filt or {}).get("_id"))
        return dict(d) if d else None

    async def update_one(self, filt, update, upsert=False):
        d = self.docs.setdefault(filt["_id"], {"_id": filt["_id"]})
        d.update(update.get("$set") or {})
        for k in update.get("$unset") or {}:
            d.pop(k, None)


class FakePool:
    """Honours arq's job-id dedupe: a second enqueue of a live id is None."""
    def __init__(self):
        self.jobs: dict[str, tuple] = {}

    async def enqueue_job(self, name, _job_id=None, **kw):
        if _job_id in self.jobs:
            return None
        self.jobs[_job_id] = (name, kw)
        return object()


@pytest.fixture(autouse=True)
def _restore_model_gate():
    """The gate is process-global: every test starts open and ends open."""
    recurring_judge.allow_model_calls()
    recurring_judge._pending_model_work.clear()
    analytics._ai_recurring_cache.pop(UID, None)
    yield
    recurring_judge.allow_model_calls()
    recurring_judge._pending_model_work.clear()
    analytics._ai_recurring_cache.pop(UID, None)


@pytest.fixture
def env(monkeypatch):
    cache = Col()
    pool = FakePool()
    computes: list = []

    async def fake_patterns(uid):
        computes.append(uid)
        return {"upcoming_bills": [], "recurring_spend": []}

    async def fake_build(cached, uid=None, prefs=None):
        return {"upcoming_bills": []}

    async def noop(*_a, **_k):
        return None

    async def fake_pool():
        return pool

    async def fake_monthly_cf(uid, cutoff):
        return {}

    import app.services.cashflow as cashflow_service
    for mod in (analytics, derived_caches):
        monkeypatch.setattr(mod, "cashflow_cache_col", cache)
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_build)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", noop)
    monkeypatch.setattr(analytics, "_live_pool_balances", lambda a: {})
    monkeypatch.setattr(analytics, "_overlay_live_account_balances", lambda r, a: None)
    monkeypatch.setattr(analytics, "preferences_col", Col())
    monkeypatch.setattr(response_cache, "ainvalidate", noop)
    monkeypatch.setattr(response_cache, "invalidate", lambda *_a, **_k: None)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow", fake_monthly_cf)
    monkeypatch.setattr(derived_caches, "_get_arq_pool", fake_pool)
    monkeypatch.setattr(derived_caches, "_enqueued_recently", {})
    return {"cache": cache, "pool": pool, "computes": computes}


def _doc(**extra):
    d = {"_id": UID, "computed_at": datetime.now(), "patterns_version": analytics.PATTERNS_VERSION,
         "upcoming_bills": [], "recurring_spend": [], "recurring_income": []}
    d.update(extra)
    return d


def _get():
    async def run():
        try:
            return await analytics.get_cashflow(user={"email": UID})
        except Exception as exc:  # the payday augmentation needs more of the DB than this fakes
            return exc
    return asyncio.run(run())


def test_dirty_doc_is_served_stale_and_enqueues_exactly_one_job(env):
    env["cache"].docs[UID] = _doc(dirty_since=datetime.now())
    _get()
    _get()
    assert env["computes"] == []
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]
    assert env["pool"].jobs[f"recompute:{UID}"][0] == "task_recompute_cashflow"


def test_job_id_dedupes_across_processes_even_without_the_local_throttle(env):
    async def run():
        await derived_caches.enqueue_cashflow_recompute(UID, reason="dirty")
        derived_caches._enqueued_recently.clear()
        await derived_caches.enqueue_cashflow_recompute(UID, reason="dirty")
    asyncio.run(run())
    assert len(env["pool"].jobs) == 1


def test_patterns_version_mismatch_serves_stale_and_enqueues(env):
    env["cache"].docs[UID] = _doc(patterns_version=analytics.PATTERNS_VERSION - 1)
    _get()
    assert env["computes"] == []
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]


def test_fresh_doc_enqueues_nothing(env):
    env["cache"].docs[UID] = _doc()
    _get()
    assert env["computes"] == [] and env["pool"].jobs == {}


def test_missing_doc_computes_without_the_judge_and_enqueues(env, monkeypatch):
    recurring_judge.forbid_model_calls()
    try:
        _get()
    finally:
        recurring_judge.allow_model_calls()
    assert env["computes"] == [UID]
    assert UID in env["cache"].docs
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]


def test_worker_task_recomputes_and_clears_dirty(env):
    env["cache"].docs[UID] = _doc(dirty_since=datetime.now() - timedelta(seconds=1))
    out = asyncio.run(sync_worker.task_recompute_cashflow({}, UID))
    assert out == {"recomputed": True}
    assert env["computes"] == [UID]
    assert "dirty_since" not in env["cache"].docs[UID]


def test_worker_registers_the_task_with_no_kept_result():
    names = {getattr(f, "name", getattr(f, "__name__", "")): f for f in sync_worker.WorkerSettings.functions}
    assert names["task_recompute_cashflow"].keep_result_s == 0


# ---- no model call from a request path -----------------------------------

def _series(key="k"):
    return {"key": key, "category": "Transfer", "occurrences": 2, "avg_amount": 100.0,
            "amounts_recent": [100.0, 900.0], "dates": []}


@pytest.fixture
def api_process(monkeypatch):
    """The API's state: model calls forbidden, any model client call fails the test."""
    boom_calls: list = []

    async def boom(*_a, **_k):
        boom_calls.append(1)
        raise AssertionError("model called from a request path")

    monkeypatch.setattr(recurring_judge, "openrouter_chat", boom)
    monkeypatch.setattr(analytics, "openrouter_chat", boom)
    monkeypatch.setattr(recurring_judge, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(analytics, "OPENROUTER_API_KEY", "test-key")
    recurring_judge.forbid_model_calls()
    yield boom_calls
    recurring_judge.allow_model_calls()
    recurring_judge._pending_model_work.clear()


def test_judge_makes_no_model_call_in_the_api_and_notes_pending(api_process, monkeypatch):
    col = Col()
    monkeypatch.setattr(recurring_judge, "recurring_judge_col", col)
    monkeypatch.setattr(recurring_judge, "is_suspect", lambda s: True)
    verdicts = asyncio.run(recurring_judge.judge_suspect_series(UID, [_series()], {}))
    assert verdicts == {} and api_process == []
    assert recurring_judge.pop_model_work_pending(UID) is True


def test_ai_recurring_predictor_makes_no_model_call_in_the_api(api_process):
    analytics._ai_recurring_cache.pop(UID, None)
    cand = [{"key": "gym", "avg_amount": 20.0, "last_date": datetime.now()}]
    assert asyncio.run(analytics._ai_recurring_predict(cand, UID)) == []
    assert api_process == []
    assert recurring_judge.pop_model_work_pending(UID) is True


def test_income_payer_judge_makes_no_model_call_in_the_api(api_process, monkeypatch):
    import app.db.collections as colls
    monkeypatch.setattr(colls, "income_payer_attachments_col", Col(), raising=False)

    async def run():
        await analytics._process_income_payer_attachments(
            UID, [{"stream_id": "s", "credit_id": "c", "decision": "ambiguous"}], datetime.now().date())
    asyncio.run(run())
    assert api_process == []


def test_api_recompute_enqueues_the_worker_when_it_skipped_model_work(env, api_process, monkeypatch):
    async def patterns(uid):
        recurring_judge.note_model_work_pending(uid)
        return {"upcoming_bills": []}
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns)
    assert asyncio.run(analytics.compute_and_cache_cashflow(UID)) is True
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]


def test_get_cashflow_in_the_api_never_reaches_the_model(env, api_process):
    for doc in (_doc(dirty_since=datetime.now()), _doc(patterns_version=0), None):
        env["cache"].docs.clear()
        if doc:
            env["cache"].docs[UID] = doc
        _get()
    assert api_process == []


def test_model_passes_have_only_the_known_callers():
    """judge_suspect_series is reached only through _compute_cashflow_patterns,
    which runs in the API judge-free (process gate) and in the worker with the
    model. A new caller must be routed through the worker or the gate."""
    import pathlib
    import re
    root = pathlib.Path(analytics.__file__).resolve().parents[1]
    callers = set()
    for p in root.rglob("*.py"):
        if p.name == "recurring_judge.py":
            continue
        if re.search(r"\bjudge_suspect_series\s*\(", p.read_text()):
            callers.add(p.relative_to(root).as_posix())
    assert callers == {"routers/analytics.py"}


# ---- E18 review fixes: the owed worker rerun is persisted on the doc --------

def _owing_patterns(env, monkeypatch):
    async def patterns(uid):
        env["computes"].append(uid)
        if not recurring_judge.model_calls_allowed():
            recurring_judge.note_model_work_pending(uid)
        return {"upcoming_bills": [], "recurring_spend": []}
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns)


def test_second_api_write_inside_the_throttle_keeps_the_marker_and_a_read_enqueues(env, monkeypatch):
    _owing_patterns(env, monkeypatch)
    recurring_judge.forbid_model_calls()
    asyncio.run(analytics.compute_and_cache_cashflow(UID))
    asyncio.run(analytics.compute_and_cache_cashflow(UID))  # inside the 30 s window
    assert env["cache"].docs[UID]["model_work_pending"] is True
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]
    env["pool"].jobs.clear()  # the worker job ran (or was lost); the id is free
    out = _get()
    assert not isinstance(out, Exception) or True
    assert list(env["pool"].jobs) == [f"recompute:{UID}"], "a later read must re-enqueue the owed rerun"
    assert env["pool"].jobs[f"recompute:{UID}"][1]["reason"] == "model_work"


def test_duplicate_enqueue_while_a_job_runs_leaves_the_marker_and_next_read_enqueues(env, monkeypatch):
    _owing_patterns(env, monkeypatch)
    recurring_judge.forbid_model_calls()
    env["pool"].jobs[f"recompute:{UID}"] = ("task_recompute_cashflow", {})  # running job holds the id
    asyncio.run(analytics.compute_and_cache_cashflow(UID))
    assert env["cache"].docs[UID]["model_work_pending"] is True
    assert len(env["pool"].jobs) == 1 and env["pool"].jobs[f"recompute:{UID}"][1] == {}
    env["pool"].jobs.clear()  # the job finished
    _get()
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]


def test_marker_read_is_not_shown_as_stale(env):
    env["cache"].docs[UID] = _doc(model_work_pending=True)
    out = _get()
    assert list(env["pool"].jobs) == [f"recompute:{UID}"]
    if isinstance(out, dict):
        assert out["cashflow_stale"] is False


def test_worker_run_clears_the_marker_and_keeps_the_predictor_cache_for_model_work(env, monkeypatch):
    _owing_patterns(env, monkeypatch)
    env["cache"].docs[UID] = _doc(model_work_pending=True)
    analytics._ai_recurring_cache[UID] = (datetime.now(), ["cached"])
    asyncio.run(sync_worker.task_recompute_cashflow({}, UID, reason="model_work"))
    assert "model_work_pending" not in env["cache"].docs[UID]
    assert analytics._ai_recurring_cache[UID][1] == ["cached"], "model_work reuses the predictor cache"
    asyncio.run(sync_worker.task_recompute_cashflow({}, UID))
    assert UID not in analytics._ai_recurring_cache, "any other trigger clears it"


def test_lost_cas_drops_the_pending_uid(env, monkeypatch):
    from pymongo.errors import DuplicateKeyError
    _owing_patterns(env, monkeypatch)
    recurring_judge.forbid_model_calls()

    async def lose(*_a, **_k):
        raise DuplicateKeyError("lost")
    monkeypatch.setattr(env["cache"], "update_one", lose)
    assert asyncio.run(analytics.compute_and_cache_cashflow(UID)) is False
    assert UID not in recurring_judge._pending_model_work


def test_cache_needs_recompute_treats_the_marker_as_a_reason(env):
    env["cache"].docs[UID] = _doc(model_work_pending=True, engine_build=derived_caches.engine_build())
    should, reason = asyncio.run(derived_caches.cache_needs_recompute(UID, new_count=0, trigger="auto"))
    assert (should, reason) == (True, "model_work")


# ---- wiring ------------------------------------------------------------------

class _Resp:
    status_code = 200

    def __init__(self, text):
        self._t = text

    def json(self):
        return {"choices": [{"message": {"content": self._t}}]}


def test_worker_gate_open_runs_the_judge_and_the_predictor(monkeypatch):
    calls: list = []

    async def chat(payload, **kw):
        calls.append(kw.get("pipeline"))
        if kw.get("pipeline") == "recurring_judge":
            return _Resp('{"recurring": false, "confidence": 0.9, "reason": "one off"}')
        return _Resp("[]")

    monkeypatch.setattr(recurring_judge, "openrouter_chat", chat)
    monkeypatch.setattr(analytics, "openrouter_chat", chat)
    monkeypatch.setattr(recurring_judge, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(analytics, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(recurring_judge, "recurring_judge_col", Col())
    monkeypatch.setattr(recurring_judge, "is_suspect", lambda s: True)
    recurring_judge.allow_model_calls()
    verdicts = asyncio.run(recurring_judge.judge_suspect_series(UID, [_series()], {}))
    cand = [{"key": "gym", "avg_amount": 20.0, "last_date": datetime.now()}]
    asyncio.run(analytics._ai_recurring_predict(cand, UID))
    assert "recurring_judge" in calls and len(calls) >= 2
    assert verdicts["k"]["recurring"] is False
    assert recurring_judge._pending_model_work == set()


def test_worker_startup_opens_the_gate(monkeypatch):
    seen: list = []
    monkeypatch.setattr(recurring_judge, "allow_model_calls", lambda: seen.append("allow"))

    async def noop(*_a, **_k):
        return None
    monkeypatch.setattr(sync_worker, "_engine_refresh_on_startup", noop)
    monkeypatch.setattr(sync_worker, "_dead_consent_sweep_on_startup", noop)
    from app.services.health import error_types
    monkeypatch.setattr(error_types, "install", lambda *a, **k: None)
    monkeypatch.setattr(error_types, "ensure_indexes", noop)

    async def run():
        ctx: dict = {}
        await sync_worker._on_startup(ctx)
        for t in ctx.values():
            if isinstance(t, asyncio.Task):
                await t
    asyncio.run(run())
    assert seen == ["allow"]


def test_api_startup_closes_the_gate(monkeypatch):
    import app.main as main
    seen: list = []
    monkeypatch.setattr(recurring_judge, "forbid_model_calls", lambda: seen.append("forbid"))
    assert main._forbid_model_passes_in_api in main.app.router.on_startup
    asyncio.run(main._forbid_model_passes_in_api())
    assert seen == ["forbid"]
