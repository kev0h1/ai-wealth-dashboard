"""Authentication dependency and HTTP middleware."""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from itsdangerous import SignatureExpired, BadSignature
from app.core import bot_credentials
from app.core import ratelimit
from app.core.config import (
    API_PUBLIC_URL, MCP_CONNECTOR_ENABLED, SESSION_MAX_AGE, serializer,
)
from app.core.ratelimit import check_rate_limit
from app.core.session_revocation import is_revoked

# F2/F8/F11: the value an unauthenticated (or expired-token) request to /mcp
# gets back in its 401's WWW-Authenticate header, per RFC 9728. This is how
# an MCP client (Claude, ChatGPT, ...) discovers that this resource has an
# OAuth authorisation server at all, without a human having to paste a URL
# into it first. Shared with app.routers.mcp.resolve_mcp_principal, which
# raises the SAME header on a present-but-invalid/revoked/expired
# `sorted_at_...` access token (a different failure path, same signal).
#
# Built from API_PUBLIC_URL (path-preserving), not MCP_ORIGIN (scheme+host
# only, path stripped). On UAT (and prod once A18's DNS work lands) this
# backend sits behind a reverse proxy (nginx on UAT, Vercel's /api rewrite
# in prod) that only forwards paths under /api to this service, so the
# well-known document is only reachable at API_PUBLIC_URL's own path
# (e.g. https://uat.wealth.auriqltd.co.uk/api/.well-known/...). An
# origin-only URL built from MCP_ORIGIN would 404 against a proxy that
# never exposes /.well-known/* at the site root. See F11 for the bug this
# fixed (the header pointed at a bare origin the proxy didn't route).
MCP_WWW_AUTHENTICATE = f'Bearer resource_metadata="{API_PUBLIC_URL}/.well-known/oauth-protected-resource"'

# Paths open to anyone, no bearer token required at all (distinct from the
# /auth/, /webhooks/, /logo/ prefixes above, which are open but still
# rate-limited).
_OPEN_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

# F2 discovery documents (RFC 8414 / RFC 9728), which must be readable by an
# MCP client before it has ANY credential, but ONLY when the connector is
# turned on (A17: MCP_CONNECTOR_ENABLED, default false). With it off these
# behave like any other unknown route: the normal bearer check below runs,
# and since app.routers.oauth isn't even registered in app.main, an
# authorised request still 404s at routing.
_MCP_OPEN_PATHS = {
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/.well-known/openid-configuration",
}


async def current_user(request: Request) -> dict:
    """FastAPI dependency: extract & validate session token.

    A28: a `sorted_bot_...` bearer is a named, scoped service credential
    (app.core.bot_credentials), resolved and scope-checked here as well as
    in `auth_middleware` below (deliberate double-check, not redundant
    dead code — see that function's docstring). This is the ONLY place a
    bot credential's use gets audited (`record_use`), so a route reached
    via a bot credential is audited exactly once per request, even though
    both this dependency and the middleware validate it. Unlike the old
    BOT_SECRET check, the returned principal never carries a real email —
    `email` is always `None` for a bot, which is what stops it reading or
    writing any route that scopes itself to `user["email"]`/
    `user.get("email")` (audited across every router 2026-09-14: that's
    almost all of them). A bot principal only ever reaches a route in
    `bot_credentials.ROUTE_SCOPES`; everywhere else this raises 401/403
    before the route body ever runs.

    A32: `cred is None` (unknown, malformed, revoked, or expired token —
    `resolve_bot_credential` gives all four the same shape) also writes an
    aggregated `record_unknown_attempt` row. See that function's docstring
    for why aggregated rather than one-per-attempt, and
    `auth_middleware`'s own call for why this branch is unreachable for
    that case in real traffic (the middleware always blocks it first) but
    kept here anyway for tests/future code paths that reach this
    dependency directly."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = auth[7:]
    if token.startswith(bot_credentials.TOKEN_PREFIX):
        ok, cred = await bot_credentials.check_bot_request(request.method, request.url.path, token)
        if cred is not None:
            await bot_credentials.record_use(cred["bot_name"], request.method, request.url.path, ok, token=token)
        else:
            await bot_credentials.record_unknown_attempt(
                request.method, request.url.path, ratelimit.client_ip(request)
            )
        if not ok:
            status = 401 if cred is None else 403
            detail = "Invalid or revoked credential" if cred is None else "Credential not authorised for this route"
            raise HTTPException(status, detail)
        return {"name": "Bot", "email": None, "bot_name": cred["bot_name"], "scopes": cred["scopes"]}
    try:
        data, issued_at = serializer.loads(token, max_age=SESSION_MAX_AGE, return_timestamp=True)
        result = data if isinstance(data, dict) else {"email": "unknown", "name": ""}
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Session expired")

    # A84: a session token is a stateless signature with no id of its own,
    # so revocation works by cutoff, not by blocklisting individual tokens
    # — `is_revoked` is true when this token was ISSUED before the email's
    # most recent revoke_sessions() call (DELETE /account, or the dormant
    # sweep). Fails CLOSED: a tombstone-lookup error must not silently let
    # a possibly-revoked token through as if nothing happened.
    try:
        if await is_revoked(result.get("email"), issued_at):
            raise HTTPException(401, "Session expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Session check unavailable")

    # Back the dormant-account sweep's 12-month clock (SECURITY.md section
    # 6): stamp_activity is throttled to ~once per 6h per user and swallows
    # its own errors, so a DB hiccup here can never fail this request.
    try:
        from app.services.retention import stamp_activity
        await stamp_activity(result.get("email"))
    except Exception:
        pass

    return result


async def auth_middleware(request: Request, call_next):
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if path.startswith("/auth/") or path.startswith("/webhooks/") or path.startswith("/logo/"):
        # A95: check_rate_limit only returns non-None when a RULES prefix
        # both matched AND the caller was over that prefix's own budget, so
        # passing it (None) means either "under budget on a matched rule"
        # or "no RULES entry matches this path at all" — the two are
        # indistinguishable from the return value alone, and /logo/ used to
        # be the latter with no rule of its own (A95's finding). Falling
        # through to the same IP catch-all every other protected route
        # gets closes that gap for any future prefix added to this branch
        # without its own RULES entry, not just /logo/ today. A tighter,
        # more specific RULES entry (e.g. /logo/'s new rule, or /auth/'s
        # 30/60) still fires its own 429 first above when it's the
        # stricter limit; this is a backstop, not a replacement.
        if limited := await check_rate_limit(request):
            return limited
        if limited := await ratelimit.check_catch_all_ip_limit(request):
            return limited
        return await call_next(request)
    if path in _OPEN_PATHS or (MCP_CONNECTOR_ENABLED and path in _MCP_OPEN_PATHS):
        return await call_next(request)
    # F2/F3: an unauthenticated hit on /mcp gets the discovery header
    # attached to its 401 (both branches below), so an MCP client can find
    # this server's authorisation server on its very first, credential-less
    # request rather than needing it hand-configured. Deliberately scoped to
    # /mcp itself (exact path or a sub-path) — this header is an MCP-specific
    # discovery signal, not a generic "you're unauthenticated" hint, so no
    # other route should ever emit it. Gated on MCP_CONNECTOR_ENABLED (A17):
    # with the connector off, /mcp is just an unregistered path like any
    # other and gets the plain 401/404 treatment, no discovery header.
    is_mcp_path = MCP_CONNECTOR_ENABLED and (path == "/mcp" or path.startswith("/mcp/"))
    mcp_headers = {"WWW-Authenticate": MCP_WWW_AUTHENTICATE} if is_mcp_path else None
    # A27: IP-keyed catch-all, checked for EVERY request that reaches this
    # point — before the bearer token is even looked at, so a caller
    # spamming garbage/expired tokens at a protected route (real work per
    # request: signature verification, and for a sorted_bot_ token a Mongo
    # lookup — A28) is bounded too, not just a caller who eventually
    # resolves to a real identity. See app.core.ratelimit's module comment
    # for the limit and the per-user tier applied further down.
    if limited := await ratelimit.check_catch_all_ip_limit(request):
        return limited
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"}, headers=mcp_headers)
    token = auth[7:]
    if token.startswith(bot_credentials.TOKEN_PREFIX):
        # A28: validated here too (not just in `current_user`) so a bot
        # credential is refused at the front door for any route this
        # middleware would otherwise wave through — defence in depth,
        # in case a future route is ever added without a `current_user`
        # dependency of its own. No SUCCESSFUL-use audit write here:
        # `current_user` (which every route in bot_credentials.ROUTE_SCOPES
        # already depends on) is the single place a use gets logged, so a
        # request that gets this far and passes is audited exactly once,
        # not twice.
        #
        # A32: an unresolved credential (cred is None: unknown, malformed,
        # revoked, or expired) IS audited here, because this middleware —
        # not `current_user` — is the actual enforcement point a real
        # request hits: it returns 401 directly, without calling
        # `call_next`, so `current_user`'s own dependency never runs and
        # its matching audit call is unreachable for this exact case in
        # real traffic. Aggregated, not one row per attempt — see
        # `record_unknown_attempt`'s docstring.
        ok, cred = await bot_credentials.check_bot_request(request.method, path, token)
        if cred is None:
            await bot_credentials.record_unknown_attempt(request.method, path, ratelimit.client_ip(request))
        if not ok:
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"}, headers=mcp_headers)
        # A27: per-caller catch-all, keyed by the credential's own name —
        # bot-eligible routes are already low-volume/scope-gated, but this
        # keeps the same defence-in-depth this middleware applies to real
        # users.
        if limited := await ratelimit.check_catch_all_user_limit(request, f"bot:{cred['bot_name']}"):
            return limited
        return await call_next(request)
    if token.startswith("sorted_at_") and is_mcp_path:
        # F2 OAuth access token, on the one path it's ever valid for: this
        # is not an itsdangerous session token, so the signature check
        # below would always fail it. Real per-token validation (hash
        # lookup, kind, revocation, expiry) is
        # app.routers.mcp.resolve_mcp_principal's job, the only consumer of
        # these tokens. Scoped to /mcp specifically (not a blanket
        # "any sorted_at_ token passes"): letting a connector's access
        # token clear the middleware for every OTHER route too would rely
        # entirely on each handler's own `current_user` dependency to
        # reject it, which is not a bet this middleware should make.
        # `sorted_rt_` refresh tokens never get a pass here at all — they
        # are only ever presented to /auth/oauth/token and
        # /auth/oauth/revoke, both under the already-public /auth/ prefix
        # handled above, so a refresh token never even reaches this line
        # for its own legitimate use.
        #
        # A27: the catch-all does NOT apply here — F7 already gave the MCP
        # connector its own per-principal burst/daily limits, keyed by
        # OAuth client_id/uid (app.routers.mcp, via check_keyed_limit
        # directly), tuned for that surface's own call shape. Stacking the
        # generic catch-all on top would just be a second, uncoordinated
        # limit on the same traffic.
        return await call_next(request)
    try:
        data = serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (SignatureExpired, BadSignature):
        return JSONResponse(status_code=401, content={"detail": "Session expired"}, headers=mcp_headers)
    # A27: per-user catch-all — keyed by the session's own email, not IP,
    # so two users behind the same NAT/office network don't share a budget
    # and one user roaming networks doesn't get a fresh one. `data` is
    # whatever current_user would also decode from this same token; a
    # malformed-but-signature-valid payload (no "email") falls back to the
    # raw token string as the key, same fail-safe current_user itself uses
    # ({"email": "unknown", ...}) — still a real per-caller bound, just not
    # a human-readable one.
    identity = data.get("email") if isinstance(data, dict) else None
    if limited := await ratelimit.check_catch_all_user_limit(request, identity or token):
        return limited
    return await call_next(request)
