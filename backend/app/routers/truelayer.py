"""TrueLayer auth + callback endpoints."""
import asyncio
import os
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from typing import Optional
import httpx

from app.core.auth import current_user
from app.core.config import (
    TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET,
    TRUELAYER_AUTH_URL, TRUELAYER_API_URL, TRUELAYER_REDIRECT_URI,
    TRUELAYER_WEBHOOK_SECRET, APP_URL,
)
from app.core.subscription import check_connection_limit, check_open_banking_allowed
from app.db.collections import connections_col
from app.services.truelayer_sync import save_connection, sync_connection

router = APIRouter(tags=["truelayer"])


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
async def truelayer_link(provider: str = "", user: dict = Depends(current_user)):
    if not TRUELAYER_CLIENT_ID:
        raise HTTPException(500, "TrueLayer not configured")
    await check_open_banking_allowed(user["email"])
    await check_connection_limit(user["email"])
    connection_id = secrets.token_hex(8)
    await connections_col.update_one(
        {"_id": connection_id},
        {"$set": {"user_id": user["email"], "pending": True, "created_at": datetime.now()}},
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
async def truelayer_callback(code: str, state: Optional[str] = None):
    if not TRUELAYER_CLIENT_ID or not TRUELAYER_CLIENT_SECRET:
        raise HTTPException(500, "TrueLayer not configured")
    connection_id = state or secrets.token_hex(8)
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
            return HTMLResponse(f"<h2>Token exchange failed</h2><pre>{r.text}</pre>", status_code=400)
        await save_connection(connection_id, r.json())

    conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1})
    user_id  = (conn_doc or {}).get("user_id", "unknown")
    asyncio.create_task(sync_connection(connection_id, user_id))

    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       text-align:center;padding:60px 24px;background:#0f172a;color:#e2e8f0;margin:0}
  .icon{font-size:56px;margin-bottom:16px}
  h1{color:#34d399;font-size:24px;margin:0 0 12px}
  p{color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px}
  .btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
       padding:14px 32px;border-radius:14px;font-size:16px;font-weight:600;
       cursor:pointer;border:none;-webkit-tap-highlight-color:transparent}
</style></head>
<body>
  <div class="icon">&#10003;</div>
  <h1>Bank connected!</h1>
  <p>Your account has been linked.<br>Transactions are syncing in the background.</p>
  <button class="btn" onclick="returnToApp()">Return to app</button>
  <script>
    function returnToApp(){window.location.href='wealthdash://auth-complete';}
    // Auto-attempt deep link after short delay; fall back to accounts page
    // if the browser can't handle the scheme (desktop/web users).
    setTimeout(function(){
      var t=Date.now();
      window.location.href='wealthdash://auth-complete';
      setTimeout(function(){
        if(Date.now()-t<1800){window.location.href='/accounts';}
      },1500);
    },800);
  </script>
</body></html>
""")


if os.getenv("ENABLE_API_DOCS"):
    # Dev-only routing sanity check, not part of any real OAuth flow (the
    # actual exchange happens in truelayer_callback above). Registered only
    # when API introspection is explicitly enabled locally; absent otherwise
    # so it 404s in UAT/prod instead of leaking a public unauthenticated route.
    @router.get("/auth/truelayer/test-callback")
    async def test_callback():
        return {"message": "Callback routing works", "timestamp": datetime.now()}
