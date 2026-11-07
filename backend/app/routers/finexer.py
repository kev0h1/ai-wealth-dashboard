"""Finexer auth + consent callback endpoints."""
import asyncio
import hmac
import secrets
import logging
import re
import time
from urllib.parse import quote as _urlquote
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from typing import Optional

from app.core.auth import current_user
from app.services import runtime_settings
from app.services.finexer_consent import (
    ReconfirmError,
    next_reconfirm_by,
    reconfirm_consent,
    reconfirm_enabled,
    RECONFIRM_FAILED_MESSAGE,
)
from app.core.config import APP_URL, FINEXER_API_KEY, FINEXER_APP_ID, FINEXER_TEMPLATE_DARK
from app.core.signin_handoff import bank_error_response, bank_handoff_html, signin_handoff_csp
from app.core.subscription import check_connection_limit, check_open_banking_allowed
from app.routers.logos import provider_logo_path
from app.db.collections import finexer_consents_col, preferences_col
from app.services.finexer_sync import (
    list_providers,
    provider_health_map,
    get_or_create_customer,
    create_consent,
    FinexerConsentError,
    finexer_sync_pipeline,
    _client as _finexer_client,
    log_finexer_error,
)
from app.services.finexer_coverage import COVERAGE_CAPTURED_ON, supported_kinds

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
        return await _with_live_health(_providers_cache)

    providers = await list_providers()
    if providers:
        # A148: hand the client a same-origin logo path (resolved against the
        # API base), never Finexer's remote URL, which the site CSP blocks.
        # A183: expose only what the picker needs, including health_status for
        # the plain notice; the remote logo_url and roles stay server side.
        providers = [
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "logo": provider_logo_path(p.get("id", ""), p.get("logo")),
                "bg_colors": p.get("bg_colors") or [],
                "health_status": p.get("health_status") or "operational",
                # G395: Finexer's published account-kind listing is advisory.
                # An unmapped provider is explicit: no listed kinds and no
                # provider-specific capture date, rather than guessed coverage.
                "supported_kinds": sorted(supported_kinds(p.get("id"))),
                "coverage_captured_on": COVERAGE_CAPTURED_ON if supported_kinds(p.get("id")) else None,
            }
            for p in providers
        ]
        providers = sorted(providers, key=lambda p: (p.get("name") or "").lower())
        _providers_cache = providers
        _providers_cache_at = now
        return await _with_live_health(providers)
    return providers


async def _with_live_health(providers: list[dict]) -> list[dict]:
    """A183: overlay health_status from the 10 minute health map, so a bank
    that goes down or recovers shows within minutes while the list itself
    stays on its 24 hour cache. No map means the cached value stands."""
    live = await provider_health_map()
    if not live:
        return providers
    return [{**p, "health_status": live.get(p.get("id"), p.get("health_status") or "operational")} for p in providers]


# A143: the "Sorted dark" consent template. Finexer stops the consent page
# opening on an invalid template id, so the id is only ever appended after a
# live GET /apps/{app_id}/templates/{id} succeeds. Result cached per process:
# a success is kept, a failure is retried after 10 minutes.
_TEMPLATE_ID_RE = re.compile(r"^[A-Za-z0-9]{12}$")
_TEMPLATE_RETRY_AFTER = 600.0  # seconds
_template_check: dict = {"id": None, "ok": False, "at": 0.0, "warned": False}


async def _template_setting() -> str:
    """E10: the dark template id, database value first (owner-editable on
    /ops/health), then the FINEXER_TEMPLATE_DARK env constant."""
    return str(await runtime_settings.asetting("FINEXER_TEMPLATE_DARK", env=FINEXER_TEMPLATE_DARK) or "")


async def _dark_template_id() -> Optional[str]:
    tid = (await _template_setting()).strip()
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
            log_finexer_error(r, "GET /apps/{id}/templates/{id}")
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


_BANK_LINK_UNAVAILABLE = {
    "code": "BANK_LINK_UNAVAILABLE",
    "message": "We could not start the bank connection. Try again in a moment.",
}
_BANK_REJECTED = {
    "code": "BANK_PROVIDER_REJECTED",
    "message": "This bank is not available right now. Try another bank or try again later.",
}


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

    state = secrets.token_urlsafe(16)
    try:
        customer_id = await get_or_create_customer(user)
        consent     = await create_consent(
            user_id=user["email"],
            customer_id=customer_id,
            provider=provider or None,
            state=state,
            user=user,
        )
    except FinexerConsentError as exc:
        # A178: a plain, stable 4xx/5xx body, never a raw 500. 422 when Finexer
        # rejected this bank outright, 502 for any other upstream failure.
        if exc.code == FinexerConsentError.CODE_PROVIDER_REJECTED:
            raise HTTPException(status_code=422, detail=_BANK_REJECTED)
        raise HTTPException(status_code=502, detail=_BANK_LINK_UNAVAILABLE)
    consent_id = consent["id"]

    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {
            "user_id":     user["email"],
            # A191: the customer the consent was really created under (an A178
            # retry may have replaced the one we passed in).
            "customer_id": getattr(consent, "customer_id_used", None) or customer_id,
            "provider":    provider or None,
            "state":       state,
            "status":      "pending",
            "native":      bool(native),
            "created_at":  datetime.utcnow(),
            # A182: the history start we asked for (the bank's maximum applies).
            "retro_date_requested": getattr(consent, "retro_date_requested", None),
        }},
        upsert=True,
    )

    consent_url = consent["redirect"]["consent_url"]
    if await _template_setting() and await _user_prefers_dark(user["email"]):
        dark_id = await _dark_template_id()
        if dark_id:
            consent_url = _with_template(consent_url, dark_id)
    return {"auth_url": consent_url, "connection_id": consent_id}


# A193: how long a started consent is still "the one the user is doing".
_PENDING_WINDOW = timedelta(minutes=30)


@router.get("/auth/finexer/pending")
async def finexer_pending(user: dict = Depends(current_user)):
    """A193: the signed-in user's most recent consent started inside the last 30
    minutes, so an app the phone closed while the user was at the bank can find
    out how that consent ended on its next launch. Server-side state, keyed by
    the consent id, scoped to the caller; nothing here calls Finexer. The client
    never re-opens an old consent URL: a retry always goes through
    /auth/finexer/link, which creates a fresh consent. Additive: old app
    binaries never call it."""
    cutoff = datetime.utcnow() - _PENDING_WINDOW  # naive-ok: created_at is stored naive
    doc = await finexer_consents_col.find_one(
        {"user_id": user["email"], "created_at": {"$gte": cutoff}},
        sort=[("created_at", -1)],
    )
    if not doc:
        return {"connection_id": None, "status": None, "provider": None}
    return {
        "connection_id": doc["_id"],
        "status": doc.get("status") or "pending",
        "provider": doc.get("provider"),
    }


_RECONFIRM_FAILED = {"code": "RECONFIRM_FAILED", "message": RECONFIRM_FAILED_MESSAGE}


@router.post("/auth/finexer/consents/{consent_id}/reconfirm")
async def finexer_reconfirm(consent_id: str, user: dict = Depends(current_user)):
    """A182: the user confirms in the app that Sorted may keep reading this
    bank's data (the 90-day reconfirmation). Writes renewed_at at Finexer, no
    bank login, never extends the consent's expiry. Owner of the consent only;
    a Finexer failure leaves the record unchanged.

    Gated by FINEXER_RECONFIRM_PROMPT_ENABLED (default off): A6.2A says a
    reconfirmation shown in our own interface is a consent screen whose exact
    wording needs Finexer's written approval first. Off, this answers 404. The
    A6.3 fallback is Finexer's hosted reconfirmation, which needs no approval."""
    if not await reconfirm_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    doc = await finexer_consents_col.find_one({"_id": consent_id})
    # Another user's consent answers exactly like a missing one.
    if not doc or doc.get("user_id") != user["email"]:
        raise HTTPException(status_code=404, detail={"code": "CONSENT_NOT_FOUND", "message": "We could not find that bank connection."})
    if doc.get("status") != "authorized":
        raise HTTPException(status_code=409, detail={"code": "CONSENT_NOT_ACTIVE", "message": "This bank connection needs reconnecting first."})
    try:
        out = await reconfirm_consent(consent_id)
    except ReconfirmError:
        raise HTTPException(status_code=502, detail=_RECONFIRM_FAILED)
    return {
        "ok": True,
        "renewed_at": out["renewed_at"].isoformat() + "Z",
        "next_reconfirm_by": out["next_reconfirm_by"].isoformat() + "Z" if out["next_reconfirm_by"] else None,
    }


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
    if not consent_id and state:
        # A193: a bank app that could not open (restricted battery) can send the
        # user back with our own `state` but no fx_consent. The state identifies
        # the consent we created, so it ends as an error the app can explain
        # (and offer a fresh Try again), instead of a dead-end page.
        by_state = await finexer_consents_col.find_one({"state": state})
        if by_state:
            consent_id = by_state["_id"]
            error = error or "missing_consent"
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
    if not state or not stored_state or not hmac.compare_digest(state.encode(), str(stored_state).encode()):
        # A88 semantics unchanged (missing or mismatched state never authorises);
        # G215: the user sees the hand-off error page, not JSON.
        return bank_error_response("finexer", "", status_code=400,
                                   message="We couldn’t confirm that this connection started in Sorted. Close this window and try again in Sorted.")

    # A193: a callback can be loaded twice (a Custom Tab recreated after the
    # phone closed the app, a reload on resume, the bank app and the browser
    # both following the return link). The second load must never undo or
    # repeat the first: an authorised consent stays authorised, with no
    # second sync, and a late error does not cancel it.
    if doc.get("status") == "authorized":
        if doc.get("native"):
            return _bank_page(True, "finexer", consent_id, auto_return=True)
        return RedirectResponse(f"{APP_URL}/accounts?syncing=1&connection={_urlquote(consent_id, safe='')}", status_code=303)

    # A193: the status writes below are filter-level compare-and-set, so the
    # guarantee holds even when two callbacks interleave after both read
    # "pending": an error can never overwrite an authorised consent, and only
    # the callback whose write matched spawns the sync.
    if error:
        await finexer_consents_col.update_one(
            {"_id": consent_id, "status": {"$nin": ["authorized"]}},
            {"$set": {"status": "canceled", "canceled_at": datetime.utcnow(), "error": error}},
        )
        if doc.get("native"):
            return _bank_page(False, "finexer", consent_id, auto_return=False)
        return RedirectResponse(f"{APP_URL}/accounts?connect=cancelled", status_code=303)


    authed_at = datetime.utcnow()  # naive-ok: matches last_synced convention
    res = await finexer_consents_col.update_one(
        {"_id": consent_id, "status": {"$ne": "authorized"}},
        {"$set": {"status": "authorized", "authed_at": authed_at,
                  "next_reconfirm_by": next_reconfirm_by(authed_at, None, doc.get("expiry_date"))}},
    )

    if res.matched_count == 1:
        user_id = doc["user_id"]
        # A176: the first sync after connect asks Finexer to refresh from the bank.
        asyncio.create_task(finexer_sync_pipeline(consent_id, user_id, request_bank_sync=True))

    if doc.get("native"):
        return _bank_page(True, "finexer", consent_id, auto_return=True)
    return RedirectResponse(f"{APP_URL}/accounts?syncing=1&connection={_urlquote(consent_id, safe='')}", status_code=303)

