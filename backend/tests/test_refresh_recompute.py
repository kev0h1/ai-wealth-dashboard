"""G159: an explicit user refresh always recomputes the derived caches
(cashflow + money shape) even when the sync pulled zero new transactions;
the automatic reconcile keeps the `new_count > 0` gate, but also self-heals
a cache doc written by an older engine build. G177(a) is the same staleness
family seen from the reconcile side.

Every collection and every heavy collaborator is faked or monkeypatched on
the module-level name the code under test actually reads (the FakeCol
convention from tests/test_connections_list.py); nothing here touches the
real database. `compute_and_cache_cashflow` itself runs for real in the
sync_all test (with its pattern compute faked) so the assertion is the one
the backlog item asks for: cashflow_cache.computed_at moves on a refresh
with zero new transactions.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.accounts as accounts_router
import app.routers.analytics as analytics
import app.services.cashflow as cashflow_service
import app.services.categorisation as categorisation
import app.services.finexer_sync as finexer_sync
import app.services.manual_account_rules as manual_account_rules
import app.services.money_shape as money_shape
import app.services.warmup as warmup
import app.workers.sync_worker as sync_worker
from app.services import response_cache

UID = "g159-refresh-recompute@example.com"


# ── fakes ────────────────────────────────────────────────────────────────────

def _matches(doc: dict, filt: dict) -> bool:
    return all(doc.get(k) == v for k, v in (filt or {}).items())


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *_a, **_k):
        return self

    async def to_list(self, n=None):
        return list(self._docs)


class FakeCol:
    def __init__(self, docs=None):
        self.docs: dict = {d["_id"]: dict(d) for d in (docs or [])}

    def find(self, filt=None, proj=None):
        return _FakeCursor([dict(d) for d in self.docs.values() if _matches(d, filt)])

    async def find_one(self, filt=None, proj=None):
        for d in self.docs.values():
            if _matches(d, filt):
                return dict(d)
        return None

    async def count_documents(self, filt=None, limit=None):
        n = sum(1 for d in self.docs.values() if _matches(d, filt))
        return min(n, limit) if limit is not None else n

    async def distinct(self, field, filt=None):
        return sorted({d.get(field) for d in self.docs.values() if _matches(d, filt) and d.get(field)})

    async def update_one(self, filt, update, upsert=False):
        target = None
        for d in self.docs.values():
            if _matches(d, filt):
                target = d
                break
        if target is None:
            if not upsert:
                return
            target = dict(filt)
            self.docs[target["_id"]] = target
        target.update(update.get("$set") or {})
        for k in (update.get("$unset") or {}):
            target.pop(k, None)


async def _noop(*_a, **_k):
    return None


def _fresh_cashflow_doc(uid: str, *, engine_build: str, age: timedelta = timedelta(hours=1)) -> dict:
    return {
        "_id": uid,
        "computed_at": datetime.now() - age,
        "patterns_version": analytics.PATTERNS_VERSION,
        "engine_build": engine_build,
        "upcoming_bills": [],
    }


class _Spy:
    def __init__(self):
        self.calls: list = []

    async def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return {}


# ── shared patching for the API's sync_all ───────────────────────────────────

def _patch_sync_all(monkeypatch, cashflow_col: FakeCol, *, truelayer_new: int):
    async def fake_sync_connection(connection_id, user_id=None, from_date=None):
        return ["acc-1"], truelayer_new

    monkeypatch.setattr(accounts_router, "connections_col", FakeCol([{"_id": "conn-1", "user_id": UID}]))
    monkeypatch.setattr(accounts_router, "yapily_consents_col", FakeCol())
    monkeypatch.setattr(accounts_router, "_finexer_consents_col", FakeCol())
    monkeypatch.setattr(accounts_router, "sync_connection", fake_sync_connection)
    monkeypatch.setattr(accounts_router, "apply_rules_bulk", _noop)
    monkeypatch.setattr(accounts_router, "categorise_others_bg", _noop)
    monkeypatch.setattr(accounts_router, "apply_mirror_rules", _noop)
    monkeypatch.setattr(accounts_router, "settle_planned_expenses", _noop)
    monkeypatch.setattr(accounts_router, "cashflow_cache_col", cashflow_col)
    monkeypatch.setattr(response_cache, "ainvalidate", _noop)
    monkeypatch.setattr(response_cache, "invalidate", lambda *_a, **_k: None)
    monkeypatch.setattr(warmup, "warm_user", _noop)

    # compute_and_cache_cashflow runs for real; only its inputs are faked.
    async def fake_patterns(uid):
        return {"upcoming_bills": [], "recurring_spend": []}

    async def fake_monthly_cf(uid, cutoff):
        return {}

    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(analytics, "cashflow_cache_col", cashflow_col)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow", fake_monthly_cf)
    shape_spy = _Spy()
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", shape_spy)
    return shape_spy


async def _run_sync_all_and_settle():
    result = await accounts_router.sync_all(user={"email": UID})
    # _post_sync is fire-and-forget; wait for it (and anything it awaited).
    pending = list(accounts_router._background_tasks)
    if pending:
        await asyncio.gather(*pending)
    return result


# ── 1. explicit refresh, zero new transactions: must recompute ───────────────

def test_user_refresh_with_zero_new_transactions_bumps_computed_at(monkeypatch):
    """Kevin's 2026-09-24 report: two taps on Home's refresh after an engine
    fix merged, salary still missing. With no new transactions the old
    `if has_new:` guard skipped compute_and_cache_cashflow entirely, so
    cashflow_cache.computed_at stayed at its pre-deploy value."""
    from app.core.build import engine_build

    before = datetime.now() - timedelta(hours=3)
    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build(), age=timedelta(hours=3))])
    shape_spy = _patch_sync_all(monkeypatch, col, truelayer_new=0)

    asyncio.run(_run_sync_all_and_settle())

    doc = col.docs[UID]
    assert doc["computed_at"] > before + timedelta(hours=2, minutes=59), "computed_at did not advance on refresh"
    assert doc["engine_build"] == engine_build()
    assert doc["patterns_version"] == analytics.PATTERNS_VERSION
    assert doc.get("synced_at") is not None
    assert len(shape_spy.calls) == 1, "money shape must be recomputed on an explicit refresh too"


def test_user_refresh_recomputes_once_after_finexer_pull(monkeypatch):
    """A Finexer user: the pipeline started by sync_all must not race the
    single post-sync recompute. sync_all tells the pipeline not to recompute
    itself and waits for its pull before the one recompute runs, so a bill
    that Finexer just returned is inside the observed-match window."""
    from app.core.build import engine_build

    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build())])
    shape_spy = _patch_sync_all(monkeypatch, col, truelayer_new=0)
    monkeypatch.setattr(accounts_router, "_finexer_consents_col", FakeCol([{"_id": "cst-1", "user_id": UID, "status": "authorized"}]))

    order: list = []

    async def fake_pipeline(consent_id, user_id, **kwargs):
        order.append(("pipeline", kwargs))
        await asyncio.sleep(0.01)
        order.append(("pipeline_done", None))
        return {"ok": True, "accounts": 1, "new_transactions": 0}

    async def fake_patterns(uid):
        order.append(("recompute", None))
        return {"upcoming_bills": []}

    monkeypatch.setattr(accounts_router, "_finexer_sync_pipeline", fake_pipeline)
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)

    asyncio.run(_run_sync_all_and_settle())

    assert [o[0] for o in order] == ["pipeline", "pipeline_done", "recompute"]
    assert order[0][1] == {"trigger": "user", "recompute": False}
    assert len(shape_spy.calls) == 1


# ── 2. automatic reconcile, zero new transactions: gate stays ────────────────

def _patch_worker_task(monkeypatch, cashflow_col: FakeCol, *, new_count: int) -> _Spy:
    async def fake_sync_connection(connection_id, user_id=None, from_date=None):
        return ["acc-1"], new_count

    monkeypatch.setattr(sync_worker, "sync_connection", fake_sync_connection)
    monkeypatch.setattr(sync_worker, "apply_rules_bulk", _noop)
    monkeypatch.setattr(sync_worker, "categorise_others_bg", _noop)
    monkeypatch.setattr(sync_worker, "apply_mirror_rules", _noop)
    monkeypatch.setattr(sync_worker, "_warm_after_sync", _noop)
    spy = _Spy()
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)
    import app.services.derived_caches as derived_caches
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", cashflow_col)
    return spy


def test_auto_reconcile_with_zero_new_transactions_does_not_recompute(monkeypatch):
    """The 4-hourly cron enqueues task_sync_truelayer; with nothing new and a
    current cache doc, the ~1.3 s CPU recompute plus its Haiku call must not
    run for every user every four hours."""
    from app.core.build import engine_build

    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build())])
    spy = _patch_worker_task(monkeypatch, col, new_count=0)

    result = asyncio.run(sync_worker.task_sync_truelayer({}, "conn-1", UID))

    assert result == {"synced": 1, "new_transactions": 0}
    assert spy.calls == []


def test_auto_reconcile_with_new_transactions_recomputes(monkeypatch):
    from app.core.build import engine_build

    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build())])
    spy = _patch_worker_task(monkeypatch, col, new_count=3)

    asyncio.run(sync_worker.task_sync_truelayer({}, "conn-1", UID))

    assert len(spy.calls) == 1


def test_auto_reconcile_recomputes_a_doc_built_by_an_older_engine(monkeypatch):
    """Self-heal: if the worker's deploy-time pass missed a user (or a doc
    predates the stamp), the next reconcile tick recomputes it once even
    with zero new transactions. Cheap check, one projected find_one."""
    col = FakeCol([_fresh_cashflow_doc(UID, engine_build="deadbeef-older-build")])
    spy = _patch_worker_task(monkeypatch, col, new_count=0)

    asyncio.run(sync_worker.task_sync_truelayer({}, "conn-1", UID))

    assert len(spy.calls) == 1


def test_auto_reconcile_recomputes_when_no_cache_doc_exists(monkeypatch):
    spy = _patch_worker_task(monkeypatch, FakeCol(), new_count=0)

    asyncio.run(sync_worker.task_sync_truelayer({}, "conn-1", UID))

    assert len(spy.calls) == 1


# ── 3. Finexer pipeline carries the same trigger ─────────────────────────────

def _patch_finexer_pipeline(monkeypatch, cashflow_col: FakeCol, *, new_count: int) -> _Spy:
    async def fake_sync_consent(consent_id, user_id):
        return ["acc-1"], new_count

    monkeypatch.setattr(finexer_sync, "sync_finexer_consent", fake_sync_consent)
    monkeypatch.setattr(categorisation, "apply_rules_bulk", _noop)
    monkeypatch.setattr(categorisation, "categorise_others_bg", _noop)
    monkeypatch.setattr(manual_account_rules, "apply_rules", _noop)
    spy = _Spy()
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)
    import app.services.derived_caches as derived_caches
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", cashflow_col)
    return spy


def test_finexer_pipeline_user_trigger_recomputes_with_zero_new(monkeypatch):
    from app.core.build import engine_build

    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build())])
    spy = _patch_finexer_pipeline(monkeypatch, col, new_count=0)

    result = asyncio.run(finexer_sync.finexer_sync_pipeline("cst-1", UID, trigger="user"))

    assert result["ok"] is True
    assert len(spy.calls) == 1


def test_finexer_pipeline_auto_trigger_keeps_gate(monkeypatch):
    from app.core.build import engine_build

    col = FakeCol([_fresh_cashflow_doc(UID, engine_build=engine_build())])
    spy = _patch_finexer_pipeline(monkeypatch, col, new_count=0)

    asyncio.run(finexer_sync.finexer_sync_pipeline("cst-1", UID))

    assert spy.calls == []


def test_finexer_pipeline_recompute_false_defers_to_caller(monkeypatch):
    """sync_all owns the single recompute for a user refresh; the pipeline it
    starts must pull and categorise but leave the recompute to the caller."""
    spy = _patch_finexer_pipeline(monkeypatch, FakeCol(), new_count=5)

    result = asyncio.run(finexer_sync.finexer_sync_pipeline("cst-1", UID, trigger="user", recompute=False))

    assert result["new_transactions"] == 5
    assert spy.calls == []


# ── 4. deploy-time pass: recompute only what an older build produced ─────────

def test_startup_pass_recomputes_only_docs_from_older_builds(monkeypatch):
    import app.services.derived_caches as derived_caches
    from app.core.build import engine_build

    current, stale, missing = "a@example.com", "b@example.com", "c@example.com"
    col = FakeCol([
        _fresh_cashflow_doc(current, engine_build=engine_build()),
        _fresh_cashflow_doc(stale, engine_build="older-build"),
    ])
    txns = FakeCol([
        {"_id": 1, "user_id": current}, {"_id": 2, "user_id": stale}, {"_id": 3, "user_id": missing},
    ])
    spy = _Spy()
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", col)
    monkeypatch.setattr(derived_caches, "transactions_col", txns)
    monkeypatch.setattr(derived_caches, "_STARTUP_PAUSE_SECONDS", 0)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    summary = asyncio.run(derived_caches.refresh_stale_cashflow_caches(reason="test"))

    recomputed = sorted(c[0][0] for c in spy.calls)
    assert recomputed == [stale, missing]
    assert summary["users"] == 3
    assert summary["recomputed"] == 2
    assert summary["reason"] == "test"


def test_startup_pass_survives_one_user_failing(monkeypatch):
    import app.services.derived_caches as derived_caches

    a, b = "a@example.com", "b@example.com"
    txns = FakeCol([{"_id": 1, "user_id": a}, {"_id": 2, "user_id": b}])
    calls: list = []

    async def boom_then_ok(uid, *a_, **k_):
        calls.append(uid)
        if uid == a:
            raise RuntimeError("boom")

    monkeypatch.setattr(derived_caches, "cashflow_cache_col", FakeCol())
    monkeypatch.setattr(derived_caches, "transactions_col", txns)
    monkeypatch.setattr(derived_caches, "_STARTUP_PAUSE_SECONDS", 0)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", boom_then_ok)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    summary = asyncio.run(derived_caches.refresh_stale_cashflow_caches(reason="test"))

    assert calls == [a, b]
    assert summary["recomputed"] == 1
    assert summary["failed"] == 1


# ── 5. engine build stamp ────────────────────────────────────────────────────

def test_engine_build_prefers_explicit_env_override(monkeypatch):
    import app.core.build as build

    monkeypatch.setattr(build, "_cached", None)
    monkeypatch.setenv("ENGINE_BUILD_ID", "  build-42  ")
    assert build.engine_build() == "build-42"
    monkeypatch.setattr(build, "_cached", None)


def test_engine_build_is_stable_within_a_process(monkeypatch):
    import app.core.build as build

    monkeypatch.setattr(build, "_cached", None)
    monkeypatch.delenv("ENGINE_BUILD_ID", raising=False)
    first = build.engine_build()
    assert first and first == build.engine_build()
    monkeypatch.setattr(build, "_cached", None)
