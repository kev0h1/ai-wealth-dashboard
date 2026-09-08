"""F2: OAuth 2.1 authorisation server with PKCE and dynamic client
registration, so a user's own AI assistant (Claude, ChatGPT, ...) can
connect to `/mcp` (app/routers/mcp.py) the way those clients expect,
instead of the F3 stopgap of pasting a session bearer into a custom
connector. See docs/pricing/tiering-unit-economics-mcp-2026-09.md section 7
for the design brief this implements.

Sorted is a public-client-only authorisation server (no client secrets —
`token_endpoint_auth_method: "none"` everywhere): every connector is a
native or browser app that cannot keep a secret, so PKCE (S256, mandatory)
is the entire defence against authorization-code interception, per the
OAuth 2.1 draft this is built against.

Grant flow, end to end:

1. `POST /auth/oauth/register` — the connector registers itself (RFC 7591)
   and gets back a `client_id`. No approval step; any https (or loopback)
   redirect URI is accepted, same as Claude's/ChatGPT's own connector UX
   expects.
2. `GET /auth/oauth/authorize` — the connector sends the user's browser
   here with `client_id`, `redirect_uri`, `scope`, `state`, `code_challenge`
   (S256). This endpoint validates everything BEFORE trusting the
   `redirect_uri` at all (an unknown client or an unregistered redirect
   must never become an open redirect), stashes the validated request in
   `app.core.pending_oauth` and 302s the browser to the frontend's
   `/oauth/consent` page.
3. The consent page (session-authenticated) reads the pending request via
   `GET /oauth/request/{id}`, shows the user what's being asked for in
   plain language, and posts the user's choice to `POST /oauth/decision`.
   Approval mints a PKCE authorization code bound to the signed-in user;
   denial is an `error=access_denied` redirect. Either way the pending
   request is consumed (one-shot).
4. `POST /auth/oauth/token` exchanges the code (grant_type=authorization_code,
   verified against `code_verifier`) for an access + refresh token pair,
   or rotates a refresh token for a fresh pair (grant_type=refresh_token).
5. `POST /auth/oauth/revoke` (RFC 7009) and the `/oauth/connections`
   endpoints let a token (and F4's future "Connected assistants" settings
   surface) be revoked.

Every code and token is stored ONLY as a SHA-256 hash (`_hash` below) —
same doctrine as session tokens never being persisted raw. Access tokens
are prefixed `sorted_at_`, refresh tokens `sorted_rt_`, both opaque
`secrets.token_urlsafe(32)` strings; `app.routers.mcp.resolve_mcp_principal`
is the only thing that ever looks one up.
"""
import base64
import hashlib
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse

from app.core.auth import current_user
from app.core.config import API_PUBLIC_URL, APP_URL, MCP_PUBLIC_URL
from app.core.pending_oauth import get_oauth_request, pop_oauth_request, store_oauth_request
from app.db.collections import oauth_clients_col, oauth_codes_col, oauth_tokens_col
from app.routers.mcp import V1_SCOPES

router = APIRouter(tags=["oauth"])

# Plain-language scope descriptions for the consent page (F2 brief, section
# 4). Kept here rather than on mcp.py's TOOL_SCOPES map: these are
# user-facing sentences, not the tool-routing table.
SCOPE_DESCRIPTIONS: dict[str, str] = {
    "accounts:read": "Balances and account names",
    "plans:read": "Bills, plans, goals and your tax position figures",
    "insights:read": "Spending verdicts and insights",
}

ACCESS_TOKEN_TTL = 3600            # 1 hour
REFRESH_TOKEN_TTL = 30 * 24 * 3600  # 30 days
CODE_TTL = 300                      # 5 minutes


def _hash(value: str) -> str:
    """SHA-256 hex digest — the only form a code or token is ever stored in."""
    return hashlib.sha256(value.encode()).hexdigest()


def _is_valid_redirect_uri(uri: str) -> bool:
    """https with a host, or http://localhost / http://127.0.0.1 on any
    port (the loopback exception OAuth 2.1 carves out for native apps that
    spin up a local redirect listener — Claude/ChatGPT desktop connectors
    use this)."""
    try:
        parsed = urllib.parse.urlparse(uri)
    except Exception:
        return False
    if parsed.scheme == "https" and parsed.hostname:
        return True
    if parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1"):
        return True
    return False


def _oauth_error(error: str, status: int = 400, description: str | None = None) -> JSONResponse:
    """RFC 6749 section 5.2 error body."""
    body: dict = {"error": error}
    if description:
        body["error_description"] = description
    return JSONResponse(body, status_code=status)


# ── Discovery (RFC 8414 / RFC 9728) ─────────────────────────────────────

@router.get("/.well-known/oauth-authorization-server")
async def oauth_authorization_server_metadata():
    return {
        "issuer": API_PUBLIC_URL,
        "authorization_endpoint": f"{API_PUBLIC_URL}/auth/oauth/authorize",
        "token_endpoint": f"{API_PUBLIC_URL}/auth/oauth/token",
        "registration_endpoint": f"{API_PUBLIC_URL}/auth/oauth/register",
        "revocation_endpoint": f"{API_PUBLIC_URL}/auth/oauth/revoke",
        "scopes_supported": sorted(V1_SCOPES),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
    }


@router.get("/.well-known/openid-configuration")
async def openid_configuration_metadata():
    # F12: Anthropic's MCP SDK's OAuth discovery fallback chain tries, after
    # the path-aware RFC 8414 forms 404 (blocked by nginx routing outside
    # this repo), the OIDC-issuer-suffix form /.well-known/openid-configuration
    # under the resource path. We issue no id_tokens, so we are not really an
    # OpenID Provider, but strict OIDC discovery parsers still require this
    # document to exist and to carry a minimum set of keys. The three extra
    # keys below (subject_types_supported, id_token_signing_alg_values_supported,
    # plus response_types_supported, already present in the base document) exist
    # purely to satisfy that parsing, and jwks_uri is deliberately omitted
    # since we have no signing keys to publish.
    base = await oauth_authorization_server_metadata()
    return {
        **base,
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
    }


@router.get("/.well-known/oauth-protected-resource")
async def oauth_protected_resource_metadata():
    # F8: `resource` is the connector's own URL (MCP_PUBLIC_URL, a dedicated
    # host once one is provisioned); `authorization_servers` stays on the
    # API host, since the OAuth endpoints themselves (authorize/token/
    # register/revoke) never move.
    return {
        "resource": MCP_PUBLIC_URL,
        "authorization_servers": [API_PUBLIC_URL],
        "scopes_supported": sorted(V1_SCOPES),
        "bearer_methods_supported": ["header"],
    }


# ── Dynamic client registration (RFC 7591) ──────────────────────────────

@router.post("/auth/oauth/register")
async def register_client(body: dict):
    client_name = str(body.get("client_name") or "").strip()
    redirect_uris = body.get("redirect_uris")
    software_id = body.get("software_id")

    if not client_name:
        raise HTTPException(400, "client_name is required")
    if not isinstance(redirect_uris, list) or not redirect_uris:
        raise HTTPException(400, "redirect_uris must be a non-empty list")
    for uri in redirect_uris:
        if not isinstance(uri, str) or not _is_valid_redirect_uri(uri):
            raise HTTPException(
                400,
                f"redirect_uris must be https, or http://localhost or http://127.0.0.1 on any port: {uri!r}",
            )

    client_id = secrets.token_urlsafe(16)
    grant_types = ["authorization_code", "refresh_token"]
    doc = {
        "_id": client_id,
        "client_id": client_id,
        "client_name": client_name,
        "redirect_uris": redirect_uris,
        "token_endpoint_auth_method": "none",
        "grant_types": grant_types,
        "software_id": software_id,
        "created_at": datetime.now(timezone.utc),
    }
    await oauth_clients_col.insert_one(doc)
    return {
        "client_id": client_id,
        "client_name": client_name,
        "redirect_uris": redirect_uris,
        "token_endpoint_auth_method": "none",
        "grant_types": grant_types,
        "response_types": ["code"],
    }


# ── Authorize ────────────────────────────────────────────────────────────

@router.get("/auth/oauth/authorize")
async def authorize(
    response_type: str = Query(""),
    client_id: str = Query(""),
    redirect_uri: str = Query(""),
    scope: str = Query(""),
    state: str = Query(""),
    code_challenge: str = Query(""),
    code_challenge_method: str = Query(""),
):
    # An unknown client or an unregistered redirect_uri must NEVER redirect
    # anywhere — that would make this endpoint an open redirect. A plain
    # error page is the only safe response for either failure.
    client = await oauth_clients_col.find_one({"_id": client_id}) if client_id else None
    if not client:
        return PlainTextResponse(
            "Unknown client. This assistant has not been registered with Sorted.",
            status_code=400,
        )
    if redirect_uri not in client.get("redirect_uris", []):
        return PlainTextResponse(
            "This request's redirect address does not match what was registered for this client.",
            status_code=400,
        )

    def _err_redirect(error: str) -> RedirectResponse:
        params = {"error": error}
        if state:
            params["state"] = state
        return RedirectResponse(f"{redirect_uri}?{urllib.parse.urlencode(params)}", status_code=302)

    if response_type != "code":
        return _err_redirect("unsupported_response_type")
    if not state:
        return _err_redirect("invalid_request")
    if code_challenge_method != "S256" or not code_challenge:
        return _err_redirect("invalid_request")
    scopes = [s for s in scope.split() if s]
    if not scopes or not set(scopes).issubset(V1_SCOPES):
        return _err_redirect("invalid_scope")

    req_id = secrets.token_urlsafe(16)
    await store_oauth_request(req_id, {
        "client_id": client_id,
        "client_name": client["client_name"],
        "redirect_uri": redirect_uri,
        "scopes": scopes,
        "state": state,
        "code_challenge": code_challenge,
    })
    return RedirectResponse(f"{APP_URL}/oauth/consent?req={req_id}", status_code=302)


# ── Consent page support (session-authenticated) ────────────────────────

@router.get("/oauth/request/{req_id}")
async def get_oauth_request_details(req_id: str, user: dict = Depends(current_user)):
    data = await get_oauth_request(req_id)
    if not data:
        raise HTTPException(404, "This request has expired. Please try connecting again.")
    host = urllib.parse.urlparse(data["redirect_uri"]).hostname or data["redirect_uri"]
    return {
        "client_name": data["client_name"],
        "redirect_host": host,
        "scopes": [
            {"scope": s, "description": SCOPE_DESCRIPTIONS.get(s, s)}
            for s in data["scopes"]
        ],
    }


@router.post("/oauth/decision")
async def decide_oauth_request(body: dict, user: dict = Depends(current_user)):
    req_id = str(body.get("req_id") or "")
    approve = bool(body.get("approve"))
    data = await pop_oauth_request(req_id)
    if not data:
        raise HTTPException(404, "This request has expired. Please try connecting again.")

    redirect_uri = data["redirect_uri"]
    state = data["state"]

    if not approve:
        return {"redirect": f"{redirect_uri}?{urllib.parse.urlencode({'error': 'access_denied', 'state': state})}"}

    code = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await oauth_codes_col.insert_one({
        "_id": _hash(code),
        "client_id": data["client_id"],
        "uid": user.get("email"),
        "redirect_uri": redirect_uri,
        "scopes": data["scopes"],
        "code_challenge": data["code_challenge"],
        "created_at": now,
        "expires_at": now + timedelta(seconds=CODE_TTL),
        "used_at": None,
    })
    redirect = f"{redirect_uri}?{urllib.parse.urlencode({'code': code, 'state': state})}"
    return {"redirect": redirect}


# ── Token endpoint ───────────────────────────────────────────────────────

async def _issue_token_pair(
    client_id: str, client_name: str, uid: str, scopes: list,
    origin_code_hash: str | None, rotated_from: str | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    pair_id = secrets.token_hex(16)
    access_token = "sorted_at_" + secrets.token_urlsafe(32)
    refresh_token = "sorted_rt_" + secrets.token_urlsafe(32)

    common = {
        "client_id": client_id,
        "client_name": client_name,
        "uid": uid,
        "scopes": scopes,
        "created_at": now,
        "last_used_at": None,
        "revoked_at": None,
        "pair_id": pair_id,
        "origin_code_hash": origin_code_hash,
    }
    await oauth_tokens_col.insert_one({
        **common, "_id": _hash(access_token), "kind": "access",
        "expires_at": now + timedelta(seconds=ACCESS_TOKEN_TTL),
        "rotated_from": None,
    })
    await oauth_tokens_col.insert_one({
        **common, "_id": _hash(refresh_token), "kind": "refresh",
        "expires_at": now + timedelta(seconds=REFRESH_TOKEN_TTL),
        "rotated_from": rotated_from,
    })
    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_TTL,
        "refresh_token": refresh_token,
        "scope": " ".join(scopes),
    }


async def _handle_authorization_code_grant(form) -> JSONResponse:
    code = form.get("code")
    redirect_uri = form.get("redirect_uri")
    client_id = form.get("client_id")
    code_verifier = form.get("code_verifier")
    if not (code and redirect_uri and client_id and code_verifier):
        return _oauth_error("invalid_request")

    code_hash = _hash(code)
    doc = await oauth_codes_col.find_one({"_id": code_hash})
    if not doc:
        return _oauth_error("invalid_grant")

    now = datetime.now(timezone.utc)

    if doc.get("used_at") is not None:
        # Reuse of an already-redeemed code is a strong signal the code
        # leaked (interception, log capture, ...): revoke every token that
        # was ever minted from it, including anything refresh-rotated
        # since (origin_code_hash is carried forward through rotation).
        await oauth_tokens_col.update_many(
            {"origin_code_hash": code_hash, "revoked_at": None},
            {"$set": {"revoked_at": now}},
        )
        return _oauth_error("invalid_grant", description="Code already used")

    expires_at = doc.get("expires_at")
    if expires_at is None or expires_at <= now:
        return _oauth_error("invalid_grant", description="Code expired")
    if doc.get("client_id") != client_id:
        return _oauth_error("invalid_client")
    if doc.get("redirect_uri") != redirect_uri:
        return _oauth_error("invalid_grant", description="redirect_uri mismatch")

    expected_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()
    if not secrets.compare_digest(expected_challenge, doc.get("code_challenge", "")):
        return _oauth_error("invalid_grant", description="code_verifier mismatch")

    # Mark used BEFORE issuing tokens: a crash between these two lines only
    # ever costs the caller a retry (which now correctly hits the reuse
    # branch above), never risks issuing two live token pairs from one code.
    await oauth_codes_col.update_one({"_id": code_hash}, {"$set": {"used_at": now}})

    client = await oauth_clients_col.find_one({"_id": client_id})
    client_name = client.get("client_name") if client else client_id
    result = await _issue_token_pair(client_id, client_name, doc["uid"], doc["scopes"], code_hash)
    return JSONResponse(result)


async def _handle_refresh_token_grant(form) -> JSONResponse:
    refresh_token = form.get("refresh_token")
    client_id = form.get("client_id")
    if not (refresh_token and client_id):
        return _oauth_error("invalid_request")

    token_hash = _hash(refresh_token)
    doc = await oauth_tokens_col.find_one({"_id": token_hash})
    now = datetime.now(timezone.utc)
    if (
        not doc or doc.get("kind") != "refresh" or doc.get("revoked_at")
        or doc.get("expires_at") is None or doc["expires_at"] <= now
    ):
        return _oauth_error("invalid_grant")
    if doc.get("client_id") != client_id:
        return _oauth_error("invalid_client")

    # Rotate: the old refresh token is revoked the instant it's redeemed,
    # so it can only ever be used once (reuse of a rotated-out refresh
    # token then simply fails the revoked_at check above like any other
    # dead token).
    await oauth_tokens_col.update_one({"_id": token_hash}, {"$set": {"revoked_at": now}})

    client = await oauth_clients_col.find_one({"_id": client_id})
    client_name = client.get("client_name") if client else client_id
    result = await _issue_token_pair(
        client_id, client_name, doc["uid"], doc["scopes"],
        doc.get("origin_code_hash"), rotated_from=token_hash,
    )
    return JSONResponse(result)


@router.post("/auth/oauth/token")
async def token_endpoint(request: Request):
    form = await request.form()
    grant_type = form.get("grant_type")
    if grant_type == "authorization_code":
        return await _handle_authorization_code_grant(form)
    if grant_type == "refresh_token":
        return await _handle_refresh_token_grant(form)
    return _oauth_error("unsupported_grant_type")


# ── Revocation (RFC 7009) ────────────────────────────────────────────────

@router.post("/auth/oauth/revoke")
async def revoke_token(request: Request):
    form = await request.form()
    token = form.get("token")
    client_id = form.get("client_id")
    if not token:
        return _oauth_error("invalid_request")

    doc = await oauth_tokens_col.find_one({"_id": _hash(token)})
    if doc and (not client_id or doc.get("client_id") == client_id):
        now = datetime.now(timezone.utc)
        # Revoke the whole family (the access/refresh pair minted together),
        # not just the presented token, per the F2 brief.
        await oauth_tokens_col.update_many(
            {"pair_id": doc.get("pair_id"), "revoked_at": None},
            {"$set": {"revoked_at": now}},
        )
    # RFC 7009 section 2.2: respond 200 even for an unknown or
    # already-revoked token, so a caller (or an attacker probing token
    # validity) can't distinguish the cases.
    return JSONResponse({})


# ── Connection management (for F4's "Connected assistants" settings UI) ──

@router.get("/oauth/connections")
async def list_connections(user: dict = Depends(current_user)):
    uid = user.get("email")
    now = datetime.now(timezone.utc)
    by_client: dict[str, dict] = {}
    async for doc in oauth_tokens_col.find({"uid": uid}):
        cid = doc["client_id"]
        entry = by_client.setdefault(cid, {
            "client_id": cid,
            "client_name": doc.get("client_name") or cid,
            "scopes": set(),
            "created_at": doc["created_at"],
            "last_used_at": None,
            "active_tokens": 0,
        })
        entry["scopes"].update(doc.get("scopes") or [])
        if doc["created_at"] < entry["created_at"]:
            entry["created_at"] = doc["created_at"]
        last_used = doc.get("last_used_at")
        if last_used and (entry["last_used_at"] is None or last_used > entry["last_used_at"]):
            entry["last_used_at"] = last_used
        if not doc.get("revoked_at") and doc.get("expires_at") and doc["expires_at"] > now:
            entry["active_tokens"] += 1

    connections = [
        {
            "client_id": entry["client_id"],
            "client_name": entry["client_name"],
            "scopes": sorted(entry["scopes"]),
            "created_at": entry["created_at"].isoformat(),
            "last_used_at": entry["last_used_at"].isoformat() if entry["last_used_at"] else None,
            "active_tokens": entry["active_tokens"],
        }
        for entry in by_client.values()
    ]
    connections.sort(key=lambda c: c["created_at"], reverse=True)
    return {"connections": connections}


@router.delete("/oauth/connections/{client_id}")
async def revoke_connection(client_id: str, user: dict = Depends(current_user)):
    uid = user.get("email")
    now = datetime.now(timezone.utc)
    result = await oauth_tokens_col.update_many(
        {"uid": uid, "client_id": client_id, "revoked_at": None},
        {"$set": {"revoked_at": now}},
    )
    return {"ok": True, "revoked": result.modified_count}
