"""Central configuration — all env vars and derived constants."""
import logging
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import (
    Encoding, PublicFormat, PrivateFormat, NoEncryption,
)

_BACKEND_DIR = Path(__file__).parent.parent.parent
load_dotenv(dotenv_path=_BACKEND_DIR / ".env")

# ── General ───────────────────────────────────────────────────────────────────
MONGO_URI           = os.getenv("MONGO_URI", "mongodb://localhost:27017")
OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY", "")
# Provider routing preferences applied to every OpenRouter request.
# "data_collection": "deny" restricts routing to upstream providers that do
# not retain or train on submitted prompts (regulatory commitment — see SECURITY.md).
OPENROUTER_PROVIDER_PREFS = {"data_collection": "deny"}
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
DEFAULT_TIER        = os.getenv("DEFAULT_TIER", "max")

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

# ── Auth ─────────────────────────────────────────────────────────────────────
BOT_SECRET          = os.getenv("BOT_SECRET", "")
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


_secrets_file = _BACKEND_DIR / ".session_secret"
if s := os.getenv("SESSION_SECRET"):
    SESSION_SECRET = s
elif _secrets_file.exists():
    SESSION_SECRET = _secrets_file.read_text().strip()
else:
    SESSION_SECRET = secrets.token_hex(32)
    _secrets_file.write_text(SESSION_SECRET)

serializer = URLSafeTimedSerializer(SESSION_SECRET)

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

# ── Mono (Kenya) ──────────────────────────────────────────────────────────────
MONO_SECRET_KEY = os.getenv("MONO_SECRET_KEY", "")
MONO_PUBLIC_KEY  = os.getenv("MONO_PUBLIC_KEY", "")
MONO_API_URL     = "https://api.withmono.com/v2"

# ── Yapily ────────────────────────────────────────────────────────────────────
YAPILY_APP_UUID = os.getenv("YAPILY_APP_UUID", "")
YAPILY_SECRET   = os.getenv("YAPILY_SECRET", "")
YAPILY_BASE_URL = os.getenv("YAPILY_BASE_URL", "https://api.yapily.com")

# ── Finexer ───────────────────────────────────────────────────────────────────
FINEXER_API_KEY    = os.getenv("FINEXER_API_KEY", "")
FINEXER_API_URL    = "https://api.finexer.com"
FINEXER_RETURN_URL = os.getenv("FINEXER_RETURN_URL", "https://wealth.auriqltd.co.uk/auth/finexer/callback")

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
# means "not configured yet", which the receiver treats as pre-registration
# deploy state and skips signature verification (logging a warning).
_finexer_webhook_signing_secret_file = _BACKEND_DIR / ".finexer_webhook_signing_secret"
if _fwss := os.getenv("FINEXER_WEBHOOK_SIGNING_SECRET"):
    FINEXER_WEBHOOK_SIGNING_SECRET = _fwss
elif _finexer_webhook_signing_secret_file.exists():
    FINEXER_WEBHOOK_SIGNING_SECRET = _finexer_webhook_signing_secret_file.read_text().strip()
else:
    FINEXER_WEBHOOK_SIGNING_SECRET = ""

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
    dict. One entry per paid subscription tier (lite/standard/connect/max
    — Statements is free, it never checks out) and per purchasable pack
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
_STRIPE_REQUIRED_PRICE_KEYS = (
    "lite", "standard", "connect", "max",
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
