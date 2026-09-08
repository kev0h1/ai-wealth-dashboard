"""Tests for D5: the in-app sign-up allow list.

Two collaborating pieces:
  - app.core.allowlist.resolve_allowed_signup() — the read side every
    sign-in goes through (via app.core.identity.resolve_signin_email),
    consulting ALLOWED_EMAILS first and then the `allowed_signups`
    collection.
  - app.routers.admin_allowlist — the bot-or-owner-only GET/POST/DELETE
    endpoints the /ops/go-live page's Allowlist section uses to manage
    that collection.

No mongomock in this environment (see tests/test_linked_identities.py's own
note) — `allowed_signups_col` is replaced everywhere it's imported
(app.core.allowlist, app.routers.admin_allowlist) with a small in-memory
fake, `_FakeAllowlistCol`, local to this file. Router handlers are called
directly (asyncio.run), same convention as tests/test_admin_llm_usage.py /
tests/test_ops.py — no TestClient, no real Mongo.
"""
import asyncio
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

import app.core.allowlist as allowlist_module
import app.core.config as config
import app.core.identity as identity_module
import app.routers.admin_allowlist as admin_allowlist
import app.routers.auth as auth_module
from app.core.config import APPLE_BUNDLE_ID


def _run(coro):
    return asyncio.run(coro)


# ── fakes ────────────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        self._docs.sort(key=lambda d: d.get(key), reverse=direction < 0)
        return self

    async def to_list(self, n):
        return list(self._docs)


class _FakeLinkedIdentitiesCol:
    """Stand-in for `linked_identities_col` — find_one/update_one (upsert),
    matching the subset resolve_signin_email() actually calls. Copied
    rather than imported from tests/test_open_signup.py's `_FakeCol`: this
    repo runs pytest without `tests/__init__.py`, so cross-test-module
    imports (`from tests.test_open_signup import ...`) resolve fine when
    that file runs alone but fail once the whole suite is collected and
    `tests` isn't an importable package — see that file's own docstring
    for why every suite in here copies these fakes locally instead."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


class _FakeAllowlistCol:
    """Stands in for `allowed_signups_col`: enough of the Motor surface for
    resolve_allowed_signup's find_one and admin_allowlist's
    find/sort/to_list + update_one(upsert)."""

    def __init__(self, docs=None):
        self.docs: list[dict] = list(docs or [])

    def find(self, query=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if all(d.get(k) == v for k, v in query.items())])

    async def find_one(self, query=None, max_time_ms=None):
        query = query or {}
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$setOnInsert") or {})
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


@pytest.fixture()
def fake_allowlist(monkeypatch):
    col = _FakeAllowlistCol()
    monkeypatch.setattr(allowlist_module, "allowed_signups_col", col)
    monkeypatch.setattr(admin_allowlist, "allowed_signups_col", col)
    return col


@pytest.fixture()
def fake_linked_identities(monkeypatch):
    """resolve_signin_email also touches linked_identities_col for the
    email-alias step; a fresh empty fake keeps every test in this file
    independent of that machinery (mirrors tests/test_open_signup.py's
    `fake_col` fixture)."""
    col = _FakeLinkedIdentitiesCol()
    monkeypatch.setattr(auth_module, "linked_identities_col", col)
    monkeypatch.setattr(identity_module, "linked_identities_col", col)
    return col


def _set_allow_list(monkeypatch, emails: list[str]) -> None:
    lowered = [e.strip().lower() for e in emails]
    by_key: dict[str, str] = {}
    for e in lowered:
        k = config._gmail_key(e)
        if k not in by_key:
            by_key[k] = e
    monkeypatch.setattr(config, "ALLOWED_EMAILS", set(lowered))
    monkeypatch.setattr(config, "_ALLOWED_BY_KEY", by_key)
    monkeypatch.setattr(admin_allowlist, "ALLOWED_EMAILS", set(lowered))
    # admin_allowlist imports PRIMARY_EMAIL by value at module load (same
    # idiom test_ops.py's own fixtures document) — pin it to the first
    # (owner) entry so _owner()/_require_admin agree regardless of the
    # real deployed env var.
    monkeypatch.setattr(admin_allowlist, "PRIMARY_EMAIL", lowered[0])


def _closed(monkeypatch) -> None:
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: False)


def _bot() -> dict:
    return {"email": "bot@internal", "name": "Bot"}


def _owner() -> dict:
    return {"email": "kevin.maingi12@gmail.com", "name": "Kevin"}


def _stranger() -> dict:
    return {"email": "stranger@example.com", "name": "Stranger"}


# ── resolve_allowed_signup / resolve_signin_email ──────────────────────────

def test_collection_hit_allows_signin(fake_allowlist, fake_linked_identities, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    fake_allowlist.docs.append({
        "key": "friend@example.com", "email": "friend@example.com",
        "status": "invited", "invited_by": "kevin.maingi12@gmail.com",
    })
    result = _run(identity_module.resolve_signin_email("google-native", "friend@example.com"))
    assert result == "friend@example.com"


def test_revoked_entry_refuses_signin(fake_allowlist, fake_linked_identities, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    fake_allowlist.docs.append({
        "key": "exfriend@example.com", "email": "exfriend@example.com",
        "status": "revoked",
    })
    result = _run(identity_module.resolve_signin_email("google-native", "exfriend@example.com"))
    assert result is None


def test_env_var_entry_still_works_without_collection_hit(fake_allowlist, fake_linked_identities, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    # Collection is empty — the env-var seed list alone must still resolve.
    result = _run(identity_module.resolve_signin_email("google-native", "kevin.maingi12@gmail.com"))
    assert result == "kevin.maingi12@gmail.com"
    assert fake_allowlist.docs == []


def test_gmail_dot_variant_matches_invited_key(fake_allowlist, fake_linked_identities, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    fake_allowlist.docs.append({
        # Stored key is the Gmail dot-INSENSITIVE canonical form (what the
        # admin endpoint computes at invite time via _gmail_key), same as
        # the doc's own docstring in app/db/collections.py describes.
        "key": "friendname@gmail.com", "email": "friend.name@gmail.com",
        "status": "invited",
    })
    result = _run(identity_module.resolve_signin_email("google-native", "friendname@gmail.com"))
    assert result == "friend.name@gmail.com"


def test_mongo_failure_fails_closed(monkeypatch):
    """A Mongo hiccup on the collection lookup must refuse, not crash or
    silently allow — same fail-closed doctrine as response_cache.py."""
    class _BoomCol:
        async def find_one(self, *a, **k):
            raise RuntimeError("Mongo unreachable")

    monkeypatch.setattr(allowlist_module, "allowed_signups_col", _BoomCol())
    monkeypatch.setattr(config, "ALLOWED_EMAILS", {"kevin.maingi12@gmail.com"})
    monkeypatch.setattr(config, "_ALLOWED_BY_KEY", {"kevinmaingi12@gmail.com": "kevin.maingi12@gmail.com"})
    result = _run(allowlist_module.resolve_allowed_signup("someone@example.com"))
    assert result is None


# ── admin GET/POST/DELETE gate ──────────────────────────────────────────────

def test_non_admin_gets_403(fake_allowlist, monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    with pytest.raises(HTTPException) as exc:
        _run(admin_allowlist.list_allowlist(_stranger()))
    assert exc.value.status_code == 403


def test_bot_can_list_and_owner_can_list(fake_allowlist, monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    res_bot = _run(admin_allowlist.list_allowlist(_bot()))
    res_owner = _run(admin_allowlist.list_allowlist(_owner()))
    assert res_bot["invited"] == []
    assert res_owner["env_seeded"] == ["kevin.maingi12@gmail.com"]


def test_add_then_list_then_revoke(fake_allowlist, monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    added = _run(admin_allowlist.add_allowlist(
        admin_allowlist.InviteRequest(email="Friend@Example.com", note="from the waitlist"), _owner()
    ))
    assert len(added["invited"]) == 1
    entry = added["invited"][0]
    assert entry["email"] == "friend@example.com"
    assert entry["status"] == "invited"
    assert entry["invited_by"] == "kevin.maingi12@gmail.com"
    assert entry["note"] == "from the waitlist"

    revoked = _run(admin_allowlist.revoke_allowlist(entry["key"], _owner()))
    assert revoked["invited"] == []
    # Doc still exists (never deleted), just flipped to revoked.
    stored = _run(fake_allowlist.find_one({"key": entry["key"]}))
    assert stored["status"] == "revoked"


def test_reinvite_revoked_address_is_idempotent(fake_allowlist, monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    fake_allowlist.docs.append({
        "key": "friend@example.com", "email": "friend@example.com",
        "status": "revoked", "created_at": "2026-01-01T00:00:00Z",
    })
    result = _run(admin_allowlist.add_allowlist(
        admin_allowlist.InviteRequest(email="friend@example.com"), _owner()
    ))
    assert len(result["invited"]) == 1
    assert result["invited"][0]["status"] == "invited"
    # created_at preserved from the original invite, not overwritten.
    assert result["invited"][0]["created_at"] == "2026-01-01T00:00:00Z"
    assert len(fake_allowlist.docs) == 1


def test_owner_cannot_be_revoked(fake_allowlist, monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    with pytest.raises(HTTPException) as exc:
        _run(admin_allowlist.revoke_allowlist("kevinmaingi12@gmail.com", _owner()))
    assert exc.value.status_code == 400


def test_env_address_cannot_be_revoked(fake_allowlist, monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com", "second@example.com"])
    with pytest.raises(HTTPException) as exc:
        _run(admin_allowlist.revoke_allowlist("second@example.com", _owner()))
    assert exc.value.status_code == 400


def test_invalid_email_rejected():
    with pytest.raises(Exception):
        admin_allowlist.InviteRequest(email="not-an-email")


# ── INVITE_ONLY refusal code ─────────────────────────────────────────────

KID = "test-key-signup-allowlist"
ISSUER = "https://appleid.apple.com"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_jwk = RSAAlgorithm.to_jwk(_private_key.public_key(), as_dict=True)
_public_jwk["kid"] = KID
_public_jwk["use"] = "sig"
_public_jwk["alg"] = "RS256"
_JWKS = {"keys": [_public_jwk]}


def _make_apple_token(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": APPLE_BUNDLE_ID,
        "exp": now + 3600,
        "iat": now,
        "sub": "000789.signupallowlist.0001",
        "email": "unlisted@example.com",
        "email_verified": "true",
        "is_private_email": "false",
    }
    claims.update(overrides)
    return jwt.encode(claims, _private_key, algorithm="RS256", headers={"kid": KID})


@pytest.fixture()
def _patch_apple_jwks(monkeypatch):
    async def _fake_jwks():
        return _JWKS
    monkeypatch.setattr(auth_module, "_get_apple_jwks", _fake_jwks)
    auth_module._apple_jwks_cache["keys"] = None
    auth_module._apple_jwks_cache["fetched_at"] = 0.0


def test_apple_native_refusal_carries_invite_only_code(
    fake_allowlist, fake_linked_identities, _patch_apple_jwks, monkeypatch
):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    token = _make_apple_token()
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 403
    assert exc.value.detail == {"code": "INVITE_ONLY"}


def test_apple_native_invited_via_collection_succeeds(
    fake_allowlist, fake_linked_identities, _patch_apple_jwks, monkeypatch
):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    fake_allowlist.docs.append({
        "key": "unlisted@example.com", "email": "unlisted@example.com", "status": "invited",
    })
    token = _make_apple_token()
    result = _run(auth_module.apple_native({"identityToken": token}))
    assert result["ok"] is True
