"""C21: Apple JWS verification, the App Store Server Notifications V2
receiver, the appAccountToken, signed-transaction verification (purchase and
restore), refunds with and without clawback.

Nothing about Apple's signing is faked at the point of use: the tests mint a
TEST certificate authority (root, intermediate, leaf, each with the same
marker extensions Apple's hierarchy carries), sign real ES256 JWS with it
through PyJWT, pin the test root in place of Apple's, and drive the real
verification code. The payload objects the code reads are whatever
jwt.decode returns, i.e. plain dicts, exactly as in production, so there is
no convenient fake to hide a dict-versus-object bug behind (the B33/B36
lesson in C13 section 11). Apple's real root replaces the test root in
production and nothing else changes. What these tests cannot prove is that
real Apple payloads match: that is the TestFlight/sandbox pass in
docs/pricing/store-billing-c13-testplan.md.
"""
import asyncio
import base64
import json
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from fastapi import HTTPException

import app.core.config as config
import app.db.collections as collections_module
import app.routers.billing as billing_router
import app.services.apple_billing as apple_billing
import app.services.apple_jws as apple_jws
import app.services.billing_lifecycle as lifecycle
from app.core.subscription import Tier, get_subscription
from tests.fake_cols import FakeCol

UID = "apple-user@example.com"
OTHER = "someone-else@example.com"
BUNDLE = "co.uk.auriqltd.sorted"
NOW = datetime.now(timezone.utc)


def _run(coro):
    return asyncio.run(coro)


def _ms(dt):
    return int(dt.timestamp() * 1000)


# ── Test certificate authority ───────────────────────────────────────────────

def _name(common_name):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, common_name)])


def _issue(subject_cn, subject_key, issuer_cn, issuer_key, *, ca, marker=None, not_before=None, not_after=None):
    builder = (
        x509.CertificateBuilder()
        .subject_name(_name(subject_cn))
        .issuer_name(_name(issuer_cn))
        .public_key(subject_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before or NOW - timedelta(days=1))
        .not_valid_after(not_after or NOW + timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
    )
    if marker is not None:
        builder = builder.add_extension(x509.UnrecognizedExtension(marker, b"\x05\x00"), critical=False)
    return builder.sign(issuer_key, hashes.SHA256())


class Pki:
    """root -> intermediate -> leaf, shaped like Apple's App Store hierarchy."""

    def __init__(self, name="Test", *, leaf_marker=True, intermediate_marker=True, leaf_not_after=None):
        self.root_key = ec.generate_private_key(ec.SECP256R1())
        self.int_key = ec.generate_private_key(ec.SECP256R1())
        self.leaf_key = ec.generate_private_key(ec.SECP256R1())
        self.root = _issue(f"{name} Root", self.root_key, f"{name} Root", self.root_key, ca=True)
        self.intermediate = _issue(
            f"{name} Intermediate", self.int_key, f"{name} Root", self.root_key, ca=True,
            marker=apple_jws.INTERMEDIATE_MARKER_OID if intermediate_marker else None,
        )
        self.leaf = _issue(
            f"{name} Leaf", self.leaf_key, f"{name} Intermediate", self.int_key, ca=False,
            marker=apple_jws.LEAF_MARKER_OID if leaf_marker else None, not_after=leaf_not_after,
        )

    def x5c(self, *, include_root=True):
        certs = [self.leaf, self.intermediate] + ([self.root] if include_root else [])
        return [base64.b64encode(c.public_bytes(serialization.Encoding.DER)).decode() for c in certs]

    def sign(self, payload, *, x5c=None, key=None, alg="ES256"):
        return jwt.encode(payload, key or self.leaf_key, algorithm=alg, headers={"x5c": x5c or self.x5c()})

    def root_pem(self):
        return self.root.public_bytes(serialization.Encoding.PEM)


@pytest.fixture(scope="module")
def pki():
    return Pki("Test")


@pytest.fixture
def env(monkeypatch, tmp_path, pki):
    """IAP enabled, the test root pinned, Sandbox accepted, fake collections."""
    (tmp_path / "root.pem").write_bytes(pki.root_pem())
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", True)
    monkeypatch.setattr(config, "APPLE_ROOT_CERTS_DIR", tmp_path)
    monkeypatch.setattr(config, "APPLE_ALLOWED_ENVIRONMENTS", frozenset({"Sandbox"}))
    monkeypatch.setattr(config, "APPLE_BUNDLE_ID", BUNDLE)
    monkeypatch.setattr(config, "APPLE_PRODUCT_IDS", {})
    monkeypatch.setattr(config, "IAP_REFUND_CLAWBACK", False)
    cols = {
        "subscriptions_col": FakeCol(unique=(("user_id", "provider"),)),
        "billing_events_col": FakeCol(unique=(("event_id",),)),
        "billing_customers_col": FakeCol(),
        "apple_account_tokens_col": FakeCol(unique=(("user_id",), ("app_account_token",))),
        "penny_topups_col": FakeCol(unique=(("provider", "store_transaction_id"),)),
        "mcp_call_packs_col": FakeCol(unique=(("provider", "store_transaction_id"),)),
    }
    for name, col in cols.items():
        monkeypatch.setattr(collections_module, name, col)
    pushes = []

    async def fake_notify(uid, title, body, url="/settings"):
        pushes.append((title, body))
        return True

    async def fake_landed(uid):
        return {"revoke": "off"}

    monkeypatch.setattr(lifecycle, "notify", fake_notify)
    monkeypatch.setattr(lifecycle, "on_landed_on_statements", fake_landed)
    cols["pushes"] = pushes
    cols["pki"] = pki
    return cols


# ── Payload builders ─────────────────────────────────────────────────────────

def _token(env_, uid=UID):
    return _run(apple_billing.get_or_create_account_token(uid))


def _tx(env_, *, product="sorted.lite.monthly", uid=UID, original="orig-1", txid=None, expires=None,
        purchase=None, offer=None, discount=None, price=None, revocation=None, environment="Sandbox",
        bundle=BUNDLE, token="auto", signed=None):
    body = {
        "transactionId": txid or f"tx-{uuid.uuid4().hex[:8]}",
        "originalTransactionId": original,
        "bundleId": bundle,
        "productId": product,
        "purchaseDate": _ms(purchase or NOW),
        "originalPurchaseDate": _ms(purchase or NOW),
        "expiresDate": _ms(expires or NOW + timedelta(days=30)),
        "environment": environment,
        "signedDate": _ms(signed or NOW),
    }
    if token == "auto":
        body["appAccountToken"] = _token(env_, uid)
    elif token is not None:
        body["appAccountToken"] = token
    if offer is not None:
        body["offerType"] = offer
    if discount is not None:
        body["offerDiscountType"] = discount
    if price is not None:
        body["price"] = price
    if revocation is not None:
        body["revocationDate"] = _ms(revocation)
    return body


def _signed_tx(env_, **kw):
    return env_["pki"].sign(_tx(env_, **kw))


def _notification(env_, ntype, *, subtype=None, tx=None, renewal=None, nuuid=None, environment="Sandbox",
                  bundle=BUNDLE, signed=None, pki=None):
    pki = pki or env_["pki"]
    data = {"environment": environment, "bundleId": bundle, "appAppleId": 123}
    if tx is not None:
        data["signedTransactionInfo"] = pki.sign(tx)
    if renewal is not None:
        data["signedRenewalInfo"] = pki.sign(renewal)
    payload = {
        "notificationType": ntype, "notificationUUID": nuuid or str(uuid.uuid4()),
        "data": data, "version": "2.0", "signedDate": _ms(signed or NOW),
    }
    if subtype:
        payload["subtype"] = subtype
    return pki.sign(payload)


def _send(env_, ntype, **kw):
    return _run(apple_billing.handle_notification(_notification(env_, ntype, **kw)))


def _doc(env_, provider="apple"):
    return next((d for d in env_["subscriptions_col"].docs if d.get("provider") == provider), None)


# ── JWS verification ─────────────────────────────────────────────────────────

def test_valid_chain_is_accepted_and_payload_returned_as_a_plain_dict(pki):
    token = pki.sign({"hello": "world"})
    out = apple_jws.verify_and_decode(token, [pki.root])
    assert out == {"hello": "world"} and type(out) is dict


def test_chain_without_the_root_is_accepted_when_a_pinned_root_issued_it(pki):
    token = pki.sign({"a": 1}, x5c=pki.x5c(include_root=False))
    assert apple_jws.verify_and_decode(token, [pki.root]) == {"a": 1}


def test_bad_signature_is_rejected(pki):
    other_leaf_key = ec.generate_private_key(ec.SECP256R1())
    forged = pki.sign({"a": 1}, key=other_leaf_key)  # right chain, wrong signing key
    with pytest.raises(apple_jws.AppleVerificationError, match="signature"):
        apple_jws.verify_and_decode(forged, [pki.root])


def test_tampered_payload_is_rejected(pki):
    head, body, sig = pki.sign({"amount": 1}).split(".")
    evil = base64.urlsafe_b64encode(json.dumps({"amount": 999}).encode()).rstrip(b"=").decode()
    with pytest.raises(apple_jws.AppleVerificationError):
        apple_jws.verify_and_decode(f"{head}.{evil}.{sig}", [pki.root])


def test_a_chain_from_an_unpinned_ca_is_rejected(pki):
    attacker = Pki("Attacker")
    token = attacker.sign({"a": 1})
    with pytest.raises(apple_jws.AppleVerificationError, match="pinned root"):
        apple_jws.verify_and_decode(token, [pki.root])
    # Even though the payload asserts its own self-signed root at the end.
    with pytest.raises(apple_jws.AppleVerificationError):
        apple_jws.verify_chain(attacker.x5c(), [pki.root])


def test_no_pinned_root_fails_closed(pki):
    with pytest.raises(apple_jws.AppleVerificationError, match="no pinned"):
        apple_jws.verify_and_decode(pki.sign({"a": 1}), [])


def test_expired_leaf_is_rejected():
    stale = Pki("Stale", leaf_not_after=NOW - timedelta(days=1))
    with pytest.raises(apple_jws.AppleVerificationError, match="validity"):
        apple_jws.verify_and_decode(stale.sign({"a": 1}), [stale.root])


def test_missing_app_store_marker_extensions_are_rejected():
    no_leaf = Pki("NoLeafMarker", leaf_marker=False)
    with pytest.raises(apple_jws.AppleVerificationError, match="leaf"):
        apple_jws.verify_and_decode(no_leaf.sign({"a": 1}), [no_leaf.root])
    no_int = Pki("NoIntMarker", intermediate_marker=False)
    with pytest.raises(apple_jws.AppleVerificationError, match="intermediate"):
        apple_jws.verify_and_decode(no_int.sign({"a": 1}), [no_int.root])


def test_a_leaf_cannot_masquerade_as_the_issuer(pki):
    # Chain order scrambled: leaf listed after intermediate.
    x5c = pki.x5c()
    swapped = [x5c[1], x5c[0], x5c[2]]
    with pytest.raises(apple_jws.AppleVerificationError):
        apple_jws.verify_and_decode(pki.sign({"a": 1}, x5c=swapped), [pki.root])


def test_only_es256_is_accepted(pki):
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "x5c": pki.x5c()}).encode()).rstrip(b"=").decode()
    body = base64.urlsafe_b64encode(b'{"a":1}').rstrip(b"=").decode()
    with pytest.raises(apple_jws.AppleVerificationError, match="ES256"):
        apple_jws.verify_and_decode(f"{header}.{body}.", [pki.root])
    hs = jwt.encode({"a": 1}, "secret" * 8, algorithm="HS256", headers={"x5c": pki.x5c()})
    with pytest.raises(apple_jws.AppleVerificationError, match="ES256"):
        apple_jws.verify_and_decode(hs, [pki.root])


@pytest.mark.parametrize("garbage", [
    "", "abc", "a.b", "a.b.c", "....", "x" * 200_000, None, 123, "e30.e30.e30",
    "eyJhbGciOiJFUzI1NiJ9.e30.AAAA",
])
def test_garbage_never_verifies_and_never_raises_anything_else(pki, garbage):
    with pytest.raises(apple_jws.AppleVerificationError):
        apple_jws.verify_and_decode(garbage, [pki.root])


def test_malformed_x5c_shapes_are_rejected(pki):
    for bad in ("x", [], ["only-one"], [1, 2, 3], ["!!!notbase64", "!!!", "!!!"], ["QQ==", "QQ==", "QQ=="]):
        token = jwt.encode({"a": 1}, pki.leaf_key, algorithm="ES256", headers={"x5c": bad})
        with pytest.raises(apple_jws.AppleVerificationError):
            apple_jws.verify_and_decode(token, [pki.root])
    no_x5c = jwt.encode({"a": 1}, pki.leaf_key, algorithm="ES256")
    with pytest.raises(apple_jws.AppleVerificationError):
        apple_jws.verify_and_decode(no_x5c, [pki.root])


def test_pinned_roots_load_pem_and_der_and_skip_junk(pki, tmp_path):
    (tmp_path / "a.pem").write_bytes(pki.root_pem())
    (tmp_path / "b.cer").write_bytes(pki.root.public_bytes(serialization.Encoding.DER))
    (tmp_path / "junk.cer").write_bytes(b"not a certificate")
    (tmp_path / "notes.txt").write_text("ignored")
    assert len(apple_jws.load_pinned_roots(tmp_path)) == 2
    assert apple_jws.load_pinned_roots(tmp_path / "missing") == []


# ── appAccountToken ──────────────────────────────────────────────────────────

def test_account_token_is_a_stable_random_uuid_never_the_email(env):
    token = _run(apple_billing.get_or_create_account_token(UID))
    assert str(uuid.UUID(token)) == token
    assert _run(apple_billing.get_or_create_account_token(UID)) == token
    assert _run(apple_billing.get_or_create_account_token(OTHER)) != token
    assert "apple-user" not in token and "example.com" not in token
    assert _run(apple_billing.uid_for_account_token(token)) == UID
    assert _run(apple_billing.uid_for_account_token(token.upper())) == UID
    assert _run(apple_billing.uid_for_account_token("not-a-uuid")) is None
    assert _run(apple_billing.uid_for_account_token(None)) is None
    assert len(env["apple_account_tokens_col"].docs) == 2


def test_account_token_endpoint_mints_only_when_enabled(env, monkeypatch):
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", False)
    off = _run(billing_router.apple_account_token({"email": UID}))
    assert off["enabled"] is False and off["app_account_token"] is None and off["products"] == {}
    assert env["apple_account_tokens_col"].docs == []
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", True)
    on = _run(billing_router.apple_account_token({"email": UID}))
    assert on["enabled"] and on["purchase_allowed"] and str(uuid.UUID(on["app_account_token"]))
    assert len(on["products"]) == 12 and on["trial_days"] == 14
    assert not any("connect" in v for v in on["products"].values())
    assert on["products"]["lite"] == "sorted.lite.monthly"


def test_account_token_endpoint_blocks_purchase_while_stripe_is_live(env):
    env["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "stripe", "stripe_subscription_id": "s",
        "tier": "lite", "status": "active", "expires_at": NOW + timedelta(days=5),
    })
    out = _run(billing_router.apple_account_token({"email": UID}))
    assert out["purchase_allowed"] is False and out["blocked_reason"] == "stripe_subscription_active"
    assert "Settings, Your plan" in out["blocked_message"] and "—" not in out["blocked_message"]


def test_product_ids_come_from_config_overrides(env, monkeypatch):
    monkeypatch.setattr(config, "APPLE_PRODUCT_IDS", {"lite": "kevin.lite.m"})
    out = _run(billing_router.apple_account_token({"email": UID}))
    assert out["products"]["lite"] == "kevin.lite.m" and out["products"]["max"] == "sorted.max.monthly"
    # The receiver follows the same table: the overridden id is now the Lite product.
    res = _send(env, "SUBSCRIBED", tx=_tx(env, product="kevin.lite.m"))
    assert res["result"]["handled"] and res["result"]["tier"] == "lite"


# ── Notification mapping ─────────────────────────────────────────────────────

def test_subscribed_with_the_introductory_free_trial_is_trialing(env):
    end = NOW + timedelta(days=14)
    res = _send(env, "SUBSCRIBED", subtype="INITIAL_BUY",
                tx=_tx(env, product="sorted.standard.annual", expires=end, offer=1, discount="FREE_TRIAL", price=0))
    assert res["ok"] and res["result"]["status"] == "trialing"
    d = _doc(env)
    assert d["tier"] == "standard" and d["billing_period"] == "annual" and d["status"] == "trialing"
    assert d["source"] == "apple" and d["provider"] == "apple" and d["provider_subscription_id"] == "orig-1"
    assert d["trial_used_at"] and d["trial_ends_at"].replace(microsecond=0) == end.replace(microsecond=0)
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.STANDARD and sub.status == "trialing" and sub.provider == "apple"


def test_trial_is_recognised_on_older_payloads_without_a_discount_type(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, offer=1, price=None))
    assert _doc(env)["status"] == "trialing"


def test_a_paid_introductory_offer_is_not_a_free_trial(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, offer=1, discount="PAY_UP_FRONT", price=1990))
    assert _doc(env)["status"] == "active"


def test_offer_redeemed_introductory_and_non_introductory(env):
    _send(env, "OFFER_REDEEMED", subtype="INITIAL_BUY", tx=_tx(env, offer=1, discount="FREE_TRIAL"))
    assert _doc(env)["status"] == "trialing"
    _send(env, "OFFER_REDEEMED", subtype="UPGRADE", tx=_tx(env, offer=3, signed=NOW + timedelta(seconds=5)),
          signed=NOW + timedelta(seconds=5))
    assert _doc(env)["status"] == "active"


def test_did_renew_after_the_trial_converts_to_active_and_extends_expiry(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, offer=1, discount="FREE_TRIAL", expires=NOW + timedelta(days=14)))
    later = NOW + timedelta(days=14)
    new_end = later + timedelta(days=30)
    res = _send(env, "DID_RENEW", tx=_tx(env, purchase=later, expires=new_end, signed=later), signed=later)
    assert res["result"]["status"] == "active"
    d = _doc(env)
    assert d["status"] == "active" and d["expires_at"].replace(microsecond=0) == new_end.replace(microsecond=0)
    assert d["trial_ends_at"] is None


def test_did_change_renewal_status_toggles_cancel_at_period_end(env):
    _send(env, "SUBSCRIBED", tx=_tx(env))
    t1, t2 = NOW + timedelta(seconds=10), NOW + timedelta(seconds=20)
    _send(env, "DID_CHANGE_RENEWAL_STATUS", subtype="AUTO_RENEW_DISABLED", tx=_tx(env, signed=t1), signed=t1)
    assert _doc(env)["cancel_at_period_end"] is True
    sub = _run(get_subscription(UID))
    assert sub.cancel_at_period_end and sub.tier == Tier.LITE  # still entitled
    _send(env, "DID_CHANGE_RENEWAL_STATUS", subtype="AUTO_RENEW_ENABLED", tx=_tx(env, signed=t2), signed=t2)
    assert _doc(env)["cancel_at_period_end"] is False


def test_did_fail_to_renew_with_grace_keeps_access_until_grace_ends(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.max.monthly", expires=NOW - timedelta(hours=1)))
    t = NOW + timedelta(seconds=5)
    grace = NOW + timedelta(days=6)
    res = _send(env, "DID_FAIL_TO_RENEW", subtype="GRACE_PERIOD", tx=_tx(env, signed=t), signed=t,
                renewal={"gracePeriodExpiresDate": _ms(grace), "environment": "Sandbox"})
    assert res["result"]["status"] == "past_due"
    assert _doc(env)["status"] == "past_due"
    assert _run(get_subscription(UID)).tier == Tier.MAX
    assert len(env["pushes"]) == 1 and "Apple ID" in env["pushes"][0][1]


def test_did_fail_to_renew_without_grace_ends_access_but_stays_past_due(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, expires=NOW - timedelta(hours=1)))
    t = NOW + timedelta(seconds=5)
    _send(env, "DID_FAIL_TO_RENEW", tx=_tx(env, signed=t), signed=t)
    assert _doc(env)["status"] == "past_due"
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


@pytest.mark.parametrize("ntype", ["EXPIRED", "GRACE_PERIOD_EXPIRED"])
def test_expiry_notifications_expire_the_subscription(env, ntype):
    _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.standard.monthly"))
    t = NOW + timedelta(seconds=5)
    res = _send(env, ntype, subtype="VOLUNTARY", tx=_tx(env, signed=t), signed=t)
    assert res["result"]["status"] == "expired"
    assert _doc(env)["status"] == "expired"
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


@pytest.mark.parametrize("ntype", ["REFUND", "REVOKE"])
def test_refund_and_revoke_strip_the_subscription_whatever_expires_at_says(env, ntype):
    _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.max.annual", expires=NOW + timedelta(days=360)))
    assert _run(get_subscription(UID)).tier == Tier.MAX
    t = NOW + timedelta(seconds=5)
    res = _send(env, ntype, tx=_tx(env, product="sorted.max.annual", signed=t, revocation=t), signed=t)
    assert res["result"]["handled"] and res["result"]["kind"] == "subscription"
    d = _doc(env)
    assert d["status"] == "expired" and d["expires_at"] > NOW + timedelta(days=300)
    assert ("refunded_at" in d) is (ntype == "REFUND") and ("revoked_at" in d) is (ntype == "REVOKE")
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


def test_refund_recomputes_entitlement_back_to_a_live_stripe_subscription(env):
    env["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "stripe", "stripe_subscription_id": "s",
        "tier": "lite", "status": "active", "expires_at": NOW + timedelta(days=20),
    })
    _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.max.monthly"))
    assert _doc(env)["double_subscription"] is True
    assert _run(get_subscription(UID)).tier == Tier.MAX
    t = NOW + timedelta(seconds=5)
    _send(env, "REFUND", tx=_tx(env, product="sorted.max.monthly", signed=t), signed=t)
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.LITE and sub.provider == "stripe"


def test_upgrade_moves_the_tier_and_a_downgrade_waits_for_renewal(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.lite.monthly"))
    t = NOW + timedelta(seconds=5)
    _send(env, "DID_CHANGE_RENEWAL_PREF", subtype="UPGRADE", tx=_tx(env, product="sorted.max.monthly", signed=t), signed=t)
    assert _doc(env)["tier"] == "max"
    t2 = NOW + timedelta(seconds=9)
    res = _send(env, "DID_CHANGE_RENEWAL_PREF", subtype="DOWNGRADE", tx=_tx(env, product="sorted.lite.monthly", signed=t2), signed=t2)
    assert res["result"]["handled"] is False and _doc(env)["tier"] == "max"


def test_one_time_charge_grants_a_penny_pack_once(env):
    tx = _tx(env, product="sorted.penny.100", original="c-1", txid="c-1")
    n = _notification(env, "ONE_TIME_CHARGE", tx=tx, nuuid="n-pack-1")
    first = _run(apple_billing.handle_notification(n))
    again = _run(apple_billing.handle_notification(n))  # Apple's retry
    assert first["result"]["handled"] and first["idempotent"] is False and again["idempotent"] is True
    # A different notification for the same transaction (restore, resend) grants nothing more.
    _run(apple_billing.handle_notification(_notification(env, "ONE_TIME_CHARGE", tx=tx, nuuid="n-pack-2")))
    packs = env["penny_topups_col"].docs
    assert len(packs) == 1 and packs[0]["messages"] == 100 and packs[0]["user_id"] == UID


def _grant_pack(env, product="sorted.penny.200", txid="c-9"):
    _send(env, "ONE_TIME_CHARGE", tx=_tx(env, product=product, original=txid, txid=txid))
    env["penny_topups_col"].docs[0]["remaining"] = 41  # partly spent


def test_consumable_refund_without_clawback_records_and_keeps_the_balance(env):
    _grant_pack(env)
    res = _send(env, "REFUND", tx=_tx(env, product="sorted.penny.200", original="c-9", txid="c-9", revocation=NOW))
    r = res["result"]
    assert r["handled"] and r["kind"] == "pack" and r["clawback"] is False and r["pack_id"] == "large"
    assert r["originalTransactionId"] == "c-9" and r["uid"] == UID  # section 8: the ledger can answer "how many times"
    pack = env["penny_topups_col"].docs[0]
    assert pack["remaining"] == 41 and pack["refunded_at"] and "clawed_back_at" not in pack
    ledger = [d for d in env["billing_events_col"].docs if d["type"] == "REFUND"]
    assert len(ledger) == 1 and ledger[0]["provider"] == "apple" and ledger[0]["result"]["uid"] == UID


def test_consumable_refund_with_clawback_flag_zeroes_the_balance(env, monkeypatch):
    monkeypatch.setattr(config, "IAP_REFUND_CLAWBACK", True)
    _grant_pack(env)
    res = _send(env, "REFUND", tx=_tx(env, product="sorted.penny.200", original="c-9", txid="c-9", revocation=NOW))
    assert res["result"]["clawback"] is True
    pack = env["penny_topups_col"].docs[0]
    assert pack["remaining"] == 0 and pack["clawed_back_at"]


def test_the_clawback_flag_never_changes_the_subscription_refund_path(env, monkeypatch):
    for flag in (False, True):
        monkeypatch.setattr(config, "IAP_REFUND_CLAWBACK", flag)
        env["subscriptions_col"].docs.clear()
        _send(env, "SUBSCRIBED", tx=_tx(env))
        t = NOW + timedelta(seconds=5 + int(flag))
        _send(env, "REFUND", tx=_tx(env, signed=t, revocation=t), signed=t)
        assert _doc(env)["status"] == "expired"


def test_default_clawback_flag_is_off():
    """With IAP_REFUND_CLAWBACK absent from the environment the flag is off:
    the proposal in C13 section 8 (no clawback) stays the behaviour until
    Kevin decides. Read in a clean subprocess so no test's patching leaks in."""
    import os
    import subprocess
    import sys

    env_ = {k: v for k, v in os.environ.items() if k != "IAP_REFUND_CLAWBACK"}
    out = subprocess.run(
        [sys.executable, "-c", "import app.core.config as c; print(c.IAP_REFUND_CLAWBACK, c.APPLE_IAP_ENABLED)"],
        capture_output=True, text=True, env=env_, cwd=os.path.dirname(os.path.dirname(__file__)), timeout=60,
    )
    assert out.stdout.strip().splitlines()[-1] == "False False"


def test_unknown_product_unknown_token_and_unknown_types_change_nothing(env):
    r1 = _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.connect.monthly"))["result"]
    assert r1["handled"] is False and "catalogue" in r1["reason"]
    r2 = _send(env, "SUBSCRIBED", tx=_tx(env, token=str(uuid.uuid4())))["result"]
    assert r2["handled"] is False and "no user" in r2["reason"]
    r3 = _send(env, "SUBSCRIBED", tx=_tx(env, token=None, original="never-seen"))["result"]
    assert r3["handled"] is False
    r4 = _send(env, "PRICE_INCREASE", tx=_tx(env))["result"]
    assert r4["handled"] is False and "unrecognised" in r4["reason"]
    r5 = _send(env, "TEST")["result"]
    assert r5["handled"] is False
    assert env["subscriptions_col"].docs == []


def test_mcp_pack_is_not_a_store_product(env):
    r = _send(env, "ONE_TIME_CHARGE", tx=_tx(env, product="sorted.mcp.1000", original="m", txid="m"))["result"]
    assert r["handled"] is False and env["mcp_call_packs_col"].docs == []


def test_an_out_of_order_expiry_does_not_undo_a_later_renewal(env):
    t_renew = NOW + timedelta(minutes=10)
    _send(env, "DID_RENEW", tx=_tx(env, signed=t_renew), signed=t_renew)
    res = _send(env, "EXPIRED", tx=_tx(env, signed=NOW), signed=NOW)  # older, delivered late
    assert res["result"]["handled"] is False
    assert _doc(env)["status"] == "active"


def test_renewal_for_the_same_subscription_resolves_without_a_token(env):
    _send(env, "SUBSCRIBED", tx=_tx(env))
    t = NOW + timedelta(days=30)
    res = _send(env, "DID_RENEW", tx=_tx(env, token=None, signed=t, expires=t + timedelta(days=30)), signed=t)
    assert res["result"]["handled"] is True and _doc(env)["updated_at"]


# ── Receiver: verification gates ─────────────────────────────────────────────

def test_wrong_bundle_id_is_rejected_and_grants_nothing(env):
    with pytest.raises(apple_jws.AppleVerificationError, match="bundle"):
        _send(env, "SUBSCRIBED", tx=_tx(env), bundle="com.someone.else")
    with pytest.raises(apple_jws.AppleVerificationError, match="bundle"):
        _send(env, "SUBSCRIBED", tx=_tx(env, bundle="com.someone.else"))
    assert env["subscriptions_col"].docs == [] and env["billing_events_col"].docs == []


def test_wrong_environment_is_rejected(env):
    with pytest.raises(apple_jws.AppleVerificationError, match="environment"):
        _send(env, "SUBSCRIBED", tx=_tx(env, environment="Production"), environment="Production")
    with pytest.raises(apple_jws.AppleVerificationError, match="environment"):
        _send(env, "SUBSCRIBED", tx=_tx(env, environment="Production"))  # transaction disagrees with the envelope
    with pytest.raises(apple_jws.AppleVerificationError):
        _send(env, "SUBSCRIBED", tx=_tx(env, environment="Xcode"), environment="Xcode")
    assert env["subscriptions_col"].docs == []


def test_a_production_deployment_accepts_production_only(env, monkeypatch):
    monkeypatch.setattr(config, "APPLE_ALLOWED_ENVIRONMENTS", frozenset({"Production"}))
    with pytest.raises(apple_jws.AppleVerificationError):
        _send(env, "SUBSCRIBED", tx=_tx(env))  # Sandbox
    ok = _send(env, "SUBSCRIBED", tx=_tx(env, environment="Production"), environment="Production")
    assert ok["result"]["handled"]


def test_environment_defaults_follow_app_url():
    assert config._parse_apple_environments("sandbox, production") == frozenset({"Sandbox", "Production"})
    assert config._parse_apple_environments("Xcode,bogus") == frozenset()
    assert config._parse_apple_environments(None) == frozenset()


def test_replayed_notification_uuid_is_applied_once(env):
    n = _notification(env, "SUBSCRIBED", tx=_tx(env), nuuid="same-uuid-1234")
    first = _run(apple_billing.handle_notification(n))
    env["subscriptions_col"].docs[0]["status"] = "expired"  # something changed meanwhile
    second = _run(apple_billing.handle_notification(n))
    assert first["idempotent"] is False and second["idempotent"] is True
    assert env["subscriptions_col"].docs[0]["status"] == "expired"  # not re-applied
    assert len(env["billing_events_col"].docs) == 1
    assert env["billing_events_col"].docs[0]["event_id"] == "apple:same-uuid-1234"


def test_a_forged_notification_does_not_consume_its_uuid(env):
    attacker = Pki("Attacker")
    forged = _notification(env, "SUBSCRIBED", tx=_tx(env), nuuid="victim-uuid-1", pki=attacker)
    with pytest.raises(apple_jws.AppleVerificationError):
        _run(apple_billing.handle_notification(forged))
    assert env["billing_events_col"].docs == []
    genuine = _run(apple_billing.handle_notification(_notification(env, "SUBSCRIBED", tx=_tx(env), nuuid="victim-uuid-1")))
    assert genuine["idempotent"] is False


def test_notifications_without_a_uuid_or_type_are_rejected(env):
    pki = env["pki"]
    for payload in ({"data": {}}, {"notificationType": "SUBSCRIBED"}, {"notificationType": "SUBSCRIBED", "notificationUUID": "x"},
                    {"notificationType": 5, "notificationUUID": "long-enough-uuid"}):
        with pytest.raises(apple_jws.AppleVerificationError):
            _run(apple_billing.handle_notification(pki.sign(payload)))
    with pytest.raises(apple_jws.AppleVerificationError):
        _run(apple_billing.handle_notification(pki.sign({"notificationType": "SUBSCRIBED", "notificationUUID": "long-enough-uuid"})))


def test_disabled_and_unpinned_receivers_fail_closed(env, monkeypatch, tmp_path):
    n = _notification(env, "SUBSCRIBED", tx=_tx(env))
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", False)
    with pytest.raises(apple_billing.AppleNotConfigured):
        _run(apple_billing.handle_notification(n))
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", True)
    monkeypatch.setattr(config, "APPLE_ROOT_CERTS_DIR", tmp_path / "empty")
    with pytest.raises(apple_billing.AppleNotConfigured):
        _run(apple_billing.handle_notification(n))
    assert env["subscriptions_col"].docs == []


# ── Receiver route: status codes, never a 500 for bad input ──────────────────

class _Req:
    def __init__(self, raw: bytes, headers=None):
        self._raw, self.headers = raw, headers or {}

    async def body(self):
        return self._raw


def _post(raw):
    return _run(billing_router.apple_webhook(_Req(raw)))


@pytest.mark.parametrize("raw", [
    b"", b"not json", b"[]", b"null", b"123", b'"x"', b"{}", b'{"signedPayload": 5}', b'{"signedPayload": ""}',
    b'{"signedPayload": null}', b'{"signedPayload": "garbage"}', b'{"signedPayload": "a.b.c"}', b"\xff\xfe\x00",
    b'{"signedPayload": "' + b"A" * 300_000 + b'"}', b'{"signedPayload": {"nested": true}}',
])
def test_malformed_input_is_a_4xx_never_a_500(env, raw):
    with pytest.raises(HTTPException) as exc:
        _post(raw)
    assert 400 <= exc.value.status_code < 500
    assert exc.value.detail in ("Invalid request", "Invalid notification")  # generic, names no check


def test_bad_signature_is_400_with_a_generic_body(env):
    attacker = Pki("Attacker")
    raw = json.dumps({"signedPayload": _notification(env, "SUBSCRIBED", tx=_tx(env), pki=attacker)}).encode()
    with pytest.raises(HTTPException) as exc:
        _post(raw)
    assert exc.value.status_code == 400 and exc.value.detail == "Invalid notification"


def test_valid_notification_is_200_and_replay_is_200_idempotent(env):
    raw = json.dumps({"signedPayload": _notification(env, "SUBSCRIBED", tx=_tx(env), nuuid="route-uuid-1")}).encode()
    assert _post(raw) == {"ok": True, "idempotent": False}
    assert _post(raw) == {"ok": True, "idempotent": True}
    assert _doc(env)["tier"] == "lite"


def test_disabled_receiver_is_503_and_internal_faults_are_a_bare_500(env, monkeypatch, caplog):
    raw = json.dumps({"signedPayload": _notification(env, "SUBSCRIBED", tx=_tx(env))}).encode()
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", False)
    with pytest.raises(HTTPException) as exc:
        _post(raw)
    assert exc.value.status_code == 503
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", True)

    async def boom(*a, **k):
        raise RuntimeError(f"db exploded for {UID}")

    monkeypatch.setattr(apple_billing, "_dispatch", boom)
    caplog.set_level("INFO")
    with pytest.raises(HTTPException) as exc:
        _post(raw)
    assert exc.value.status_code == 500 and exc.value.detail == "Error"
    assert UID not in caplog.text and "exploded" not in caplog.text  # no user data, no exception text


def test_a_failed_attempt_is_retried_not_lost(env, monkeypatch):
    n = _notification(env, "SUBSCRIBED", tx=_tx(env), nuuid="retry-uuid-1")
    real = apple_billing._dispatch

    async def boom(*a, **k):
        raise RuntimeError("transient")

    monkeypatch.setattr(apple_billing, "_dispatch", boom)
    with pytest.raises(RuntimeError):
        _run(apple_billing.handle_notification(n))
    monkeypatch.setattr(apple_billing, "_dispatch", real)
    res = _run(apple_billing.handle_notification(n))
    assert res["idempotent"] is False and _doc(env)["tier"] == "lite"


def test_processing_logs_carry_no_user_data(env, caplog):
    caplog.set_level("DEBUG")
    _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.max.monthly"))
    _send(env, "ONE_TIME_CHARGE", tx=_tx(env, product="sorted.penny.20", original="p", txid="p"))
    token = _token(env)
    assert UID not in caplog.text and token not in caplog.text and "example.com" not in caplog.text


# ── Signed transaction verification: purchase and restore ────────────────────

def _verify(env, signed, uid=UID):
    return _run(apple_billing.verify_signed_transaction(uid, signed))


def test_purchase_verification_grants_the_subscription(env):
    res = _verify(env, _signed_tx(env, product="sorted.standard.six_months"))
    assert res["handled"] and res["tier"] == "standard"
    d = _doc(env)
    assert d["billing_period"] == "six_months" and d["provider_subscription_id"] == "orig-1"


def test_restore_is_idempotent(env):
    signed = _signed_tx(env, original="orig-r")
    _verify(env, signed)
    snapshot = dict(_doc(env))
    _verify(env, signed)
    again = _doc(env)
    assert len(env["subscriptions_col"].docs) == 1
    assert {k: again[k] for k in ("tier", "status", "expires_at", "provider_subscription_id")} == \
        {k: snapshot[k] for k in ("tier", "status", "expires_at", "provider_subscription_id")}


def test_restore_of_an_older_period_never_moves_state_backwards(env):
    _verify(env, _signed_tx(env, original="o", expires=NOW + timedelta(days=60), signed=NOW))
    old = _signed_tx(env, original="o", expires=NOW - timedelta(days=5), signed=NOW + timedelta(seconds=30))
    res = _verify(env, old)
    assert res.get("unchanged") is True
    d = _doc(env)
    assert d["status"] == "active" and d["expires_at"] > NOW + timedelta(days=30)


def test_restore_of_a_lapsed_subscription_lands_expired(env):
    _verify(env, _signed_tx(env, original="gone", expires=NOW - timedelta(days=2)))
    assert _doc(env)["status"] == "expired"
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


def test_transaction_for_another_account_is_refused(env):
    theirs = _signed_tx(env, uid=OTHER, original="theirs")
    with pytest.raises(apple_billing.AppleAccountMismatch):
        _verify(env, theirs, uid=UID)
    assert env["subscriptions_col"].docs == []
    no_token = _signed_tx(env, token=None, original="anon")
    with pytest.raises(apple_billing.AppleAccountMismatch):
        _verify(env, no_token)
    stranger = _signed_tx(env, token=str(uuid.uuid4()), original="unknown-token")
    with pytest.raises(apple_billing.AppleAccountMismatch):
        _verify(env, stranger)


def test_tokenless_transaction_is_accepted_only_for_a_subscription_the_user_already_holds(env):
    _verify(env, _signed_tx(env, original="held"))
    res = _verify(env, _signed_tx(env, token=None, original="held", expires=NOW + timedelta(days=90)))
    assert res["handled"]


def test_verification_rejects_wrong_bundle_environment_and_forgery(env):
    for kw in ({"bundle": "com.x.y"}, {"environment": "Production"}):
        with pytest.raises(apple_jws.AppleVerificationError):
            _verify(env, _signed_tx(env, **kw))
    attacker = Pki("Attacker")
    with pytest.raises(apple_jws.AppleVerificationError):
        _verify(env, attacker.sign(_tx(env)))
    with pytest.raises(apple_jws.AppleVerificationError):
        _verify(env, "garbage")
    assert env["subscriptions_col"].docs == []


def test_verification_of_a_consumable_is_granted_once(env):
    signed = _signed_tx(env, product="sorted.penny.20", original="k1", txid="k1")
    _verify(env, signed)
    _verify(env, signed)
    assert len(env["penny_topups_col"].docs) == 1 and env["penny_topups_col"].docs[0]["messages"] == 20


def test_verification_of_a_refunded_consumable_grants_nothing(env):
    res = _verify(env, _signed_tx(env, product="sorted.penny.20", original="k2", txid="k2", revocation=NOW))
    assert res["handled"] is False and env["penny_topups_col"].docs == []


def test_unknown_product_verifies_but_grants_nothing(env):
    res = _verify(env, _signed_tx(env, product="sorted.connect.annual"))
    assert res["handled"] is False and env["subscriptions_col"].docs == []


def test_purchase_while_stripe_is_live_is_granted_and_flagged(env):
    env["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "stripe", "stripe_subscription_id": "s",
        "tier": "standard", "status": "active", "expires_at": NOW + timedelta(days=9),
    })
    res = _verify(env, _signed_tx(env, product="sorted.max.monthly"))
    assert res["handled"] and _doc(env)["double_subscription"] is True
    assert _doc(env, "stripe")["status"] == "active"  # untouched


def test_verify_route_maps_failures_to_statuses(env, monkeypatch):
    ok = _run(billing_router.apple_verify({"signed_transaction": _signed_tx(env)}, {"email": UID}))
    assert ok["ok"] and ok["tier"] == "lite" and "uid" not in ok
    cases = [
        ({"signed_transaction": _signed_tx(env, uid=OTHER)}, 403),
        ({"signed_transaction": "garbage"}, 400),
        ({"signed_transaction": ""}, 400),
        ({}, 400),
        ({"signed_transaction": 5}, 400),
    ]
    for body, status in cases:
        with pytest.raises(HTTPException) as exc:
            _run(billing_router.apple_verify(body, {"email": UID}))
        assert exc.value.status_code == status, body
    monkeypatch.setattr(config, "APPLE_IAP_ENABLED", False)
    with pytest.raises(HTTPException) as exc:
        _run(billing_router.apple_verify({"signed_transaction": _signed_tx(env)}, {"email": UID}))
    assert exc.value.status_code == 503


# ── B31 backstop stays in force with IAP live ────────────────────────────────

def test_stripe_checkout_and_portal_still_refuse_a_native_ios_client(env):
    req = _Req(b"", {"x-client-platform": "ios"})
    with pytest.raises(HTTPException) as exc:
        _run(billing_router.create_checkout({"kind": "subscription", "target": "lite"}, req, {"email": UID}))
    assert exc.value.status_code == 403 and exc.value.detail["code"] == "BILLING_NATIVE_BLOCKED"
    with pytest.raises(HTTPException) as exc:
        _run(billing_router.create_portal({}, req, {"email": UID}))
    assert exc.value.status_code == 403


def test_restore_of_a_different_older_or_lapsed_subscription_never_replaces_a_live_one(env):
    _verify(env, _signed_tx(env, original="live", product="sorted.max.monthly", expires=NOW + timedelta(days=60)))
    older = _signed_tx(env, original="other-1", expires=NOW + timedelta(days=10))
    lapsed = _signed_tx(env, original="other-2", expires=NOW - timedelta(days=3))
    for tx in (older, lapsed):
        assert _verify(env, tx).get("unchanged") is True
    d = _doc(env)
    assert d["provider_subscription_id"] == "live" and d["tier"] == "max" and d["status"] == "active"
    newer = _signed_tx(env, original="other-3", product="sorted.standard.annual", expires=NOW + timedelta(days=300))
    _verify(env, newer)
    assert _doc(env)["provider_subscription_id"] == "other-3"


def test_restore_replaces_a_lapsed_document_with_a_live_one(env):
    _verify(env, _signed_tx(env, original="old", expires=NOW - timedelta(days=9)))
    _verify(env, _signed_tx(env, original="new", expires=NOW + timedelta(days=20)))
    assert _doc(env)["provider_subscription_id"] == "new" and _doc(env)["status"] == "active"


def test_webhook_rejects_an_oversized_declared_length_before_reading(env):
    class Req:
        headers = {"content-length": str(10_000_000)}

        async def body(self):
            raise AssertionError("body must not be read")

    with pytest.raises(HTTPException) as exc:
        _run(billing_router.apple_webhook(Req()))
    assert exc.value.status_code == 400
