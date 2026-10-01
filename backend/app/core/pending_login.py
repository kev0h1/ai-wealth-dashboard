"""Mobile OAuth "pending" hand-off store.

Chrome Custom Tabs won't launch an app-scheme redirect (wealthdash://) from
a server redirect without a user gesture, so the mobile app can't reliably
get the token back via a deep link. Instead the app opens login with a
one-time `state` id and polls for the result; the OAuth callback stashes the
outcome here keyed by state.

Backed by Redis (key `auth:pending:<state>`, TTL 300s, single GETDEL read so
a concurrent poll can never race the first one) so this survives across Railway
replicas (D4 in TODO.md) — the callback and the poll can land on different
instances. Falls back to an in-process dict with the same TTL semantics
when Redis is unavailable.
"""
import re
import time

from app.core.redis_client import get_redis, redis_ok

_PENDING_TTL = 300
# A133: the state is a bearer secret (the token is replayable under it for
# _REPLAY_TTL), so only accept what nativeGoogleLogin generates: "m" + 32 hex
# chars (128 bits from crypto.getRandomValues), up to 64 to leave headroom.
_MOBILE_STATE_RE = re.compile(r"^m[0-9a-f]{32,64}$")


def is_valid_mobile_state(state: str | None) -> bool:
    return bool(state) and _MOBILE_STATE_RE.fullmatch(state) is not None
_KEY_PREFIX = "auth:pending:"

# A133: a successfully-popped *token* is replayable for a short grace window.
# The poll is pop-on-read, so if the client never receives or never finishes
# handling the first response (response lost while the app is suspended,
# client-side storage failure), the token would be gone and the sign-in
# stuck. The replay copy lives under its own key and is NOT deleted by a
# read: it simply expires. Trade-off: for REPLAY_TTL seconds after the first
# read, anyone who knows the (unguessable, per-login) state can fetch the same
# token again. Error outcomes are never replayed. The state is only ever in
# the app and the OAuth redirect, and the window is far shorter than the 300s
# the unread token was already retrievable for.
_REPLAY_TTL = 30
_REPLAY_PREFIX = "auth:pending-replay:"

# In-process fallback: state -> (value, expires_at_epoch_seconds)
_pending: dict[str, tuple[str, float]] = {}
_replay: dict[str, tuple[str, float]] = {}


def _local_store(state: str, value: str) -> None:
    now = time.time()
    _pending[state] = (value, now + _PENDING_TTL)
    for k in [k for k, (_, exp) in _pending.items() if exp < now]:
        _pending.pop(k, None)
    for k in [k for k, (_, exp) in _replay.items() if exp < now]:
        _replay.pop(k, None)


def _local_pop(state: str) -> str | None:
    entry = _pending.pop(state, None)
    if not entry:
        return None
    value, expires_at = entry
    if expires_at < time.time():
        return None
    if value.startswith("token:"):
        _replay[state] = (value, time.time() + _REPLAY_TTL)
    return value


def _local_replay(state: str) -> str | None:
    entry = _replay.get(state)
    if not entry:
        return None
    value, expires_at = entry
    if expires_at < time.time():
        _replay.pop(state, None)
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
            # GETDEL: atomic read-then-delete, so two racing polls cannot both
            # take the first read.
            value = await client.getdel(f"{_KEY_PREFIX}{state}")
            if value is not None:
                if value.startswith("token:"):
                    await client.set(f"{_REPLAY_PREFIX}{state}", value, ex=_REPLAY_TTL)
                return value
            # Already consumed: serve the short-lived replay copy (tokens only).
            return await client.get(f"{_REPLAY_PREFIX}{state}")
        except Exception:
            pass
    return _local_pop(state) or _local_replay(state)
