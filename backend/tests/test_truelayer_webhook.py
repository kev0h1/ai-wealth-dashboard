"""Tests for the TrueLayer webhook receiver in app.routers.webhooks
(POST /webhooks/truelayer/{secret}).

TrueLayer's Data API webhooks are unsigned (unlike Finexer's or Stripe's):
per truelayer_webhook()'s own module docstring, "Security is provided by
HTTPS and a secret token embedded in the webhook URL." There is no
per-request signature or timestamp to forge or replay in the HMAC sense —
the whole route is gated by knowledge of one static secret path segment,
and the action a valid delivery triggers (enqueueing task_sync_truelayer)
is idempotent, re-running it is deliberately harmless (see
services/truelayer_sync.py: "are keyed on transaction_id, so re-fetching is
idempotent"). So "reject forged signatures" here means "reject a wrong
secret," and "reject replay" means "a replayed, validly-secreted delivery
must not do anything worse than trigger another harmless resync" — both
covered below. This route had no dedicated test file before A26.

Same conventions as tests/test_finexer_webhook.py: no mongomock, a tiny
in-memory fake collection, the route function called directly (not via
TestClient), `_enqueue` monkeypatched to a spy instead of touching Redis.
"""
import asyncio
import json

import pytest
from fastapi import HTTPException

import app.routers.webhooks as webhooks_module

SECRET = "test-truelayer-secret"


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self._next_id = 1

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if k == "$or":
                if not any(_FakeCol._match(d, sub) for sub in v):
                    return False
            elif d.get(k) != v:
                return False
        return True

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
    .body()."""

    def __init__(self, payload: dict):
        self._raw = json.dumps(payload).encode()

    async def body(self):
        return self._raw


class _RawBodyRequest:
    async def body(self):
        return b"not json{{{"


def _setup(monkeypatch, connections=None, events=None):
    fake_connections = _FakeCol(connections or [])
    fake_events = _FakeCol(events or [])
    monkeypatch.setattr(webhooks_module, "TRUELAYER_WEBHOOK_SECRET", SECRET)
    monkeypatch.setattr(webhooks_module, "connections_col", fake_connections)
    monkeypatch.setattr(webhooks_module, "webhook_events_col", fake_events)
    return fake_connections, fake_events


def _spy_enqueue(monkeypatch):
    calls = []

    async def fake_enqueue(task, **kwargs):
        calls.append({"task": task, **kwargs})

    monkeypatch.setattr(webhooks_module, "_enqueue", fake_enqueue)
    return calls


# ── Forged / wrong secret ────────────────────────────────────────────────

def test_wrong_secret_is_rejected_even_with_a_perfectly_valid_payload(monkeypatch):
    """A "forged" delivery here means anyone who doesn't know the URL
    secret, however well-shaped their payload. Must 401 and must never
    reach the point of enqueueing anything."""
    _setup(monkeypatch)
    calls = _spy_enqueue(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.truelayer_webhook(
            "wrong-secret",
            _FakeRequest({"type": "transaction.created", "credentials_id": "conn-1"}),
        ))
    assert exc.value.status_code == 401
    assert calls == []


def test_missing_secret_segment_style_empty_string_is_rejected(monkeypatch):
    _setup(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.truelayer_webhook(
            "", _FakeRequest({"type": "transaction.created"}),
        ))
    assert exc.value.status_code == 401


def test_invalid_json_returns_400(monkeypatch):
    _setup(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.truelayer_webhook(SECRET, _RawBodyRequest()))
    assert exc.value.status_code == 400


# ── A89: path secret now compared with hmac.compare_digest ──────────────
# Proves the switch from plain `!=` to a constant-time comparison changed
# nothing observable: a wrong secret (including one merely a different
# length) still 401s with the same detail, and the right secret is still
# accepted end to end.

@pytest.mark.parametrize("wrong_secret", [
    "wrong-secret",
    SECRET[:-1],  # same length minus one char
    SECRET + "x",  # different length
    "",
])
def test_wrong_path_secret_rejected_with_same_status_and_detail(monkeypatch, wrong_secret):
    _setup(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(webhooks_module.truelayer_webhook(
            wrong_secret, _FakeRequest({"type": "transaction.created", "credentials_id": "conn-1"}),
        ))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token"


def test_right_path_secret_is_accepted(monkeypatch):
    connections, events = _setup(
        monkeypatch, connections=[{"_id": "conn-right", "user_id": "u-right"}],
    )
    calls = _spy_enqueue(monkeypatch)
    result = asyncio.run(webhooks_module.truelayer_webhook(
        SECRET, _FakeRequest({"type": "transaction.created", "credentials_id": "conn-right"}),
    ))
    assert result == {"ok": True}
    assert len(calls) == 1
    assert events.docs[0]["status"] == "queued"


# ── Correct secret: normal dispatch ──────────────────────────────────────

def test_known_connection_enqueues_sync(monkeypatch):
    connections, events = _setup(
        monkeypatch, connections=[{"_id": "conn-1", "user_id": "u1"}],
    )
    calls = _spy_enqueue(monkeypatch)
    result = asyncio.run(webhooks_module.truelayer_webhook(
        SECRET, _FakeRequest({"type": "transaction.created", "credentials_id": "conn-1"}),
    ))
    assert result == {"ok": True}
    assert len(calls) == 1
    assert calls[0] == {"task": "task_sync_truelayer", "connection_id": "conn-1", "user_id": "u1"}
    assert events.docs[0]["status"] == "queued"


def test_unknown_connection_id_is_skipped_not_enqueued(monkeypatch):
    _setup(monkeypatch, connections=[])
    calls = _spy_enqueue(monkeypatch)
    result = asyncio.run(webhooks_module.truelayer_webhook(
        SECRET, _FakeRequest({"type": "transaction.created", "credentials_id": "no-such-conn"}),
    ))
    assert result == {"ok": True}
    assert calls == []


def test_no_connection_ref_at_all_is_skipped_not_enqueued(monkeypatch):
    _setup(monkeypatch)
    calls = _spy_enqueue(monkeypatch)
    asyncio.run(webhooks_module.truelayer_webhook(
        SECRET, _FakeRequest({"type": "data_status.updated"}),
    ))
    assert calls == []


def test_connection_disconnected_is_noted_not_enqueued(monkeypatch):
    _, events = _setup(monkeypatch, connections=[{"_id": "conn-1", "user_id": "u1"}])
    calls = _spy_enqueue(monkeypatch)
    asyncio.run(webhooks_module.truelayer_webhook(
        SECRET, _FakeRequest({"type": "connection.disconnected", "credentials_id": "conn-1"}),
    ))
    assert calls == []
    assert events.docs[0]["status"] == "noted"


def test_unhandled_event_type_is_ignored_not_enqueued_and_does_not_crash(monkeypatch):
    _, events = _setup(monkeypatch, connections=[{"_id": "conn-1", "user_id": "u1"}])
    calls = _spy_enqueue(monkeypatch)
    result = asyncio.run(webhooks_module.truelayer_webhook(
        SECRET, _FakeRequest({"type": "some_future_event_type", "credentials_id": "conn-1"}),
    ))
    assert result == {"ok": True}
    assert calls == []
    assert events.docs[0]["status"] == "ignored"


# ── Replay ────────────────────────────────────────────────────────────────

def test_replaying_a_valid_delivery_twice_only_ever_triggers_the_same_idempotent_resync(monkeypatch):
    """There is no nonce or timestamp on this provider's webhooks to reject
    a replay outright (see module docstring above), so the actual security
    property is: replaying a captured, correctly-secreted delivery can only
    ever cause a harmless resync of data the caller could already reach
    with a valid session, never a duplicated financial side effect or a
    privilege change. Two identical deliveries enqueue two syncs for the
    SAME connection/user — never a different one, never anything beyond
    triggering task_sync_truelayer (itself idempotent per
    services/truelayer_sync.py)."""
    _setup(monkeypatch, connections=[{"_id": "conn-1", "user_id": "u1"}])
    calls = _spy_enqueue(monkeypatch)
    payload = {"type": "transaction.created", "credentials_id": "conn-1"}
    first = asyncio.run(webhooks_module.truelayer_webhook(SECRET, _FakeRequest(payload)))
    second = asyncio.run(webhooks_module.truelayer_webhook(SECRET, _FakeRequest(payload)))
    assert first == {"ok": True}
    assert second == {"ok": True}
    assert len(calls) == 2
    assert all(c == {"task": "task_sync_truelayer", "connection_id": "conn-1", "user_id": "u1"} for c in calls)


def test_connection_ref_resolves_from_results_array_shape(monkeypatch):
    """Older/alternate payload shape: credentials_id nested under
    results[0] rather than top-level."""
    _setup(monkeypatch, connections=[{"_id": "conn-2", "user_id": "u2"}])
    calls = _spy_enqueue(monkeypatch)
    asyncio.run(webhooks_module.truelayer_webhook(
        SECRET,
        _FakeRequest({"type": "transaction.updated", "results": [{"credentials_id": "conn-2"}]}),
    ))
    assert len(calls) == 1
    assert calls[0]["connection_id"] == "conn-2"
