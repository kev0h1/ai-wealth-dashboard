"""TrueLayer auth + callback endpoints."""
import asyncio
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from typing import Optional
import httpx

from app.core.auth import current_user
from app.core.config import (
    TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET,
    TRUELAYER_AUTH_URL, TRUELAYER_REDIRECT_URI,
)
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
    connection_id = secrets.token_hex(8)
    await connections_col.update_one(
        {"_id": connection_id},
        {"$set": {"user_id": user["email"], "pending": True, "created_at": datetime.now()}},
        upsert=True,
    )
    providers_param = f"uk-ob-all%20uk-cs-mock" if not provider else provider
    auth_url = (
        f"{TRUELAYER_AUTH_URL}/?"
        f"response_type=code&"
        f"client_id={TRUELAYER_CLIENT_ID}&"
        f"scope=accounts%20transactions%20balance%20cards%20offline_access&"
        f"redirect_uri={TRUELAYER_REDIRECT_URI}&"
        f"state={connection_id}&"
        f"providers={providers_param}"
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

    return HTMLResponse("""
    <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#1a1a2e;color:#e0e0e0">
    <h1 style="color:#00d4aa">&#10003; Bank Connected!</h1>
    <p>Your account has been linked. Transactions are syncing in the background.</p>
    <p>Head to Discord and use <strong>/summary</strong> to see your data.</p>
    </body></html>
    """)


@router.get("/auth/truelayer/test-callback")
async def test_callback():
    return {"message": "Callback routing works", "timestamp": datetime.now()}
