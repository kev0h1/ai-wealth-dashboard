"""F2 OAuth 2.1 authorisation server: pending-authorize-request store.

Between GET /auth/oauth/authorize validating a request and POST
/oauth/decision resolving it, the request's own parameters (client_id,
client_name, redirect_uri, scopes, state, code_challenge) have to survive a
browser round trip through the consent page and (often) a Google/Apple
sign-in. Same Redis-with-in-process-fallback shape as
app.core.pending_login (this server already runs more than one Railway
replica — D4 in TODO.md — so an in-process-only store would fail whenever
the authorize hit one replica and the decision hit another).

Keyed `oauth:req:<id>`, 10 minute TTL. Unlike pending_login (write once,
read once via GETDEL), a pending OAuth request is read TWICE: once by
GET /oauth/request/{id} for the consent page to render (peek, does not
consume) and once by POST /oauth/decision to issue the code or the denial
redirect (pop, one-shot per the F2 brief: "One-shot: delete the pending
request.").
"""
import json
import time

from app.core.redis_client import get_redis, redis_ok

_TTL = 600
_KEY_PREFIX = "oauth:req:"

# In-process fallback: req_id -> (data, expires_at_epoch_seconds)
_pending: dict[str, tuple[dict, float]] = {}


def _local_store(req_id: str, data: dict) -> None:
    now = time.time()
    _pending[req_id] = (data, now + _TTL)
    for k in [k for k, (_, exp) in _pending.items() if exp < now]:
        _pending.pop(k, None)


def _local_get(req_id: str) -> dict | None:
    entry = _pending.get(req_id)
    if not entry:
        return None
    data, expires_at = entry
    if expires_at < time.time():
        _pending.pop(req_id, None)
        return None
    return data


def _local_pop(req_id: str) -> dict | None:
    data = _local_get(req_id)
    _pending.pop(req_id, None)
    return data


async def store_oauth_request(req_id: str, data: dict) -> None:
    if await redis_ok():
        client = get_redis()
        try:
            await client.set(f"{_KEY_PREFIX}{req_id}", json.dumps(data), ex=_TTL)
            return
        except Exception:
            pass
    _local_store(req_id, data)


async def get_oauth_request(req_id: str) -> dict | None:
    """Peek: does not consume. Used by GET /oauth/request/{id} so the
    consent page can be safely re-rendered (refresh, back button) without
    losing the pending request."""
    if await redis_ok():
        client = get_redis()
        try:
            raw = await client.get(f"{_KEY_PREFIX}{req_id}")
            return json.loads(raw) if raw else None
        except Exception:
            pass
    return _local_get(req_id)


async def pop_oauth_request(req_id: str) -> dict | None:
    """One-shot read: consumes the pending request. Used by POST
    /oauth/decision — approve or deny, the request is spent either way."""
    if await redis_ok():
        client = get_redis()
        try:
            # GETDEL: atomic read-then-delete, so a double-submit of the
            # decision (double tap, retry) can never mint two codes.
            raw = await client.getdel(f"{_KEY_PREFIX}{req_id}")
            return json.loads(raw) if raw else None
        except Exception:
            pass
    return _local_pop(req_id)
