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
    # F2: dynamic client registration (RFC 7591) is unauthenticated by
    # design (that's the point of "dynamic"), so it needs its own tighter
    # cap ahead of the generic "/auth/" rule below (which would otherwise
    # win first and give it the ordinary 30/60 login-attempt budget).
    ("/auth/oauth/register", 10, 60),
    # F7: the token and authorize legs of the OAuth 2.1 flow are also
    # unauthenticated by design (that's what makes them the *authorisation*
    # server), so they get their own explicit entries here rather than
    # silently falling through to the generic "/auth/" rule below, same
    # 30/60 budget as that rule today, but named so a future change to
    # either doesn't accidentally change the other.
    ("/auth/oauth/token", 30, 60),
    ("/auth/oauth/authorize", 30, 60),
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
    # F7 (2026-09-08): the old per-IP "/mcp" rule (60/60) lived here, but
    # Claude's and ChatGPT's connectors call from shared egress ranges, so
    # every user of the same assistant shared one IP-keyed bucket. `/mcp` is
    # authenticated on every call (session bearer or OAuth token), so it is
    # no longer an "unauthenticated path" this table needs to cover at all,
    # app.routers.mcp now applies its own per-principal burst and daily
    # limits, keyed by OAuth client_id or uid, via check_keyed_limit below.
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


async def check_keyed_limit(key: str, limit: int, window_seconds: int) -> int | None:
    """Sliding-window check for an arbitrary caller-supplied bucket key, not
    tied to the path-prefix RULES table above (F7: app.routers.mcp uses this
    directly to key by OAuth client_id/uid instead of IP). Redis-backed with
    the same in-process deque fallback `check_rate_limit` uses.

    Returns None if the request is allowed, else the number of seconds until
    the window frees up, for a Retry-After header. Computed as the time to
    the next `window_seconds`-aligned boundary since the Unix epoch (which is
    UTC midnight), so a 60s window gives "seconds to the next minute" and an
    86400s window gives "seconds to midnight UTC", both useful Retry-After
    values without tracking each bucket's own oldest entry.
    """
    over_limit: bool | None = None
    if await redis_ok():
        over_limit = await _check_redis(f"rl:{key}", limit, window_seconds)
    if over_limit is None:
        over_limit = _check_local(key, limit, window_seconds)
    if not over_limit:
        return None
    remainder = time.time() % window_seconds
    retry_after = int(window_seconds - remainder)
    return retry_after if retry_after > 0 else window_seconds


async def check_rate_limit(request: Request) -> JSONResponse | None:
    """Return a 429 response if the caller exceeded the limit, else None."""
    path = request.url.path
    for prefix, limit, window in RULES:
        if path.startswith(prefix):
            key = f"{prefix}:{client_ip(request)}"
            retry_after = await check_keyed_limit(key, limit, window)
            if retry_after is not None:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests"},
                    headers={"Retry-After": str(retry_after)},
                )
            return None
    return None
