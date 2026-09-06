"""Tests for linked sign-in identities (Phase 1: Apple only).

Apple's Hide My Email relay address is a stable, per-app, *verified* email
that is nonetheless NOT the user's real email — so a Google user who later
signs in with Apple using a relay address looks like a stranger to the
plain email-allow-list check (either a brand-new second account, or on this
codebase's restricted ALLOWED_EMAILS list, a flat 403). This suite covers
the fix: an authenticated user can link their Apple identity (keyed on the
token's stable `sub` claim) to their existing account via POST
/auth/identities/apple, and apple_native() then resolves through that link
BEFORE falling back to the claim-email + allow-list check.

Same conventions as test_apple_auth.py: a local RSA keypair signs fake Apple
identity tokens, `app.routers.auth._get_apple_jwks` is monkeypatched to
serve the matching JWKS instead of hitting the network, and route
coroutines are awaited directly via `_run()` (asyncio.run) rather than going
through TestClient/HTTP.

No mongomock is available in this environment (see test_allocations.py's own
note) — `linked_identities_col` is replaced with a tiny in-memory fake
collection, `_FakeCol`, local to this file, monkeypatched onto
`app.routers.auth.linked_identities_col` for the duration of each test. Each
test that inserts docs works only against this fake, never the real Mongo
collection, so there is nothing to clean up in the real database.
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

import app.core.identity as identity_module
import app.routers.auth as auth_module
import app.services.retention as retention_module
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
        "sub": "000123.relaysub.5678",
        "email": "abc123xyz@privaterelay.appleid.com",
        "email_verified": "true",
        "is_private_email": "true",
    }
    claims.update(overrides)
    return jwt.encode(claims, _private_key, algorithm="RS256", headers={"kid": KID})


@pytest.fixture(autouse=True)
def _patch_jwks(monkeypatch):
    async def _fake_jwks():
        return _JWKS
    monkeypatch.setattr(auth_module, "_get_apple_jwks", _fake_jwks)
    auth_module._apple_jwks_cache["keys"] = None
    auth_module._apple_jwks_cache["fetched_at"] = 0.0


def _match(d: dict, q: dict) -> bool:
    return all(d.get(k) == v for k, v in (q or {}).items())


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _DeleteResult:
    def __init__(self, deleted_count):
        self.deleted_count = deleted_count


class _FakeCol:
    """Stand-in for `linked_identities_col` — find_one/find/update_one
    (upsert)/delete_many, matching the subset the router actually calls."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)

    async def delete_many(self, query=None):
        query = query or {}
        keep = [d for d in self.docs if not _match(d, query)]
        removed = len(self.docs) - len(keep)
        self.docs = keep
        return _DeleteResult(removed)


@pytest.fixture()
def fake_col(monkeypatch):
    # apple_native() now resolves through app.core.identity.resolve_signin_email
    # rather than querying linked_identities_col itself (see identity.py),
    # so both modules' own imported reference to the collection must be
    # patched to the SAME fake instance, or the two code paths would see
    # inconsistent state.
    col = _FakeCol()
    monkeypatch.setattr(auth_module, "linked_identities_col", col)
    monkeypatch.setattr(identity_module, "linked_identities_col", col)
    return col


def _user(email="kevin.maingi12@gmail.com"):
    return {"email": email, "name": "Kevin"}


def _run(coro):
    import asyncio
    return asyncio.run(coro)


# ── Linking while authenticated ─────────────────────────────────────────────

def test_link_stores_doc_with_caller_email_and_relay_true(fake_col):
    token = _make_token()
    result = _run(auth_module.link_apple_identity({"identityToken": token}, _user()))
    assert result["ok"] is True
    assert result["relay"] is True
    assert result["provider"] == "apple"

    assert len(fake_col.docs) == 1
    doc = fake_col.docs[0]
    assert doc["_id"] == "apple:000123.relaysub.5678"
    assert doc["provider"] == "apple"
    assert doc["subject"] == "000123.relaysub.5678"
    assert doc["user_id"] == "kevin.maingi12@gmail.com"
    assert doc["relay"] is True
    assert doc["email_at_link"] == "abc123xyz@privaterelay.appleid.com"
    assert doc.get("linked_at") is not None


def test_link_non_relay_email_stores_relay_false(fake_col):
    token = _make_token(email="kevin.maingi12@gmail.com", is_private_email="false")
    result = _run(auth_module.link_apple_identity({"identityToken": token}, _user()))
    assert result["relay"] is False
    assert fake_col.docs[0]["relay"] is False


# ── D3: claiming an auto relay link cleans up the empty placeholder ────────
#
# These exercise the real erase_orphaned_relay_account/erase_user via
# app.services.retention, so `fake_col` (already patched onto auth_module and
# identity_module) is also patched onto retention_module's own bound
# `linked_identities_col` — the same in-memory doc list all three modules
# read/write during the call. erase_user's own dir()-based sweep is stubbed
# out with a call-recording fake rather than letting it walk the ~70 real
# `*_col` attributes on app.db.collections, and account_has_data is stubbed
# per test to control the "has data" guard without wiring up every provider
# collection here (that guard has its own dedicated tests in
# test_retention.py).

RELAY_EMAIL = "abc123xyz@privaterelay.appleid.com"
RELAY_SUB = "000123.relaysub.5678"


def _seed_auto_relay_link(fake_col, *, relay_email=RELAY_EMAIL, sub=RELAY_SUB):
    fake_col.docs.append({
        "_id": f"apple:{sub}", "provider": "apple", "subject": sub,
        "user_id": relay_email, "auto": True, "relay": True,
        "email_at_link": relay_email,
    })
    fake_col.docs.append({
        "_id": f"email:{relay_email}", "provider": "email",
        "subject": relay_email, "user_id": relay_email,
    })


def test_explicit_link_erases_empty_relay_placeholder(fake_col, monkeypatch):
    _seed_auto_relay_link(fake_col)
    monkeypatch.setattr(retention_module, "linked_identities_col", fake_col)

    erase_calls: list = []

    async def fake_erase_user(uid):
        erase_calls.append(uid)
        return {"user_profiles": 1}

    async def fake_has_data(uid):
        return False

    monkeypatch.setattr(retention_module, "erase_user", fake_erase_user)
    monkeypatch.setattr(retention_module, "account_has_data", fake_has_data)

    token = _make_token()  # same sub as the seeded auto link, relay email claim
    result = _run(auth_module.link_apple_identity({"identityToken": token}, _user("kevin.maingi12@gmail.com")))

    assert result["orphan_removed"] is True
    assert erase_calls == [RELAY_EMAIL]
    assert not any(d["_id"] == f"email:{RELAY_EMAIL}" for d in fake_col.docs)
    apple_doc = next(d for d in fake_col.docs if d["_id"] == f"apple:{RELAY_SUB}")
    assert apple_doc["user_id"] == "kevin.maingi12@gmail.com"
    assert apple_doc["auto"] is False


def test_explicit_link_does_not_erase_relay_account_with_data(fake_col, monkeypatch):
    _seed_auto_relay_link(fake_col)
    monkeypatch.setattr(retention_module, "linked_identities_col", fake_col)

    erase_calls: list = []

    async def fake_erase_user(uid):
        erase_calls.append(uid)
        return {"user_profiles": 1}

    async def fake_has_data(uid):
        return True  # e.g. a live TrueLayer connection under the relay account

    monkeypatch.setattr(retention_module, "erase_user", fake_erase_user)
    monkeypatch.setattr(retention_module, "account_has_data", fake_has_data)

    token = _make_token()
    result = _run(auth_module.link_apple_identity({"identityToken": token}, _user("kevin.maingi12@gmail.com")))

    assert result["orphan_removed"] is False
    assert erase_calls == []
    # The relay account's alias doc is untouched — it still owns real data.
    assert any(d["_id"] == f"email:{RELAY_EMAIL}" for d in fake_col.docs)
    apple_doc = next(d for d in fake_col.docs if d["_id"] == f"apple:{RELAY_SUB}")
    assert apple_doc["user_id"] == "kevin.maingi12@gmail.com"


def test_explicit_link_reclaiming_non_relay_auto_link_never_erases(fake_col, monkeypatch):
    # An auto Apple link to a non-relay email (e.g. a real Apple ID email
    # that happened to auto-resolve to its own account first) re-pointed by
    # an explicit link from a different account — the account behind it is
    # an ordinary account, not a Hide My Email placeholder, so cleanup must
    # never even attempt to touch it.
    other_email = "someone@icloud.com"
    sub = "000999.othersub.0000"
    fake_col.docs.append({
        "_id": f"apple:{sub}", "provider": "apple", "subject": sub,
        "user_id": other_email, "auto": True, "relay": False,
        "email_at_link": other_email,
    })
    monkeypatch.setattr(retention_module, "linked_identities_col", fake_col)

    erase_calls: list = []

    async def fake_erase_user(uid):
        erase_calls.append(uid)
        return {}

    monkeypatch.setattr(retention_module, "erase_user", fake_erase_user)

    token = _make_token(sub=sub, email=other_email, is_private_email="false")
    result = _run(auth_module.link_apple_identity({"identityToken": token}, _user("kevin.maingi12@gmail.com")))

    assert result["orphan_removed"] is False
    assert erase_calls == []
    apple_doc = next(d for d in fake_col.docs if d["_id"] == f"apple:{sub}")
    assert apple_doc["user_id"] == "kevin.maingi12@gmail.com"


# ── apple_native resolves through the link first ────────────────────────────

def test_relay_email_not_on_allow_list_succeeds_when_linked(fake_col, monkeypatch):
    # Simulate the allow list only containing the real Google account, not
    # any relay address — resolve_allowed_email must never match the relay
    # email claim itself.
    real_email = "kevin.maingi12@gmail.com"
    link_token = _make_token()
    _run(auth_module.link_apple_identity({"identityToken": link_token}, _user(real_email)))

    signin_token = _make_token()  # same sub, same relay email claim
    result = _run(auth_module.apple_native({"identityToken": signin_token}))
    assert result["ok"] is True

    from app.core.config import serializer, SESSION_MAX_AGE
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["email"] == real_email


def test_relay_email_without_link_403s(fake_col):
    token = _make_token()  # relay email, never linked, not on allow list
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 403


def test_linking_sub_already_linked_to_different_account_is_409(fake_col):
    token_a = _make_token()
    _run(auth_module.link_apple_identity({"identityToken": token_a}, _user("kevin.maingi12@gmail.com")))

    token_b = _make_token()  # same sub
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.link_apple_identity({"identityToken": token_b}, _user("someone-else@example.com")))
    assert exc.value.status_code == 409
    # Original link is untouched.
    assert len(fake_col.docs) == 1
    assert fake_col.docs[0]["user_id"] == "kevin.maingi12@gmail.com"


def test_relinking_same_account_is_a_no_op_refresh(fake_col):
    token = _make_token()
    _run(auth_module.link_apple_identity({"identityToken": token}, _user()))
    _run(auth_module.link_apple_identity({"identityToken": token}, _user()))
    assert len(fake_col.docs) == 1


# ── DELETE removes the link and sign-in then 403s again ─────────────────────

def test_delete_removes_link_and_signin_403s_again(fake_col):
    token = _make_token()
    _run(auth_module.link_apple_identity({"identityToken": token}, _user()))

    result = _run(auth_module.unlink_apple_identity(_user()))
    assert result["ok"] is True
    assert result["removed"] == 1
    assert fake_col.docs == []

    signin_token = _make_token()
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": signin_token}))
    assert exc.value.status_code == 403


def test_delete_only_removes_callers_own_links(fake_col):
    token_a = _make_token()
    _run(auth_module.link_apple_identity({"identityToken": token_a}, _user("kevin.maingi12@gmail.com")))

    other_sub_token = _make_token(sub="000999.othersub.0000", email="other-relay@privaterelay.appleid.com")
    _run(auth_module.link_apple_identity({"identityToken": other_sub_token}, _user("someone-else@example.com")))

    result = _run(auth_module.unlink_apple_identity(_user("kevin.maingi12@gmail.com")))
    assert result["removed"] == 1
    assert len(fake_col.docs) == 1
    assert fake_col.docs[0]["user_id"] == "someone-else@example.com"


# ── GET lists the link, masked, never the full relay address ───────────────

def test_list_identities_masked_never_full_relay_email(fake_col):
    token = _make_token()
    _run(auth_module.link_apple_identity({"identityToken": token}, _user()))

    result = _run(auth_module.list_linked_identities(_user()))
    assert result["primary_email"] == "kevin.maingi12@gmail.com"
    assert len(result["linked"]) == 1
    entry = result["linked"][0]
    assert entry["provider"] == "apple"
    assert entry["relay"] is True
    assert entry["email_masked"] == "ab***@privaterelay.appleid.com"
    assert "abc123xyz@privaterelay.appleid.com" not in str(result)
    assert entry["linked_at"] is not None


def test_list_identities_empty_when_none_linked(fake_col):
    result = _run(auth_module.list_linked_identities(_user()))
    assert result["primary_email"] == "kevin.maingi12@gmail.com"
    assert result["linked"] == []


def test_link_missing_sub_rejected(fake_col):
    now = int(time.time())
    claims = {
        "iss": ISSUER, "aud": APPLE_BUNDLE_ID, "exp": now + 3600, "iat": now,
        "email": "abc123xyz@privaterelay.appleid.com", "email_verified": "true",
    }
    token = jwt.encode(claims, _private_key, algorithm="RS256", headers={"kid": KID})
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.link_apple_identity({"identityToken": token}, _user()))
    assert exc.value.status_code == 401
