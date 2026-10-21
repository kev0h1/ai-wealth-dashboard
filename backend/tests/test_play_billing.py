"""C24: Google Play Billing receiver, verification and client endpoints.

Everything Google is faked: PlayApi and the OIDC verifier are replaced via
google_play.set_play_api / set_oidc_verifier, so no test touches the network.
Collections are the in-memory FakeCol (tests/fake_cols.py); no database is
used. The fake API returns plain dicts because that is exactly what the real
HttpPlayApi returns (parsed JSON), so there is no SDK-object trap here (cf.
the B33 lesson in docs/pricing/store-billing-c13.md section 11); the HTTP
client itself is covered separately with httpx.MockTransport.
"""
import asyncio
import base64
import json
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import app.core.config as config_module
import app.db.collections as collections_module
import app.services.billing_lifecycle as lifecycle
from app.core import play_config
from app.core.auth import current_user
from app.core.subscription import Tier, get_subscription
from app.routers import play_billing as router_module
from app.services import google_play, play_billing
from app.services.google_play import OidcRejected, PlayApiError
from tests.fake_cols import FakeCol

UID = "playuser@example.com"
OTHER = "someoneelse@example.com"
PKG = "co.uk.auriqltd.sorted"
SALT = "test-salt-not-a-secret"
NOW = datetime.now(timezone.utc)
SUB_STATE = "SUBSCRIPTION_STATE_"


def _run(coro):
    return asyncio.run(coro)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.123456789Z")


class FakeApi:
    """Records every call; replies are whatever the test put in."""

    def __init__(self):
        self.subs: dict[str, dict] = {}
        self.products: dict[str, dict] = {}
        self.voided: list[dict] = []
        self.calls: list[tuple] = []
        self.errors: dict[str, PlayApiError] = {}
        self.ack_error: PlayApiError | None = None
        self.consume_error: PlayApiError | None = None

    def _count(self, name):
        return len([c for c in self.calls if c[0] == name])

    async def get_subscription_v2(self, package, token):
        self.calls.append(("get_sub", package, token))
        await asyncio.sleep(0)
        if token in self.errors:
            raise self.errors[token]
        return json.loads(json.dumps(self.subs[token]))

    async def get_product(self, package, product_id, token):
        self.calls.append(("get_product", package, product_id, token))
        await asyncio.sleep(0)  # let a concurrent caller interleave
        if token in self.errors:
            raise self.errors[token]
        return json.loads(json.dumps(self.products[token]))

    async def acknowledge_subscription(self, package, product_id, token):
        self.calls.append(("ack", package, product_id, token))
        if self.ack_error:
            raise self.ack_error
        self.subs[token]["acknowledgementState"] = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"

    async def consume_product(self, package, product_id, token):
        self.calls.append(("consume", package, product_id, token))
        if self.consume_error:
            raise self.consume_error
        self.products[token]["consumptionState"] = 1

    async def list_voided(self, package, *, start_time_ms=None, page_token=None):
        self.calls.append(("voided", package))
        return {"voidedPurchases": self.voided}


class FakeOidc:
    def __init__(self, ok=True):
        self.ok = ok
        self.seen = []

    async def verify(self, bearer_token, *, audience, email):
        self.seen.append((bearer_token, audience, email))
        if not self.ok:
            raise OidcRejected("nope")


def account_id(uid=UID):
    return play_billing.account_id_for(uid)


def sub_payload(
    product="sorted.standard.monthly", state="ACTIVE", *, expiry_days=30, acct=None, offer=None, ack=False,
    test=False, linked=None, start_days_ago=1, auto_renew=True, order="GPA.1111-2222-3333-44444",
):
    body = {
        "subscriptionState": SUB_STATE + state,
        "startTime": _iso(NOW - timedelta(days=start_days_ago)),
        "latestOrderId": order,
        "lineItems": [{
            "productId": product,
            "expiryTime": _iso(NOW + timedelta(days=expiry_days)),
            "autoRenewingPlan": {"autoRenewEnabled": auto_renew},
            "offerDetails": {"basePlanId": "base", **({"offerId": offer} if offer else {})},
        }],
        "acknowledgementState": "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" if ack else "ACKNOWLEDGEMENT_STATE_PENDING",
        "externalAccountIdentifiers": {"obfuscatedExternalAccountId": acct if acct is not None else account_id()},
    }
    if test:
        body["testPurchase"] = {}
    if linked:
        body["linkedPurchaseToken"] = linked
    return body


def pack_payload(state=0, consumption=0, acct=None, order="GPA.9999-8888-7777-66666", ptype=None, product="sorted.penny.100"):
    body = {
        "purchaseState": state, "consumptionState": consumption, "orderId": order, "productId": product,
        "obfuscatedExternalAccountId": acct if acct is not None else account_id(),
    }
    if ptype is not None:
        body["purchaseType"] = ptype
    return body


T1 = "token-standard-monthly-0000001"
T2 = "token-standard-monthly-0000002"
TPACK = "token-penny-medium-0000001"


@pytest.fixture
def env(monkeypatch):
    cols = {
        "subscriptions_col": FakeCol(unique=(("user_id", "provider"),)),
        "billing_events_col": FakeCol(unique=(("event_id",),)),
        "penny_topups_col": FakeCol(),
        "mcp_call_packs_col": FakeCol(),
        "play_purchases_col": FakeCol(unique=(("purchase_token",),)),
        "play_account_ids_col": FakeCol(unique=(("user_id",), ("account_id",))),
    }
    for name, col in cols.items():
        monkeypatch.setattr(collections_module, name, col)
    monkeypatch.setattr(play_config, "PLAY_IAP_ENABLED", True)
    monkeypatch.setattr(play_config, "PLAY_ACCOUNT_ID_SALT", SALT)
    monkeypatch.setattr(play_config, "PLAY_PACKAGE_NAME", PKG)
    monkeypatch.setattr(play_config, "PLAY_PRODUCT_IDS", {})
    monkeypatch.setattr(play_config, "PLAY_ALLOW_TEST_PURCHASES", False)
    monkeypatch.setattr(play_config, "PLAY_TRIAL_OFFER_ID", "free-trial")
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_AUDIENCE", "https://api.example/webhooks/google-play")
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_EMAIL", "push@proj.iam.gserviceaccount.com")
    monkeypatch.setattr(play_config, "PLAY_RTDN_SHARED_SECRET", "")
    monkeypatch.setattr(google_play, "service_account_configured", lambda: True)
    monkeypatch.setattr(config_module, "IAP_REFUND_CLAWBACK", False)
    pushes = []

    async def fake_notify(uid, title, body, url="/settings"):
        pushes.append((title, body))
        return True

    async def fake_landed(uid):
        return {"revoke": "off"}

    monkeypatch.setattr(lifecycle, "notify", fake_notify)
    monkeypatch.setattr(lifecycle, "on_landed_on_statements", fake_landed)
    api, oidc = FakeApi(), FakeOidc()
    google_play.set_play_api(api)
    google_play.set_oidc_verifier(oidc)
    # Both UIDs have an account id minted, as they would after /billing/play/config.
    for uid in (UID, OTHER):
        _run(play_billing.get_or_create_account_id(uid))
    yield type("Env", (), {"cols": cols, "api": api, "oidc": oidc, "pushes": pushes})
    google_play.set_play_api(None)
    google_play.set_oidc_verifier(None)


def push_body(notification: dict, message_id="m-1"):
    notification = {"version": "1.0", "packageName": PKG, "eventTimeMillis": "1700000000000", **notification}
    data = base64.b64encode(json.dumps(notification).encode()).decode()
    return {"message": {"data": data, "messageId": message_id}, "subscription": "projects/p/subscriptions/s"}


def sub_note(token, ntype=2, sku="sorted.standard.monthly"):
    return {"subscriptionNotification": {"version": "1.0", "notificationType": ntype, "purchaseToken": token, "subscriptionId": sku}}


def sub_doc(env, provider="google"):
    return next((d for d in env.cols["subscriptions_col"].docs if d.get("provider") == provider), None)


# ── HTTP surface ─────────────────────────────────────────────────────────────

@pytest.fixture
def client(env):
    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[current_user] = lambda: {"email": UID}
    return TestClient(app, raise_server_exceptions=False)


AUTH = {"Authorization": "Bearer abc.def.ghi"}


def test_push_with_valid_oidc_is_accepted_and_applied(env, client):
    env.api.subs[T1] = sub_payload()
    resp = client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH)
    assert resp.status_code == 200 and resp.json()["ok"] is True
    assert env.oidc.seen == [("abc.def.ghi", "https://api.example/webhooks/google-play", "push@proj.iam.gserviceaccount.com")]
    assert sub_doc(env)["status"] == "active" and sub_doc(env)["tier"] == "standard"


def test_push_with_rejected_oidc_is_401_and_nothing_is_read_or_written(env, client):
    env.oidc.ok = False
    env.api.subs[T1] = sub_payload()
    resp = client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH)
    assert resp.status_code == 401
    assert env.api.calls == [] and sub_doc(env) is None


def test_push_without_bearer_is_401(env, client):
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1))).status_code == 401
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers={"Authorization": "Basic abc"}).status_code == 401
    assert env.oidc.seen == []


def test_push_503_when_play_off_or_no_auth_configured(env, client, monkeypatch):
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_AUDIENCE", "")
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_EMAIL", "")
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH).status_code == 503
    # A half-configured OIDC (audience without the push identity) is not a usable mode either.
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_AUDIENCE", "aud")
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH).status_code == 503
    monkeypatch.setattr(play_config, "PLAY_IAP_ENABLED", False)
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH).status_code == 503


def test_shared_secret_mode(env, client, monkeypatch):
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_AUDIENCE", "")
    monkeypatch.setattr(play_config, "PLAY_RTDN_OIDC_EMAIL", "")
    monkeypatch.setattr(play_config, "PLAY_RTDN_SHARED_SECRET", "s3cret-value")
    env.api.subs[T1] = sub_payload()
    body = push_body(sub_note(T1))
    assert client.post("/webhooks/google-play", json=body).status_code == 401
    assert client.post("/webhooks/google-play?token=wrong", json=body).status_code == 401
    assert client.post("/webhooks/google-play?token=s3cret-value", json=body).status_code == 200
    assert sub_doc(env)["status"] == "active"


def test_oidc_claim_checks():
    google_play.check_oidc_claims(
        {"iss": "https://accounts.google.com", "email": "Push@x.iam", "email_verified": True}, email="push@x.iam")
    for claims in (
        {"iss": "https://evil.example", "email": "push@x.iam", "email_verified": True},
        {"iss": "accounts.google.com", "email": "other@x.iam", "email_verified": True},
        {"iss": "accounts.google.com", "email": "push@x.iam", "email_verified": False},
        {"iss": "accounts.google.com"},
    ):
        with pytest.raises(OidcRejected):
            google_play.check_oidc_claims(claims, email="push@x.iam")


@pytest.mark.parametrize("body,raw", [
    ({}, None), ({"message": "x"}, None), ({"message": {}}, None), ({"message": {"messageId": "1", "data": "%%%"}}, None),
    ({"message": {"messageId": "1", "data": base64.b64encode(b"not json").decode()}}, None),
    ({"message": {"messageId": "1", "data": base64.b64encode(b"[1,2]").decode()}}, None),
    ({"message": {"messageId": 5, "data": "e30="}}, None),
    (None, b"{not json"), (None, b"[]"), (None, b"null"), (None, b"x" * 70000),
])
def test_malformed_push_is_4xx_never_500(env, client, body, raw):
    kwargs = {"content": raw} if raw is not None else {"json": body}
    resp = client.post("/webhooks/google-play", headers=AUTH, **kwargs)
    assert 400 <= resp.status_code < 500, resp.text
    assert "Traceback" not in resp.text


def test_wrong_package_is_400(env, client):
    body = push_body({**sub_note(T1), "packageName": "com.someone.else"})
    assert client.post("/webhooks/google-play", json=body, headers=AUTH).status_code == 400
    assert env.api.calls == []


def test_malformed_notification_contents_are_acked_not_500(env, client):
    # Valid envelope, garbage inside: refused and recorded, 200 so Pub/Sub stops, nothing granted.
    for i, note in enumerate((
        {"subscriptionNotification": {"purchaseToken": "short"}},
        {"subscriptionNotification": {"purchaseToken": 12345}},
        {"subscriptionNotification": {"purchaseToken": "../../etc/passwd/aaaaaaaa"}},
        {"oneTimeProductNotification": {"notificationType": 1, "purchaseToken": TPACK, "sku": "x/../y"}},
        {"voidedPurchaseNotification": {"purchaseToken": None}},
        {"somethingNew": {}},
    )):
        resp = client.post("/webhooks/google-play", json=push_body(note, f"bad-{i}"), headers=AUTH)
        assert resp.status_code == 200, (note, resp.text)
    assert env.api.calls == [] and sub_doc(env) is None


def test_transient_api_failure_is_503_and_redelivery_succeeds(env, client):
    env.api.subs[T1] = sub_payload()
    env.api.errors[T1] = PlayApiError(503)
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1), "m-retry"), headers=AUTH).status_code == 503
    assert sub_doc(env) is None
    del env.api.errors[T1]
    assert client.post("/webhooks/google-play", json=push_body(sub_note(T1), "m-retry"), headers=AUTH).status_code == 200
    assert sub_doc(env)["status"] == "active"


def test_unexpected_error_is_503_without_detail(env, client, monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("secret internal detail")
    monkeypatch.setattr(play_billing, "handle_notification", boom)
    resp = client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH)
    assert resp.status_code == 503 and "secret internal detail" not in resp.text


def test_permanent_api_error_is_acked(env, client):
    env.api.errors[T1] = PlayApiError(410)
    resp = client.post("/webhooks/google-play", json=push_body(sub_note(T1)), headers=AUTH)
    assert resp.status_code == 200 and sub_doc(env) is None


# ── Notification types and state mapping ─────────────────────────────────────

@pytest.mark.parametrize("ntype", [1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13])
def test_every_subscription_notification_type_rereads_the_purchase(env, client, ntype):
    env.api.subs[T1] = sub_payload()
    resp = client.post("/webhooks/google-play", json=push_body(sub_note(T1, ntype), f"t{ntype}"), headers=AUTH)
    assert resp.status_code == 200
    assert env.api._count("get_sub") >= 1
    assert sub_doc(env)["status"] == "active"


def test_active_maps_tier_period_expiry_and_provider(env):
    env.api.subs[T1] = sub_payload("sorted.plus.annual", expiry_days=300)
    result = _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert (doc["tier"], doc["billing_period"], doc["status"], doc["provider"], doc["source"]) == ("plus", "annual", "active", "google", "google")
    assert doc["expires_at"] > NOW + timedelta(days=299)
    assert result["acknowledged"] is True
    assert doc["provider_subscription_id"] != T1 and len(doc["provider_subscription_id"]) == 64
    assert _run(get_subscription(UID)).tier == Tier.PLUS


def test_free_trial_offer_is_trialing_with_a_trial_end(env):
    env.api.subs[T1] = sub_payload("sorted.lite.monthly", offer="free-trial", start_days_ago=0, expiry_days=14)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "trialing" and doc["trial_ends_at"] is not None
    assert doc["tier"] == "lite" and doc.get("trial_used_at") is not None


def _trial_sub(*, expiry, offer="free-trial", start_days_ago=0, tags=None, with_offer=True, product="sorted.lite.monthly"):
    body = sub_payload(product, start_days_ago=start_days_ago, offer=offer if with_offer else None)
    line = body["lineItems"][0]
    line["expiryTime"] = _iso(NOW + expiry)
    if not with_offer:
        line.pop("offerDetails")
    elif tags is not None:
        line["offerDetails"]["offerTags"] = tags
    return body


def test_three_minute_tester_trial_is_trialing_and_ends_at_expiry(env):
    env.api.subs[T1] = _trial_sub(expiry=timedelta(minutes=3))
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "trialing"
    assert abs((doc["trial_ends_at"] - (NOW + timedelta(minutes=3))).total_seconds()) < 2


def test_renewal_order_suffix_with_offer_is_active_and_clears_trial_end(env):
    body = _trial_sub(expiry=timedelta(minutes=3))
    body["latestOrderId"] = "GPA.1111-2222-3333-44444..0"
    env.api.subs[T1] = body
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "active" and doc.get("trial_ends_at") is None


def test_first_cycle_order_id_with_offer_is_trialing(env):
    body = _trial_sub(expiry=timedelta(minutes=3))
    body["latestOrderId"] = "GPA.1111-2222-3333-44444"
    env.api.subs[T1] = body
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "trialing"


def test_missing_order_id_fails_open_to_the_offer(env, caplog):
    # With no latestOrderId the renewal suffix cannot be read, so the offer
    # alone decides (trialing), and the reason says so.
    body = _trial_sub(expiry=timedelta(minutes=3))
    body.pop("latestOrderId")
    env.api.subs[T1] = body
    with caplog.at_level(logging.INFO, logger=play_billing.logger.name):
        _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "trialing"
    assert any("trial_reason=offer_id_match_no_order_id" in r.getMessage() for r in caplog.records)


def test_missing_order_id_past_the_window_is_active(env, caplog):
    body = _trial_sub(expiry=timedelta(days=10), start_days_ago=60)
    body.pop("latestOrderId")
    env.api.subs[T1] = body
    with caplog.at_level(logging.INFO, logger=play_billing.logger.name):
        _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "active" and doc.get("trial_ends_at") is None
    assert any("trial_reason=no_order_id_past_window" in r.getMessage() for r in caplog.records)


def test_fourteen_day_trial_is_trialing(env):
    env.api.subs[T1] = _trial_sub(expiry=timedelta(days=14))
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "trialing"


def test_missing_offer_details_is_active_with_no_trial_end(env):
    env.api.subs[T1] = _trial_sub(expiry=timedelta(days=30), with_offer=False)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "active" and doc.get("trial_ends_at") is None


def test_different_offer_is_active(env):
    env.api.subs[T1] = _trial_sub(expiry=timedelta(days=30), offer="intro-discount")
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "active"


def test_offer_tag_match_is_trialing(env):
    env.api.subs[T1] = _trial_sub(expiry=timedelta(minutes=3), offer=None, tags=["free-trial"])
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "trialing"


def test_renewal_after_trial_without_offer_clears_trial_end(env):
    # Contract: the mapper recomputes from the latest read, so a renewal with
    # no offerDetails goes active and trial_ends_at is cleared (not kept).
    env.api.subs[T1] = _trial_sub(expiry=timedelta(minutes=3))
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "trialing"
    env.api.subs[T1] = _trial_sub(expiry=timedelta(minutes=8), with_offer=False)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "active" and doc.get("trial_ends_at") is None


def test_trial_offer_long_after_start_is_still_trialing_but_warns(env, caplog):
    env.api.subs[T1] = sub_payload("sorted.lite.monthly", offer="free-trial", start_days_ago=60, expiry_days=10)
    with caplog.at_level(logging.INFO, logger=play_billing.logger.name):
        _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "trialing"
    assert any(r.levelno == logging.WARNING and "still treated as trialing" in r.getMessage() for r in caplog.records)


def test_verified_purchase_log_line_has_offer_fields_and_no_identifiers(env, caplog):
    env.api.subs[T1] = _trial_sub(expiry=timedelta(minutes=3), tags=["promo"])
    with caplog.at_level(logging.INFO, logger=play_billing.logger.name):
        _run(play_billing.process_subscription(T1))
    lines = [r.getMessage() for r in caplog.records if "verified subscription" in r.getMessage()]
    assert len(lines) == 1
    line = lines[0]
    for expect in ("product=sorted.lite.monthly", "offer_id=free-trial", "offer_tags=['promo']", "base_plan=base",
                   "trialing=True", "trial_reason=offer_id_match", "expiry="):
        assert expect in line
    assert T1 not in line and account_id() not in line and "GPA." not in line
    assert "@" not in line and UID not in line


def test_cancelled_but_unexpired_keeps_access_and_flags_cancel(env):
    env.api.subs[T1] = sub_payload(state="CANCELED", expiry_days=12, auto_renew=False)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "active" and doc["cancel_at_period_end"] is True
    assert _run(get_subscription(UID)).tier == Tier.STANDARD


def test_cancelled_and_past_expiry_is_expired(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state="CANCELED", expiry_days=-1)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "expired"
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


def test_grace_period_is_past_due_until_the_grace_end(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state="IN_GRACE_PERIOD", expiry_days=5)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "past_due" and doc["grace_until"] > NOW + timedelta(days=4)
    assert len(env.pushes) == 1  # the failed-renewal push, once, naming Google Play
    assert "Google Play" in env.pushes[0][1]
    assert _run(get_subscription(UID)).tier == Tier.STANDARD
    # Recovery: back to active, grace cleared.
    env.api.subs[T1] = sub_payload(expiry_days=30)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert doc["status"] == "active" and "grace_until" not in doc


def test_first_sight_already_in_grace_creates_a_past_due_document(env):
    env.api.subs[T1] = sub_payload(state="IN_GRACE_PERIOD", expiry_days=4)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "past_due"


@pytest.mark.parametrize("state", ["ON_HOLD", "PAUSED", "EXPIRED"])
def test_hold_pause_and_expiry_remove_entitlement(env, state):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state=state, expiry_days=-2)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "expired"
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


def test_account_hold_then_recovered_restores_access(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state="ON_HOLD", expiry_days=-1)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "expired"
    env.api.subs[T1] = sub_payload(expiry_days=30)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "active"


def test_pending_purchase_grants_and_acknowledges_nothing(env):
    env.api.subs[T1] = sub_payload(state="PENDING")
    result = _run(play_billing.process_subscription(T1))
    assert sub_doc(env) is None and env.api._count("ack") == 0 and result["handled"] is False


def test_unknown_state_fails_closed(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    body = sub_payload()
    body["subscriptionState"] = "SUBSCRIPTION_STATE_SOMETHING_NEW"
    env.api.subs[T1] = body
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "expired"


def test_unknown_product_is_refused_and_unacknowledged(env):
    env.api.subs[T1] = sub_payload("sorted.connect.monthly")
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T1))
    env.api.subs[T2] = sub_payload("com.other.app.pro")
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T2))
    assert env.api._count("ack") == 0 and sub_doc(env) is None


def test_product_ids_come_from_config_overrides(env, monkeypatch):
    monkeypatch.setattr(play_config, "PLAY_PRODUCT_IDS", {"lite_annual": "custom.lite.year"})
    env.api.subs[T1] = sub_payload("custom.lite.year", expiry_days=300)
    _run(play_billing.process_subscription(T1))
    assert (sub_doc(env)["tier"], sub_doc(env)["billing_period"]) == ("lite", "annual")
    assert play_billing.client_product_ids()["lite_annual"] == "custom.lite.year"
    env.api.subs[T2] = sub_payload("sorted.lite.annual")  # the default id is no longer sold
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T2))


def test_client_product_ids_exclude_legacy_max_aliases():
    # C33: the sorted.max.* aliases share the plus keys and used to overwrite
    # the real Plus ids sent to the app, so Plus showed "Price unavailable".
    ids = play_billing.client_product_ids()
    assert ids["plus"] == "sorted.plus.monthly"
    assert ids["plus_six_months"] == "sorted.plus.six_months"
    assert ids["plus_annual"] == "sorted.plus.annual"
    assert not any(v.startswith("sorted.max.") for v in ids.values())
    # The aliases still resolve when a purchase names one.
    assert "sorted.max.monthly" in play_billing.catalogue()


def test_client_config_products_match_client_product_ids(env, client):
    cfg = client.get("/billing/play/config").json()
    assert cfg["products"] == play_billing.client_product_ids()
    assert cfg["products"]["plus"] == "sorted.plus.monthly"
    assert not any(v.startswith("sorted.max.") for v in cfg["products"].values())


def test_test_purchase_refused_on_production_allowed_on_uat(env, monkeypatch):
    env.api.subs[T1] = sub_payload(test=True)
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T1))
    assert sub_doc(env) is None and env.api._count("ack") == 0
    monkeypatch.setattr(play_config, "PLAY_ALLOW_TEST_PURCHASES", True)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "active"


# ── Dedupe, acknowledgement ──────────────────────────────────────────────────

def test_replayed_pubsub_message_is_a_noop(env, client):
    env.api.subs[T1] = sub_payload()
    body = push_body(sub_note(T1), "same-message")
    assert client.post("/webhooks/google-play", json=body, headers=AUTH).status_code == 200
    n = len(env.api.calls)
    again = client.post("/webhooks/google-play", json=body, headers=AUTH)
    assert again.status_code == 200 and again.json()["idempotent"] is True
    assert len(env.api.calls) == n


def test_purchase_token_is_deduplicated_across_messages(env, client):
    env.api.subs[T1] = sub_payload()
    for i in range(3):
        assert client.post("/webhooks/google-play", json=push_body(sub_note(T1), f"msg-{i}"), headers=AUTH).status_code == 200
    assert len(env.cols["play_purchases_col"].docs) == 1
    assert len(env.cols["subscriptions_col"].docs) == 1
    assert env.api._count("ack") == 1


def test_acknowledgement_is_idempotent(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    _run(play_billing.process_subscription(T1))
    _run(play_billing.process_subscription(T1))
    assert env.api._count("ack") == 1
    assert env.cols["play_purchases_col"].docs[0]["acknowledged_at"] is not None


def test_already_acknowledged_purchase_is_not_acknowledged_again(env):
    env.api.subs[T1] = sub_payload(ack=True)
    _run(play_billing.process_subscription(T1))
    assert env.api._count("ack") == 0
    assert env.cols["play_purchases_col"].docs[0]["acknowledged_at"] is not None


def test_failed_acknowledge_is_retryable_and_second_attempt_succeeds(env):
    env.api.subs[T1] = sub_payload()
    env.api.ack_error = PlayApiError(500)
    with pytest.raises(play_billing.PlayUnavailable):
        _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "active"  # granted; the ack is the thing that retries
    env.api.ack_error = None
    _run(play_billing.process_subscription(T1))
    assert env.cols["play_purchases_col"].docs[0]["acknowledged_at"] is not None


def test_acknowledge_rejected_because_already_acknowledged_elsewhere_counts_as_done(env):
    env.api.subs[T1] = sub_payload()

    async def racing_ack(package, product_id, token):
        env.api.subs[token]["acknowledgementState"] = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
        raise PlayApiError(400)
    env.api.acknowledge_subscription = racing_ack
    _run(play_billing.process_subscription(T1))
    assert env.cols["play_purchases_col"].docs[0]["acknowledged_at"] is not None


# ── Account mapping ──────────────────────────────────────────────────────────

def test_account_id_is_salted_hash_not_the_email(env):
    aid = account_id()
    assert len(aid) == 64 and UID not in aid and aid == account_id()
    assert account_id(OTHER) != aid
    assert _run(play_billing.get_or_create_account_id(UID)) == aid
    assert len([d for d in env.cols["play_account_ids_col"].docs if d["user_id"] == UID]) == 1


def test_account_id_needs_a_salt(env, monkeypatch):
    monkeypatch.setattr(play_config, "PLAY_ACCOUNT_ID_SALT", "")
    with pytest.raises(play_billing.PlayNotEnabled):
        play_billing.account_id_for(UID)
    assert play_billing.play_enabled() is False


def test_unmapped_account_is_refused_and_not_acknowledged(env):
    env.api.subs[T1] = sub_payload(acct="f" * 64)
    with pytest.raises(play_billing.PlayRefused) as exc:
        _run(play_billing.process_subscription(T1))
    assert exc.value.code == "unmapped_account"
    env.api.subs[T2] = sub_payload()
    del env.api.subs[T2]["externalAccountIdentifiers"]
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T2))
    assert sub_doc(env) is None and env.api._count("ack") == 0


def test_client_verifying_someone_elses_purchase_is_rejected(env):
    env.api.subs[T1] = sub_payload(acct=account_id(OTHER))
    with pytest.raises(play_billing.PlayRefused) as exc:
        _run(play_billing.verify_client_purchase(UID, T1, "sorted.standard.monthly"))
    assert exc.value.code == "account_mismatch"
    assert sub_doc(env) is None and env.api._count("ack") == 0
    assert env.cols["play_purchases_col"].docs == []


def test_pack_account_mismatch_is_rejected(env):
    env.api.products[TPACK] = pack_payload(acct=account_id(OTHER))
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.verify_client_purchase(UID, TPACK, "sorted.penny.100"))
    assert env.cols["penny_topups_col"].docs == [] and env.api._count("consume") == 0


def test_token_already_stored_for_another_user_is_refused(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(acct=account_id(OTHER))
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T1))


def test_client_endpoint_end_to_end_and_restore_is_idempotent(env, client):
    env.api.subs[T1] = sub_payload("sorted.standard.annual", expiry_days=360)
    req = {"purchase_token": T1, "product_id": "sorted.standard.annual"}
    first = client.post("/billing/play/purchase", json=req)
    assert first.status_code == 200 and first.json()["acknowledged"] is True
    second = client.post("/billing/play/purchase", json=req)  # restore
    assert second.status_code == 200
    assert env.api._count("ack") == 1 and len(env.cols["subscriptions_col"].docs) == 1
    assert T1 not in first.text and T1 not in second.text


@pytest.mark.parametrize("payload", [
    {}, {"purchase_token": T1}, {"product_id": "sorted.lite.monthly"},
    {"purchase_token": 5, "product_id": "sorted.lite.monthly"},
    {"purchase_token": "x" * 10, "product_id": "sorted.lite.monthly"},
    {"purchase_token": T1, "product_id": "sorted.connect.monthly"},
    {"purchase_token": T1, "product_id": ["a"]},
])
def test_client_endpoint_rejects_bad_input_with_4xx(env, client, payload):
    resp = client.post("/billing/play/purchase", json=payload)
    assert 400 <= resp.status_code < 500
    assert env.api.calls == []


def test_client_endpoint_503_when_disabled(env, client, monkeypatch):
    monkeypatch.setattr(play_config, "PLAY_IAP_ENABLED", False)
    assert client.post("/billing/play/purchase", json={"purchase_token": T1, "product_id": "sorted.lite.monthly"}).status_code == 503
    assert client.get("/billing/play/config").json() == {"enabled": False}


def test_client_config_lists_nine_subs_three_packs_and_the_account_id(env, client):
    cfg = client.get("/billing/play/config").json()
    assert cfg["enabled"] is True and cfg["package_name"] == PKG
    assert len(cfg["products"]) == 12 and cfg["account_id"] == account_id()
    assert cfg["products"]["lite"] == "sorted.lite.monthly" and cfg["products"]["penny_large"] == "sorted.penny.200"
    assert cfg["purchase_blocked"] is None and cfg["subscription_managed_in_play"] is False
    assert UID not in json.dumps(cfg)


def test_a_live_play_subscription_is_managed_in_play_until_it_lapses(env, client):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    assert client.get("/billing/play/config").json()["subscription_managed_in_play"] is True
    env.api.subs[T1] = sub_payload(state="EXPIRED", expiry_days=-1)
    _run(play_billing.process_subscription(T1))
    assert client.get("/billing/play/config").json()["subscription_managed_in_play"] is False


# ── Precedence with Stripe ───────────────────────────────────────────────────

def _stripe_doc(tier="plus", status="active"):
    return {"user_id": UID, "provider": "stripe", "source": "stripe", "stripe_subscription_id": "sub_1",
            "tier": tier, "status": status, "billing_period": "monthly", "expires_at": NOW + timedelta(days=20)}


def test_highest_tier_wins_over_stripe_and_the_double_is_flagged(env):
    env.cols["subscriptions_col"].docs.append(_stripe_doc("plus"))
    env.api.subs[T1] = sub_payload("sorted.lite.monthly")
    result = _run(play_billing.process_subscription(T1))
    assert result["double_subscription"] is True and sub_doc(env)["double_subscription"] is True
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.PLUS and sub.provider == "stripe"
    # The Stripe document was never touched.
    assert sub_doc(env, "stripe")["tier"] == "plus"


def test_google_tier_wins_when_higher_and_stripe_is_untouched(env):
    env.cols["subscriptions_col"].docs.append(_stripe_doc("lite"))
    env.api.subs[T1] = sub_payload("sorted.plus.monthly")
    _run(play_billing.process_subscription(T1))
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.PLUS and sub.provider == "google"
    assert sub_doc(env, "stripe")["tier"] == "lite" and sub_doc(env, "stripe")["status"] == "active"


def test_client_is_told_not_to_buy_while_a_stripe_subscription_is_live(env, client):
    env.cols["subscriptions_col"].docs.append(_stripe_doc("standard"))
    cfg = client.get("/billing/play/config").json()
    assert cfg["enabled"] is True and "existing subscription" in cfg["purchase_blocked"]


def test_google_event_never_touches_an_apple_document(env):
    env.cols["subscriptions_col"].docs.append({"user_id": UID, "provider": "apple", "source": "apple", "tier": "plus",
                                               "status": "active", "provider_subscription_id": "ap1",
                                               "expires_at": NOW + timedelta(days=9)})
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state="EXPIRED", expiry_days=-1)
    _run(play_billing.process_subscription(T1))
    apple = sub_doc(env, "apple")
    assert apple["status"] == "active" and apple["tier"] == "plus"


# ── Plan changes ─────────────────────────────────────────────────────────────

def test_upgrade_replaces_the_subscription_and_a_late_old_token_event_is_ignored(env):
    env.api.subs[T1] = sub_payload("sorted.lite.monthly")
    _run(play_billing.process_subscription(T1))
    env.api.subs[T2] = sub_payload("sorted.plus.monthly", linked=T1)
    _run(play_billing.process_subscription(T2))
    assert sub_doc(env)["tier"] == "plus"
    old = next(d for d in env.cols["play_purchases_col"].docs if d["purchase_token"] == T1)
    assert old.get("superseded_at") is not None
    # The replaced purchase now reads EXPIRED: it must not expire the live plus plan.
    env.api.subs[T1] = sub_payload("sorted.lite.monthly", state="EXPIRED", expiry_days=-1)
    result = _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "active" and sub_doc(env)["tier"] == "plus"
    assert result["handled"] is False


def test_resubscribe_after_expiry_is_active_again(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state="EXPIRED", expiry_days=-3)
    _run(play_billing.process_subscription(T1))
    assert sub_doc(env)["status"] == "expired"
    env.api.subs[T2] = sub_payload("sorted.lite.annual", expiry_days=360)
    _run(play_billing.process_subscription(T2))
    assert (sub_doc(env)["status"], sub_doc(env)["tier"]) == ("active", "lite")


# ── Consumables ──────────────────────────────────────────────────────────────

def test_pack_is_granted_once_then_consumed_once(env):
    env.api.products[TPACK] = pack_payload()
    result = _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    assert result["consumed"] is True and result["pack_id"] == "medium"
    packs = env.cols["penny_topups_col"].docs
    assert len(packs) == 1 and packs[0]["messages"] == 100 and packs[0]["provider"] == "google"
    assert env.api._count("consume") == 1
    # Replays (redelivery, restore) grant and consume nothing more.
    _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    assert len(env.cols["penny_topups_col"].docs) == 1 and env.api._count("consume") == 1


def test_a_notification_and_the_client_call_racing_on_one_pack_grant_it_once(env):
    env.api.products[TPACK] = pack_payload()
    col = env.cols["penny_topups_col"]
    real_insert = col.insert_one

    async def slow_insert(doc):
        await asyncio.sleep(0)  # a real database yields here: the window the lock closes
        return await real_insert(doc)
    col.insert_one = slow_insert

    async def race():
        return await asyncio.gather(
            play_billing.process_pack(TPACK, "sorted.penny.100"),
            play_billing.verify_client_purchase(UID, TPACK, "sorted.penny.100"),
            play_billing.process_pack(TPACK, "sorted.penny.100"),
        )
    _run(race())
    assert len(env.cols["penny_topups_col"].docs) == 1 and env.api._count("consume") == 1
    assert play_billing._token_locks == {}


def test_cross_replica_pack_race_is_closed_by_the_unique_index_not_the_lock(env, monkeypatch):
    """Two replicas share no in-process lock. Simulate that by disabling the
    lock and making the pack collection enforce the unique partial index on
    (provider, store_transaction_id): the second insert raises
    DuplicateKeyError, which the fixed seam treats as already granted."""
    import contextlib

    @contextlib.asynccontextmanager
    async def no_lock(token):
        yield
    monkeypatch.setattr(play_billing, "_token_lock", no_lock)
    col = FakeCol(unique=(("provider", "store_transaction_id"),))
    monkeypatch.setattr(collections_module, "penny_topups_col", col)
    env.api.products[TPACK] = pack_payload()
    real_insert = col.insert_one

    async def slow_insert(doc):
        await asyncio.sleep(0)
        return await real_insert(doc)
    col.insert_one = slow_insert

    async def race():
        return await asyncio.gather(
            play_billing.process_pack(TPACK, "sorted.penny.100"),
            play_billing.process_pack(TPACK, "sorted.penny.100"),
        )
    results = _run(race())
    assert len(col.docs) == 1
    assert sorted(r["duplicate"] for r in results) == [False, True]
    assert all(r["handled"] for r in results)


def test_a_notification_and_the_client_call_racing_on_one_subscription_acknowledge_once(env):
    env.api.subs[T1] = sub_payload()

    async def race():
        return await asyncio.gather(
            play_billing.process_subscription(T1),
            play_billing.verify_client_purchase(UID, T1, "sorted.standard.monthly"),
        )
    _run(race())
    assert env.api._count("ack") == 1 and len(env.cols["subscriptions_col"].docs) == 1
    assert len(env.cols["play_purchases_col"].docs) == 1


@pytest.mark.parametrize("product,messages", [("sorted.penny.20", 20), ("sorted.penny.100", 100), ("sorted.penny.200", 200)])
def test_each_pack_grants_its_messages(env, product, messages):
    env.api.products[TPACK] = pack_payload(product=product)
    _run(play_billing.process_pack(TPACK, product))
    assert env.cols["penny_topups_col"].docs[0]["messages"] == messages


def test_consume_failure_keeps_the_grant_and_a_retry_only_consumes(env):
    env.api.products[TPACK] = pack_payload()
    env.api.consume_error = PlayApiError(500)
    with pytest.raises(play_billing.PlayUnavailable):
        _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    assert len(env.cols["penny_topups_col"].docs) == 1
    env.api.consume_error = None
    _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    assert len(env.cols["penny_topups_col"].docs) == 1 and env.api._count("consume") == 2
    assert env.cols["play_purchases_col"].docs[0]["consumed_at"] is not None


def test_pending_or_cancelled_pack_grants_nothing(env):
    for state in (1, 2):
        env.api.products[TPACK] = pack_payload(state=state)
        _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    assert env.cols["penny_topups_col"].docs == [] and env.api._count("consume") == 0


def test_pack_notification_through_the_receiver(env, client):
    env.api.products[TPACK] = pack_payload()
    note = {"oneTimeProductNotification": {"version": "1.0", "notificationType": 1, "purchaseToken": TPACK, "sku": "sorted.penny.100"}}
    assert client.post("/webhooks/google-play", json=push_body(note, "p1"), headers=AUTH).status_code == 200
    assert len(env.cols["penny_topups_col"].docs) == 1
    cancelled = {"oneTimeProductNotification": {"version": "1.0", "notificationType": 2, "purchaseToken": TPACK, "sku": "sorted.penny.100"}}
    assert client.post("/webhooks/google-play", json=push_body(cancelled, "p2"), headers=AUTH).status_code == 200
    assert len(env.cols["penny_topups_col"].docs) == 1


def test_subscription_product_id_cannot_be_used_as_a_pack_and_vice_versa(env):
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_pack(TPACK, "sorted.lite.monthly"))
    env.api.subs[T1] = sub_payload("sorted.penny.100")
    with pytest.raises(play_billing.PlayRefused):
        _run(play_billing.process_subscription(T1))


# ── Voided purchases ─────────────────────────────────────────────────────────

def _void_note(token, product_type=1):
    return {"voidedPurchaseNotification": {"purchaseToken": token, "orderId": "GPA.1", "productType": product_type, "refundType": 1}}


def test_voided_subscription_revokes_and_stays_revoked(env, client):
    env.api.subs[T1] = sub_payload()
    client.post("/webhooks/google-play", json=push_body(sub_note(T1), "a"), headers=AUTH)
    assert _run(get_subscription(UID)).tier == Tier.STANDARD
    assert client.post("/webhooks/google-play", json=push_body(_void_note(T1), "b"), headers=AUTH).status_code == 200
    doc = sub_doc(env)
    assert doc["status"] == "expired" and doc["revoked"] is True
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS
    # Google still reading it as ACTIVE (lag) must not bring it back.
    client.post("/webhooks/google-play", json=push_body(sub_note(T1, 2), "c"), headers=AUTH)
    assert sub_doc(env)["status"] == "expired"
    assert env.cols["play_purchases_col"].docs[0]["voided_at"] is not None


def test_voided_unknown_token_is_ignored(env):
    result = _run(play_billing.process_voided("never-seen-token-0000001"))
    assert result["handled"] is False and env.cols["subscriptions_col"].docs == []


def _bought_pack(env, remaining_used=60):
    env.api.products[TPACK] = pack_payload()
    _run(play_billing.process_pack(TPACK, "sorted.penny.100"))
    env.cols["penny_topups_col"].docs[0]["remaining"] = 100 - remaining_used


def test_refunded_pack_clawback_off_leaves_balance_and_records_the_refund(env):
    _bought_pack(env)
    result = _run(play_billing.process_voided(TPACK))
    pack = env.cols["penny_topups_col"].docs[0]
    assert pack["remaining"] == 40 and pack.get("refunded_at") is not None and "clawed_back_at" not in pack
    assert result["action"] == "pack_refund" and result["clawback"] is False and result["uid"] == UID


def test_refunded_pack_clawback_on_zeroes_the_balance(env, monkeypatch):
    monkeypatch.setattr(config_module, "IAP_REFUND_CLAWBACK", True)
    _bought_pack(env)
    result = _run(play_billing.process_voided(TPACK))
    pack = env.cols["penny_topups_col"].docs[0]
    assert pack["remaining"] == 0 and pack.get("clawed_back_at") is not None
    assert result["clawback"] is True


def test_refund_is_recorded_in_the_event_ledger_against_the_user(env, client):
    _bought_pack(env)
    client.post("/webhooks/google-play", json=push_body(_void_note(TPACK, 2), "ref-1"), headers=AUTH)
    ledger = next(d for d in env.cols["billing_events_col"].docs if d["event_id"] == "google:ref-1")
    assert ledger["provider"] == "google" and ledger["result"]["uid"] == UID and ledger["result"]["pack_id"] == "medium"


def test_reconcile_voided_revokes_known_tokens_only_and_is_repeatable(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.voided = [{"purchaseToken": T1, "orderId": "GPA.1"}, {"purchaseToken": "unknown-token-00000000001"},
                      {"purchaseToken": "bad token!"}]
    first = _run(play_billing.reconcile_voided(since=NOW - timedelta(days=2)))
    second = _run(play_billing.reconcile_voided(since=NOW - timedelta(days=2)))
    assert first["revoked"] == 1 and second["revoked"] == 0
    assert sub_doc(env)["status"] == "expired"


# ── Test notification, logging, HTTP client ──────────────────────────────────

def test_test_notification_is_acknowledged(env, client):
    resp = client.post("/webhooks/google-play", json=push_body({"testNotification": {"version": "1.0"}}, "tn"), headers=AUTH)
    assert resp.status_code == 200 and env.api.calls == []


def test_no_token_or_user_data_in_logs(env, client, caplog):
    caplog.set_level(logging.DEBUG)
    env.api.subs[T1] = sub_payload(state="IN_GRACE_PERIOD", expiry_days=3)
    env.api.errors[T2] = PlayApiError(503)
    client.post("/webhooks/google-play", json=push_body(sub_note(T1), "l1"), headers=AUTH)
    client.post("/webhooks/google-play", json=push_body(sub_note(T2), "l2"), headers=AUTH)
    client.post("/webhooks/google-play", json=push_body({"subscriptionNotification": {"purchaseToken": "x"}}, "l3"), headers=AUTH)
    env.api.subs[T1] = sub_payload(acct="f" * 64)
    client.post("/webhooks/google-play", json=push_body(sub_note(T1), "l4"), headers=AUTH)
    text = "\n".join(r.getMessage() for r in caplog.records)
    for secret in (T1, T2, UID, account_id(), SALT, "abc.def.ghi"):
        assert secret not in text


def _rsa_pem():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def test_http_client_signs_a_jwt_exchanges_it_and_quotes_every_path_segment(monkeypatch):
    sa = {"client_email": "svc@proj.iam.gserviceaccount.com", "private_key": _rsa_pem(), "token_uri": "https://oauth.test/token"}
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_JSON", json.dumps(sa))
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_FILE", "")
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if str(request.url) == "https://oauth.test/token":
            assert b"grant_type=urn" in request.content and b"assertion=" in request.content
            return httpx.Response(200, json={"access_token": "ya29.fake", "expires_in": 3600})
        assert request.headers["authorization"] == "Bearer ya29.fake"
        return httpx.Response(200, json={"ok": True})

    api = google_play.HttpPlayApi(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    _run(api.get_subscription_v2("co.uk.pkg", "tok/../x?y=1"))
    _run(api.consume_product("co.uk.pkg", "sorted.penny.100", "tok2"))
    paths = [r.url.raw_path.decode() for r in seen if r.url.host != "oauth.test"]
    assert "tok%2F..%2Fx%3Fy%3D1" in paths[0] and "?y=1" not in paths[0]
    assert paths[1].endswith("/products/sorted.penny.100/tokens/tok2:consume")
    assert len([r for r in seen if r.url.host == "oauth.test"]) == 1  # token cached


def test_http_client_maps_failures_to_status_only_errors(monkeypatch):
    sa = {"client_email": "svc@x", "private_key": _rsa_pem()}
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_JSON", json.dumps(sa))
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_FILE", "")

    def handler(request):
        if "token" in request.url.path and request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        return httpx.Response(404, json={"error": {"message": "contains-token-abcdef"}})

    api = google_play.HttpPlayApi(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    with pytest.raises(PlayApiError) as exc:
        _run(api.get_product("p", "sorted.penny.20", "tok"))
    assert exc.value.status == 404 and "contains-token" not in str(exc.value)


def test_service_account_loading_never_echoes_the_key(monkeypatch):
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_FILE", "")
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_JSON", "")
    assert google_play.service_account_configured() is False
    monkeypatch.setattr(play_config, "PLAY_SERVICE_ACCOUNT_JSON", '{"client_email": "a@b"}')
    with pytest.raises(google_play.PlayNotConfigured) as exc:
        google_play.load_service_account()
    assert "a@b" not in str(exc.value)


def test_play_product_ids_parser_skips_malformed_entries():
    assert play_config._parse_play_product_ids("lite=a.b, bad ,=x,y=, max_annual = c.d ") == {"lite": "a.b", "max_annual": "c.d"}


# ── Review fixes F2, F3, F4 ──────────────────────────────────────────────────

def test_oversized_declared_content_length_is_rejected_before_the_body_is_read(env):
    from starlette.datastructures import Headers

    class FakeRequest:
        headers = Headers({"authorization": "Bearer abc.def.ghi", "content-length": str(router_module._MAX_PUSH_BYTES + 1)})
        query_params = {}
        read = False

        async def body(self):
            FakeRequest.read = True
            return b"{}"

    with pytest.raises(router_module.HTTPException) as exc:
        _run(router_module.google_play_webhook(FakeRequest()))
    assert exc.value.status_code == 400 and FakeRequest.read is False


def test_second_live_play_subscription_is_granted_flagged_and_reported(env, client):
    env.api.subs[T1] = sub_payload("sorted.lite.monthly")
    _run(play_billing.process_subscription(T1))
    env.api.subs[T2] = sub_payload("sorted.plus.monthly")  # no linkedPurchaseToken
    result = _run(play_billing.process_subscription(T2))
    doc = sub_doc(env)
    assert result["double_subscription"] is True and doc["tier"] == "plus"
    assert doc["double_subscription"] is True and doc["play_double_subscription"] is True
    # A renewal of the flagged purchase keeps the flag.
    _run(play_billing.process_subscription(T2))
    assert sub_doc(env)["double_subscription"] is True
    from app.core.subscription import get_subscription_doc
    assert _run(get_subscription_doc(UID))[1].double_play_subscription is True
    # The client summary carries it.
    summary = _run(play_billing.verify_client_purchase(UID, T2, "sorted.plus.monthly"))
    assert summary["double_subscription"] is True


def test_replacing_purchase_naming_the_old_token_is_not_flagged(env):
    env.api.subs[T1] = sub_payload("sorted.lite.monthly")
    _run(play_billing.process_subscription(T1))
    env.api.subs[T2] = sub_payload("sorted.plus.monthly", linked=T1)
    result = _run(play_billing.process_subscription(T2))
    assert "double_subscription" not in result or result["double_subscription"] is False
    assert not sub_doc(env).get("play_double_subscription")


def test_new_purchase_after_the_old_one_lapsed_is_not_flagged(env):
    env.api.subs[T1] = sub_payload()
    _run(play_billing.process_subscription(T1))
    env.api.subs[T1] = sub_payload(state="EXPIRED", expiry_days=-1)
    _run(play_billing.process_subscription(T1))
    env.api.subs[T2] = sub_payload("sorted.plus.monthly")
    result = _run(play_billing.process_subscription(T2))
    assert not result.get("double_subscription") and not sub_doc(env).get("play_double_subscription")


def test_client_product_id_must_match_the_purchased_product(env, client, caplog):
    env.api.subs[T1] = sub_payload("sorted.plus.annual", expiry_days=300)
    resp = client.post("/billing/play/purchase", json={"purchase_token": T1, "product_id": "sorted.lite.monthly"})
    assert resp.status_code == 400 and resp.json()["detail"]["code"] == "PLAY_PURCHASE_REFUSED"
    assert "product_mismatch" not in resp.text and "sorted.plus.annual" not in resp.text
    assert sub_doc(env) is None and env.api._count("ack") == 0
    assert any("does not match purchased product" in r.getMessage() for r in caplog.records)
    ok = client.post("/billing/play/purchase", json={"purchase_token": T1, "product_id": "sorted.plus.annual"})
    assert ok.status_code == 200 and sub_doc(env)["tier"] == "plus"


def test_legacy_max_product_ids_resolve_to_plus(env):
    # B53: Max became Plus. A purchase made under a product id created while
    # Max still existed (sorted.max.<period>) is granted as Plus.
    env.api.subs[T1] = sub_payload("sorted.max.annual", expiry_days=300)
    _run(play_billing.process_subscription(T1))
    doc = sub_doc(env)
    assert (doc["tier"], doc["billing_period"]) == ("plus", "annual")
    assert _run(get_subscription(UID)).tier == Tier.PLUS
