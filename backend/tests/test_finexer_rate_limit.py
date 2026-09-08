"""Tests for backlog E2: app/services/finexer_sync.py's Finexer 429 handling
(`_get`) and per-sync request counting persisted onto the consent doc
(`last_sync_requests` / `last_sync_429s`), the ingredients GET /admin/sync-stats
(app/routers/admin_usage.py) reports on.

Two layers, following this codebase's existing finexer test conventions
(tests/test_finexer_link.py, tests/test_retention.py):
  - `_get` in isolation, with a tiny queue-of-responses fake httpx client —
    no need to exercise the whole sync pipeline just to prove the retry/
    give-up/backoff-cap logic.
  - `sync_finexer_consent` end to end for one branch (the terminal
    "remote status isn't authorized" path), to prove the counters recorded
    there through `_get` actually land on the persisted consent doc.
"""
import asyncio
import logging

import app.services.finexer_sync as finexer_sync


# ── fakes ────────────────────────────────────────────────────────────────

class FakeResp:
    def __init__(self, status_code, json_data=None, headers=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.headers = headers or {}
        self.text = text

    def json(self):
        return self._json


class QueueClient:
    """Stand-in for httpx.AsyncClient: `.get()` pops responses off a fixed
    queue in order, regardless of URL — enough for exercising `_get`
    against one endpoint at a time."""

    def __init__(self, responses):
        self.queue = list(responses)
        self.calls: list = []

    async def get(self, url, params=None):
        self.calls.append((url, params))
        return self.queue.pop(0)


class FakeCol:
    """Minimal find_one/update_one stand-in, matching test_finexer_link.py's own."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


def _no_sleep(monkeypatch):
    async def _fast_sleep(seconds):
        return None
    monkeypatch.setattr(finexer_sync.asyncio, "sleep", _fast_sleep)


# ── _get: retry / give-up / backoff-cap ──────────────────────────────────

def test_get_retried_with_retry_after_then_succeeds(monkeypatch):
    _no_sleep(monkeypatch)
    client = QueueClient([
        FakeResp(429, headers={"Retry-After": "1"}),
        FakeResp(200, json_data={"ok": True}),
    ])
    counter: dict = {}

    resp = asyncio.run(finexer_sync._get(client, "/whatever", counter=counter))

    assert resp.status_code == 200
    assert counter == {"requests": 2, "429s": 1}
    assert len(client.calls) == 2


def test_get_three_429s_gives_up_cleanly(monkeypatch, caplog):
    _no_sleep(monkeypatch)
    client = QueueClient([FakeResp(429) for _ in range(4)])  # initial + 3 retries
    counter: dict = {}

    with caplog.at_level(logging.WARNING, logger="app.services.finexer_sync"):
        resp = asyncio.run(finexer_sync._get(client, "/whatever", counter=counter))

    # Gives up cleanly: returns the last (429) response rather than raising.
    assert resp.status_code == 429
    assert counter == {"requests": 4, "429s": 4}
    assert len(client.calls) == 4
    assert any("giving up" in r.message for r in caplog.records)


def test_get_retry_after_sleep_capped_at_30s(monkeypatch):
    slept: list = []

    async def _capture_sleep(seconds):
        slept.append(seconds)
    monkeypatch.setattr(finexer_sync.asyncio, "sleep", _capture_sleep)

    client = QueueClient([
        FakeResp(429, headers={"Retry-After": "999"}),  # way over the cap
        FakeResp(200),
    ])

    asyncio.run(finexer_sync._get(client, "/whatever", counter={}))

    assert slept == [30.0]


def test_get_no_429_returns_first_response_with_one_request_counted():
    client = QueueClient([FakeResp(200, json_data={"ok": True})])
    counter: dict = {}

    resp = asyncio.run(finexer_sync._get(client, "/whatever", counter=counter))

    assert resp.status_code == 200
    assert counter == {"requests": 1}  # "429s" is only ever set once a 429 is actually seen


# ── sync_finexer_consent: request counts land on the consent doc ────────

class FxClient:
    """Stand-in for finexer_sync._client()'s async-context-managed httpx
    client, dispatching by path so sync_finexer_consent's whole `async with
    _client() as client:` block can run against it (same pattern as
    tests/test_retention.py's FakeFxClient, extended with a per-path
    response queue and 429 support for the consent-check call)."""

    def __init__(self, consent_responses):
        self._consent_responses = list(consent_responses)
        self.calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        self.calls.append((url, params))
        if url.startswith("/consents/"):
            return self._consent_responses.pop(0)
        raise AssertionError(f"unexpected GET {url}")


def test_sync_records_request_and_429_counts_on_consent_doc(monkeypatch):
    """Consent-check 429s once then reports a non-authorized remote status
    (the sync's terminal path for this branch) — proves the retry actually
    ran inside the real sync pipeline, not just in the `_get` unit tests
    above, and that its counts get persisted."""
    _no_sleep(monkeypatch)

    consents = FakeCol([
        {"_id": "fx-1", "user_id": "u1", "status": "authorized", "last_synced": None},
    ])
    monkeypatch.setattr(finexer_sync, "finexer_consents_col", consents)

    fake_client = FxClient(consent_responses=[
        FakeResp(429, headers={"Retry-After": "0"}),
        FakeResp(200, json_data={"status": "expired"}),
    ])
    monkeypatch.setattr(finexer_sync, "_client", lambda: fake_client)

    async def _no_user_identity(uid):
        return None
    monkeypatch.setattr(finexer_sync, "user_identity", _no_user_identity)

    excluded = FakeExcludedCol()
    monkeypatch.setattr("app.db.collections.excluded_accounts_col", excluded)

    async def _no_mark_expired(consent_id):
        return None
    monkeypatch.setattr(finexer_sync, "_mark_finexer_accounts_expired", _no_mark_expired)

    ids, new_count = asyncio.run(finexer_sync.sync_finexer_consent("fx-1", "u1"))

    assert ids == []
    assert new_count == 0
    doc = consents.docs[0]
    assert doc["status"] == "expired"
    assert doc["last_sync_requests"] == 2
    assert doc["last_sync_429s"] == 1


class FakeExcludedCol:
    """Empty async-iterable find(), matching excluded_accounts_col's shape
    (`{"account_id": ...}` docs iterated with `async for`)."""

    def find(self, query=None, projection=None):
        return self

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration
