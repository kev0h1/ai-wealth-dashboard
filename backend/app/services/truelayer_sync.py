"""TrueLayer bank sync — fetch accounts + transactions for a connection."""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional
import httpx

logger = logging.getLogger(__name__)

from app.core.config import (
    TRUELAYER_AUTH_URL, TRUELAYER_API_URL,
    TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET,
)
from app.services.notifications import notify_after_sync
from app.core.crypto import encrypt_token, decrypt_token
from app.db.collections import connections_col, accounts_col, transactions_col, excluded_accounts_col
from app.services.categorisation import rule_categorise, user_identity, is_own_transfer


async def save_connection(connection_id: str, token_data: dict, user_id: Optional[str] = None):
    update: dict = {
        "access_token":  encrypt_token(token_data["access_token"]),
        "refresh_token": encrypt_token(token_data.get("refresh_token")),
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
        return decrypt_token(conn["access_token"])
    refresh_token = decrypt_token(conn.get("refresh_token"))
    if not refresh_token:
        return None
    async with httpx.AsyncClient() as client:
        r = await client.post(
            f"{TRUELAYER_AUTH_URL}/connect/token",
            data={
                "grant_type":    "refresh_token",
                "client_id":     TRUELAYER_CLIENT_ID,
                "client_secret": TRUELAYER_CLIENT_SECRET,
                "refresh_token": refresh_token,
            },
        )
        if r.status_code == 200:
            await connections_col.update_one({"_id": connection_id}, {"$unset": {"needs_reauth": ""}})
            await save_connection(connection_id, r.json())
            return r.json()["access_token"]
    await connections_col.update_one({"_id": connection_id}, {"$set": {"needs_reauth": True}})
    return None


async def _upsert_transactions(txns: list, account_id: str, user_id: str, is_card: bool = False,
                               identity: dict | None = None) -> list:
    new_txns = []
    for txn in txns:
        merchant    = txn.get("merchant_name") or ""
        description = txn.get("description", "")
        raw_cat     = txn.get("transaction_category", "")
        is_credit   = (txn["amount"] < 0) if is_card else (txn["amount"] > 0)

        if is_credit:
            # Incoming money: try user rules first, then identity corroboration.
            # A credit whose description carries the user's OWN name is their own
            # transfer (e.g. "From Kevin Maingi"), not income. Peer payments don't
            # carry the owner's name, so the peer-payment trap (untrusted raw TRANSFER
            # tags) is unaffected. Don't trust the raw TRANSFER tag for credits —
            # peer payments (e.g. Monzo requests) get tagged TRANSFER by TrueLayer
            # but are Income.
            category = rule_categorise(merchant, description) or (
                "Transfer" if identity is not None and is_own_transfer(f"{merchant} {description}", identity)
                else "Income"
            )
        elif raw_cat == "TRANSFER":
            # Same distrust for debits: TrueLayer tags any P2P faster payment
            # TRANSFER, including money sent to other people. Only accept it
            # when the description corroborates the user's own identity —
            # otherwise it's real spend and must stay visible ("Other").
            category = rule_categorise(merchant, description) or (
                "Transfer" if identity is None or is_own_transfer(f"{merchant} {description}", identity)
                else "Other"
            )
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


async def cull_orphaned_connections(grace_hours: int = 24) -> int:
    """Delete completed connections that own no accounts.

    Reconnecting a bank creates a fresh connection; each sync claims accounts
    for the syncing connection (last-sync-wins), so superseded connections end
    up owning nothing. Grace period protects brand-new connections that
    haven't finished their first sync.
    """
    cutoff = datetime.utcnow() - timedelta(hours=grace_hours)
    query = {
        "access_token": {"$exists": True},
        "$or": [{"created_at": {"$lt": cutoff}}, {"created_at": None}, {"created_at": {"$exists": False}}],
    }
    deleted = 0
    async for conn in connections_col.find(query, {"_id": 1}):
        owns = await accounts_col.count_documents({"connection_id": conn["_id"]}, limit=1)
        if owns == 0:
            await connections_col.delete_one({"_id": conn["_id"]})
            deleted += 1
    if deleted:
        logger.info("Culled %d orphaned connections", deleted)
    return deleted


async def sync_connection(connection_id: str, user_id: Optional[str] = None, from_date: Optional[str] = None) -> list:
    """Fetch accounts + cards + transactions for one TrueLayer connection."""
    token = await get_valid_token(connection_id)
    if not token:
        return []

    conn_doc = await connections_col.find_one({"_id": connection_id}, {"user_id": 1, "last_synced": 1, "excluded_accounts": 1})
    if not user_id:
        user_id = (conn_doc or {}).get("user_id", "unknown")
    is_initial_sync = not (conn_doc or {}).get("last_synced")
    # Merge connection-level exclusions with the durable user-level list so
    # accounts the user removed stay gone even after a reconnect.
    conn_excluded  = set((conn_doc or {}).get("excluded_accounts") or [])
    user_excluded  = {
        d["account_id"] async for d in
        excluded_accounts_col.find({"user_id": user_id}, {"account_id": 1})
    } if user_id and user_id != "unknown" else set()
    excluded = conn_excluded | user_excluded
    identity = await user_identity(user_id) if user_id and user_id != "unknown" else None
    all_new_txns: list = []

    if from_date is None:
        last_synced = (conn_doc or {}).get("last_synced")
        if last_synced and isinstance(last_synced, datetime):
            from_date = (last_synced - timedelta(days=1)).strftime("%Y-%m-%d")
        else:
            from_date = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    to_date = datetime.now().strftime("%Y-%m-%d")
    headers = {"Authorization": f"Bearer {token}"}
    fetched = []

    async with httpx.AsyncClient(timeout=30) as client:
        accs_r, cards_r, me_r = await asyncio.gather(
            client.get(f"{TRUELAYER_API_URL}/data/v1/accounts", headers=headers),
            client.get(f"{TRUELAYER_API_URL}/data/v1/cards", headers=headers),
            client.get(f"{TRUELAYER_API_URL}/data/v1/me", headers=headers),
        )

        # Store TrueLayer's own identifiers — webhooks reference credentials_id,
        # not our internal connection id.
        if me_r.status_code == 200:
            me = (me_r.json().get("results") or [{}])[0]
            await connections_col.update_one({"_id": connection_id}, {"$set": {
                "credentials_id": me.get("credentials_id"),
                "provider":       me.get("provider", {}).get("provider_id") if isinstance(me.get("provider"), dict) else me.get("provider"),
            }})

        async def _latest_txn_date(account_id: str) -> str:
            latest = await transactions_col.find_one(
                {"account_id": account_id}, sort=[("date", -1)], projection={"date": 1}
            )
            if latest and latest.get("date"):
                # Re-fetch a rolling 7-day overlap, not just from the exact latest
                # date. Monzo card payments (and pot round-ups) pend then settle a
                # few days later carrying their ORIGINAL transaction date; without
                # the overlap the incremental cursor skips them permanently. Upserts
                # are keyed on transaction_id, so re-fetching is idempotent.
                overlap_start = (latest["date"] - timedelta(days=7)).strftime("%Y-%m-%d")
                # Never fetch a narrower window than the caller asked for — a
                # sync-history run passes a 90-day from_date to backfill gaps, and
                # that must win over the recent per-account cursor.
                return min(overlap_start, from_date)
            return from_date

        async def _fetch_txns(url: str, sync_from: str):
            # Some providers (e.g. Halifax) reject history requests that reach
            # back too far with a non-200 instead of truncating. Try the full
            # window first, then fall back to progressively narrower ones so we
            # store as much history as the bank will allow.
            candidates = [sync_from]
            for days in (60, 30, 14, 7):
                d = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
                if d > sync_from and d not in candidates:
                    candidates.append(d)
            resp = None
            for frm in candidates:
                resp = await client.get(url, headers=headers, params={"from": frm, "to": to_date})
                if resp.status_code == 200:
                    break
            return resp

        async def _sync_bank_account(acc: dict):
            account_id = acc["account_id"]
            if account_id in excluded:
                return None
            sync_from  = await _latest_txn_date(account_id)
            balance    = 0.0
            available  = None
            balance_ok = False
            try:
                br, tr = await asyncio.gather(
                    client.get(f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/balance", headers=headers),
                    _fetch_txns(f"{TRUELAYER_API_URL}/data/v1/accounts/{account_id}/transactions", sync_from),
                )
                if br.status_code == 200:
                    res = br.json().get("results", [])
                    if res:
                        balance    = res[0].get("current", 0.0)
                        available  = res[0].get("available")
                        balance_ok = True
                else:
                    logger.warning("Balance fetch failed for account %s: HTTP %s", account_id, br.status_code)
                if tr.status_code == 200:
                    new = await _upsert_transactions(tr.json().get("results", []), account_id, user_id, identity=identity)
                    all_new_txns.extend(new)
                else:
                    logger.warning("Transaction fetch failed for account %s: HTTP %s", account_id, tr.status_code)
            except Exception:
                logger.exception("Sync error for account %s", account_id)
            # Never overwrite a known balance with 0 from a failed fetch
            balance_fields = {"balance": balance, "available": available} if balance_ok else {}
            await accounts_col.update_one({"_id": account_id}, {
                "$set": {
                    "name":        acc.get("display_name", acc.get("account_type", "Account")),
                    "type":        "bank", "subtype": (acc.get("account_type") or "").upper(),
                    **balance_fields,
                    "currency":    acc.get("currency", "GBP"),
                    "provider":    acc.get("provider", {}).get("display_name", "Unknown"),
                    "provider_id": acc.get("provider", {}).get("provider_id"),
                    "status":      "connected",
                    "account_number": (acc.get("account_number") or {}).get("number"),
                    "sort_code":      (acc.get("account_number") or {}).get("sort_code"),
                    "connection_id": connection_id,
                    "updated_at":  datetime.now(),
                },
                "$setOnInsert": {
                    "_id": account_id, "user_id": user_id,
                },
            }, upsert=True)
            return account_id

        async def _sync_card(card: dict):
            card_id   = card["account_id"]
            if card_id in excluded:
                return None
            sync_from = await _latest_txn_date(card_id)
            balance    = 0.0
            available  = None
            balance_ok = False
            try:
                cbr, ctr = await asyncio.gather(
                    client.get(f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/balance", headers=headers),
                    _fetch_txns(f"{TRUELAYER_API_URL}/data/v1/cards/{card_id}/transactions", sync_from),
                )
                if cbr.status_code == 200:
                    res = cbr.json().get("results", [])
                    if res:
                        # TrueLayer's card "current" is positive when you owe the
                        # provider, negative when you're in credit (overpaid).
                        # Flip the sign (don't clamp with abs()) so an in-credit
                        # card correctly shows as a positive balance/asset rather
                        # than always looking like debt.
                        balance    = -float(res[0].get("current", 0.0) or 0.0)
                        available  = res[0].get("available")
                        balance_ok = True
                else:
                    logger.warning("Balance fetch failed for card %s: HTTP %s", card_id, cbr.status_code)
                if ctr.status_code == 200:
                    new = await _upsert_transactions(ctr.json().get("results", []), card_id, user_id, is_card=True, identity=identity)
                    all_new_txns.extend(new)
                else:
                    logger.warning("Transaction fetch failed for card %s: HTTP %s", card_id, ctr.status_code)
            except Exception:
                logger.exception("Sync error for card %s", card_id)
            balance_fields = {"balance": balance, "available": available} if balance_ok else {}
            await accounts_col.update_one({"_id": card_id}, {
                "$set": {
                    "name":        card.get("display_name", card.get("card_type", "Credit Card")),
                    "type":        "credit_card", "subtype": "CREDIT_CARD",
                    **balance_fields,
                    "currency":    card.get("currency", "GBP"),
                    "provider":    card.get("provider", {}).get("display_name", "Unknown"),
                    "provider_id": card.get("provider", {}).get("provider_id"),
                    "status":      "connected",
                    "account_number": card.get("partial_card_number"),
                    "connection_id": connection_id,
                    "sort_code":   None, "updated_at": datetime.now(),
                },
                "$setOnInsert": {
                    "_id": card_id, "user_id": user_id,
                },
            }, upsert=True)
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
            {"_id": connection_id}, {"$set": {"last_synced": datetime.utcnow()}}, upsert=True
        )

        if fetched:
            await accounts_col.update_many(
                {"connection_id": connection_id, "user_id": user_id, "_id": {"$nin": fetched}},
                {"$set": {"status": "expired"}},
            )
            await accounts_col.update_many(
                {"connection_id": connection_id, "user_id": user_id, "_id": {"$in": fetched}},
                {"$set": {"status": "connected"}},
            )

    if all_new_txns and not is_initial_sync and user_id and user_id != "unknown":
        asyncio.create_task(notify_after_sync(user_id, "UK", all_new_txns))

    return fetched, len(all_new_txns)
