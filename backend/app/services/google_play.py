"""Google network seam for C24: the Play Developer API and Pub/Sub OIDC.

Everything that touches the network lives behind two small interfaces so the
receiver (app.services.play_billing) is tested against fakes and never calls
Google from a test:

  * PlayApi       - purchases.subscriptionsv2.get, purchases.products.get,
                    the two acknowledge calls, products.consume and the
                    Voided Purchases list. HttpPlayApi is the httpx
                    implementation, authenticated with a service-account key
                    (RS256 JWT bearer grant, signed with PyJWT/cryptography,
                    both already installed; nothing new is added).
  * OidcVerifier  - verifies the Google-signed OIDC token Pub/Sub attaches to
                    a push. GoogleOidcVerifier fetches Google's public JWKS
                    over httpx and checks signature, issuer, audience, expiry
                    and the push service account's verified email.

Nothing here logs a token, a key or a response body. Errors carry the HTTP
status only (PlayApiError).
"""
import json
import logging
import time
from urllib.parse import quote
from typing import Any, Protocol

import httpx
import jwt

from app.core import play_config

logger = logging.getLogger(__name__)

_TOKEN_URI_DEFAULT = "https://oauth2.googleapis.com/token"
_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")
_HTTP_TIMEOUT = 15.0


def _q(segment: str) -> str:
    return quote(str(segment), safe="")


class PlayApiError(Exception):
    """A Play Developer API call failed. `status` is the HTTP status (0 when
    the request never completed). Never carries a response body."""

    def __init__(self, status: int, message: str = "Play API call failed"):
        super().__init__(f"{message} (status {status})")
        self.status = status


class PlayNotConfigured(Exception):
    """No usable service-account key is configured."""


class OidcRejected(Exception):
    """The Pub/Sub push token failed verification."""


class PlayApi(Protocol):
    async def get_subscription_v2(self, package: str, token: str) -> dict: ...
    async def get_product(self, package: str, product_id: str, token: str) -> dict: ...
    async def acknowledge_subscription(self, package: str, product_id: str, token: str) -> None: ...
    async def consume_product(self, package: str, product_id: str, token: str) -> None: ...
    async def list_voided(self, package: str, *, start_time_ms: int | None = None, page_token: str | None = None) -> dict: ...


class OidcVerifier(Protocol):
    async def verify(self, bearer_token: str, *, audience: str, email: str) -> None: ...


# ── Service account ──────────────────────────────────────────────────────────

def load_service_account() -> dict:
    """The service-account key as a dict, from PLAY_SERVICE_ACCOUNT_FILE or
    PLAY_SERVICE_ACCOUNT_JSON. Raises PlayNotConfigured (with no detail of
    the key) when neither yields a key with an email and a private key."""
    raw = ""
    if play_config.PLAY_SERVICE_ACCOUNT_FILE:
        try:
            with open(play_config.PLAY_SERVICE_ACCOUNT_FILE, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError:
            raise PlayNotConfigured("service account file unreadable")
    elif play_config.PLAY_SERVICE_ACCOUNT_JSON:
        raw = play_config.PLAY_SERVICE_ACCOUNT_JSON
    if not raw:
        raise PlayNotConfigured("no service account configured")
    try:
        data = json.loads(raw)
    except ValueError:
        raise PlayNotConfigured("service account key is not valid JSON")
    if not isinstance(data, dict) or not data.get("client_email") or not data.get("private_key"):
        raise PlayNotConfigured("service account key is incomplete")
    return data


def service_account_configured() -> bool:
    try:
        load_service_account()
        return True
    except PlayNotConfigured:
        return False


def build_assertion(sa: dict, *, now: float | None = None) -> str:
    """The RS256-signed JWT bearer assertion for the OAuth token exchange."""
    issued = int(now if now is not None else time.time())
    claims = {
        "iss": sa["client_email"],
        "scope": play_config.PLAY_OAUTH_SCOPE,
        "aud": sa.get("token_uri") or _TOKEN_URI_DEFAULT,
        "iat": issued,
        "exp": issued + 3600,
    }
    return jwt.encode(claims, sa["private_key"], algorithm="RS256")


class HttpPlayApi:
    """httpx implementation of PlayApi. One shared access token, refreshed a
    minute before it expires."""

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client
        self._access_token: str | None = None
        self._expires_at = 0.0

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
        return self._client

    async def _token(self) -> str:
        if self._access_token and time.time() < self._expires_at - 60:
            return self._access_token
        sa = load_service_account()
        try:
            resp = await self._http().post(
                sa.get("token_uri") or _TOKEN_URI_DEFAULT,
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": build_assertion(sa)},
            )
        except httpx.HTTPError:
            raise PlayApiError(0, "token exchange failed")
        if resp.status_code != 200:
            raise PlayApiError(resp.status_code, "token exchange failed")
        body = resp.json()
        token = body.get("access_token")
        if not isinstance(token, str) or not token:
            raise PlayApiError(resp.status_code, "token exchange returned no token")
        self._access_token = token
        self._expires_at = time.time() + float(body.get("expires_in") or 3000)
        return token

    async def _request(self, method: str, path: str, *, params: dict | None = None, json_body: Any = None) -> dict:
        token = await self._token()
        try:
            resp = await self._http().request(
                method, f"{play_config.PLAY_API_BASE}/{path}", params=params, json=json_body,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError:
            raise PlayApiError(0)
        if resp.status_code == 401:
            self._access_token = None  # next call re-exchanges
        if resp.status_code >= 300:
            raise PlayApiError(resp.status_code)
        if not resp.content:
            return {}
        try:
            data = resp.json()
        except ValueError:
            raise PlayApiError(resp.status_code, "non-JSON reply")
        return data if isinstance(data, dict) else {}

    # Every path segment is percent-encoded with no safe characters, so a
    # token or id can never add a path segment or a query string.
    async def get_subscription_v2(self, package: str, token: str) -> dict:
        return await self._request("GET", f"applications/{_q(package)}/purchases/subscriptionsv2/tokens/{_q(token)}")

    async def get_product(self, package: str, product_id: str, token: str) -> dict:
        return await self._request(
            "GET", f"applications/{_q(package)}/purchases/products/{_q(product_id)}/tokens/{_q(token)}")

    async def acknowledge_subscription(self, package: str, product_id: str, token: str) -> None:
        await self._request(
            "POST",
            f"applications/{_q(package)}/purchases/subscriptions/{_q(product_id)}/tokens/{_q(token)}:acknowledge",
            json_body={},
        )

    async def consume_product(self, package: str, product_id: str, token: str) -> None:
        await self._request(
            "POST", f"applications/{_q(package)}/purchases/products/{_q(product_id)}/tokens/{_q(token)}:consume")

    async def list_voided(self, package: str, *, start_time_ms: int | None = None, page_token: str | None = None) -> dict:
        params: dict[str, Any] = {"includeQuantityBasedPartialRefund": "true"}
        if start_time_ms is not None:
            params["startTime"] = str(start_time_ms)
        if page_token:
            params["token"] = page_token
        return await self._request("GET", f"applications/{_q(package)}/purchases/voidedpurchases", params=params)


# ── Pub/Sub push OIDC ────────────────────────────────────────────────────────

class GoogleOidcVerifier:
    """Verifies the `Authorization: Bearer <jwt>` Pub/Sub attaches to a push
    when the subscription has an authentication service account: RS256
    signature against Google's published keys, issuer accounts.google.com,
    audience equal to the configured audience, not expired, and the token's
    verified email equal to the push service account."""

    def __init__(self, client: httpx.AsyncClient | None = None):
        self._client = client
        self._keys: dict[str, dict] = {}
        self._fetched_at = 0.0

    async def _jwks(self, force: bool = False) -> dict[str, dict]:
        if not force and self._keys and time.time() - self._fetched_at < 3600:
            return self._keys
        client = self._client or httpx.AsyncClient(timeout=_HTTP_TIMEOUT)
        try:
            resp = await client.get(_GOOGLE_JWKS_URL)
        except httpx.HTTPError:
            raise PlayApiError(0, "jwks fetch failed")
        finally:
            if self._client is None:
                await client.aclose()
        if resp.status_code != 200:
            raise PlayApiError(resp.status_code, "jwks fetch failed")
        self._keys = {k["kid"]: k for k in resp.json().get("keys", []) if k.get("kid")}
        self._fetched_at = time.time()
        return self._keys

    async def verify(self, bearer_token: str, *, audience: str, email: str) -> None:
        try:
            header = jwt.get_unverified_header(bearer_token)
        except jwt.PyJWTError:
            raise OidcRejected("malformed token")
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise OidcRejected("unexpected algorithm")
        keys = await self._jwks()
        jwk = keys.get(header["kid"]) or (await self._jwks(force=True)).get(header["kid"])
        if jwk is None:
            raise OidcRejected("unknown signing key")
        try:
            claims = jwt.decode(
                bearer_token, key=jwt.PyJWK(jwk).key, algorithms=["RS256"], audience=audience,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            raise OidcRejected("token invalid")
        check_oidc_claims(claims, email=email)


def check_oidc_claims(claims: dict, *, email: str) -> None:
    """The issuer and identity checks, separate so they are unit-tested
    without a signature."""
    if claims.get("iss") not in _GOOGLE_ISSUERS:
        raise OidcRejected("wrong issuer")
    if email:
        if str(claims.get("email") or "").lower() != email.lower() or claims.get("email_verified") is not True:
            raise OidcRejected("wrong push identity")


# Module-level singletons, replaced in tests via set_play_api/set_oidc_verifier.
_play_api: PlayApi | None = None
_oidc_verifier: OidcVerifier | None = None


def get_play_api() -> PlayApi:
    global _play_api
    if _play_api is None:
        _play_api = HttpPlayApi()
    return _play_api


def set_play_api(api: PlayApi | None) -> None:
    global _play_api
    _play_api = api


def get_oidc_verifier() -> OidcVerifier:
    global _oidc_verifier
    if _oidc_verifier is None:
        _oidc_verifier = GoogleOidcVerifier()
    return _oidc_verifier


def set_oidc_verifier(verifier: OidcVerifier | None) -> None:
    global _oidc_verifier
    _oidc_verifier = verifier
