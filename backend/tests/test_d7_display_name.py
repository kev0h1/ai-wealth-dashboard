"""D7: Home greeted a new user by their email prefix ("Good evening,
jjdk4...") even after they had entered their real name in onboarding.

Two backend-side pieces closed that gap, and this file pins both:

  1. The greeting's actual fix has no session-token involvement at all:
     Home reads profile.full_name via its own GET /profile call on mount,
     and it only ever mounts after onboarding completes (AuthProvider
     renders Onboarding in its place until then), so there's no "just
     saved the name this render" race to close. An earlier draft of this
     work added POST /auth/session/refresh to also re-issue the session
     token with the saved name — an independent reviewer caught that this
     re-signs with `serializer.dumps` at call time, which resets the
     7-day SESSION_MAX_AGE expiry from *now* on every call and needs only
     a valid bearer to invoke, so a stolen token could be kept alive
     indefinitely just by hitting it. That endpoint, its api.ts client,
     and the Onboarding.tsx call were all removed rather than fixed:
     nothing needed it, and a name refresh must never double as a
     session-lifetime refresh. test_profile_full_name_is_read_back_after_save
     below pins the actual (existing) path instead.
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
    update_one the same shape profile.update_profile()/get_profile()
    actually use."""

    def __init__(self, docs=None):
        self.docs: dict = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, filt, proj=None):
        return dict(self.docs[filt["_id"]]) if filt.get("_id") in self.docs else None

    async def update_one(self, filt, update, upsert=False):
        doc_id = filt["_id"]
        created = doc_id not in self.docs
        doc = self.docs.setdefault(doc_id, {"_id": doc_id})
        if created:
            doc.update(update.get("$setOnInsert", {}))
        doc.update(update.get("$set", {}))
        return None


# ── 1. the greeting's real fix: profile.full_name is what Home reads ────


def test_profile_full_name_is_read_back_after_save(monkeypatch):
    # This is the exact round trip HomePage.tsx relies on: Onboarding calls
    # PUT /profile with the name the user typed, and Home's own mount-time
    # GET /profile (api.getProfile()) picks it straight back up — no
    # session token involved on either side. Before any save, full_name is
    # empty (never the email or anything derived from it).
    email = "kevin.maingi12@gmail.com"
    profiles = FakeProfilesCol()
    monkeypatch.setattr(profile_module, "user_profiles_col", profiles)

    before = _run(profile_module.get_profile({"email": email}))
    assert before["full_name"] == ""

    _run(profile_module.update_profile({"full_name": "Kevin Maingi"}, {"email": email}))

    after = _run(profile_module.get_profile({"email": email}))
    assert after["full_name"] == "Kevin Maingi"


def test_session_refresh_endpoint_was_removed():
    # D7 correction: POST /auth/session/refresh re-signed the session
    # token with `serializer.dumps` at call time on nothing but a valid
    # bearer, which reset SESSION_MAX_AGE's 7-day expiry from *now* on
    # every call — a stolen token could be kept alive forever just by
    # hitting it. Removed outright (see module docstring) rather than
    # fixed, since the greeting never needed it. Pinned here so it can't
    # quietly come back the same way.
    assert not hasattr(auth_module, "refresh_session")


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


def test_profile_always_returns_onboarding_complete_boolean(monkeypatch):
    # D12: the frontend gate treats only an explicit `false` as "needs
    # onboarding", so the endpoint must always send a real boolean, for a
    # missing profile, a profile without the field, and a completed one.
    email = "someone@example.com"
    for docs, expected in (
        ([], False),
        ([{"_id": email, "full_name": "A B", "onboarding_complete": False}], False),
        ([{"_id": email, "full_name": "A B", "onboarding_complete": True}], True),
    ):
        monkeypatch.setattr(profile_module, "user_profiles_col", FakeProfilesCol(docs))
        out = _run(profile_module.get_profile({"email": email}))
        assert out["onboarding_complete"] is expected
        assert isinstance(out["onboarding_complete"], bool)


def test_legacy_profile_without_the_field_is_complete(monkeypatch):
    # D12: a document that predates onboarding_complete belongs to a user who
    # onboarded long ago; a missing field must never send them back through it.
    email = "legacy@example.com"
    monkeypatch.setattr(profile_module, "user_profiles_col",
                        FakeProfilesCol([{"_id": email, "full_name": "Old User"}]))
    assert _run(profile_module.get_profile({"email": email}))["onboarding_complete"] is True


def test_fresh_profile_is_incomplete_and_create_path_sets_the_field(monkeypatch):
    email = "fresh@example.com"
    profiles = FakeProfilesCol()
    monkeypatch.setattr(profile_module, "user_profiles_col", profiles)
    # Mid-flow save (complete=false) creates the document with an explicit False.
    out = _run(profile_module.update_profile({"full_name": "New Person", "complete": False}, {"email": email}))
    assert profiles.docs[email]["onboarding_complete"] is False
    assert out["onboarding_complete"] is False
    assert _run(profile_module.get_profile({"email": email}))["onboarding_complete"] is False
    # Finishing flips it; a later mid-flow style save does not reset it.
    _run(profile_module.update_profile({"full_name": "New Person"}, {"email": email}))
    assert _run(profile_module.get_profile({"email": email}))["onboarding_complete"] is True
    _run(profile_module.update_profile({"full_name": "New Person", "complete": False}, {"email": email}))
    assert profiles.docs[email]["onboarding_complete"] is True


def test_stamp_only_document_is_incomplete_and_named_legacy_is_complete(monkeypatch):
    # D12: stamp_activity creates `{_id, last_active_at}` before GET /profile.
    email = "x@example.com"
    monkeypatch.setattr(profile_module, "user_profiles_col", FakeProfilesCol([
        {"_id": email, "last_active_at": 1},
        {"_id": "kevin@example.com", "full_name": "Kevin"},
    ]))
    assert _run(profile_module.get_profile({"email": email}))["onboarding_complete"] is False
    assert _run(profile_module.get_profile({"email": "kevin@example.com"}))["onboarding_complete"] is True


def test_new_user_first_request_stamp_then_profile_needs_onboarding(monkeypatch):
    import app.services.retention as retention_module
    profiles = FakeProfilesCol()
    monkeypatch.setattr(profile_module, "user_profiles_col", profiles)
    monkeypatch.setattr(retention_module, "user_profiles_col", profiles)
    monkeypatch.setattr(retention_module, "_last_stamped", {})
    email = "brandnew@example.com"
    _run(retention_module.stamp_activity(email))
    assert profiles.docs[email]["onboarding_complete"] is False
    assert "last_active_at" in profiles.docs[email]
    assert _run(profile_module.get_profile({"email": email}))["onboarding_complete"] is False
