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
# Longer than _PENDING_TTL: it starts at login start, the pending entry only at
# the callback, so a slow Google sign-in must not orphan the poll.
_CHALLENGE_TTL = 600
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
    """Record sha256(poll_secret) for a new-format state, WRITE-ONCE.

    The first challenge registered for a state wins until it expires; a later
    registration (e.g. a log reader replaying /auth/google/mobile?state=<victim>
    with their own challenge) is a silent no-op, so it cannot redirect the
    victim's token to the attacker's secret. Returns True only when this call
    wrote the challenge; the endpoint ignores the result so a repeat start is
    indistinguishable from a fresh one. False (stores nothing) for malformed
    values or a legacy state."""
    if not is_valid_mobile_state(state) or is_legacy_mobile_state(state) or not is_valid_challenge(challenge):
        return False
    if await redis_ok():
        client = get_redis()
        try:
            return bool(await client.set(f"{_CHALLENGE_PREFIX}{state}", challenge, ex=_CHALLENGE_TTL, nx=True))
        except Exception:
            pass
    now = time.time()
    existing = _challenges.get(state)
    if existing and existing[1] >= now:
        return False
    _challenges[state] = (challenge, now + _CHALLENGE_TTL)
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


# ── A136: server-issued sign-in state ────────────────────────────────────
# Before A136 the app chose its own state and challenge, so anyone could
# start a login, hand the victim the authorise link and redeem the victim's
# token with the poll secret they kept. Now POST /auth/mobile/start issues
# the state. The record holds sha256(poll_secret) (poll_secret is
# SERVER-generated and returned once), the client's PKCE challenge
# (sha256(code_verifier)) and the network prefix of the starter. The
# authorise URL, the callback and the redeem all require a live, unused
# record, and redeem needs BOTH the poll_secret AND the code_verifier.
#
# Honest limit: this stops state choosing, replays and log-reader attacks, and
# makes every attempt rate-limited, short-lived and single-use. It cannot by
# itself prove the person who opens the link is the person whose app started
# it (no device attestation here); the network-prefix binding below is the
# extra signal for that, see docs/security/A136-native-state-fixation.md.
#
# Stored in Redis with a native TTL (in-process fallback), the same store as
# the pending entry, not a Mongo collection: a record lives at most 10
# minutes, is pre-auth and holds no user identifier, so it is not user-keyed
# and is not in ERASURE_MANIFEST.
_START_PREFIX = "auth:start:"
START_TTL = 600
_PKCE_RE = re.compile(r"^[0-9a-f]{64}$")
_starts: dict[str, tuple[str, float]] = {}


def network_prefix(ip: str | None) -> str:
    """IPv4 /24 or IPv6 /64 as a short string; "" when unknown."""
    import ipaddress
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return ""
    bits = 24 if addr.version == 4 else 64
    return str(ipaddress.ip_network(f"{addr}/{bits}", strict=False))


async def _start_put(state: str, record: dict, ttl: int, *, nx: bool = False) -> bool:
    import json
    raw = json.dumps(record)
    if await redis_ok():
        try:
            return bool(await get_redis().set(f"{_START_PREFIX}{state}", raw, ex=ttl, nx=nx))
        except Exception:
            pass
    now = time.time()
    for k in [k for k, (_, exp) in _starts.items() if exp < now]:
        _starts.pop(k, None)
    if nx and state in _starts:
        return False
    _starts[state] = (raw, now + ttl)
    return True


async def get_start(state: str) -> dict | None:
    """The live start record for a state, or None (unknown, expired, malformed)."""
    import json
    if not is_valid_mobile_state(state) or is_legacy_mobile_state(state):
        return None
    raw = None
    if await redis_ok():
        try:
            raw = await get_redis().get(f"{_START_PREFIX}{state}")
        except Exception:
            raw = None
    if raw is None:
        entry = _starts.get(state)
        if entry and entry[1] >= time.time():
            raw = entry[0]
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


async def issue_start(pkce_challenge: str, ip: str | None) -> dict | None:
    """Mint a state and poll secret. None for a malformed PKCE challenge."""
    import secrets
    from datetime import datetime, timedelta, timezone
    if not pkce_challenge or _PKCE_RE.fullmatch(pkce_challenge) is None:
        return None
    state = "m" + secrets.token_hex(16)
    poll_secret = secrets.token_hex(16)
    record = {
        "poll_hash": hashlib.sha256(poll_secret.encode()).hexdigest(),
        "challenge": pkce_challenge,
        "net": network_prefix(ip),
        "used": False,
    }
    if not await _start_put(state, record, START_TTL, nx=True):
        return None
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=START_TTL)  # naive-ok: tz-aware UTC TTL instant, not user-facing calendar copy
    return {"state": state, "poll_secret": poll_secret, "expires_at": expires_at.isoformat()}


_CODE_PREFIX = "auth:code:"
CODE_TTL = 120
_CODE_RE = re.compile(r"^[0-9a-f]{32}$")
_codes: dict[str, tuple[str, float]] = {}


async def _code_put(code: str, payload: dict) -> None:
    import json
    raw = json.dumps(payload)
    if await redis_ok():
        try:
            await get_redis().set(f"{_CODE_PREFIX}{code}", raw, ex=CODE_TTL)
            return
        except Exception:
            pass
    now = time.time()
    for k in [k for k, (_, exp) in _codes.items() if exp < now]:
        _codes.pop(k, None)
    _codes[code] = (raw, now + CODE_TTL)


async def _code_get(code: str, *, delete: bool = False) -> dict | None:
    import json
    raw = None
    done = False
    if await redis_ok():
        try:
            client = get_redis()
            raw = await (client.getdel(f"{_CODE_PREFIX}{code}") if delete else client.get(f"{_CODE_PREFIX}{code}"))
            done = True
        except Exception:
            raw = None
    if raw is None and not done:
        entry = _codes.get(code)
        if entry and entry[1] >= time.time():
            raw = entry[0]
    if delete:
        _codes.pop(code, None)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


async def complete_issued(state: str, record: dict, value: str) -> str | None:
    """The OAuth callback finished for a server-issued state. Single use: the
    state is closed, and the outcome is stored under a fresh one-time 128-bit
    CODE that only the completing browser is sent (via the wealthdash://
    return). Nothing is stored under the state, so polling the state can never
    return the result. Returns the code."""
    import secrets
    code = secrets.token_hex(16)
    await _code_put(code, {"state": state, "value": value})
    # The start record (it holds the PKCE challenge) must outlive the code.
    await _start_put(state, {**record, "used": True}, CODE_TTL + 5)
    return code


async def redeem_code(code: str | None, code_verifier: str | None) -> str | None:
    """POST /auth/mobile/redeem. Releases the stored outcome only to a caller
    holding the code AND the verifier whose sha256 was bound at start. Every
    failure is None (uniform 404); a wrong verifier consumes nothing."""
    if not code or _CODE_RE.fullmatch(code) is None:
        return None
    if not code_verifier or _POLL_SECRET_RE.fullmatch(code_verifier) is None:
        return None
    entry = await _code_get(code)
    if entry is None:
        return None
    record = await get_start(entry.get("state", ""))
    if record is None or not hmac.compare_digest(
        hashlib.sha256(code_verifier.encode()).hexdigest(), record.get("challenge", "")
    ):
        return None
    taken = await _code_get(code, delete=True)  # atomic single use
    return taken.get("value") if taken else None
