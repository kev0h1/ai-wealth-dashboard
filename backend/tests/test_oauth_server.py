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
import app.core.subscription as subscription_module
import app.routers.mcp as mcp
import app.routers.oauth as oauth


def _run(coro):
    return asyncio.run(coro)


def _run_concurrently(*coros):
    """Runs several coroutines under one asyncio.run via gather. Plain
    `asyncio.gather(*coros)` can't be built outside a running loop (it
    calls ensure_future/get_event_loop immediately), so gather has to be
    awaited from inside the coroutine _run hands to asyncio.run, not built
    beforehand."""
    async def _gather():
        return await asyncio.gather(*coros)
    return asyncio.run(_gather())


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

    async def find_one_and_update(self, query, update):
        """Mimics Motor/pymongo's default (return_document=BEFORE):
        returns the matching doc as it was *before* applying `update`, or
        None if nothing matched `query`. A26: oauth.py relies on this
        being atomic (one document mutated per matching call, no separate
        read step an interleaved caller could slip in between) to close
        the code-replay / refresh-reuse race — see
        test_concurrent_code_exchange_only_one_winner below for why that
        matters."""
        for doc in self.docs.values():
            if _matches(doc, query):
                before = dict(doc)
                doc.update(update.get("$set", {}))
                return before
        return None

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


def test_openid_configuration_needs_no_auth():
    # F12: called directly with no `user=` kwarg, the same way the sibling
    # oauth-authorization-server test proves this handler has no auth
    # dependency to satisfy.
    meta = _run(oauth.openid_configuration_metadata())
    assert meta["issuer"] == oauth.API_PUBLIC_URL


def test_openid_configuration_matches_authorization_server_metadata(monkeypatch):
    monkeypatch.setattr(oauth, "API_PUBLIC_URL", "https://example.test/api")
    as_meta = _run(oauth.oauth_authorization_server_metadata())
    oidc_meta = _run(oauth.openid_configuration_metadata())
    assert oidc_meta["issuer"] == as_meta["issuer"] == "https://example.test/api"
    assert oidc_meta["authorization_endpoint"] == as_meta["authorization_endpoint"]
    assert oidc_meta["token_endpoint"] == as_meta["token_endpoint"]
    assert oidc_meta["registration_endpoint"] == as_meta["registration_endpoint"]
    assert oidc_meta["code_challenge_methods_supported"] == as_meta["code_challenge_methods_supported"]


def test_openid_configuration_metadata_shape():
    meta = _run(oauth.openid_configuration_metadata())
    assert meta["response_types_supported"] == ["code"]
    assert meta["subject_types_supported"] == ["public"]
    assert meta["id_token_signing_alg_values_supported"] == ["RS256"]
    assert "jwks_uri" not in meta


def test_openid_configuration_path_is_mcp_open_path():
    assert "/.well-known/openid-configuration" in auth_mod._MCP_OPEN_PATHS


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


def _rendezvous_gate(real_fn, n_expected: int):
    """Wraps an async fake-collection method so that, when called
    concurrently by `n_expected` callers, every caller has genuinely
    reached this point before any of them proceeds into `real_fn`. Models
    the worst case for a TOCTOU race: two requests that both read "not yet
    used/revoked" before either one writes.

    A26 regression note: this MUST be patched onto a call that both the
    vulnerable and the fixed handler make, not onto find_one_and_update.
    The vulnerable handler (find_one, then a later unconditional
    update_one) never calls find_one_and_update at all, so a gate placed
    there never fires; asyncio has no true suspension point anywhere else
    in either coroutine (the fake collection methods never actually await
    real I/O), so without a forced interleaving the two coroutines just
    run one to completion before the other starts, and the *sequential*
    reuse check (`doc.get("used_at") is not None`) quietly does the job
    instead of the race defence under test. That was proven by running
    these two tests against oauth.py as of commit 1d061ac (the parent of
    A26's fix, find_one + plain update_one, no atomic claim): both PASSED,
    2 passed, 0 failed, for exactly that wrong reason. Gating the initial
    `find_one` read instead works against both implementations, because
    both call it as their very first read of the code/token document,
    before any write: forcing both callers to complete that read before
    either proceeds reproduces the actual TOCTOU window (both observe
    "not yet used") regardless of whether the later write is a bare
    update_one or an atomic find_one_and_update.

    Gating the right call is necessary but not sufficient: an explicit
    `await asyncio.sleep(0)` below, AFTER real_fn returns and BEFORE
    control is handed back to the caller, is what actually forces the
    interleaving. Without it, releasing the gate (`release.set()`) only
    *schedules* the other caller's wakeup via the event loop's ready
    queue, it does not switch to it immediately; since none of the fake
    collection's own methods ever truly suspend, whichever caller is
    running when the gate opens just keeps running, uninterrupted,
    straight through its own read AND write AND response, and completes
    before the other caller gets to run at all. `asyncio.sleep(0)` is a
    genuine, unconditional suspension point, so it hands control back to
    the loop and lets the other (already-woken) caller run its own read
    before either one reaches the write. Confirmed empirically: with this
    sleep(0) removed, both rewritten tests below still passed against the
    pre-A26 vulnerable oauth.py (1d061ac) even after the gate was moved
    onto find_one, for this exact reason."""
    state = {"arrived": 0}
    release = asyncio.Event()

    async def gated(*args, **kwargs):
        state["arrived"] += 1
        if state["arrived"] >= n_expected:
            release.set()
        else:
            await release.wait()
        result = await real_fn(*args, **kwargs)
        # Force a real scheduling yield (see docstring above): without
        # this, whichever caller is running when the gate opens runs
        # straight through to its own write and response before the
        # other caller ever resumes, so the two never actually interleave.
        await asyncio.sleep(0)
        return result

    return gated


def test_concurrent_code_exchange_only_one_winner(monkeypatch):
    """A26: two requests redeeming the SAME authorization code at the same
    time must not both succeed. Before the atomic-claim fix, oauth.py read
    the code with a plain find_one and only marked it used with a later,
    separate update_one — two racing requests could both pass the
    used_at-is-None read before either write landed, and both would mint a
    live token pair from one code.

    The gate is patched onto `codes.find_one`, the initial read every
    request makes before any write, NOT onto find_one_and_update — see the
    note on _rendezvous_gate for why that seam is the one that exists in
    both the vulnerable and the fixed handler, and why gating
    find_one_and_update instead makes this test unable to fail (A33)."""
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    monkeypatch.setattr(
        codes, "find_one",
        _rendezvous_gate(codes.find_one, n_expected=2),
    )

    form = {
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    }
    results = _run_concurrently(
        oauth.token_endpoint(_FakeFormRequest(dict(form))),
        oauth.token_endpoint(_FakeFormRequest(dict(form))),
    )
    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 400]
    # Exactly one token pair was ever inserted (access + refresh), never two.
    assert len(tokens.docs) == 2
    # Per the existing "any reuse signal revokes the whole family" doctrine
    # (test_code_reuse_revokes_the_whole_family above), the loser's cleanup
    # sweep revokes the pair the winner just received. That is the same
    # fail-safe this server already applies to sequential reuse, now also
    # covering the concurrent case: a genuine race is indistinguishable
    # from an attacker replaying an intercepted code, so both directions
    # revoke rather than risk a live duplicate.
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


def test_concurrent_refresh_rotation_only_one_winner(monkeypatch):
    """A26: the refresh-token leg has the same class of race as the
    authorization code leg above. Two requests rotating the SAME refresh
    token at the same time must not both succeed, forced here by gating
    `tokens.find_one` (the initial read, present in both the vulnerable
    and the fixed handler), not find_one_and_update — see the note on
    _rendezvous_gate (A33)."""
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
    refresh_token = json.loads(first.body)["refresh_token"]

    monkeypatch.setattr(
        tokens, "find_one",
        _rendezvous_gate(tokens.find_one, n_expected=2),
    )

    form = {"grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": "client-1"}
    results = _run_concurrently(
        oauth.token_endpoint(_FakeFormRequest(dict(form))),
        oauth.token_endpoint(_FakeFormRequest(dict(form))),
    )
    statuses = sorted(r.status_code for r in results)
    assert statuses == [200, 400]
    # 2 from the original code exchange + exactly 2 more from whichever
    # single request won the rotation race, never 2 + 4.
    assert len(tokens.docs) == 4


def _mcp_check(tokens: "_FakeCollection", monkeypatch, access_token: str):
    """Runs the real `/mcp` bearer-resolution path (mcp.resolve_mcp_principal)
    against `access_token`, sharing the same fake tokens collection oauth.py
    was just exercised against. Returns the resolved principal, or raises
    HTTPException the same way a real 401 would surface to a caller."""
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)
    return _run(mcp.resolve_mcp_principal(_FakeRequestWithAuth(access_token)))


def test_refresh_rotation_revokes_sibling_access_token(monkeypatch):
    """A74 (T4, pentest OAUTH-06): live-confirmed 2026-09-20 that access1
    stayed usable at /mcp after its sibling refresh1 was rotated out. The
    fix cascade-revokes the sibling access token the instant its refresh
    token is rotated, so access1 must now be rejected at /mcp immediately
    after rotation, while the freshly minted access2 keeps working."""
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    import json
    first_body = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    }))).body)

    # access1 is live immediately after the code exchange.
    principal = _mcp_check(tokens, monkeypatch, first_body["access_token"])
    assert principal["uid"] == "user@example.com"

    second_body = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": first_body["refresh_token"],
        "client_id": "client-1",
    }))).body)

    # access1 (the rotated-out refresh token's sibling) must now be dead...
    with pytest.raises(HTTPException) as exc:
        _mcp_check(tokens, monkeypatch, first_body["access_token"])
    assert exc.value.status_code == 401

    # ...while access2 (minted by the rotation) works.
    principal2 = _mcp_check(tokens, monkeypatch, second_body["access_token"])
    assert principal2["uid"] == "user@example.com"


def test_refresh_replay_revokes_whole_grant_including_newest_access_token(monkeypatch):
    """A74 (T4, pentest OAUTH-06): replaying an already-rotated-out refresh
    token is the standard signal for token theft, so the response is the
    standard breach response — revoke the WHOLE grant, not just the dead
    token itself. Rotate twice (pair1 -> pair2 -> pair3) so "the newest
    access token" (access3, from pair3) is a different pair than the one
    directly sharing refresh1's pair_id, then replay refresh1 and confirm
    access3 dies too, not just access1/access2."""
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    code, verifier, code_doc = _run(_approve_and_get_code())
    codes.docs[code_doc["_id"]] = code_doc

    import json
    pair1 = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    }))).body)
    pair2 = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": pair1["refresh_token"],
        "client_id": "client-1",
    }))).body)
    pair3 = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": pair2["refresh_token"],
        "client_id": "client-1",
    }))).body)

    # access3 is genuinely live before the replay.
    principal3 = _mcp_check(tokens, monkeypatch, pair3["access_token"])
    assert principal3["uid"] == "user@example.com"

    # Replay the long-dead refresh1 (rotated out when pair2 was minted).
    replay = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": pair1["refresh_token"],
        "client_id": "client-1",
    })))
    assert replay.status_code == 400
    assert json.loads(replay.body)["error"] == "invalid_grant"

    # Every token this grant ever produced is now dead, including access3
    # and refresh3, the newest pair, minted well after refresh1 was retired.
    assert all(t["revoked_at"] is not None for t in tokens.docs.values())
    with pytest.raises(HTTPException) as exc:
        _mcp_check(tokens, monkeypatch, pair3["access_token"])
    assert exc.value.status_code == 401

    refresh3_again = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": pair3["refresh_token"],
        "client_id": "client-1",
    })))
    assert refresh3_again.status_code == 400
    assert json.loads(refresh3_again.body)["error"] == "invalid_grant"


def test_refresh_replay_leaves_unrelated_grant_for_same_user_untouched(monkeypatch):
    """A74: the cascade above must be scoped to the compromised grant's own
    `origin_code_hash` lineage, not to the user account as a whole. A
    second, wholly unrelated grant for the SAME user (e.g. a second device
    or a second connector authorised separately) must survive a replay
    detected on the first grant."""
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}

    code_a, verifier_a, code_doc_a = _run(_approve_and_get_code())
    codes.docs[code_doc_a["_id"]] = code_doc_a
    code_b, verifier_b, code_doc_b = _run(_approve_and_get_code())
    codes.docs[code_doc_b["_id"]] = code_doc_b

    import json
    grant_a_pair1 = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code_a,
        "redirect_uri": code_doc_a["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier_a,
    }))).body)
    grant_a_pair2 = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": grant_a_pair1["refresh_token"],
        "client_id": "client-1",
    }))).body)
    grant_b_pair1 = json.loads(_run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code_b,
        "redirect_uri": code_doc_b["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier_b,
    }))).body)

    # Replay grant A's rotated-out refresh1 — should nuke grant A only.
    replay = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": grant_a_pair1["refresh_token"],
        "client_id": "client-1",
    })))
    assert replay.status_code == 400

    grant_a_hash = hashlib.sha256(grant_a_pair2["access_token"].encode()).hexdigest()
    grant_b_hash = hashlib.sha256(grant_b_pair1["access_token"].encode()).hexdigest()
    assert tokens.docs[grant_a_hash]["revoked_at"] is not None
    assert tokens.docs[grant_b_hash]["revoked_at"] is None

    # Grant B's access token still works at /mcp, untouched.
    principal_b = _mcp_check(tokens, monkeypatch, grant_b_pair1["access_token"])
    assert principal_b["uid"] == "user@example.com"


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


def test_delete_connection_by_a_different_user_matches_nothing(monkeypatch):
    """A52 (2026-09-20, pentest OAUTH-08): the previous test above only ever
    exercises the SAME user deleting their own connection for a different
    client_id. It never exercises a different user attempting to delete a
    client_id they never granted — the exact cross-tenant shape the
    reconciled pentest catalogue's OAUTH-08 flagged as a genuine coverage
    gap. Live-run against UAT on 2026-09-20 confirmed the code's own
    `{"uid": uid, "client_id": client_id, ...}` filter already matches zero
    documents for a client_id a caller never granted, leaving the true
    owner's tokens completely untouched. This test pins that OBSERVED
    behaviour (a record of what the code currently does), not a new
    control; see docs/security/pentest-runs/A52-2026-09-20/records.md,
    OAUTH-08."""
    now = datetime.now(timezone.utc)
    _, _, tokens, _ = _install_fakes(monkeypatch, seed_tokens=[
        {"_id": "h1", "kind": "access", "client_id": "claude-1", "client_name": "Claude",
         "uid": "victim@example.com", "scopes": ["accounts:read"], "created_at": now,
         "expires_at": now + timedelta(hours=1), "last_used_at": None, "revoked_at": None,
         "pair_id": "p1", "origin_code_hash": "x"},
        {"_id": "h2", "kind": "refresh", "client_id": "claude-1", "client_name": "Claude",
         "uid": "victim@example.com", "scopes": ["accounts:read"], "created_at": now,
         "expires_at": now + timedelta(days=29), "last_used_at": None, "revoked_at": None,
         "pair_id": "p1", "origin_code_hash": "x"},
    ])
    # A different user attempts to delete "claude-1" — a client_id they
    # never granted anything to (it belongs to "victim@example.com" above).
    result = _run(oauth.revoke_connection("claude-1", user={"email": "attacker@example.com"}))
    assert result["revoked"] == 0
    # The victim's own tokens for that exact client_id remain completely untouched.
    assert tokens.docs["h1"]["revoked_at"] is None
    assert tokens.docs["h2"]["revoked_at"] is None


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


# ── F13: naive-datetime regression ──────────────────────────────────────
#
# The Motor client (app.db.collections) is not created with tz_aware=True,
# so a real Mongo doc's expires_at comes back as a naive datetime, while the
# code compares it against the aware datetime.now(timezone.utc). Before the
# F13 fix (app.core.timeutil.as_utc), this raised TypeError: can't compare
# offset-naive and offset-aware datetimes. The tests below simulate that by
# storing naive datetimes directly, the same way the fakes above store aware
# ones, and assert the affected paths behave correctly instead of raising.

def test_token_exchange_succeeds_when_stored_code_expires_at_is_naive(monkeypatch):
    clients, codes, tokens, _ = _install_fakes(monkeypatch)
    clients.docs["client-1"] = {"_id": "client-1", "client_id": "client-1", "client_name": "Claude"}
    verifier, challenge = _pkce_pair()
    code = secrets.token_urlsafe(32)
    naive_now = datetime.utcnow()
    code_doc = {
        "_id": hashlib.sha256(code.encode()).hexdigest(),
        "client_id": "client-1", "uid": "user@example.com", "redirect_uri": "https://claude.ai/cb",
        "scopes": ["accounts:read", "plans:read"], "code_challenge": challenge,
        "created_at": naive_now, "expires_at": naive_now + timedelta(minutes=5), "used_at": None,
    }
    codes.docs[code_doc["_id"]] = code_doc

    resp = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": code_doc["redirect_uri"], "client_id": "client-1",
        "code_verifier": verifier,
    })))
    import json
    body = json.loads(resp.body)
    assert resp.status_code == 200
    assert body["access_token"].startswith("sorted_at_")
    assert body["refresh_token"].startswith("sorted_rt_")


def test_refresh_grant_succeeds_when_stored_expires_at_is_naive(monkeypatch):
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
    refresh_hash = hashlib.sha256(first_body["refresh_token"].encode()).hexdigest()
    # Simulate reading the doc back from the non-tz_aware Motor client: strip tzinfo.
    tokens.docs[refresh_hash]["expires_at"] = tokens.docs[refresh_hash]["expires_at"].replace(tzinfo=None)

    second = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": first_body["refresh_token"],
        "client_id": "client-1",
    })))
    second_body = json.loads(second.body)
    assert second.status_code == 200
    assert second_body["access_token"] != first_body["access_token"]


def test_refresh_grant_rejects_expired_naive_expires_at(monkeypatch):
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
    refresh_hash = hashlib.sha256(first_body["refresh_token"].encode()).hexdigest()
    # A naive expires_at in the past must still be treated as expired, not
    # crash and not be mistaken for always-valid.
    tokens.docs[refresh_hash]["expires_at"] = datetime.utcnow() - timedelta(minutes=5)

    resp = _run(oauth.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": first_body["refresh_token"],
        "client_id": "client-1",
    })))
    body = json.loads(resp.body)
    assert resp.status_code == 400
    assert body["error"] == "invalid_grant"


def test_revoke_endpoint_works_when_stored_expires_at_is_naive(monkeypatch):
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
    # Downgrade every stored token's expires_at to naive, as if freshly read
    # back from the non-tz_aware Motor client.
    for doc in tokens.docs.values():
        doc["expires_at"] = doc["expires_at"].replace(tzinfo=None)

    resp = _run(oauth.revoke_token(_FakeFormRequest({"token": issued["access_token"], "client_id": "client-1"})))
    assert resp.status_code == 200
    assert all(t["revoked_at"] is not None for t in tokens.docs.values())

    # list_connections reads the same naive expires_at values and must not
    # raise, and must correctly report 0 active tokens now that all are revoked.
    result = _run(oauth.list_connections(user={"email": "user@example.com"}))
    assert result["connections"][0]["active_tokens"] == 0


def test_resolve_mcp_principal_accepts_naive_future_expires_at(monkeypatch):
    tokens = _FakeCollection()
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)
    raw = _seed_access_token(tokens, scopes=["accounts:read"])
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    tokens.docs[token_hash]["expires_at"] = tokens.docs[token_hash]["expires_at"].replace(tzinfo=None)

    principal = _run(mcp.resolve_mcp_principal(_FakeRequestWithAuth(raw)))
    assert principal["uid"] == "user@example.com"
    assert principal["scopes"] == {"accounts:read"}


def test_resolve_mcp_principal_rejects_naive_past_expires_at(monkeypatch):
    tokens = _FakeCollection()
    monkeypatch.setattr(mcp, "oauth_tokens_col", tokens)
    raw = _seed_access_token(tokens, scopes=["accounts:read"], expires_delta=timedelta(minutes=-5))
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    tokens.docs[token_hash]["expires_at"] = tokens.docs[token_hash]["expires_at"].replace(tzinfo=None)

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
    # Not actually reached in this test (the scope check fails before
    # check_mcp_allowance ever runs), but kept installed at F9's real patch
    # point (app.core.subscription, not app.routers.mcp, which no longer
    # imports get_subscription at all) so this stays correct if that changes.
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)
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
