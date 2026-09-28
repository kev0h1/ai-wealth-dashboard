"""Unit tests for `send_apns_push`'s dead-token pruning in
`backend/app/core/push.py` (C19).

Bug being fixed: APNs 400 responses were only pruned for reason in
("BadDeviceToken", "Unregistered"); every other 400 reason — including
DeviceTokenNotForTopic, which is what Kevin's stale iOS token was actually
failing with on every 4-hourly sync-worker run — fell through to a bare
`logging.warning` with no prune, so a permanently undeliverable token
retried forever.

No mongomock is available in this environment, so `apns_tokens_col` is
replaced with a tiny in-memory fake (matching the pattern already used by
tests/test_finexer_rate_limit.py's FakeCol and tests/test_notifications.py's
FakeStateCol), and `httpx.AsyncClient` is replaced with a fake whose
`.post()` returns a queued canned response, so `send_apns_push`'s own
`async with httpx.AsyncClient(...) as client:` block runs for real.
"""
import asyncio

import app.core.push as push


# ── fakes ────────────────────────────────────────────────────────────────

class FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text or str(json_data or "")

    def json(self):
        return self._json


class QueueHttpClient:
    """Stand-in for httpx.AsyncClient: `.post()` pops responses off a fixed
    queue in order, one per call, and the object itself is the async context
    manager `send_apns_push` opens with `async with httpx.AsyncClient(...)`."""

    def __init__(self, responses):
        self.queue = list(responses)
        self.calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append((url, headers, json))
        return self.queue.pop(0)


class FakeApnsTokensCol:
    """Minimal find/delete_many stand-in for apns_tokens_col, `_id`-keyed
    docs the way the real collection stores device tokens."""

    def __init__(self, docs):
        self.docs = list(docs)
        self.deleted: list = []

    def find(self, query=None):
        query = query or {}
        matched = [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]
        return _FindCursor(matched)

    async def delete_many(self, query):
        ids = set((query.get("_id") or {}).get("$in") or [])
        self.deleted.extend(sorted(ids))
        self.docs = [d for d in self.docs if d["_id"] not in ids]


class _FindCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


def _install_fakes(monkeypatch, *, status_code, reason=None, token="tok-abc-1234567890"):
    """Wires one token doc + one queued APNs response, with real crypto and
    config checks bypassed so the test drives only the pruning decision."""
    tokens_col = FakeApnsTokensCol([{"_id": token, "user_id": "u1", "platform": "ios"}])
    monkeypatch.setattr(push, "apns_tokens_col", tokens_col)
    monkeypatch.setattr(push, "APNS_CONFIGURED", True)
    monkeypatch.setattr(push, "_apns_provider_jwt", lambda: "fake-jwt")

    body = {"reason": reason} if reason is not None else {}
    client = QueueHttpClient([FakeResp(status_code, json_data=body)])
    monkeypatch.setattr(push.httpx, "AsyncClient", lambda *a, **k: client)
    return tokens_col, client


# ── permanent token failures: MUST prune ────────────────────────────────

def test_400_device_token_not_for_topic_prunes(monkeypatch):
    """The actual bug: a token minted for a different apns-topic than the
    one we sent to must be pruned, not retried forever."""
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="DeviceTokenNotForTopic")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 1
    assert tokens_col.docs == []
    assert tokens_col.deleted == ["tok-abc-1234567890"]


def test_400_bad_device_token_still_prunes(monkeypatch):
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="BadDeviceToken")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 1
    assert tokens_col.docs == []


def test_400_unregistered_still_prunes(monkeypatch):
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="Unregistered")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 1
    assert tokens_col.docs == []


def test_410_unregistered_still_prunes(monkeypatch):
    """Apple's usual path for an uninstalled app: HTTP 410, no JSON reason
    needed. Existing behaviour, must not regress."""
    tokens_col, _ = _install_fakes(monkeypatch, status_code=410)

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 1
    assert tokens_col.docs == []


# ── server/request-side failures: must NEVER prune ──────────────────────

def test_400_bad_topic_does_not_prune(monkeypatch):
    """BadTopic means OUR apns-topic header/config is wrong, not the token.
    Pruning here would silently unsubscribe every user at once in response
    to a single misconfigured deploy."""
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="BadTopic")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 0
    assert len(tokens_col.docs) == 1
    assert tokens_col.deleted == []


def test_400_expired_provider_token_does_not_prune(monkeypatch):
    """Our signing JWT expired — nothing to do with the device token."""
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="ExpiredProviderToken")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 0
    assert len(tokens_col.docs) == 1


def test_400_too_many_requests_does_not_prune(monkeypatch):
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="TooManyRequests")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 0
    assert len(tokens_col.docs) == 1


# ── unrecognised reason: fail safe, must NOT prune ───────────────────────

def test_400_unrecognised_reason_does_not_prune(monkeypatch):
    """A reason string this code has never seen before (e.g. Apple adding a
    new one) must not be guessed at — fail safe by not pruning, while still
    logging loudly enough to diagnose (see caplog assertion below)."""
    tokens_col, _ = _install_fakes(monkeypatch, status_code=400, reason="SomeBrandNewAppleReason")

    result = asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert result["pruned"] == 0
    assert len(tokens_col.docs) == 1


def test_400_unrecognised_reason_is_logged(monkeypatch, caplog):
    _install_fakes(monkeypatch, status_code=400, reason="SomeBrandNewAppleReason")

    with caplog.at_level("WARNING"):
        asyncio.run(push.send_apns_push("u1", "Title", "Body"))

    assert any(
        "unrecognised reason" in r.message and "SomeBrandNewAppleReason" in r.message
        for r in caplog.records
    )
