"""Mono (Kenya) auth + data endpoints."""
import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import MONO_PUBLIC_KEY, MONO_API_URL
from app.db.collections import (
    mono_connections_col, mono_accounts_col, mono_transactions_col,
)
from app.services.mono_sync import sync_mono_connection, mono_headers
import httpx

router = APIRouter(tags=["mono"])


@router.get("/auth/mono/public-key")
async def mono_public_key(user: dict = Depends(current_user)):
    return {"public_key": MONO_PUBLIC_KEY}


@router.post("/auth/mono/exchange")
async def mono_exchange(body: dict, user: dict = Depends(current_user)):
    code = body.get("code")
    if not code:
        raise HTTPException(400, "code required")
    uid = user["email"]
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{MONO_API_URL}/accounts/auth",
            headers=mono_headers(),
            json={"code": code},
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Mono exchange failed: {r.text[:200]}")
    payload    = r.json()
    data       = payload.get("data", payload)
    account_id = data.get("id") or data.get("account_id") or data.get("accountId")
    if not account_id:
        raise HTTPException(502, "Mono did not return an account id")
    connection_id = f"mono-{account_id}"
    await mono_connections_col.update_one({"_id": connection_id}, {"$set": {
        "_id": connection_id, "user_id": uid,
        "mono_account_id": account_id,
        "provider_type": "mono",
        "created_at": datetime.now(),
    }}, upsert=True)
    asyncio.create_task(sync_mono_connection(connection_id, uid))
    return {"ok": True, "connection_id": connection_id}


@router.post("/mono/sync")
async def mono_sync_all(user: dict = Depends(current_user)):
    uid   = user["email"]
    conns = await mono_connections_col.find({"user_id": uid}).to_list(None)
    total = 0
    for c in conns:
        ids = await sync_mono_connection(c["_id"], uid)
        total += len(ids)
    return {"synced": total}


@router.get("/mono/accounts")
async def get_mono_accounts(user: dict = Depends(current_user)):
    uid  = user["email"]
    accs = await mono_accounts_col.find({"user_id": uid}).to_list(None)
    return [
        {"id": a["_id"], "name": a.get("name", "Account"), "type": a.get("type", "bank"),
         "balance": a.get("balance", 0), "currency": a.get("currency", "KES"),
         "provider": a.get("provider", "Mono"), "status": a.get("status", "connected"),
         "connection_id": a.get("connection_id")}
        for a in accs
    ]


@router.get("/mono/accounts/{account_id}/transactions")
async def get_mono_transactions(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await mono_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Account not found")
    txns = await mono_transactions_col.find(
        {"account_id": account_id, "user_id": uid}
    ).sort("date", -1).to_list(500)
    return [
        {"id": str(t["_id"]), "account_id": t["account_id"],
         "date": t["date"].isoformat(), "amount": t["amount"],
         "currency": t.get("currency", "KES"), "description": t.get("description", ""),
         "merchant_name": t.get("merchant_name"),
         "category": t.get("custom_category") or t.get("category"),
         "custom_category": t.get("custom_category"),
         "transaction_type": t.get("transaction_type", "debit")}
        for t in txns
    ]


@router.delete("/mono/connections/{connection_id}")
async def delete_mono_connection(connection_id: str, user: dict = Depends(current_user)):
    uid  = user["email"]
    conn = await mono_connections_col.find_one({"_id": connection_id, "user_id": uid})
    if not conn:
        raise HTTPException(404, "Connection not found")
    account_id = conn.get("mono_account_id")
    await mono_connections_col.delete_one({"_id": connection_id})
    if account_id:
        await mono_accounts_col.delete_one({"_id": account_id})
        await mono_transactions_col.delete_many({"account_id": account_id})
    return {"ok": True}
