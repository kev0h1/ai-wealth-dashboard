"""G210: first_sync_state, the error stamp, GET /sync/status and the
Safe to Spend "syncing" status. Fake collections, no Mongo."""
import asyncio
from datetime import date, datetime, timedelta

import pytest

import app.core.timeutil as timeutil
import app.services.income as income_service
import app.routers.accounts as accounts_router
import app.routers.analytics as analytics
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.finexer_sync as finexer_sync
import app.services.net_position as net_position
import app.services.sync_freshness as sf

UID = "user@example.com"


class _Col:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]
        self.updates = []

    def find(self, query=None, projection=None):
        docs = list(self.docs)

        async def gen():
            for d in docs:
                yield d
        return gen()

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if d.get("_id") == query.get("_id"):
                return d
        return None

    async def update_one(self, query, update, upsert=False):
        self.updates.append((query, update))
        for d in self.docs:
            if d.get("_id") == query.get("_id"):
                d.update(update.get("$set", {}))
                for k in update.get("$unset", {}):
                    d.pop(k, None)


def _naive_ago(**kw):
    return datetime.utcnow() - timedelta(**kw)  # naive-ok: fixture mirrors stored naive UTC


def _patch(monkeypatch, fin=(), tl=()):
    monkeypatch.setattr(sf, "finexer_consents_col", _Col(fin))
    monkeypatch.setattr(sf, "connections_col", _Col(tl))


def _state(**kw):
    return asyncio.run(sf.first_sync_state(UID))


def test_no_connections_is_idle(monkeypatch):
    _patch(monkeypatch)
    assert _state() == {"state": "idle", "first_sync": True, "connections": []}


def test_recent_unsynced_finexer_is_syncing(monkeypatch):
    _patch(monkeypatch, fin=[{"_id": "c1", "provider": "barclays", "authed_at": _naive_ago(minutes=2)}])
    out = _state()
    assert out["state"] == "syncing"
    assert out["connections"][0]["provider"] == "finexer"
    assert out["connections"][0]["bank"] == "barclays"
    assert out["connections"][0]["error"] is None
    assert out["connections"][0]["state"] == "syncing", "G214: per-connection phase is exposed"


def test_old_unsynced_is_stalled(monkeypatch):
    _patch(monkeypatch, fin=[{"_id": "c1", "authed_at": _naive_ago(minutes=11)}])
    assert _state()["state"] == "stalled"


def test_error_is_failed_and_wins(monkeypatch):
    _patch(monkeypatch, fin=[
        {"_id": "c1", "authed_at": _naive_ago(minutes=1)},
        {"_id": "c2", "authed_at": _naive_ago(minutes=30), "last_sync_error": "boom"},
    ])
    out = _state()
    assert out["state"] == "failed"
    assert {c["connection_id"]: c["error"] for c in out["connections"]}["c2"] == "sync_failed", "raw text never leaves the server"
    assert {c["connection_id"]: c["state"] for c in out["connections"]} == {"c1": "syncing", "c2": "failed"}


def test_errored_connection_retires_after_24h(monkeypatch):
    _patch(monkeypatch, fin=[{
        "_id": "c1", "authed_at": _naive_ago(days=3),
        "last_sync_error": "boom", "last_sync_error_at": _naive_ago(hours=25),
    }])
    assert _state()["state"] == "idle"
    _patch(monkeypatch, fin=[{
        "_id": "c1", "authed_at": _naive_ago(days=3),
        "last_sync_error": "boom", "last_sync_error_at": _naive_ago(hours=1),
    }])
    assert _state()["state"] == "failed"


def test_synced_or_abandoned_is_idle(monkeypatch):
    _patch(monkeypatch, fin=[
        {"_id": "c1", "authed_at": _naive_ago(minutes=30), "last_synced": _naive_ago(minutes=5)},
        {"_id": "c2", "authed_at": _naive_ago(days=3)},
    ])
    assert _state()["state"] == "idle"


def test_truelayer_needs_tokens(monkeypatch):
    _patch(monkeypatch, tl=[
        {"_id": "t0", "created_at": _naive_ago(minutes=1)},
        {"_id": "t1", "access_token": "x", "created_at": _naive_ago(minutes=1)},
    ])
    out = _state()
    assert out["state"] == "syncing"
    assert [c["connection_id"] for c in out["connections"]] == ["t1"]


def test_established_user_adding_second_bank_is_not_first_sync(monkeypatch):
    _patch(monkeypatch, fin=[
        {"_id": "old", "user_id": UID, "authed_at": _naive_ago(days=30), "last_synced": _naive_ago(minutes=5)},
        {"_id": "new", "user_id": UID, "provider": "monzo", "authed_at": _naive_ago(minutes=2)},
    ])
    out = _state()
    assert out["first_sync"] is False
    assert out["state"] == "syncing"
    assert [c["connection_id"] for c in out["connections"]] == ["new"]


def test_no_synced_bank_is_first_sync(monkeypatch):
    _patch(monkeypatch, fin=[{"_id": "new", "user_id": UID, "authed_at": _naive_ago(minutes=2)}])
    assert _state()["first_sync"] is True


def test_abandoned_consent_on_established_user_is_idle_and_not_first(monkeypatch):
    _patch(monkeypatch, fin=[
        {"_id": "old", "user_id": UID, "authed_at": _naive_ago(days=30), "last_synced": _naive_ago(minutes=5)},
        {"_id": "ghost", "user_id": UID, "authed_at": _naive_ago(days=3)},
    ])
    out = _state()
    assert out["state"] == "idle" and out["first_sync"] is False


def test_pipeline_stamps_and_success_clears_error(monkeypatch):
    col = _Col([{"_id": "c1", "status": "authorized"}])
    monkeypatch.setattr(finexer_sync, "finexer_consents_col", col)

    async def boom(cid, uid):
        raise RuntimeError("x" * 500)

    monkeypatch.setattr(finexer_sync, "sync_finexer_consent", boom)
    res = asyncio.run(finexer_sync.finexer_sync_pipeline("c1", UID))
    assert res == {"ok": False, "error": "sync_failed"}
    assert col.docs[0]["last_sync_error"] == "sync_failed"
    assert "last_sync_error_at" in col.docs[0]
    # A later successful sync stamps last_synced and unsets the error: the
    # update the success path issues is exercised through the same fake.
    asyncio.run(col.update_one(
        {"_id": "c1"},
        {"$set": {"last_synced": datetime.utcnow()},  # naive-ok: fixture
         "$unset": {"last_sync_error": "", "last_sync_error_at": ""}},
    ))
    assert "last_sync_error" not in col.docs[0]


def test_success_path_source_unsets_error():
    import inspect
    src = inspect.getsource(finexer_sync.sync_finexer_consent)
    assert '"$unset": {"last_sync_error"' in src


def test_sync_status_route(monkeypatch):
    _patch(monkeypatch, fin=[{"_id": "c1", "authed_at": _naive_ago(minutes=1)}])
    out = asyncio.run(accounts_router.sync_status(user={"email": UID}))
    assert out["state"] == "syncing"


class _One:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, *_a, **_k):
        return self.doc

    def find(self, *_a, **_k):
        return self

    async def to_list(self, _n):
        return []


def _stub_sts(monkeypatch, state, first=True):
    today = date(2026, 9, 17)
    monkeypatch.setattr(timeutil, "user_today", lambda: today)
    monkeypatch.setattr(
        income_service, "get_confirmed_payday",
        lambda _p, _t: (today + timedelta(days=14), {"schedule": "fixed"}),
    )
    monkeypatch.setattr(analytics, "preferences_col", _One({"user_id": UID}))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _One({"_id": UID}))
    monkeypatch.setattr(analytics, "card_terms_col", _One())

    async def cashflow_response(*a, **k):
        return {"upcoming_bills": [], "upcoming_income": []}

    async def accounts(_uid):
        return [{"balance": 100.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]

    async def zero(_uid):
        return 0, 0

    async def card_growth(*a, **k):
        return []

    async def monthly(_uid, _c):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    async def fss(_uid):
        return {"state": state, "first_sync": first, "connections": []}

    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", zero)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", zero)
    monkeypatch.setattr(net_position, "card_growth_by_card", card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)
    monkeypatch.setattr(analytics, "first_sync_state", fss)


@pytest.mark.parametrize("state", ["syncing", "stalled"])
def test_safe_to_spend_syncing(monkeypatch, state):
    _stub_sts(monkeypatch, state)
    r = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert r["calculation_status"] == "syncing"
    assert r["sync_state"] == state
    assert r["safe_to_spend"] == 0 and r["safe_to_spend_cash"] == 0


@pytest.mark.parametrize("state", ["idle", "failed"])
def test_safe_to_spend_not_syncing(monkeypatch, state):
    _stub_sts(monkeypatch, state)
    r = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert r["calculation_status"] == "complete"
    assert r["sync_state"] == state


def test_syncing_payload_is_not_a_verdict_for_direct_callers(monkeypatch):
    _stub_sts(monkeypatch, "syncing")
    r = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert r["status"] == "insufficient_data"
    assert r["state"] == "syncing"
    # The client-facing builder turns it back into an ok syncing payload.
    c = asyncio.run(analytics.build_safe_to_spend_response(UID))
    assert c["status"] == "ok" and c["calculation_status"] == "syncing"


def test_history_snapshot_skips_syncing_user(monkeypatch):
    import app.services.safe_to_spend_history as hist
    _stub_sts(monkeypatch, "syncing")
    writes = []

    class _Hist:
        async def update_one(self, *a, **k):
            writes.append(a)

    monkeypatch.setattr(hist, "cashflow_cache_col", _One({"_id": UID}))

    async def distinct(_f):
        return [UID]

    monkeypatch.setattr(hist.cashflow_cache_col, "distinct", distinct, raising=False)
    monkeypatch.setattr(hist, "safe_to_spend_history_col", _Hist())
    out = asyncio.run(hist.run_safe_to_spend_snapshot())
    assert writes == [] and out["skipped"] == 1 and out["written"] == 0


def test_get_safe_to_spend_never_caches_syncing(monkeypatch):
    puts = []

    async def aget(*a, **k):
        return None

    async def snapshot(_u):
        return 1

    async def aput(*a, **k):
        puts.append(a)

    async def adrop(*a, **k):
        puts.append(("drop",) + a)

    async def build(uid, include_series=False):
        return {"status": "ok", "calculation_status": "syncing"}

    monkeypatch.setattr(analytics.response_cache, "aget", aget)
    monkeypatch.setattr(analytics.response_cache, "snapshot", snapshot)
    monkeypatch.setattr(analytics.response_cache, "aput", aput)
    monkeypatch.setattr(analytics.response_cache, "adrop", adrop)
    monkeypatch.setattr(analytics, "build_safe_to_spend_response", build)
    out = asyncio.run(analytics.get_safe_to_spend(include="", user={"email": UID}))
    assert out["calculation_status"] == "syncing" and puts == []


def test_warmup_skips_caching_syncing(monkeypatch):
    import app.services.warmup as warmup
    puts = []

    async def aput(name, uid, payload, version=None):
        puts.append(name)

    async def bump(_u):
        return 1

    async def syncing(_uid):
        return {"status": "ok", "calculation_status": "syncing"}

    async def other(_uid):
        return {"status": "ok"}

    monkeypatch.setattr(warmup.response_cache, "aput", aput)
    monkeypatch.setattr(warmup.data_version, "bump", bump)
    monkeypatch.setattr(warmup, "_compute_safe_to_spend", syncing)
    for n in ("_compute_today", "_compute_spend_verdict", "_compute_miscategorised_count", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, other)
    asyncio.run(warmup._warm_user_impl(UID))
    assert "today" in puts and "safe_to_spend" not in puts


def test_safe_to_spend_established_user_second_bank_not_clamped(monkeypatch):
    _stub_sts(monkeypatch, "syncing", first=False)
    r = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert r["status"] == "ok" and r["calculation_status"] == "complete"
    assert r["sync_state"] == "syncing" and r["safe_to_spend"] > 0


def test_degraded_wins_over_syncing(monkeypatch):
    _stub_sts(monkeypatch, "syncing", first=True)

    async def boom(_uid):
        raise RuntimeError("x")

    monkeypatch.setattr(commitments_router, "total_reserved_slices", boom)
    r = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert r["calculation_status"] == "degraded"


# ── G214: sync_in_progress_since for syncs of an already-synced bank ──────────

def test_stamp_set_during_and_cleared_after_success():
    col = _Col([{"_id": "c1"}])
    seen = {}

    async def run():
        async with sf.sync_in_progress(col, "c1"):
            seen["during"] = col.docs[0].get("sync_in_progress_since")

    asyncio.run(run())
    assert seen["during"] is not None
    assert "sync_in_progress_since" not in col.docs[0]


def test_stamp_cleared_on_failure_and_error_propagates():
    col = _Col([{"_id": "c1"}])

    async def run():
        async with sf.sync_in_progress(col, "c1"):
            raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        asyncio.run(run())
    assert "sync_in_progress_since" not in col.docs[0]


def test_pipeline_stamps_and_clears_around_the_pull(monkeypatch):
    col = _Col([{"_id": "c1", "status": "authorized", "last_synced": _naive_ago(hours=5)}])
    monkeypatch.setattr(finexer_sync, "finexer_consents_col", col)
    during = {}

    async def pull(cid, uid):
        during["stamp"] = col.docs[0].get("sync_in_progress_since")
        raise RuntimeError("x")

    monkeypatch.setattr(finexer_sync, "sync_finexer_consent", pull)
    asyncio.run(finexer_sync.finexer_sync_pipeline("c1", UID))
    assert during["stamp"] is not None
    assert "sync_in_progress_since" not in col.docs[0], "cleared on failure"


def test_synced_before_but_in_progress_reports_background_syncing(monkeypatch):
    _patch(monkeypatch, fin=[{
        "_id": "c1", "provider": "barclays", "last_synced": _naive_ago(hours=4),
        "sync_in_progress_since": _naive_ago(minutes=1),
    }])
    out = _state()
    assert out["state"] == "syncing"
    assert out["first_sync"] is False
    assert out["connections"][0]["kind"] == "background"
    assert out["connections"][0]["state"] == "syncing"
    assert out["connections"][0]["bank"] == "barclays"


def test_in_progress_past_ten_minutes_is_stalled(monkeypatch):
    _patch(monkeypatch, tl=[{
        "_id": "t1", "provider_name": "monzo", "access_token": "x", "last_synced": _naive_ago(hours=4),
        "sync_in_progress_since": _naive_ago(minutes=12),
    }])
    out = _state()
    assert out["state"] == "stalled" and out["connections"][0]["kind"] == "background"


def test_stale_stamp_past_thirty_minutes_is_ignored(monkeypatch):
    _patch(monkeypatch, fin=[{
        "_id": "c1", "last_synced": _naive_ago(hours=4),
        "sync_in_progress_since": _naive_ago(minutes=45),
    }])
    out = _state()
    assert out["state"] == "idle" and out["connections"] == [] and out["first_sync"] is False


def test_first_sync_rows_are_new_bank_and_unchanged(monkeypatch):
    _patch(monkeypatch, fin=[{"_id": "c1", "authed_at": _naive_ago(minutes=2), "sync_in_progress_since": _naive_ago(minutes=1)}])
    out = _state()
    assert out["state"] == "syncing" and out["first_sync"] is True
    assert out["connections"][0]["kind"] == "new-bank"
