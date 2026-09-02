"""Tests for the Finexer webhook receiver in app.routers.webhooks
(POST /webhooks/finexer/{secret}).

Finexer's event catalogue isn't pinned down yet, so the route is
deliberately event-type-agnostic (see finexer_webhook()'s own docstring):
any event referencing a known consent triggers a sync, except a substring
sniff for revoked/declined/expired/cancel/disconnect wording which marks the
consent revoked instead.

Also covers signature verification (_verify_finexer_signature): Finexer signs
deliveries with an 'fx-signature' header ("t=<ISO8601>;s=<hex HMAC-SHA256 of
'<t>.<raw body>'"), which the route only enforces once
FINEXER_WEBHOOK_SIGNING_SECRET is configured (empty string = pre-registration
deploy state, verification skipped).

No mongomock is available in this environment (see test_allocations.py's own
note) — DB-touching collections are replaced with a tiny in-memory fake
collection, `_FakeCol`, local to this file, matching the convention already
established in test_penny_proposals.py. `_enqueue` (the arq pool helper) is
monkeypatched to a spy rather than actually touching Redis. The route
function is called directly (not via TestClient/HTTP) with a minimal fake
Request object exposing the async `.body()` and a plain-dict `.headers` the
route actually uses — matching how test_penny_proposals.py calls router
functions directly rather than going through the ASGI layer.
"""
import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.routers.webhooks as webhooks_module


class _FakeCol:
    """Stand-in for a Motor collection — find_one()/insert_one()/update_one()
    with exact-key-equality query matching, sufficient for everything this
    route does. Mirrors _FakeCol in test_penny_proposals.py."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self._next_id = 1

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        doc = dict(doc)
        doc.setdefault("_id", f"log{self._next_id}")
        self._next_id += 1
        self.docs.append(doc)
        return _InsertResult(doc["_id"])

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


class _InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class _FakeRequest:
    """Minimal stand-in for fastapi.Request — the route only ever awaits
    .body() and reads request.headers.get(...)."""

    def __init__(self, payload: dict, headers: dict | None = None):
        self._raw = json.dumps(payload).encode()
        self.headers = headers or {}

    async def body(self):
        return self._raw


class _RawBodyRequest:
    """For the invalid-JSON test — body isn't valid JSON at all."""

    def __init__(self, headers: dict | None = None):
        self.headers = headers or {}

    async def body(self):
        return b"not json{{{"


SECRET = "test-finexer-secret"
SIGNING_SECRET = "test-finexer-signing-secret"


def _setup(monkeypatch, consents=None, events=None, signing_secret=""):
    fake_consents = _FakeCol(consents or [])
    fake_events = _FakeCol(events or [])
    monkeypatch.setattr(webhooks_module, "FINEXER_WEBHOOK_SECRET", SECRET)
    # Default empty: signature verification off unless a test opts in, so it
    # doesn't depend on whatever's (or isn't) in the real config/env.
    monkeypatch.setattr(webhooks_module, "FINEXER_WEBHOOK_SIGNING_SECRET", signing_secret)
    monkeypatch.setattr(webhooks_module, "finexer_consents_col", fake_consents)
    monkeypatch.setattr(webhooks_module, "webhook_events_col", fake_events)
    return fake_consents, fake_events


def _sign(secret: str, ts: str, raw_body: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return f"t={ts};s={mac}"


def _spy_enqueue(monkeypatch):
    calls = []

    async def fake_enqueue(task, **kwargs):
        calls.append({"task": task, **kwargs})

    monkeypatch.setattr(webhooks_module, "_enqueue", fake_enqueue)
    return calls


# ── 1. Wrong secret → 401 ───────────────────────────────────────────────

def test_wrong_secret_returns_401(monkeypatch):
    _setup(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.finexer_webhook(
            "wrong-secret", _FakeRequest({"type": "probe", "consent_id": "c1"}),
        ))
    assert exc.value.status_code == 401


def test_invalid_json_returns_400(monkeypatch):
    _setup(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.finexer_webhook(SECRET, _RawBodyRequest()))
    assert exc.value.status_code == 400


# ── 2. Unknown consent_id → 200, event logged as skipped ────────────────

def test_unknown_consent_id_logged_as_skipped(monkeypatch):
    fake_consents, fake_events = _setup(monkeypatch)
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": "probe", "consent_id": "nonexistent"}),
    ))

    assert result == {"ok": True}
    assert calls == []
    assert len(fake_events.docs) == 1
    assert fake_events.docs[0]["status"] == "skipped"
    assert fake_events.docs[0]["skip_reason"] == "consent_not_found"
    assert fake_events.docs[0]["provider"] == "finexer"
    assert fake_events.docs[0]["consent_id"] == "nonexistent"


def test_no_resolvable_consent_id_logged_as_skipped(monkeypatch):
    fake_consents, fake_events = _setup(monkeypatch)
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": "probe"}),
    ))

    assert result == {"ok": True}
    assert calls == []
    assert fake_events.docs[0]["status"] == "skipped"
    assert fake_events.docs[0]["skip_reason"] == "no consent_id"


# ── 3. Known consent + arbitrary event type → sync enqueued ─────────────

def test_known_consent_arbitrary_event_type_enqueues_sync(monkeypatch):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c1", "user_id": "kevin@example.com", "status": "authorized"}],
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": "some.unknown.event", "consent_id": "c1"}),
    ))

    assert result == {"ok": True}
    assert len(calls) == 1
    assert calls[0] == {"task": "task_sync_finexer", "consent_id": "c1", "user_id": "kevin@example.com"}
    assert fake_events.docs[0]["status"] == "queued"
    assert fake_events.docs[0]["user_id"] == "kevin@example.com"
    assert fake_events.docs[0]["resolved_consent_id"] == "c1"
    # Consent doc itself must be untouched by a non-revoke event.
    assert fake_consents.docs[0]["status"] == "authorized"


def test_consent_ref_resolved_from_nested_data_shape(monkeypatch):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c2", "user_id": "kevin@example.com", "status": "authorized"}],
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"event": "account.updated", "data": {"consent": {"id": "c2"}}}),
    ))

    assert result == {"ok": True}
    assert len(calls) == 1
    assert calls[0]["consent_id"] == "c2"
    assert fake_events.docs[0]["event_type"] == "account.updated"


def test_no_user_id_on_consent_doc_is_skipped_not_enqueued(monkeypatch):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c3", "status": "authorized"}],  # no user_id
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": "some.event", "consent_id": "c3"}),
    ))

    assert result == {"ok": True}
    assert calls == []
    assert fake_events.docs[0]["status"] == "skipped"
    assert fake_events.docs[0]["skip_reason"] == "no user_id"


# ── 4. Revoke-ish event type → consent marked revoked, no sync enqueued ─

@pytest.mark.parametrize("event_type", [
    "consent.revoked",
    "consent.expired",
    "consent.cancelled",
    "account.disconnected",
])
def test_revoke_like_event_marks_consent_revoked_without_enqueuing(monkeypatch, event_type):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c4", "user_id": "kevin@example.com", "status": "authorized"}],
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": event_type, "consent_id": "c4"}),
    ))

    assert result == {"ok": True}
    assert calls == []
    assert fake_consents.docs[0]["status"] == "revoked"
    assert "revoked_at" in fake_consents.docs[0]
    assert fake_events.docs[0]["status"] == "noted"


def test_consent_declined_is_treated_as_revoke_like(monkeypatch):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c4b", "user_id": "kevin@example.com", "status": "authorized"}],
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": "consent.declined", "consent_id": "c4b"}),
    ))

    assert result == {"ok": True}
    assert calls == []
    assert fake_consents.docs[0]["status"] == "revoked"


@pytest.mark.parametrize("event_type", ["consent.created", "consent.authorised"])
def test_consent_lifecycle_non_revoke_events_still_enqueue(monkeypatch, event_type):
    """consent.created / consent.authorised must NOT be swept up by the
    revoke-substring sniff — they're ordinary lifecycle events that should
    still trigger a sync like any other non-revoke event."""
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c4c", "user_id": "kevin@example.com", "status": "pending"}],
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": event_type, "consent_id": "c4c"}),
    ))

    assert result == {"ok": True}
    assert len(calls) == 1
    assert fake_consents.docs[0]["status"] == "pending"  # untouched by this route
    assert fake_events.docs[0]["status"] == "queued"


# ── 5. Real Stripe-like envelope shape (Finexer's documented format) ────

def test_consent_lifecycle_event_resolves_from_data_object():
    event = {
        "id": "evt_1",
        "object": "event",
        "type": "consent.created",
        "data": {"object": {"id": "cst_abc123", "object": "consent", "customer": "cus_1", "status": "pending"}},
    }
    assert webhooks_module._resolve_finexer_consent_id(event) == "cst_abc123"


def test_transaction_event_resolves_consent_via_data_object_consent_string():
    event = {
        "type": "transaction.created",
        "data": {"object": {"id": "txn_1", "object": "transaction", "consent": "cst_abc123"}},
    }
    assert webhooks_module._resolve_finexer_consent_id(event) == "cst_abc123"


def test_transaction_event_resolves_consent_via_data_object_consent_dict():
    event = {
        "type": "account.updated",
        "data": {"object": {"id": "acc_1", "object": "account", "consent": {"id": "cst_abc123"}}},
    }
    assert webhooks_module._resolve_finexer_consent_id(event) == "cst_abc123"


def test_real_envelope_shape_end_to_end_enqueues_sync(monkeypatch):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "cst_abc123", "user_id": "kevin@example.com", "status": "authorized"}],
    )
    calls = _spy_enqueue(monkeypatch)

    event = {
        "id": "evt_2",
        "object": "event",
        "type": "transaction.created",
        "data": {"object": {"id": "txn_2", "object": "transaction", "consent": "cst_abc123"}},
    }
    result = asyncio.run(webhooks_module.finexer_webhook(SECRET, _FakeRequest(event)))

    assert result == {"ok": True}
    assert len(calls) == 1
    assert calls[0]["consent_id"] == "cst_abc123"
    assert fake_events.docs[0]["status"] == "queued"


# ── 6. Signature verification (fx-signature header) ─────────────────────

def test_signature_skipped_when_signing_secret_unset(monkeypatch):
    """Pre-registration deploy state: no signing secret configured means no
    fx-signature header is required at all."""
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c5", "user_id": "kevin@example.com", "status": "authorized"}],
        signing_secret="",
    )
    calls = _spy_enqueue(monkeypatch)

    result = asyncio.run(webhooks_module.finexer_webhook(
        SECRET, _FakeRequest({"type": "some.event", "consent_id": "c5"}),  # no headers at all
    ))

    assert result == {"ok": True}
    assert len(calls) == 1


def test_valid_signature_accepted(monkeypatch):
    fake_consents, fake_events = _setup(
        monkeypatch,
        consents=[{"_id": "c6", "user_id": "kevin@example.com", "status": "authorized"}],
        signing_secret=SIGNING_SECRET,
    )
    calls = _spy_enqueue(monkeypatch)

    payload = {"type": "some.event", "consent_id": "c6"}
    raw = json.dumps(payload).encode()
    ts = datetime.now(timezone.utc).isoformat()
    header = _sign(SIGNING_SECRET, ts, raw)

    request = _FakeRequest(payload, headers={"fx-signature": header})
    # _FakeRequest re-serializes the payload in __init__; make sure the raw
    # bytes it hands back match what we signed.
    request._raw = raw

    result = asyncio.run(webhooks_module.finexer_webhook(SECRET, request))

    assert result == {"ok": True}
    assert len(calls) == 1


def test_tampered_body_rejected(monkeypatch):
    _setup(
        monkeypatch,
        consents=[{"_id": "c7", "user_id": "kevin@example.com", "status": "authorized"}],
        signing_secret=SIGNING_SECRET,
    )
    _spy_enqueue(monkeypatch)

    original = json.dumps({"type": "some.event", "consent_id": "c7"}).encode()
    ts = datetime.now(timezone.utc).isoformat()
    header = _sign(SIGNING_SECRET, ts, original)

    tampered_payload = {"type": "some.event", "consent_id": "c7-different"}
    request = _FakeRequest(tampered_payload, headers={"fx-signature": header})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.finexer_webhook(SECRET, request))
    assert exc.value.status_code == 401


def test_stale_timestamp_rejected(monkeypatch):
    _setup(
        monkeypatch,
        consents=[{"_id": "c8", "user_id": "kevin@example.com", "status": "authorized"}],
        signing_secret=SIGNING_SECRET,
    )
    _spy_enqueue(monkeypatch)

    payload = {"type": "some.event", "consent_id": "c8"}
    raw = json.dumps(payload).encode()
    stale_ts = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    header = _sign(SIGNING_SECRET, stale_ts, raw)

    request = _FakeRequest(payload, headers={"fx-signature": header})
    request._raw = raw

    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.finexer_webhook(SECRET, request))
    assert exc.value.status_code == 401


def test_missing_signature_header_rejected_when_signing_secret_configured(monkeypatch):
    _setup(
        monkeypatch,
        consents=[{"_id": "c9", "user_id": "kevin@example.com", "status": "authorized"}],
        signing_secret=SIGNING_SECRET,
    )
    _spy_enqueue(monkeypatch)

    request = _FakeRequest({"type": "some.event", "consent_id": "c9"})  # no fx-signature header

    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.finexer_webhook(SECRET, request))
    assert exc.value.status_code == 401
