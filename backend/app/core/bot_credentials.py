"""A28: named, scoped, individually revocable service credentials — the
replacement for the single static `BOT_SECRET` that used to authenticate
as Kevin's own account (see `app.core.auth`'s history and TODO.md item
A28 for the shape of that bug: one shared string, no expiry, no scoping,
returned `{"email": "kevin.maingi12@gmail.com", ...}` for ANY caller who
had it, so it could read or write everything Kevin's real session could).

A credential is an opaque `sorted_bot_`-prefixed token
(`secrets.token_urlsafe(32)`), never stored raw — only its SHA-256 hash
lives in `bot_credentials_col`, same doctrine as `oauth_tokens_col` /
`oauth_codes_col` in `app.routers.oauth` (see that module's `_hash`).
Credentials are minted and revoked out-of-band by
`backend/scripts_bot_credential.py`, which talks to Mongo directly — there
is no HTTP route that mints or lists raw tokens, so a compromised
credential can never be used to mint another one, and rotation never
needs an env var change or a redeploy (just a Mongo write, picked up on
the very next request since every lookup here is live, not cached).

A resolved bot principal is `{"name": "Bot", "email": None, "bot_name":
<credential name>, "scopes": {...}}`. Critically `email` is `None`, not a
real address — this is what stops a bot credential impersonating a real
user. The overwhelming majority of routes in this app resolve the caller
to `uid = user["email"]` (audited 2026-09-14 across every router) and
scope every Mongo read/write to that value; a bot principal with no email
either 403s outright (routes in `ROUTE_SCOPES` below all use a `Bot`/
owner gate, never `user["email"]` for scoping) or, for anything not in
that list, is refused entry before it ever reaches a route handler (see
`required_scope`).

`ROUTE_SCOPES` is deliberately a short, explicit allow-list, not a
blanket "any admin-prefixed path" rule: adding a new `/admin/...` route
in future does NOT automatically become reachable by a bot credential,
it has to be added here on purpose, with a scope. This is why the old
MCP audit route (`GET /mcp/audit`, which reads the CALLER's own audit
log — under the old BOT_SECRET-as-Kevin's-identity bug that meant
Kevin's real log) and `POST /admin/fix-card-transactions` (which acts on
`user["email"]`, i.e. "the caller's own account") are NOT here: neither
has a sane bot scope (there is no bot-owned account whose audit log or
card transactions would mean anything), so a bot credential gets a plain
403/401 on both, same as any other user-data route.
"""
import hashlib
import logging
import re
import secrets
from datetime import datetime, timezone

from app.db.collections import bot_credentials_col, bot_credential_uses_col

logger = logging.getLogger("app.bot_credentials")

TOKEN_PREFIX = "sorted_bot_"

# Fixed scope vocabulary — keep in sync with ROUTE_SCOPES below. Every
# scope here unlocks exactly the routes listed against it, nothing more;
# a credential minted with one scope cannot reach a route gated by
# another.
SCOPES = {
    "admin:sync",          # POST /admin/sync-all
    "admin:usage",         # GET /admin/llm-usage, GET /admin/sync-stats, POST /admin/finexer/providers/refresh
    "admin:broadcast",     # /admin/broadcast* (preview, send, list, detail)
    "admin:allowlist",     # /admin/allowlist* (list, invite, revoke)
    "subscription:admin",  # PATCH /subscription/admin/set-tier, POST /subscription/admin/topup
}

# (method, path pattern, required scope) — the ONLY (method, path) pairs a
# bot credential can ever reach, regardless of which scopes it holds.
# Matched against `request.url.path`, which is the concrete path (no
# `{param}` placeholders), hence the `[^/]+` groups for path params.
ROUTE_SCOPES: list[tuple[str, "re.Pattern[str]", str]] = [
    ("POST", re.compile(r"^/admin/sync-all$"), "admin:sync"),
    ("GET", re.compile(r"^/admin/llm-usage$"), "admin:usage"),
    ("GET", re.compile(r"^/admin/sync-stats$"), "admin:usage"),
    ("POST", re.compile(r"^/admin/finexer/providers/refresh$"), "admin:usage"),
    ("PATCH", re.compile(r"^/subscription/admin/set-tier$"), "subscription:admin"),
    ("POST", re.compile(r"^/subscription/admin/topup$"), "subscription:admin"),
    ("POST", re.compile(r"^/admin/broadcast/preview$"), "admin:broadcast"),
    ("POST", re.compile(r"^/admin/broadcast/[^/]+/send$"), "admin:broadcast"),
    ("GET", re.compile(r"^/admin/broadcast$"), "admin:broadcast"),
    ("GET", re.compile(r"^/admin/broadcast/[^/]+$"), "admin:broadcast"),
    ("GET", re.compile(r"^/admin/allowlist$"), "admin:allowlist"),
    ("POST", re.compile(r"^/admin/allowlist$"), "admin:allowlist"),
    ("DELETE", re.compile(r"^/admin/allowlist/[^/]+$"), "admin:allowlist"),
]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def mint_token() -> str:
    """Only ever called from `backend/scripts_bot_credential.py` — no HTTP
    route calls this."""
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def required_scope(method: str, path: str) -> str | None:
    """The scope a bot credential needs to call (method, path), or None if
    this path is closed to bot credentials altogether (the default for
    every route not explicitly listed in ROUTE_SCOPES)."""
    for m, pattern, scope in ROUTE_SCOPES:
        if m == method and pattern.match(path):
            return scope
    return None


async def resolve_bot_credential(token: str) -> dict | None:
    """Look up a `sorted_bot_...` token by hash. Returns None for an
    unknown, malformed or revoked credential — deliberately the same
    outward shape for all three, so a caller can't use response
    differences to enumerate which tokens once existed. Never raises on a
    DB hiccup: a failed lookup is treated exactly like "not found" (fail
    closed — a credential that can't be verified grants no access, it
    never falls back to trusting the caller)."""
    try:
        doc = await bot_credentials_col.find_one({"_id": hash_token(token)})
    except Exception:
        logger.exception("bot_credentials: lookup failed")
        return None
    if not doc or doc.get("revoked_at"):
        return None
    return {
        "bot_name": doc.get("name") or "unnamed",
        "scopes": set(doc.get("scopes") or []),
    }


async def record_use(bot_name: str, method: str, path: str, ok: bool, token: str | None = None) -> None:
    """Best-effort audit trail for every bot-credential use: who (the
    credential's NAME, never the secret), when, which route, and whether
    the scope check passed. Two independent writes (structured log line +
    durable Mongo row), neither allowed to raise — audit-logging must
    never turn a legitimate call into a 500, same doctrine as
    `app.routers.mcp._write_audit`.

    `token`, if given, is used ONLY to recompute the hash for the
    credential doc's own `last_used_at`/`last_used_path` stamp (visibility
    for whoever is deciding what's safe to revoke) — the raw value itself
    is never logged or stored anywhere."""
    now = datetime.now(timezone.utc)
    logger.info("bot_credential use: name=%s method=%s path=%s ok=%s", bot_name, method, path, ok)
    try:
        await bot_credential_uses_col.insert_one({
            "bot_name": bot_name, "method": method, "path": path, "ok": ok, "ts": now,
        })
    except Exception:
        logger.exception("bot_credentials: failed to write audit row for %s", bot_name)
    if token:
        try:
            await bot_credentials_col.update_one(
                {"_id": hash_token(token)},
                {"$set": {"last_used_at": now, "last_used_path": path}},
            )
        except Exception:
            logger.exception("bot_credentials: failed to stamp last_used_at for %s", bot_name)


async def check_bot_request(method: str, path: str, token: str) -> tuple[bool, dict | None]:
    """Shared gate used by BOTH `app.core.auth.auth_middleware` (fail fast,
    no route dependencies run yet) and `current_user` (the per-route
    dependency, which also performs the audit write — see that function's
    own docstring for why validation deliberately happens in both places).

    Returns `(ok, cred)`. `cred` is None for an unknown/revoked token;
    `ok` is False if `cred` is None OR the route's required scope isn't
    among `cred["scopes"]` OR the route has no bot scope at all."""
    cred = await resolve_bot_credential(token)
    scope = required_scope(method, path)
    ok = bool(cred and scope and scope in cred["scopes"])
    return ok, cred
