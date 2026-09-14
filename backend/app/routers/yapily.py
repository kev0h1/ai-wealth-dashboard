"""Yapily auth + sync endpoints."""
import asyncio
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse

from app.core.auth import current_user
from app.core.config import YAPILY_APP_UUID, YAPILY_BASE_URL, APP_URL
from app.core.crypto import encrypt_token, token_fingerprint
from app.core.subscription import check_connection_limit, check_open_banking_allowed
from app.db.collections import yapily_consents_col, yapily_accounts_col, yapily_transactions_col
from app.services.yapily_sync import sync_yapily_consent, yapily_headers
import httpx

router = APIRouter(tags=["yapily"])


@router.get("/auth/yapily/institutions")
async def yapily_institutions(country: str = "GB", user: dict = Depends(current_user)):
    if not YAPILY_APP_UUID:
        raise HTTPException(503, "Yapily not configured")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{YAPILY_BASE_URL}/institutions",
            headers=yapily_headers(),
            params={"filtered-countries": country},
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Yapily institutions failed: {r.text[:200]}")
    result = []
    for inst in r.json().get("data", []):
        media = inst.get("media", [])
        logo  = next((m.get("source", "") for m in media if m.get("type") == "icon"), "")
        if not logo:
            logo = next((m.get("source", "") for m in media), "")
        result.append({"id": inst["id"], "name": inst.get("name", inst["id"]), "logo": logo, "countries": inst.get("countries", [])})
    return result


@router.post("/auth/yapily/requisition")
async def yapily_create_requisition(body: dict, user: dict = Depends(current_user)):
    institution_id = body.get("institution_id")
    if not institution_id:
        raise HTTPException(400, "institution_id required")
    uid = user["email"]
    await check_open_banking_allowed(uid)
    await check_connection_limit(uid)
    if not YAPILY_APP_UUID:
        raise HTTPException(503, "Yapily not configured")
    callback  = f"{APP_URL}/auth/yapily/callback"
    from_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%dT00:00:00Z")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{YAPILY_BASE_URL}/account-auth-requests",
            headers=yapily_headers(),
            json={
                "applicationUserId": uid[:36],
                "institutionId":     institution_id,
                "callback":          callback,
                "accountRequest":    {"transactionFrom": from_date},
            },
        )
    if r.status_code not in (200, 201):
        raise HTTPException(502, f"Yapily auth request failed: {r.text[:300]}")
    data          = r.json().get("data", {})
    consent_token = data.get("id")
    auth_url      = data.get("authorisationUrl")
    consent_id    = None
    if consent_token:
        # The consent token Yapily hands back doubles as a bearer credential
        # (sent verbatim as the `consent` header on every accounts/transactions
        # call) AND, historically, as our own lookup key. It can't be stored
        # in the clear (A30) or used as `_id` directly (Fernet ciphertext
        # isn't exact-match queryable) — so `_id` is a non-reversible
        # fingerprint of it, and the recoverable value lives encrypted in
        # `token`. See app.services.yapily_sync for the read/decrypt side.
        consent_id = token_fingerprint(consent_token)
        await yapily_consents_col.update_one({"_id": consent_id}, {"$set": {
            "_id": consent_id, "user_id": uid,
            "institution_id": institution_id,
            "status": "AWAITING_AUTHORIZATION",
            "created_at": datetime.now(),
            "token": encrypt_token(consent_token),
        }}, upsert=True)
    return {"link": auth_url, "requisition_id": consent_id}


@router.get("/auth/yapily/callback")
async def yapily_callback(consent: str = "", error: str = ""):
    if consent:
        consent_id = token_fingerprint(consent)
        doc = await yapily_consents_col.find_one({"_id": consent_id})
        if not doc:
            # Transitional fallback for a row created before this fingerprint
            # scheme (or, in principle, a callback racing a deploy): the row
            # may still be keyed by the raw value Yapily just sent us.
            legacy_doc = await yapily_consents_col.find_one({"_id": consent})
            if legacy_doc:
                doc, consent_id = legacy_doc, consent
        if doc:
            await yapily_consents_col.update_one({"_id": consent_id}, {"$set": {"status": "AUTHORIZED"}})
            asyncio.create_task(sync_yapily_consent(consent_id, doc["user_id"]))
    return RedirectResponse(url=f"{APP_URL}/accounts?yapily=connected")


@router.post("/yapily/sync")
async def yapily_sync_all(user: dict = Depends(current_user)):
    uid      = user["email"]
    consents = await yapily_consents_col.find({"user_id": uid, "status": "AUTHORIZED"}).to_list(None)
    for c in consents:
        asyncio.create_task(sync_yapily_consent(c["_id"], uid))
    return {"message": f"Syncing {len(consents)} Yapily connections"}


@router.delete("/yapily/connections/{consent_token}")
async def yapily_delete_connection(consent_token: str, user: dict = Depends(current_user)):
    uid = user["email"]
    doc = await yapily_consents_col.find_one({"_id": consent_token, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Not found")
    accs = await yapily_accounts_col.find({"consent": consent_token, "user_id": uid}).to_list(None)
    for acc in accs:
        await yapily_transactions_col.delete_many({"account_id": acc["_id"]})
        await yapily_accounts_col.delete_one({"_id": acc["_id"]})
    await yapily_consents_col.delete_one({"_id": consent_token})
    return {"deleted": consent_token}
