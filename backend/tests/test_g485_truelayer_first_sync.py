"""G485: a TrueLayer first pull may not publish partial bank facts as ready."""
import asyncio
from contextlib import asynccontextmanager

import pytest

import app.services.truelayer_sync as sync


UID = "g485@example.com"


class _Col:
    def __init__(self, doc):
        self.doc = dict(doc)

    async def find_one(self, *_a, **_k):
        return dict(self.doc)

    def find(self, *_a, **_k):
        async def rows():
            if False:
                yield None
        return rows()

    async def update_one(self, query, update, upsert=False):
        if all(self.doc.get(key) == value for key, value in query.items()):
            self.doc.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                self.doc.pop(key, None)

    async def update_many(self, *_a, **_k):
        return None


class _Response:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body or {"results": []}

    def json(self):
        return self._body


class _Client:
    def __init__(self, responses):
        self.responses = responses

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_a):
        return False

    async def get(self, url, **_kw):
        for suffix, response in self.responses.items():
            if url.endswith(suffix):
                return response
        raise AssertionError(f"unexpected URL: {url}")


@asynccontextmanager
async def _progress(*_a, **_k):
    yield


def _raw_env(monkeypatch, responses):
    conn = _Col({"_id": "conn", "user_id": UID, "first_sync_pending_run": "run-1"})
    monkeypatch.setattr(sync, "connections_col", conn)
    monkeypatch.setattr(sync, "excluded_accounts_col", _Col({"_id": "none"}))
    monkeypatch.setattr(sync, "accounts_col", _Col({"_id": "none"}))
    monkeypatch.setattr(sync, "get_valid_token", lambda _cid: _async_value("token"))
    monkeypatch.setattr(sync, "user_identity", lambda _uid: _async_value(None))
    monkeypatch.setattr(sync.httpx, "AsyncClient", lambda **_kw: _Client(responses))
    return conn


async def _async_value(value):
    return value


def test_first_pull_http_failure_marks_pending_failed_without_last_synced(monkeypatch):
    conn = _raw_env(monkeypatch, {
        "/accounts": _Response(503),
        "/cards": _Response(200),
        "/me": _Response(200),
    })
    monkeypatch.setattr(sync, "begin_first_sync", lambda *_a: _async_value("run-1"))
    monkeypatch.setattr(sync, "sync_in_progress", _progress)

    with pytest.raises(sync._FirstSyncIncomplete):
        asyncio.run(sync.sync_connection("conn", UID))

    assert "last_synced" not in conn.doc
    assert conn.doc["first_sync_pending_run"] == "run-1"
    assert conn.doc["first_sync_error"] == "sync_failed"


def test_supported_account_endpoint_and_unsupported_card_endpoint_are_complete(monkeypatch):
    conn = _raw_env(monkeypatch, {
        "/accounts": _Response(200),
        "/cards": _Response(501, {"error": "endpoint_not_supported"}),
        "/me": _Response(200),
    })

    assert asyncio.run(sync._sync_connection("conn", UID, require_complete=True)) == ([], 0)
    assert conn.doc.get("last_synced") is not None


def test_first_callback_releases_only_after_confirmed_derived_compute(monkeypatch):
    calls = []

    async def raw(_cid, _uid, *, first_sync_runs):
        first_sync_runs.append(("conn", "run-1"))
        return ["account"], 0

    async def noop(*_a, **_k):
        return None

    async def compute(*_a, **_k):
        return {"recomputed": True}

    async def complete(_col, cid, run):
        calls.append((cid, run))
        return True

    monkeypatch.setattr(sync, "sync_connection", raw)
    monkeypatch.setattr(sync, "complete_first_sync", complete)
    monkeypatch.setattr("app.services.categorisation.apply_rules_bulk", noop)
    monkeypatch.setattr("app.services.categorisation.categorise_others_bg", noop)
    monkeypatch.setattr("app.services.manual_account_rules.apply_rules", noop)
    monkeypatch.setattr("app.services.own_transfer_judge.after_sync", noop)
    monkeypatch.setattr("app.services.derived_caches.recompute_derived_caches", compute)

    assert asyncio.run(sync.sync_connection_with_derived("conn", UID)) == (["account"], 0)
    assert calls == [("conn", "run-1")]
