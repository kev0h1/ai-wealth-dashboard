"""Accounts and connections endpoints."""
import asyncio
import logging
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
    account_rates_col, manual_accounts_col, cashflow_cache_col,
    excluded_accounts_col,
)
from app.services.region import get_user_region
from app.services.truelayer_sync import sync_connection
from app.services.yapily_sync import sync_yapily_consent
from app.services.mono_sync import sync_mono_connection
from app.db.collections import finexer_consents_col as _finexer_consents_col
from app.services.finexer_sync import finexer_sync_pipeline as _finexer_sync_pipeline
from app.services.categorisation import apply_rules_bulk, categorise_others_bg
from app.services.manual_account_rules import apply_rules as apply_mirror_rules
from app.services import response_cache
from app.routers.analytics import compute_and_cache_cashflow
from app.services.planned import settle_planned_expenses
from app.services.account_cascade import cascade_account_deletion

router = APIRouter(tags=["accounts"])
logger = logging.getLogger(__name__)


async def _attach_aprs(uid: str, result: List[Account]) -> List[Account]:
    rates = await account_rates_col.find({"user_id": uid}).to_list(None)
    rate_map = {r["account_id"]: r.get("apr") for r in rates}
    for acc in result:
        if acc.id in rate_map:
            acc.apr = rate_map[acc.id]
    return result


def _manual_to_account(a: dict, currency: str) -> Account:
    at = a.get("account_type", "savings")
    if at == "credit_card":
        return Account(
            id=a["_id"], name=a.get("name", "Account"), type="credit_card",
            subtype="CREDIT_CARD", balance=-abs(a.get("balance", 0)),
            currency=currency, provider="Offline", status="connected", manual=True,
        )
    return Account(
        id=a["_id"], name=a.get("name", "Account"), type="bank",
        subtype="SAVINGS" if at == "savings" else "TRANSACTION",
        balance=a.get("balance", 0), currency=currency,
        provider="Offline", status="connected", manual=True,
    )


async def _manual_accounts(uid: str, currency: str) -> List[Account]:
    docs = await manual_accounts_col.find({"user_id": uid}).to_list(None)
    return [_manual_to_account(a, currency) for a in docs]


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
        result.extend(await _manual_accounts(uid, "KES"))
        return await _attach_aprs(uid, result)

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
    # Only include Yapily accounts if the user has an active Yapily consent.
    # Stale records from past Yapily connections (consent since deleted) must
    # not surface — they create phantom duplicates of TrueLayer accounts.
    has_yapily_consent = await yapily_consents_col.count_documents(
        {"user_id": uid, "status": "AUTHORIZED"}
    ) > 0
    if has_yapily_consent:
        yapily_accs = await yapily_accounts_col.find({"user_id": uid}).to_list(None)
        for a in yapily_accs:
            result.append(Account(
                id=a["_id"], name=a.get("name", "Account"), type=a.get("type", "bank"),
                balance=a.get("balance", 0), currency=a.get("currency", "GBP"),
                provider=a.get("institution_id", "YAPILY"), status=a.get("status", "connected"),
                connection_id=a.get("consent", ""),
            ))
    result.extend(await _manual_accounts(uid, "GBP"))
    return await _attach_aprs(uid, result)


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
        asyncio.create_task(apply_mirror_rules(uid))
        response_cache.invalidate(uid)
        return {"message": "Synced", "connections": len(conns), "total_accounts": total}

    conns = await connections_col.find({"user_id": uid}).to_list(None)
    total = 0
    total_new_txns = 0
    for conn in conns:
        ids, new_count = await sync_connection(conn["_id"], uid)
        total += len(ids)
        total_new_txns += new_count
    yapily_conns = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        asyncio.create_task(sync_yapily_consent(yc["_id"], uid))

    finexer_conns = await _finexer_consents_col.find({"user_id": uid, "status": "authorized"}).to_list(None)
    for fc in finexer_conns:
        asyncio.create_task(_finexer_sync_pipeline(fc["_id"], uid))

    async def _post_sync(u, has_new: bool):
        await apply_rules_bulk(u, structural=True)
        await categorise_others_bg(u)
        await apply_mirror_rules(u)
        # Always stamp sync time so the staleness clock resets even with no new data
        await cashflow_cache_col.update_one(
            {"_id": u}, {"$set": {"synced_at": datetime.now()}}, upsert=True,
        )
        if has_new:
            await compute_and_cache_cashflow(u)
        await settle_planned_expenses(u)
        # Categorisation/rules may have shifted things even without new txns
        response_cache.invalidate(u)
    asyncio.create_task(_post_sync(uid, total_new_txns > 0))
    # Balances were refreshed above — the immediate post-sync reload must not
    # be served a pre-sync cached response
    response_cache.invalidate(uid)
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
    total_new_txns = 0
    for conn in conns:
        ids, new_count = await sync_connection(conn["_id"], uid, from_date=from_dt)
        total += len(ids)
        total_new_txns += new_count
    yapily_conns = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        asyncio.create_task(sync_yapily_consent(yc["_id"], uid))

    async def _post_sync(u, has_new: bool):
        await apply_rules_bulk(u, structural=True)
        await categorise_others_bg(u)
        await apply_mirror_rules(u)
        await cashflow_cache_col.update_one(
            {"_id": u}, {"$set": {"synced_at": datetime.now()}}, upsert=True,
        )
        if has_new:
            await compute_and_cache_cashflow(u)
        await settle_planned_expenses(u)
        response_cache.invalidate(u)
    asyncio.create_task(_post_sync(uid, total_new_txns > 0))
    response_cache.invalidate(uid)
    return {"message": "Full sync complete", "connections": len(conns), "total_accounts": total}


@router.delete("/connections/{connection_id}")
async def delete_connection(connection_id: str, user: dict = Depends(current_user)):
    uid = user["email"]

    # ── TrueLayer path ────────────────────────────────────────────────────────
    conn = await connections_col.find_one({"_id": connection_id, "user_id": uid})
    if conn:
        account_ids = [d["_id"] async for d in accounts_col.find({"connection_id": connection_id}, {"_id": 1})]
        await cascade_account_deletion(uid, account_ids)
        await connections_col.delete_one({"_id": connection_id})
        return {"deleted": connection_id, "accounts_removed": len(account_ids)}

    # ── Finexer path ──────────────────────────────────────────────────────────
    consent = await _finexer_consents_col.find_one({"_id": connection_id, "user_id": uid})
    if consent:
        account_ids = [d["_id"] async for d in accounts_col.find({"connection_id": connection_id, "user_id": uid}, {"_id": 1})]
        await cascade_account_deletion(uid, account_ids)
        # Best-effort remote revoke (non-fatal)
        try:
            from app.services.finexer_sync import _client as _fx_client
            async with _fx_client() as fxc:
                rv = await fxc.delete(f"/consents/{connection_id}")
                if rv.status_code not in (200, 204, 404):
                    logger.warning("Finexer revoke %s returned HTTP %s", connection_id, rv.status_code)
        except Exception:
            logger.warning("Finexer revoke failed for consent %s (non-fatal)", connection_id, exc_info=True)
        await _finexer_consents_col.delete_one({"_id": connection_id})
        return {"deleted": connection_id, "accounts_removed": len(account_ids)}

    raise HTTPException(404, "Connection not found")


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]

    if account_id.startswith("mpesa-"):
        acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(404, "Account not found")
        await cascade_account_deletion(uid, [account_id], acc_col=mpesa_accounts_col, txn_col=mpesa_transactions_col)
        return {"deleted": account_id}

    if account_id.startswith("statement-"):
        acc = await statement_accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not acc:
            raise HTTPException(404, "Account not found")
        await cascade_account_deletion(uid, [account_id], acc_col=statement_accounts_col, txn_col=statement_transactions_col)
        return {"deleted": account_id}

    mono_acc = await mono_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if mono_acc:
        conn = await mono_connections_col.find_one({"mono_account_id": account_id, "user_id": uid})
        await cascade_account_deletion(uid, [account_id], acc_col=mono_accounts_col, txn_col=mono_transactions_col)
        if conn:
            await mono_connections_col.delete_one({"_id": conn["_id"]})
        return {"deleted": account_id}

    # Yapily: clean up stale record AND run cascade for its provider collections.
    # Then fall through — a Yapily account may also have a TrueLayer exclusion row
    # that needs to be written (legacy pattern from older codebase).
    yapily_acc = await yapily_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if yapily_acc:
        await cascade_account_deletion(
            uid, [account_id],
            acc_col=yapily_accounts_col,
            txn_col=yapily_transactions_col,
        )
        # Fall through to TrueLayer exclusion path below (if a TrueLayer account
        # exists with this id), otherwise return here.
        tl_also = await accounts_col.find_one({"_id": account_id, "user_id": uid})
        if not tl_also:
            return {"deleted": account_id}

    tl_acc = await accounts_col.find_one({"_id": account_id, "user_id": uid})
    if tl_acc:
        connection_id = tl_acc.get("connection_id")

        # Persist exclusion at the user level so reconnects don't resurrect it.
        await excluded_accounts_col.update_one(
            {"user_id": uid, "account_id": account_id},
            {"$set": {"user_id": uid, "account_id": account_id, "excluded_at": datetime.now()}},
            upsert=True,
        )

        # Detect provider: TrueLayer connection vs Finexer consent
        if connection_id:
            tl_conn = await connections_col.find_one({"_id": connection_id})
            if tl_conn:
                # TrueLayer path: record exclusion on connection
                await connections_col.update_one(
                    {"_id": connection_id},
                    {"$addToSet": {"excluded_accounts": account_id}},
                )
            else:
                # Finexer path: record exclusion on consent doc
                fx_consent = await _finexer_consents_col.find_one({"_id": connection_id})
                if fx_consent:
                    await _finexer_consents_col.update_one(
                        {"_id": connection_id},
                        {"$addToSet": {"excluded_accounts": account_id}},
                    )

        # Run cascade (deletes txns + account doc + derived state)
        await cascade_account_deletion(uid, [account_id])

        # If this was the last account on the connection, clean up the connection doc
        if connection_id:
            remaining = await accounts_col.count_documents({"connection_id": connection_id})
            if remaining == 0:
                tl_conn = await connections_col.find_one({"_id": connection_id})
                if tl_conn:
                    await connections_col.delete_one({"_id": connection_id})
                else:
                    # Finexer: best-effort remote revoke + delete consent
                    fx_consent = await _finexer_consents_col.find_one({"_id": connection_id})
                    if fx_consent:
                        try:
                            from app.services.finexer_sync import _client as _fx_client
                            async with _fx_client() as fxc:
                                rv = await fxc.delete(f"/consents/{connection_id}")
                                if rv.status_code not in (200, 204, 404):
                                    logger.warning("Finexer revoke %s returned HTTP %s", connection_id, rv.status_code)
                        except Exception:
                            logger.warning("Finexer revoke failed for %s (non-fatal)", connection_id, exc_info=True)
                        await _finexer_consents_col.delete_one({"_id": connection_id})

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
