"""In-process sliding-window rate limiter.

Good for a single-instance deploy. For multi-instance prod, swap the store
for Redis (same interface) — limits here are per-process otherwise.
"""
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse

_hits: dict[str, deque] = defaultdict(deque)

# (path prefix, max requests, window seconds) — first match wins
RULES = [
    ("/auth/",    30, 60),
    ("/webhooks/", 60, 60),
]


def client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Real-IP")
        or (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


def check_rate_limit(request: Request) -> JSONResponse | None:
    """Return a 429 response if the caller exceeded the limit, else None."""
    path = request.url.path
    for prefix, limit, window in RULES:
        if path.startswith(prefix):
            key = f"{prefix}:{client_ip(request)}"
            now = time.monotonic()
            q = _hits[key]
            while q and q[0] < now - window:
                q.popleft()
            if len(q) >= limit:
                return JSONResponse(status_code=429, content={"detail": "Too many requests"})
            q.append(now)
            return None
    return None
