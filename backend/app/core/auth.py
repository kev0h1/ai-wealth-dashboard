"""Authentication dependency and HTTP middleware."""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from itsdangerous import SignatureExpired, BadSignature
from app.core.config import (
    BOT_SECRET, MCP_CONNECTOR_ENABLED, MCP_ORIGIN, SESSION_MAX_AGE, serializer,
)
from app.core.ratelimit import check_rate_limit

# F2/F8: the value an unauthenticated (or expired-token) request to /mcp
# gets back in its 401's WWW-Authenticate header, per RFC 9728 — this is how
# an MCP client (Claude, ChatGPT, ...) discovers that this resource has an
# OAuth authorisation server at all, without a human having to paste a URL
# into it first. Shared with app.routers.mcp.resolve_mcp_principal, which
# raises the SAME header on a present-but-invalid/revoked/expired
# `sorted_at_...` access token (a different failure path, same signal).
# Points at MCP_ORIGIN (derived from MCP_PUBLIC_URL), not the API's own
# origin — the well-known document must live at the connector's own host,
# which differs from the API host once MCP_PUBLIC_URL is a dedicated
# hostname.
MCP_WWW_AUTHENTICATE = f'Bearer resource_metadata="{MCP_ORIGIN}/.well-known/oauth-protected-resource"'

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
}


async def current_user(request: Request) -> dict:
    """FastAPI dependency: extract & validate session token."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = auth[7:]
    if BOT_SECRET and token == BOT_SECRET:
        return {"email": "kevin.maingi12@gmail.com", "name": "Bot"}
    try:
        data = serializer.loads(token, max_age=SESSION_MAX_AGE)
        result = data if isinstance(data, dict) else {"email": "unknown", "name": ""}
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Session expired")

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
        if limited := await check_rate_limit(request):
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
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"}, headers=mcp_headers)
    token = auth[7:]
    if BOT_SECRET and token == BOT_SECRET:
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
        return await call_next(request)
    try:
        serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (SignatureExpired, BadSignature):
        return JSONResponse(status_code=401, content={"detail": "Session expired"}, headers=mcp_headers)
    return await call_next(request)
