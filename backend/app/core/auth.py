"""Authentication dependency and HTTP middleware."""
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from itsdangerous import SignatureExpired, BadSignature
from app.core.config import BOT_SECRET, SESSION_MAX_AGE, serializer
from app.core.ratelimit import check_rate_limit


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
    if path in {"/health", "/docs", "/openapi.json", "/redoc"}:
        return await call_next(request)
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    token = auth[7:]
    if BOT_SECRET and token == BOT_SECRET:
        return await call_next(request)
    try:
        serializer.loads(token, max_age=SESSION_MAX_AGE)
    except (SignatureExpired, BadSignature):
        return JSONResponse(status_code=401, content={"detail": "Session expired"})
    return await call_next(request)
