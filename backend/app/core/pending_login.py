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
import hashlib
import hmac
import re
import time

from app.core.redis_client import get_redis, redis_ok

_PENDING_TTL = 300
# A133: new builds send "m" + 32 hex chars (128 bits from
# crypto.getRandomValues), up to 64 to leave headroom. The state is NOT a
# secret (it travels in logged URLs); redemption of a new-format state is
# bound to a separate poll_secret that never appears in a URL, see
# redeem_pending() below.
_MOBILE_STATE_RE = re.compile(r"^m[0-9a-f]{32,64}$")
# TODO(A133): remove legacy acceptance once pre-A133 app builds have aged out.
# Every binary released before A133 sends "m" + Math.random().toString(36)
# .slice(2) (1-12 base-36 chars) + "_" + Date.now() (13 digits today). They
# must still be able to sign in, but their state is low-entropy, so legacy
# states get NO replay window: single-read, exactly the pre-A133 behaviour.
_LEGACY_MOBILE_STATE_RE = re.compile(r"^m[a-z0-9]{1,16}_[0-9]{10,14}$")


def is_legacy_mobile_state(state: str | None) -> bool:
    return bool(state) and _LEGACY_MOBILE_STATE_RE.fullmatch(state) is not None


def is_valid_mobile_state(state: str | None) -> bool:
    return (bool(state) and _MOBILE_STATE_RE.fullmatch(state) is not None) or is_legacy_mobile_state(state)


_KEY_PREFIX = "auth:pending:"

# A133: a successfully-popped *token* is replayable for a short grace window,
# but ONLY to a caller that proves knowledge of the poll_secret (see
# redeem_pending). The poll is pop-on-read, so if the client never receives
# or never finishes handling the first response (response lost while the app
# is suspended, client-side storage failure, WebView reload), the token would
# be gone and the sign-in stuck. The replay copy lives under its own key and
# is NOT deleted by a read: it simply expires. Because the secret check comes
# first, a log reader who only has the state can neither read nor burn the
# token. Error outcomes are never replayed.
_REPLAY_TTL = 30
_REPLAY_PREFIX = "auth:pending-replay:"

# A133: sha256(poll_secret) hex, stored by /auth/google/mobile next to the
# pending entry. The secret itself is held only by the app (and, until the
# login finishes, in the app's short-lived pending-login record) and is sent
# only in a POST body.
_CHALLENGE_PREFIX = "auth:challenge:"
_CHALLENGE_RE = re.compile(r"^[0-9a-f]{64}$")
_POLL_SECRET_RE = re.compile(r"^[0-9a-f]{32,64}$")

# In-process fallback: state -> (value, expires_at_epoch_seconds)
_pending: dict[str, tuple[str, float]] = {}
_replay: dict[str, tuple[str, float]] = {}
_challenges: dict[str, tuple[str, float]] = {}


def _local_store(state: str, value: str) -> None:
    now = time.time()
    _pending[state] = (value, now + _PENDING_TTL)
    for k in [k for k, (_, exp) in _pending.items() if exp < now]:
        _pending.pop(k, None)
    for k in [k for k, (_, exp) in _replay.items() if exp < now]:
        _replay.pop(k, None)
    for k in [k for k, (_, exp) in _challenges.items() if exp < now]:
        _challenges.pop(k, None)


def _local_pop(state: str) -> str | None:
    entry = _pending.pop(state, None)
    if not entry:
        return None
    value, expires_at = entry
    if expires_at < time.time():
        return None
    if value.startswith("token:") and not is_legacy_mobile_state(state):
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
                if value.startswith("token:") and not is_legacy_mobile_state(state):
                    await client.set(f"{_REPLAY_PREFIX}{state}", value, ex=_REPLAY_TTL)
                return value
            # Already consumed: serve the short-lived replay copy (tokens only).
            if is_legacy_mobile_state(state):
                return None
            return await client.get(f"{_REPLAY_PREFIX}{state}")
        except Exception:
            pass
    return _local_pop(state) or (None if is_legacy_mobile_state(state) else _local_replay(state))


def is_valid_challenge(challenge: str | None) -> bool:
    return bool(challenge) and _CHALLENGE_RE.fullmatch(challenge) is not None


async def store_challenge(state: str, challenge: str) -> bool:
    """Record sha256(poll_secret) for a new-format state. Returns False (and
    stores nothing) when either value is malformed or the state is legacy."""
    if not is_valid_mobile_state(state) or is_legacy_mobile_state(state) or not is_valid_challenge(challenge):
        return False
    if await redis_ok():
        client = get_redis()
        try:
            await client.set(f"{_CHALLENGE_PREFIX}{state}", challenge, ex=_PENDING_TTL)
            return True
        except Exception:
            pass
    now = time.time()
    _challenges[state] = (challenge, now + _PENDING_TTL)
    return True


async def _get_challenge(state: str) -> str | None:
    if await redis_ok():
        client = get_redis()
        try:
            value = await client.get(f"{_CHALLENGE_PREFIX}{state}")
            if value is not None:
                return value
        except Exception:
            pass
    entry = _challenges.get(state)
    if not entry:
        return None
    value, expires_at = entry
    if expires_at < time.time():
        _challenges.pop(state, None)
        return None
    return value


async def has_challenge(state: str) -> bool:
    return await _get_challenge(state) is not None


def _secret_matches(secret: str | None, challenge: str | None) -> bool:
    # Always runs one constant-time digest compare so a missing secret or
    # challenge costs the same as a wrong one.
    ok = bool(secret) and _POLL_SECRET_RE.fullmatch(secret) is not None and challenge is not None
    digest = hashlib.sha256((secret if ok else "").encode()).hexdigest()
    return hmac.compare_digest(digest, challenge if ok else "0" * 64) and ok


async def redeem_pending(state: str, poll_secret: str | None = None) -> str | None:
    """The one entry point the poll endpoints use.

    Legacy states (installed pre-A133 builds, no challenge): single-read, no
    secret needed, no replay. New-format states: the value is released only if
    sha256(poll_secret) equals the challenge stored at login start; otherwise
    None, indistinguishable from "unknown state" (no oracle) and nothing is
    consumed, so a wrong guess cannot burn a pending token either."""
    if not is_valid_mobile_state(state):
        return None
    if is_legacy_mobile_state(state):
        return await _pop_pending(state)
    if not _secret_matches(poll_secret, await _get_challenge(state)):
        return None
    return await _pop_pending(state)
