"""M-Pesa and bank statement upload endpoints."""
import re
from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.core.auth import current_user
from app.db.collections import (
    mpesa_accounts_col, mpesa_transactions_col,
    statement_accounts_col, statement_transactions_col,
)
from app.services.categorisation import rule_categorise
from app.services.pdf import extract_pdf_text, llm_parse_mpesa, llm_parse_statement
from app.services.region import get_user_region

router = APIRouter(tags=["statements"])

BANK_SLUG_MAP: dict[str, str] = {
    "m-pesa": "mpesa", "mpesa": "mpesa", "safaricom": "mpesa",
    "equity": "equity", "equity bank": "equity",
    "kcb": "kcb", "kenya commercial bank": "kcb",
    "ncba": "ncba", "ncba bank": "ncba",
    "stanbic": "stanbic", "stanbic bank": "stanbic",
    "absa": "absa",
    "co-op": "coop", "cooperative bank": "coop", "co-operative bank": "coop",
    "dtb": "dtb", "diamond trust bank": "dtb",
    "standard chartered": "stanchart",
    "family bank": "family",
    "i&m bank": "imbank", "im bank": "imbank",
}


def _bank_slug(raw_name: str) -> str:
    key = raw_name.lower().strip()
    return BANK_SLUG_MAP.get(key, re.sub(r"[^a-z0-9]+", "", key) or "bank")


import hashlib


def _statement_dedup_key(account_id: str, ref, date: str, txn_type: str, description: str) -> str:
    if ref and not str(ref).startswith("TXN-"):
        return f"{account_id}|{ref}"
    date_part = date[:10] if len(date) >= 10 else date
    desc_norm = " ".join(description.lower().split())[:80]
    digest    = hashlib.sha256(
        f"{account_id}|{date_part}|{txn_type}|{desc_norm}".encode()
    ).hexdigest()[:24]
    return digest


@router.post("/mpesa/upload")
async def mpesa_upload(
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    uid      = user["email"]
    content  = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".pdf") or content[:4] == b"%PDF":
        raw_text = await extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text — check the PDF password")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    rows = await llm_parse_mpesa(raw_text)
    if not isinstance(rows, list):
        raise HTTPException(422, "LLM did not return a list of transactions")

    acc_id          = f"mpesa-{uid}"
    conn_id         = f"mpesa-conn-{uid}"
    imported        = 0
    latest_balance: float | None = None

    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        receipt  = str(row.get("receipt") or f"mpesa-{uid}-{i}")
        raw_date = row.get("date", "")
        try:
            txn_date = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        except Exception:
            txn_date = datetime.now()
        try:
            amount = float(row.get("amount", 0))
        except (TypeError, ValueError):
            continue
        if amount <= 0:
            continue

        txn_type    = "credit" if str(row.get("type", "debit")).lower() == "credit" else "debit"
        description = str(row.get("description", ""))
        bal         = row.get("balance")
        if bal is not None:
            try:
                latest_balance = float(bal)
            except (TypeError, ValueError):
                pass

        cat = rule_categorise("", description)
        await mpesa_transactions_col.update_one(
            {"_id": receipt},
            {"$set": {
                "account_id": acc_id, "user_id": uid, "date": txn_date,
                "amount": amount, "currency": "KES", "description": description,
                "merchant_name": None, "category": cat, "transaction_type": txn_type,
            }, "$setOnInsert": {"custom_category": None}},
            upsert=True,
        )
        imported += 1

    await mpesa_accounts_col.update_one(
        {"_id": acc_id},
        {"$set": {
            "_id": acc_id, "user_id": uid, "name": "M-Pesa", "type": "mobile_money",
            "balance": latest_balance or 0, "currency": "KES", "provider": "MPESA",
            "status": "connected", "updated_at": datetime.now(),
        }},
        upsert=True,
    )
    await mpesa_accounts_col.update_one(
        {"_id": conn_id},
        {"$set": {"_id": conn_id, "user_id": uid, "provider_type": "mpesa"}},
        upsert=True,
    )
    return {"inserted": imported, "account_id": acc_id, "balance": latest_balance}


@router.get("/mpesa/accounts")
async def get_mpesa_accounts(user: dict = Depends(current_user)):
    uid  = user["email"]
    accs = await mpesa_accounts_col.find({"user_id": uid, "type": "mobile_money"}).to_list(None)
    return [
        {"id": a["_id"], "name": a.get("name", "M-Pesa"), "type": a.get("type", "mobile_money"),
         "balance": a.get("balance", 0), "currency": a.get("currency", "KES"),
         "provider": a.get("provider", "MPESA"), "status": a.get("status", "connected")}
        for a in accs
    ]


@router.get("/mpesa/accounts/{account_id}/transactions")
async def get_mpesa_transactions(account_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    acc = await mpesa_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "M-Pesa account not found")
    txns = await mpesa_transactions_col.find(
        {"account_id": account_id, "user_id": uid}
    ).sort("date", -1).to_list(500)
    return [
        {"id": t["_id"], "account_id": t["account_id"], "date": t["date"].isoformat(),
         "amount": t["amount"], "currency": "KES", "description": t.get("description", ""),
         "merchant_name": t.get("merchant_name"), "category": t.get("custom_category") or t.get("category"),
         "custom_category": t.get("custom_category"), "transaction_type": t.get("transaction_type", "debit")}
        for t in txns
    ]


@router.post("/statement/upload")
async def statement_upload(
    file: UploadFile,
    password: str = Form(default=""),
    region: str = Form(default="Kenya"),
    user: dict = Depends(current_user),
):
    uid      = user["email"]
    content  = await file.read()
    filename = (file.filename or "").lower()

    if filename.endswith(".pdf") or content[:4] == b"%PDF":
        raw_text = await extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text — wrong PDF password or unsupported format")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    parsed         = await llm_parse_statement(raw_text)
    bank_name      = str(parsed.get("bank_name") or "Unknown Bank")
    account_number = str(parsed.get("account_number") or "")
    currency       = str(parsed.get("currency") or "KES")
    rows           = parsed.get("transactions", [])

    user_region = await get_user_region(uid)
    is_mpesa    = "mpesa" in bank_name.lower() or "m-pesa" in bank_name.lower() or currency == "KES"
    if user_region != "Kenya" and is_mpesa:
        raise HTTPException(
            422,
            "M-PESA / KES statements can only be uploaded in Kenya region. "
            "Switch your region to Kenya in Settings to upload this statement.",
        )

    if not isinstance(rows, list):
        raise HTTPException(422, "LLM did not return a transactions list")

    raw_closing = parsed.get("closing_balance")
    try:
        closing_balance: float | None = float(raw_closing) if raw_closing is not None else None
    except (TypeError, ValueError):
        closing_balance = None

    slug        = _bank_slug(bank_name)
    acct_digits = re.sub(r"\D", "", account_number)
    acct_suffix = acct_digits[-8:] if len(acct_digits) >= 4 else hashlib.sha256(f"{uid}|{slug}".encode()).hexdigest()[:8]
    acc_id      = f"statement-{uid}-{slug}-{acct_suffix}"
    acc_name    = f"{bank_name} ••{acct_suffix[-4:]}"

    imported                  = 0
    skipped                   = 0
    latest_balance: float | None = None
    latest_balance_date: datetime | None = None

    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            amount = float(row.get("amount", 0))
        except (TypeError, ValueError):
            continue
        if amount <= 0:
            skipped += 1
            continue

        raw_date    = str(row.get("date", ""))
        try:
            txn_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
        except Exception:
            txn_date = datetime.now()

        txn_type    = "credit" if str(row.get("type", "debit")).lower() == "credit" else "debit"
        description = str(row.get("description") or "")
        ref         = row.get("ref")
        bal         = row.get("balance")

        if bal is not None:
            try:
                bal_f = float(bal)
                if latest_balance_date is None or txn_date >= latest_balance_date:
                    latest_balance      = bal_f
                    latest_balance_date = txn_date
            except (TypeError, ValueError):
                pass

        txn_id = _statement_dedup_key(acc_id, ref, raw_date, txn_type, description)
        cat    = rule_categorise("", description)
        await statement_transactions_col.update_one(
            {"_id": txn_id},
            {"$set": {
                "account_id": acc_id, "user_id": uid, "date": txn_date,
                "amount": amount, "currency": currency, "description": description,
                "merchant_name": None, "category": cat, "transaction_type": txn_type,
            }, "$setOnInsert": {"custom_category": None}},
            upsert=True,
        )
        imported += 1

    resolved_balance   = closing_balance if closing_balance is not None else latest_balance
    existing           = await statement_accounts_col.find_one({"_id": acc_id}, {"balance_date": 1, "balance": 1})
    stored_balance_date: datetime | None = existing.get("balance_date") if existing else None
    this_statement_date = latest_balance_date or datetime.now()

    should_update_balance = (
        resolved_balance is not None and
        (stored_balance_date is None or this_statement_date >= stored_balance_date)
    )

    account_update: dict = {
        "_id": acc_id, "user_id": uid, "name": acc_name, "type": "bank",
        "currency": currency, "provider": slug.upper(), "account_number": account_number,
        "region": region, "status": "connected", "updated_at": datetime.now(),
    }
    if should_update_balance:
        account_update["balance"]      = resolved_balance
        account_update["balance_date"] = this_statement_date
    elif existing is None:
        account_update["balance"] = 0

    await statement_accounts_col.update_one({"_id": acc_id}, {"$set": account_update}, upsert=True)

    return {
        "inserted": imported, "skipped": skipped, "account_id": acc_id,
        "bank_name": bank_name, "account_number": account_number, "balance": latest_balance,
    }
