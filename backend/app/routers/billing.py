"""Stripe billing routes (B5): checkout, customer portal, status, and the
webhook receiver. BILLING_ENABLED is derived from whether a Stripe secret
key and every required price id are configured (app/core/config.py) —
B31 (2026-09-14) found this is already true wherever a Stripe test-mode
key and price table are set, including this codebase's own shared
environment, so /billing/checkout and /billing/portal are not a
theoretical "once billing goes live" concern. See app/services/billing.py
for the full doctrine.

B31 also added _reject_native_platform: a server-side backstop behind the
client-side native purchase gate (B26). See that function's own comment
for what signal it checks, how strong a guarantee it is, and why an
absent signal is treated as web rather than refused.

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
from app.core.subscription import SUBSCRIPTION_PERIODS_ENABLED, SUBSCRIPTION_TRIAL_PERIODS
from app.services import billing as billing_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["billing"])


def _require_billing_live() -> None:
    if not BILLING_ENABLED:
        raise HTTPException(
            status_code=503,
            detail={"code": "BILLING_NOT_LIVE", "message": "Billing is not live yet."},
        )


# B31: the native purchase gate (B26) is entirely client-side —
# frontend/lib/nativeAuth.ts's canPurchaseInApp() hides every purchase
# button on a Capacitor build because Apple and Google require digital
# goods to go through their own in-app purchase systems, and this app has
# no IAP integration on either platform. Apple and Google review the
# client UI, not raw API calls, so a server-side check here is defence in
# depth, not the live control — but with nothing at all server-side, a
# regression, a stale cached bundle, or a webview edge case would reopen a
# route straight to Stripe with no backstop and no way to notice.
#
# The only platform signal the server can see today is one the client
# chooses to send: `X-Client-Platform`, set by frontend/lib/api.ts's
# platformHeaders() from the same Capacitor.isNativePlatform() check
# canPurchaseInApp() uses, fixed to fail closed the same way (any
# detection error is treated as native). There is no signal the server
# can see independently of the client asserting it — no CapacitorHttp
# plugin is in use (capacitor-spike/capacitor.config.json has no `plugins`
# block), so requests go through the platform WebView's ordinary fetch,
# and neither its User-Agent nor any TLS/transport property reliably
# distinguishes a Capacitor WebView from a mobile browser. That makes this
# header a backstop against the accidental and the careless case, not a
# security control: anyone driving the app under a debugger can omit or
# forge it. If a stronger guarantee is ever needed, it would have to come
# from something the client cannot fully control from within the same
# process that would forge the header — e.g. a signed attestation
# (Apple's App Attest / Play Integrity) checked against Apple/Google
# servers, which is a materially bigger build, not a header rename.
#
# Absent header is treated as web (allowed to proceed to the billing-live
# check below), not refused. A forgeable signal cannot prove a request
# came from a browser, so refusing on absence would not stop a spoofed
# request (it would just omit the header too) while it would break every
# real web user and every pre-B31 cached web bundle, none of which have
# ever had a reason to send this header. Refusing only ever fires on a
# header that positively asserts a native platform, which is exactly the
# regression/stale-bundle/webview-edge-case this item exists to catch.
_NATIVE_PLATFORM_VALUES = {"ios", "android", "native"}


def _reject_native_platform(request: "Request | None", user: dict, *, endpoint: str) -> None:
    if request is None:
        return  # no Request available (never happens outside a direct unit-test call) — same as absent header
    platform = (request.headers.get("x-client-platform") or "").strip().lower()
    if platform not in _NATIVE_PLATFORM_VALUES:
        return
    logger.warning(
        "billing: refused %s for user=%s, X-Client-Platform=%r looks native",
        endpoint, user.get("email"), platform,
    )
    raise HTTPException(
        status_code=403,
        detail={
            "code": "BILLING_NATIVE_BLOCKED",
            # Same sentence as frontend/lib/nativeAuth.ts's
            # PURCHASE_UNAVAILABLE_SENTENCE, so a native client that
            # somehow reaches this (rather than being stopped by its own
            # canPurchaseInApp() gate) shows the identical, already-agreed
            # copy rather than inventing a second sentence for the same
            # fact.
            "message": "Paid plans are not available in this app.",
        },
    )


@router.post("/billing/checkout")
async def create_checkout(
    body: dict,
    # Typed exactly `Request` (not `Request | None`), because FastAPI's own
    # dependency resolver only recognises the injected-Request special case
    # via `lenient_issubclass(type_annotation, Request)`
    # (fastapi/dependencies/utils.py) — a Union annotation fails that
    # isinstance check and would make FastAPI try to treat this as an
    # ordinary field instead. The `= None` default is never seen over real
    # HTTP (FastAPI injects the true Request regardless of the default);
    # it only matters for the handful of existing tests that call this
    # function directly without a request, which then behave exactly like
    # "no X-Client-Platform header" (see _reject_native_platform above).
    request: Request = None,  # type: ignore[assignment]
    user: dict = Depends(current_user),
):
    """{kind: "subscription"|"pack", target: tier-or-pack-id} -> {url}.
    `target` is never trusted beyond "does a Stripe price exist for it" —
    what a user actually gets is granted only once Stripe's own webhook
    fires (app.services.billing.handle_event), never from this request."""
    _reject_native_platform(request, user, endpoint="POST /billing/checkout")
    _require_billing_live()

    kind = (body.get("kind") or "").strip().lower()
    target = (body.get("target") or "").strip()
    billing_period = (body.get("billing_period") or "monthly").strip().lower()
    trial = body.get("trial", False)
    flow = (body.get("flow") or "settings").strip().lower()
    if kind not in ("subscription", "pack"):
        raise HTTPException(400, "kind must be 'subscription' or 'pack'")
    if not target:
        raise HTTPException(400, "target required")
    if not isinstance(trial, bool):
        raise HTTPException(400, "trial must be true or false")
    if flow not in ("settings", "onboarding"):
        raise HTTPException(400, "flow must be 'settings' or 'onboarding'")
    # B22: reject early, before touching Stripe, on a period that isn't
    # currently offered or a trial requested on a period that doesn't
    # carry one (app.core.subscription.SUBSCRIPTION_PERIODS_ENABLED /
    # SUBSCRIPTION_TRIAL_PERIODS — both Kevin-flippable). create_checkout_session
    # below re-checks the same two things for kind="subscription"; this is
    # belt and braces so a bad request never reaches Stripe at all.
    if kind == "subscription" and billing_period not in SUBSCRIPTION_PERIODS_ENABLED:
        raise HTTPException(400, f"billing_period '{billing_period}' is not currently offered")
    if trial and (kind != "subscription" or billing_period not in SUBSCRIPTION_TRIAL_PERIODS):
        raise HTTPException(400, "the 14-day trial is not available with this billing period")

    if flow == "onboarding":
        success_url = f"{APP_URL}/?billing=success"
        cancel_url = f"{APP_URL}/?billing=cancelled"
    else:
        success_url = f"{APP_URL}/settings?billing=success"
        cancel_url = f"{APP_URL}/settings?billing=cancelled"

    try:
        url = await billing_service.create_checkout_session(
            user["email"], kind=kind, target=target,
            success_url=success_url, cancel_url=cancel_url,
            billing_period=billing_period, trial=trial,
        )
    except billing_service.BillingError as exc:
        raise HTTPException(400, str(exc))
    return {"url": url}


@router.post("/billing/portal")
async def create_portal(
    body: dict | None = None,
    # See create_checkout's own comment above for why this is typed
    # `Request` (not `Request | None`) with a `= None` default.
    request: Request = None,  # type: ignore[assignment]
    user: dict = Depends(current_user),
):
    """Open a Stripe customer-portal session for the signed-in user, so
    they can manage or cancel a subscription and update their card."""
    _reject_native_platform(request, user, endpoint="POST /billing/portal")
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
        "billing_period": sub_doc.get("billing_period") if sub_doc else None,
        "trial_ends_at": sub_doc.get("trial_ends_at").isoformat() if sub_doc and sub_doc.get("trial_ends_at") else None,
        "renews_at": sub_doc.get("expires_at").isoformat() if sub_doc and sub_doc.get("expires_at") else None,
        "cancel_at_period_end": bool(sub_doc and sub_doc.get("cancel_at_period_end")),
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
