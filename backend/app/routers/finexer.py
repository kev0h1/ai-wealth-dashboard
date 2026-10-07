"""Finexer auth + consent callback endpoints."""
import asyncio
import hmac
import secrets
import logging
import re
import time
from urllib.parse import quote as _urlquote
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from typing import Optional

from app.core.auth import current_user
from app.core.config import APP_URL, FINEXER_API_KEY, FINEXER_APP_ID, FINEXER_TEMPLATE_DARK
from app.core.signin_handoff import bank_error_response, bank_handoff_html, signin_handoff_csp
from app.core.subscription import check_connection_limit, check_open_banking_allowed
from app.routers.logos import provider_logo_path
from app.db.collections import finexer_consents_col, preferences_col
from app.services.finexer_sync import (
    list_providers,
    get_or_create_customer,
    create_consent,
    finexer_sync_pipeline,
    _client as _finexer_client,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["finexer"])


def _bank_page(ok: bool, provider: str, connection_id: str, *, auto_return: bool) -> HTMLResponse:
    page = bank_handoff_html(ok, provider=provider, connection_id=connection_id, auto_return=auto_return)
    return HTMLResponse(page, headers={"Content-Security-Policy": signin_handoff_csp(page)})

# In-process cache for the provider list — it barely ever changes and the
# picker can open several times per session, so we don't want to even hit
# `list_providers()`'s own (Mongo-backed, H19) cache on every open. TTL
# only, no invalidation hook; an empty fetch (Finexer down) is never cached
# so the next open retries instead of sticking on empty.
#
# H19: this route deliberately does NOT expose a `force` refresh — Finexer's
# provider list is reference data that changes rarely, and this route is
# reachable by any signed-in user, so a force-refresh flag here would be an
# easy way to hammer the underlying API. The one place that needs a forced
# refresh is an admin picking up a newly onboarded provider ahead of the
# TTL, which POST /admin/finexer/providers/refresh (app/routers/
# admin_usage.py) covers instead.
_PROVIDERS_CACHE_TTL = 3600  # seconds
_providers_cache: list[dict] = []
_providers_cache_at: float = 0.0


@router.get("/auth/finexer/providers")
async def finexer_providers(user: dict = Depends(current_user)):
    """Return all AIS-capable Finexer providers for the bank picker, sorted
    by name and cached in-process for an hour (on top of list_providers()'s
    own shared 24h cache, see app/services/finexer_sync.py)."""
    global _providers_cache, _providers_cache_at
    now = time.monotonic()
    if _providers_cache and (now - _providers_cache_at) < _PROVIDERS_CACHE_TTL:
        return _providers_cache

    providers = await list_providers()
    if providers:
        # A148: hand the client a same-origin logo path (resolved against the
        # API base), never Finexer's remote URL, which the site CSP blocks.
        providers = [
            {**p, "logo": provider_logo_path(p.get("id", ""), p.get("logo"))}
            for p in providers
        ]
        providers = sorted(providers, key=lambda p: (p.get("name") or "").lower())
        _providers_cache = providers
        _providers_cache_at = now
    return providers


# A143: the "Sorted dark" consent template. Finexer stops the consent page
# opening on an invalid template id, so the id is only ever appended after a
# live GET /apps/{app_id}/templates/{id} succeeds. Result cached per process:
# a success is kept, a failure is retried after 10 minutes.
_TEMPLATE_ID_RE = re.compile(r"^[A-Za-z0-9]{12}$")
_TEMPLATE_RETRY_AFTER = 600.0  # seconds
_template_check: dict = {"id": None, "ok": False, "at": 0.0, "warned": False}


async def _dark_template_id() -> Optional[str]:
    tid = (FINEXER_TEMPLATE_DARK or "").strip()
    if not tid:
        return None
    if not (FINEXER_APP_ID and _TEMPLATE_ID_RE.match(tid)):
        if not _template_check["warned"]:
            _template_check["warned"] = True
            logger.warning("Finexer dark template not used: FINEXER_APP_ID missing or template id malformed")
        return None
    cached = _template_check
    if cached["id"] == tid:
        if cached["ok"]:
            return tid
        if time.monotonic() - cached["at"] < _TEMPLATE_RETRY_AFTER:
            return None
    ok = False
    try:
        async with _finexer_client() as client:
            r = await client.get(f"/apps/{FINEXER_APP_ID}/templates/{tid}", timeout=5.0)
        ok = r.status_code == 200
        if not ok:
            logger.warning("Finexer dark template check failed: HTTP %s", r.status_code)
    except Exception as exc:  # network failure: fall back to the default template
        logger.warning("Finexer dark template check failed: %s", type(exc).__name__)
    _template_check.update({"id": tid, "ok": ok, "at": time.monotonic()})
    return tid if ok else None


async def _user_prefers_dark(email: str) -> bool:
    try:
        doc = await preferences_col.find_one({"user_id": email}) or {}
    except Exception as exc:
        logger.warning("Finexer template: preference lookup failed: %s", type(exc).__name__)
        return False
    return bool(doc.get("dark_mode", False))


def _with_template(consent_url: str, template_id: str) -> str:
    """Append the parameter to the raw string; the existing query is untouched."""
    sep = "&" if "?" in consent_url else "?"
    return f"{consent_url}{sep}template={template_id}"


@router.get("/auth/finexer/link")
async def finexer_link(
    provider: str = "",
    native: bool = False,
    user: dict = Depends(current_user),
):
    """Initiate a Finexer consent flow; return the redirect URL. `native` marks a
    native-app connect so the callback hands back to the app (A68); web and old
    app binaries omit it and get a plain redirect."""
    if not FINEXER_API_KEY:
        raise HTTPException(500, "Finexer not configured")
    await check_open_banking_allowed(user["email"])
    await check_connection_limit(user["email"])

    customer_id = await get_or_create_customer(user)
    state       = secrets.token_hex(8)
    consent     = await create_consent(
        user_id=user["email"],
        customer_id=customer_id,
        provider=provider or None,
        state=state,
    )
    consent_id = consent["id"]

    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {
            "user_id":     user["email"],
            "customer_id": customer_id,
            "provider":    provider or None,
            "state":       state,
            "status":      "pending",
            "native":      bool(native),
            "created_at":  datetime.utcnow(),
        }},
        upsert=True,
    )

    consent_url = consent["redirect"]["consent_url"]
    if FINEXER_TEMPLATE_DARK and await _user_prefers_dark(user["email"]):
        dark_id = await _dark_template_id()
        if dark_id:
            consent_url = _with_template(consent_url, dark_id)
    return {"auth_url": consent_url, "connection_id": consent_id}


@router.get("/auth/finexer/callback")
async def finexer_callback(
    consent: str = "",
    state: str = "",
    error: str = "",
    fx_consent: str = "",
):
    """
    Finexer redirects here after the user completes (or cancels) the consent flow.
    Query params: ?fx_consent=<bc_id>&state=<ours>  or  ?error=access_denied&fx_consent=<bc_id>
    """
    # Accept both `consent` and `fx_consent` param names
    consent_id = fx_consent or consent
    if not consent_id:
        return bank_error_response("finexer", "", status_code=400,
                                   message="That link is missing its connection details. Close this window and try again in Sorted.")

    doc = await finexer_consents_col.find_one({"_id": consent_id})
    if not doc:
        return bank_error_response("finexer", "", status_code=404,
                                   message="We couldn’t find that bank connection. Close this window and try again in Sorted.")

    # State verification is mandatory: a missing `state` (ours or the
    # stored one) is rejected exactly like a mismatched one, not skipped.
    # A88: the previous `if state and doc.get("state") and ...` form only
    # rejected a *mismatched* state, letting an omitted one straight
    # through to authorise the consent and trigger a sync.
    stored_state = doc.get("state")
    if not state or not stored_state or not hmac.compare_digest(state, stored_state):
        # A88 semantics unchanged (missing or mismatched state never authorises);
        # G215: the user sees the hand-off error page, not JSON.
        return bank_error_response("finexer", "", status_code=400,
                                   message="We couldn’t confirm that this connection started in Sorted. Close this window and try again in Sorted.")

    if error:
        await finexer_consents_col.update_one(
            {"_id": consent_id},
            {"$set": {"status": "canceled", "canceled_at": datetime.utcnow(), "error": error}},
        )
        if doc.get("native"):
            return _bank_page(False, "finexer", consent_id, auto_return=False)
        return RedirectResponse(f"{APP_URL}/accounts?connect=cancelled", status_code=303)


    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {"status": "authorized", "authed_at": datetime.utcnow()}},
    )

    user_id = doc["user_id"]
    asyncio.create_task(finexer_sync_pipeline(consent_id, user_id))

    if doc.get("native"):
        return _bank_page(True, "finexer", consent_id, auto_return=True)
    return RedirectResponse(f"{APP_URL}/accounts?syncing=1&connection={_urlquote(consent_id, safe='')}", status_code=303)

