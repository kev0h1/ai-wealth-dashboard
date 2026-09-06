"""Tests for OPEN_SIGNUP (Phase 2 of the allow-list work): app.core.identity's
single sign-in resolution path, resolve_signin_email(), plus the couple of
route-level behaviours that specifically need a live route (the explicit-link
re-point/409 rule in link_apple_identity, and the `auto` field on GET
/auth/identities).

Monkeypatching `is_signup_open`: app/core/identity.py does
`from app.core.config import is_signup_open`, which binds the name
`is_signup_open` in identity.py's OWN module namespace at import time (same
idiom noted in test_allowed_email_resolution.py's docstring for
resolve_allowed_email/ALLOWED_EMAILS). So
`monkeypatch.setattr(identity_module, "is_signup_open", lambda: True)`
rebinds that local name directly — identity.py always calls it through this
name, so the patch takes effect regardless of the real OPEN_SIGNUP env var.

Similarly, `resolve_allowed_email()` and the ALLOWED_EMAILS/_ALLOWED_BY_KEY
globals it reads live in app.core.config; monkeypatching those two globals
directly (rather than the real, unknown-to-this-test-suite deployed allow
list) keeps every test here deterministic regardless of what ALLOWED_EMAILS
is actually set to on whatever machine runs the suite.

Fake-collection conventions (fake `linked_identities_col`, `_make_token` for
signed fake Apple identity tokens, `_run` = asyncio.run(coro) to await route
coroutines directly) are copied from tests/test_linked_identities.py rather
than imported, per that file's own note that no mongomock is available in
this environment.
"""
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

import app.core.config as config
import app.core.identity as identity_module
import app.routers.auth as auth_module
from app.core.config import APPLE_BUNDLE_ID

KID = "test-key-open-signup"
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
        "sub": "000456.opensignup.0001",
        "email": "relay456@privaterelay.appleid.com",
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


class _FakeCol:
    """Stand-in for `linked_identities_col` — find_one/find/update_one
    (upsert), matching the subset resolve_signin_email() and the routes
    actually call."""

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


@pytest.fixture()
def fake_col(monkeypatch):
    # resolve_signin_email() (app/core/identity.py) and the link/list routes
    # (app/routers/auth.py) each hold their own imported reference to
    # linked_identities_col — both must point at the SAME fake instance.
    col = _FakeCol()
    monkeypatch.setattr(auth_module, "linked_identities_col", col)
    monkeypatch.setattr(identity_module, "linked_identities_col", col)
    return col


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def _open_signup(monkeypatch, is_open: bool) -> None:
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: is_open)


def _set_allow_list(monkeypatch, emails: list[str]) -> None:
    lowered = [e.strip().lower() for e in emails]
    by_key: dict[str, str] = {}
    for e in lowered:
        k = config._gmail_key(e)
        if k not in by_key:
            by_key[k] = e
    monkeypatch.setattr(config, "ALLOWED_EMAILS", set(lowered))
    monkeypatch.setattr(config, "_ALLOWED_BY_KEY", by_key)


def _user(email: str) -> dict:
    return {"email": email, "name": "Test"}


# ── 1. OPEN_SIGNUP off: unknown email refused exactly as today ─────────────

def test_open_signup_off_unknown_email_refused(fake_col, monkeypatch):
    _open_signup(monkeypatch, False)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    result = _run(identity_module.resolve_signin_email("google-native", "stranger@example.com"))
    assert result is None


# ── 2. OPEN_SIGNUP on: unknown email signs in and records an alias ─────────

def test_open_signup_on_unknown_email_creates_alias(fake_col, monkeypatch):
    _open_signup(monkeypatch, True)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    result = _run(identity_module.resolve_signin_email("google-native", "NewPerson@Example.com"))
    assert result == "newperson@example.com"
    alias = _run(fake_col.find_one({"_id": "email:newperson@example.com"}))
    assert alias is not None
    assert alias["provider"] == "email"
    assert alias["user_id"] == "newperson@example.com"


# ── 3. OPEN_SIGNUP on: second sign-in with a different Gmail dot spelling
#      resolves to the FIRST-seen spelling via the alias, not the allow list
#      (the address is on no allow list at all) ────────────────────────────

def test_open_signup_on_dot_variant_resolves_to_first_seen_spelling(fake_col, monkeypatch):
    _open_signup(monkeypatch, True)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    first = _run(identity_module.resolve_signin_email("google-native", "new.person12@gmail.com"))
    second = _run(identity_module.resolve_signin_email("google-native", "newperson12@gmail.com"))
    assert first == "new.person12@gmail.com"
    assert second == "new.person12@gmail.com"


# ── 4. OPEN_SIGNUP on: Apple relay identity with no existing link creates an
#      account keyed by the relay email and an auto:True apple:{sub} doc ───

def test_open_signup_on_apple_relay_creates_auto_link(fake_col, monkeypatch):
    _open_signup(monkeypatch, True)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    token = _make_token()
    result = _run(auth_module.apple_native({"identityToken": token}))
    assert result["ok"] is True

    from app.core.config import serializer, SESSION_MAX_AGE
    data = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["email"] == "relay456@privaterelay.appleid.com"

    doc = _run(fake_col.find_one({"_id": "apple:000456.opensignup.0001"}))
    assert doc is not None
    assert doc["auto"] is True
    assert doc["user_id"] == "relay456@privaterelay.appleid.com"


# ── 5. Explicit link from a DIFFERENT account than an existing AUTO link
#      succeeds (no 409) and flips auto to False; but a sub already linked
#      EXPLICITLY still 409s a further re-point ─────────────────────────────

def test_explicit_link_repoints_auto_link_but_not_explicit_link(fake_col, monkeypatch):
    _open_signup(monkeypatch, True)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])

    # First sign-in creates the automatic link.
    _run(auth_module.apple_native({"identityToken": _make_token()}))
    doc = _run(fake_col.find_one({"_id": "apple:000456.opensignup.0001"}))
    assert doc["auto"] is True

    # An explicit link from a different account is allowed to re-point it.
    result = _run(auth_module.link_apple_identity(
        {"identityToken": _make_token()}, _user("someone-else@example.com"),
    ))
    assert result["ok"] is True
    doc = _run(fake_col.find_one({"_id": "apple:000456.opensignup.0001"}))
    assert doc["user_id"] == "someone-else@example.com"
    assert doc["auto"] is False

    # Now that the link is explicit, a further re-point to a THIRD account 409s.
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.link_apple_identity(
            {"identityToken": _make_token()}, _user("third@example.com"),
        ))
    assert exc.value.status_code == 409
    # Untouched by the refused attempt.
    doc = _run(fake_col.find_one({"_id": "apple:000456.opensignup.0001"}))
    assert doc["user_id"] == "someone-else@example.com"


# ── 6. OPEN_SIGNUP on AND an allow-list entry exists for the same person:
#      the allow-list spelling wins over whatever the alias map produced ───

def test_allow_list_spelling_wins_over_alias(fake_col, monkeypatch):
    _open_signup(monkeypatch, True)
    _set_allow_list(monkeypatch, ["kevin.j.test@gmail.com"])

    # Seed the alias map with a DIFFERENT (dotless) spelling of the same
    # Gmail-key address, as if that spelling had signed in first.
    _run(fake_col.update_one(
        {"_id": "email:kevinjtest@gmail.com"},
        {"$set": {
            "_id": "email:kevinjtest@gmail.com",
            "provider": "email",
            "subject": "kevinjtest@gmail.com",
            "user_id": "kevinjtest@gmail.com",
        }},
        upsert=True,
    ))

    # A fresh sign-in verifies the allow-listed spelling itself; the alias
    # lookup (keyed by Gmail key) still finds the dotless doc first, but the
    # allow-list check afterwards must override it with the allow-list spelling.
    result = _run(identity_module.resolve_signin_email("google-native", "kevin.j.test@gmail.com"))
    assert result == "kevin.j.test@gmail.com"
    assert result != "kevinjtest@gmail.com"


# ── 7. GET /auth/identities never returns email: alias docs, and every
#      entry includes `auto` as a bool ──────────────────────────────────────

def test_get_identities_excludes_email_aliases_and_includes_auto(fake_col, monkeypatch):
    _open_signup(monkeypatch, True)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])

    # Creates both an apple:{sub} auto-link doc and an email:{key} alias doc.
    _run(auth_module.apple_native({"identityToken": _make_token()}))
    assert any(d["_id"].startswith("email:") for d in fake_col.docs)
    assert any(d["_id"].startswith("apple:") for d in fake_col.docs)

    result = _run(auth_module.list_linked_identities(
        _user("relay456@privaterelay.appleid.com"),
    ))
    assert len(result["linked"]) == 1
    entry = result["linked"][0]
    assert entry["provider"] == "apple"
    assert isinstance(entry["auto"], bool)
    assert entry["auto"] is True
