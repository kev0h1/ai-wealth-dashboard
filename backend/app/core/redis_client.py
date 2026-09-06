"""Shared async Redis client for cross-process state (rate limiting, mobile
login polling) — see D4 in TODO.md. A single Railway replica never needed
this (in-process dict/deque were fine); more than one replica does, because
each would otherwise see its own private counters/pending-login store.

Everything here is best-effort: a Redis outage must degrade the callers to
their existing per-process fallback, never raise into a request handler.
"""
import time

import redis.asyncio as redis

from app.core.config import REDIS_URL

_client: "redis.Redis | None" = None

# redis_ok() probe result cache: (ok, checked_at_monotonic). A down Redis
# should cost at most one connection attempt per _OK_TTL seconds, not one
# per request.
_OK_TTL = 30.0
_ok_cache: tuple[bool, float] | None = None


def get_redis() -> "redis.Redis | None":
    """Lazily create the module-level client. Never raises: construction of
    a redis.asyncio.Redis object doesn't itself connect, but wrap it anyway
    so a malformed REDIS_URL can't take a request down."""
    global _client
    if _client is None:
        try:
            _client = redis.Redis.from_url(
                REDIS_URL,
                decode_responses=True,
                socket_timeout=0.5,
                socket_connect_timeout=0.5,
            )
        except Exception:
            _client = None
    return _client


async def redis_ok() -> bool:
    """True if Redis answered a PING recently. Caches the result for
    _OK_TTL seconds so a down Redis is only probed about twice a minute,
    not on every rate-limited or pending-login request."""
    global _ok_cache
    now = time.monotonic()
    if _ok_cache is not None and (now - _ok_cache[1]) < _OK_TTL:
        return _ok_cache[0]
    client = get_redis()
    ok = False
    if client is not None:
        try:
            ok = bool(await client.ping())
        except Exception:
            ok = False
    _ok_cache = (ok, now)
    return ok


def reset_for_tests() -> None:
    """Drop the cached client and probe result so tests can monkeypatch
    redis_ok()/get_redis() cleanly between cases."""
    global _client, _ok_cache
    _client = None
    _ok_cache = None
