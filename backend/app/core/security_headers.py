"""A27: security-headers HTTP middleware — the backend counterpart of
frontend/next.config.ts's `securityHeaders()`. Registered as the OUTERMOST
middleware in app.main.build_app (before CORS/GZip/auth), so it runs on
every response this process ever sends: successful, 401/403 from
auth_middleware, 429 from the rate limiter, even a CORS preflight — there
is no path through this app that skips it.

This API is consumed two ways: the Next.js frontend's server-side
`/api/:path*` rewrite (never a browser fetching this origin directly), and
the MCP connector / native app clients. It never renders HTML for a
browser and is never meant to be embedded, so its Content-Security-Policy
can be the strictest possible shape — `default-src 'none'` — unlike
frontend/next.config.ts's CSP, which has to allow for an actual page
(scripts, inline styles, images, same-origin fetches). The one exception
is `/docs`/`/redoc`/`/openapi.json` (Swagger UI, ENABLE_API_DOCS-gated,
must stay unset in production per docs/ops/ENV.md): those render actual
HTML with their own inline scripts/styles, so CSP is skipped there
specifically rather than shipping a policy that would break Swagger UI
the one time someone turns the flag on locally. Every other header still
applies to those three paths.
"""
from fastapi import Request

_PERMISSIONS_POLICY = (
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), "
    "magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()"
)

_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

_CSP_EXEMPT_PATHS = {"/docs", "/redoc", "/openapi.json"}


async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = _PERMISSIONS_POLICY
    if request.url.path not in _CSP_EXEMPT_PATHS:
        response.headers["Content-Security-Policy"] = _CSP
    return response
