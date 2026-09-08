"""Tests for B5 (Stripe billing, test mode, behind BILLING_ENABLED).

Covers app.services.billing (checkout/portal session creation, webhook
signature verification, idempotent event handling and each event type's
effect on subscriptions_col / the pack collections), app.routers.billing
(BILLING_NOT_LIVE gating, the webhook route's signature-failure 400), GET
/subscription's billing_live toggling, and
app.core.config._parse_stripe_price_ids.

No real `stripe` package is imported anywhere in this file — `stripe` is
monkeypatched onto app.services.billing.stripe directly with a small fake
built by `_make_fake_stripe()` below, matching that module's own lazy
`_stripe()` contract (a non-None module-level `stripe` is returned as-is,
no import attempted). No mongomock is available in this environment (see
test_finexer_webhook.py's own note) — DB-touching collections are replaced
with `_FakeCol`, a near-copy of that file's own fixture.

Route functions are called directly (not via TestClient/HTTP), matching
test_penny_topup_packs.py / test_finexer_webhook.py's convention. The
webhook route additionally needs a fake Request exposing async `.body()`
and a plain-dict-like `.headers`, mirroring test_finexer_webhook.py's own
`_FakeRequest`.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.core.config as config_module
import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.billing as billing_router_module
import app.routers.subscription as subscription_router_module
import app.services.billing as billing_module

UID = "billing-test@example.com"


def _run(coro):
    return asyncio.run(coro)


# ── Fakes ──────────────────────────────────────────────────────────────────

class _FakeCol:
    """Stand-in for a Motor collection — find_one()/insert_one()/
    update_one() with exact-key-equality query matching. Mirrors _FakeCol
    in test_finexer_webhook.py."""

    def __init__(self, docs=None):
        self.docs: list[dict] = list(docs or [])
        self._next_id = 1

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        doc = dict(doc)
        doc.setdefault("_id", f"doc{self._next_id}")
        self._next_id += 1
        self.docs.append(doc)
        return _InsertResult(doc["_id"])

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            new_doc.update(update.get("$setOnInsert") or {})
            self.docs.append(new_doc)


class _InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class _FakeRequest:
    """Minimal stand-in for fastapi.Request — the webhook route only ever
    awaits .body() and reads request.headers.get(...)."""

    def __init__(self, raw: bytes, headers: dict | None = None):
        self._raw = raw
        self.headers = headers or {}

    async def body(self):
        return self._raw


def _obj(**kw):
    return type("Obj", (), kw)()


def _make_fake_stripe(valid_secret="whsec_test", valid_sig="valid-sig"):
    """A minimal fake of the parts of the `stripe` SDK app.services.billing
    actually calls: checkout.Session.create, billing_portal.Session.create,
    Customer.create, Webhook.construct_event. Each `*_calls` list records
    the kwargs it was called with so tests can assert on them."""
    checkout_calls: list[dict] = []
    portal_calls: list[dict] = []
    customer_calls: list[dict] = []

    class _CheckoutSession:
        @staticmethod
        def create(**kwargs):
            checkout_calls.append(kwargs)
            return _obj(url=f"https://checkout.stripe.com/test/{len(checkout_calls)}", id=f"cs_{len(checkout_calls)}")

    class _Checkout:
        Session = _CheckoutSession

    class _PortalSession:
        @staticmethod
        def create(**kwargs):
            portal_calls.append(kwargs)
            return _obj(url="https://billing.stripe.com/test/portal")

    class _BillingPortal:
        Session = _PortalSession

    class _Customer:
        @staticmethod
        def create(**kwargs):
            customer_calls.append(kwargs)
            return _obj(id=f"cus_{len(customer_calls) + 1}")

    class _SignatureVerificationError(Exception):
        pass

    class _Webhook:
        @staticmethod
        def construct_event(payload, sig_header, secret):
            if secret != valid_secret or sig_header != valid_sig:
                raise _SignatureVerificationError("bad signature")
            return json.loads(payload)

    fake = _obj(
        checkout=_Checkout, billing_portal=_BillingPortal, Customer=_Customer,
        Webhook=_Webhook, api_key=None,
        error=_obj(SignatureVerificationError=_SignatureVerificationError),
    )
    fake.checkout_calls = checkout_calls
    fake.portal_calls = portal_calls
    fake.customer_calls = customer_calls
    return fake


def _patch_collections(monkeypatch, **cols):
    """Patch app.db.collections.<name> for every kwarg given — the lazy
    `from app.db.collections import X` inside each billing_module/
    subscription_module function picks up whatever is on the module at
    call time, matching test_finexer_webhook.py's own convention."""
    for name, col in cols.items():
        monkeypatch.setattr(db_collections_module, name, col)


def _patch_billing_enabled(monkeypatch, enabled: bool, *, price_ids: dict | None = None):
    """BILLING_ENABLED is imported ('from app.core.config import
    BILLING_ENABLED') separately into app.services.billing,
    app.routers.billing and app.routers.subscription, so each module's own
    binding has to be patched independently — same convention
    test_mcp_connector_flag.py uses for MCP_CONNECTOR_ENABLED."""
    monkeypatch.setattr(billing_module, "BILLING_ENABLED", enabled)
    monkeypatch.setattr(billing_router_module, "BILLING_ENABLED", enabled)
    monkeypatch.setattr(subscription_router_module, "BILLING_ENABLED", enabled)
    if price_ids is not None:
        monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", price_ids)


_FULL_PRICE_IDS = {
    "lite": "price_lite", "standard": "price_standard",
    "connect": "price_connect", "max": "price_max",
    "penny_small": "price_penny_small", "penny_medium": "price_penny_medium",
    "penny_large": "price_penny_large", "mcp_1000": "price_mcp_1000",
}


# ── 1. STRIPE_PRICE_IDS parsing ───────────────────────────────────────────

def test_parse_stripe_price_ids_well_formed():
    parsed = config_module._parse_stripe_price_ids("lite=price_a,standard=price_b, max = price_c ")
    assert parsed == {"lite": "price_a", "standard": "price_b", "max": "price_c"}


def test_parse_stripe_price_ids_skips_malformed_entries():
    parsed = config_module._parse_stripe_price_ids("lite=price_a,nonsense,=novalue,nokey=,standard=price_b")
    assert parsed == {"lite": "price_a", "standard": "price_b"}


def test_parse_stripe_price_ids_empty_string():
    assert config_module._parse_stripe_price_ids("") == {}


def test_billing_enabled_requires_secret_key_and_every_price_id():
    # Mirrors the formula in app.core.config: BILLING_ENABLED = bool(secret)
    # and all(required keys present).
    required = config_module._STRIPE_REQUIRED_PRICE_KEYS
    complete = {k: f"price_{k}" for k in required}
    assert bool("sk_test_x") and all(k in complete for k in required)

    incomplete = dict(complete)
    del incomplete["max"]
    assert not (bool("sk_test_x") and all(k in incomplete for k in required))

    assert not (bool("") and all(k in complete for k in required))


# ── 2. Checkout session creation ──────────────────────────────────────────

def test_create_checkout_session_for_a_tier(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol())

    url = _run(billing_module.create_checkout_session(
        UID, kind="subscription", target="standard",
        success_url="https://app/success", cancel_url="https://app/cancel",
    ))

    assert url == "https://checkout.stripe.com/test/1"
    call = fake_stripe.checkout_calls[0]
    assert call["mode"] == "subscription"
    assert call["client_reference_id"] == UID
    assert call["metadata"] == {"uid": UID, "kind": "subscription", "target": "standard"}
    assert call["line_items"] == [{"price": "price_standard", "quantity": 1}]
    assert call["success_url"] == "https://app/success"
    assert call["cancel_url"] == "https://app/cancel"
    # A Stripe customer was created and persisted for reuse.
    assert len(fake_stripe.customer_calls) == 1


def test_create_checkout_session_for_a_pack(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol())

    url = _run(billing_module.create_checkout_session(
        UID, kind="pack", target="medium",
        success_url="https://app/success", cancel_url="https://app/cancel",
    ))

    assert url.startswith("https://checkout.stripe.com/test/")
    call = fake_stripe.checkout_calls[0]
    assert call["mode"] == "payment"
    assert call["line_items"] == [{"price": "price_penny_medium", "quantity": 1}]
    assert call["metadata"] == {"uid": UID, "kind": "pack", "target": "medium"}


def test_create_checkout_session_mcp_pack_uses_verbatim_price_key(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol())

    _run(billing_module.create_checkout_session(
        UID, kind="pack", target="mcp_1000",
        success_url="https://app/success", cancel_url="https://app/cancel",
    ))
    assert fake_stripe.checkout_calls[0]["line_items"] == [{"price": "price_mcp_1000", "quantity": 1}]


def test_create_checkout_session_reuses_existing_customer(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol(
        [{"user_id": UID, "stripe_customer_id": "cus_existing"}]
    ))

    _run(billing_module.create_checkout_session(
        UID, kind="subscription", target="lite",
        success_url="https://app/success", cancel_url="https://app/cancel",
    ))
    assert fake_stripe.checkout_calls[0]["customer"] == "cus_existing"
    assert len(fake_stripe.customer_calls) == 0


# ── 3. BILLING_NOT_LIVE when unconfigured ─────────────────────────────────

def test_create_checkout_session_raises_when_not_live(monkeypatch):
    _patch_billing_enabled(monkeypatch, False)
    try:
        _run(billing_module.create_checkout_session(
            UID, kind="subscription", target="lite",
            success_url="https://app/s", cancel_url="https://app/c",
        ))
        assert False, "expected BillingNotLive"
    except billing_module.BillingNotLive:
        pass


def test_billing_router_checkout_returns_503_when_not_live(monkeypatch):
    _patch_billing_enabled(monkeypatch, False)
    try:
        _run(billing_router_module.create_checkout(
            {"kind": "subscription", "target": "lite"}, user={"email": UID},
        ))
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 503
        assert exc.detail["code"] == "BILLING_NOT_LIVE"


def test_billing_router_portal_returns_503_when_not_live(monkeypatch):
    _patch_billing_enabled(monkeypatch, False)
    try:
        _run(billing_router_module.create_portal(None, user={"email": UID}))
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 503


def test_billing_router_checkout_live_returns_url(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol())

    result = _run(billing_router_module.create_checkout(
        {"kind": "pack", "target": "small"}, user={"email": UID},
    ))
    assert result["url"].startswith("https://checkout.stripe.com/test/")


def test_billing_router_portal_404_without_customer(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol())

    try:
        _run(billing_router_module.create_portal(None, user={"email": UID}))
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 404


# ── 4. Webhook signature verification ─────────────────────────────────────

def test_verify_and_parse_event_bad_signature_raises(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", "whsec_test")

    try:
        billing_module.verify_and_parse_event(b'{"id": "evt_1"}', "wrong-sig")
        assert False, "expected SignatureVerificationFailed"
    except billing_module.SignatureVerificationFailed:
        pass


def test_verify_and_parse_event_missing_secret_raises(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", "")

    try:
        billing_module.verify_and_parse_event(b'{"id": "evt_1"}', "valid-sig")
        assert False, "expected SignatureVerificationFailed"
    except billing_module.SignatureVerificationFailed:
        pass


def test_stripe_webhook_route_400_on_bad_signature(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", "whsec_test")

    req = _FakeRequest(b'{"id": "evt_1", "type": "checkout.session.completed"}', {"stripe-signature": "wrong"})
    try:
        _run(billing_router_module.stripe_webhook(req))
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_stripe_webhook_route_200_on_good_signature(monkeypatch):
    fake_stripe = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake_stripe)
    monkeypatch.setattr(billing_module, "STRIPE_WEBHOOK_SECRET", "whsec_test")
    fake_events = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=fake_events)

    payload = json.dumps({"id": "evt_unrecognised", "type": "some.other.event", "data": {"object": {}}}).encode()
    req = _FakeRequest(payload, {"stripe-signature": "valid-sig"})
    result = _run(billing_router_module.stripe_webhook(req))
    assert result["ok"] is True
    assert result["result"]["handled"] is False


# ── 5. Idempotent event handling ──────────────────────────────────────────

def test_handle_event_is_idempotent_on_event_id(monkeypatch):
    fake_events = _FakeCol()
    fake_topups = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=fake_events, penny_topups_col=fake_topups)

    event = {
        "id": "evt_dup", "type": "checkout.session.completed",
        "data": {"object": {"metadata": {"uid": UID, "kind": "pack", "target": "small"}}},
    }

    first = _run(billing_module.handle_event(event))
    assert first["idempotent"] is False
    assert len(fake_topups.docs) == 1

    second = _run(billing_module.handle_event(event))
    assert second["idempotent"] is True
    # No second pack granted on replay.
    assert len(fake_topups.docs) == 1


# ── 6. Event-type effects ─────────────────────────────────────────────────

def test_checkout_completed_pack_grants_penny_pack(monkeypatch):
    fake_topups = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), penny_topups_col=fake_topups)

    event = {
        "id": "evt_pack_1", "type": "checkout.session.completed",
        "data": {"object": {"metadata": {"uid": UID, "kind": "pack", "target": "large"}}},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["handled"] is True
    assert result["result"]["pack_kind"] == "penny"

    doc = fake_topups.docs[0]
    assert doc["user_id"] == UID
    assert doc["pack_id"] == "large"
    assert doc["messages"] == 200
    assert doc["source"] == "purchase"


def test_checkout_completed_pack_grants_mcp_pack(monkeypatch):
    fake_packs = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), mcp_call_packs_col=fake_packs)

    event = {
        "id": "evt_pack_2", "type": "checkout.session.completed",
        "data": {"object": {"metadata": {"uid": UID, "kind": "pack", "target": "mcp_1000"}}},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["handled"] is True
    assert result["result"]["pack_kind"] == "mcp"

    doc = fake_packs.docs[0]
    assert doc["pack_id"] == "mcp_1000"
    assert doc["calls"] == 1000
    assert doc["source"] == "purchase"


def test_checkout_completed_subscription_kind_is_a_noop(monkeypatch):
    _patch_collections(monkeypatch, billing_events_col=_FakeCol())

    event = {
        "id": "evt_sub_checkout", "type": "checkout.session.completed",
        "data": {"object": {"metadata": {"uid": UID, "kind": "subscription", "target": "max"}}},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["handled"] is False


def test_subscription_created_upserts_tier_and_active_status(monkeypatch):
    fake_subs = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=fake_subs)
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)

    period_end_ts = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
    event = {
        "id": "evt_sub_created", "type": "customer.subscription.created",
        "data": {"object": {
            "id": "sub_123", "customer": "cus_1", "status": "active",
            "current_period_end": period_end_ts,
            "metadata": {"uid": UID},
            "items": {"data": [{"price": {"id": "price_standard"}}]},
        }},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["tier"] == "standard"
    assert result["result"]["status"] == "active"

    doc = fake_subs.docs[0]
    assert doc["user_id"] == UID
    assert doc["tier"] == "standard"
    assert doc["status"] == "active"
    assert doc["stripe_subscription_id"] == "sub_123"
    assert doc["source"] == "stripe"


def test_subscription_updated_maps_past_due_status(monkeypatch):
    fake_subs = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=fake_subs)
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)

    event = {
        "id": "evt_sub_updated", "type": "customer.subscription.updated",
        "data": {"object": {
            "id": "sub_123", "customer": "cus_1", "status": "past_due",
            "current_period_end": None,
            "metadata": {"uid": UID},
            "items": {"data": [{"price": {"id": "price_max"}}]},
        }},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["status"] == "past_due"
    assert fake_subs.docs[0]["status"] == "past_due"


def test_subscription_deleted_marks_expired(monkeypatch):
    fake_subs = _FakeCol([{"user_id": UID, "tier": "standard", "status": "active"}])
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=fake_subs)

    event = {
        "id": "evt_sub_deleted", "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_123", "customer": "cus_1", "metadata": {"uid": UID}}},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["handled"] is True
    assert fake_subs.docs[0]["status"] == "expired"


def test_invoice_payment_failed_marks_past_due(monkeypatch):
    fake_subs = _FakeCol([{"user_id": UID, "tier": "standard", "status": "active"}])
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=fake_subs)

    event = {
        "id": "evt_invoice_failed", "type": "invoice.payment_failed",
        "data": {"object": {"customer": "cus_1", "metadata": {"uid": UID}}},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["handled"] is True
    assert fake_subs.docs[0]["status"] == "past_due"


def test_subscription_upsert_resolves_uid_via_customer_lookup_when_metadata_missing(monkeypatch):
    fake_subs = _FakeCol()
    fake_customers = _FakeCol([{"user_id": UID, "stripe_customer_id": "cus_lookup"}])
    _patch_collections(
        monkeypatch, billing_events_col=_FakeCol(),
        subscriptions_col=fake_subs, billing_customers_col=fake_customers,
    )
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)

    event = {
        "id": "evt_sub_no_meta", "type": "customer.subscription.created",
        "data": {"object": {
            "id": "sub_999", "customer": "cus_lookup", "status": "active",
            "current_period_end": None, "metadata": {},
            "items": {"data": [{"price": {"id": "price_lite"}}]},
        }},
    }
    result = _run(billing_module.handle_event(event))
    assert result["result"]["handled"] is True
    assert result["result"]["uid"] == UID


# ── 7. GET /subscription billing_live ─────────────────────────────────────

def test_get_subscription_billing_live_reflects_flag(monkeypatch):
    async def _fake_get_subscription(email):
        return subscription_module.Subscription(subscription_module.Tier.MAX)

    monkeypatch.setattr(subscription_router_module, "get_subscription", _fake_get_subscription)

    _patch_billing_enabled(monkeypatch, False)
    result = _run(subscription_router_module.get_subscription_info(user={"email": UID}))
    assert result["billing_live"] is False

    _patch_billing_enabled(monkeypatch, True)
    result = _run(subscription_router_module.get_subscription_info(user={"email": UID}))
    assert result["billing_live"] is True
