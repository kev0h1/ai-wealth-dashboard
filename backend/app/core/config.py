"""Central configuration — all env vars and derived constants."""
import os
import secrets
from pathlib import Path
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
TAVILY_API_KEY      = os.getenv("TAVILY_API_KEY", "")
LOGODEV_TOKEN       = os.getenv("LOGODEV_TOKEN", "")
APP_URL             = os.getenv("APP_URL", "https://wealth.auriqltd.co.uk")
_raw_allowed_emails = [e.strip().lower() for e in os.getenv("ALLOWED_EMAILS", "kevin.maingi12@gmail.com").split(",") if e.strip()]
ALLOWED_EMAILS      = set(_raw_allowed_emails)
PRIMARY_EMAIL       = _raw_allowed_emails[0] if _raw_allowed_emails else "local"
SESSION_MAX_AGE     = 7 * 24 * 3600
REDIS_URL           = os.getenv("REDIS_URL", "redis://localhost:6379")

# ── Auth ─────────────────────────────────────────────────────────────────────
BOT_SECRET          = os.getenv("BOT_SECRET", "")
GOOGLE_CLIENT_ID    = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

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
APNS_BUNDLE_ID    = os.getenv("APNS_BUNDLE_ID", "co.uk.auriqltd.wealth")
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
