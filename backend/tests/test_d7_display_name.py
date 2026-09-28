"""D7: Home greeted a new user by their email prefix ("Good evening,
jjdk4...") even after they had entered their real name in onboarding.

Two backend-side pieces closed that gap, and this file pins both:

  1. POST /auth/session/refresh (auth.refresh_session) re-issues the
     session token with the caller's current profile.full_name baked in,
     so a long-lived session's own `name` field catches up with a profile
     save without waiting for the next login. Home's greeting itself reads
     profile.full_name directly and does not depend on this endpoint, but
     other readers of the session name (Settings' fallback, Onboarding's
     `defaultName` prefill) do.
  2. POST /auth/apple/native (auth.apple_native) used to fall back to the
     email's local part (`email.split("@")[0]`) whenever Apple's token
     carried no name claim, which is the exact shape of the reported bug
     for a repeat Apple sign-in, worse still for a Hide My Email relay
     address (a local part like "jjdk4" is even less name-shaped). It must
     leave the session name empty in that case instead, the same as the
     Google sign-in routes already do — never manufacture a name from the
     email server-side.

No TestClient/HTTP layer, following the convention already established in
test_apple_auth.py / test_session_revocation.py: route coroutines are
awaited directly via asyncio.run() with plain dicts, and collections are
swapped for small in-memory fakes rather than touching real Mongo.
"""
import asyncio
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

import app.core.identity as identity_module
import app.routers.auth as auth_module
import app.routers.profile as profile_module
from app.core.config import serializer, SESSION_MAX_AGE


def _run(coro):
    return asyncio.run(coro)


class FakeProfilesCol:
    """Stand-in for user_profiles_col: `_id`-keyed, supports find_one/
    update_one the same shape profile.update_profile() and
    auth.refresh_session() actually use."""

    def __init__(self, docs=None):
        self.docs: dict = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, filt, proj=None):
        return dict(self.docs[filt["_id"]]) if filt.get("_id") in self.docs else None

    async def update_one(self, filt, update, upsert=False):
        doc_id = filt["_id"]
        doc = self.docs.setdefault(doc_id, {"_id": doc_id})
        doc.update(update.get("$set", {}))
        return None


# ── 1. profile update changes what the session returns ──────────────────


def test_refresh_session_picks_up_a_saved_profile_name(monkeypatch):
    email = "kevin.maingi12@gmail.com"
    profiles = FakeProfilesCol()
    monkeypatch.setattr(auth_module, "user_profiles_col", profiles)
    monkeypatch.setattr(profile_module, "user_profiles_col", profiles)

    # Before any profile save, the session name refresh has nothing to
    # offer — an empty name, not an error, and never anything derived from
    # the email.
    before = _run(auth_module.refresh_session({"email": email}))
    data = serializer.loads(before["session_token"], max_age=SESSION_MAX_AGE)
    assert data["name"] == ""
    assert data["email"] == email

    # Onboarding calls PUT /profile with the real name the user typed in.
    _run(profile_module.update_profile({"full_name": "Kevin Maingi"}, {"email": email}))

    # The very next session refresh call (no re-login) must reflect it.
    after = _run(auth_module.refresh_session({"email": email}))
    data = serializer.loads(after["session_token"], max_age=SESSION_MAX_AGE)
    assert data["name"] == "Kevin Maingi"
    assert data["email"] == email


def test_refresh_session_requires_authentication():
    with pytest.raises(Exception) as exc:
        _run(auth_module.refresh_session({}))
    assert getattr(exc.value, "status_code", None) == 401


# ── 2. Apple relay claim / empty provider name never becomes a greeting ──
# apple_native() verifies the identityToken itself (JWKS signature check),
# which test_apple_auth.py already covers end to end with a real signed
# token. The name-fallback behaviour under test here doesn't depend on
# that verification step at all, so it's stubbed out directly rather than
# re-deriving an RSA keypair + JWKS fixture just to reach the same line.


class _NoLinkCol:
    async def find_one(self, query=None, projection=None):
        return None

    async def update_one(self, filt, update, upsert=False):
        return None


@pytest.fixture(autouse=True)
def _patch_apple_verification(monkeypatch):
    # apple_native() resolves through app.core.identity.resolve_signin_email,
    # which holds its OWN imported reference to linked_identities_col
    # distinct from auth_module's — both must be patched, or the real
    # Motor collection gets hit from inside identity.py and trips the
    # "Event loop is closed" issue this suite's neighbours (e.g.
    # test_apple_auth.py) already document: asyncio.run() per test tears
    # down the loop each call the driver got bound to.
    fake = _NoLinkCol()
    monkeypatch.setattr(auth_module, "linked_identities_col", fake)
    monkeypatch.setattr(identity_module, "linked_identities_col", fake)


def _stub_verified_claims(monkeypatch, claims: dict):
    async def _fake_verify(token):
        return claims
    monkeypatch.setattr(auth_module, "_verify_apple_identity_token", _fake_verify)


def test_apple_relay_claim_with_no_name_leaves_session_name_empty(monkeypatch):
    # The exact reported shape: a Hide My Email relay address, and Apple
    # hands over no name claim (not the user's first-ever authorization, or
    # the client simply didn't pass `fullName`). This must not fall back to
    # "jjdk4" (the relay address's local part) — that string becoming the
    # greeting is the whole bug.
    #
    # The allow-list gate (ALLOWED_EMAILS / OPEN_SIGNUP) is a separate
    # concern from the name fallback under test here, and a relay address
    # is not on the test environment's default allow list — so
    # resolve_signin_email is stubbed to admit it, the same separation of
    # concerns test_open_signup.py uses for its own allow-list-adjacent
    # cases.
    email = "jjdk4@privaterelay.appleid.com"
    _stub_verified_claims(monkeypatch, {
        "sub": "000123.relay.9999",
        "email": email,
        "email_verified": "true",
        "is_private_email": "true",
    })

    async def _fake_resolve(provider, verified_email, *, subject=None, relay=False):
        return verified_email
    monkeypatch.setattr(auth_module, "resolve_signin_email", _fake_resolve)

    result = _run(auth_module.apple_native({"identityToken": "irrelevant-stub-token"}))
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["name"] == ""
    assert "jjdk4" not in data["name"]
    assert email.split("@")[0] not in data["name"]


def test_apple_non_relay_claim_with_no_name_leaves_session_name_empty(monkeypatch):
    # Not a relay address at all — a plain repeat Apple sign-in with no
    # `fullName` from the client still must not fall back to the ordinary
    # email's local part either.
    email = "kevin.maingi12@gmail.com"
    _stub_verified_claims(monkeypatch, {
        "sub": "000123.abcdef.1234",
        "email": email,
        "email_verified": "true",
        "is_private_email": "false",
    })
    result = _run(auth_module.apple_native({"identityToken": "irrelevant-stub-token"}))
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["name"] == ""


def test_apple_claim_with_client_supplied_fullname_is_unaffected(monkeypatch):
    # Regression guard: the D7 fix only removes the email-local-part
    # fallback — Apple's genuine first-authorization `fullName` (passed
    # through by the client) must still be used as-is.
    email = "kevin.maingi12@gmail.com"
    _stub_verified_claims(monkeypatch, {
        "sub": "000123.abcdef.1234",
        "email": email,
        "email_verified": "true",
        "is_private_email": "false",
    })
    result = _run(auth_module.apple_native({
        "identityToken": "irrelevant-stub-token",
        "fullName": "Kevin Maingi",
    }))
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["name"] == "Kevin Maingi"
