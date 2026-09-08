"""Stripe billing (B5) — thin wrapper around the stripe SDK.

No Stripe account exists yet (Kevin, 2026-09-09 backlog decision): this is
built entirely against Stripe TEST mode with placeholder keys so it is
ready the day the account exists, and every function here refuses to do
anything real (`BillingNotLive`) until `app.core.config.BILLING_ENABLED`
is true. Real money never moves from this module alone — Stripe only ever
grants a tier or a pack through `handle_event`, driven by a verified
webhook, never from a client-supplied tier/pack in the checkout request
itself (see `app/routers/billing.py`'s POST /billing/checkout, which only
ever passes a `target` id through to Stripe's own price, it can't set an
amount or a tier directly).

The `stripe` package import is lazy (see `_stripe()` below), not a
top-level `import stripe` — this file, and everything that imports it
(app/routers/billing.py, app/main.py), must still import cleanly even in
an environment where `stripe` isn't installed yet (it is in
requirements.txt, but a worktree's own venv or a stripped-down test venv
may predate that). Only actually calling one of the functions below needs
the package. Tests monkeypatch the module-level `stripe` name directly
(see tests/test_billing.py) with a fake stripe module, which `_stripe()`
picks up without attempting a real import.

Event-to-effect table (see `_dispatch_event` below):
  - checkout.session.completed (kind="pack" in metadata) -> grant_pack
    (app.core.subscription.grant_pack, source="purchase").
    checkout.session.completed for kind="subscription" is a no-op here —
    Stripe follows it with its own customer.subscription.created for the
    same subscription, which is what actually grants the tier below, so
    there is nothing to double-grant.
  - customer.subscription.created / customer.subscription.updated ->
    upsert subscriptions_col: {user_id, tier (resolved from the
    subscription's price id via STRIPE_PRICE_IDS), status
    ("active"/"trialing" -> "active", "past_due"/"unpaid" -> "past_due",
    anything else -> "expired"), stripe_subscription_id,
    current_period_end -> expires_at, updated_at, source: "stripe"}.
  - customer.subscription.deleted -> subscriptions_col status "expired".
  - invoice.payment_failed -> subscriptions_col status "past_due".
    app.core.subscription.get_subscription only ever falls back to the
    default tier when status is literally "expired" or expires_at has
    passed — a "past_due" subscription keeps its tier and limits until
    expires_at, exactly matching Stripe's own dunning grace period
    (Stripe keeps retrying the card for days before actually cancelling
    the subscription, which is what eventually fires
    customer.subscription.deleted or updates status to "canceled").

Every event is processed idempotently on Stripe's own `event.id`
(`billing_events_col`) — a Stripe retry of an already-processed event is
a no-op read, not a double-grant or a double status flip.
"""
import logging
from datetime import datetime, timezone

from app.core.config import (
    BILLING_ENABLED, STRIPE_PRICE_IDS, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
)
from app.core.subscription import MCP_CALL_PACKS, PENNY_TOPUP_PACKS, TIER_BY_NAME, grant_pack

logger = logging.getLogger(__name__)

# Lazily imported (or monkeypatched by tests) — see module docstring. Left
# as a plain module-level name, not wrapped in a class/singleton, so a test
# can `monkeypatch.setattr(billing_module, "stripe", FakeStripe())` the
# same way it would patch any other module-level collaborator in this
# codebase (e.g. app.db.collections.<col> across the test suite).
stripe = None


def _stripe():
    global stripe
    if stripe is None:
        try:
            import stripe as _stripe_module
        except ImportError as exc:
            raise BillingError(
                "the stripe package is not installed in this environment"
            ) from exc
        stripe = _stripe_module
    return stripe


class BillingError(Exception):
    """Base class for billing-service errors that should surface to the
    caller as a 400 (app/routers/billing.py catches this)."""


class BillingNotLive(BillingError):
    def __init__(self):
        super().__init__("Billing is not live yet")


class NoStripeCustomer(BillingError):
    def __init__(self):
        super().__init__("No billing account yet")


class SignatureVerificationFailed(BillingError):
    def __init__(self):
        super().__init__("Invalid Stripe webhook signature")


def _price_id_for(kind: str, target: str) -> str | None:
    """Resolve `target` (a tier name for kind="subscription", or a pack id
    for kind="pack") to its configured Stripe price id, or None if it
    isn't mapped. Penny pack ids ("small"/"medium"/"large") are looked up
    under the "penny_"-prefixed STRIPE_PRICE_IDS key (see
    app.core.config._parse_stripe_price_ids' own docstring for why); the
    MCP pack's id is already "mcp_1000" so it's looked up verbatim."""
    if kind == "subscription":
        return STRIPE_PRICE_IDS.get(target)
    if any(p["id"] == target for p in PENNY_TOPUP_PACKS):
        return STRIPE_PRICE_IDS.get(f"penny_{target}")
    if any(p["id"] == target for p in MCP_CALL_PACKS):
        return STRIPE_PRICE_IDS.get(target)
    return None


async def _get_or_create_customer(uid: str) -> str:
    """Look up `uid`'s Stripe customer id in billing_customers_col,
    creating both the Stripe Customer and the mapping doc on first use.
    `email=uid` since this codebase's user_id IS the user's email
    (app.core.config.resolve_allowed_email)."""
    from app.db.collections import billing_customers_col

    doc = await billing_customers_col.find_one({"user_id": uid})
    if doc and doc.get("stripe_customer_id"):
        return doc["stripe_customer_id"]

    stripe_mod = _stripe()
    stripe_mod.api_key = STRIPE_SECRET_KEY
    customer = stripe_mod.Customer.create(email=uid, metadata={"uid": uid})

    now = datetime.now(timezone.utc)
    await billing_customers_col.update_one(
        {"user_id": uid},
        {
            "$set": {"user_id": uid, "stripe_customer_id": customer.id},
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return customer.id


async def create_checkout_session(
    uid: str, *, kind: str, target: str, success_url: str, cancel_url: str,
) -> str:
    """Start a Stripe Checkout session for `uid`. `kind` is "subscription"
    (mode="subscription", `target` a tier name — lite/standard/connect/max)
    or "pack" (mode="payment", `target` a pack id). `client_reference_id`
    and `metadata` both carry `uid` (belt and braces — Stripe recommends
    both) plus `kind`/`target`, which is how the webhook handler below
    knows what to grant once payment completes; the client never gets to
    specify an amount, only which already-configured Stripe price to buy.
    Raises BillingNotLive if BILLING_ENABLED is false, or BillingError if
    `target` has no configured price id."""
    if not BILLING_ENABLED:
        raise BillingNotLive()
    if kind not in ("subscription", "pack"):
        raise BillingError("kind must be 'subscription' or 'pack'")

    price_id = _price_id_for(kind, target)
    if not price_id:
        raise BillingError(f"no Stripe price configured for {kind}:{target}")

    stripe_mod = _stripe()
    stripe_mod.api_key = STRIPE_SECRET_KEY

    customer_id = await _get_or_create_customer(uid)

    session = stripe_mod.checkout.Session.create(
        mode="subscription" if kind == "subscription" else "payment",
        customer=customer_id,
        client_reference_id=uid,
        metadata={"uid": uid, "kind": kind, "target": target},
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
    )
    return session.url


async def create_portal_session(uid: str, return_url: str) -> str:
    """Open a Stripe customer-portal session for `uid` (manage/cancel a
    subscription, update the card on file). Raises NoStripeCustomer if
    `uid` has never started a checkout (no Stripe customer on file yet)."""
    if not BILLING_ENABLED:
        raise BillingNotLive()

    from app.db.collections import billing_customers_col

    doc = await billing_customers_col.find_one({"user_id": uid})
    if not doc or not doc.get("stripe_customer_id"):
        raise NoStripeCustomer()

    stripe_mod = _stripe()
    stripe_mod.api_key = STRIPE_SECRET_KEY
    session = stripe_mod.billing_portal.Session.create(
        customer=doc["stripe_customer_id"], return_url=return_url,
    )
    return session.url


def verify_and_parse_event(raw_body: bytes, sig_header: str | None) -> dict:
    """Verify `raw_body`'s Stripe-Signature header against
    STRIPE_WEBHOOK_SECRET and return the parsed event. Raises
    SignatureVerificationFailed on any failure — missing header, missing/
    unconfigured secret, bad signature, or an unparseable body — which the
    route (app/routers/billing.py) maps to a 400, never a 5xx: Stripe reads
    a 400 as "this delivery was rejected", not "the endpoint is broken",
    and keeps retrying only on 5xx/timeout."""
    if not STRIPE_WEBHOOK_SECRET or not sig_header:
        raise SignatureVerificationFailed()

    stripe_mod = _stripe()
    try:
        event = stripe_mod.Webhook.construct_event(raw_body, sig_header, STRIPE_WEBHOOK_SECRET)
    except Exception as exc:
        raise SignatureVerificationFailed() from exc
    return event


async def _uid_for_customer(customer_id: str) -> str | None:
    from app.db.collections import billing_customers_col
    doc = await billing_customers_col.find_one({"stripe_customer_id": customer_id})
    return doc.get("user_id") if doc else None


def _tier_for_price_id(price_id: str) -> str | None:
    for tier_name in TIER_BY_NAME:
        if STRIPE_PRICE_IDS.get(tier_name) == price_id:
            return tier_name
    return None


async def _resolve_uid(obj: dict) -> str | None:
    """`metadata.uid` first (set on the Checkout Session and carried onto
    the Subscription/Invoice it creates), falling back to a
    billing_customers_col lookup on the Stripe customer id — covers a
    subscription updated by Stripe itself (e.g. Smart Retries) without the
    original checkout metadata attached."""
    uid = (obj.get("metadata") or {}).get("uid")
    if uid:
        return uid
    customer_id = obj.get("customer")
    if isinstance(customer_id, dict):
        customer_id = customer_id.get("id")
    if customer_id:
        return await _uid_for_customer(customer_id)
    return None


async def _handle_checkout_completed(session_obj: dict) -> dict:
    metadata = session_obj.get("metadata") or {}
    kind = metadata.get("kind")
    target = metadata.get("target")
    uid = metadata.get("uid") or session_obj.get("client_reference_id")

    if kind != "pack":
        # Subscriptions are granted off customer.subscription.created/
        # updated below, not this event — nothing to do here.
        return {"handled": False, "reason": f"kind={kind!r}, nothing to grant here"}
    if not uid or not target:
        return {"handled": False, "reason": "missing uid or target in metadata"}

    pack_kind = "mcp" if any(p["id"] == target for p in MCP_CALL_PACKS) else "penny"
    try:
        await grant_pack(uid, pack_kind, target, source="purchase")
    except ValueError as exc:
        logger.error("billing: checkout.session.completed grant_pack failed for %s: %s", uid, exc)
        return {"handled": False, "reason": str(exc)}
    return {"handled": True, "action": "grant_pack", "uid": uid, "pack_kind": pack_kind, "pack_id": target}


async def _handle_subscription_upsert(sub_obj: dict) -> dict:
    from app.db.collections import subscriptions_col

    uid = await _resolve_uid(sub_obj)
    if not uid:
        return {"handled": False, "reason": "no uid resolvable"}

    items = (sub_obj.get("items") or {}).get("data") or []
    price = (items[0] or {}).get("price") if items else None
    price_id = price.get("id") if isinstance(price, dict) else None
    tier = _tier_for_price_id(price_id) if price_id else None
    if not tier:
        return {"handled": False, "reason": f"no tier mapped for price {price_id!r}"}

    status_map = {
        "active": "active", "trialing": "active",
        "past_due": "past_due", "unpaid": "past_due",
        "canceled": "expired", "incomplete_expired": "expired",
    }
    status = status_map.get(sub_obj.get("status"), "active")

    period_end = sub_obj.get("current_period_end")
    expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None

    now = datetime.now(timezone.utc)
    await subscriptions_col.update_one(
        {"user_id": uid},
        {
            "$set": {
                "user_id":               uid,
                "tier":                  tier,
                "status":                status,
                "stripe_subscription_id": sub_obj.get("id"),
                "expires_at":            expires_at,
                "updated_at":            now,
                "source":                "stripe",
            },
            "$setOnInsert": {"started_at": now},
        },
        upsert=True,
    )
    return {"handled": True, "action": "subscription_upsert", "uid": uid, "tier": tier, "status": status}


async def _handle_subscription_deleted(sub_obj: dict) -> dict:
    from app.db.collections import subscriptions_col

    uid = await _resolve_uid(sub_obj)
    if not uid:
        return {"handled": False, "reason": "no uid resolvable"}

    await subscriptions_col.update_one(
        {"user_id": uid},
        {"$set": {"status": "expired", "updated_at": datetime.now(timezone.utc), "source": "stripe"}},
    )
    return {"handled": True, "action": "subscription_deleted", "uid": uid}


async def _handle_payment_failed(invoice_obj: dict) -> dict:
    from app.db.collections import subscriptions_col

    uid = await _resolve_uid(invoice_obj)
    if not uid:
        return {"handled": False, "reason": "no uid resolvable"}

    await subscriptions_col.update_one(
        {"user_id": uid},
        {"$set": {"status": "past_due", "updated_at": datetime.now(timezone.utc), "source": "stripe"}},
    )
    return {"handled": True, "action": "payment_failed", "uid": uid}


async def _dispatch_event(event_type: str, event: dict) -> dict:
    data_object = ((event.get("data") or {}).get("object")) or {}

    if event_type == "checkout.session.completed":
        return await _handle_checkout_completed(data_object)
    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        return await _handle_subscription_upsert(data_object)
    if event_type == "customer.subscription.deleted":
        return await _handle_subscription_deleted(data_object)
    if event_type == "invoice.payment_failed":
        return await _handle_payment_failed(data_object)
    return {"handled": False, "reason": f"unrecognised event type {event_type!r}"}


async def handle_event(event: dict) -> dict:
    """Process one verified Stripe event, idempotently on `event.id`
    (billing_events_col). Safe to call twice with the same event (a Stripe
    retry): the second call finds `processed_at` already set and returns
    the first call's result without re-dispatching."""
    from app.db.collections import billing_events_col

    event_id = event.get("id")
    event_type = event.get("type")
    now = datetime.now(timezone.utc)

    if event_id:
        existing = await billing_events_col.find_one({"event_id": event_id})
        if existing and existing.get("processed_at"):
            logger.info("billing: event %s (%s) already processed, skipping", event_id, event_type)
            return {"ok": True, "idempotent": True, "result": existing.get("result")}
        if not existing:
            await billing_events_col.insert_one({
                "event_id": event_id, "type": event_type,
                "received_at": now, "processed_at": None, "result": None,
            })

    result = await _dispatch_event(event_type, event)

    if event_id:
        await billing_events_col.update_one(
            {"event_id": event_id},
            {"$set": {"processed_at": datetime.now(timezone.utc), "result": result}},
        )
    return {"ok": True, "idempotent": False, "result": result}
