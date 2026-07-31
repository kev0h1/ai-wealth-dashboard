"""Tiny per-user, per-process in-memory response cache.

Used for GET /today and GET /safe-to-spend — the two Home-screen endpoints
that recompute non-trivially on every request. TTL is deliberately short
(90 s): the interactive sync path runs in the API process and invalidates
in-process, but the 4-hourly reconcile cron syncs in the WORKER process,
where in-process invalidation can't reach the API — the short TTL is the
cross-process consistency bound for that path.
"""
import time
from typing import Any

TTL_SECONDS = 90.0

# {cache_name: {uid: (monotonic_ts, payload)}}
_caches: dict[str, dict[str, tuple[float, Any]]] = {}


def get(name: str, uid: str, ttl: float = TTL_SECONDS) -> Any | None:
    """Return the cached payload for (name, uid), or None if absent/expired."""
    entry = _caches.get(name, {}).get(uid)
    if not entry:
        return None
    ts, payload = entry
    if time.monotonic() - ts > ttl:
        _caches[name].pop(uid, None)
        return None
    return payload


def put(name: str, uid: str, payload: Any) -> None:
    _caches.setdefault(name, {})[uid] = (time.monotonic(), payload)


def invalidate(uid: str, name: str | None = None) -> None:
    """Drop cached responses for a user — one named cache, or all of them."""
    if name is None:
        for cache in _caches.values():
            cache.pop(uid, None)
    else:
        _caches.get(name, {}).pop(uid, None)
