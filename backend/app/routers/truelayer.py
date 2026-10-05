"""TrueLayer auth + callback endpoints."""
import asyncio
import os
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from typing import Optional
from urllib.parse import quote as _urlquote
import httpx

from app.core.auth import current_user
from app.core.config import (
    TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET,
    TRUELAYER_AUTH_URL, TRUELAYER_API_URL, TRUELAYER_REDIRECT_URI,
    TRUELAYER_WEBHOOK_SECRET, APP_URL,
)
from app.core.signin_handoff import bank_error_response, bank_handoff_html, signin_handoff_csp
from app.core.subscription import check_connection_limit, check_open_banking_allowed
from app.db.collections import connections_col
from app.services.truelayer_sync import save_connection, sync_connection

router = APIRouter(tags=["truelayer"])


def _bank_page(ok: bool, provider: str, connection_id: str, *, auto_return: bool) -> HTMLResponse:
    page = bank_handoff_html(ok, provider=provider, connection_id=connection_id, auto_return=auto_return)
    return HTMLResponse(page, headers={"Content-Security-Policy": signin_handoff_csp(page)})


@router.get("/auth/truelayer/providers")
async def truelayer_providers(user: dict = Depends(current_user)):
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get("https://auth.truelayer.com/api/providers?country=uk")
    if r.status_code != 200:
        return []
    return [
        {"id": p["provider_id"], "name": p["display_name"], "logo": p.get("logo_url", "")}
        for p in r.json()
        if p["provider_id"] != "mock"
    ]


@router.get("/auth/truelayer/link")
async def truelayer_link(provider: str = "", native: bool = False, user: dict = Depends(current_user)):
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(500, "TrueLayer not configured")
    await check_open_banking_allowed(user["email"])
    await check_connection_limit(user["email"])
    connection_id = secrets.token_hex(8)
    await connections_col.update_one(
        {"_id": connection_id},
        {"$set": {"user_id": user["email"], "pending": True, "native": bool(native), "created_at": datetime.now()}},  # naive-ok: persisted audit timestamp, unchanged from before A68
        upsert=True,
    )
    providers_param = f"uk-ob-all%20uk-cs-mock" if not provider else provider
    webhook_uri = f"{APP_URL}/api/webhooks/truelayer/{TRUELAYER_WEBHOOK_SECRET}"
    from urllib.parse import quote
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20cards%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"state={connection_id}&"
        f"providers={providers_param}&"
        f"webhook_uri={quote(webhook_uri, safe='')}"
    )
    return {"auth_url": auth_url, "connection_id": connection_id}


@router.get("/auth/truelayer/callback")
async def truelayer_callback(code: str = "", state: Optional[str] = None, error: str = ""):
    # G215: a browser lands here by navigation, so every failure is the designed
    # hand-off error page (never JSON, never upstream text).
    if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
        return bank_error_response("truelayer", state or "", status_code=503,
                                   message="Bank connections aren’t available right now. Close this window and try again later.")
    if error or not code:
        return bank_error_response("truelayer", state or "", status_code=400)
    connection_id = state or secrets.token_hex(8)
    pre_doc = await connections_col.find_one({"_id": connection_id}, {"native": 1})
    native = bool((pre_doc or {}).get("native"))
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type":    "authorization_code",
                "client_id":     TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "redirect_uri":  TRUELAYER_REDIRECT_URI,
                "code":          code,
            },
        )
        if r.status_code != 200:
            return bank_error_response("truelayer", connection_id, status_code=502)
        await save_connection(connection_id, r.json())

    conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1})
    user_id  = (conn_doc or {}).get("user_id", "unknown")
    asyncio.create_task(sync_connection(connection_id, user_id))

    if native:
        return _bank_page(True, "truelayer", connection_id, auto_return=True)
    return RedirectResponse(f"{APP_URL}/accounts?syncing=1&connection={_urlquote(connection_id, safe='')}", status_code=303)



if os.getenv("ENABLE_API_DOCS"):
    # Dev-only routing sanity check, not part of any real OAuth flow (the
    # actual exchange happens in truelayer_callback above). Registered only
    # when API introspection is explicitly enabled locally; absent otherwise
    # so it 404s in UAT/prod instead of leaking a public unauthenticated route.
    @router.get("/auth/truelayer/test-callback")
    async def test_callback():
        return {"message": "Callback routing works", "timestamp": datetime.now()}
