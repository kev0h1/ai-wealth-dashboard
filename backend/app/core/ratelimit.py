"""Sliding-window rate limiter.

Redis-backed so limits are shared across Railway replicas (D4 in TODO.md):
each rule's key is a sorted set `rl:<prefix>:<ip>` scored by request time,
trimmed to the window on every check. If Redis is unreachable (or
`redis_ok()` says it's down), this falls back to the original in-process
deque so the endpoint still degrades to a working (if per-process) limit
rather than failing open or falling over.
"""
import time
import uuid
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.redis_client import get_redis, redis_ok

_hits: dict[str, deque] = defaultdict(deque)

# (path prefix, max requests, window seconds) — first match wins
RULES = [
    ("/auth/",    30, 60),
    ("/webhooks/", 60, 60),
    # The auth middleware only calls check_rate_limit() for /auth/, /webhooks/
    # and /logo/ prefixes, so this rule is inert unless /push/test calls
    # check_rate_limit() itself (it does, as the first line of the handler).
    ("/push/test", 5, 60),
    # Same pattern as /push/test above: /push/client-diagnostic calls
    # check_rate_limit() itself as the first line of its handler. Higher
    # than /push/test's limit because a client-side registration retry loop
    # could otherwise flood this endpoint with failure reports.
    ("/push/client-diagnostic", 20, 60),
]


def client_ip(request: Request) -> str:
    return (
        request.headers.get("X-Real-IP")
        or (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )


def _check_local(key: str, limit: int, window: int) -> bool:
    """Original in-process deque check. Returns True if the request is
    over the limit (should be rejected)."""
    now = time.monotonic()
    q = _hits[key]
    while q and q[0] < now - window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


async def _check_redis(key: str, limit: int, window: int) -> bool | None:
    """Sorted-set sliding window in Redis. Returns True/False if it could
    check, or None if Redis failed (caller should fall back to local).

    The rejected request's own attempt is still recorded (single pipeline,
    one round trip) rather than skipped, so a client hammering the endpoint
    doesn't get a free slot back the instant it stops; the whole key expires
    `window` seconds after the last request either way, so a genuinely idle
    client always recovers.
    """
    client = get_redis()
    if client is None:
        return None
    try:
        now = time.time()
        member = f"{now}:{uuid.uuid4()}"
        pipe = client.pipeline()
        pipe.zremrangebyscore(key, 0, now - window)
        pipe.zcard(key)
        pipe.zadd(key, {member: now})
        pipe.expire(key, window)
        results = await pipe.execute()
        count_before_add = results[1]
        return count_before_add >= limit
    except Exception:
        return None


async def check_rate_limit(request: Request) -> JSONResponse | None:
    """Return a 429 response if the caller exceeded the limit, else None."""
    path = request.url.path
    for prefix, limit, window in RULES:
        if path.startswith(prefix):
            key = f"{prefix}:{client_ip(request)}"
            over_limit: bool | None = None
            if await redis_ok():
                over_limit = await _check_redis(f"rl:{key}", limit, window)
            if over_limit is None:
                over_limit = _check_local(key, limit, window)
            if over_limit:
                return JSONResponse(status_code=429, content={"detail": "Too many requests"})
            return None
    return None
