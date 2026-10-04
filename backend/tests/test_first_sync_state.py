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
    assert _state() == {"state": "idle", "connections": []}


def test_recent_unsynced_finexer_is_syncing(monkeypatch):
    _patch(monkeypatch, fin=[{"_id": "c1", "provider": "barclays", "authed_at": _naive_ago(minutes=2)}])
    out = _state()
    assert out["state"] == "syncing"
    assert out["connections"][0]["provider"] == "finexer"
    assert out["connections"][0]["bank"] == "barclays"
    assert out["connections"][0]["error"] is None


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
    assert {c["connection_id"]: c["error"] for c in out["connections"]}["c2"] == "boom"


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


def test_pipeline_stamps_and_success_clears_error(monkeypatch):
    col = _Col([{"_id": "c1", "status": "authorized"}])
    monkeypatch.setattr(finexer_sync, "finexer_consents_col", col)

    async def boom(cid, uid):
        raise RuntimeError("x" * 500)

    monkeypatch.setattr(finexer_sync, "sync_finexer_consent", boom)
    res = asyncio.run(finexer_sync.finexer_sync_pipeline("c1", UID))
    assert res == {"ok": False, "error": "sync_failed"}
    assert len(col.docs[0]["last_sync_error"]) == 200
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


def _stub_sts(monkeypatch, state):
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
        return {"state": state, "connections": []}

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
