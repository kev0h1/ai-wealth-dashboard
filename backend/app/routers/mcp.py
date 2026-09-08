"""F3: `/mcp` Streamable HTTP connector: read-only tools for a user's own
external AI assistant (Claude, ChatGPT, ...), same data layer Penny uses.

Owner decision 2026-09-08 (see docs/pricing/tiering-unit-economics-mcp-2026-09.md
section 7 and PENNY_TOOLS.md's "Not-MCP decision"): v1 exposes exactly the
read tools in `app.services.penny_tools.TOOL_SCHEMAS`, never the propose
tools, through the SAME `execute_tool` dispatch Penny's own loop uses; every
result is masked by `app.services.mcp_mask.mask_output` before it leaves
this process. No raw transaction rows cross this boundary at all in v1:
`search_transactions` is excluded outright and every other tool's output is
scrubbed of per-transaction rows, never gated behind a scope. `transactions:read`
does not exist yet.

Transport: a minimal Streamable HTTP implementation of MCP (spec version
"2025-06-18"), hand-rolled rather than a new dependency. `POST /mcp` takes
one JSON-RPC 2.0 request or a batch (a JSON array of them); `GET /mcp` is
405 (v1 never opens a server-initiated stream); `DELETE /mcp` is 204 (this
server is stateless, no `Mcp-Session-Id` to tear down).

Auth: the SAME bearer the rest of the app uses (`app.core.auth.current_user`,
a session token, or `BOT_SECRET`), resolved once per request by
`resolve_mcp_principal`. F2 (OAuth 2.1 authorisation server, not started)
will swap in real per-token scopes from a different principal source; every
other function in this module already takes a `principal` dict rather than
re-deriving it, so that swap should not have to touch anything below
`resolve_mcp_principal` itself. A v1 session-bearer principal is granted all
three scopes and reports `client: "session"`.
"""
import hashlib
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse

from app.core.auth import MCP_WWW_AUTHENTICATE, current_user
from app.core.config import (
    MCP_BURST_PER_MINUTE,
    MCP_CHEAP_METHOD_PER_MINUTE,
    MCP_DAILY_SOFT_CAP,
)
from app.core.ratelimit import check_keyed_limit
from app.core.redis_client import get_redis, redis_ok
from app.core.timeutil import as_utc
from app.db.collections import mcp_calls_col, oauth_tokens_col
from app.services.mcp_mask import mask_output_and_count
from app.services.penny_tools import TOOL_SCHEMAS, execute_tool

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp"])

MCP_PROTOCOL_VERSION = "2025-06-18"
MCP_SERVER_NAME = "sorted"
MCP_SERVER_VERSION = "0.1.0"

# v1 scopes (docs/pricing section 7). `transactions:read` is deliberately
# absent, deferred until a later version adds an explicit transaction-row
# scope with its own consent line; v1 never returns transaction rows at all,
# under any scope, so there is nothing for it to gate yet.
V1_SCOPES = frozenset({"accounts:read", "plans:read", "insights:read"})

# TOOL_SCHEMAS minus the one tool excluded outright (owner decision
# 2026-09-08: no raw transactions over the connector in v1, see this
# module's own docstring). PROPOSE_TOOL_SCHEMAS never enters this file at
# all, so there is no separate exclusion list needed for those.
_EXCLUDED_TOOLS = frozenset({"search_transactions"})

# Every exposed tool's scope. Build step 2 of the F3 brief: accounts:read
# for account-shaped facts (including get_today_brief and get_mirror, which
# both read account/balance state), plans:read for forward-looking planning
# tools, insights:read for spend-analysis tools. Kept as an explicit map
# (not derived) so a new tool added to TOOL_SCHEMAS must be deliberately
# opted into the connector here rather than silently inherited.
TOOL_SCOPES: dict[str, str] = {
    "get_accounts": "accounts:read",
    "get_account_activity": "accounts:read",
    "get_fill_candidates": "accounts:read",
    "get_safe_to_spend": "accounts:read",
    "get_today_brief": "accounts:read",
    "get_mirror": "accounts:read",
    "get_upcoming_bills": "plans:read",
    "get_recurring_payments": "plans:read",
    "get_savings_position": "plans:read",
    "get_debt_position": "plans:read",
    "get_goals": "plans:read",
    "check_affordability": "plans:read",
    "get_tax_position": "plans:read",
    "calculate": "plans:read",
    "get_spend_verdict": "insights:read",
    "get_category_spend": "insights:read",
    "get_insights": "insights:read",
    "explain": "insights:read",
    "preview_trend_intent": "insights:read",
}

MCP_TOOLS = [
    t for t in TOOL_SCHEMAS
    if t["function"]["name"] not in _EXCLUDED_TOOLS and t["function"]["name"] in TOOL_SCOPES
]

# Defensive: a tool added to TOOL_SCHEMAS but forgotten in TOOL_SCOPES above
# must fail loudly at import time, not silently vanish from the connector's
# catalogue or (worse) reach tools/call with no scope to check.
_unscoped = {
    t["function"]["name"] for t in TOOL_SCHEMAS
    if t["function"]["name"] not in _EXCLUDED_TOOLS and t["function"]["name"] not in TOOL_SCOPES
}
if _unscoped:
    raise RuntimeError(f"mcp.py: TOOL_SCHEMAS tool(s) missing a TOOL_SCOPES entry: {sorted(_unscoped)}")


# F7: per-principal rate limits, replacing the old per-IP "/mcp" rule in
# app.core.ratelimit (Claude's and ChatGPT's connectors call from shared
# egress ranges, so an IP-keyed bucket would be shared by every user of the
# same assistant). Keyed by OAuth client_id when the principal came through
# F2's OAuth flow, else uid, so two OAuth clients behind one IP, or one
# user's two connectors, never share a bucket, and never collide with a
# different user's uid either.
_METERED_METHODS_CHEAP = frozenset({"initialize", "ping", "tools/list"})

# Local fallback for the daily-cap counter when Redis is unreachable, same
# doctrine as app.core.ratelimit's own `_hits`: per-process only, but keeps
# the endpoint working rather than failing open or falling over. Keyed by
# the full `mcp:day:<key>:<YYYY-MM-DD>` string, so it naturally starts a
# fresh counter each day without any explicit reset logic.
_daily_local_hits: dict[str, int] = defaultdict(int)


def _mcp_principal_key(principal: dict) -> str:
    """Rate-limit bucket key for a principal: the OAuth client_id when
    present, else the session/OAuth uid."""
    return principal.get("client_id") or principal.get("uid") or "unknown"


async def _check_mcp_daily_cap(key: str, limit: int) -> int | None:
    """Discrete calendar-day counter, not a sliding window: it resets at
    midnight UTC regardless of when the first call of the day landed, which
    is what makes "Retry-After: seconds to midnight UTC" a meaningful answer.
    Redis-backed INCR with a 48h TTL (so a brief Redis restart around
    midnight doesn't lose the day's count); falls back to an in-process
    counter, same as the rest of this module's rate limiting.

    Returns None if `key` is still under `limit` today (and increments the
    counter), else the number of seconds until midnight UTC.
    """
    now = datetime.now(timezone.utc)
    day_key = f"mcp:day:{key}:{now.strftime('%Y-%m-%d')}"
    count: int | None = None
    if await redis_ok():
        client = get_redis()
        if client is not None:
            try:
                pipe = client.pipeline()
                pipe.incr(day_key)
                pipe.expire(day_key, 48 * 3600)
                results = await pipe.execute()
                count = results[0]
            except Exception:
                count = None
    if count is None:
        _daily_local_hits[day_key] += 1
        count = _daily_local_hits[day_key]
    if count <= limit:
        return None
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


async def _mcp_daily_used(key: str) -> int:
    """Best-effort peek at today's daily-cap counter for GET /mcp/audit's
    `limits` block (F9). Never raises and never increments: a Redis hiccup
    here should just show 0, not break the audit page or double-count a
    call that hasn't happened."""
    day_key = f"mcp:day:{key}:{datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
    if await redis_ok():
        client = get_redis()
        if client is not None:
            try:
                val = await client.get(day_key)
                return int(val) if val is not None else 0
            except Exception:
                pass
    return _daily_local_hits.get(day_key, 0)


def _mcp_rate_limited_response(msg_id, kind: str, retry_after: int, limit: int) -> JSONResponse:
    """HTTP 429 with Retry-After, body a JSON-RPC error object (code -32003)
    per the F7 brief, a real HTTP-level rejection rather than a 200 wrapping
    a JSON-RPC error the way the monthly-allowance check below works, since
    this is transport-level throttling rather than a business-rule result."""
    body = {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": _error_obj(-32003, "Rate limited", {"kind": kind, "retry_after": retry_after, "limit": limit}),
    }
    return JSONResponse(status_code=429, content=body, headers={"Retry-After": str(retry_after)})


async def check_mcp_principal_limit(principal: dict, msg: dict) -> JSONResponse | None:
    """Per-principal burst and daily-cap gate for one JSON-RPC message,
    called from `mcp_post` before `handle_jsonrpc_request` so a limited call
    never reaches tool dispatch, never writes an audit doc, and never counts
    against the monthly allowance.

    `initialize`/`ping`/`tools/list` are cheap and unmetered (no allowance,
    no daily cap) but still get a generous per-principal ceiling
    (`MCP_CHEAP_METHOD_PER_MINUTE`) so a broken client's reconnect loop can't
    hammer them unbounded. Only `tools/call` is checked against the burst
    and daily-cap limits; every other method (including unknown ones, left
    for `handle_jsonrpc_request` to reject) passes through here untouched.
    """
    method = msg.get("method")
    msg_id = msg.get("id")
    key = _mcp_principal_key(principal)

    if method in _METERED_METHODS_CHEAP:
        retry_after = await check_keyed_limit(f"mcp:cheap:{key}", MCP_CHEAP_METHOD_PER_MINUTE, 60)
        if retry_after is not None:
            return _mcp_rate_limited_response(msg_id, "burst", retry_after, MCP_CHEAP_METHOD_PER_MINUTE)
        return None

    if method != "tools/call":
        return None

    retry_after = await check_keyed_limit(f"mcp:burst:{key}", MCP_BURST_PER_MINUTE, 60)
    if retry_after is not None:
        return _mcp_rate_limited_response(msg_id, "burst", retry_after, MCP_BURST_PER_MINUTE)

    daily_retry_after = await _check_mcp_daily_cap(key, MCP_DAILY_SOFT_CAP)
    if daily_retry_after is not None:
        return _mcp_rate_limited_response(msg_id, "daily", daily_retry_after, MCP_DAILY_SOFT_CAP)

    return None


class McpError(Exception):
    """Raised by `check_mcp_allowance` or `_handle_tools_call` to surface as
    a JSON-RPC error object rather than a `result`, caught in
    `handle_jsonrpc_request`. `code`/`message`/`data` map straight onto the
    JSON-RPC 2.0 error member."""

    def __init__(self, code: int, message: str, data: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


async def resolve_mcp_principal(request: Request) -> dict:
    """F2: a `sorted_at_...` bearer is an OAuth access token minted by
    `app.routers.oauth`'s token endpoint — looked up by its SHA-256 hash
    (tokens are never stored raw), checked for kind/revocation/expiry, and
    resolved to the real per-token client and its token-scoped subset of
    `V1_SCOPES`. Anything else falls back to the original v1 path: the same
    session bearer every other route validates via `current_user`, granted
    all three scopes and reporting `client: "session"` (the F3 stopgap for
    a connector with no OAuth flow yet — DEPLOY.md's "MCP connector"
    section covers that path). Both branches raise on failure exactly the
    way `current_user` used to: as an `HTTPException` that FastAPI turns
    into the response before this router's body runs further, so callers
    of this function never need their own try/except around it.
    """
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""

    if token.startswith("sorted_at_"):
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        doc = await oauth_tokens_col.find_one({"_id": token_hash})
        now = datetime.now(timezone.utc)
        if (
            not doc or doc.get("kind") != "access" or doc.get("revoked_at")
            or as_utc(doc.get("expires_at")) is None or as_utc(doc["expires_at"]) <= now
        ):
            raise HTTPException(
                401, "Invalid, revoked or expired access token",
                headers={"WWW-Authenticate": MCP_WWW_AUTHENTICATE},
            )
        # Best-effort freshness stamp for the connections list's
        # "last used" column — never allowed to fail the actual call.
        try:
            await oauth_tokens_col.update_one({"_id": token_hash}, {"$set": {"last_used_at": now}})
        except Exception:
            logger.exception("mcp: failed to stamp last_used_at for an OAuth access token")
        return {
            "uid": doc["uid"],
            "client": doc.get("client_name") or doc["client_id"],
            "scopes": set(doc.get("scopes") or []),
            "client_id": doc["client_id"],
        }

    user = await current_user(request)
    return {"uid": user.get("email"), "client": "session", "scopes": set(V1_SCOPES)}


def _mcp_tool_list() -> list[dict]:
    out = []
    for t in MCP_TOOLS:
        fn = t["function"]
        scope = TOOL_SCOPES[fn["name"]]
        out.append({
            "name": fn["name"],
            "description": f"{fn['description']}\n\nScope: {scope}.",
            "inputSchema": fn["parameters"],
        })
    return out


async def check_mcp_allowance(uid: str) -> dict:
    """Raise `McpError` if `uid` has no connector allowance left this
    calendar month, else return `{used, limit, resets_on, tier}`.

    Backed by `app.core.subscription.mcp_allowance`, which folds any active
    MCP call pack (F9) into `limit` — `limit` is 0 for Statements/Lite/
    Standard (not included in the tier at all, a distinct error from
    running out, and packs don't apply), tier + pack calls for Connect/Max
    (2000/5000 base), `None` if the tier were ever configured unlimited
    (no tier is today)."""
    from app.core.subscription import mcp_allowance

    allowance = await mcp_allowance(uid)
    limit = allowance["limit"]
    resets_on = allowance["resets_on"]

    if limit is None:
        return {"used": 0, "limit": None, "resets_on": resets_on, "tier": allowance["tier"]}

    if limit == 0:
        raise McpError(
            -32002,
            "The connector is included in Connect and Max",
            {"tier": allowance["tier"], "limit": 0, "resets_on": resets_on},
        )

    if allowance["used"] >= limit:
        raise McpError(
            -32000,
            "Monthly connector allowance reached",
            {"used": allowance["used"], "limit": limit, "resets_on": resets_on},
        )
    return {"used": allowance["used"], "limit": limit, "resets_on": resets_on, "tier": allowance["tier"]}


async def _mcp_allowance_status(uid: str) -> dict:
    """Same `{used, limit, resets_on, tier}` shape as a successful
    `check_mcp_allowance` return, but never raises, for GET /mcp/audit's
    `limits` block (F7), which wants the numbers whether or not the
    allowance has been reached, not just the happy path."""
    from app.core.subscription import mcp_allowance

    allowance = await mcp_allowance(uid)
    return {
        "used": allowance["used"], "limit": allowance["limit"],
        "resets_on": allowance["resets_on"], "tier": allowance["tier"],
    }


async def _write_audit(principal: dict, tool: str, ok: bool, latency_ms: float, dropped_keys: int) -> None:
    """Metering must never turn a working tool call into a user-facing
    failure (same doctrine as app.core.llm's record_llm_usage). Every
    exception here is swallowed and logged, not raised."""
    now = datetime.now(timezone.utc)
    try:
        await mcp_calls_col.insert_one({
            "user_id": principal.get("uid"),
            "client": principal.get("client", "session"),
            # F2: the OAuth client_id behind `client`'s display name, None
            # for the F3 session-bearer stopgap (there is no client to
            # attribute). Lets a future audit view group calls by actual
            # connector even if two connectors share a display name.
            "client_id": principal.get("client_id"),
            "tool": tool,
            "ok": bool(ok),
            "ts": now,
            "year_month": now.strftime("%Y-%m"),
            "latency_ms": round(latency_ms, 1),
            "dropped_keys": int(dropped_keys),
        })
    except Exception:
        logger.exception("mcp: failed to write audit doc for %s/%s", principal.get("uid"), tool)


async def _handle_tools_call(principal: dict, params: dict) -> dict:
    name = (params or {}).get("name")
    args = (params or {}).get("arguments") or {}
    if not isinstance(name, str) or name not in TOOL_SCOPES:
        raise McpError(-32602, f"Unknown or unavailable tool: {name!r}")

    scope = TOOL_SCOPES[name]
    if scope not in principal.get("scopes", set()):
        raise McpError(-32001, "Scope not granted", {"tool": name, "required_scope": scope})

    # Allowance is checked (and may raise) BEFORE the tool actually runs, so
    # a capped user's rejected call costs nothing and writes no audit doc of
    # its own, matching check_statement_upload_allowed's "call before any
    # real work" convention in app.core.subscription.
    await check_mcp_allowance(principal["uid"])

    start = time.perf_counter()
    ok = True
    dropped = 0
    try:
        raw = await execute_tool(principal["uid"], name, args)
        ok = not (isinstance(raw, dict) and "error" in raw)
        masked, dropped = mask_output_and_count(name, raw)
    except Exception:
        logger.exception("mcp: tools/call crashed for %s/%s", principal.get("uid"), name)
        ok = False
        masked = {"error": "tool execution failed"}
    latency_ms = (time.perf_counter() - start) * 1000
    await _write_audit(principal, name, ok, latency_ms, dropped)

    return {
        "content": [{"type": "text", "text": json.dumps(masked)}],
        "isError": not ok,
    }


def _error_obj(code: int, message: str, data: dict | None = None) -> dict:
    err = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return err


async def handle_jsonrpc_request(principal: dict, msg: dict) -> dict | None:
    """Dispatch one JSON-RPC 2.0 message. Returns the response object, or
    `None` for a notification (a message with no `id`; per spec, the
    server must never send a response for one). Never raises: every error
    path is turned into a JSON-RPC error object (or swallowed, for a
    notification)."""
    is_notification = "id" not in msg
    msg_id = msg.get("id")
    method = msg.get("method")

    if not isinstance(method, str):
        return None if is_notification else {"jsonrpc": "2.0", "id": msg_id, "error": _error_obj(-32600, "Invalid Request")}

    try:
        if method == "initialize":
            result = {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": MCP_SERVER_NAME, "version": MCP_SERVER_VERSION},
            }
        elif method == "notifications/initialized":
            return None
        elif method == "ping":
            result = {}
        elif method == "tools/list":
            result = {"tools": _mcp_tool_list()}
        elif method == "tools/call":
            result = await _handle_tools_call(principal, msg.get("params") or {})
        else:
            if is_notification:
                return None
            return {"jsonrpc": "2.0", "id": msg_id, "error": _error_obj(-32601, f"Method not found: {method}")}
    except McpError as e:
        if is_notification:
            return None
        return {"jsonrpc": "2.0", "id": msg_id, "error": _error_obj(e.code, e.message, e.data)}
    except Exception:
        logger.exception("mcp: unhandled error dispatching method=%s", method)
        if is_notification:
            return None
        return {"jsonrpc": "2.0", "id": msg_id, "error": _error_obj(-32603, "Internal error")}

    if is_notification:
        return None
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


@router.post("/mcp")
async def mcp_post(request: Request):
    # F7: no per-IP check here any more (see app.core.ratelimit's RULES
    # comment): every /mcp call is authenticated, so rate limiting happens
    # per-principal below, after resolve_mcp_principal, keyed by OAuth
    # client_id/uid rather than IP.
    principal = await resolve_mcp_principal(request)

    body = await request.body()
    try:
        payload = json.loads(body)
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": _error_obj(-32700, "Parse error")})

    is_batch = isinstance(payload, list)
    messages = payload if is_batch else [payload]
    if not messages:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": _error_obj(-32600, "Invalid Request")})

    responses = []
    for msg in messages:
        if not isinstance(msg, dict):
            responses.append({"jsonrpc": "2.0", "id": None, "error": _error_obj(-32600, "Invalid Request")})
            continue
        # A limited message short-circuits the whole HTTP response as a 429
        # (not just this one message's slot in the batch): batches are rare
        # for this connector in practice (Claude/ChatGPT call one message at
        # a time), and a transport-level rejection is simpler to reason
        # about than partial-batch success mixed with a 429.
        limited = await check_mcp_principal_limit(principal, msg)
        if limited is not None:
            return limited
        resp = await handle_jsonrpc_request(principal, msg)
        if resp is not None:
            responses.append(resp)

    if not responses:
        # Every message in the request was a notification (e.g. a lone
        # notifications/initialized), so no JSON-RPC response object exists
        # to send back, per spec.
        return Response(status_code=202, content=b"")

    if is_batch:
        return JSONResponse(responses)
    return JSONResponse(responses[0])


@router.get("/mcp")
async def mcp_get():
    """No server-initiated stream in v1. Streamable HTTP callers that GET
    to open one get a plain 405 rather than a hung connection."""
    return Response(status_code=405)


@router.delete("/mcp")
async def mcp_delete():
    """Stateless server: there is no `Mcp-Session-Id` to tear down, so a
    DELETE always succeeds with no body."""
    return Response(status_code=204)


def _serialize_audit_row(doc: dict) -> dict:
    ts = doc.get("ts")
    return {
        "tool": doc.get("tool"),
        "client": doc.get("client"),
        "ts": ts.isoformat() if isinstance(ts, datetime) else ts,
        "ok": bool(doc.get("ok")),
    }


@router.get("/mcp/audit")
async def get_mcp_audit(month: str | None = Query(None), user: dict = Depends(current_user)):
    """The caller's own `/mcp` audit rows for one calendar month (default:
    the current month), masked down to tool/client/ts/ok, for F4 (not yet
    built) to render on a "Connected assistants" settings surface. Every
    other audit field (latency_ms, dropped_keys) stays server-side. Not
    rate-limited itself: it is a cheap read of the caller's own already-
    written rows, not a tool-call surface.

    F7: also returns a `limits` block (burst/minute, daily soft cap, and the
    monthly allowance with used counts) so F9 can surface the caps
    themselves, not just the call log. This is always the session-bearer's
    own view (`current_user`), so the daily-cap peek is keyed by uid, same
    as `check_mcp_principal_limit` would key it for a session-bearer
    principal (no client_id to prefer)."""
    uid = user.get("email")
    ym = month or datetime.now(timezone.utc).strftime("%Y-%m")
    cursor = mcp_calls_col.find(
        {"user_id": uid, "year_month": ym},
        {"_id": 0, "tool": 1, "client": 1, "ts": 1, "ok": 1},
    ).sort("ts", -1)
    rows = [_serialize_audit_row(d) async for d in cursor]
    allowance = await _mcp_allowance_status(uid)
    daily_used = await _mcp_daily_used(uid)
    return {
        "year_month": ym,
        "calls": rows,
        "limits": {
            "burst_per_minute": MCP_BURST_PER_MINUTE,
            "daily_soft_cap": MCP_DAILY_SOFT_CAP,
            "daily_used_today": daily_used,
            "monthly_allowance": allowance["limit"],
            "monthly_used": allowance["used"],
            "monthly_resets_on": allowance["resets_on"],
        },
    }
