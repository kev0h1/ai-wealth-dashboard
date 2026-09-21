"""Yapily open-banking sync."""
import asyncio
import base64
import hashlib
from datetime import datetime, timedelta
from typing import Optional
import httpx

from app.core.config import YAPILY_APP_UUID, YAPILY_SECRET, YAPILY_BASE_URL
from app.core.crypto import encrypt_token, decrypt_token, is_encrypted, token_fingerprint
from app.services.notifications import notify_after_sync
from app.db.collections import (
    yapily_accounts_col, yapily_transactions_col, yapily_consents_col,
)
from app.services.categorisation import rule_categorise, canonical_merchant_key


def yapily_headers(consent: str | None = None) -> dict:
    creds = base64.b64encode(f"{YAPILY_APP_UUID}:{YAPILY_SECRET}".encode()).decode()
    h = {"Authorization": f"Basic {creds}", "Content-Type": "application/json"}
    if consent:
        h["consent"] = consent
    return h


async def upgrade_legacy_consent(doc: dict) -> dict:
    """Rekey a pre-A30 consent row (Yapily's raw consent token used
    directly as `_id`, stored in the clear) to the hardened shape: `_id`
    becomes a non-reversible SHA-256 fingerprint of that token, and the
    actual token moves into a Fernet-encrypted `token` field, mirroring how
    TrueLayer's access/refresh tokens are encrypted (app.core.crypto).

    A document already in the new shape (has a `token` field) is returned
    unchanged. Idempotent and safe to call on every read.
    """
    if doc.get("token"):
        return doc
    raw = doc["_id"]
    new_id = token_fingerprint(raw)
    if new_id == raw:
        return doc  # already fingerprinted somehow; defensive no-op
    new_doc = {**doc, "_id": new_id, "token": encrypt_token(raw)}
    await yapily_consents_col.insert_one(new_doc)
    await yapily_consents_col.delete_one({"_id": raw})
    # yapily_accounts_col rows join on the consent id, not the token itself —
    # repoint them so the accounts list keeps resolving after the rekey.
    await yapily_accounts_col.update_many({"consent": raw}, {"$set": {"consent": new_id}})
    return new_doc


async def migrate_legacy_yapily_consents() -> int:
    """One-time/startup sweep: upgrade any pre-A30 plaintext consent rows
    that haven't been touched by a sync (and so haven't hit the lazy
    upgrade in _resolve_consent_token) yet. Returns the number upgraded."""
    count = 0
    async for doc in yapily_consents_col.find({"token": {"$exists": False}}):
        await upgrade_legacy_consent(doc)
        count += 1
    return count


async def _resolve_consent_token(consent_id: str) -> tuple[Optional[str], Optional[str]]:
    """Look up the raw Yapily consent token to send as the `consent`
    header, transparently handling both storage shapes. Returns
    (raw_token, effective_consent_id); (None, None) if the record is
    missing or its encrypted token can't be decrypted (wrong/rotated key —
    fails closed rather than returning something unusable)."""
    doc = await yapily_consents_col.find_one({"_id": consent_id})
    if not doc:
        return None, None
    doc = await upgrade_legacy_consent(doc)
    stored = doc.get("token")
    raw = decrypt_token(stored)
    if raw is None:
        return None, None
    if not is_encrypted(stored):
        # Defensive: a plaintext value somehow ended up in the `token`
        # field directly (rather than via the legacy `_id` path above).
        # Encrypt it in place so it doesn't linger in the clear.
        await yapily_consents_col.update_one({"_id": doc["_id"]}, {"$set": {"token": encrypt_token(raw)}})
    return raw, doc["_id"]


async def sync_yapily_consent(consent_token: str, user_id: str):
    raw_token, consent_token = await _resolve_consent_token(consent_token)
    if not raw_token:
        return
    headers = yapily_headers(raw_token)
    async with httpx.AsyncClient(timeout=30) as client:
        ar = await client.get(f"{YAPILY_BASE_URL}/accounts", headers=headers)
    if ar.status_code != 200:
        return
    accounts = ar.json().get("data", [])
    yapily_new_txns: list = []
    yapily_is_initial = not await yapily_transactions_col.find_one({"user_id": user_id})

    for acc in accounts:
        acc_id = acc.get("id")
        if not acc_id:
            continue
        balance = 0.0
        for b in acc.get("balances", []):
            try:
                balance = float(b.get("amount", 0)); break
            except Exception:
                pass
        currency      = acc.get("currency", "GBP")
        details       = acc.get("details", {})
        name          = details.get("name") or acc.get("nickname") or acc.get("type", "Account")
        institution_id = acc.get("institutionId", "")

        await yapily_accounts_col.update_one({"_id": acc_id}, {"$set": {
            "_id": acc_id, "user_id": user_id, "consent": consent_token,
            "name": name, "type": acc.get("type", "TRANSACTION").lower(),
            "balance": balance, "currency": currency,
            "institution_id": institution_id, "status": "connected",
            "updated_at": datetime.now(),
        }}, upsert=True)

        latest_yapily = await yapily_transactions_col.find_one(
            {"account_id": acc_id, "user_id": user_id},
            sort=[("date", -1)], projection={"date": 1},
        )
        txn_params: dict = {"accountId": acc_id, "limit": 500}
        if latest_yapily and latest_yapily.get("date"):
            last_dt = latest_yapily["date"]
            if isinstance(last_dt, datetime):
                from_dt = (last_dt - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                from_dt = str(last_dt)[:10] + "T00:00:00Z"
            txn_params["from"] = from_dt

        async with httpx.AsyncClient(timeout=30) as client:
            tr = await client.get(f"{YAPILY_BASE_URL}/transactions", headers=headers, params=txn_params)
        if tr.status_code != 200:
            continue

        for txn in tr.json().get("data", []):
            amt_obj = txn.get("amount", {})
            try:
                amount = abs(float(amt_obj.get("amount", txn.get("amount", 0))))
            except Exception:
                continue
            if amount <= 0:
                continue
            txn_type_raw = str(txn.get("transactionInformation", {}).get("type", txn.get("type", "DEBIT"))).upper()
            txn_type     = "credit" if txn_type_raw == "CREDIT" else "debit"
            desc         = (txn.get("description") or txn.get("reference") or
                            txn.get("proprietaryBankTransactionCode", {}).get("code") or "")
            merchant     = txn.get("merchant", {})
            merchant_name = merchant.get("name") if isinstance(merchant, dict) else None
            txn_id       = txn.get("id")
            if not txn_id:
                txn_id = hashlib.sha256(f"{acc_id}|{txn.get('date','')}|{amount}|{desc[:60]}".encode()).hexdigest()[:24]
            date_str = txn.get("date") or txn.get("bookingDateTime") or ""
            try:
                txn_date = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
            except Exception:
                txn_date = datetime.now()
            cat = rule_categorise(merchant_name or "", desc)
            yresult = await yapily_transactions_col.update_one({"_id": txn_id}, {"$set": {
                "account_id": acc_id, "user_id": user_id, "date": txn_date,
                "amount": amount,
                "currency": amt_obj.get("currency", currency) if isinstance(amt_obj, dict) else currency,
                "description": desc, "merchant_name": merchant_name,
                "category": cat, "transaction_type": txn_type,
                "merchant_key": canonical_merchant_key(merchant_name or "", desc),
            }, "$setOnInsert": {"custom_category": None}}, upsert=True)
            if yresult.upserted_id is not None:
                yapily_new_txns.append({
                    "description": desc, "merchant_name": merchant_name,
                    "amount": amount,
                    "currency": amt_obj.get("currency", currency) if isinstance(amt_obj, dict) else currency,
                })

    if yapily_new_txns and not yapily_is_initial and user_id and user_id != "unknown":
        asyncio.create_task(notify_after_sync(user_id, yapily_new_txns))
