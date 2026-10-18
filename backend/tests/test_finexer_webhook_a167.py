"""A167: Finexer webhook hardening, dispatcher, idempotency, debounce,
polling safety net and API-call counter.

Provider-shape facts (event names, signature header and algorithm) are
ASSUMED pending Finexer's documentation (docs/ops/FINEXER_WEBHOOKS.md); these
tests pin the plumbing, not Finexer's real catalogue. The route function is
called directly with a fake Request and in-memory collections, same
convention as test_finexer_webhook.py.
"""
import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

import app.routers.webhooks as wh
import app.services.finexer_webhooks as fxw

SECRET = "path-secret"
SIGNING = "signing-secret"


class _Res:
    def __init__(self, i):
        self.inserted_id = i


class _Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.n = 0

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if k == "$or":
                if not any(_Col._match(d, sub) for sub in v):
                    return False
            elif isinstance(v, dict):
                dv = d.get(k)
                for op, ov in v.items():
                    if op == "$exists" and ((k in d) != ov):
                        return False
                    if op == "$lt" and not (dv is not None and dv < ov):
                        return False
                    if op == "$ne" and dv == ov:
                        return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return d
        return None

    async def insert_one(self, doc):
        doc = dict(doc)
        if doc.get("event_id") is not None and any(
            d.get("provider") == doc.get("provider") and d.get("event_id") == doc["event_id"]
            for d in self.docs
        ):
            raise DuplicateKeyError("dup")
        self.n += 1
        doc.setdefault("_id", f"e{self.n}")
        self.docs.append(doc)
        return _Res(doc["_id"])

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                for k in update.get("$unset") or {}:
                    d.pop(k, None)
                for k, v in (update.get("$inc") or {}).items():
                    d[k] = d.get(k, 0) + v
                return
        if upsert:
            nd = dict(filt)
            nd.update(update.get("$set") or {})
            for k, v in (update.get("$inc") or {}).items():
                nd[k] = nd.get(k, 0) + v
            self.docs.append(nd)

    async def count_documents(self, q, limit=None):
        return sum(1 for d in self.docs if self._match(d, q))


class _Req:
    def __init__(self, payload=None, headers=None, raw=None):
        self._raw = raw if raw is not None else json.dumps(payload).encode()
        self.headers = headers or {}

    async def body(self):
        return self._raw


def _signed(payload, secret=SIGNING, ts=None, tamper=False):
    raw = json.dumps(payload).encode()
    ts = ts or datetime.now(timezone.utc).isoformat()
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return _Req(raw=raw, headers={"fx-signature": f"t={ts};s={mac}"})


@pytest.fixture
def env(monkeypatch):
    consents = _Col([{"_id": "c1", "user_id": "u@example.com", "status": "authorized"}])
    events = _Col()
    runs = _Col()
    monkeypatch.setattr(wh, "FINEXER_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(wh, "FINEXER_WEBHOOK_SIGNING_SECRET", "")
    monkeypatch.setattr(wh, "finexer_consents_col", consents)
    monkeypatch.setattr(wh, "webhook_events_col", events)
    import app.db.collections as colls
    monkeypatch.setattr(colls, "worker_runs_col", runs)
    monkeypatch.setattr(wh._cfg, "FINEXER_WEBHOOK_DEBOUNCE_SECONDS", 30)
    calls = []

    async def fake_enqueue(task, **kw):
        calls.append({"task": task, **kw})

    claimed = set()

    async def fake_claim(consent_id, window):
        if consent_id in claimed:
            return False
        claimed.add(consent_id)
        return True

    async def fake_release(consent_id):
        claimed.discard(consent_id)

    monkeypatch.setattr(wh, "_enqueue", fake_enqueue)
    monkeypatch.setattr(wh, "_claim_debounce", fake_claim)
    monkeypatch.setattr(wh, "_release_debounce", fake_release)
    return {"consents": consents, "events": events, "runs": runs, "calls": calls, "claimed": claimed}


def _post(req):
    return asyncio.run(wh.finexer_webhook(SECRET, req))


# (h) a signed event triggers exactly one sync
def test_signed_event_triggers_exactly_one_sync(env, monkeypatch):
    monkeypatch.setattr(wh, "FINEXER_WEBHOOK_SIGNING_SECRET", SIGNING)
    payload = {"id": "evt_1", "type": "bank_account.synced", "consent_id": "c1"}
    assert _post(_signed(payload)) == {"ok": True}
    assert len(env["calls"]) == 1
    assert env["calls"][0]["task"] == "task_sync_finexer"
    assert env["calls"][0]["consent_id"] == "c1"
    assert "_defer_by" in env["calls"][0]
    assert env["consents"].docs[0]["last_webhook_at"] is not None


# (h) unsigned / bad signature rejected when a secret is set, generic 4xx
@pytest.mark.parametrize("make", [
    lambda: _Req({"id": "e", "type": "bank_account.synced", "consent_id": "c1"}),
    lambda: _Req({"id": "e", "type": "bank_account.synced", "consent_id": "c1"},
                 headers={"fx-signature": "garbage"}),
    lambda: _signed({"id": "e", "type": "bank_account.synced", "consent_id": "c1"}, secret="wrong"),
    lambda: _signed({"id": "e", "type": "bank_account.synced", "consent_id": "c1"},
                    ts=(datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()),
])
def test_unsigned_or_bad_signature_rejected_when_secret_set(env, monkeypatch, make):
    monkeypatch.setattr(wh, "FINEXER_WEBHOOK_SIGNING_SECRET", SIGNING)
    with pytest.raises(HTTPException) as exc:
        _post(make())
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"  # same text as a bad path secret
    assert env["calls"] == [] and env["events"].docs == []


def test_unset_signing_secret_keeps_path_secret_as_only_gate(env):
    assert _post(_Req({"id": "e1", "type": "bank_account.synced", "consent_id": "c1"})) == {"ok": True}
    assert len(env["calls"]) == 1


def test_signing_status_logged_once(caplog):
    fxw._signing_status_logged = False
    with caplog.at_level("WARNING", logger=fxw.logger.name):
        fxw.log_signing_status("")
        fxw.log_signing_status("")
    assert sum("not configured" in r.getMessage() for r in caplog.records) == 1
    assert "" not in [r.getMessage() for r in caplog.records]


# pluggable scheme + tolerance from config
def test_raw_hmac_scheme_with_timestamp_header():
    raw = b'{"a":1}'
    sig = hmac.new(b"k", raw, hashlib.sha256).hexdigest()
    now = datetime.now(timezone.utc)
    h = {"x-sig": "sha256=" + sig, "x-ts": str(int(now.timestamp()))}
    kw = dict(secret="k", scheme="raw_hmac_sha256", header_name="x-sig", timestamp_header="x-ts",
              tolerance_seconds=300)
    assert fxw.verify_signature(raw, h, **kw)
    assert not fxw.verify_signature(raw + b" ", h, **kw)
    assert not fxw.verify_signature(raw, {**h, "x-ts": str(int(now.timestamp()) - 1000)}, **kw)
    assert not fxw.verify_signature(raw, {"x-sig": h["x-sig"]}, **kw)  # missing timestamp
    assert not fxw.verify_signature(raw, h, **{**kw, "scheme": "nonsense"})
    assert not fxw.verify_signature(raw, h, **{**kw, "secret": ""})


# (b) duplicates ignored
def test_duplicate_event_id_ignored(env):
    payload = {"id": "evt_dup", "type": "bank_account.synced", "consent_id": "c1"}
    assert _post(_Req(payload)) == {"ok": True}
    env["claimed"].clear()  # even with the debounce window gone
    assert _post(_Req(payload)) == {"ok": True}
    assert len(env["calls"]) == 1
    assert len(env["events"].docs) == 1


def test_enqueue_failure_releases_event_id_so_retry_is_processed(env, monkeypatch):
    payload = {"id": "evt_r", "type": "bank_account.synced", "consent_id": "c1"}

    async def boom(task, **kw):
        raise RuntimeError("redis down")

    good = wh._enqueue
    monkeypatch.setattr(wh, "_enqueue", boom)
    with pytest.raises(HTTPException) as exc:
        _post(_Req(payload))
    assert exc.value.status_code == 503
    assert "event_id" not in env["events"].docs[0]
    # The failed enqueue released the debounce key and did not stamp freshness.
    assert env["claimed"] == set()
    assert "last_webhook_at" not in env["consents"].docs[0]
    monkeypatch.setattr(wh, "_enqueue", good)
    _post(_Req(payload))  # Finexer's retry, same event id
    assert len(env["calls"]) == 1
    assert env["calls"][0]["consent_id"] == "c1"
    assert env["consents"].docs[0]["last_webhook_at"] is not None


# (d) a burst coalesces
def test_burst_coalesces_into_one_sync(env):
    for i in range(6):
        _post(_Req({"id": f"evt_b{i}", "type": "bank_account.synced", "consent_id": "c1"}))
    assert len(env["calls"]) == 1
    statuses = sorted(d["status"] for d in env["events"].docs)
    assert statuses == ["coalesced"] * 5 + ["queued"]
    today = env["runs"].docs[0]
    assert today["webhook_syncs_enqueued"] == 1
    assert today["webhook_events_coalesced"] == 5


# (c) unknown types recorded and ignored, type only logged
def test_unknown_type_recorded_and_ignored_and_payload_not_logged(env, caplog):
    secret_marker = "ACCOUNT-NUMBER-12345678"
    payload = {"id": "evt_u", "type": "brand.new.thing", "consent_id": "c1", "iban": secret_marker}
    with caplog.at_level("INFO"):
        _post(_Req(payload))
    assert env["calls"] == []
    assert env["events"].docs[0]["status"] == "ignored"
    assert env["events"].docs[0]["action"] == "unknown"
    assert all(secret_marker not in r.getMessage() for r in caplog.records)
    assert any("brand.new.thing" in r.getMessage() for r in caplog.records)


def test_event_action_override_from_config(monkeypatch):
    monkeypatch.setattr(fxw.cfg, "FINEXER_WEBHOOK_EVENT_ACTIONS",
                        json.dumps({"Sync.Done": "sync_consent", "bad": "explode", "x": 5}))
    t = fxw.event_actions()
    assert fxw.resolve_action("sync.done", t) == "sync_consent"
    assert fxw.resolve_action("bad", t) == "unknown"
    assert fxw.resolve_action("bank_account.synced", t) == "sync_consent"
    monkeypatch.setattr(fxw.cfg, "FINEXER_WEBHOOK_EVENT_ACTIONS", "{not json")
    assert fxw.resolve_action("bank_account.synced", fxw.event_actions()) == "sync_consent"


def _consent_event(evt_id, typ, status, **extra):
    obj = {"id": "c1", "object": "consent", "customer": "cus_1", "status": status,
           "expiry_date": "2027-01-01T00:00:00Z", "metadata": {}, **extra}
    return {"id": evt_id, "object": "event", "created_at": "2026-10-18T12:00:00Z",
            "type": typ, "data": {"object": obj}}


def test_consent_expired_is_expiry_not_revocation(env, monkeypatch):
    expired = []

    async def fake_expired(cid):
        expired.append(cid)

    monkeypatch.setattr(wh, "_mark_accounts_expired", fake_expired)
    env["consents"].docs[0]["last_connection_nag"] = "yesterday"
    _post(_Req(_consent_event("evt_x1", "consent.expired", "expired")))
    c = env["consents"].docs[0]
    assert c["status"] == "expired" and c["status"] != "revoked"
    assert "revoked_at" not in c
    assert "last_connection_nag" not in c  # task_consent_watch will nag at next run
    assert c["expiry_date"] == datetime(2027, 1, 1)
    assert "status_changed_at" in c
    assert expired == ["c1"] and env["calls"] == []


def test_consent_authorized_maps_status_and_syncs(env):
    env["consents"].docs[0]["status"] = "pending"
    _post(_Req(_consent_event("evt_x2", "consent.authorized", "authorized")))
    assert env["consents"].docs[0]["status"] == "authorized"
    assert len(env["calls"]) == 1


def test_consent_canceled_revokes_and_created_is_record_only(env, monkeypatch):
    async def noop(cid):
        return None

    monkeypatch.setattr(wh, "_mark_accounts_expired", noop)
    _post(_Req(_consent_event("evt_x3", "consent.created", "pending")))
    assert env["consents"].docs[0]["status"] == "authorized"
    assert env["events"].docs[0]["status"] == "noted" and env["calls"] == []
    _post(_Req(_consent_event("evt_x4", "consent.canceled", "canceled")))
    assert env["consents"].docs[0]["status"] == "revoked"
    assert env["calls"] == []


def _account_event(evt_id, typ, consent=None):
    obj = {"id": "acc_1", "object": "bank_account"}
    if consent:
        obj["consent"] = consent
    return {"id": evt_id, "object": "event", "type": typ, "data": {"object": obj}}


def test_bank_account_synced_with_consent_reference(env):
    _post(_Req(_account_event("evt_a1", "bank_account.synced", consent="c1")))
    assert len(env["calls"]) == 1 and env["calls"][0]["consent_id"] == "c1"


def test_bank_account_synced_resolved_via_account_map(env, monkeypatch):
    monkeypatch.setattr(wh, "accounts_col", _Col([
        {"_id": "acc_1", "source": "finexer", "connection_id": "c1"}]))
    _post(_Req(_account_event("evt_a2", "bank_account.updated")))
    assert len(env["calls"]) == 1 and env["calls"][0]["consent_id"] == "c1"
    assert env["events"].docs[0]["consent_resolved_via"] == "account_map"


def test_bank_account_event_without_resolvable_consent_is_recorded_unresolved(env, monkeypatch):
    monkeypatch.setattr(wh, "accounts_col", _Col())
    assert _post(_Req(_account_event("evt_a3", "bank_account.synced"))) == {"ok": True}
    assert env["calls"] == []
    assert env["events"].docs[0]["status"] == "skipped"
    assert env["events"].docs[0]["skip_reason"] == "unresolved"


def test_bank_account_deleted_marks_tracked_account_closed(env, monkeypatch):
    accts = _Col([{"_id": "acc_1", "source": "finexer", "connection_id": "c1", "status": "connected"}])
    monkeypatch.setattr(wh, "accounts_col", accts)
    _post(_Req(_account_event("evt_a4", "bank_account.deleted")))
    assert "closed_at" in accts.docs[0] and accts.docs[0]["status"] == "connected"
    assert env["calls"] == []


def test_event_id_field_is_configurable(env, monkeypatch):
    monkeypatch.setattr(wh._cfg, "FINEXER_WEBHOOK_DEBOUNCE_SECONDS", 0)
    monkeypatch.setattr(fxw.cfg, "FINEXER_WEBHOOK_EVENT_ID_FIELD", "data.event_ref")
    p = {"type": "bank_account.synced", "consent_id": "c1", "data": {"event_ref": "r1"}}
    _post(_Req(p))
    _post(_Req(p))
    assert len(env["calls"]) == 1
    assert env["events"].docs[0]["event_id"] == "r1"


# (g) body size bound before read
def test_oversized_body_rejected_before_read(env, monkeypatch):
    monkeypatch.setattr(wh._cfg, "FINEXER_WEBHOOK_MAX_BODY_BYTES", 100)

    class Big(_Req):
        async def body(self):
            raise AssertionError("body must not be read when Content-Length is over the bound")

    with pytest.raises(HTTPException) as exc:
        _post(Big({"a": 1}, headers={"content-length": "101"}))
    assert exc.value.status_code == 413

    class Streamed:
        headers = {}

        async def stream(self):
            for _ in range(10):
                yield b"x" * 50

    with pytest.raises(HTTPException) as exc:
        _post(Streamed())
    assert exc.value.status_code == 413


def test_non_object_json_is_400(env):
    with pytest.raises(HTTPException) as exc:
        _post(_Req(raw=b"[1,2,3]"))
    assert exc.value.status_code == 400


# (e) polling falls back after 24 h; webhooks healthy means daily polling
def test_polling_safety_net_cadence():
    now = datetime(2026, 10, 18, 12, 0, 0)
    tier = timedelta(hours=3, minutes=30)
    due = lambda fx, w=tier: fxw.finexer_poll_due(fx, now, w, poll_hours=24, stale_hours=24)

    # Webhook seen 1h ago, synced 5h ago: webhooks are healthy, not polled.
    assert not due({"last_synced": now - timedelta(hours=5), "last_webhook_at": now - timedelta(hours=1)})
    # ...but still polled once a day as the safety net.
    assert due({"last_synced": now - timedelta(hours=24), "last_webhook_at": now - timedelta(hours=1)})
    # No webhook in 24h (or ever): back to the tier's own cadence.
    assert due({"last_synced": now - timedelta(hours=5), "last_webhook_at": now - timedelta(hours=25)})
    assert due({"last_synced": now - timedelta(hours=5)})
    assert not due({"last_synced": now - timedelta(hours=2)})
    # Never synced: always due. On-upload tier: never.
    assert due({"last_synced": None, "last_webhook_at": now})
    assert not due({"last_synced": None}, None)
    # poll_hours 0 restores legacy cadence even with a fresh webhook.
    assert fxw.finexer_poll_due(
        {"last_synced": now - timedelta(hours=5), "last_webhook_at": now}, now, tier,
        poll_hours=0, stale_hours=24,
    )


# (f) /ops/health summary
def test_webhook_health_summary(monkeypatch):
    now = datetime(2026, 10, 18, 12, 0, 0)
    consents = _Col([
        {"_id": "a", "status": "authorized", "last_webhook_at": now - timedelta(minutes=7)},
        {"_id": "b", "status": "authorized", "last_webhook_at": now - timedelta(hours=30)},
        {"_id": "c", "status": "authorized"},
        {"_id": "d", "status": "revoked"},
    ])

    class _Cur:
        def __init__(self, docs):
            self.docs = docs

        def sort(self, k, d):
            self.docs = sorted(self.docs, key=lambda x: x[k], reverse=d < 0)
            return self

        def limit(self, n):
            self.docs = self.docs[:n]
            return self

        def __aiter__(self):
            async def g():
                for x in self.docs:
                    yield x
            return g()

    consents.find = lambda q, p=None: _Cur([d for d in consents.docs if d.get("last_webhook_at")])
    runs = _Col([
        {"_id": "finexer_api_calls:2026-10-18", "requests": 12, "webhook_syncs_enqueued": 3},
        {"_id": "finexer_api_calls:2026-10-17", "requests": 90},
    ])
    import app.db.collections as colls
    monkeypatch.setattr(colls, "finexer_consents_col", consents)
    monkeypatch.setattr(colls, "worker_runs_col", runs)
    h = asyncio.run(fxw.webhook_health(now))
    assert h["minutes_ago"] == 7
    assert h["consents_without_webhook"] == 2
    assert h["line"] == "webhooks: last received 7 min ago, consents without webhook in 24h: 2"
    assert (h["api_calls_today"], h["api_calls_yesterday"], h["webhook_syncs_today"]) == (12, 90, 3)


# (h) API-call counter increments through the real _get
def test_api_call_counter_increments(monkeypatch):
    import app.services.finexer_sync as fs
    import app.db.collections as colls
    runs = _Col()
    monkeypatch.setattr(colls, "worker_runs_col", runs)

    class R:
        def __init__(self, code):
            self.status_code = code
            self.headers = {"Retry-After": "0"}

    class C:
        def __init__(self):
            self.q = [R(429), R(200)]

        async def get(self, url, params=None):
            return self.q.pop(0)

    resp = asyncio.run(fs._get(C(), "/x"))
    assert resp.status_code == 200
    doc = runs.docs[0]
    assert doc["_id"].startswith("finexer_api_calls:")
    assert doc["requests"] == 2 and doc["rate_limited"] == 1
