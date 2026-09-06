"""Mobile OAuth "pending" hand-off store.

Chrome Custom Tabs won't launch an app-scheme redirect (wealthdash://) from
a server redirect without a user gesture, so the mobile app can't reliably
get the token back via a deep link. Instead the app opens login with a
one-time `state` id and polls for the result; the OAuth callback stashes the
outcome here keyed by state.

Backed by Redis (key `auth:pending:<state>`, TTL 300s, single GETDEL read so
a poll can never see the same value twice) so this survives across Railway
replicas (D4 in TODO.md) — the callback and the poll can land on different
instances. Falls back to an in-process dict with the same TTL semantics
when Redis is unavailable.
"""
import time

from app.core.redis_client import get_redis, redis_ok

_PENDING_TTL = 300
_KEY_PREFIX = "auth:pending:"

# In-process fallback: state -> (value, expires_at_epoch_seconds)
_pending: dict[str, tuple[str, float]] = {}


def _local_store(state: str, value: str) -> None:
    now = time.time()
    _pending[state] = (value, now + _PENDING_TTL)
    for k in [k for k, (_, exp) in _pending.items() if exp < now]:
        _pending.pop(k, None)


def _local_pop(state: str) -> str | None:
    entry = _pending.pop(state, None)
    if not entry:
        return None
    value, expires_at = entry
    if expires_at < time.time():
        return None
    return value


async def _store_pending(state: str, value: str) -> None:
    if await redis_ok():
        client = get_redis()
        try:
            await client.set(f"{_KEY_PREFIX}{state}", value, ex=_PENDING_TTL)
            return
        except Exception:
            pass
    _local_store(state, value)


async def _pop_pending(state: str) -> str | None:
    if await redis_ok():
        client = get_redis()
        try:
            # GETDEL: atomic read-then-delete, so a poll can never observe
            # the same value twice even if two requests race.
            return await client.getdel(f"{_KEY_PREFIX}{state}")
        except Exception:
            pass
    return _local_pop(state)
