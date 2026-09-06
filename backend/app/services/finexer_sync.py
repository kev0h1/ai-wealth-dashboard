"""Finexer open-banking sync — HTTP Basic auth, consent-based flow."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

from app.core.config import FINEXER_API_KEY, FINEXER_API_URL, FINEXER_RETURN_URL
from app.db.collections import (
    finexer_consents_col, finexer_customers_col,
    accounts_col, transactions_col,
)
from app.services.categorisation import rule_categorise, user_identity, is_own_transfer, canonical_merchant_key
from app.services.notifications import notify_after_sync
from app.services.pending_transactions import replace_pending_for_account


def _client() -> httpx.AsyncClient:
    """Authenticated Finexer HTTP client (HTTP Basic: key as username, empty password)."""
    return httpx.AsyncClient(
        base_url=FINEXER_API_URL,
        auth=(FINEXER_API_KEY, ""),
        timeout=30,
    )


async def list_providers() -> list[dict]:
    """Return all AIS-capable providers from GET /providers (paginated)."""
    providers = []
    offset = 0
    async with _client() as client:
        while True:
            r = await client.get("/providers", params={"offset": offset})
            if r.status_code != 200:
                logger.warning("Finexer /providers failed: HTTP %s %s", r.status_code, r.text[:200])
                break
            data = r.json()
            items = data.get("data") or []
            for p in items:
                if "ais" in (p.get("roles") or []):
                    providers.append({
                        "id":       p["id"],
                        "name":     p.get("name", p["id"]),
                        "logo":     p.get("logo_url", ""),
                        "bg_colors": p.get("bg_colors") or [],
                    })
            paging = data.get("paging") or {}
            if not paging.get("next"):
                break
            offset += len(items)
            if not items:
                break
    return providers


async def get_or_create_customer(user: dict) -> str:
    """Look up or create a Finexer customer record for this app user."""
    user_id = user["email"]
    doc = await finexer_customers_col.find_one({"_id": user_id})
    if doc:
        return doc["customer_id"]

    name  = user.get("name") or user["email"]
    email = user["email"]
    async with _client() as client:
        r = await client.post(
            "/customers",
            data={
                "name":             name,
                "email":            email,
                "metadata[app_user]": email,
            },
        )
        if r.status_code not in (200, 201):
            logger.error("Finexer POST /customers failed: HTTP %s %s", r.status_code, r.text[:400])
            raise RuntimeError(f"Finexer customer creation failed: {r.status_code}")
        customer = r.json()
        customer_id = customer["id"]

    await finexer_customers_col.update_one(
        {"_id": user_id},
        {"$set": {"customer_id": customer_id, "created_at": datetime.utcnow()}},
        upsert=True,
    )
    return customer_id


async def create_consent(
    user_id: str,
    customer_id: str,
    provider: Optional[str],
    state: str,
) -> dict:
    """Create a Finexer consent and return the full consent dict."""
    return_url = f"{FINEXER_RETURN_URL}?state={state}"
    data: dict = {
        "customer":   customer_id,
        "return_url": return_url,
    }
    if provider:
        data["provider"] = provider

    async with _client() as client:
        r = await client.post("/consents", data=data)
        if r.status_code not in (200, 201):
            logger.error("Finexer POST /consents failed: HTTP %s %s", r.status_code, r.text[:400])
            raise RuntimeError(f"Finexer consent creation failed: {r.status_code}")
        return r.json()


def _infer_transaction_type(txn: dict) -> str:
    """Infer 'credit' or 'debit' from amount sign or a type field."""
    # Finexer field names not yet confirmed — check common candidates defensively
    txn_type = (txn.get("type") or txn.get("transaction_type") or "").lower()
    if txn_type in ("credit", "debit"):
        return txn_type
    amount = txn.get("amount", 0)
    try:
        return "credit" if float(amount) > 0 else "debit"
    except (TypeError, ValueError):
        return "debit"


def _parse_iso_utc(s) -> Optional[datetime]:
    """Parse an ISO 8601 timestamp (optionally trailing 'Z') to a NAIVE UTC
    datetime, matching this codebase's convention of storing naive UTC in
    Mongo. Returns None if absent or unparseable."""
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


def _parse_date(txn: dict) -> datetime:
    """Parse transaction date from possible field names."""
    raw = (
        txn.get("date")
        or txn.get("timestamp")
        or txn.get("created_at")
        or txn.get("booking_date")
        or txn.get("value_date")
    )
    if not raw:
        return datetime.utcnow()
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return datetime.utcnow()


async def _upsert_finexer_transactions(
    txns: list,
    account_id: str,
    user_id: str,
    identity: dict | None = None,
) -> tuple[list, list]:
    """Upsert SETTLED transactions into unified transactions_col; a row whose
    `status` field (UK Open Banking "Booked"/"Pending") reads "pending" is
    routed to the sibling pending collection instead — see
    app/services/pending_transactions.py's module docstring for why it must
    never enter transactions_col (recurring detection/categorisation
    learning/spend history would all treat a provisional debit as real).
    Any other/absent status (e.g. "booked") takes the existing settled path
    unchanged. Returns (new_txn_summaries, pending_rows) — `pending_rows` is
    the normalised shape `replace_pending_for_account` expects."""
    new_txns = []
    pending_rows = []
    for txn in txns:
        # Defensive field mapping — exact names TBD until first sandbox login
        txn_id = (
            txn.get("id")
            or txn.get("transaction_id")
            or txn.get("reference")
        )
        if not txn_id:
            logger.warning("Finexer transaction missing id: %s", txn)
            continue

        description  = txn.get("description") or txn.get("reference") or txn.get("narrative") or ""
        merchant     = txn.get("merchant_name") or txn.get("merchant") or txn.get("counterparty_name") or ""

        if (txn.get("status") or "").strip().lower() == "pending":
            pending_rows.append({
                "transaction_id":   txn_id,
                "date":             _parse_date(txn),
                "amount":           txn.get("amount", 0),
                "description":      description,
                "merchant_name":    merchant,
                "transaction_type": _infer_transaction_type(txn),
            })
            continue

        raw_amount   = txn.get("amount", 0)
        try:
            amount = abs(float(raw_amount))
        except (TypeError, ValueError):
            amount = 0.0
        currency = (txn.get("currency") or "GBP").upper()
        txn_type = _infer_transaction_type(txn)
        running_balance = txn.get("balance")

        is_credit = txn_type == "credit"
        if is_credit:
            # Incoming money: try user rules first, then identity corroboration.
            # A credit whose description carries the user's OWN name is their own
            # transfer (e.g. "From Kevin Maingi"), not income. Peer payments don't
            # carry the owner's name, so the peer-payment trap (untrusted raw TRANSFER
            # tags) is unaffected.
            category = rule_categorise(merchant, description) or (
                "Transfer" if identity is not None and is_own_transfer(f"{merchant} {description}", identity, own_account_id=account_id)
                else "Income"
            )
        else:
            category = rule_categorise(merchant, description) or None

        tdoc: dict = {
            "account_id":       account_id,
            "user_id":          user_id,
            "date":             _parse_date(txn),
            "amount":           amount,
            "currency":         currency,
            "description":      description,
            "merchant_name":    merchant or None,
            "category":         category,
            "transaction_type": txn_type,
            "provider":         "Finexer",
            "merchant_key":     canonical_merchant_key(merchant, description),
        }
        if running_balance is not None:
            try:
                tdoc["running_balance"] = float(running_balance)
            except (TypeError, ValueError):
                pass

        result = await transactions_col.update_one(
            {"_id": txn_id},
            {"$set": tdoc, "$setOnInsert": {"_id": txn_id, "custom_category": None}},
            upsert=True,
        )
        if result.upserted_id is not None:
            new_txns.append({
                "description":   description,
                "merchant_name": merchant or None,
                "amount":        amount,
                "currency":      currency,
            })
    return new_txns, pending_rows


async def _mark_finexer_accounts_expired(consent_id: str) -> None:
    """Flag every account on this consent so the existing "needs reconnecting"
    banner fires (the UI reads status), mirroring truelayer_sync.py."""
    await accounts_col.update_many(
        {"connection_id": consent_id},
        {"$set": {"status": "expired"}},
    )


async def sync_finexer_consent(consent_id: str, user_id: str) -> tuple[list, int]:
    """
    Sync all accounts and transactions for one Finexer consent.
    Returns (account_ids_fetched, new_txn_count).
    """
    # ── Guard: do not sync a consent that was locally deleted/revoked ────────
    local_consent = await finexer_consents_col.find_one({"_id": consent_id})
    if not local_consent or local_consent.get("status") != "authorized":
        logger.info(
            "Finexer consent %s is absent or non-authorized locally (status=%s) — skipping sync",
            consent_id,
            (local_consent or {}).get("status"),
        )
        return [], 0

    # Build exclusion set: consent-level exclusions ∪ user-level excluded_accounts
    from app.db.collections import excluded_accounts_col as _excl_col
    is_initial_sync = not local_consent.get("last_synced")
    consent_excluded: set[str] = set(local_consent.get("excluded_accounts") or [])
    user_excluded: set[str] = {
        d["account_id"]
        async for d in _excl_col.find({"user_id": user_id}, {"account_id": 1})
    }

    all_new_txns: list = []
    fetched_account_ids: list = []
    identity = await user_identity(user_id)

    async with _client() as client:
        # Verify consent status remotely
        cr = await client.get(f"/consents/{consent_id}")
        if cr.status_code == 200:
            consent_doc = cr.json()
            remote_status = consent_doc.get("status")
            # Always persist what the remote told us, even when we're about
            # to bail below — a stale local "authorized" must not linger.
            update_fields = {
                "status":      remote_status,
                "expiry_date": _parse_iso_utc(consent_doc.get("expiry_date")),
                "renewed_at":  _parse_iso_utc(consent_doc.get("renewed_at")),
            }
            # Stamp the moment the status actually changed away from
            # "authorized" (local_consent was verified authorized above), so
            # the retention sweep (app.services.retention) has a timestamp to
            # measure the 30-day grace period from.
            if remote_status != local_consent.get("status"):
                update_fields["status_changed_at"] = datetime.utcnow()
            await finexer_consents_col.update_one(
                {"_id": consent_id},
                {"$set": update_fields},
            )
            if remote_status != "authorized":
                logger.warning(
                    "Finexer consent %s status is %s, marking its accounts expired",
                    consent_id, remote_status,
                )
                await _mark_finexer_accounts_expired(consent_id)
                return [], 0
        elif cr.status_code in (401, 403, 404):
            # Consent is gone remotely: revoke locally and flag its accounts.
            logger.warning(
                "Finexer consent %s no longer exists remotely (HTTP %s), marking revoked",
                consent_id, cr.status_code,
            )
            await finexer_consents_col.update_one(
                {"_id": consent_id},
                # status_changed_at: see the retention-sweep note above.
                {"$set": {"status": "revoked", "status_changed_at": datetime.utcnow()}},
            )
            await _mark_finexer_accounts_expired(consent_id)
            return [], 0
        else:
            # Transient/server error: leave local state untouched, retry next run.
            logger.error("Finexer GET /consents/%s failed: HTTP %s", consent_id, cr.status_code)
            return [], 0

        # Fetch accounts
        ar = await client.get("/bank_accounts", params={"consent": consent_id})
        if ar.status_code != 200:
            logger.error("Finexer GET /bank_accounts failed: HTTP %s %s", ar.status_code, ar.text[:200])
            return [], 0

        acc_data = ar.json()
        accounts = acc_data.get("data") or acc_data.get("results") or []

        # Log raw shape of first account for field discovery
        if accounts:
            logger.info("FINEXER raw first account JSON: %s", accounts[0])

        # Build provider info map once (id → full provider dict with name, logo, bg_colors)
        provs = await list_providers()
        prov_map = {p["id"]: p for p in provs}

        for acc in accounts:
            account_id = acc.get("id")
            if not account_id:
                logger.warning("Finexer account missing id: %s", acc)
                continue
            if account_id in consent_excluded:
                logger.info("Finexer: skipping consent-excluded account %s for consent %s", account_id, consent_id)
                continue
            if account_id in user_excluded:
                if is_initial_sync:
                    # Reconnect wins: a freshly authorized consent is the user
                    # explicitly asking for these accounts. Account ids are
                    # stable across consents, so this row is a stale guard from
                    # a source that no longer exists — clear it and sync.
                    await _excl_col.delete_many({"user_id": user_id, "account_id": account_id})
                    user_excluded.discard(account_id)
                    logger.info(
                        "Finexer reconnect-wins: cleared stale user-level exclusion for %s (new consent %s)",
                        account_id, consent_id,
                    )
                else:
                    logger.info("Finexer: skipping user-excluded account %s for consent %s", account_id, consent_id)
                    continue

            name = acc.get("nickname") or acc.get("holder_name") or "Account"

            acc_class = (acc.get("class") or "").lower()
            if acc_class == "credit_card":
                acc_type = "credit_card"
                subtype  = "CREDIT_CARD"
            elif "saving" in acc_class:
                acc_type = "bank"
                subtype  = "SAVINGS"
            else:
                acc_type = "bank"
                subtype  = "TRANSACTION"

            ident = acc.get("identification") or {}
            account_number = (
                ident.get("account_number")
                or ident.get("number")
                or ident.get("pan")
                or ident.get("iban")
            )
            sort_code = ident.get("sort_code")

            provider_code = acc.get("provider")
            pinfo = prov_map.get(provider_code) or {}
            provider_name = pinfo.get("name") or (provider_code or "Bank").replace("_", " ").title()

            currency = (acc.get("currency") or "GBP").upper()

            # Fetch balance via dedicated endpoint
            balance: float = 0.0
            available = None
            br = await client.get(f"/bank_accounts/{account_id}/balance")
            if br.status_code == 200:
                bal_data = br.json()
                bal_entries = bal_data.get("data") or []
                chosen = next((e for e in bal_entries if e.get("type") == "actual"), None)
                if chosen is None and bal_entries:
                    chosen = bal_entries[0]
                if chosen:
                    try:
                        balance = float(chosen.get("current") or 0.0)
                    except (TypeError, ValueError):
                        balance = 0.0
                    try:
                        available = float(chosen["available"]) if chosen.get("available") is not None else None
                    except (TypeError, ValueError):
                        available = None
            else:
                logger.warning(
                    "Finexer GET /bank_accounts/%s/balance failed: HTTP %s",
                    account_id, br.status_code,
                )

            set_doc: dict = {
                "name":           name,
                "type":           acc_type,
                "subtype":        subtype,
                "balance":        balance,
                "currency":       currency,
                "provider":       provider_name,
                "provider_id":    provider_code,
                "connection_id":  consent_id,
                "status":         "connected",
                "account_number": account_number,
                "sort_code":      sort_code,
                "finexer":        True,
                "source":         "finexer",
                "logo_url":       pinfo.get("logo") or None,
                "bg_colors":      pinfo.get("bg_colors") or [],
                "updated_at":     datetime.utcnow(),
            }
            if available is not None:
                set_doc["available"] = available

            await accounts_col.update_one(
                {"_id": account_id},
                {
                    "$set": set_doc,
                    "$setOnInsert": {
                        "_id":     account_id,
                        "user_id": user_id,
                    },
                },
                upsert=True,
            )
            fetched_account_ids.append(account_id)

            # Fetch transactions (paginated)
            txn_url = f"/bank_accounts/{account_id}/transactions"
            first_txn_logged = False
            account_pending_rows: list = []
            fetch_failed = False
            while txn_url:
                tr = await client.get(txn_url)
                if tr.status_code != 200:
                    logger.warning("Finexer transactions failed for %s: HTTP %s", account_id, tr.status_code)
                    fetch_failed = True
                    break
                txn_data = tr.json()
                txns = txn_data.get("data") or txn_data.get("results") or []

                # Log raw shape of first transaction for field discovery
                if txns and not first_txn_logged:
                    logger.info("FINEXER raw first transaction JSON for account %s: %s", account_id, txns[0])
                    first_txn_logged = True

                new, pending_rows = await _upsert_finexer_transactions(txns, account_id, user_id, identity=identity)
                all_new_txns.extend(new)
                account_pending_rows.extend(pending_rows)

                paging = txn_data.get("paging") or {}
                next_url = paging.get("next")
                if next_url:
                    # next_url is a path like /bank_accounts/{id}/transactions?offset=20
                    txn_url = next_url
                else:
                    txn_url = None

            # Bank-side PENDING transactions (see app/services/
            # pending_transactions.py) — this fetch already walks the FULL
            # transaction history every sync (no incremental cursor, unlike
            # truelayer_sync.py), so its accumulated pending rows are the
            # complete current pending set for this account. Only replaced
            # on a fully successful walk: a failure partway through must
            # never wipe a genuinely pending set already stored (same "never
            # overwrite a known good value with a failure" rule as the
            # balance fetch above).
            if not fetch_failed:
                await replace_pending_for_account(account_pending_rows, account_id, user_id, provider="Finexer")

    # A renewed consent should clear the "needs reconnecting" banner on the
    # accounts we just fetched. Unlike truelayer_sync.py, there is no inverse
    # sweep here (unfetched accounts on this consent are left alone).
    if fetched_account_ids:
        await accounts_col.update_many(
            {"_id": {"$in": fetched_account_ids}},
            {"$set": {"status": "connected"}},
        )

    # Update last_synced on the consent record
    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {"last_synced": datetime.utcnow()}},
    )

    return fetched_account_ids, len(all_new_txns)


async def finexer_sync_pipeline(consent_id: str, user_id: str) -> dict:
    """
    Full sync pipeline: sync consent → post-sync rules → notifications.
    Called from both the callback (asyncio.create_task) and the arq worker.
    """
    from app.services.categorisation import apply_rules_bulk, categorise_others_bg
    from app.services.manual_account_rules import apply_rules as apply_mirror_rules

    try:
        fetched_ids, new_count = await sync_finexer_consent(consent_id, user_id)
    except Exception:
        logger.exception("finexer_sync_pipeline failed for consent %s user %s", consent_id, user_id)
        return {"ok": False, "error": "sync_failed"}

    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    await apply_mirror_rules(user_id)

    if new_count > 0:
        from app.routers.analytics import compute_and_cache_cashflow
        await compute_and_cache_cashflow(user_id)
        try:
            from app.services.money_shape import compute_and_cache_money_shape
            await compute_and_cache_money_shape(user_id)
        except Exception:
            logger.exception("money_shape compute failed for %s", user_id)
        asyncio.create_task(notify_after_sync(user_id, "UK", []))

    return {"ok": True, "accounts": len(fetched_ids), "new_transactions": new_count}
