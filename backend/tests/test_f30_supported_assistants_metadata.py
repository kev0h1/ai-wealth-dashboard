"""F30: the settings metadata is a narrow, authenticated projection of the
current assessed-assistant allowlist. Connection history remains revocable.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone
import inspect

from fastapi.params import Depends

import app.routers.oauth as oauth


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        return self._iterate()

    async def _iterate(self):
        for doc in self.docs:
            yield dict(doc)


class _Tokens:
    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]

    def find(self, query):
        return _Cursor([doc for doc in self.docs if all(doc.get(k) == v for k, v in query.items())])

    async def update_many(self, query, update):
        changed = 0
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                doc.update(update["$set"])
                changed += 1
        return type("Result", (), {"modified_count": changed})()


REVIEW = {"reviewed_on": "2026-11-27", "reviewed_by": "reviewer", "terms_url": "https://example.test/terms"}


def _write_allowlist(path, clients):
    path.write_text(json.dumps({"clients": clients}))


def _valid(client_id, name):
    return {
        "id": client_id,
        "name": name,
        "redirect_uris": [f"https://{client_id}.example.test/callback"],
        "review": REVIEW,
    }


def test_supported_assistants_only_projects_current_validated_entries(monkeypatch, tmp_path):
    allowlist = tmp_path / "allowlist.json"
    _write_allowlist(allowlist, [
        _valid("claude", "Claude"),
        {"id": "pending", "name": "Pending", "redirect_uris": ["https://pending.example.test/callback"], "review": {**REVIEW, "reviewed_on": ""}},
        {"id": "malformed", "name": 7, "redirect_uris": ["https://malformed.example.test/callback"], "review": REVIEW},
        {"id": "unreviewed", "name": "Unreviewed", "redirect_uris": ["https://unreviewed.example.test/callback"]},
        _valid("chatgpt", "ChatGPT"),
    ])
    monkeypatch.setenv("MCP_CLIENT_ALLOWLIST_FILE", str(allowlist))
    monkeypatch.setattr(oauth, "oauth_tokens_col", _Tokens())

    result = _run(oauth.list_connections(user={"email": "user@example.com"}))

    assert result["connections"] == []
    assert result["supported_assistants"] == [
        {"id": "claude", "name": "Claude"},
        {"id": "chatgpt", "name": "ChatGPT"},
    ]
    assert all(set(entry) == {"id", "name"} for entry in result["supported_assistants"])


def test_supported_assistants_handles_zero_one_and_multiple_valid_entries(monkeypatch, tmp_path):
    allowlist = tmp_path / "allowlist.json"
    monkeypatch.setenv("MCP_CLIENT_ALLOWLIST_FILE", str(allowlist))
    monkeypatch.setattr(oauth, "oauth_tokens_col", _Tokens())

    for clients, expected in [
        ([], []),
        ([_valid("claude", "Claude")], [{"id": "claude", "name": "Claude"}]),
        ([_valid("claude", "Claude"), _valid("chatgpt", "ChatGPT")], [{"id": "claude", "name": "Claude"}, {"id": "chatgpt", "name": "ChatGPT"}]),
    ]:
        _write_allowlist(allowlist, clients)
        result = _run(oauth.list_connections(user={"email": "user@example.com"}))
        assert result["supported_assistants"] == expected


def test_historical_connection_stays_listed_and_revocable_when_no_longer_assessed(monkeypatch, tmp_path):
    allowlist = tmp_path / "allowlist.json"
    _write_allowlist(allowlist, [_valid("claude", "Claude")])
    monkeypatch.setenv("MCP_CLIENT_ALLOWLIST_FILE", str(allowlist))
    now = datetime.now(timezone.utc)
    tokens = _Tokens([{
        "_id": "legacy", "client_id": "removed-client", "client_name": "Former assistant",
        "uid": "user@example.com", "scopes": ["accounts:read"], "created_at": now,
        "expires_at": now + timedelta(hours=1), "last_used_at": None, "revoked_at": None,
    }])
    monkeypatch.setattr(oauth, "oauth_tokens_col", tokens)

    listed = _run(oauth.list_connections(user={"email": "user@example.com"}))
    assert listed["supported_assistants"] == [{"id": "claude", "name": "Claude"}]
    assert listed["connections"][0]["client_id"] == "removed-client"
    assert listed["connections"][0]["client_name"] == "Former assistant"

    revoked = _run(oauth.revoke_connection("removed-client", user={"email": "user@example.com"}))
    assert revoked == {"ok": True, "revoked": 1}
    assert tokens.docs[0]["revoked_at"] is not None


def test_connections_endpoint_keeps_its_authenticated_dependency():
    user_default = inspect.signature(oauth.list_connections).parameters["user"].default
    assert isinstance(user_default, Depends)
