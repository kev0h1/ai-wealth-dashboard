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
import app.services.derived_caches as derived_caches
import app.workers.sync_worker as sync_worker
from app.services import response_cache

UID = "g159-refresh-recompute@example.com"


@pytest.fixture(autouse=True)
def _clear_user_refresh_debounce():
    """`derived_caches._last_user_recompute_started` is per-process, module-
    global state (deliberately, see its own comment) keyed by uid, and
    every test in this module shares UID. Without clearing it, whichever
    test happens to run first marks UID's debounce window and every later
    trigger="user"/new_count=0 case in the same pytest process reads as
    "debounced" purely from test ordering, not from anything the test
    itself set up."""
    derived_caches._last_user_recompute_started.clear()
    yield
    derived_caches._last_user_recompute_started.clear()


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


# ── 1b. debounce: a rapid second explicit refresh must not recompute twice ──
#
# Review finding: /accounts/sync has no per-user lock or debounce, and the
# frontend's own `setSyncing` guard releases as soon as the HTTP response
# returns — which is BEFORE `_post_sync` (and the recompute inside it) even
# starts running in the background — so a second tap a couple of seconds
# later reaches `_post_sync` a second time regardless of what the button
# shows on screen.

def test_second_user_refresh_inside_debounce_window_is_skipped(monkeypatch):
    from app.core.build import engine_build

    col = FakeCol([_fresh_cashflow_doc(UID, engine_build="older-build")])
    spy = _Spy()
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", col)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    first = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))
    second = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))

    assert first == {"recomputed": True, "reason": "user_refresh"}
    assert second == {"recomputed": False, "reason": "debounced"}
    assert len(spy.calls) == 1, "the second tap inside the window must not pay for a second recompute"


def test_user_refresh_outside_debounce_window_recomputes_again(monkeypatch):
    spy = _Spy()
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", FakeCol())
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))
    # Simulate the window having elapsed rather than sleeping the test.
    derived_caches._last_user_recompute_started[UID] -= (derived_caches.USER_REFRESH_DEBOUNCE_SECONDS + 1)
    result = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))

    assert result == {"recomputed": True, "reason": "user_refresh"}
    assert len(spy.calls) == 2


def test_user_refresh_debounce_does_not_swallow_real_new_transactions(monkeypatch):
    """The debounce only fires for a refresh whose OWN sync found nothing
    new. A second tap that landed genuinely new data must still recompute,
    even inside the window — otherwise a real bill lands and is not
    represented in the forecast until the window elapses, the exact class
    of staleness bug G159 itself fixed."""
    spy = _Spy()
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", FakeCol())
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))
    result = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=3, trigger="user"))

    assert result == {"recomputed": True, "reason": "user_refresh"}
    assert len(spy.calls) == 2


def test_debounce_is_per_user(monkeypatch):
    spy = _Spy()
    monkeypatch.setattr(derived_caches, "cashflow_cache_col", FakeCol())
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", spy)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))
    other = asyncio.run(derived_caches.recompute_derived_caches("someone-else@example.com", new_count=0, trigger="user"))

    assert other == {"recomputed": True, "reason": "user_refresh"}
    assert len(spy.calls) == 2


def test_sync_all_second_tap_inside_debounce_window_skips_the_recompute(monkeypatch):
    """End-to-end through the actual route: two POST /accounts/sync calls
    with nothing new, back to back, must only pay for one recompute."""
    col = FakeCol([_fresh_cashflow_doc(UID, engine_build="older-build")])
    shape_spy = _patch_sync_all(monkeypatch, col, truelayer_new=0)

    pattern_calls: list = []
    real_fake_patterns = analytics._compute_cashflow_patterns

    async def counting_patterns(uid):
        pattern_calls.append(uid)
        return await real_fake_patterns(uid)

    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", counting_patterns)

    asyncio.run(_run_sync_all_and_settle())
    asyncio.run(_run_sync_all_and_settle())

    assert len(pattern_calls) == 1, "second tap inside the debounce window must not recompute again"
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

    # Records the call AND writes the fresh stamp — the real
    # compute_and_cache_cashflow does both, and the startup pass's own
    # failed-counter fix (fix #4) re-reads this stamp after the call, so a
    # fake that only records without writing would misreport as a failure.
    async def fake_compute(uid_, *a_, **k_):
        await spy(uid_, *a_, **k_)
        col.docs.setdefault(uid_, {"_id": uid_})
        col.docs[uid_]["engine_build"] = engine_build()

    monkeypatch.setattr(derived_caches, "cashflow_cache_col", col)
    monkeypatch.setattr(derived_caches, "transactions_col", txns)
    monkeypatch.setattr(derived_caches, "_STARTUP_PAUSE_SECONDS", 0)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", fake_compute)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    summary = asyncio.run(derived_caches.refresh_stale_cashflow_caches(reason="test"))

    recomputed = sorted(c[0][0] for c in spy.calls)
    assert recomputed == [stale, missing]
    assert summary["users"] == 3
    assert summary["recomputed"] == 2
    assert summary["failed"] == 0
    assert summary["reason"] == "test"


def test_startup_pass_survives_one_user_failing(monkeypatch):
    from app.core.build import engine_build

    a, b = "a@example.com", "b@example.com"
    txns = FakeCol([{"_id": 1, "user_id": a}, {"_id": 2, "user_id": b}])
    col = FakeCol()
    calls: list = []

    async def boom_then_ok(uid, *a_, **k_):
        calls.append(uid)
        if uid == a:
            raise RuntimeError("boom")
        col.docs.setdefault(uid, {"_id": uid})
        col.docs[uid]["engine_build"] = engine_build()

    monkeypatch.setattr(derived_caches, "cashflow_cache_col", col)
    monkeypatch.setattr(derived_caches, "transactions_col", txns)
    monkeypatch.setattr(derived_caches, "_STARTUP_PAUSE_SECONDS", 0)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", boom_then_ok)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    summary = asyncio.run(derived_caches.refresh_stale_cashflow_caches(reason="test"))

    assert calls == [a, b]
    assert summary["recomputed"] == 1
    assert summary["failed"] == 1


def test_startup_pass_counts_a_silently_failed_compute_as_failed(monkeypatch):
    """`compute_and_cache_cashflow` (routers/analytics.py) catches every
    exception itself and only prints, by design, so a real compute failure
    never raises up to `refresh_stale_cashflow_caches` — before this fix,
    `recompute_derived_caches` returning `recomputed: True` was taken at
    face value and counted as a success even though no doc was ever
    written. The pass now re-reads the stamp after the call and counts a
    STILL-stale stamp as a failure."""
    uid = "silent-fail@example.com"
    col = FakeCol([_fresh_cashflow_doc(uid, engine_build="older-build")])
    txns = FakeCol([{"_id": 1, "user_id": uid}])

    async def swallows_and_writes_nothing(uid_, *_a, **_k):
        # Mirrors compute_and_cache_cashflow's own try/except: returns
        # normally, raises nothing, writes nothing.
        return None

    monkeypatch.setattr(derived_caches, "cashflow_cache_col", col)
    monkeypatch.setattr(derived_caches, "transactions_col", txns)
    monkeypatch.setattr(derived_caches, "_STARTUP_PAUSE_SECONDS", 0)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", swallows_and_writes_nothing)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", _noop)

    summary = asyncio.run(derived_caches.refresh_stale_cashflow_caches(reason="test"))

    assert summary["recomputed"] == 0
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


def test_engine_build_falls_back_to_the_source_hash_not_git(monkeypatch):
    """G159 review fix #2: `git rev-parse HEAD` (and, before that,
    RAILWAY_GIT_COMMIT_SHA) identified a moment the checkout was at, not a
    version of the backend's own code — on UAT, HEAD moves on every board
    commit and every frontend-only integrate, neither of which ever touches
    `backend/`. `_detect()` no longer calls git or reads
    RAILWAY_GIT_COMMIT_SHA at all; with no explicit override it always
    resolves to the content hash."""
    import app.core.build as build

    monkeypatch.setattr(build, "_cached", None)
    monkeypatch.delenv("ENGINE_BUILD_ID", raising=False)
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
    assert build.engine_build() == build._source_hash()
    monkeypatch.setattr(build, "_cached", None)


def test_engine_build_never_shells_out_to_git(monkeypatch):
    """The exact UAT incident the review cited: main advanced 70 commits,
    none touching backend/, between two worker starts, and `git rev-parse
    HEAD` moved anyway. `_detect()` must not call git at all any more, so
    no HEAD move — for any reason — can ever change the stamp. Counts calls
    rather than raising: the old `_detect()` wrapped its subprocess.run call
    in a bare `except Exception: pass`, which would have silently swallowed
    a raising fake and made a naive version of this test pass either way."""
    import subprocess
    import app.core.build as build

    calls: list = []
    real_run = subprocess.run

    def _counting_run(*a, **k):
        calls.append((a, k))
        return real_run(*a, **k)

    monkeypatch.setattr(build, "_cached", None)
    monkeypatch.delenv("ENGINE_BUILD_ID", raising=False)
    monkeypatch.setattr(subprocess, "run", _counting_run)
    assert build.engine_build() == build._source_hash()
    assert calls == [], "_detect() called subprocess.run — it must resolve from the source hash alone"
    monkeypatch.setattr(build, "_cached", None)


# ── 6. every writer of a cashflow_cache doc stamps engine_build ─────────────
#
# G159 review fix #5: compute_and_cache_cashflow was not the only writer.
# GET /cashflow's own cache-miss branch (a live compute-then-store) and
# Penny's _load_cashflow_cache (compute-on-miss, mirroring that same
# branch) both wrote a doc with no `engine_build` at all. An unstamped doc
# reads as "a different build" to cache_needs_recompute's "auto" self-heal
# check FOREVER, not just until the next real engine change — the next
# reconcile tick (and every one after it, until something else happens to
# rewrite the doc) would recompute a perfectly current forecast for no
# reason.

def test_get_cashflow_cache_miss_stamps_engine_build(monkeypatch):
    from app.core.build import engine_build

    uid = "cache-miss-cashflow@example.com"
    col = FakeCol()
    prefs = FakeCol([{"_id": uid, "user_id": uid, "pay_period_config": {"type": "calendar_month"}}])

    async def fake_patterns(uid_):
        return {"upcoming_bills": [], "recurring_income": []}

    async def fake_build_response(cached, uid=None):
        return {}

    async def fake_list_allocations(uid_):
        return []

    monkeypatch.setattr(analytics, "cashflow_cache_col", col)
    monkeypatch.setattr(analytics, "preferences_col", prefs)
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_build_response)
    import app.routers.allocations as allocations_router
    monkeypatch.setattr(allocations_router, "list_active_allocations", fake_list_allocations)

    asyncio.run(analytics.get_cashflow(user={"email": uid}))

    doc = col.docs[uid]
    assert doc["engine_build"] == engine_build()
    assert doc["patterns_version"] == analytics.PATTERNS_VERSION


def test_penny_load_cashflow_cache_miss_stamps_engine_build(monkeypatch):
    from app.core.build import engine_build
    import app.services.penny_tools as penny_tools

    uid = "cache-miss-penny@example.com"
    col = FakeCol()
    accounts = FakeCol([{"_id": "acc-1", "user_id": uid}])

    async def fake_patterns(uid_):
        return {"upcoming_bills": []}

    monkeypatch.setattr(penny_tools, "cashflow_cache_col", col)
    monkeypatch.setattr(penny_tools, "accounts_col", accounts)
    monkeypatch.setattr(penny_tools, "yapily_accounts_col", FakeCol())
    monkeypatch.setattr(penny_tools, "_compute_cashflow_patterns", fake_patterns)

    result = asyncio.run(penny_tools._load_cashflow_cache(uid))

    assert result["engine_build"] == engine_build()
    doc = col.docs[uid]
    assert doc["engine_build"] == engine_build()
