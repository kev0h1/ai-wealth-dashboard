"""TrueLayer bank sync — fetch accounts + transactions for a connection."""
import asyncio
from datetime import datetime, timedelta
from typing import Optional
import httpx

from app.core.config import (
    TRUELAYER_AUTH_URL, TRUELAYER_API_URL,
    TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET,
)
from app.core.push import notify_new_transactions
from app.db.collections import connections_col, accounts_col, transactions_col
from app.services.categorisation import rule_categorise


async def save_connection(connection_id: str, token_data: dict, user_id: Optional[str] = None):
    update: dict = {
        "access_token":  token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_at":    datetime.now() + timedelta(seconds=token_data.get("expires_in", 3600)),
        "updated_at":    datetime.now(),
    }
    if user_id:
        update["user_id"] = user_id
    await connections_col.update_one({"_id": connection_id}, {"$set": update}, upsert=True)


async def get_valid_token(connection_id: str) -> Optional[str]:
    conn = await connections_col.find_one({"_id": connection_id})
    if not conn or "expires_at" not in conn or "access_token" not in conn:
        return None
    if datetime.now() < conn["expires_at"]:
        return conn["access_token"]
    if not conn.get("refresh_token"):
        return None
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type":    "refresh_token",
                "client_id":     TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "refresh_token": conn["refresh_token"],
            },
        )
        if r.status_code == 200:
            await connections_col.update_one({"_id": connection_id}, {"$unset": {"needs_reauth": ""}})
            await save_connection(connection_id, r.json())
            return r.json()["access_token"]
    await connections_col.update_one({"_id": connection_id}, {"$set": {"needs_reauth": True}})
    return None


async def _upsert_transactions(txns: list, account_id: str, user_id: str, is_card: bool = False) -> list:
    new_txns = []
    for txn in txns:
        merchant    = txn.get("merchant_name") or ""
        description = txn.get("description", "")
        raw_cat     = txn.get("transaction_category", "")
        is_credit   = (txn["amount"] < 0) if is_card else (txn["amount"] > 0)

        if raw_cat == "TRANSFER":
            category = "Transfer"
        elif is_credit:
            category = rule_categorise(merchant, description) or "Transfer"
        else:
            category = rule_categorise(merchant, description) or None

        tdoc = {
            "account_id":       account_id,
            "user_id":          user_id,
            "date":             datetime.fromisoformat(txn["timestamp"].replace("Z", "+00:00")),
            "amount":           abs(txn["amount"]),
            "currency":         txn["currency"],
            "description":      description,
            "merchant_name":    merchant or None,
            "category":         category,
            "transaction_type": "credit" if is_credit else "debit",
        }
        result = await transactions_col.update_one(
            {"_id": txn["transaction_id"]},
            {"$set": tdoc, "$setOnInsert": {"_id": txn["transaction_id"], "custom_category": None}},
            upsert=True,
        )
        if result.upserted_id is not None:
            new_txns.append({
                "description":   description,
                "merchant_name": merchant or None,
                "amount":        abs(txn["amount"]),
                "currency":      txn["currency"],
            })
    return new_txns


async def sync_connection(connection_id: str, user_id: Optional[str] = None, from_date: Optional[str] = None) -> list:
    """Fetch accounts + cards + transactions for one TrueLayer connection."""
    token = await get_valid_token(connection_id)
    if not token:
        return []

    conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1, "last_synced": 1})
    if not user_id:
        user_id = (conn_doc or {}).get("user_id", "unknown")
    is_initial_sync = not (conn_doc or {}).get("last_synced")
    all_new_txns: list = []

    if from_date is None:
        last_synced = (conn_doc or {}).get("last_synced")
        if last_synced and isinstance(last_synced, datetime):
            from_date = (last_synced - timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            from_date = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    to_date = datetime.now().strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {token}"}
    fetched = []

    async with httpx.AsyncClient(timeout=30) as client:
        accs_r, cards_r = await asyncio.gather(
            client.get(f"{TRUELAYER_API_URL}/data/v1/accounts", headers=headers),
            client.get(f"{TRUELAYER_API_URL}/data/v1/cards", headers=headers),
        )

        async def _latest_txn_date(account_id: str) -> str:
            latest = await transactions_col.find_one(
                {"account_id": account_id}, sort=[("date", -1)], projection={"date": 1}
            )
            if latest and latest.get("date"):
                return latest["date"].strftime("%Y-%m-%d")
            return from_date

        async def _sync_bank_account(acc: dict):
            account_id = acc["account_id"]
            sync_from  = await _latest_txn_date(account_id)
            balance    = 0.0
            try:
                br, tr = await asyncio.gather(
                    client.get(f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/balance", headers=headers),
                    client.get(f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/transactions",
                               headers=headers, params={"from": sync_from, "to": to_date}),
                )
                if br.status_code == 200:
                    res = br.json().get("results", [])
                    if res:
                        balance = res[0].get("current", 0.0)
                if tr.status_code == 200:
                    new = await _upsert_transactions(tr.json().get("results", []), account_id, user_id)
                    all_new_txns.extend(new)
            except Exception:
                pass
            await accounts_col.update_one({"_id": account_id}, {"$set": {
                "_id": account_id, "connection_id": connection_id, "user_id": user_id,
                "name":     acc.get("display_name", acc.get("account_type", "Account")),
                "type":     "bank", "balance": balance,
                "currency": acc.get("currency", "GBP"),
                "provider": acc.get("provider", {}).get("display_name", "Unknown"),
                "provider_id": acc.get("provider", {}).get("provider_id"),
                "status":   "connected",
                "account_number": (acc.get("account_number") or {}).get("number"),
                "sort_code":      (acc.get("account_number") or {}).get("sort_code"),
                "updated_at": datetime.now(),
            }}, upsert=True)
            return account_id

        async def _sync_card(card: dict):
            card_id   = card["account_id"]
            sync_from = await _latest_txn_date(card_id)
            balance   = 0.0
            try:
                cbr, ctr = await asyncio.gather(
                    client.get(f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/balance", headers=headers),
                    client.get(f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/transactions",
                               headers=headers, params={"from": sync_from, "to": to_date}),
                )
                if cbr.status_code == 200:
                    res = cbr.json().get("results", [])
                    if res:
                        balance = -abs(res[0].get("current", 0.0))
                if ctr.status_code == 200:
                    new = await _upsert_transactions(ctr.json().get("results", []), card_id, user_id, is_card=True)
                    all_new_txns.extend(new)
            except Exception:
                pass
            await accounts_col.update_one({"_id": card_id}, {"$set": {
                "_id": card_id, "connection_id": connection_id, "user_id": user_id,
                "name":     card.get("display_name", card.get("card_type", "Credit Card")),
                "type":     "credit_card", "balance": balance,
                "currency": card.get("currency", "GBP"),
                "provider": card.get("provider", {}).get("display_name", "Unknown"),
                "provider_id": card.get("provider", {}).get("provider_id"),
                "status":   "connected",
                "account_number": card.get("partial_card_number"),
                "sort_code":  None, "updated_at": datetime.now(),
            }}, upsert=True)
            return card_id

        bank_accs = accs_r.json().get("results", [])  if accs_r.status_code  == 200 else []
        card_accs = cards_r.json().get("results", []) if cards_r.status_code == 200 else []

        results = await asyncio.gather(
            *[_sync_bank_account(a) for a in bank_accs],
            *[_sync_card(c) for c in card_accs],
            return_exceptions=True,
        )
        fetched = [r for r in results if isinstance(r, str)]

        await connections_col.update_one(
            {"_id": connection_id}, {"$set": {"last_synced": datetime.now()}}, upsert=True
        )

        if fetched:
            await accounts_col.update_many(
                {"connection_id": connection_id, "_id": {"$nin": fetched}},
                {"$set": {"status": "expired"}},
            )
            await accounts_col.update_many(
                {"connection_id": connection_id, "_id": {"$in": fetched}},
                {"$set": {"status": "connected"}},
            )

    if all_new_txns and not is_initial_sync and user_id and user_id != "unknown":
        asyncio.create_task(notify_new_transactions(user_id, all_new_txns))

    return fetched
