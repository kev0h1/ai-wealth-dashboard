"""A179: per-account refresh, and Finexer-side deletes of bank accounts and
customers. Finexer is mocked at the client level; no network, no real DB."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.routers.accounts as accounts_router
import app.services.account_refresh as ar
import app.services.finexer_sync as fs
import app.services.finexer_webhooks as fxw
import app.services.retention as retention
from tests.test_a176_bank_sync import (
    Col, Client, Resp, IDLE, RUNNING, _wire_sync, CONSENT, UID,
)
from tests.test_retention import (
    FakeCol, FakeFxClient, _patch_all_collections, _stub_cascade,
)


def _now():
    return datetime.utcnow()


class AccCol(Col):
    """a176's Col plus the update_one shape the refresh lock needs
    ($or, $lt, modified_count)."""

    class _Res:
        def __init__(self, n):
            self.modified_count = n

    @staticmethod
    def _m(d, q):
        for k, v in (q or {}).items():
            if k == "$or":
                if not any(AccCol._m(d, sub) for sub in v):
                    return False
            elif isinstance(v, dict) and "$lt" in v:
                if not (k in d and d[k] < v["$lt"]):
                    return False
            elif isinstance(v, dict) and "$exists" in v:
                if (k in d) != v["$exists"]:
                    return False
            elif isinstance(v, dict) and "$in" in v:
                if d.get(k) not in v["$in"]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        return next((dict(d) for d in self.docs if self._m(d, q)), None)

    async def count_documents(self, q=None, limit=None):
        return sum(1 for d in self.docs if self._m(d, q))

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._m(d, filt):
                d.update(update.get("$set") or {})
                for k in (update.get("$unset") or {}):
                    d.pop(k, None)
                return self._Res(1)
        if upsert:
            nd = {k: v for k, v in filt.items() if not k.startswith("$")}
            nd.update(update.get("$set") or {})
            self.docs.append(nd)
        return self._Res(0)


class TwoAccountClient(Client):
    async def get(self, url, params=None):
        if url == "/bank_accounts":
            return Resp(200, {"data": [
                {"id": "acc1", "class": "current", "provider": "monzo"},
                {"id": "acc2", "class": "current", "provider": "monzo"},
            ]})
        return await super().get(url, params)


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    bumps: list = []

    async def _noop(now=None, **kw):
        bumps.append(kw)
    monkeypatch.setattr(fxw, "bump_daily_counters", _noop)
    monkeypatch.setattr(accounts_router, "bump_daily_counters", _noop)
    monkeypatch.setattr(fs, "_auto_sync_warned", False)

    async def _bulk(*a, **k):
        return None
    for mod, name in (("app.services.categorisation", "apply_rules_bulk"),
                      ("app.services.categorisation", "categorise_others_bg"),
                      ("app.services.manual_account_rules", "apply_rules")):
        monkeypatch.setattr(f"{mod}.{name}", _bulk)

    async def _sleep(s):
        return None
    monkeypatch.setattr(fs.asyncio, "sleep", _sleep)

    async def _open(uid):
        return False
    monkeypatch.setattr(accounts_router, "open_banking_paused", _open)

    async def _no_throttle(uid, now=None):
        return 0
    monkeypatch.setattr(accounts_router.sync_throttle, "check_user_sync", _no_throttle)
    return bumps


@pytest.fixture
def recomputes(monkeypatch):
    calls: list = []

    async def _rc(uid):
        calls.append(uid)
    monkeypatch.setattr(ar, "_recompute", _rc)
    return calls


def _finexer_world(monkeypatch, acc_extra=None, client=None):
    acc = {"_id": "acc1", "user_id": UID, "connection_id": CONSENT, "finexer": True, "source": "finexer"}
    acc.update(acc_extra or {})
    accts = AccCol([acc, {"_id": "acc2", "user_id": UID, "connection_id": CONSENT, "finexer": True},
                    {"_id": "other", "user_id": "someone-else", "connection_id": "c9", "finexer": True}])
    consents = _wire_sync(monkeypatch, accts)
    consents.docs[0]["last_synced"] = _now() - timedelta(hours=3)  # an established consent
    monkeypatch.setattr(accounts_router, "accounts_col", accts)
    monkeypatch.setattr(ar, "accounts_col", accts)
    monkeypatch.setattr(ar, "finexer_consents_col", consents)
    c = client or TwoAccountClient(post_responses=[Resp(200, IDLE)], booked=[{"id": "t1"}])
    monkeypatch.setattr(fs, "_client", lambda: c)
    return accts, c


def _call(account_id, uid=UID):
    return asyncio.run(accounts_router.refresh_account(account_id, user={"email": uid}))


def test_refresh_happy_path_returns_synced_to_and_walks_only_that_account(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)
    out = _call("acc1")
    assert out["refreshed"] is True
    assert out["bank_synced_to"] == "2026-10-31T11:42:00Z"
    assert out["next_allowed_at"] is not None
    assert c.posts == [("/bank_accounts/acc1/sync", None)]
    walked = {u for u, _ in c.gets if "/transactions" in u}
    assert walked == {"/bank_accounts/acc1/transactions"}
    assert not any("acc2" in u for u, _ in c.gets)
    assert recomputes == [UID]
    assert "refresh_lock_until" not in next(d for d in accts.docs if d["_id"] == "acc1")


def test_within_the_hour_returns_next_allowed_at_and_makes_no_post(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch, {"bank_sync_requested_at": _now() - timedelta(minutes=10)})
    out = _call("acc1")
    assert out["refreshed"] is False
    assert out["next_allowed_at"] is not None
    assert "429" not in out["message"] and "once an hour" in out["message"]
    assert c.posts == [] and c.gets == [] and recomputes == []


def test_running_past_the_bound_still_fetches(monkeypatch, recomputes):
    c = TwoAccountClient(post_responses=[Resp(200, RUNNING)], sync_get_responses=[Resp(200, RUNNING)],
                         booked=[{"id": "t1"}])
    accts, c = _finexer_world(monkeypatch, client=c)
    out = _call("acc1")
    assert out["refreshed"] is True
    assert any(u == "/bank_accounts/acc1/transactions" for u, _ in c.gets)
    assert len([u for u, _ in c.gets if u.endswith("/sync")]) >= len(fs.BANK_SYNC_POLL_DELAYS)


def test_non_owner_and_unknown_get_404(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)
    for acc_id in ("other", "nope"):
        with pytest.raises(HTTPException) as e:
            _call(acc_id)
        assert e.value.status_code == 404
    assert c.posts == []


def test_unauthorised_consent_asks_to_reconnect_without_calling_finexer(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)
    ar.finexer_consents_col.docs[0]["status"] = "expired"
    out = _call("acc1")
    assert out["refreshed"] is False and out["message"] == ar.MSG_RECONNECT
    assert c.posts == [] and c.gets == []


def test_throttle_answers_plainly(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)

    async def _limited(uid, now=None):
        return 30
    monkeypatch.setattr(accounts_router.sync_throttle, "check_user_sync", _limited)
    out = _call("acc1")
    assert out["refreshed"] is False and out["next_allowed_at"] is not None
    assert out["message"] == "Refreshed less than a minute ago"
    assert c.posts == []


def test_one_refresh_per_account_at_a_time(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)
    assert asyncio.run(ar.claim_refresh("acc1", UID)) is True
    assert asyncio.run(ar.claim_refresh("acc1", UID)) is False
    out = _call("acc1")
    assert out["refreshed"] is False and out["in_progress"] is True
    assert c.posts == []
    asyncio.run(ar.release_refresh("acc1"))
    assert asyncio.run(ar.claim_refresh("acc1", UID)) is True
    # A stale claim expires.
    accts.docs[0]["refresh_lock_until"] = _now() - timedelta(seconds=1)
    assert asyncio.run(ar.claim_refresh("acc1", UID)) is True


def test_truelayer_branch_runs_the_connection_sync(monkeypatch, recomputes):
    tl = AccCol([{"_id": "tl1", "user_id": UID, "connection_id": "conn1"}])
    monkeypatch.setattr(accounts_router, "accounts_col", tl)
    monkeypatch.setattr(ar, "accounts_col", tl)
    monkeypatch.setattr(ar, "connections_col", Col([{"_id": "conn1", "user_id": UID}]))
    seen: list = []

    async def _sync(conn_id, uid, from_date=None):
        seen.append((conn_id, uid))
        return ["tl1"], 3
    monkeypatch.setattr("app.services.truelayer_sync.sync_connection", _sync)
    out = _call("tl1")
    assert seen == [("conn1", UID)]
    assert out["refreshed"] is True and out["next_allowed_at"] is not None
    assert set(out) >= {"refreshed", "bank_synced_to", "next_allowed_at"}
    assert recomputes == [UID]


def test_paused_plan_is_a_plain_answer(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)

    async def _paused(uid):
        return True
    monkeypatch.setattr(accounts_router, "open_banking_paused", _paused)
    out = _call("acc1")
    assert out["refreshed"] is False and out["paused"] is True and c.posts == []


def test_failed_refresh_never_leaks_and_frees_the_lock(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)

    async def _boom(*a, **k):
        raise RuntimeError("secret upstream text")
    monkeypatch.setattr(fs, "finexer_sync_pipeline", _boom)
    out = _call("acc1")
    assert out["refreshed"] is False and out["message"] == ar.MSG_FAILED
    assert "secret" not in str(out)
    assert asyncio.run(ar.claim_refresh("acc1", UID)) is True


# ── delete: bank account ──────────────────────────────────────────────────

class DelClient:
    def __init__(self, status=204, exc=None):
        self.status, self.exc, self.deletes = status, exc, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def delete(self, path):
        self.deletes.append(path)
        if self.exc:
            raise self.exc
        return Resp(self.status)


def _delete(account_id):
    async def go():
        out = await accounts_router.delete_account(account_id, user={"email": UID})
        await asyncio.gather(*list(accounts_router._background_tasks))
        return out
    return asyncio.run(go())


def _delete_world(monkeypatch, client):
    accts = AccCol([{"_id": "ba_acc1xyz", "user_id": UID, "connection_id": CONSENT, "finexer": True, "source": "finexer"},
                    {"_id": "acc2", "user_id": UID, "connection_id": CONSENT, "finexer": True}])
    consents = Col([{"_id": CONSENT, "user_id": UID, "status": "authorized"}])
    markers = FakeCol()
    order: list = []
    monkeypatch.setattr(accounts_router, "accounts_col", accts)
    monkeypatch.setattr(accounts_router, "_finexer_consents_col", consents)
    monkeypatch.setattr(accounts_router, "connections_col", Col([]))
    monkeypatch.setattr(accounts_router, "excluded_accounts_col", Col([]))
    monkeypatch.setattr(accounts_router, "yapily_accounts_col", Col([]))

    async def _cascade(uid, ids, **kw):
        order.append("local_delete")
        accts.docs[:] = [d for d in accts.docs if d["_id"] not in ids]
    monkeypatch.setattr(accounts_router, "cascade_account_deletion", _cascade)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    orig = client.delete

    async def _tracked(path):
        order.append("remote_delete")
        return await orig(path)
    client.delete = _tracked
    monkeypatch.setattr(fs, "_client", lambda: client)
    return markers, order


def test_account_delete_calls_finexer_after_the_local_delete(monkeypatch):
    c = DelClient(204)
    markers, order = _delete_world(monkeypatch, c)
    out = _delete("ba_acc1xyz")
    assert out == {"deleted": "ba_acc1xyz"}
    assert c.deletes == ["/bank_accounts/ba_acc1xyz"]
    assert order == ["local_delete", "remote_delete"]
    assert markers.docs == {}


def test_account_delete_failure_writes_a_marker_and_still_succeeds(monkeypatch):
    c = DelClient(500)
    markers, order = _delete_world(monkeypatch, c)
    out = _delete("ba_acc1xyz")
    assert out == {"deleted": "ba_acc1xyz"}
    m = markers.docs["bank_account:ba_acc1xyz"]
    assert m["kind"] == "bank_account" and m["resource_id"] == "ba_acc1xyz"
    assert m["last_error"] == "500" and m["attempts"] == 1
    assert UID not in str(m) and m["user_hash"] == retention._hash_uid(UID)


def test_account_delete_transport_error_marks_and_does_not_raise(monkeypatch):
    import httpx
    c = DelClient(exc=httpx.ReadTimeout("body"))
    markers, order = _delete_world(monkeypatch, c)
    _delete("ba_acc1xyz")
    assert markers.docs["bank_account:ba_acc1xyz"]["last_error"] == "ReadTimeout"


def test_delete_404_counts_as_gone_and_counters_are_bumped(monkeypatch, _quiet):
    c = DelClient(404)
    markers, order = _delete_world(monkeypatch, c)
    _delete("ba_acc1xyz")
    assert markers.docs == {}
    assert any(b.get("bank_account_deletes") == 1 for b in _quiet)


# ── erase: customers ──────────────────────────────────────────────────────

def _erase_world(monkeypatch, client, cache_doc=True):
    uid = "erase-a179@example.com"
    _stub_cascade(monkeypatch, [])
    consents = FakeCol([{"_id": "fx-cons-1", "user_id": uid, "status": "authorized", "customer_id": "cus_abc123"}])
    customers = FakeCol([{"_id": uid, "customer_id": "cus_abc123"}] if cache_doc else [])
    markers = FakeCol()
    order: list = []
    _patch_all_collections(monkeypatch, {
        "finexer_consents_col": consents, "finexer_customers_col": customers,
        "orphaned_revocations_col": markers,
    })
    for name, col in (("connections_col", FakeCol()), ("accounts_col", FakeCol()),
                      ("finexer_consents_col", consents), ("orphaned_revocations_col", markers)):
        monkeypatch.setattr(retention, name, col)

    class C(DelClient):
        async def post(self, path):
            order.append("revoke")
            return Resp(200, {"status": "canceled"})

        async def delete(self, path):
            order.append("customer_delete")
            self.deletes.append(path)
            if self.exc:
                raise self.exc
            return Resp(self.status)
    c = client or C(204)
    monkeypatch.setattr(fs, "_client", lambda: c)
    return uid, c, customers, markers, order


def test_erase_deletes_the_customer_after_the_revocations_and_clears_the_cache(monkeypatch):
    uid, c, customers, markers, order = _erase_world(monkeypatch, None)
    out = asyncio.run(retention.erase_user(uid))
    assert order == ["revoke", "customer_delete"]
    assert c.deletes == ["/customers/cus_abc123"]
    assert customers.docs == {} and markers.docs == {}
    assert out["finexer_customers_deleted"] == 1


def test_erase_customer_delete_failure_leaves_a_marker_and_still_erases(monkeypatch):
    class C500(DelClient):
        async def post(self, path):
            return Resp(200, {"status": "canceled"})
    uid, c, customers, markers, order = _erase_world(monkeypatch, C500(503))
    out = asyncio.run(retention.erase_user(uid))
    assert customers.docs == {}
    m = markers.docs["customer:cus_abc123"]
    assert m["kind"] == "customer" and m["last_error"] == "503"
    assert "finexer_customers_deleted" not in out


# ── retry sweep ───────────────────────────────────────────────────────────

def test_sweep_retries_deletion_markers_and_leaves_revoke_markers_alone(monkeypatch):
    now = datetime.utcnow()
    old = datetime.now(timezone.utc) - timedelta(days=1)
    markers = FakeCol([
        {"_id": "bank_account:ba_acc1xyz", "kind": "bank_account", "resource_id": "ba_acc1xyz", "failed_at": old, "attempts": 1},
        {"_id": "customer:cus_abc123", "kind": "customer", "resource_id": "cus_abc123", "failed_at": old, "attempts": 1},
        {"_id": "customer:cus_zzz999", "kind": "customer", "resource_id": "cus_zzz999", "failed_at": old, "attempts": 1},
        {"_id": "fx-revoke-1", "consent_id": "fx-revoke-1", "failed_at": old, "attempts": 1},
    ])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)

    class C(DelClient):
        async def delete(self, path):
            self.deletes.append(path)
            return Resp(500 if path.endswith("cus_zzz999") else 204)
    c = C()
    monkeypatch.setattr(fs, "_client", lambda: c)
    out = asyncio.run(retention.retry_orphaned_deletions(now))
    assert sorted(c.deletes) == ["/bank_accounts/ba_acc1xyz", "/customers/cus_abc123", "/customers/cus_zzz999"]
    assert out["deletions_cleared"] == 2 and out["deletions_still_pending"] == 1
    assert set(markers.docs) == {"customer:cus_zzz999", "fx-revoke-1"}
    assert markers.docs["customer:cus_zzz999"]["attempts"] == 2
    # The consent-revoke retry does not touch deletion markers.
    class RC(DelClient):
        async def post(self, path):
            return Resp(200, {"status": "canceled"})
    rc = RC()
    monkeypatch.setattr(fs, "_client", lambda: rc)
    asyncio.run(retention.retry_orphaned_revocations(now))
    assert "customer:cus_zzz999" in markers.docs and rc.deletes == []


def test_sweep_expires_a_deletion_marker_after_90_days(monkeypatch):
    ancient = datetime.now(timezone.utc) - timedelta(days=91)
    markers = FakeCol([{"_id": "bank_account:ba_acc1xyz", "kind": "bank_account", "resource_id": "ba_acc1xyz",
                        "failed_at": ancient, "attempts": 9}])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    c = DelClient()
    monkeypatch.setattr(fs, "_client", lambda: c)
    out = asyncio.run(retention.retry_orphaned_deletions(datetime.utcnow()))
    assert out["deletions_expired"] == 1 and markers.docs == {} and c.deletes == []


def test_malformed_ids_are_never_requested(monkeypatch):
    markers = FakeCol()
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    c = DelClient()
    monkeypatch.setattr(fs, "_client", lambda: c)
    assert asyncio.run(retention.delete_finexer_resource(UID, "bank_account", "../x")) == "bad_id"
    assert c.deletes == []


def test_a_throttled_tap_gives_the_lock_back_and_a_busy_tap_does_not_touch_the_throttle(monkeypatch, recomputes):
    accts, c = _finexer_world(monkeypatch)
    calls: list = []

    async def _limited(uid, now=None):
        calls.append(uid)
        return 30
    monkeypatch.setattr(accounts_router.sync_throttle, "check_user_sync", _limited)
    out = _call("acc1")
    assert out["message"] == "Refreshed less than a minute ago" and len(calls) == 1
    assert "refresh_lock_until" not in accts.docs[0], "throttled tap released the lock"
    # Busy: the lock is held, so the throttle is never consulted.
    assert asyncio.run(ar.claim_refresh("acc1", UID)) is True
    out = _call("acc1")
    assert out["in_progress"] is True and len(calls) == 1


def test_claim_is_owner_scoped(monkeypatch):
    accts, c = _finexer_world(monkeypatch)
    assert asyncio.run(ar.claim_refresh("acc1", "someone-else")) is False
    assert "refresh_lock_until" not in accts.docs[0]


def test_bad_id_writes_no_marker_and_logs_no_id(monkeypatch, caplog):
    import logging
    markers = FakeCol()
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(retention.delete_finexer_resource(UID, "customer", "x/../secret")) == "bad_id"
    assert markers.docs == {} and "secret" not in caplog.text


def test_slow_finexer_does_not_delay_the_users_delete(monkeypatch):
    gate = asyncio.Event()

    class Slow(DelClient):
        async def delete(self, path):
            await gate.wait()
            self.deletes.append(path)
            return Resp(204)
    c = Slow()
    markers, order = _delete_world(monkeypatch, c)

    async def go():
        out = await asyncio.wait_for(accounts_router.delete_account("ba_acc1xyz", user={"email": UID}), 2)
        assert out == {"deleted": "ba_acc1xyz"}
        gate.set()
        await asyncio.gather(*list(accounts_router._background_tasks))
    asyncio.run(go())
    assert c.deletes == ["/bank_accounts/ba_acc1xyz"]


# ── card balance shape log and health sign ────────────────────────────────

class CardClient(TwoAccountClient):
    async def get(self, url, params=None):
        if url == "/bank_accounts":
            return Resp(200, {"data": [{"id": "acc1", "class": "credit_card", "provider": "barclays"}]})
        if url.endswith("/balance"):
            return Resp(200, {"data": [{"type": "actual", "current": 446.01, "available": -1234.56}]})
        if url.endswith("/transactions") and (params or {}).get("status") != "pending":
            return Resp(200, {"data": [
                {"id": "t1", "amount": -12.5, "type": "debit"},
                {"id": "t2", "amount": 300.0, "type": "credit"},
                {"id": "t3", "amount": -3.0},
            ]})
        return await super().get(url, params)


def test_card_log_line_has_signs_and_counts_but_no_amounts_or_ids(monkeypatch, caplog):
    import logging
    c = CardClient(post_responses=[Resp(200, IDLE)])
    accts, c = _finexer_world(monkeypatch, client=c)
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        _call("acc1")
    line = next(r.getMessage() for r in caplog.records if "card balance shape" in r.getMessage())
    assert "class=credit_card" in line and "entry_type=actual" in line
    assert "current_sign=positive" in line and "available_sign=negative" in line
    assert "debit_rows=2" in line and "credit_rows=1" in line
    assert "available,current,type" in line
    for banned in ("446", "1234", "12.5", "300", "acc1", "t1", CONSENT, UID):
        assert banned not in line
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert d["card_current_sign"] == "positive" and d["card_available_sign"] == "negative"


def test_non_card_accounts_log_no_card_line_and_store_no_sign(monkeypatch, caplog):
    import logging
    accts, c = _finexer_world(monkeypatch)
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        _call("acc1")
    assert not any("card balance shape" in r.getMessage() for r in caplog.records)
    assert "card_current_sign" not in accts.docs[0]


def test_health_exposes_the_card_sign_only(monkeypatch):
    accts = Col([
        {"_id": "c1", "connection_id": "k1", "source": "finexer", "card_current_sign": "positive", "card_available_sign": "negative",
         "balance": 446.01},
        {"_id": "a1", "connection_id": "k1", "source": "finexer"},
    ])
    consents = Col([{"_id": "k1", "status": "authorized"}])
    monkeypatch.setattr("app.db.collections.accounts_col", accts)
    monkeypatch.setattr("app.db.collections.finexer_consents_col", consents)
    out = asyncio.run(fxw._compute_sync_health(datetime(2026, 11, 1, 12, 0, 0)))
    assert out["card_balance_signs"] == [{"current": "positive", "available": "negative"}]
    assert "446" not in str(out)
