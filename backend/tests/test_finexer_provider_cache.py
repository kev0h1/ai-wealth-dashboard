"""Tests for backlog H19: app/services/finexer_sync.py's list_providers()
caching layer.

Before this, every consent sync (sync_finexer_consent) re-walked Finexer's
full paginated /providers list, on top of the accounts/balances/transactions
calls the sync actually needs — pure waste against a per-minute request
budget E2's RECONCILE_MAX_PER_MINUTE is sized against, since the provider
list is effectively static reference data.

Two cache layers, both fronting the same live walk that already existed:
  - Mongo (`finexer_providers_col`), one doc, shared across processes.
  - An in-process memo on top, so repeated calls within one process (e.g. a
    worker syncing several consents back to back) don't even re-read Mongo.

Fakes follow this codebase's existing finexer test conventions
(tests/test_finexer_rate_limit.py, tests/test_finexer_link.py): a tiny
queue-of-responses stand-in for the async-context-managed httpx client, and
a minimal find_one/replace_one stand-in for the Mongo collection.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import app.services.finexer_sync as finexer_sync


# ── fakes ────────────────────────────────────────────────────────────────

class FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json


class ProvidersClient:
    """Stand-in for finexer_sync._client()'s async-context-managed httpx
    client: serves a fixed queue of responses to GET /providers regardless
    of the offset param, same convention as test_finexer_rate_limit.py's
    QueueClient/FxClient."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        self.calls.append((url, params))
        if not self.responses:
            raise AssertionError("no more responses queued")
        return self.responses.pop(0)


def _must_not_open_client():
    raise AssertionError("list_providers should not open a Finexer client on a cache hit")


class FakeProvidersCol:
    """Minimal find_one/replace_one stand-in for finexer_providers_col."""

    def __init__(self, doc=None):
        self.doc = dict(doc) if doc else None
        self.find_one_calls = 0
        self.replace_calls: list = []

    async def find_one(self, query=None, max_time_ms=None):
        self.find_one_calls += 1
        return dict(self.doc) if self.doc else None

    async def replace_one(self, filt, replacement, upsert=False):
        self.replace_calls.append(dict(replacement))
        self.doc = dict(replacement)


def _page(items, has_next=False):
    return FakeResp(200, json_data={"data": items, "paging": {"next": "/providers?offset=2" if has_next else None}})


def _provider(pid, name):
    return {"id": pid, "name": name, "roles": ["ais"], "logo_url": "", "bg_colors": []}


@pytest.fixture(autouse=True)
def _reset_memo():
    """`_providers_memo` is module-level state — reset before and after
    every test so tests don't leak into each other (same pattern as
    test_finexer_link.py's _reset_providers_cache fixture)."""
    finexer_sync._providers_memo = None
    yield
    finexer_sync._providers_memo = None


# ── cold cache: walks the API and writes the doc ────────────────────────

def test_cold_cache_walks_api_and_writes_doc(monkeypatch):
    col = FakeProvidersCol(doc=None)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)

    client = ProvidersClient([_page([_provider("amex", "American Express")])])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    counter: dict = {}
    result = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert result == [{"id": "amex", "name": "American Express", "logo": "", "bg_colors": []}]
    assert counter == {"requests": 1}
    assert len(client.calls) == 1

    assert len(col.replace_calls) == 1
    written = col.replace_calls[0]
    assert written["_id"] == "providers"
    assert written["providers"] == result
    assert written["count"] == 1
    assert isinstance(written["fetched_at"], datetime)


def test_cold_cache_walks_multiple_pages(monkeypatch):
    col = FakeProvidersCol(doc=None)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)

    client = ProvidersClient([
        _page([_provider("amex", "American Express")], has_next=True),
        _page([_provider("monzo", "Monzo")], has_next=False),
    ])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    counter: dict = {}
    result = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert [p["id"] for p in result] == ["amex", "monzo"]
    assert counter == {"requests": 2}
    assert len(col.replace_calls) == 1


# ── warm cache: no HTTP call, counter untouched ──────────────────────────

def test_warm_memo_returns_without_mongo_or_http_call(monkeypatch):
    col = FakeProvidersCol(doc=None)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)

    client = ProvidersClient([_page([_provider("amex", "American Express")])])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    first = asyncio.run(finexer_sync.list_providers(counter={}))
    assert col.find_one_calls == 1

    # Now prove a second call is served purely from the in-process memo:
    # no Mongo read, no Finexer client ever opened.
    monkeypatch.setattr(finexer_sync, "_client", _must_not_open_client)
    counter: dict = {}
    second = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert second == first
    assert counter == {}
    assert col.find_one_calls == 1  # unchanged — no second Mongo read


def test_mongo_only_cache_hit_skips_http_but_reads_mongo_once(monkeypatch):
    """No in-process memo (simulates a different process / fresh module
    state) but a fresh Mongo doc already exists: the walk is skipped and
    the counter stays untouched, but Mongo is read once."""
    fresh_doc = {
        "_id": "providers",
        "providers": [{"id": "amex", "name": "American Express", "logo": "", "bg_colors": []}],
        "fetched_at": datetime.now(timezone.utc) - timedelta(hours=1),
        "count": 1,
    }
    col = FakeProvidersCol(doc=fresh_doc)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)
    monkeypatch.setattr(finexer_sync, "_client", _must_not_open_client)

    counter: dict = {}
    result = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert result == fresh_doc["providers"]
    assert counter == {}
    assert col.find_one_calls == 1
    assert col.replace_calls == []


# ── expired cache: re-walks ──────────────────────────────────────────────

def test_expired_cache_rewalks(monkeypatch):
    stale_doc = {
        "_id": "providers",
        "providers": [{"id": "old", "name": "Old Bank", "logo": "", "bg_colors": []}],
        "fetched_at": datetime.now(timezone.utc) - timedelta(hours=25),  # older than the 24h default TTL
        "count": 1,
    }
    col = FakeProvidersCol(doc=stale_doc)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)

    client = ProvidersClient([_page([_provider("new", "New Bank")])])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    counter: dict = {}
    result = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert result == [{"id": "new", "name": "New Bank", "logo": "", "bg_colors": []}]
    assert counter == {"requests": 1}
    assert len(client.calls) == 1
    assert len(col.replace_calls) == 1
    assert col.replace_calls[0]["providers"] == result


# ── failure handling ──────────────────────────────────────────────────────

def test_failed_walk_with_stale_doc_falls_back_and_does_not_overwrite(monkeypatch, caplog):
    import logging

    stale_doc = {
        "_id": "providers",
        "providers": [{"id": "old", "name": "Old Bank", "logo": "", "bg_colors": []}],
        "fetched_at": datetime.now(timezone.utc) - timedelta(hours=25),
        "count": 1,
    }
    col = FakeProvidersCol(doc=stale_doc)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)

    client = ProvidersClient([FakeResp(500, text="boom")])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    counter: dict = {}
    with caplog.at_level(logging.WARNING, logger="app.services.finexer_sync"):
        result = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert result == stale_doc["providers"]
    assert counter == {"requests": 1}
    # The failed walk must NOT poison the cache with an empty/partial list.
    assert col.replace_calls == []
    assert col.doc == stale_doc
    assert any("stale" in r.message for r in caplog.records)


def test_failed_walk_without_cache_returns_partial_and_writes_nothing(monkeypatch):
    col = FakeProvidersCol(doc=None)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)

    # First page succeeds (one provider collected), second page 500s.
    client = ProvidersClient([
        _page([_provider("amex", "American Express")], has_next=True),
        FakeResp(500, text="boom"),
    ])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    counter: dict = {}
    result = asyncio.run(finexer_sync.list_providers(counter=counter))

    assert result == [{"id": "amex", "name": "American Express", "logo": "", "bg_colors": []}]
    assert counter == {"requests": 2}
    assert col.replace_calls == []
    assert col.doc is None


# ── force refresh ─────────────────────────────────────────────────────────

def test_force_refresh_skips_fresh_cache_and_rewalks(monkeypatch):
    fresh_doc = {
        "_id": "providers",
        "providers": [{"id": "old", "name": "Old Bank", "logo": "", "bg_colors": []}],
        "fetched_at": datetime.now(timezone.utc),
        "count": 1,
    }
    col = FakeProvidersCol(doc=fresh_doc)
    monkeypatch.setattr(finexer_sync, "finexer_providers_col", col)
    # Prime the memo too, so a non-forced call would short-circuit entirely.
    finexer_sync._providers_memo = {"providers": fresh_doc["providers"], "fetched_at": fresh_doc["fetched_at"]}

    client = ProvidersClient([_page([_provider("new", "New Bank")])])
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)

    result = asyncio.run(finexer_sync.list_providers(force=True))

    assert result == [{"id": "new", "name": "New Bank", "logo": "", "bg_colors": []}]
    assert len(client.calls) == 1
    assert len(col.replace_calls) == 1
