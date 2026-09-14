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

from app.core.config import BOT_CREDENTIAL_DEFAULT_TTL_DAYS
from app.db.collections import (
    bot_credentials_col, bot_credential_uses_col, bot_credential_unknown_col,
)

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


def default_expiry(days: int | None = None) -> datetime:
    """`now + days` (BOT_CREDENTIAL_DEFAULT_TTL_DAYS if `days` is not
    given). Shared by `scripts_bot_credential.py create` (minting a new
    credential) and `app.main._migrate_bot_credential_expiry` (backfilling
    a credential minted before A32 added this field), so the "what is a
    sensible default lifetime" decision lives in exactly one place. Always
    relative to the current time, never to the credential's own
    `created_at` — see `_migrate_bot_credential_expiry`'s docstring for why
    that matters for the backfill case specifically (an old `created_at`
    could put `created_at + days` in the past, expiring a live credential
    the instant the migration runs)."""
    from datetime import timedelta
    days = BOT_CREDENTIAL_DEFAULT_TTL_DAYS if days is None else days
    return datetime.now(timezone.utc) + timedelta(days=days)


def _as_aware_utc(value: datetime | None) -> datetime | None:
    """Mongo can hand back a naive datetime (no tzinfo) for a value that
    was always meant as UTC — same defensive normalisation app.routers.
    oauth's `as_utc` applies to code/token expiry, needed here for the
    same reason: comparing a naive and an aware datetime raises, it
    doesn't just compare wrong."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


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
    unknown, malformed, revoked, OR EXPIRED (A32) credential — deliberately
    the same outward shape for all four, so a caller can't use response
    differences to enumerate which tokens once existed or distinguish
    "expired" from "revoked" from "never existed". Never raises on a DB
    hiccup: a failed lookup is treated exactly like "not found" (fail
    closed — a credential that can't be verified grants no access, it
    never falls back to trusting the caller).

    A32 legacy note: a credential minted before this field existed and not
    yet reached by `app.main._migrate_bot_credential_expiry` (the startup
    migration runs within moments of deploy, but isn't instantaneous) has
    no `expires_at` at all — `doc.get("expires_at")` is None, and that is
    treated as "not expired" here, NOT as "expired instantly". The
    alternative (missing field = expired) would lock out every credential
    minted under the old system the moment this code ships, before the
    migration has even had a chance to backfill a grace window onto it;
    treating a genuinely missing field as eternal (the bug this item
    exists to close) is avoided instead by the migration itself, which
    guarantees every such row gets a bounded `expires_at` almost
    immediately rather than leaving this function to paper over it
    forever."""
    try:
        doc = await bot_credentials_col.find_one({"_id": hash_token(token)})
    except Exception:
        logger.exception("bot_credentials: lookup failed")
        return None
    if not doc or doc.get("revoked_at"):
        return None
    expires_at = _as_aware_utc(doc.get("expires_at"))
    if expires_at is not None and expires_at <= datetime.now(timezone.utc):
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


async def record_unknown_attempt(method: str, path: str, source_ip: str) -> None:
    """A32: audit trail for a bot-prefixed bearer token that did NOT
    resolve to a live credential (unknown, malformed, revoked, or expired
    — `resolve_bot_credential` deliberately gives all four the same outward
    shape, but an investigator looking for a probe needs to see that the
    attempt happened at all). Called from both `app.core.auth.auth_middleware`
    and `current_user`'s bot branch on `cred is None`, same "validated (and
    now audited-on-failure) in both places" doctrine as the credential
    check itself — in real traffic these can never both fire for the same
    request, since the middleware always runs first and never calls
    `call_next` when `ok` is False, so `current_user`'s own branch here is
    unreachable then; the duplication only matters for whichever surface a
    test or a future code path happens to exercise directly.

    Deliberately does NOT record the presented token, not even hashed or
    truncated. Hashing it with the same SHA-256 scheme `bot_credentials_col`
    uses for `_id` would mean anyone who ever sees both this collection and
    a leaked/backed-up `bot_credentials_col` (including an old, revoked
    credential's hash, which is never deleted, only flagged) could confirm
    by simple equality that a specific historical guess was an exact,
    once-valid token — worse than telling them nothing, since a bare 401
    already told them the guess was wrong. Truncating narrows a
    brute-force attacker's remaining search space for free. Neither buys
    an investigator anything a plain "these came from this route, this
    volume" signal doesn't already give.

    Deliberately aggregated, not one row per attempt: this collection is
    the one place in the app a caller can write to it with NO credential
    at all (that's the entire premise — the token doesn't resolve), so it
    is attacker-controllable in a way `bot_credential_uses_col` above
    isn't. `app.core.ratelimit.check_catch_all_ip_limit` already runs
    earlier in `auth_middleware` for every request (A27, 600/60s per IP)
    and bounds the real-time rate, but at that ceiling one IP could still
    generate roughly 864,000 requests/day; upserting a single row per (UTC
    day, source IP) and incrementing a counter keeps this collection's
    size bounded by (days retained x distinct source IPs seen) instead of
    by request volume, so a sustained flood costs one growing counter, not
    one growing collection. Backstopped by a TTL index on `last_seen`
    (app/main.py, BOT_CREDENTIAL_UNKNOWN_TTL_DAYS, same 90-day bound as
    the MCP connector's own audit log) so even the (day, IP) rows
    eventually age out once the source goes quiet."""
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    try:
        await bot_credential_unknown_col.update_one(
            {"_id": f"{day}:{source_ip}"},
            {
                "$set": {
                    "day": day, "source_ip": source_ip, "last_seen": now,
                    "last_method": method, "last_path": path,
                },
                "$setOnInsert": {"first_seen": now},
                "$inc": {"count": 1},
            },
            upsert=True,
        )
    except Exception:
        logger.exception("bot_credentials: failed to write unknown-attempt audit row")


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
