"""Tests for D9: letting an Apple Hide My Email invite be CLAIMED rather
than matched.

Production has sign-up closed, so a `...@privaterelay.appleid.com` relay
address can never be pre-allow-listed (nobody knows it until the first
sign-in) — an invited tester who ticks Apple's privacy option used to be
turned away with a flat 403 even though their real address is invited. This
suite covers the fix: apple_native() now hands back a signed claim token on
a refused RELAY sign-in (never on an ordinary refusal — that email really
isn't invited, no ambiguity), plus path 2's send-code/verify-code endpoints
and the module (app.core.relay_claim) backing them.

Same conventions as test_apple_auth.py / test_linked_identities.py /
test_signup_allowlist.py: a local RSA keypair signs fake Apple identity
tokens, `_get_apple_jwks` is monkeypatched, route coroutines are awaited
directly via `_run()` (asyncio.run), and every Mongo-backed collection this
flow touches (`linked_identities_col`, `allowed_signups_col`,
`allowed_relay_codes_col`) is replaced with a small in-memory fake local to
this file — no mongomock available in this environment, no real Mongo
touched.
"""
import asyncio
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

import app.core.allowlist as allowlist_module
import app.core.config as config
import app.core.identity as identity_module
import app.core.relay_claim as relay_claim
import app.routers.auth as auth_module
from app.core.config import APPLE_BUNDLE_ID

KID = "test-key-relay-claim"
ISSUER = "https://appleid.apple.com"

_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_public_jwk = RSAAlgorithm.to_jwk(_private_key.public_key(), as_dict=True)
_public_jwk["kid"] = KID
_public_jwk["use"] = "sig"
_public_jwk["alg"] = "RS256"
_JWKS = {"keys": [_public_jwk]}

RELAY_SUB = "000321.relayclaim.9999"
RELAY_EMAIL = "relaybox42@privaterelay.appleid.com"
INVITED_EMAIL = "friend@example.com"


def _run(coro):
    return asyncio.run(coro)


def _make_token(**overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": APPLE_BUNDLE_ID,
        "exp": now + 3600,
        "iat": now,
        "sub": RELAY_SUB,
        "email": RELAY_EMAIL,
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


@pytest.fixture(autouse=True)
def _email_claim_on(monkeypatch):
    """The email path is flag-gated (off by default until D11); most tests
    exercise it, the flag-off tests switch it back off."""
    monkeypatch.setattr(config, "RELAY_CLAIM_EMAIL_ENABLED", True)


# ── fakes ────────────────────────────────────────────────────────────────

def _match(d: dict, q: dict) -> bool:
    return all(d.get(k) == v for k, v in (q or {}).items())


class _UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _FakeLinkedIdentitiesCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

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


class _FakeAllowlistCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, max_time_ms=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                return _UpdateResult(1)
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$setOnInsert") or {})
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)
            return _UpdateResult(0)
        return _UpdateResult(0)


class _FakeRelayCodesCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                if "$set" in update:
                    d.update(update["$set"])
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        d[k] = d.get(k, 0) + v
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


@pytest.fixture()
def fake_linked(monkeypatch):
    col = _FakeLinkedIdentitiesCol()
    monkeypatch.setattr(auth_module, "linked_identities_col", col)
    monkeypatch.setattr(identity_module, "linked_identities_col", col)
    return col


@pytest.fixture()
def fake_allowlist(monkeypatch):
    col = _FakeAllowlistCol()
    monkeypatch.setattr(allowlist_module, "allowed_signups_col", col)
    monkeypatch.setattr(relay_claim, "allowed_signups_col", col)
    return col


@pytest.fixture()
def fake_codes(monkeypatch):
    col = _FakeRelayCodesCol()
    monkeypatch.setattr(relay_claim, "allowed_relay_codes_col", col)
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


def _closed(monkeypatch) -> None:
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: False)


def _invite(fake_allowlist, email=INVITED_EMAIL):
    fake_allowlist.docs.append({
        "key": config._gmail_key(email), "email": email, "status": "invited",
    })


def _captured_codes(monkeypatch) -> list[str]:
    """Replace the send seam to capture the plaintext code instead of the
    real (currently no-op) delivery path — see relay_claim.py's own
    docstring for why no real sender exists to test against."""
    captured: list[str] = []

    async def _fake_deliver(target_email, code):
        captured.append(code)

    monkeypatch.setattr(relay_claim, "_deliver_code", _fake_deliver)
    return captured


# ── 1. refused-relay path returns the two-path response, no session ───────

def test_relay_refusal_returns_claim_token_and_prompt_no_session(
    fake_linked, fake_allowlist, monkeypatch,
):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    _invite(fake_allowlist)
    token = _make_token()
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 403
    detail = exc.value.detail
    assert detail["code"] == "RELAY_INVITE_CLAIM"
    assert detail["claim_token"]
    # No session, anywhere in the raised exception.
    assert "session_token" not in str(exc.value.detail)


def test_ordinary_non_relay_refusal_keeps_flat_invite_only(fake_linked, fake_allowlist, monkeypatch):
    """A non-relay email that's simply not invited is unambiguous — it must
    NOT get the relay two-path treatment."""
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    token = _make_token(email="stranger@icloud.com", is_private_email="false")
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    assert exc.value.status_code == 403
    assert exc.value.detail == {"code": "INVITE_ONLY"}


# ── 2. path 1's prompt ──────────────────────────────────────────────────────

def test_relay_refusal_carries_path1_prompt_shared_with_d10(fake_linked, fake_allowlist, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    _invite(fake_allowlist)
    token = _make_token()
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    from app.core.link_prompts import APPLE_RELAY_LINK_EXISTING_ACCOUNT_PROMPT
    assert exc.value.detail["link_existing_prompt"] == APPLE_RELAY_LINK_EXISTING_ACCOUNT_PROMPT
    # Copy rules: no em dash, and this is the exact string D10 must reuse.
    assert "—" not in APPLE_RELAY_LINK_EXISTING_ACCOUNT_PROMPT


# ── 3. claim-by-code end to end ─────────────────────────────────────────────

def test_claim_by_code_end_to_end(fake_linked, fake_allowlist, fake_codes, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    _invite(fake_allowlist)
    captured = _captured_codes(monkeypatch)

    token = _make_token()
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    claim_token = exc.value.detail["claim_token"]

    send_result = _run(auth_module.send_relay_claim_code_endpoint(
        {"claim_token": claim_token, "email": INVITED_EMAIL}
    ))
    assert send_result == {"ok": True}
    assert len(captured) == 1
    code = captured[0]
    assert len(code) == 6 and code.isdigit()

    verify_result = _run(auth_module.verify_relay_claim_code_endpoint(
        {"claim_token": claim_token, "email": INVITED_EMAIL, "code": code}
    ))
    assert verify_result["ok"] is True
    assert "session_token" in verify_result
    assert verify_result["relay"] is True

    from app.core.config import serializer, SESSION_MAX_AGE
    data = serializer.loads(verify_result["session_token"], max_age=SESSION_MAX_AGE)
    assert data["email"] == INVITED_EMAIL

    # The sub is now explicitly linked to the invited account.
    link_doc = next(d for d in fake_linked.docs if d["_id"] == f"apple:{RELAY_SUB}")
    assert link_doc["user_id"] == INVITED_EMAIL
    assert link_doc["auto"] is False
    assert link_doc["relay"] is True

    # D5 record extended with the claimed sub.
    invite_doc = next(d for d in fake_allowlist.docs if d.get("key") == config._gmail_key(INVITED_EMAIL))
    assert invite_doc["apple_sub"] == RELAY_SUB
    assert invite_doc.get("apple_relay_claimed_at") is not None

    # Now a fresh Apple sign-in with the same sub resolves straight through
    # the link, no refusal.
    signin_token = _make_token()
    result = _run(auth_module.apple_native({"identityToken": signin_token}))
    assert result["ok"] is True
    data2 = serializer.loads(result["session_token"], max_age=SESSION_MAX_AGE)
    assert data2["email"] == INVITED_EMAIL


def test_send_code_is_generic_ok_for_uninvited_email_no_code_created(fake_linked, fake_allowlist, fake_codes, monkeypatch):
    """No oracle: an uninvited address gets the same {"ok": True}, and no
    code record is created at all."""
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    captured = _captured_codes(monkeypatch)
    token = _make_token()
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": token}))
    claim_token = exc.value.detail["claim_token"]

    result = _run(auth_module.send_relay_claim_code_endpoint(
        {"claim_token": claim_token, "email": "not-invited@example.com"}
    ))
    assert result == {"ok": True}
    assert captured == []
    assert fake_codes.docs == []


def test_send_code_rejects_invalid_claim_token(fake_linked, fake_allowlist, fake_codes):
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.send_relay_claim_code_endpoint({"claim_token": "garbage", "email": INVITED_EMAIL}))
    assert exc.value.status_code == 401


def test_verify_code_rejects_invalid_claim_token(fake_linked, fake_allowlist, fake_codes):
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.verify_relay_claim_code_endpoint(
            {"claim_token": "garbage", "email": INVITED_EMAIL, "code": "123456"}
        ))
    assert exc.value.status_code == 401


# ── 4. wrong / expired / reused / too-many-attempts, each refused ─────────

async def _make_claim(email=INVITED_EMAIL, sub=RELAY_SUB) -> str:
    return relay_claim.mint_claim_token(sub=sub, relay_email=RELAY_EMAIL)


def test_wrong_code_refused_and_counts_an_attempt(fake_codes):
    _run(relay_claim.send_relay_claim_code(sub=RELAY_SUB, target_email=INVITED_EMAIL))
    outcome = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code="000000"))
    assert outcome == relay_claim.ClaimOutcome.WRONG_CODE
    doc = fake_codes.docs[0]
    assert doc["attempts"] == 1
    assert doc["used_at"] is None


def test_expired_code_refused(fake_codes, monkeypatch):
    captured = _captured_codes(monkeypatch)
    _run(relay_claim.send_relay_claim_code(sub=RELAY_SUB, target_email=INVITED_EMAIL))
    code = captured[0]
    doc = fake_codes.docs[0]
    doc["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    outcome = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code=code))
    assert outcome == relay_claim.ClaimOutcome.EXPIRED


def test_reused_code_refused(fake_codes, monkeypatch):
    captured = _captured_codes(monkeypatch)
    _run(relay_claim.send_relay_claim_code(sub=RELAY_SUB, target_email=INVITED_EMAIL))
    code = captured[0]
    first = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code=code))
    assert first == relay_claim.ClaimOutcome.OK
    second = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code=code))
    assert second == relay_claim.ClaimOutcome.USED


def test_too_many_attempts_locks_out_even_the_correct_code(fake_codes, monkeypatch):
    captured = _captured_codes(monkeypatch)
    _run(relay_claim.send_relay_claim_code(sub=RELAY_SUB, target_email=INVITED_EMAIL))
    code = captured[0]
    for _ in range(relay_claim.CODE_MAX_ATTEMPTS):
        outcome = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code="999999"))
        assert outcome == relay_claim.ClaimOutcome.WRONG_CODE
    locked_outcome = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code=code))
    assert locked_outcome == relay_claim.ClaimOutcome.LOCKED


def test_verify_endpoint_maps_locked_to_429(fake_linked, fake_allowlist, fake_codes, monkeypatch):
    _invite(fake_allowlist)
    captured = _captured_codes(monkeypatch)
    _run(relay_claim.send_relay_claim_code(sub=RELAY_SUB, target_email=INVITED_EMAIL))
    for _ in range(relay_claim.CODE_MAX_ATTEMPTS):
        _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code="999999"))

    claim_token = relay_claim.mint_claim_token(sub=RELAY_SUB, relay_email=RELAY_EMAIL)
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.verify_relay_claim_code_endpoint(
            {"claim_token": claim_token, "email": INVITED_EMAIL, "code": captured[0]}
        ))
    assert exc.value.status_code == 429


def test_unknown_code_record_refused_not_found(fake_codes):
    outcome = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code="123456"))
    assert outcome == relay_claim.ClaimOutcome.NOT_FOUND


# ── 5. the relay-cannot-alias rule ──────────────────────────────────────────

def test_code_sent_to_one_address_cannot_verify_against_another(fake_codes, monkeypatch):
    """The core security property: a code minted for INVITED_EMAIL must
    never verify (and therefore never link) against a different address,
    even naming the exact same, correct plaintext code."""
    captured = _captured_codes(monkeypatch)
    _run(relay_claim.send_relay_claim_code(sub=RELAY_SUB, target_email=INVITED_EMAIL))
    code = captured[0]

    other_email = "other-allowlisted@example.com"
    outcome = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=other_email, code=code))
    assert outcome == relay_claim.ClaimOutcome.NOT_FOUND

    # And the legitimate target still verifies fine with its own code.
    outcome_correct = _run(relay_claim.verify_relay_code(sub=RELAY_SUB, target_email=INVITED_EMAIL, code=code))
    assert outcome_correct == relay_claim.ClaimOutcome.OK


def test_endpoint_cannot_be_used_to_alias_onto_an_arbitrary_allowlisted_address(
    fake_linked, fake_allowlist, fake_codes, monkeypatch,
):
    """Even with a valid claim_token (real sub) and a correct code for
    INVITED_EMAIL, naming a DIFFERENT allow-listed address in the verify
    request must not link the sub to that other address."""
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    _invite(fake_allowlist, email=INVITED_EMAIL)
    other_email = "second-invitee@example.com"
    _invite(fake_allowlist, email=other_email)
    captured = _captured_codes(monkeypatch)

    claim_token = relay_claim.mint_claim_token(sub=RELAY_SUB, relay_email=RELAY_EMAIL)
    _run(auth_module.send_relay_claim_code_endpoint({"claim_token": claim_token, "email": INVITED_EMAIL}))
    code = captured[0]

    with pytest.raises(HTTPException) as exc:
        _run(auth_module.verify_relay_claim_code_endpoint(
            {"claim_token": claim_token, "email": other_email, "code": code}
        ))
    assert exc.value.status_code == 401
    assert not any(d.get("_id") == f"apple:{RELAY_SUB}" for d in fake_linked.docs)


def test_revoked_invitation_fails_closed_even_with_correct_code(
    fake_linked, fake_allowlist, fake_codes, monkeypatch,
):
    """If the invitation is revoked between send-code and verify-code, the
    claim must fail closed rather than link against a since-revoked
    address."""
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    _invite(fake_allowlist)
    captured = _captured_codes(monkeypatch)
    claim_token = relay_claim.mint_claim_token(sub=RELAY_SUB, relay_email=RELAY_EMAIL)
    _run(auth_module.send_relay_claim_code_endpoint({"claim_token": claim_token, "email": INVITED_EMAIL}))
    code = captured[0]

    # Revoke in between.
    for d in fake_allowlist.docs:
        if d.get("key") == config._gmail_key(INVITED_EMAIL):
            d["status"] = "revoked"

    with pytest.raises(HTTPException) as exc:
        _run(auth_module.verify_relay_claim_code_endpoint(
            {"claim_token": claim_token, "email": INVITED_EMAIL, "code": code}
        ))
    assert exc.value.status_code == 401
    assert not any(d.get("_id") == f"apple:{RELAY_SUB}" for d in fake_linked.docs)


# ── 6. OPEN_SIGNUP on still auto-links exactly as today ────────────────────

def test_open_signup_on_relay_still_auto_links_no_claim_flow(fake_linked, fake_allowlist, monkeypatch):
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: True)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    token = _make_token()
    result = _run(auth_module.apple_native({"identityToken": token}))
    assert result["ok"] is True
    assert "session_token" in result

    link_doc = next(d for d in fake_linked.docs if d["_id"] == f"apple:{RELAY_SUB}")
    assert link_doc["auto"] is True
    assert link_doc["user_id"] == RELAY_EMAIL


def test_claim_endpoints_have_their_own_tight_rate_limits_ahead_of_generic_auth_rule():
    """D9: send-code (a would-be email send) and verify-code (code guessing)
    are rate-limited tighter than the generic /auth/ budget, and match first."""
    from app.core import ratelimit

    prefixes = [p for p, _, _ in ratelimit.RULES]
    generic = prefixes.index("/auth/")
    rules = {p: (limit, window) for p, limit, window in ratelimit.RULES}
    for path in ("/auth/apple/relay/send-code", "/auth/apple/relay/verify-code"):
        assert prefixes.index(path) < generic
        assert rules[path][0] < rules["/auth/"][0]


# ── D9 review: flag gating, already-linked sub, 429s ────────────────────────

def _refusal_detail(fake_linked, fake_allowlist, monkeypatch):
    _closed(monkeypatch)
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    _invite(fake_allowlist)
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.apple_native({"identityToken": _make_token()}))
    return exc.value.detail


def test_refusal_says_email_claim_available_when_flag_on(fake_linked, fake_allowlist, monkeypatch):
    detail = _refusal_detail(fake_linked, fake_allowlist, monkeypatch)
    assert detail["code"] == "RELAY_INVITE_CLAIM"
    assert detail["email_claim_available"] is True


def test_flag_off_refusal_still_claims_but_email_unavailable_and_send_creates_nothing(
    fake_linked, fake_allowlist, fake_codes, monkeypatch,
):
    monkeypatch.setattr(config, "RELAY_CLAIM_EMAIL_ENABLED", False)
    captured = _captured_codes(monkeypatch)
    detail = _refusal_detail(fake_linked, fake_allowlist, monkeypatch)
    assert detail["code"] == "RELAY_INVITE_CLAIM"
    assert detail["email_claim_available"] is False
    result = _run(auth_module.send_relay_claim_code_endpoint(
        {"claim_token": detail["claim_token"], "email": INVITED_EMAIL}
    ))
    assert result == {"ok": True}
    assert captured == [] and fake_codes.docs == []


def test_claim_token_for_already_linked_sub_is_rejected_by_send_and_verify(
    fake_linked, fake_allowlist, fake_codes, monkeypatch,
):
    captured = _captured_codes(monkeypatch)
    detail = _refusal_detail(fake_linked, fake_allowlist, monkeypatch)
    fake_linked.docs.append({"_id": f"apple:{RELAY_SUB}", "user_id": "someone@example.com", "auto": False})
    with pytest.raises(HTTPException) as e1:
        _run(auth_module.send_relay_claim_code_endpoint(
            {"claim_token": detail["claim_token"], "email": INVITED_EMAIL}))
    assert e1.value.status_code == 401
    with pytest.raises(HTTPException) as e2:
        _run(auth_module.verify_relay_claim_code_endpoint(
            {"claim_token": detail["claim_token"], "email": INVITED_EMAIL, "code": "123456"}))
    assert e2.value.status_code == 401
    assert captured == [] and fake_codes.docs == []


class _Req:
    def __init__(self, path, ip):
        from types import SimpleNamespace
        self.url = SimpleNamespace(path=path)
        self.headers = {}
        self.client = SimpleNamespace(host=ip)
        self.method = "POST"


@pytest.mark.parametrize("path,limit", [
    ("/auth/apple/relay/send-code", 5),
    ("/auth/apple/relay/verify-code", 10),
])
def test_claim_endpoints_return_429_past_their_budget(path, limit, monkeypatch):
    from app.core import ratelimit
    ip = f"198.51.100.{limit}"
    monkeypatch.setattr(ratelimit, "client_ip", lambda request: ip)
    monkeypatch.setattr(ratelimit, "_local_buckets", {}, raising=False)
    for _ in range(limit):
        assert _run(ratelimit.check_rate_limit(_Req(path, ip))) is None
    resp = _run(ratelimit.check_rate_limit(_Req(path, ip)))
    assert resp is not None and resp.status_code == 429
