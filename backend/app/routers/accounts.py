"""Accounts and connections endpoints."""
import asyncio
from datetime import datetime, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.models import Account
from app.db.collections import (
    connections_col, accounts_col, transactions_col,
    mono_connections_col, mono_accounts_col, mono_transactions_col,
    mpesa_accounts_col, mpesa_transactions_col,
    statement_accounts_col, statement_transactions_col,
    yapily_consents_col, yapily_accounts_col, yapily_transactions_col,
    account_rates_col,
)
from app.services.region import get_user_region
from app.services.truelayer_sync import sync_connection
from app.services.yapily_sync import sync_yapily_consent
from app.services.mono_sync import sync_mono_connection
from app.services.categorisation import apply_rules_bulk, categorise_others_bg

router = APIRouter(tags=["accounts"])


@router.get("/accounts", response_model=List[Account])
async def get_accounts(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)

    if region == "Kenya":
        mono_accs  = await mono_accounts_col.find({"user_id": uid}).to_list(None)
        mpesa_accs = await mpesa_accounts_col.find({"user_id": uid}).to_list(None)
        stmt_accs  = await statement_accounts_col.find({"user_id": uid, "region": "Kenya"}).to_list(None)
        result = []
        for a in mono_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "Account"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "KES"),
                provider=a.get("provider", "Mono"), status=a.get("status", "connected"),
                connection_id=a.get("connection_id", ""),
            ))
        for a in mpesa_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "M-Pesa"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "KES"),
                provider=a.get("provider", "MPesa"), status=a.get("status", "connected"),
                connection_id=a.get("connection_id", ""),
            ))
        for a in stmt_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "Bank Account"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "KES"),
                provider=a.get("provider", "BANK"), status=a.get("status", "connected"),
                connection_id="",
            ))
        return result

    docs = await accounts_col.find({"user_id": uid}).to_list(None)
    result = [Account(id=d["_id"], **{k: v for k, v in d.items() if k != "_id"}) for d in docs]
    stmt_accs = await statement_accounts_col.find({"user_id": uid, "region": "UK"}).to_list(None)
    for a in stmt_accs:
        result.append(Account(
            id=a["_id"], name=a.get("name", "Bank Account"), type=a.get("type", "bank"),
            balance=a.get("balance", 0), currency=a.get("currency", "GBP"),
            provider=a.get("provider", "BANK"), status=a.get("status", "connected"),
            connection_id="",
        ))
    yapily_accs = await yapily_accounts_col.find({"user_id": uid}).to_list(None)
    for a in yapily_accs:
        result.append(Account(
            id=a["_id"], name=a.get("name", "Account"), type=a.get("type", "bank"),
            balance=a.get("balance", 0), currency=a.get("currency", "GBP"),
            provider=a.get("institution_id", "YAPILY"), status=a.get("status", "connected"),
            connection_id=a.get("consent", ""),
        ))
    return result


@router.post("/accounts/sync")
async def sync_all(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)

    if region == "Kenya":
        conns = await mono_connections_col.find({"user_id": uid}).to_list(None)
        total = 0
        for conn in conns:
            ids = await sync_mono_connection(conn["_id"], uid)
            total += len(ids)
        return {"message": "Synced", "connections": len(conns), "total_accounts": total}

    conns = await connections_col.find({"user_id": uid}).to_list(None)
    total = 0
    for conn in conns:
        ids = await sync_connection(conn["_id"], uid)
        total += len(ids)
    yapily_conns = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        asyncio.create_task(sync_yapily_consent(yc["_id"], uid))

    async def _post_sync(u):
        await apply_rules_bulk(u, structural=True)
        await categorise_others_bg(u)
    asyncio.create_task(_post_sync(uid))
    return {"message": "Synced", "connections": len(conns), "total_accounts": total}


@router.post("/accounts/sync-history")
async def sync_history(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)

    if region == "Kenya":
        conns = await mono_connections_col.find({"user_id": uid}).to_list(None)
        total = 0
        for conn in conns:
            ids = await sync_mono_connection(conn["_id"], uid)
            total += len(ids)
        return {"message": "Full sync complete", "connections": len(conns), "total_accounts": total}

    conns   = await connections_col.find({"user_id": uid}).to_list(None)
    from_dt = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    total   = 0
    for conn in conns:
        ids = await sync_connection(conn["_id"], uid, from_date=from_dt)
        total += len(ids)
    yapily_conns = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        asyncio.create_task(sync_yapily_consent(yc["_id"], uid))

    async def _post_sync(u):
        await apply_rules_bulk(u, structural=True)
        await categorise_others_bg(u)
    asyncio.create_task(_post_sync(uid))
    return {"message": "Full sync complete", "connections": len(conns), "total_accounts": total}


@router.delete("/connections/{connection_id}")
async def delete_connection(connection_id: str, user: dict = Depends(current_user)):
    conn = await connections_col.find_one({"_id": connection_id, "user_id": user["email"]})
    if not conn:
        raise HTTPException(404, "Connection not found")
    account_ids = [d["_id"] async for d in accounts_col.find({"connection_id": connection_id}, {"_id": 1})]
    await transactions_col.delete_many({"account_id": {"$in": account_ids}})
    await accounts_col.delete_many({"connection_id": connection_id})
    await connections_col.delete_one({"_id": connection_id})
    return {"deleted": connection_id, "accounts_removed": len(account_ids)}


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]

    if account_id.startswith("mpesa-"):
        acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(404, "Account not found")
        await mpesa_transactions_col.delete_many({"account_id": account_id})
        await mpesa_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    if account_id.startswith("statement-"):
        acc = await statement_accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(404, "Account not found")
        await statement_transactions_col.delete_many({"account_id": account_id})
        await statement_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    mono_acc = await mono_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if mono_acc:
        conn = await mono_connections_col.find_one({"mono_account_id": account_id, "user_id": uid})
        await mono_transactions_col.delete_many({"account_id": account_id})
        await mono_accounts_col.delete_one({"_id": account_id})
        if conn:
            await mono_connections_col.delete_one({"_id": conn["_id"]})
        return {"deleted": account_id}

    yapily_acc = await yapily_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if yapily_acc:
        await yapily_transactions_col.delete_many({"account_id": account_id})
        await yapily_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    tl_acc = await accounts_col.find_one({"_id": account_id, "user_id": uid})
    if tl_acc:
        connection_id = tl_acc.get("connection_id")
        await transactions_col.delete_many({"account_id": account_id})
        await accounts_col.delete_one({"_id": account_id})
        if connection_id:
            remaining = await accounts_col.count_documents({"connection_id": connection_id})
            if remaining == 0:
                await connections_col.delete_one({"_id": connection_id})
        return {"deleted": account_id}

    mpesa_acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if mpesa_acc:
        await mpesa_transactions_col.delete_many({"account_id": account_id})
        await mpesa_accounts_col.delete_one({"_id": account_id})
        return {"deleted": account_id}

    raise HTTPException(404, "Account not found")


@router.get("/accounts/{account_id}/rate")
async def get_account_rate(account_id: str, user: dict = Depends(current_user)):
    rec = await account_rates_col.find_one({"user_id": user["email"], "account_id": account_id})
    return {"apr": rec["apr"] if rec else None}


@router.put("/accounts/{account_id}/rate")
async def set_account_rate(account_id: str, body: dict, user: dict = Depends(current_user)):
    uid     = user["email"]
    apr_val = body.get("apr")
    if apr_val is None:
        await account_rates_col.delete_one({"user_id": uid, "account_id": account_id})
        return {"apr": None}
    apr = float(apr_val)
    await account_rates_col.update_one(
        {"user_id": uid, "account_id": account_id},
        {"$set": {"apr": apr, "user_id": uid, "account_id": account_id}},
        upsert=True,
    )
    return {"apr": apr}


@router.get("/connections")
async def list_connections(user: dict = Depends(current_user)):
    conns  = await connections_col.find(
        {"user_id": user["email"]}, {"access_token": 0, "refresh_token": 0}
    ).to_list(None)
    result = []
    for c in conns:
        account_count = await accounts_col.count_documents({"connection_id": c["_id"]})
        result.append({"connection_id": c["_id"], "expires_at": c.get("expires_at"), "accounts": account_count})
    return result
