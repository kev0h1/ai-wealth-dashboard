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
    # A95: GET /logo/{domain} proxies to Logo.dev/Google's favicon service
    # server-side on a cache miss (app/routers/logos.py), so an unbounded
    # caller is a real upstream-cost/amplification vector even though it
    # carries no data exposure of its own. The auth middleware's
    # /auth//webhooks//logo/ branch (app.core.auth.auth_middleware) is the
    # only place check_rate_limit() runs for this prefix. Sized from actual
    # frontend usage: the only call site is TransactionRow.tsx (one <img>
    # per transaction row, keyed by merchant domain), and the largest list
    # rendering it paginates at 20 rows (AccountsPage.tsx's PAGE_SIZE), with
    # Home's own recent-transactions widget rendering a handful more.
    # 120/60 gives several times that per minute, enough headroom for
    # scrolling through a few pages or bouncing between screens inside a
    # minute, while still bounding a flood of distinct/unknown domains.
    ("/logo/", 120, 60),
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


# A27: catch-all, applied by app.core.auth.auth_middleware to every request
# that reaches a protected route. /health, /docs, /openapi.json, /redoc
# (_OPEN_PATHS) and, when MCP_CONNECTOR_ENABLED, the three MCP discovery
# documents (_MCP_OPEN_PATHS) return before the middleware ever gets this
# far, so they're the only paths genuinely outside it. /auth/, /webhooks/
# and /logo/ used to return before this check too (the exact gap A95 closed
# for /logo/, which had no RULES entry at all); the middleware's branch for
# those three prefixes now calls check_catch_all_ip_limit itself, after
# check_rate_limit passes, as a backstop behind their own tighter RULES
# entries. /push/test, /push/client-diagnostic and /mcp were never actually
# exempt either, despite what this comment used to say: none of those three
# paths ever matched the /auth//webhooks//logo/ branch, so they always fell
# through to this same IP-keyed check like any other protected route;
# /push/test and /push/client-diagnostic additionally get their own
# tighter RULES-based limit from inside their own handler (the first line
# of each), and /mcp's own per-principal burst/daily limits
# (app.routers.mcp) apply on top of, not instead of, this IP catch-all —
# only the PER-USER catch-all below is skipped for an MCP OAuth
# (sorted_at_) token, in favour of that per-principal tier. Two tiers, both
# checked on the SAME request when it resolves to a real identity:
#
# - CATCH_ALL_IP_LIMIT: keyed by IP, checked for every request reaching a
#   protected route REGARDLESS of whether the bearer token turns out valid.
#   Closes the gap an identity-only limit would leave open: an
#   unauthenticated caller spamming garbage/expired bearer tokens at a
#   protected route still does real work per request (signature
#   verification, and for a `sorted_bot_` token a Mongo lookup — A28), and
#   was previously not rate-limited at all outside the /auth/ prefix.
# - CATCH_ALL_USER_LIMIT: keyed by the resolved identity (email, or a bot
#   credential's name — A28) once a request's token actually validates.
#   Generous: a real Home screen load fires on the order of 10-15 requests
#   in the first second or two (app/components/HomePage.tsx alone issues
#   6, plus its child components and the idle /spend prefetch), so this
#   window leaves roughly 20x that headroom for a user reloading a few
#   times inside a minute.
#
# EXPENSIVE_PREFIXES get a tighter budget on top of (not instead of) the
# general per-user limit: full-text transaction search, the Safe-to-Spend
# calculation, cashflow, the spend verdict, the money-shape instrument and
# savings-insights all run a real aggregation or a multi-step recompute per
# call, unlike a plain single-document read.
#
# A36: EXPENSIVE_USER_LIMIT is a PER-PREFIX budget, not one pool shared
# across all six — see check_catch_all_user_limit below, which keys the
# bucket on the matched prefix as well as the identity. Originally (A27) all
# six shared one 30/60 bucket, which a post-merge review (2026-09-15) found
# ordinary navigation could exhaust: reading the frontend call graph
# (HomePage.tsx, SpendPage.tsx, PlanningPage.tsx, verdictCache.ts,
# moneyShape.ts) shows a single Home mount alone fires five of these
# six-prefix requests (safe-to-spend, transactions/search, cashflow via
# UpcomingBillsStrip, savings-insights/spotlight via HomeInsightSpotlight,
# and spend/verdict via the idle warm-up), Spend adds three more
# (spend/verdict revalidation, money-shape, savings-insights list), and
# Upcoming adds one more cashflow call — 9 hits to the shared pool from a
# single Home -> Spend -> Upcoming -> Planning -> Home lap, well over what a
# genuinely realistic minute of browsing (a couple of such laps) leaves
# headroom for once notifications/tips/search are added on top. No single
# prefix in that walk was hit more than twice, so keying each prefix's own
# 30/60 budget separately (rather than raising the shared number, which
# would just make a genuine single-endpoint flood — e.g. the original A27
# probe of 35 sequential /safe-to-spend calls — harder to catch) keeps every
# individual endpoint exactly as protected as A27 originally intended while
# no longer letting a Spend visit's /money-shape calls eat into Upcoming's
# /cashflow budget or vice versa. A script hammering any ONE of these six
# prefixes more than 30 times in 60 seconds — the original abuse pattern —
# still trips a 429 on that prefix, unchanged from A27.
CATCH_ALL_IP_LIMIT = (600, 60)
CATCH_ALL_USER_LIMIT = (300, 60)
EXPENSIVE_PREFIXES = (
    "/transactions/search", "/safe-to-spend", "/cashflow",
    "/spend/verdict", "/money-shape", "/savings-insights",
)
EXPENSIVE_USER_LIMIT = (30, 60)


def client_ip(request: Request) -> str:
    # A27: `getattr(..., None)` rather than `request.client` directly — a
    # real Starlette Request always has this attribute (None or a Client),
    # but this function is now called for every protected request (not
    # just the /auth/, /webhooks/, /push/* prefixes that used to be its
    # only callers), and several existing tests exercise app.core.auth's
    # middleware with a minimal hand-rolled fake Request that never set
    # `.client` at all — a real attribute error there shouldn't crash
    # request handling, it should just fall back to "unknown" same as a
    # real request with no client info.
    client = getattr(request, "client", None)
    return (
        request.headers.get("X-Real-IP")
        or (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        or (client.host if client else "unknown")
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


def _too_many_requests(retry_after: int) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests"},
        headers={"Retry-After": str(retry_after)},
    )


async def check_catch_all_ip_limit(request: Request) -> JSONResponse | None:
    """A27: IP-keyed, applied to every request reaching a protected route
    regardless of whether it ever resolves to a valid identity — see the
    CATCH_ALL_IP_LIMIT module comment for why this has to exist
    independently of the per-user check below (an unauthenticated caller
    never reaches an identity to key by)."""
    limit, window = CATCH_ALL_IP_LIMIT
    key = f"catchall-ip:{client_ip(request)}"
    retry_after = await check_keyed_limit(key, limit, window)
    return _too_many_requests(retry_after) if retry_after is not None else None


async def check_catch_all_user_limit(request: Request, identity: str) -> JSONResponse | None:
    """A27: keyed by the resolved caller identity (a real user's email, or
    a bot credential's name — A28), not IP — two different real users
    behind the same NAT/office IP must not share a budget, and a single
    user switching networks must not get a fresh one. Checks the general
    per-user budget, then (only if that passes) the tighter per-user
    budget for EXPENSIVE_PREFIXES, so an expensive-endpoint caller is
    bound by whichever of the two limits is stricter.

    A36: the expensive-tier bucket is keyed by (matched prefix, identity),
    not identity alone — each of the six EXPENSIVE_PREFIXES gets its own
    30/60 budget instead of all six sharing one pool. See the
    EXPENSIVE_PREFIXES module comment for the measured browsing pattern
    that made the shared pool a false positive risk, and for what abuse
    pattern this still stops."""
    general_limit, general_window = CATCH_ALL_USER_LIMIT
    key = f"catchall-user:{identity}"
    retry_after = await check_keyed_limit(key, general_limit, general_window)
    if retry_after is not None:
        return _too_many_requests(retry_after)

    path = request.url.path
    matched_prefix = next((p for p in EXPENSIVE_PREFIXES if path.startswith(p)), None)
    if matched_prefix is not None:
        exp_limit, exp_window = EXPENSIVE_USER_LIMIT
        exp_key = f"catchall-user-expensive:{matched_prefix}:{identity}"
        retry_after = await check_keyed_limit(exp_key, exp_limit, exp_window)
        if retry_after is not None:
            return _too_many_requests(retry_after)
    return None
