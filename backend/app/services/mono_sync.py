"""Mono (Kenya) open-banking sync."""
from datetime import datetime, timedelta
import httpx

from app.core.config import MONO_SECRET_KEY, MONO_API_URL
from app.db.collections import mono_connections_col, mono_accounts_col, mono_transactions_col
from app.services.categorisation import rule_categorise


def mono_headers() -> dict:
    return {"mono-sec-key": MONO_SECRET_KEY, "Content-Type": "application/json"}


async def sync_mono_connection(connection_id: str, user_id: str) -> list:
    conn = await mono_connections_col.find_one({"_id": connection_id})
    if not conn:
        return []
    account_id = conn["mono_account_id"]
    fetched    = []

    async with httpx.AsyncClient(timeout=30) as client:
        ar = await client.get(f"{MONO_API_URL}/accounts/{account_id}", headers=mono_headers())
        if ar.status_code == 200:
            payload     = ar.json()
            acc         = payload.get("data", payload)
            institution = acc.get("institution", {})
            if isinstance(institution, str):
                institution = {"name": institution}
            raw_bal  = acc.get("balance", 0)
            currency = acc.get("currency", "KES")
            balance  = raw_bal / 100 if raw_bal > 10000 else raw_bal
            await mono_accounts_col.update_one({"_id": account_id}, {"$set": {
                "_id": account_id, "connection_id": connection_id, "user_id": user_id,
                "name":     acc.get("name", "Account"),
                "type":     acc.get("type", "bank").lower().replace(" ", "_"),
                "balance":  balance, "currency": currency,
                "provider": institution.get("name", "Mono") if isinstance(institution, dict) else "Mono",
                "status":   "connected", "updated_at": datetime.now(),
            }}, upsert=True)
            fetched.append(account_id)

        latest_mono = await mono_transactions_col.find_one(
            {"account_id": account_id, "user_id": user_id},
            sort=[("date", -1)], projection={"date": 1},
        )
        mono_from_date: str | None = None
        if latest_mono and latest_mono.get("date"):
            last_dt = latest_mono["date"]
            mono_from_date = (last_dt - timedelta(days=1)).strftime("%Y-%m-%d") if isinstance(last_dt, datetime) else str(last_dt)[:10]

        for page in range(1, 6):
            txn_params: dict = {"page": page, "limit": 100}
            if mono_from_date:
                txn_params["start"] = mono_from_date
            tr = await client.get(
                f"{MONO_API_URL}/accounts/{account_id}/transactions",
                headers=mono_headers(), params=txn_params,
            )
            if tr.status_code != 200:
                break
            tr_payload = tr.json()
            results    = tr_payload.get("data", [])
            if not results:
                break
            for t in results:
                raw_amount   = abs(t.get("amount", 0))
                amount       = raw_amount / 100 if raw_amount > 10000 else raw_amount
                txn_type_raw = t.get("type", t.get("transaction_type", "debit")).lower()
                txn_type     = "credit" if txn_type_raw == "credit" else "debit"
                merchant     = t.get("merchant", {})
                merchant_name = merchant.get("name") if isinstance(merchant, dict) else None
                narration    = t.get("narration", t.get("description", t.get("note", "")))
                date_str     = t.get("date", t.get("created_at", t.get("timestamp", "")))
                try:
                    txn_date = datetime.fromisoformat(str(date_str).replace("Z", "+00:00"))
                except Exception:
                    txn_date = datetime.now()
                txn_id = str(t.get("_id", t.get("id", f"{account_id}-{date_str}-{raw_amount}")))
                cat    = rule_categorise(merchant_name or "", narration)
                await mono_transactions_col.update_one({"_id": txn_id}, {
                    "$set": {
                        "account_id": account_id, "user_id": user_id, "date": txn_date,
                        "amount": amount, "currency": t.get("currency", "KES"),
                        "description": narration, "merchant_name": merchant_name,
                        "category": cat, "transaction_type": txn_type,
                    },
                    "$setOnInsert": {"custom_category": None},
                }, upsert=True)
            meta = tr_payload.get("meta", {})
            if not meta.get("next") and len(results) < 100:
                break

    await mono_connections_col.update_one({"_id": connection_id}, {"$set": {"last_synced": datetime.now()}})
    return fetched
