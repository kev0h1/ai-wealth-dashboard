"""Stripe billing routes (B5): checkout, customer portal, status, and the
webhook receiver. No Stripe account exists yet, so every environment today
has BILLING_ENABLED false and /billing/checkout, /billing/portal both
answer 503 BILLING_NOT_LIVE — see app/core/config.py and
app/services/billing.py for the full doctrine.

POST /webhooks/stripe is public (the app-wide auth middleware exempts any
path starting with "/webhooks/", see app/core/auth.py) and rate-limited the
same way, matching the TrueLayer/Finexer receivers in
app/routers/webhooks.py. It is defined here rather than in that file
because this whole feature (checkout, portal, webhook) ships and is
reasoned about together.

Registered in app.main._routers only, like every other non-MCP router —
mcp_only mode (app.main.build_app) bypasses _routers() entirely and never
sees this module."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import current_user
from app.core.config import APP_URL, BILLING_ENABLED
from app.services import billing as billing_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["billing"])


def _require_billing_live() -> None:
    if not BILLING_ENABLED:
        raise HTTPException(
            status_code=503,
            detail={"code": "BILLING_NOT_LIVE", "message": "Billing is not live yet."},
        )


@router.post("/billing/checkout")
async def create_checkout(body: dict, user: dict = Depends(current_user)):
    """{kind: "subscription"|"pack", target: tier-or-pack-id} -> {url}.
    `target` is never trusted beyond "does a Stripe price exist for it" —
    what a user actually gets is granted only once Stripe's own webhook
    fires (app.services.billing.handle_event), never from this request."""
    _require_billing_live()

    kind = (body.get("kind") or "").strip().lower()
    target = (body.get("target") or "").strip()
    if kind not in ("subscription", "pack"):
        raise HTTPException(400, "kind must be 'subscription' or 'pack'")
    if not target:
        raise HTTPException(400, "target required")

    success_url = body.get("success_url") or f"{APP_URL}/settings?billing=success"
    cancel_url = body.get("cancel_url") or f"{APP_URL}/settings?billing=cancelled"

    try:
        url = await billing_service.create_checkout_session(
            user["email"], kind=kind, target=target,
            success_url=success_url, cancel_url=cancel_url,
        )
    except billing_service.BillingError as exc:
        raise HTTPException(400, str(exc))
    return {"url": url}


@router.post("/billing/portal")
async def create_portal(body: dict | None = None, user: dict = Depends(current_user)):
    """Open a Stripe customer-portal session for the signed-in user, so
    they can manage or cancel a subscription and update their card."""
    _require_billing_live()

    return_url = (body or {}).get("return_url") or f"{APP_URL}/settings"
    try:
        url = await billing_service.create_portal_session(user["email"], return_url)
    except billing_service.NoStripeCustomer:
        raise HTTPException(404, "No billing account yet")
    except billing_service.BillingError as exc:
        raise HTTPException(400, str(exc))
    return {"url": url}


@router.get("/billing/status")
async def billing_status(user: dict = Depends(current_user)):
    """Current tier, Stripe subscription status, period end, and whether a
    Stripe customer exists for this user — a lighter-weight sibling of GET
    /subscription for a dedicated billing/account screen."""
    from app.core.subscription import get_subscription
    from app.db.collections import billing_customers_col, subscriptions_col

    sub = await get_subscription(user["email"])
    customer_doc = await billing_customers_col.find_one({"user_id": user["email"]})
    sub_doc = await subscriptions_col.find_one({"user_id": user["email"]})

    return {
        "billing_live":  BILLING_ENABLED,
        "tier":          sub.tier_name,
        "status":        sub.status,
        "expires_at":    sub_doc.get("expires_at").isoformat() if sub_doc and sub_doc.get("expires_at") else None,
        "has_customer":  bool(customer_doc and customer_doc.get("stripe_customer_id")),
    }


@router.post("/webhooks/stripe", status_code=200)
async def stripe_webhook(request: Request):
    """Stripe webhook receiver. Always verifies the signature over the raw
    body first (400 on failure — see verify_and_parse_event's own
    docstring for why a bad signature is a 400, not a 401/500), then
    processes inline (no queue, matching the size of this event volume)
    through billing_service.handle_event, which is idempotent on the
    event's own id. Always 200 once the signature verifies, even for an
    event type this app doesn't act on, so Stripe doesn't retry forever
    on something it will never need to retry."""
    body = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = billing_service.verify_and_parse_event(body, sig_header)
    except billing_service.SignatureVerificationFailed:
        raise HTTPException(status_code=400, detail="Invalid signature")

    result = await billing_service.handle_event(event)
    return {"ok": True, "result": result.get("result")}
