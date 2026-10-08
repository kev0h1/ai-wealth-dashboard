"""G177: a sync that inserts or materially updates transactions marks the
user's cashflow cache stale (`dirty_since`), invalidates the response cache,
and the next recompute (auto reconcile or the next read) clears it; the
recompute write is a compare-and-swap on `computed_from` so an older task
can never overwrite a newer snapshot (G190's concern).

Everything is faked on the module-level names the code under test reads; no
real database is touched.
"""
import asyncio
from datetime import datetime, timedelta

import pytest
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import app.routers.analytics as analytics
import app.services.cashflow as cashflow_service
import app.services.derived_caches as derived_caches
import app.services.finexer_sync as finexer_sync
import app.services.money_shape as money_shape
import app.services.truelayer_sync as truelayer_sync
import app.workers.sync_worker as sync_worker
from app.core.build import engine_build
from app.services import response_cache

UID = "g177-staleness@example.com"


def _match(doc, filt):
    for k, v in (filt or {}).items():
        if k == "$or":
            if not any(_match(doc, sub) for sub in v):
                return False
        elif isinstance(v, dict) and any(op.startswith("$") for op in v):
            have = doc.get(k)
            for op, arg in v.items():
                if op == "$exists":
                    if (k in doc) != arg:
                        return False
                elif op == "$lte":
                    if have is None or not have <= arg:
                        return False
                else:
                    raise AssertionError(f"unsupported op {op}")
        elif doc.get(k) != v:
            return False
    return True


class FakeCol:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, filt=None, proj=None):
        for d in self.docs.values():
            if _match(d, filt):
                return dict(d)
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs.values():
            if _match(d, filt):
                d.update(update.get("$set") or {})
                for k in update.get("$unset") or {}:
                    d.pop(k, None)
                return
        if not upsert:
            return
        if filt["_id"] in self.docs:
            raise DuplicateKeyError("E11000 duplicate key")
        new = {"_id": filt["_id"]}
        new.update(update.get("$set") or {})
        self.docs[new["_id"]] = new

    async def find_one_and_update(self, filt, update, upsert=False, projection=None, return_document=None):
        assert return_document == ReturnDocument.BEFORE
        before = self.docs.get(filt["_id"])
        before = dict(before) if before else None
        if before is None:
            new = {"_id": filt["_id"]}
            new.update(update.get("$set") or {})
            new.update(update.get("$setOnInsert") or {})
            self.docs[filt["_id"]] = new
        else:
            self.docs[filt["_id"]].update(update.get("$set") or {})
        return before


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    derived_caches._last_user_recompute_started.clear()
    cache_col = FakeCol([{
        "_id": UID, "computed_at": datetime.now() - timedelta(hours=1),
        "patterns_version": analytics.PATTERNS_VERSION, "engine_build": engine_build(),
        "upcoming_bills": [],
    }])
    ainvalidated: list = []

    async def fake_ainvalidate(uid):
        ainvalidated.append(uid)

    computes: list = []

    async def fake_patterns(uid):
        computes.append(uid)
        return {"upcoming_bills": [], "recurring_spend": []}

    async def fake_monthly_cf(uid, cutoff):
        return {}

    async def noop(*_a, **_k):
        return None

    for mod in (analytics, derived_caches):
        monkeypatch.setattr(mod, "cashflow_cache_col", cache_col)
    monkeypatch.setattr(response_cache, "ainvalidate", fake_ainvalidate)
    monkeypatch.setattr(response_cache, "invalidate", lambda *_a, **_k: None)
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", fake_patterns)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow", fake_monthly_cf)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", noop)
    txn_col = FakeCol()
    monkeypatch.setattr(finexer_sync, "transactions_col", txn_col)
    monkeypatch.setattr(truelayer_sync, "transactions_col", txn_col)
    monkeypatch.setattr(finexer_sync, "replace_pending_for_account", noop)
    return {"cache": cache_col, "inval": ainvalidated, "computes": computes, "txns": txn_col}


def _fx_txn(txn_id="t1", amount=350.0, date="2026-09-25"):
    return {"id": txn_id, "amount": amount, "description": "K MONZO TEST STO", "date": date,
            "currency": "GBP", "type": "debit"}


def _pull(env, txns=None):
    return asyncio.run(finexer_sync._upsert_finexer_transactions(txns or [_fx_txn()], "acc-1", UID))


# 1. a pull that inserts marks stale, invalidates, and the next read recomputes
def test_pull_inserting_a_transaction_marks_stale_and_next_read_recomputes(_env, monkeypatch):
    new, _ = _pull(_env)
    assert len(new) == 1
    assert _env["cache"].docs[UID].get("dirty_since") is not None
    assert _env["inval"] == [UID], "response cache must be invalidated on stale"

    class _Stop(Exception):
        pass

    async def stop_here(cached, uid=None):
        # Everything after the recompute (response building) needs the real
        # DB; the recompute decision has already been made by this point.
        assert "dirty_since" not in cached, "the read served a dirty doc"
        raise _Stop

    monkeypatch.setattr(analytics, "_build_cashflow_response", stop_here)
    with pytest.raises(_Stop):
        asyncio.run(analytics.get_cashflow(user={"email": UID}))
    assert _env["computes"] == [UID], "the next read must recompute a dirty doc"
    assert "dirty_since" not in _env["cache"].docs[UID]


# 2. nothing new, nothing changed: no stamp, no recompute
def test_pull_with_nothing_new_does_not_mark_stale_or_recompute(_env):
    _pull(_env)
    asyncio.run(derived_caches.clear_dirty(UID, datetime.now() + timedelta(seconds=1)))
    _env["inval"].clear()
    new, _ = _pull(_env)  # identical re-pull
    assert new == []
    assert "dirty_since" not in _env["cache"].docs[UID]
    assert _env["inval"] == []
    res = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="auto"))
    assert res == {"recomputed": False, "reason": "unchanged"}
    assert _env["computes"] == []


def test_category_only_churn_is_not_a_change(_env):
    _pull(_env)
    asyncio.run(derived_caches.clear_dirty(UID, datetime.now() + timedelta(seconds=1)))
    _env["txns"].docs["t1"]["category"] = "Bills"  # categoriser rewrote it; not material
    _pull(_env)
    assert "dirty_since" not in _env["cache"].docs[UID]


def test_material_update_of_an_existing_row_marks_stale(_env):
    _pull(_env)
    asyncio.run(derived_caches.clear_dirty(UID, datetime.now() + timedelta(seconds=1)))
    new, _ = _pull(_env, [_fx_txn(amount=351.0)])  # same id, amount moved
    assert new == []
    assert _env["cache"].docs[UID].get("dirty_since") is not None


# 3. the webhook path (task_sync_finexer -> pipeline -> pull) marks stale
def test_webhook_sync_task_marks_stale(_env, monkeypatch):
    async def noop(*_a, **_k):
        return None

    async def fake_consent_sync(consent_id, user_id):
        new, _ = await finexer_sync._upsert_finexer_transactions([_fx_txn("w1")], "acc-1", user_id)
        return ["acc-1"], len(new)

    import app.services.categorisation as categorisation
    import app.services.manual_account_rules as mar
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_inprog(*_a, **_k):
        yield

    monkeypatch.setattr(finexer_sync, "sync_finexer_consent", fake_consent_sync)
    monkeypatch.setattr(finexer_sync, "sync_in_progress", fake_inprog)
    monkeypatch.setattr(categorisation, "apply_rules_bulk", noop)
    monkeypatch.setattr(categorisation, "categorise_others_bg", noop)
    monkeypatch.setattr(mar, "apply_rules", noop)
    monkeypatch.setattr(finexer_sync, "notify_after_sync", noop)
    monkeypatch.setattr(sync_worker, "open_banking_paused", noop)
    monkeypatch.setattr(sync_worker, "_enqueue_weekly_insight_refresh", noop)
    monkeypatch.setattr(sync_worker, "_warm_after_sync", noop)
    monkeypatch.setattr(sync_worker, "finexer_sync_pipeline", finexer_sync.finexer_sync_pipeline)
    # keep the stamp observable: record it at mark time, before the pipeline's own recompute clears it
    seen: list = []
    real_mark = derived_caches.mark_stale

    async def spy_mark(uid, **kw):
        await real_mark(uid, **kw)
        seen.append(dict(_env["cache"].docs[UID]).get("dirty_since"))

    monkeypatch.setattr(finexer_sync, "mark_stale", spy_mark)
    asyncio.run(sync_worker.task_sync_finexer({}, "cst-1", UID))
    assert len(seen) == 1 and seen[0] is not None
    assert _env["inval"][0] == UID


# 4. reconcile recomputes when dirty even with has_new false and a current build
def test_reconcile_recomputes_when_dirty_with_current_engine_build(_env):
    _env["cache"].docs[UID]["dirty_since"] = datetime.now() - timedelta(milliseconds=5)
    res = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="auto"))
    assert res == {"recomputed": True, "reason": "dirty"}
    assert _env["computes"] == [UID]
    assert "dirty_since" not in _env["cache"].docs[UID]


def test_dirty_beats_the_user_refresh_debounce(_env):
    asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))
    _env["cache"].docs[UID]["dirty_since"] = datetime.now() - timedelta(milliseconds=5)
    res = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=0, trigger="user"))
    assert res == {"recomputed": True, "reason": "dirty"}


def test_stamp_set_during_a_recompute_survives_it(_env, monkeypatch):
    async def patterns_then_new_sync(uid):
        _env["cache"].docs[uid]["dirty_since"] = datetime.now() + timedelta(milliseconds=50)
        return {"upcoming_bills": []}

    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns_then_new_sync)
    asyncio.run(analytics.compute_and_cache_cashflow(UID))
    assert _env["cache"].docs[UID].get("dirty_since") is not None, "a newer change must stay stale"


# 5. mark_stale invalidates the response cache (awaited) and never raises
def test_mark_stale_invalidates_response_cache(_env):
    asyncio.run(derived_caches.mark_stale(UID))
    assert _env["inval"] == [UID]


# 6. CAS: an older recompute cannot overwrite a newer category correction
def test_older_recompute_cannot_overwrite_a_newer_snapshot(_env, monkeypatch):

    async def run():
        gate = asyncio.Event()
        calls = {"n": 0}

        async def patterns(uid):
            calls["n"] += 1
            if calls["n"] == 1:
                # the OLD task: read the pre-correction data, then stall
                snapshot = {"upcoming_bills": [{"name": "M&S LOANS", "category": "Bills"}]}
                await gate.wait()
                return snapshot
            return {"upcoming_bills": [{"name": "M&S LOANS", "category": "Car finance"}]}

        monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns)
        old = asyncio.create_task(analytics.compute_and_cache_cashflow(UID, clear_ai_cache=False))
        await asyncio.sleep(0.01)
        await asyncio.sleep(0.01)  # distinct start stamps even at ms precision
        await analytics.compute_and_cache_cashflow(UID, clear_ai_cache=False)  # NEW, post-correction
        gate.set()
        await old

    asyncio.run(run())
    doc = _env["cache"].docs[UID]
    assert doc["upcoming_bills"][0]["category"] == "Car finance", "the stale task clobbered the correction"


def test_newer_recompute_still_overwrites_older(_env):
    asyncio.run(analytics.compute_and_cache_cashflow(UID, clear_ai_cache=False))
    first = _env["cache"].docs[UID]["computed_from"]
    import time; time.sleep(0.01)
    asyncio.run(analytics.compute_and_cache_cashflow(UID, clear_ai_cache=False))
    assert _env["cache"].docs[UID]["computed_from"] > first
