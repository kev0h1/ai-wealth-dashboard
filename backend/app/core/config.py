"""Central configuration — all env vars and derived constants."""
import logging
import os
import secrets
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption,
)

_BACKEND_DIR = Path(__file__).parent.parent.parent
load_dotenv(dotenv_path=_BACKEND_DIR / ".env")

# ── General ───────────────────────────────────────────────────────────────────
MONGO_URI           = os.getenv("MONGO_URI", "mongodb://localhost:27017")
# H90 (2026-09-28): the database NAME within the deployment MONGO_URI points
# at. Long present in UAT's backend/.env (`MONGO_DB=wealth`, matching what
# app/db/collections.py used to hardcode) but never actually read anywhere
# — see docs/ops/ENV.md's old "vestigial" note, now removed, since this is
# the wire-up. Every real process (API, worker) leaves this unset and gets
# "wealth", identical to the old hardcoded behaviour. backend/tests/
# conftest.py sets this to a "_test"-suffixed name (default "wealth_test")
# BEFORE any test can create a collection handle, so the whole backend
# suite runs against a disposable database in the SAME Mongo deployment,
# never the real one this app serves users from.
MONGO_DB            = os.getenv("MONGO_DB", "wealth")
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY", "")
# Provider routing preferences applied to every OpenRouter request.
# "data_collection": "deny" restricts routing to upstream providers that do
# not retain or train on submitted prompts (regulatory commitment — see SECURITY.md).
OPENROUTER_PROVIDER_PREFS = {"data_collection": "deny"}
# A80 (pentest LLM-07): service-wide monthly ceiling on OpenRouter calls,
# on top of (never instead of) the per-user allowances in core/subscription.py.
# Counts CALLS, not dollars, because that is what's already metered per user
# (app.core.llm.monthly_usage) — see app/core/llm.py's openrouter_chat for
# where this is enforced. 0 (default) means disabled: no counter write, no
# ceiling. See docs/ops/ENV.md for the recommended production value.
LLM_GLOBAL_MONTHLY_CALL_CEILING = int(os.getenv("LLM_GLOBAL_MONTHLY_CALL_CEILING", "0"))
TAVILY_API_KEY      = os.getenv("TAVILY_API_KEY", "")
LOGODEV_TOKEN       = os.getenv("LOGODEV_TOKEN", "")
APP_URL             = os.getenv("APP_URL", "https://wealth.auriqltd.co.uk")
# The API's own public domain (Railway backend, reached directly by mobile
# builds — see frontend/scripts/build-mobile.sh's MOBILE_API_BASE). Added to
# CORS below alongside APP_URL; the web app keeps using APP_URL's /api
# rewrite and never talks to this origin directly.
API_PUBLIC_URL      = os.getenv("API_PUBLIC_URL", "https://api.wealth.auriqltd.co.uk")
# F8: the connector's own public URL. Defaults to API_PUBLIC_URL's /mcp path
# (today's behaviour, unchanged) but is meant to be pointed at a dedicated
# hostname (e.g. https://mcp.wealth.auriqltd.co.uk/mcp) once that host is
# DNS-provisioned (see A18 for API_PUBLIC_URL's own equivalent), so edge
# rules and a later service split can target /mcp traffic without touching
# the main API host. This backend answers both hosts identically — routing
# is by path, not Host header — so pointing this at a new hostname needs no
# other code change, only the env var and the DNS/reverse-proxy record.
MCP_PUBLIC_URL       = os.getenv("MCP_PUBLIC_URL", f"{API_PUBLIC_URL}/mcp")


def _origin_of(url: str) -> str:
    """scheme://host[:port] of `url`, dropping any path — factored out
    (rather than inlined the way most derived constants here are) so tests
    can exercise the parsing rule on its own, the same convention
    `_parse_flag` below uses for MCP_CONNECTOR_ENABLED."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


# Origin (scheme + host[:port]) MCP_PUBLIC_URL resolves to — the well-known
# discovery document (RFC 9728) must live at THIS origin's /.well-known/
# path, which differs from API_PUBLIC_URL's origin once MCP_PUBLIC_URL
# points at a dedicated host. Derived once here so app.core.auth and
# app.main don't each re-parse MCP_PUBLIC_URL themselves.
MCP_ORIGIN           = _origin_of(MCP_PUBLIC_URL)
_raw_allowed_emails = [e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "kevin.maingi12@gmail.com").split(",") if e.strip()]
ALLOWED_EMAILS      = set(_raw_allowed_emails)
PRIMARY_EMAIL       = _raw_allowed_emails[0] if _raw_allowed_emails else "local"
SESSION_MAX_AGE     = 7 * 24 * 3600

# Subscription tier a user gets when they have no subscription doc (or an
# expired/unrecognised one) — see app.core.subscription. Nobody should be
# restricted before launch, so this defaults to the top tier.
DEFAULT_TIER        = os.getenv("DEFAULT_TIER", "plus")

_GMAIL_DOMAINS = {"gmail.com", "googlemail.com"}


def _gmail_key(email: str) -> str:
    """Gmail ignores dots in the local part and treats googlemail.com as gmail.com."""
    local, _, domain = email.lower().partition("@")
    if domain in _GMAIL_DOMAINS:
        return f"{local.replace('.', '')}@gmail.com"
    return email.lower()


# Earlier entries win if two allow-list emails collapse to the same Gmail key
# (build in list order, only filling keys not already present).
_ALLOWED_BY_KEY: dict[str, str] = {}
for _e in _raw_allowed_emails:
    _k = _gmail_key(_e)
    if _k not in _ALLOWED_BY_KEY:
        _ALLOWED_BY_KEY[_k] = _e


def resolve_allowed_email(email: str) -> str | None:
    """Return the allow-list spelling for `email`, or None if it is not allowed.

    Exact (case-insensitive) matches win. Gmail/googlemail addresses also match
    dot-insensitively, and the returned value is the allow-list spelling so the
    same person always lands in the same account regardless of provider."""
    if not email:
        return None
    e = email.strip().lower()
    if e in ALLOWED_EMAILS:
        return e
    return _ALLOWED_BY_KEY.get(_gmail_key(e))


def mask_email(email: str) -> str:
    """'kevin.maingi12@gmail.com' -> 'ke***@gmail.com'; never raises."""
    try:
        local, _, domain = (email or "").partition("@")
        return f"{local[:2]}***@{domain or '?'}"
    except Exception:
        return "***"
REDIS_URL           = os.getenv("REDIS_URL", "redis://localhost:6379")

# ── Rate limiting / proxy trust ─────────────────────────────────────────────
# A92: the number of trusted reverse-proxy hops in front of this app that
# themselves append the real client address to X-Forwarded-For (a proxy the
# operator controls, not anything a caller can influence). app.core.ratelimit
# .client_ip() uses this to pick the right entry from the right-hand end of
# the header instead of trusting whatever a caller supplies. 0 (the default)
# means "trust no forwarded header at all, use the raw socket peer address"
# — the safe default: it can only under-differentiate clients sharing one
# proxy (they'd share one rate-limit bucket), it can never let a client pick
# its own bucket and dodge a limit, unlike trusting a caller-supplied header.
# See docs/ops/ENV.md for the value each environment should actually set.
TRUSTED_PROXY_HOPS  = int(os.getenv("TRUSTED_PROXY_HOPS", "0"))

# A110: TRUSTED_PROXY_HOPS above cannot serve production correctly on its
# own, because production has two ingress paths with different hop counts
# in front of this app: web traffic (browser -> Vercel's /api rewrite ->
# Railway edge -> app, two appending hops) and the mobile apps (straight to
# the Railway host, one hop). Setting TRUSTED_PROXY_HOPS=2 lets a mobile
# caller, who only ever produces one real hop, spoof the second-from-right
# entry itself; setting it to 1 collapses every web user onto Vercel's own
# egress IPs. These two variables let the backend tell the two paths apart
# instead of guessing from a hop count alone: frontend/proxy.ts tags every
# request its own /api rewrite forwards with the X-Sorted-Proxy-Auth header,
# set to TRUSTED_PROXY_SECRET's value, so app.core.ratelimit.client_ip()
# can use TRUSTED_PROXY_HOPS_WEB only for requests that actually carry a
# matching header (i.e. genuinely came through that rewrite), and fall back
# to TRUSTED_PROXY_HOPS for everything else, including the mobile apps and
# UAT (nginx, one hop, neither of these two variables set). Both default to
# "off" (empty secret, 0 hops) so an environment that never sets them keeps
# exactly today's TRUSTED_PROXY_HOPS-only behaviour. See docs/ops/ENV.md.
TRUSTED_PROXY_SECRET    = os.getenv("TRUSTED_PROXY_SECRET", "")
TRUSTED_PROXY_HOPS_WEB  = int(os.getenv("TRUSTED_PROXY_HOPS_WEB", "0"))

# Neither warning below is fatal: a wrong proxy-trust setting coarsens rate
# limits (everyone behind one proxy shares a bucket) or, for the second
# warning, silently leaves the web hop count unused, it never widens trust
# or takes the app down, so there is no case for refusing to start over it.
if TRUSTED_PROXY_HOPS <= 0:
    logging.getLogger("app.startup").warning(
        "TRUSTED_PROXY_HOPS is 0 (the default): every client behind a "
        "proxy in front of this app shares one rate-limit bucket. Set it "
        "to the real trusted hop count for this environment, see "
        "docs/ops/ENV.md."
    )
if TRUSTED_PROXY_SECRET and TRUSTED_PROXY_HOPS_WEB <= 0:
    logging.getLogger("app.startup").warning(
        "TRUSTED_PROXY_SECRET is set but TRUSTED_PROXY_HOPS_WEB is 0: the "
        "web ingress path (Vercel's /api rewrite) can never be "
        "distinguished from any other caller like this, every request "
        "falls back to TRUSTED_PROXY_HOPS. Likely a misconfiguration, see "
        "docs/ops/ENV.md."
    )

# ── Auth ─────────────────────────────────────────────────────────────────────
# A28 (2026-09-14): BOT_SECRET (a single static shared secret that
# authenticated as Kevin's own account) is retired. Its replacement —
# named, scoped, individually revocable credentials stored in
# app.db.collections.bot_credentials_col — is not an env var at all, see
# app.core.bot_credentials and backend/scripts_bot_credential.py. Any
# BOT_SECRET left set in an environment's .env/Railway config is now
# inert (nothing reads it); it is not read here on purpose.
GOOGLE_CLIENT_ID    = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# Sign in with Apple. APPLE_BUNDLE_ID is the native app's audience (native
# ASAuthorization flow puts the bundle id in the identityToken's `aud`).
# APPLE_SERVICES_ID is only needed for a future web/"Services ID" OAuth flow
# (Sign in with Apple JS or server-side redirect); empty means that flow
# isn't configured yet, so only the bundle id is accepted as audience.
APPLE_BUNDLE_ID     = os.getenv("APPLE_BUNDLE_ID", "co.uk.auriqltd.sorted")
APPLE_SERVICES_ID   = os.getenv("APPLE_SERVICES_ID", "")

# Phase 2 of the allow-list work (see app/core/identity.py): default false
# keeps registration restricted to ALLOWED_EMAILS (today's behaviour,
# unchanged). Set true to let any verified Google/Apple identity create an
# account — the identity resolver still runs first (Gmail dot-insensitive
# aliasing, Apple relay auto-linking) so the same person always lands in the
# same account either way.
OPEN_SIGNUP = os.getenv("OPEN_SIGNUP", "false").strip().lower() in ("1", "true", "yes")


def is_signup_open() -> bool:
    return OPEN_SIGNUP


# MCP connector kill switch (A17). The /mcp Streamable HTTP connector (F3)
# and its OAuth 2.1 authorisation server (F2) are built but not yet part of
# the Finexer compliance answers ("planned", not live), so production must
# ship with them entirely absent, not merely unauthenticated, until sign-off.
# Default false; UAT turns it on via backend/.env. Truthy strings: "1",
# "true", "on" (case-insensitive), deliberately narrower than OPEN_SIGNUP's
# set above, per the A17 backlog spec.
#
# `_parse_flag` is factored out (rather than inlined below, the way
# OPEN_SIGNUP is) so tests can exercise the parsing rule on its own with an
# explicit input, instead of asserting on `MCP_CONNECTOR_ENABLED` itself,
# which is fixed at import time from whatever the process environment held
# then. That module-level constant genuinely does depend on the process
# environment (`backend/.env` on UAT, which a worktree's own pytest run
# never loads), so a test that reads it directly would pass or fail
# depending on which tree it ran in and what UAT happens to have set today.
def _parse_flag(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "on")


MCP_CONNECTOR_ENABLED = _parse_flag(os.getenv("MCP_CONNECTOR_ENABLED"))

# B48: optional LLM phrasing of a composed savings tip. Off by default: the
# tip is composed deterministically from the shared research plus the user's
# own figures. When on, one OpenRouter call per tip rewords that text (no
# search, no other user's data) and falls back to the composed text unless
# every figure survives.
TIP_LLM_PHRASING = _parse_flag(os.getenv("TIP_LLM_PHRASING"))

# B48: share groceries and eating-out tip research by behaviour profile
# (Mirror traits front_loader, eating_out_signature). Off by default: a
# behavioural key is marginal at small scale, so every user shares the single
# `profile_general` key and no portrait is read. Turn on once there are enough
# users for a profile key to be a crowd rather than a person.
TIP_RESEARCH_PROFILE_KEYS = _parse_flag(os.getenv("TIP_RESEARCH_PROFILE_KEYS"))

# G316: shared vendor directory and the sync-time categorisation ladder.
# Every cost guard is a constant with an env override (docs/ops/ENV.md).
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


# Master switch. Ships OFF: when false the ladder never runs and categorisation
# is exactly as before G316. Kevin enables it per host after signing off a real
# vendor-directory report.
VENDOR_LADDER_ENABLED = os.getenv("VENDOR_LADDER_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
# New web lookups (Tavily search plus one reasoning-model write-up) one sync
# may start, and the whole service may start per UTC day.
VENDOR_LOOKUP_CAP_PER_SYNC = _env_int("VENDOR_LOOKUP_CAP_PER_SYNC", 5)
VENDOR_LOOKUP_CAP_PER_DAY = _env_int("VENDOR_LOOKUP_CAP_PER_DAY", 100)
# Merchants one user's sync may match to that user's categories (cheap model).
VENDOR_MATCH_CAP_PER_SYNC = _env_int("VENDOR_MATCH_CAP_PER_SYNC", 40)
# A directory entry (found, not_found or not_a_business) is looked up again
# after this many days.
VENDOR_REFRESH_DAYS = _env_int("VENDOR_REFRESH_DAYS", 365)
# How long one process may hold the in-flight claim on a merchant, and how long
# a merchant rests after a write-up failure before it is tried again.
VENDOR_CLAIM_TTL_SECONDS = _env_int("VENDOR_CLAIM_TTL_SECONDS", 120)
VENDOR_FAILURE_COOLDOWN_SECONDS = _env_int("VENDOR_FAILURE_COOLDOWN_SECONDS", 3600)
# Tavily quota (HTTP 432), auth and rate failures stop lookups for this long.
VENDOR_BACKOFF_HOURS = _env_int("VENDOR_BACKOFF_HOURS", 24)
# Model tiering (ENGINE.md): the reasoning model writes the directory
# description once; the cheap model matches a description to a user's categories.
VENDOR_REASONING_MODEL = os.getenv("VENDOR_REASONING_MODEL", "anthropic/claude-sonnet-4-5")
VENDOR_MATCH_MODEL = os.getenv("VENDOR_MATCH_MODEL", "anthropic/claude-haiku-4-5")

# F10: MCP-only service mode. The same backend image can run as a second
# Railway service on a dedicated `mcp` hostname, mounting only the
# oauth/mcp routers (see app.main.build_app's `mcp_only` param), sharing
# Mongo and Redis with the main app service, so a first Connect customer or
# visible assistant load can be isolated from the main app API without
# standing up separate infrastructure. See DEPLOY.md's "MCP-only service
# mode" section; not deployed anywhere yet as of this writing.
#
# A connector-only service with the connector itself disabled would boot
# with almost no routes at all, so MCP_ONLY=true implies
# MCP_CONNECTOR_ENABLED=true even if that var was left false or unset —
# rather than fail fast (which would just turn a slightly-misconfigured env
# into a crash-looping service), this logs a warning and treats the
# connector as enabled for this instance. Computed here, not in app.main,
# so every module that already reads MCP_CONNECTOR_ENABLED at import time
# (notably app.core.auth, see A17) sees the corrected value automatically.
MCP_ONLY = _parse_flag(os.getenv("MCP_ONLY", "false"))
if MCP_ONLY and not MCP_CONNECTOR_ENABLED:
    logging.getLogger("app.startup").warning(
        "MCP_ONLY=true but MCP_CONNECTOR_ENABLED was not set to a truthy value; "
        "MCP_ONLY implies the connector, treating MCP_CONNECTOR_ENABLED as enabled "
        "for this instance."
    )
    MCP_CONNECTOR_ENABLED = True

# F7: per-principal MCP rate limits, keyed by OAuth client_id or uid in
# app/routers/mcp.py (not IP, since Claude's and ChatGPT's connectors call from
# shared egress ranges, so an IP-keyed bucket would be shared by every user
# of the same assistant). MCP_BURST_PER_MINUTE guards tools/call specifically
# against a runaway agent loop; MCP_DAILY_SOFT_CAP is a coarser per-calendar-
# day backstop so that loop can't burn a whole month's allowance in an hour.
# MCP_CHEAP_METHOD_PER_MINUTE covers initialize/ping/tools/list, which are
# not billed against the monthly allowance or the daily cap at all, but still
# need a ceiling so a broken client's reconnect loop can't hammer them
# unbounded.
MCP_BURST_PER_MINUTE = int(os.getenv("MCP_BURST_PER_MINUTE", "60"))
MCP_DAILY_SOFT_CAP = int(os.getenv("MCP_DAILY_SOFT_CAP", "500"))
MCP_CHEAP_METHOD_PER_MINUTE = int(os.getenv("MCP_CHEAP_METHOD_PER_MINUTE", "240"))

# F14: /mcp connector audit log retention (app/main.py's TTL index on
# mcp_calls_col.ts). The monthly allowance survives this expiry because it
# reads mcp_call_counters_col (a separate, never-expired counter), not
# mcp_calls_col row counts — see app.core.subscription._mcp_call_count.
MCP_AUDIT_TTL_DAYS = int(os.getenv("MCP_AUDIT_TTL_DAYS", "90"))

# B18: Safe-to-Spend daily history snapshot retention (app/main.py's TTL
# index on safe_to_spend_history_col.computed_at). Same 90-day bound as the
# MCP audit log above, for the same reason: enough history for a
# "what changed since last week/month" read, bounded so the collection can
# never grow without limit.
SAFE_TO_SPEND_HISTORY_TTL_DAYS = int(os.getenv("SAFE_TO_SPEND_HISTORY_TTL_DAYS", "90"))

# A32: default lifetime for a bot/service credential (app.core.bot_credentials)
# when `scripts_bot_credential.py create` is run without --expires-days, and
# the grace window app.main's `_migrate_bot_credential_expiry` backfills onto
# any credential minted before this field existed (see that function's
# docstring for why the clock starts at migration time, not the
# credential's own `created_at`). 90 days matches the bound already used
# elsewhere in this file for "long-lived but must still end" (
# MCP_AUDIT_TTL_DAYS, SAFE_TO_SPEND_HISTORY_TTL_DAYS above): long enough
# that a legitimate automated caller (a cron job, a dashboard) isn't
# re-minted every few days, short enough that a forgotten credential can't
# live forever the way the old single static BOT_SECRET did — the exact
# bug A28 was opened to fix, now closed for expiry too.
BOT_CREDENTIAL_DEFAULT_TTL_DAYS = int(os.getenv("BOT_CREDENTIAL_DEFAULT_TTL_DAYS", "90"))

# A32: retention for bot_credential_unknown_col (app.core.bot_credentials.
# record_unknown_attempt) — the audit trail for a bot-prefixed bearer token
# that did NOT resolve to a live credential (unknown, malformed, revoked,
# or expired). Same 90-day bound as the MCP connector's own audit log
# (MCP_AUDIT_TTL_DAYS above), per that precedent.
BOT_CREDENTIAL_UNKNOWN_TTL_DAYS = int(os.getenv("BOT_CREDENTIAL_UNKNOWN_TTL_DAYS", "90"))


_secrets_file = _BACKEND_DIR / ".session_secret"
if s := os.getenv("SESSION_SECRET"):
    SESSION_SECRET = s
elif _secrets_file.exists():
    SESSION_SECRET = _secrets_file.read_text().strip()
else:
    SESSION_SECRET = secrets.token_hex(32)
    _secrets_file.write_text(SESSION_SECRET)



class RotatingSessionSerializer:
    """Session token signer with a bounded dual-key window (A171).

    Signs with the current key only, always. Verifies with the current key and,
    only while today (UTC) is on or before `previous_until` (an ISO date, the
    last day it is accepted), with `previous` as well. Past that date, or when
    no valid date is configured, the previous key is ignored even if set, so a
    forgotten SESSION_SECRET_PREVIOUS cannot keep a leaked key alive."""

    def __init__(self, current: str, previous: str = "", previous_until: str = "", clock=None):
        self._current = URLSafeTimedSerializer(current)
        self._previous = URLSafeTimedSerializer(previous) if previous else None
        self._until = None
        if previous_until:
            try:
                self._until = date.fromisoformat(previous_until.strip())
            except ValueError:
                self._until = None
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def previous_active(self) -> bool:
        return (
            self._previous is not None
            and self._until is not None
            and self._clock().date() <= self._until
        )

    def dumps(self, obj, *args, **kwargs):
        return self._current.dumps(obj, *args, **kwargs)

    def loads(self, token, *args, **kwargs):
        try:
            return self._current.loads(token, *args, **kwargs)
        except SignatureExpired:
            # The current key DID verify (token merely too old): never retry.
            raise
        except BadSignature:
            if not self.previous_active():
                raise
            return self._previous.loads(token, *args, **kwargs)


SESSION_SECRET_PREVIOUS = os.getenv("SESSION_SECRET_PREVIOUS", "")
SESSION_SECRET_PREVIOUS_UNTIL = os.getenv("SESSION_SECRET_PREVIOUS_UNTIL", "")
serializer = RotatingSessionSerializer(
    SESSION_SECRET, SESSION_SECRET_PREVIOUS, SESSION_SECRET_PREVIOUS_UNTIL
)

# ── TrueLayer ─────────────────────────────────────────────────────────────────
TRUELAYER_CLIENT_ID      = os.getenv("TRUELAYER_CLIENT_ID")
TRUELAYER_CLIENT_SECRET  = os.getenv("TRUELAYER_CLIENT_SECRET")
_webhook_secret_file = _BACKEND_DIR / ".webhook_secret"
if _ws := os.getenv("TRUELAYER_WEBHOOK_SECRET"):
    TRUELAYER_WEBHOOK_SECRET = _ws
elif _webhook_secret_file.exists():
    TRUELAYER_WEBHOOK_SECRET = _webhook_secret_file.read_text().strip()
else:
    TRUELAYER_WEBHOOK_SECRET = secrets.token_urlsafe(32)
    _webhook_secret_file.write_text(TRUELAYER_WEBHOOK_SECRET)
TRUELAYER_AUTH_URL       = "https://auth.truelayer.com"
TRUELAYER_API_URL        = "https://api.truelayer.com"
TRUELAYER_REDIRECT_URI   = os.getenv("TRUELAYER_REDIRECT_URI", "http://localhost:8000/auth/truelayer/callback")


# A67: TrueLayer is a UAT-only provider. Finexer is the only provider
# production ever talks to.
#
# Deliberately NOT its own env flag, unlike MCP_CONNECTOR_ENABLED above.
# Kevin's decision on this item was that "behind a flag is not enough if
# the flag could be switched on in production, so enforce absence rather
# than rely on configuration" — a `TRUELAYER_ENABLED` var would be exactly
# the switch he ruled out. So this is DERIVED from APP_URL, the public host
# this process is actually serving, which is the one thing this codebase
# already uses to tell the environments apart (it is the CORS origin, the
# OAuth/webhook base, and `app.services.backlog.PUBLIC_UAT_HOST` is the
# same UAT host string spelled out again). Production's APP_URL is
# https://wealth.auriqltd.co.uk, so the TrueLayer routes are absent there
# today, before and regardless of whether the TRUELAYER_* credentials are
# ever cleared off Railway (`scripts/release.py check` is what pushes for
# that clearing; see its `verdict_truelayer_absent`).
#
# Fails CLOSED: the allow-list below is of non-production hosts, so an
# unrecognised or malformed APP_URL mounts nothing, rather than an
# allow-everything-but-production rule where a typo'd production APP_URL
# would quietly turn TrueLayer back on in production. localhost is included
# so a developer running the API directly still has the provider available.
NON_PRODUCTION_APP_HOSTS = frozenset({
    "uat.wealth.auriqltd.co.uk",
    "localhost",
    "127.0.0.1",
})


def _is_non_production(app_url: str) -> bool:
    """True when `app_url`'s host is one this app may treat as UAT/local.

    Factored out (rather than inlined) for the same reason `_parse_flag`
    and `_origin_of` above are: it lets tests exercise the rule itself
    against explicit inputs, instead of asserting on TRUELAYER_ENABLED,
    which is fixed at import time from whatever APP_URL the process
    happened to have (set in `backend/.env` on UAT, which the shared tree
    loads and a session worktree does not)."""
    host = (urlsplit(app_url).hostname or "").strip().lower()
    return host in NON_PRODUCTION_APP_HOSTS


TRUELAYER_ENABLED = _is_non_production(APP_URL)

# B47: UAT-only admin routes (app.routers.uat_trial_reset), mounted by the
# same APP_URL-derived rule as TrueLayer, never a separate env switch.
UAT_ADMIN_ENABLED = _is_non_production(APP_URL)

# ── VAPID / Web Push ──────────────────────────────────────────────────────────
VAPID_SUBJECT   = os.getenv("VAPID_SUBJECT", "mailto:admin@wealthdashboard.app")
_vapid_key_file = _BACKEND_DIR / ".vapid_private_key"

if _vapid_pk_env := os.getenv("VAPID_PRIVATE_KEY"):
    _vapid_pem = _vapid_pk_env.replace("\\n", "\n").encode()
elif _vapid_key_file.exists():
    _vapid_pem = _vapid_key_file.read_bytes()
else:
    _v = Vapid()
    _v.generate_keys()
    _vapid_pem = _v.private_key.private_bytes(Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption())
    _vapid_key_file.write_bytes(_vapid_pem)

_vapid               = Vapid.from_pem(_vapid_pem)
VAPID_PRIVATE_KEY_PEM: str = _vapid_pem.decode()
VAPID_PUBLIC_KEY_B64: str  = (
    __import__("base64").urlsafe_b64encode(
        _vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    ).rstrip(b"=").decode()
)

# ── APNs / native iOS Push ──────────────────────────────────────────────────────
APNS_KEY_ID       = os.getenv("APNS_KEY_ID", "")
APNS_TEAM_ID      = os.getenv("APNS_TEAM_ID", "")
APNS_BUNDLE_ID    = os.getenv("APNS_BUNDLE_ID", "co.uk.auriqltd.sorted")
APNS_USE_SANDBOX  = os.getenv("APNS_USE_SANDBOX", "false").lower() in ("1", "true", "yes")

_apns_key_file = _BACKEND_DIR / ".apns_auth_key.p8"
_apns_key_path = Path(os.getenv("APNS_AUTH_KEY_PATH")) if os.getenv("APNS_AUTH_KEY_PATH") else _apns_key_file

if _apns_key_env := os.getenv("APNS_AUTH_KEY"):
    APNS_AUTH_KEY_PEM = _apns_key_env.replace("\\n", "\n")
elif _apns_key_path.exists():
    APNS_AUTH_KEY_PEM = _apns_key_path.read_text()
else:
    # Unlike VAPID, an APNs key is issued by Apple and cannot be generated
    # locally. If none is configured, APNs stays disabled (no-op on send).
    APNS_AUTH_KEY_PEM = None

APNS_CONFIGURED: bool = bool(APNS_KEY_ID and APNS_TEAM_ID and APNS_AUTH_KEY_PEM)

# ── FCM / native Android Push ────────────────────────────────────────────────
FCM_PROJECT_ID = os.getenv("FCM_PROJECT_ID", "")

_fcm_sa_file = _BACKEND_DIR / ".fcm_service_account.json"
_fcm_sa_path = Path(os.getenv("FCM_SERVICE_ACCOUNT_PATH")) if os.getenv("FCM_SERVICE_ACCOUNT_PATH") else _fcm_sa_file

if _fcm_sa_env := os.getenv("FCM_SERVICE_ACCOUNT_JSON"):
    FCM_SERVICE_ACCOUNT_JSON = _fcm_sa_env
elif _fcm_sa_path.exists():
    FCM_SERVICE_ACCOUNT_JSON = _fcm_sa_path.read_text()
else:
    # Like APNs, a Firebase service-account key is issued by Google and
    # cannot be generated locally. If none is configured, FCM stays
    # disabled (no-op on send).
    FCM_SERVICE_ACCOUNT_JSON = None

_FCM_SA_PARSEABLE = False
if FCM_SERVICE_ACCOUNT_JSON:
    try:
        import json as _json
        _json.loads(FCM_SERVICE_ACCOUNT_JSON)
        _FCM_SA_PARSEABLE = True
    except Exception:
        _FCM_SA_PARSEABLE = False

FCM_CONFIGURED: bool = bool(FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON and _FCM_SA_PARSEABLE)

# ── Yapily ────────────────────────────────────────────────────────────────────
YAPILY_APP_UUID = os.getenv("YAPILY_APP_UUID", "")
YAPILY_SECRET   = os.getenv("YAPILY_SECRET", "")
YAPILY_BASE_URL = os.getenv("YAPILY_BASE_URL", "https://api.yapily.com")

# ── Finexer ───────────────────────────────────────────────────────────────────
FINEXER_API_KEY    = os.getenv("FINEXER_API_KEY", "")
FINEXER_API_URL    = "https://api.finexer.com"
FINEXER_RETURN_URL = os.getenv("FINEXER_RETURN_URL", "https://wealth.auriqltd.co.uk/auth/finexer/callback")
# A143: branded consent-page templates. FINEXER_APP_ID is the app id from the
# Finexer app settings (used by scripts/finexer_template.py and the template
# check); FINEXER_TEMPLATE_DARK is the 12-char id of the "Sorted dark" template.
FINEXER_APP_ID          = os.getenv("FINEXER_APP_ID", "")
FINEXER_TEMPLATE_DARK   = os.getenv("FINEXER_TEMPLATE_DARK", "")

# H19: how long the cached /providers walk (finexer_providers_col, see
# app/db/collections.py) is trusted before app.services.finexer_sync.
# list_providers() re-walks the API. The provider list barely ever
# changes, so this is deliberately long.
FINEXER_PROVIDERS_TTL_HOURS = int(os.getenv("FINEXER_PROVIDERS_TTL_HOURS", "24"))

# URL secret embedded in the webhook path (same scheme as TRUELAYER_WEBHOOK_SECRET
# above: env wins, else a persisted file, else generate one on first boot).
_finexer_webhook_secret_file = _BACKEND_DIR / ".finexer_webhook_secret"
if _fws := os.getenv("FINEXER_WEBHOOK_SECRET"):
    FINEXER_WEBHOOK_SECRET = _fws
elif _finexer_webhook_secret_file.exists():
    FINEXER_WEBHOOK_SECRET = _finexer_webhook_secret_file.read_text().strip()
else:
    FINEXER_WEBHOOK_SECRET = secrets.token_urlsafe(32)
    _finexer_webhook_secret_file.write_text(FINEXER_WEBHOOK_SECRET)

# Signing secret Finexer issues after the webhook is registered in their
# dashboard (used to verify the "fx-signature" header) — unlike the URL secret
# above, this is NEVER auto-generated: it must come from Finexer. Empty string
# means "not configured yet": the URL path secret is then the only gate (startup
# logs that once). When set, the signature is mandatory and fails closed (A167).
_finexer_webhook_signing_secret_file = _BACKEND_DIR / ".finexer_webhook_signing_secret"
if _fwss := os.getenv("FINEXER_WEBHOOK_SIGNING_SECRET"):
    FINEXER_WEBHOOK_SIGNING_SECRET = _fwss
elif _finexer_webhook_signing_secret_file.exists():
    FINEXER_WEBHOOK_SIGNING_SECRET = _finexer_webhook_signing_secret_file.read_text().strip()
else:
    FINEXER_WEBHOOK_SIGNING_SECRET = ""

# ── Finexer webhook tunables (A167) ──────────────────────────────────────────
# Finexer's webhook documentation has NOT been pinned down from an
# authoritative source (see docs/ops/FINEXER_WEBHOOKS.md for exactly which
# facts are confirmed and which are assumed). Every provider-shaped fact
# below is therefore a config key with the current assumption as default, so
# Kevin can correct it from Finexer's docs page without a code change.
#
# Signature: scheme "t_s_hmac_sha256" = header "t=<ISO8601>;s=<hex>", HMAC-SHA256
# over "<t>.<raw body>" (what A89 implemented); "raw_hmac_sha256" = header is
# the hex (optionally "sha256=" prefixed) HMAC-SHA256 of the raw body, with the
# freshness check taken from FINEXER_WEBHOOK_TIMESTAMP_HEADER (epoch seconds or
# ISO8601) when that is set.
FINEXER_WEBHOOK_SIGNATURE_HEADER = os.getenv("FINEXER_WEBHOOK_SIGNATURE_HEADER", "fx-signature")
FINEXER_WEBHOOK_SIGNATURE_SCHEME = os.getenv("FINEXER_WEBHOOK_SIGNATURE_SCHEME", "t_s_hmac_sha256")
FINEXER_WEBHOOK_TIMESTAMP_HEADER = os.getenv("FINEXER_WEBHOOK_TIMESTAMP_HEADER", "")
FINEXER_WEBHOOK_TOLERANCE_SECONDS = int(os.getenv("FINEXER_WEBHOOK_TOLERANCE_SECONDS", "300"))
# Dotted path into the JSON body of the event's unique id, e.g. "id" or
# "data.id". Used for insert-if-absent idempotency in webhook_events_col.
FINEXER_WEBHOOK_EVENT_ID_FIELD = os.getenv("FINEXER_WEBHOOK_EVENT_ID_FIELD", "id")
# Dotted path to the event type string; the first non-empty of these wins.
FINEXER_WEBHOOK_EVENT_TYPE_FIELDS = os.getenv("FINEXER_WEBHOOK_EVENT_TYPE_FIELDS", "type,event")
# JSON object {event type string: action}, merged OVER the built-in default
# table (app.services.finexer_webhooks.DEFAULT_EVENT_ACTIONS). Actions:
# sync_consent, consent_authorised, consent_expiring, consent_revoked, unknown.
FINEXER_WEBHOOK_EVENT_ACTIONS = os.getenv("FINEXER_WEBHOOK_EVENT_ACTIONS", "")
# Seconds a burst of events for one consent is coalesced into one sync.
FINEXER_WEBHOOK_DEBOUNCE_SECONDS = int(os.getenv("FINEXER_WEBHOOK_DEBOUNCE_SECONDS", "30"))
# Hard bound on the request body, checked before it is read.
FINEXER_WEBHOOK_MAX_BODY_BYTES = int(os.getenv("FINEXER_WEBHOOK_MAX_BODY_BYTES", "65536"))
# Polling safety net: with webhooks healthy a consent is polled once per this
# many hours; 0 restores the legacy per-tier cadence (4h/daily) for everyone.
FINEXER_POLL_INTERVAL_HOURS = float(os.getenv("FINEXER_POLL_INTERVAL_HOURS", "24"))
# A consent with no webhook for this many hours falls back to its tier's own
# polling cadence, and is counted on /ops/health.
FINEXER_WEBHOOK_STALE_HOURS = float(os.getenv("FINEXER_WEBHOOK_STALE_HOURS", "24"))

# ── Stripe billing (B5) ──────────────────────────────────────────────────────
# No Stripe account exists yet (Kevin, 2026-09-09 backlog decision) — this is
# built entirely against Stripe TEST mode with placeholder keys so it is
# ready the day the account exists; nothing here can go live before then.
# All three names are optional and unlike the webhook secrets above, NEVER
# auto-generated (a Stripe key/secret has to come from Stripe's dashboard,
# there is nothing to generate locally). See docs/ops/ENV.md's Stripe rows
# and DEPLOY.md's "Stripe setup checklist" for how to populate them, and
# app/services/billing.py for what reads them.
STRIPE_SECRET_KEY     = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")


def _parse_stripe_price_ids(raw: str) -> dict[str, str]:
    """Parse STRIPE_PRICE_IDS ("key=price_id,key=price_id,...") into a
    dict. Three entries per paid subscription tier (monthly uses the bare
    tier name, then ``_<period>`` for ``six_months`` and ``annual``;
    Statements is free, it never checks out) and per purchasable pack
    (penny_small/penny_medium/penny_large, matching
    app.core.subscription.PENNY_TOPUP_PACKS' ids prefixed with "penny_" so
    a tier name and a pack id can never collide in the same map; mcp_1000,
    matching MCP_CALL_PACKS' own id verbatim since it's already
    "mcp_1000"). A malformed entry (no "=", empty key or value) is skipped
    with a warning rather than raising, so one typo in the env value
    doesn't crash the whole app at import time — it just leaves that one
    tier/pack unpurchasable, which BILLING_ENABLED below then correctly
    reports as not fully configured."""
    out: dict[str, str] = {}
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "=" not in chunk:
            logging.getLogger("app.startup").warning("STRIPE_PRICE_IDS: skipping malformed entry %r", chunk)
            continue
        key, _, price_id = chunk.partition("=")
        key, price_id = key.strip(), price_id.strip()
        if key and price_id:
            out[key] = price_id
        else:
            logging.getLogger("app.startup").warning("STRIPE_PRICE_IDS: skipping malformed entry %r", chunk)
    return out


STRIPE_PRICE_IDS: dict[str, str] = _parse_stripe_price_ids(os.getenv("STRIPE_PRICE_IDS", ""))

# Every price id BILLING_ENABLED requires before it flips true: every paid
# tier plus every purchasable pack. Kept as its own tuple (rather than
# importing app.core.subscription's TIER_NAMES/PENNY_TOPUP_PACKS/
# MCP_CALL_PACKS here) so this module has no import dependency on that one
# — app.core.config is meant to be the leaf of the import graph, loaded
# before almost everything else.
# B27 (2026-09-12): three_months was dropped from
# app.core.subscription.SUBSCRIPTION_PERIODS_ENABLED, so this no longer
# requires a price id for it either — 16 keys now, not 20. Kept as its own
# tuple rather than importing SUBSCRIPTION_PERIODS_ENABLED, for the same
# leaf-of-the-import-graph reason as the comment below.
_STRIPE_PAID_TIERS = ("lite", "standard", "plus")
# B53: Stripe price keys of the retired Connect and Max tiers. Never sold and
# never required; read only so a webhook for an existing Stripe subscription
# on one of those prices still resolves (to "plus").
_STRIPE_LEGACY_PAID_TIERS = ("connect", "max")
_STRIPE_LONGER_PERIODS = ("six_months", "annual")
_STRIPE_REQUIRED_PRICE_KEYS = (
    *_STRIPE_PAID_TIERS,
    *(f"{tier}_{period}" for tier in _STRIPE_PAID_TIERS for period in _STRIPE_LONGER_PERIODS),
    "penny_small", "penny_medium", "penny_large", "mcp_1000",
)

# Derived, not independently settable: true only once a secret key AND
# EVERY required price id above are present, so a partially-configured
# environment (e.g. the secret key set but a price id still missing) fails
# closed to "not live" rather than checking a user out into a broken or
# mismatched price. GET /subscription's `billing_live` mirrors this
# straight through so the frontend can gate real checkout/portal buttons
# off one flag (see MoreMessagesSheet.tsx, ConnectedAssistantsCard.tsx,
# the "Your plan" Settings card). Webhook signature verification has its
# own independent guard (STRIPE_WEBHOOK_SECRET, checked in
# app/services/billing.py) — a webhook can arrive and be correctly
# rejected even while BILLING_ENABLED is false.
BILLING_ENABLED: bool = bool(STRIPE_SECRET_KEY) and all(
    key in STRIPE_PRICE_IDS for key in _STRIPE_REQUIRED_PRICE_KEYS
)

# ── Trial lifecycle (B45) ────────────────────────────────────────────────────
# REVOKE_CONSENT_ON_DOWNGRADE: when a subscription ends (cancelled, expired,
# unpaid, or a trial that never converted) the user lands on the free
# Statements plan and open-banking sync stops. By default that is ALL that
# happens: the Finexer consent is kept, so resubscribing resumes sync with no
# fresh bank consent. Setting this true also revokes the user's authorised
# Finexer consents at downgrade (Finexer bills per connected account per
# month, so revoking stops that cost, at the price of making the user
# reconnect). Kevin has not decided; default off. See
# app/services/billing_lifecycle.py.
REVOKE_CONSENT_ON_DOWNGRADE: bool = os.getenv("REVOKE_CONSENT_ON_DOWNGRADE", "false").strip().lower() in ("1", "true", "on", "yes")

# How long a past_due (failed payment) subscription keeps its paid tier,
# counted from the first failed payment. Stripe's own retry schedule decides
# when it finally cancels; this bounds our side so access cannot outlive it.
BILLING_PAST_DUE_GRACE_DAYS: int = int(os.getenv("BILLING_PAST_DUE_GRACE_DAYS", "7") or 7)

# ── Apple in-app purchase (C21, docs/pricing/store-billing-c13.md) ────────────
# Prices are NOT configured here: Kevin decided (C24, 2026-10-17) that store
# prices match web exactly, so app.core.subscription.TIER_BILLING_PRICES_GBP
# and PENNY_TOPUP_PACKS are the single source and the client shows the
# store's own price string. Product ids follow a deterministic scheme in
# app.core.store_catalogue; APPLE_PRODUCT_IDS below only overrides entries of
# it ("key=product_id", same key vocabulary as STRIPE_PRICE_IDS), for the
# case where Kevin created a product under a different id. The refunded
# consumable clawback is the one decision still open with Kevin.
APPLE_BUNDLE_ID = os.getenv("APPLE_BUNDLE_ID", "co.uk.auriqltd.sorted").strip()


def _parse_apple_product_ids(raw: str) -> dict[str, str]:
    """Parse APPLE_PRODUCT_IDS ("key=product_id,key=product_id,...") into a
    dict of overrides. A malformed entry is skipped with a warning (one typo
    must not crash import), leaving that product on its default id."""
    out: dict[str, str] = {}
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        key, sep, product_id = chunk.partition("=")
        key, product_id = key.strip(), product_id.strip()
        if not sep or not key or not product_id:
            logging.getLogger("app.startup").warning("APPLE_PRODUCT_IDS: skipping malformed entry %r", chunk)
            continue
        out[key] = product_id
    return out


APPLE_PRODUCT_IDS: dict[str, str] = _parse_apple_product_ids(os.getenv("APPLE_PRODUCT_IDS", ""))

# Explicit switch, default OFF (fail closed): Kevin turns it on once the
# products exist in App Store Connect and the Apple root certificate is
# pinned. While off, the client is told IAP is unavailable, an account token
# is never minted and the receiver answers 503.
APPLE_IAP_ENABLED: bool = _parse_flag(os.getenv("APPLE_IAP_ENABLED"))

APPLE_ROOT_CERTS_DIR = Path(os.getenv("APPLE_ROOT_CERTS_DIR") or (_BACKEND_DIR / "app" / "certs" / "apple_roots"))


def _parse_apple_environments(raw: str | None) -> frozenset[str]:
    allowed = {"Sandbox", "Production"}
    out = {p.strip().capitalize() for p in (raw or "").split(",") if p.strip()}
    return frozenset(out & allowed)


# Which App Store Server Notification environments this deployment accepts.
# Default is derived from APP_URL exactly like TRUELAYER_ENABLED: UAT and
# local take Sandbox only (TestFlight and sandbox testers), the production
# host takes Production only, so a sandbox purchase can never grant a paid
# tier in production and a production notice can never reach UAT. An
# unrecognised APP_URL is treated as production (fails closed). Override with
# APPLE_ALLOWED_ENVIRONMENTS="Sandbox,Production" only deliberately, for
# example to let App Review's sandbox purchases through in production.
APPLE_ALLOWED_ENVIRONMENTS: frozenset[str] = (
    _parse_apple_environments(os.getenv("APPLE_ALLOWED_ENVIRONMENTS"))
    or (frozenset({"Sandbox"}) if _is_non_production(APP_URL) else frozenset({"Production"}))
)

# C13 section 8, the ONE decision still open with Kevin (proposal: no clawback). When false, a
# refunded Penny or MCP pack leaves its remaining messages or calls alone and
# the refund is only recorded. When true, the pack's remaining balance is set
# to zero. The subscription refund path (entitlement stripped at once) is
# unaffected by this flag.
IAP_REFUND_CLAWBACK: bool = _parse_flag(os.getenv("IAP_REFUND_CLAWBACK"))

# ── Reconcile spread (E2) ────────────────────────────────────────────────────
# task_reconcile_truelayer (app/workers/sync_worker.py) used to enqueue every
# stale connection's sync job in one burst every 4 hours. That's fine at
# today's single-worker scale, but once Railway Pro + replicas land (E2,
# unlocked by D4 moving rate limiting and mobile login state to Redis — see
# DEPLOY.md Step 3), a big burst of task_sync_finexer jobs firing at once
# could slam Finexer's API: the item's own arithmetic is "10,000 connections
# is about 42 syncs a minute" if fired in one go. These three spread that
# burst into a trickle instead of dropping or throttling anything — see
# DEPLOY.md's "Railway Pro and replicas (E2)" section for the worked sums.
#
# RECONCILE_SPREAD_MINUTES: how much of the connection's own staleness
# window (see sync_worker._DEFAULT_REFRESH_WINDOW, 3h30) the spread is
# allowed to use. Deliberately kept a little inside that window (210 of the
# available 210 minutes) so a connection spread to the very end of one cron
# run is still comfortably re-evaluated as "due" by the next 4-hourly tick,
# not left to drift a cycle late.
RECONCILE_SPREAD_MINUTES  = int(os.getenv("RECONCILE_SPREAD_MINUTES", "210"))
# RECONCILE_MAX_PER_MINUTE: the Finexer-safe ceiling from the item's own
# sums above (10,000 connections / 240 minutes ≈ 42/min; 40 gives a little
# headroom under that).
RECONCILE_MAX_PER_MINUTE  = int(os.getenv("RECONCILE_MAX_PER_MINUTE", "40"))
# RECONCILE_MIN_GAP_SECONDS: floor on the gap between any two consecutive
# jobs, independent of the per-minute ceiling above (matters once
# RECONCILE_MAX_PER_MINUTE is raised very high — a floor still keeps jobs
# from landing effectively simultaneously).
RECONCILE_MIN_GAP_SECONDS = int(os.getenv("RECONCILE_MIN_GAP_SECONDS", "2"))

# G217: smallest set-aside shortfall (in pence) that raises a Home card. Below
# it the account sheet line still shows, but Home stays quiet about pennies.
ALLOCATION_SHORTFALL_FLOOR_PENCE = int(os.getenv("ALLOCATION_SHORTFALL_FLOOR_PENCE", "500"))
