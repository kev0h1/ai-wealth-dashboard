"""Tests for POST /auth/apple/native in app.routers.auth (apple_native()).

Apple's native Sign in with Apple flow hands the client a self-contained
RS256 JWT (no tokeninfo-style verification endpoint like Google's), so the
route verifies it itself against Apple's JWKS: signature, `iss`, `aud`
(APPLE_BUNDLE_ID / APPLE_SERVICES_ID), and `exp`, then applies the same
ALLOWED_EMAILS gate as google_native().

No TestClient/HTTP layer here — following the convention already
established in test_finexer_webhook.py, the route coroutine is awaited
directly via asyncio.run() with a plain dict body.

A local RSA keypair is generated once per test module, a JWKS is built from
its public key, and `app.routers.auth._get_apple_jwks` is monkeypatched to
return that JWKS instead of hitting the network — matching the module's own
`_get_apple_jwks` being a standalone, monkeypatch-friendly function
specifically so tests don't need to fake the HTTP layer.
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

import app.routers.auth as auth_module
from app.core.config import APPLE_BUNDLE_ID

KID = "test-key-1"
ISSUER = "https://appleid.apple.com"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_jwk = RSAAlgorithm.to_jwk(_private_key.public_key(), as_dict=True)
_public_jwk["kid"] = KID
_public_jwk["use"] = "sig"
_public_jwk["alg"] = "RS256"
_JWKS = {"keys": [_public_jwk]}


def _make_token(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": APPLE_BUNDLE_ID,
        "exp": now + 3600,
        "iat": now,
        "sub": "000123.abcdef.1234",
        "email": "kevin.maingi12@gmail.com",
        "email_verified": "true",
    }
    claims.update(overrides)
    return jwt.encode(claims, _private_key, algorithm="RS256", headers={"kid": KID})


@pytest.fixture(autouse=True)
def _patch_jwks(monkeypatch):
    async def _fake_jwks():
        return _JWKS
    monkeypatch.setattr(auth_module, "_get_apple_jwks", _fake_jwks)
    # Also reset the in-process cache so runs don't leak into each other.
    auth_module._apple_jwks_cache["keys"] = None
    auth_module._apple_jwks_cache["fetched_at"] = 0.0


def test_valid_token_issues_session():
    token = _make_token()
    result = _run(auth_module.apple_native({"identityToken": token, "fullName": "Kevin M"}))
    assert result["ok"] is True
    assert "session_token" in result

    from itsdangerous import URLSafeTimedSerializer
    from app.core.config import serializer, SESSION_MAX_AGE
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["email"] == "kevin.maingi12@gmail.com"
    assert data["name"] == "Kevin M"


def test_valid_token_without_fullname_falls_back_to_email_localpart():
    token = _make_token()
    result = _run(auth_module.apple_native({"identityToken": token}))
    from app.core.config import serializer, SESSION_MAX_AGE
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["name"] == "kevin.maingi12"


def test_wrong_audience_rejected():
    token = _make_token(aud="com.someone.else")
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code in (401, 403)


def test_expired_token_rejected():
    now = int(time.time())
    token = _make_token(exp=now - 60, iat=now - 3600)
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 401


def test_unverified_email_rejected():
    token = _make_token(email_verified="false")
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 401


def test_email_not_allowed_rejected():
    token = _make_token(email="someone-else@example.com")
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 403


def test_missing_identity_token_rejected():
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({}))
    assert exc.value.status_code in (400, 422)


def test_garbage_token_rejected():
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": "garbage"}))
    assert exc.value.status_code == 401


def _run(coro):
    import asyncio
    return asyncio.run(coro)
