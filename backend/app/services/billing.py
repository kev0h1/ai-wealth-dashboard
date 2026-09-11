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
    ("active" -> "active", "trialing" -> "trialing",
    "past_due"/"unpaid" -> "past_due",
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
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.config import (
    BILLING_ENABLED, STRIPE_PRICE_IDS, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
)
from app.core.subscription import (
    MCP_CALL_PACKS, PENNY_TOPUP_PACKS, SUBSCRIPTION_BILLING_PERIODS,
    SUBSCRIPTION_PERIODS_ENABLED, SUBSCRIPTION_TRIAL_DAYS,
    SUBSCRIPTION_TRIAL_PERIODS, TIER_BY_NAME, grant_pack,
)

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


_SUBSCRIPTION_CHECKOUT_TTL = timedelta(hours=24)


async def _claim_subscription_checkout(
    uid: str, *, target: str, billing_period: str, trial: bool,
) -> tuple[str | None, str | None]:
    """Atomically allow only one live subscription Checkout per user.

    The later Stripe webhook is authoritative for entitlement, but it can
    arrive after a user double-clicks, retries or opens another tab. The
    unique ``billing_customers.user_id`` index plus this conditional upsert
    closes that gap. A retry of the same choice reuses the first Checkout
    URL once it exists; a different choice is rejected until that Stripe
    Checkout expires.
    """
    from app.db.collections import billing_customers_col

    now = datetime.now(timezone.utc)
    token = uuid4().hex
    selection = {
        "subscription_checkout_token": token,
        "subscription_checkout_target": target,
        "subscription_checkout_billing_period": billing_period,
        "subscription_checkout_trial": trial,
        "subscription_checkout_expires_at": now + _SUBSCRIPTION_CHECKOUT_TTL,
        "subscription_checkout_session_id": None,
        "subscription_checkout_url": None,
    }
    try:
        claimed = await billing_customers_col.find_one_and_update(
            {
                "user_id": uid,
                "$or": [
                    {"subscription_checkout_expires_at": {"$exists": False}},
                    {"subscription_checkout_expires_at": {"$lte": now}},
                ],
            },
            {
                "$set": {"user_id": uid, **selection},
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        claimed = None

    if claimed and claimed.get("subscription_checkout_token") == token:
        return token, None

    existing = await billing_customers_col.find_one({"user_id": uid})
    existing_expires_at = existing.get("subscription_checkout_expires_at") if existing else None
    if existing_expires_at and existing_expires_at.tzinfo is None:
        existing_expires_at = existing_expires_at.replace(tzinfo=timezone.utc)
    if (
        existing
        and existing.get("subscription_checkout_target") == target
        and existing.get("subscription_checkout_billing_period") == billing_period
        and bool(existing.get("subscription_checkout_trial")) is trial
        and existing_expires_at
        and existing_expires_at > now
    ):
        if existing.get("subscription_checkout_url"):
            return None, existing["subscription_checkout_url"]
        if existing.get("subscription_checkout_token"):
            # The first request may still be running, or Stripe may have
            # accepted it before a lost response. Reusing this token as
            # Stripe's idempotency key makes either retry resolve to the
            # same Checkout Session.
            return existing["subscription_checkout_token"], None
    raise BillingError("A subscription checkout is already open")


async def _validate_subscription_checkout(uid: str, trial: bool) -> None:
    """Prevent duplicate subscriptions and repeat introductory trials.

    Active Stripe subscriptions are changed or cancelled through Stripe's
    customer portal. Checkout may only create a new subscription when no
    active Stripe subscription exists. A trial is introductory, so any
    previous Stripe-backed subscription makes the user ineligible.
    """
    from app.db.collections import subscriptions_col

    doc = await subscriptions_col.find_one({"user_id": uid})
    if not doc:
        return
    stripe_backed = bool(doc.get("source") == "stripe" or doc.get("stripe_subscription_id"))
    if stripe_backed and doc.get("status") in {"active", "trialing", "past_due"}:
        raise BillingError("Manage your existing subscription in billing")
    if trial and (stripe_backed or doc.get("trial_used_at") or doc.get("trial_ends_at")):
        raise BillingError("The introductory trial has already been used")


def _subscription_price_key(target: str, billing_period: str) -> str:
    return target if billing_period == "monthly" else f"{target}_{billing_period}"


def _price_id_for(kind: str, target: str, billing_period: str = "monthly") -> str | None:
    """Resolve `target` (a tier name for kind="subscription", or a pack id
    for kind="pack") to its configured Stripe price id, or None if it
    isn't mapped. Penny pack ids ("small"/"medium"/"large") are looked up
    under the "penny_"-prefixed STRIPE_PRICE_IDS key (see
    app.core.config._parse_stripe_price_ids' own docstring for why); the
    MCP pack's id is already "mcp_1000" so it's looked up verbatim."""
    if kind == "subscription":
        if target not in TIER_BY_NAME or target == "statements":
            return None
        if billing_period not in SUBSCRIPTION_BILLING_PERIODS:
            return None
        return STRIPE_PRICE_IDS.get(_subscription_price_key(target, billing_period))
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
    billing_period: str = "monthly", trial: bool = False,
) -> str:
    """Start a Stripe Checkout session for `uid`. `kind` is "subscription"
    (mode="subscription", `target` a tier name, with a server-validated
    recurring billing period and an optional 14-day trial, gated to
    whichever periods app.core.subscription.SUBSCRIPTION_TRIAL_PERIODS
    lists) or "pack" (mode="payment", `target` a pack id).
    `client_reference_id` and `metadata` both carry `uid` (belt and
    braces — Stripe recommends both) plus `kind`/`target`, which is how
    the webhook handler below knows what to grant once payment completes;
    the client never gets to specify an amount, only which
    already-configured Stripe price to buy. Raises BillingNotLive if
    BILLING_ENABLED is false, or BillingError if the target/period has no
    configured price id, the period isn't currently offered, or a trial is
    requested on a period that doesn't carry one."""
    if not BILLING_ENABLED:
        raise BillingNotLive()
    if kind not in ("subscription", "pack"):
        raise BillingError("kind must be 'subscription' or 'pack'")

    if kind == "subscription" and billing_period not in SUBSCRIPTION_BILLING_PERIODS:
        raise BillingError("billing_period must be monthly, three_months, six_months or annual")
    if kind == "subscription" and billing_period not in SUBSCRIPTION_PERIODS_ENABLED:
        raise BillingError(f"billing_period '{billing_period}' is not currently offered")
    if trial and (kind != "subscription" or billing_period not in SUBSCRIPTION_TRIAL_PERIODS):
        raise BillingError("the 14-day trial is not available with this billing period")
    price_id = _price_id_for(kind, target, billing_period)
    if not price_id:
        raise BillingError(f"no Stripe price configured for {kind}:{target}")

    checkout_token = None
    if kind == "subscription":
        await _validate_subscription_checkout(uid, trial)
        checkout_token, existing_url = await _claim_subscription_checkout(
            uid, target=target, billing_period=billing_period, trial=trial,
        )
        if existing_url:
            return existing_url

    stripe_mod = _stripe()
    stripe_mod.api_key = STRIPE_SECRET_KEY

    try:
        customer_id = await _get_or_create_customer(uid)

        metadata = {"uid": uid, "kind": kind, "target": target}
        if kind == "subscription":
            metadata.update({"billing_period": billing_period, "trial": "true" if trial else "false"})

        checkout_args = {
            "mode": "subscription" if kind == "subscription" else "payment",
            "customer": customer_id,
            "client_reference_id": uid,
            "metadata": metadata,
            "line_items": [{"price": price_id, "quantity": 1}],
            "success_url": success_url,
            "cancel_url": cancel_url,
        }
        if kind == "subscription":
            subscription_data = {"metadata": metadata}
            if trial:
                subscription_data["trial_period_days"] = SUBSCRIPTION_TRIAL_DAYS
                checkout_args["payment_method_collection"] = "always"
            checkout_args["subscription_data"] = subscription_data

        if checkout_token:
            checkout_args["idempotency_key"] = checkout_token
        session = stripe_mod.checkout.Session.create(**checkout_args)
    except Exception:
        # Keep a subscription reservation after every ambiguous failure.
        # A retry reuses its Stripe idempotency key, so a response lost
        # after Stripe accepted the request cannot create a second Session.
        raise

    if checkout_token:
        from app.db.collections import billing_customers_col
        try:
            await billing_customers_col.update_one(
                {"user_id": uid, "subscription_checkout_token": checkout_token},
                {"$set": {
                    "subscription_checkout_session_id": session.id,
                    "subscription_checkout_url": session.url,
                }},
            )
        except Exception:
            # Stripe has already created the session. Keep the reservation
            # so a storage hiccup cannot turn a retry into a second paid
            # subscription; this caller can still continue using the URL.
            logger.exception("billing: could not persist Checkout URL for %s", uid)
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


def _subscription_for_price_id(price_id: str) -> tuple[str, str] | None:
    for tier_name in TIER_BY_NAME:
        if tier_name == "statements":
            continue
        for billing_period in SUBSCRIPTION_BILLING_PERIODS:
            key = _subscription_price_key(tier_name, billing_period)
            if STRIPE_PRICE_IDS.get(key) == price_id:
                return tier_name, billing_period
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
    subscription_identity = _subscription_for_price_id(price_id) if price_id else None
    if not subscription_identity:
        return {"handled": False, "reason": f"no tier mapped for price {price_id!r}"}
    tier, billing_period = subscription_identity

    status_map = {
        "active": "active", "trialing": "trialing",
        "past_due": "past_due", "unpaid": "past_due",
        "canceled": "expired", "incomplete_expired": "expired",
    }
    status = status_map.get(sub_obj.get("status"), "active")

    period_end = sub_obj.get("current_period_end")
    expires_at = datetime.fromtimestamp(period_end, tz=timezone.utc) if period_end else None
    trial_end = sub_obj.get("trial_end")
    trial_ends_at = datetime.fromtimestamp(trial_end, tz=timezone.utc) if trial_end else None

    now = datetime.now(timezone.utc)
    trial_started_at = None
    if sub_obj.get("status") == "trialing":
        trial_start = sub_obj.get("trial_start")
        trial_started_at = datetime.fromtimestamp(trial_start, tz=timezone.utc) if trial_start else now
    subscription_fields = {
        "user_id":               uid,
        "tier":                  tier,
        "status":                status,
        "stripe_subscription_id": sub_obj.get("id"),
        "billing_period":        billing_period,
        "expires_at":            expires_at,
        "trial_ends_at":         trial_ends_at,
        "cancel_at_period_end":  bool(sub_obj.get("cancel_at_period_end")),
        "updated_at":            now,
        "source":                "stripe",
    }
    if trial_started_at:
        subscription_fields["trial_used_at"] = trial_started_at
    await subscriptions_col.update_one(
        {"user_id": uid},
        {
            "$set": subscription_fields,
            "$setOnInsert": {"started_at": now},
        },
        upsert=True,
    )
    return {
        "handled": True, "action": "subscription_upsert", "uid": uid,
        "tier": tier, "status": status, "billing_period": billing_period,
    }


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
