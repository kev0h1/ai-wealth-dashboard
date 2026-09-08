"""F2: OAuth 2.1 authorisation server (app/routers/oauth.py) plus its two
integration points — `app.core.auth.auth_middleware`'s /mcp
WWW-Authenticate header, and `app.routers.mcp.resolve_mcp_principal`
accepting a real access token.

Same conventions as tests/test_mcp_endpoint.py: plain `asyncio.run`, no
TestClient/real Mongo/real Redis, module-level names monkeypatched directly
on each module's own namespace. Router functions are called directly with
every parameter supplied by keyword (several have `Query(...)`/
`Depends(...)` defaults that only resolve correctly through FastAPI's own
dependency injection, never when the function is called as plain Python).
"""
import asyncio
import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.responses import PlainTextResponse, RedirectResponse

import app.core.auth as auth_mod
import app.routers.mcp as mcp
import app.routers.oauth as oauth


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _mcp_connector_enabled(monkeypatch):
    """A17: MCP_CONNECTOR_ENABLED defaults to false (production ships the
    connector absent), so app.core.auth's /mcp-specific branches
    (WWW-Authenticate header, sorted_at_ pass-through) are no-ops unless the
    flag is on. This whole file exercises the F2 authorisation server and
    its auth_middleware integration points assuming the connector IS turned
    on. See tests/test_mcp_connector_flag.py for the flag-off behaviour."""
    monkeypatch.setattr(auth_mod, "MCP_CONNECTOR_ENABLED", True)


# ── shared fakes ─────────────────────────────────────────────────────────

class _FakeResult:
    def __init__(self, modified_count):
        self.modified_count = modified_count


def _matches(doc: dict, query: dict) -> bool:
    return all(doc.get(k) == v for k, v in query.items())


class _FakeCollection:
    """Stands in for a Motor collection: enough surface for oauth.py and
    mcp.py's own OAuth token lookup (find_one, insert_one, update_one,
    update_many, find + async iteration)."""

    def __init__(self, seed=None):
        self.docs: dict = {}
        for d in (seed or []):
            self.docs[d["_id"]] = dict(d)

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)

    async def find_one(self, query):
        for doc in self.docs.values():
            if _matches(doc, query):
                return dict(doc)
        return None

    async def update_one(self, query, update):
        for doc in self.docs.values():
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return _FakeResult(1)
        return _FakeResult(0)

    async def update_many(self, query, update):
        count = 0
        for doc in self.docs.values():
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                count += 1
        return _FakeResult(count)

    def find(self, query):
        rows = [dict(d) for d in self.docs.values() if _matches(d, query)]
        return _FakeCursor(rows)


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for r in self._rows:
            yield r


def _fake_pending_store():
    """A trivial in-memory stand-in for app.core.pending_oauth, monkeypatched
    directly onto oauth.py's own imported names (same pattern
    test_mcp_endpoint.py uses for mcp.check_rate_limit)."""
    store: dict = {}

    async def fake_store(req_id, data):
        store[req_id] = data

    async def fake_get(req_id):
        return store.get(req_id)

    async def fake_pop(req_id):
        return store.pop(req_id, None)

    return store, fake_store, fake_get, fake_pop


def _install_fakes(monkeypatch, seed_clients=None, seed_codes=None, seed_tokens=None):
    clients = _FakeCollection(seed_clients)
    codes = _FakeCollection(seed_codes)
    tokens = _FakeCollection(seed_tokens)
    monkeypatch.setattr(oauth, "oauth_clients_col", clients)
    monkeypatch.setattr(oauth, "oauth_codes_col", codes)
    monkeypatch.setattr(oauth, "oauth_tokens_col", tokens)
    store, fake_store, fake_get, fake_pop = _fake_pending_store()
    monkeypatch.setattr(oauth, "store_oauth_request", fake_store)
    monkeypatch.setattr(oauth, "get_oauth_request", fake_get)
    monkeypatch.setattr(oauth, "pop_oauth_request", fake_pop)
    return clients, codes, tokens, store


def _pkce_pair():
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


async def _register(client_name="Claude", redirect_uris=None):
    body = {"client_name": client_name, "redirect_uris": redirect_uris or ["https://claude.ai/api/mcp/callback"]}
    return await oauth.register_client(body)


class _FakeFormRequest:
    """Stands in for a FastAPI Request whose only use is `.form()`."""

    def __init__(self, data: dict):
        self._data = data

    async def form(self):
        return self._data


# ── discovery documents ──────────────────────────────────────────────────

def test_authorization_server_metadata_shape():
    meta = _run(oauth.oauth_authorization_server_metadata())
    assert meta["authorization_endpoint"].endswith("/auth/oauth/authorize")
    assert meta["token_endpoint"].endswith("/auth/oauth/token")
    assert meta["registration_endpoint"].endswith("/auth/oauth/register")
    assert meta["revocation_endpoint"].endswith("/auth/oauth/revoke")
    assert meta["response_types_supported"] == ["code"]
    assert set(meta["grant_types_supported"]) == {"authorization_code", "refresh_token"}
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert meta["token_endpoint_auth_methods_supported"] == ["none"]
    assert set(meta["scopes_supported"]) == {"accounts:read", "plans:read", "insights:read"}


def test_protected_resource_metadata_shape():
    meta = _run(oauth.oauth_protected_resource_metadata())
    assert meta["resource"].endswith("/mcp")
    assert meta["authorization_servers"] == [meta["resource"].rsplit("/mcp", 1)[0]]
    assert meta["bearer_methods_supported"] == ["header"]


# ── dynamic client registration ─────────────────────────────────────────

def test_register_rejects_missing_client_name(monkeypatch):
    _install_fakes(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(oauth.register_client({"redirect_uris": ["https://example.com/cb"]}))
    assert exc.value.status_code == 400


def test_register_rejects_non_https_non_loopback_redirect(monkeypatch):
    _install_fakes(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(_register(redirect_uris=["http://example.com/cb"]))
    assert exc.value.status_code == 400


def test_register_accepts_loopback_redirect_any_port(monkeypatch):
    _install_fakes(monkeypatch)
    result = _run(_register(redirect_uris=["http://127.0.0.1:54123/callback"]))
    assert result["client_id"]
    assert result["token_endpoint_auth_method"] == "none"
    assert result["redirect_uris"] == ["http://127.0.0.1:54123/callback"]


def test_register_accepts_https_redirect(monkeypatch):
    clients, *_ = _install_fakes(monkeypatch)
    result = _run(_register(client_name="ChatGPT", redirect_uris=["https://chatgpt.com/connector_platform_oauth_redirect"]))
    assert result["client_id"] in clients.docs
    assert clients.docs[result["client_id"]]["client_name"] == "ChatGPT"


# ── authorize ────────────────────────────────────────────────────────────

def test_authorize_unknown_client_returns_plain_400_never_a_redirect(monkeypatch):
    _install_fakes(monkeypatch)
    resp = _run(oauth.authorize(
        response_type="code", client_id="does-not-exist",
        redirect_uri="https://evil.example.com/cb", scope="accounts:read",
        state="s1", code_challenge="chal", code_challenge_method="S256",
    ))
    assert isinstance(resp, PlainTextResponse)
    assert resp.status_code == 400


def test_authorize_redirect_uri_mismatch_returns_plain_400(monkeypatch):
    _install_fakes(monkeypatch)
    client = _run(_register())
    resp = _run(oauth.authorize(
        response_type="code", client_id=client["client_id"],
        redirect_uri="https://not-registered.example.com/cb", scope="accounts:read",
        state="s1", code_challenge="chal", code_challenge_method="S256",
    ))
    assert isinstance(resp, PlainTextResponse)
    assert resp.status_code == 400


def test_authorize_bad_scope_redirects_with_error_and_state(monkeypatch):
    _install_fakes(monkeypatch)
    client = _run(_register())
    resp = _run(oauth.authorize(
        response_type="code", client_id=client["client_id"],
        redirect_uri=client["redirect_uris"][0], scope="transactions:read",
        state="s1", code_challenge="chal", code_challenge_method="S256",
    ))
    assert isinstance(resp, RedirectResponse)
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith(client["redirect_uris"][0])
    assert "error=invalid_scope" in location
    assert "state=s1" in location


def test_authorize_missing_state_redirects_with_invalid_request(monkeypatch):
    _install_fakes(monkeypatch)
    client = _run(_register())
    resp = _run(oauth.authorize(
        response_type="code", client_id=client["client_id"],
        redirect_uri=client["redirect_uris"][0], scope="accounts:read",
        state="", code_challenge="chal", code_challenge_method="S256",
    ))
    assert isinstance(resp, RedirectResponse)
    assert "error=invalid_request" in resp.headers["location"]


def test_authorize_happy_path_stores_request_and_redirects_to_consent(monkeypatch):
    _, _, _, store = _install_fakes(monkeypatch)
    client = _run(_register())
    resp = _run(oauth.authorize(
        response_type="code", client_id=client["client_id"],
        redirect_uri=client["redirect_uris"][0], scope="accounts:read plans:read",
        state="xyz", code_challenge="chal123", code_challenge_method="S256",
    ))
    assert isinstance(resp, RedirectResponse)
    assert resp.status_code == 302
    location = resp.headers["location"]
    assert "/oauth/consent?req=" in location
    req_id = location.rsplit("req=", 1)[1]
    assert req_id in store
    pending = store[req_id]
    assert pending["client_id"] == client["client_id"]
    assert pending["scopes"] == ["accounts:read", "plans:read"]
    assert pending["state"] == "xyz"
    assert pending["code_challenge"] == "chal123"


# ── consent decision ──────────────────────────────────────────────────────

def test_decision_approve_creates_code_bound_to_uid_and_returns_redirect(monkeypatch):
    _, codes, _, store = _install_fakes(monkeypatch)
    client = _run(_register())
    store["req1"] = {
        "client_id": client["client_id"], "client_name": client["client_name"],
        "redirect_uri": client["redirect_uris"][0], "scopes": ["accounts:read"],
        "state": "s1", "code_challenge": "chal1",
    }
    result = _run(oauth.decide_oauth_request(
        {"req_id": "req1", "approve": True}, user={"email": "user@example.com"},
    ))
    assert result["redirect"].startswith(client["redirect_uris"][0])
    assert "state=s1" in result["redirect"]
    assert "code=" in result["redirect"]
    assert "req1" not in store  # one-shot: consumed either way

    assert len(codes.docs) == 1
    code_doc = next(iter(codes.docs.values()))
    assert code_doc["uid"] == "user@example.com"
    assert code_doc["client_id"] == client["client_id"]
    assert code_doc["redirect_uri"] == client["redirect_uris"][0]
    assert code_doc["scopes"] == ["accounts:read"]
    assert code_doc["code_challenge"] == "chal1"
    assert code_doc["used_at"] is None


def test_decision_deny_returns_access_denied_and_consumes_request(monkeypatch):
    _, codes, _, store = _install_fakes(monkeypatch)
    store["req2"] = {
        "client_id": "c1", "client_name": "Claude", "redirect_uri": "https://claude.ai/cb",
        "scopes": ["accounts:read"], "state": "s2", "code_challenge": "chal2",
    }
    result = _run(oauth.decide_oauth_request({"req_id": "req2", "approve": False}, user={"email": "u@e.com"}))
    assert result["redirect"] == "https://claude.ai/cb?error=access_denied&state=s2"
    assert not codes.docs
    assert "req2" not in store


def test_decision_expired_request_raises_404(monkeypatch):
    _install_fakes(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(oauth.decide_oauth_request({"req_id": "missing", "approve": True}, user={"email": "u@e.com"}))
    assert exc.value.status_code == 404


def test_get_request_details_plain_language_scopes(monkeypatch):
    _, _, _, store = _install_fakes(monkeypatch)
    store["req3"] = {
        "client_id": "c1", "client_name": "Claude", "redirect_uri": "https://claude.ai/api/cb",
        "scopes": ["accounts:read", "plans:read"], "state": "s3", "code_challenge": "chal3",
    }
    details = _run(oauth.get_oauth_request_details("req3", user={"email": "u@e.com"}))
    assert details["client_name"] == "Claude"
    assert details["redirect_host"] == "claude.ai"
    scopes_by_id = {s["scope"]: s["description"] for s in details["scopes"]}
    assert scopes_by_id["accounts:read"] == "Balances and account names"
    assert scopes_by_id["plans:read"] == "Bills, plans, goals and your tax position figures"


# ── token exchange ────────────────────────────────────────────────────────

async def _approve_and_get_code(clients_seed=None, redirect_uri="https://claude.ai/cb", scopes=None):
    verifier, challenge = _pkce_pair()
    scopes = scopes or ["accounts:read", "plans:read"]
    code = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    code_doc = {
        "_id": hashlib.sha256(code.encode()).hexdigest(),
        "client_id": "client-1", "uid": "user@example.com", "redirect_uri": redirect_uri,
        "scopes": scopes, "code_challenge": challenge,
        "created_at": now, "expires_at": now + timedelta(minutes=5), "used_at": None,
    }
    return code, verifier, code_doc


def test_token_exchange_succeeds_with_correct_verifier(monkeypatch):
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    resp = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    })))
    import json
    body = json.loads(resp.body)
    assert body["access_token"].startswith("sorted_at_")
    assert body["refresh_token"].startswith("sorted_rt_")
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 3600
    assert body["scope"] == "accounts:read plans:read"
    assert codes.docs[code_doc["_id"]]["used_at"] is not None
    assert len(tokens.docs) == 2


def test_token_exchange_fails_with_wrong_verifier(monkeypatch):
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    resp = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": "totally-wrong-verifier",
    })))
    import json
    body = json.loads(resp.body)
    assert resp.status_code == 400
    assert body["error"] == "invalid_grant"
    assert not tokens.docs


def test_code_reuse_revokes_the_whole_family(monkeypatch):
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    form = {
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    }
    first = _run(oauth.token_endpoint(_FakeFormRequest(form)))
    assert first.status_code == 200
    assert all(t["revoked_at"] is None for t in tokens.docs.values())

    second = _run(oauth.token_endpoint(_FakeFormRequest(form)))
    import json
    body = json.loads(second.body)
    assert second.status_code == 400
    assert body["error"] == "invalid_grant"
    # Reuse must revoke every token minted from this code.
    assert all(t["revoked_at"] is not None for t in tokens.docs.values())


def test_refresh_rotation_revokes_old_refresh_token(monkeypatch):
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    import json
    first = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    })))
    first_body = json.loads(first.body)
    old_refresh_hash = hashlib.sha256(first_body["refresh_token"].encode()).hexdigest()

    second = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": first_body["refresh_token"],
        "client_id": "client-1",
    })))
    second_body = json.loads(second.body)
    assert second.status_code == 200
    assert second_body["access_token"] != first_body["access_token"]
    assert second_body["refresh_token"] != first_body["refresh_token"]
    assert tokens.docs[old_refresh_hash]["revoked_at"] is not None

    # The new refresh token can immediately be used again (rotation, not a
    # one-way door); the just-revoked old one cannot.
    reuse_old = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": first_body["refresh_token"],
        "client_id": "client-1",
    })))
    assert reuse_old.status_code == 400


def test_unsupported_grant_type(monkeypatch):
    _install_fakes(monkeypatch)
    resp = _run(oauth.token_endpoint(_FakeFormRequest({"grant_type": "password"})))
    import json
    assert json.loads(resp.body)["error"] == "unsupported_grant_type"


# ── revocation ────────────────────────────────────────────────────────────

def test_revoke_endpoint_revokes_access_and_its_refresh_sibling(monkeypatch):
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc
    import json
    issued = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    }))).body)

    resp = _run(oauth.revoke_token(_FakeFormRequest({"token": issued["access_token"], "client_id": "client-1"})))
    assert resp.status_code == 200
    assert all(t["revoked_at"] is not None for t in tokens.docs.values())


def test_revoke_unknown_token_is_still_a_200(monkeypatch):
    _install_fakes(monkeypatch)
    resp = _run(oauth.revoke_token(_FakeFormRequest({"token": "sorted_at_doesnotexist", "client_id": "c1"})))
    assert resp.status_code == 200


# ── connections management ────────────────────────────────────────────────

def test_list_connections_aggregates_per_client(monkeypatch):
    now = datetime.now(timezone.utc)
    _, _, tokens, _ = _install_fakes(monkeypatch, seed_tokens=[
        {
            "_id": "h1", "kind": "access", "client_id": "claude-1", "client_name": "Claude",
            "uid": "user@example.com", "scopes": ["accounts:read"], "created_at": now - timedelta(days=2),
            "expires_at": now + timedelta(hours=1), "last_used_at": now - timedelta(hours=1),
            "revoked_at": None, "pair_id": "p1", "origin_code_hash": "x",
        },
        {
            "_id": "h2", "kind": "refresh", "client_id": "claude-1", "client_name": "Claude",
            "uid": "user@example.com", "scopes": ["accounts:read"], "created_at": now - timedelta(days=2),
            "expires_at": now + timedelta(days=29), "last_used_at": None,
            "revoked_at": None, "pair_id": "p1", "origin_code_hash": "x",
        },
        {
            "_id": "h3", "kind": "access", "client_id": "claude-1", "client_name": "Claude",
            "uid": "user@example.com", "scopes": ["plans:read"], "created_at": now - timedelta(days=1),
            "expires_at": now - timedelta(minutes=1), "last_used_at": None,
            "revoked_at": None, "pair_id": "p2", "origin_code_hash": "y",
        },
        {
            "_id": "h4", "kind": "access", "client_id": "other-user-client", "client_name": "Other",
            "uid": "someone-else@example.com", "scopes": ["accounts:read"], "created_at": now,
            "expires_at": now + timedelta(hours=1), "last_used_at": None,
            "revoked_at": None, "pair_id": "p3", "origin_code_hash": "z",
        },
    ])
    result = _run(oauth.list_connections(user={"email": "user@example.com"}))
    assert len(result["connections"]) == 1
    conn = result["connections"][0]
    assert conn["client_id"] == "claude-1"
    assert set(conn["scopes"]) == {"accounts:read", "plans:read"}
    # h3 is expired, so only h1 (access) + h2 (refresh) count as active.
    assert conn["active_tokens"] == 2


def test_delete_connection_revokes_every_token_for_that_client(monkeypatch):
    now = datetime.now(timezone.utc)
    _, _, tokens, _ = _install_fakes(monkeypatch, seed_tokens=[
        {"_id": "h1", "kind": "access", "client_id": "claude-1", "client_name": "Claude",
         "uid": "user@example.com", "scopes": ["accounts:read"], "created_at": now,
         "expires_at": now + timedelta(hours=1), "last_used_at": None, "revoked_at": None,
         "pair_id": "p1", "origin_code_hash": "x"},
        {"_id": "h2", "kind": "refresh", "client_id": "claude-1", "client_name": "Claude",
         "uid": "user@example.com", "scopes": ["accounts:read"], "created_at": now,
         "expires_at": now + timedelta(days=29), "last_used_at": None, "revoked_at": None,
         "pair_id": "p1", "origin_code_hash": "x"},
        {"_id": "h3", "kind": "access", "client_id": "other-client", "client_name": "Other",
         "uid": "user@example.com", "scopes": ["accounts:read"], "created_at": now,
         "expires_at": now + timedelta(hours=1), "last_used_at": None, "revoked_at": None,
         "pair_id": "p2", "origin_code_hash": "y"},
    ])
    result = _run(oauth.revoke_connection("claude-1", user={"email": "user@example.com"}))
    assert result["revoked"] == 2
    assert tokens.docs["h1"]["revoked_at"] is not None
    assert tokens.docs["h2"]["revoked_at"] is not None
    assert tokens.docs["h3"]["revoked_at"] is None  # a different client, untouched


# ── resolve_mcp_principal accepting a real OAuth access token ───────────

def _seed_access_token(tokens: _FakeCollection, *, scopes, revoked_at=None, expires_delta=timedelta(hours=1)):
    now = datetime.now(timezone.utc)
    raw = "sorted_at_" + secrets.token_urlsafe(16)
    tokens.docs[hashlib.sha256(raw.encode()).hexdigest()] = {
        "_id": hashlib.sha256(raw.encode()).hexdigest(), "kind": "access",
        "client_id": "claude-1", "client_name": "Claude", "uid": "user@example.com",
        "scopes": scopes, "created_at": now, "expires_at": now + expires_delta,
        "last_used_at": None, "revoked_at": revoked_at, "pair_id": "p1", "origin_code_hash": "x",
    }
    return raw


class _FakeRequestWithAuth:
    def __init__(self, token: str | None):
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}


def test_resolve_mcp_principal_accepts_valid_access_token(monkeypatch):
    tokens = _FakeCollection()
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)
    raw = _seed_access_token(tokens, scopes=["accounts:read", "plans:read"])

    principal = _run(mcp.resolve_mcp_principal(_FakeRequestWithAuth(raw)))
    assert principal["uid"] == "user@example.com"
    assert principal["client"] == "Claude"
    assert principal["client_id"] == "claude-1"
    assert principal["scopes"] == {"accounts:read", "plans:read"}
    # last_used_at stamped.
    stored = tokens.docs[hashlib.sha256(raw.encode()).hexdigest()]
    assert stored["last_used_at"] is not None


def test_resolve_mcp_principal_rejects_revoked_token(monkeypatch):
    tokens = _FakeCollection()
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)
    raw = _seed_access_token(tokens, scopes=["accounts:read"], revoked_at=datetime.now(timezone.utc))

    with pytest.raises(HTTPException) as exc:
        _run(mcp.resolve_mcp_principal(_FakeRequestWithAuth(raw)))
    assert exc.value.status_code == 401
    assert "resource_metadata" in exc.value.headers["WWW-Authenticate"]


def test_resolve_mcp_principal_rejects_expired_token(monkeypatch):
    tokens = _FakeCollection()
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)
    raw = _seed_access_token(tokens, scopes=["accounts:read"], expires_delta=timedelta(minutes=-5))

    with pytest.raises(HTTPException) as exc:
        _run(mcp.resolve_mcp_principal(_FakeRequestWithAuth(raw)))
    assert exc.value.status_code == 401


def test_tools_call_enforces_the_access_tokens_own_scopes(monkeypatch):
    tokens = _FakeCollection()
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)

    async def fake_get_subscription(uid):
        class _Sub:
            tier_name = "connect"

            def limit(self, key):
                return 2000
        return _Sub()
    monkeypatch.setattr(mcp, "get_subscription", fake_get_subscription)
    monkeypatch.setattr(mcp, "mcp_calls_col", _AuditStub())

    raw = _seed_access_token(tokens, scopes=["plans:read"])  # no accounts:read
    principal = _run(mcp.resolve_mcp_principal(_FakeRequestWithAuth(raw)))

    async def forbidden(uid, name, args):
        raise AssertionError("execute_tool must not run when the token's own scope doesn't cover it")
    monkeypatch.setattr(mcp, "execute_tool", forbidden)

    resp = _run(mcp.handle_jsonrpc_request(principal, {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    assert resp["error"]["code"] == -32001
    assert resp["error"]["data"]["required_scope"] == "accounts:read"


class _AuditStub:
    async def insert_one(self, doc):
        pass

    async def count_documents(self, query):
        return 0


# ── /mcp 401 carries WWW-Authenticate (middleware) ───────────────────────

class _FakeURL:
    def __init__(self, path):
        self.path = path


class _FakeMiddlewareRequest:
    def __init__(self, path, headers=None, method="GET"):
        self.url = _FakeURL(path)
        self.headers = headers or {}
        self.method = method


async def _unreachable_call_next(request):
    raise AssertionError("call_next must not run for an unauthenticated /mcp request")


def test_mcp_401_with_no_bearer_carries_www_authenticate():
    resp = _run(auth_mod.auth_middleware(_FakeMiddlewareRequest("/mcp"), _unreachable_call_next))
    assert resp.status_code == 401
    assert "resource_metadata" in resp.headers["www-authenticate"]
    assert "/.well-known/oauth-protected-resource" in resp.headers["www-authenticate"]


def test_mcp_401_with_expired_session_token_carries_www_authenticate():
    resp = _run(auth_mod.auth_middleware(
        _FakeMiddlewareRequest("/mcp", headers={"Authorization": "Bearer not-a-real-token"}),
        _unreachable_call_next,
    ))
    assert resp.status_code == 401
    assert "resource_metadata" in resp.headers["www-authenticate"]


def test_other_routes_401_has_no_www_authenticate_header():
    resp = _run(auth_mod.auth_middleware(_FakeMiddlewareRequest("/accounts"), _unreachable_call_next))
    assert resp.status_code == 401
    assert "www-authenticate" not in resp.headers


def test_middleware_lets_a_sorted_at_prefixed_bearer_through_to_call_next_on_mcp():
    """The middleware itself never validates an OAuth access token (it
    can't — it isn't a session token); on /mcp specifically it just avoids
    rejecting it outright so resolve_mcp_principal downstream gets a
    chance to do the real check."""
    async def call_next(request):
        return "reached"
    result = _run(auth_mod.auth_middleware(
        _FakeMiddlewareRequest("/mcp", headers={"Authorization": "Bearer sorted_at_whatever"}),
        call_next,
    ))
    assert result == "reached"


def test_sorted_at_bearer_on_a_non_mcp_route_is_rejected_by_the_middleware():
    """A connector's access token must never clear the middleware for any
    route other than /mcp — it isn't a session token, so it should get the
    same 401 an invalid bearer gets anywhere else, with no MCP discovery
    header (that header is an /mcp-specific signal, not a generic hint)."""
    resp = _run(auth_mod.auth_middleware(
        _FakeMiddlewareRequest("/profile", headers={"Authorization": "Bearer sorted_at_whatever"}),
        _unreachable_call_next,
    ))
    assert resp.status_code == 401
    assert "www-authenticate" not in resp.headers


def test_sorted_rt_refresh_token_on_mcp_is_rejected_by_the_middleware():
    """Refresh tokens are never valid bearer credentials on /mcp (or
    anywhere else) — they're only ever presented as a form field to
    /auth/oauth/token or /auth/oauth/revoke, both already-public /auth/
    paths handled earlier in the middleware, never as an Authorization
    header."""
    resp = _run(auth_mod.auth_middleware(
        _FakeMiddlewareRequest("/mcp", headers={"Authorization": "Bearer sorted_rt_whatever"}),
        _unreachable_call_next,
    ))
    assert resp.status_code == 401


def test_valid_shaped_sorted_at_bearer_still_reaches_call_next_on_mcp_subpath():
    """The /mcp scoping check covers sub-paths too (e.g. a future /mcp/foo),
    not just the exact string "/mcp"."""
    async def call_next(request):
        return "reached"
    result = _run(auth_mod.auth_middleware(
        _FakeMiddlewareRequest("/mcp/audit", headers={"Authorization": "Bearer sorted_at_whatever"}),
        call_next,
    ))
    assert result == "reached"
