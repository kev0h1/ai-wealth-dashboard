"""Google Play Billing configuration (C24, docs/pricing/store-billing-c13.md).

A leaf module like app.core.config: nothing here imports services. Every
value is read from the environment once at import; tests monkeypatch the
module attributes. Secrets (the service-account key, the shared secret, the
account-id salt) are only ever held in memory and never logged or returned.

Prices are not configured here: Kevin decided (2026-10-17) that store prices
match web exactly, so app.core.subscription.TIER_BILLING_PRICES_GBP and
PENNY_TOPUP_PACKS are the single source, and the app shows the price string
the store itself returns. Product ids follow the shared deterministic scheme
in app.core.store_catalogue; PLAY_PRODUCT_IDS only overrides entries of it.
"""
import logging
import os

from app.core.config import APP_URL, _is_non_production, _parse_flag

PLAY_PACKAGE_NAME = os.getenv("PLAY_PACKAGE_NAME", "co.uk.auriqltd.sorted").strip()


def _parse_play_product_ids(raw: str) -> dict[str, str]:
    """Parse PLAY_PRODUCT_IDS ("key=product_id,...") into overrides, same key
    vocabulary as STRIPE_PRICE_IDS and APPLE_PRODUCT_IDS. A malformed entry
    is skipped with a warning so one typo cannot crash import."""
    out: dict[str, str] = {}
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        key, sep, product_id = chunk.partition("=")
        key, product_id = key.strip(), product_id.strip()
        if not sep or not key or not product_id:
            logging.getLogger("app.startup").warning("PLAY_PRODUCT_IDS: skipping malformed entry %r", chunk)
            continue
        out[key] = product_id
    return out


PLAY_PRODUCT_IDS: dict[str, str] = _parse_play_product_ids(os.getenv("PLAY_PRODUCT_IDS", ""))

# Explicit switch, default OFF (fail closed). Kevin turns it on once the
# products exist in Play Console, the service account has API access and the
# Pub/Sub push subscription is live. While off the client is told Play
# purchases are unavailable, no account id is minted and the receiver and
# verify endpoint answer 503.
PLAY_IAP_ENABLED: bool = _parse_flag(os.getenv("PLAY_IAP_ENABLED"))

# Service account used to call the Google Play Developer API. Either a path to
# the JSON key file (preferred, kept outside the repo) or the JSON itself.
PLAY_SERVICE_ACCOUNT_FILE = os.getenv("PLAY_SERVICE_ACCOUNT_FILE", "").strip()
PLAY_SERVICE_ACCOUNT_JSON = os.getenv("PLAY_SERVICE_ACCOUNT_JSON", "").strip()

# Pub/Sub push authentication for POST /webhooks/google-play. OIDC is the
# preferred mode: the push subscription is configured with a service account
# and an audience, and Pub/Sub sends a Google-signed JWT. When OIDC is
# configured it is REQUIRED; the shared secret (a token in the push URL's
# query string) is the fallback only when OIDC is not configured. With
# neither configured the receiver answers 503 (fails closed).
PLAY_RTDN_OIDC_AUDIENCE = os.getenv("PLAY_RTDN_OIDC_AUDIENCE", "").strip()
PLAY_RTDN_OIDC_EMAIL = os.getenv("PLAY_RTDN_OIDC_EMAIL", "").strip().lower()
PLAY_RTDN_SHARED_SECRET = os.getenv("PLAY_RTDN_SHARED_SECRET", "").strip()

# Salt for the obfuscated account id sent to Google at purchase time (a
# 64-char salted sha256 of the user id, never the email). Mandatory: with no
# salt no account id is minted and nothing can be purchased.
PLAY_ACCOUNT_ID_SALT = os.getenv("PLAY_ACCOUNT_ID_SALT", "").strip()

# Licence-tester purchases carry `testPurchase` in the Developer API reply.
# Default: allowed on UAT/local hosts only, refused on the production host,
# derived from APP_URL exactly like TRUELAYER_ENABLED (unrecognised host is
# production). Override deliberately with PLAY_ALLOW_TEST_PURCHASES=1 to run
# the internal-track test script against production.
_allow_raw = os.getenv("PLAY_ALLOW_TEST_PURCHASES")
PLAY_ALLOW_TEST_PURCHASES: bool = _parse_flag(_allow_raw) if _allow_raw is not None else _is_non_production(APP_URL)

# The offer id of the 14-day free trial offer on every base plan (Kevin's
# Play Console setup list). The trial is recognised from the purchase's
# offerDetails.offerId, bounded by SUBSCRIPTION_TRIAL_DAYS from the start.
PLAY_TRIAL_OFFER_ID = os.getenv("PLAY_TRIAL_OFFER_ID", "free-trial").strip()

PLAY_API_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3"
PLAY_OAUTH_SCOPE = "https://www.googleapis.com/auth/androidpublisher"
