"""Bank statement upload endpoints."""
import re
from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile

from app.core.auth import current_user
from app.core.subscription import check_statement_upload_allowed, record_statement_upload
from app.db.collections import statement_accounts_col, statement_transactions_col
from app.services.categorisation import rule_categorise
from app.services.pdf import extract_pdf_text, llm_parse_statement

router = APIRouter(tags=["statements"])

# A98 dropped the Kenya-only names (M-Pesa, Equity, KCB, NCBA, Stanbic, DTB,
# Family, I&M). The remaining entries all name banks that trade in the UK, and
# the table is deliberately left otherwise intact: `_bank_slug` feeds the
# statement account's `_id`, so removing a name an existing account was
# created under would fork it into a duplicate.
BANK_SLUG_MAP: dict[str, str] = {
    "absa": "absa",
    "co-op": "coop", "cooperative bank": "coop", "co-operative bank": "coop",
    "standard chartered": "stanchart",
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


@router.post("/statement/upload")
async def statement_upload(
    file: UploadFile,
    password: str = Form(default=""),
    user: dict = Depends(current_user),
):
    uid      = user["email"]
    await check_statement_upload_allowed(uid)
    content  = await file.read()
    filename = (file.filename or "").lower()
    is_pdf   = filename.endswith(".pdf") or content[:4] == b"%PDF"

    if is_pdf:
        raw_text = await extract_pdf_text(content, password=password)
        if not raw_text.strip():
            raise HTTPException(422, "Could not extract text, wrong PDF password or unsupported format")
    else:
        try:
            raw_text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            raw_text = content.decode("latin-1")

    if not raw_text.strip():
        raise HTTPException(422, "Could not extract text from file")

    parsed         = await llm_parse_statement(raw_text, uid)
    bank_name      = str(parsed.get("bank_name") or "Unknown Bank")
    account_number = str(parsed.get("account_number") or "")
    rows           = parsed.get("transactions", [])

    # A98: there is deliberately NO default currency here. It used to fall
    # back to "KES", which then tripped the Kenya-only guard below for any
    # statement the parser found no currency line on, so "we could not tell"
    # and "this really is KES" were rejected with the same misleading
    # message (recorded as an incidental finding by the A51 pentest run).
    # Defaulting to GBP instead would be worse than the bug it replaced: an
    # unlabelled EUR or USD statement would import, every row would be
    # stored as GBP, and `get_kpis` would add the balance into GBP net worth
    # at 1:1 with nothing on screen saying anything had been assumed. An
    # undeterminable currency is its own failure and says so.
    currency = str(parsed.get("currency") or "").strip().upper()
    if currency in ("", "NULL", "NONE", "UNKNOWN"):
        raise HTTPException(
            422,
            "We could not work out the currency of this statement. "
            "Upload a copy that shows it.",
        )

    is_mpesa = "mpesa" in bank_name.lower() or "m-pesa" in bank_name.lower() or currency == "KES"
    if is_mpesa:
        raise HTTPException(422, "M-PESA and KES statements are not supported.")

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
        # A98: kept as a literal "UK" so these docs keep matching the
        # `region: "UK"` filter GET /accounts has always applied to them.
        "region": "UK", "status": "connected", "updated_at": datetime.now(),
    }
    if should_update_balance:
        account_update["balance"]      = resolved_balance
        account_update["balance_date"] = this_statement_date
    elif existing is None:
        account_update["balance"] = 0

    await statement_accounts_col.update_one({"_id": acc_id}, {"$set": account_update}, upsert=True)

    await record_statement_upload(
        uid, kind=("pdf" if is_pdf else "csv"), filename=(file.filename or ""),
        account_id=acc_id,
    )

    return {
        "inserted": imported, "skipped": skipped, "account_id": acc_id,
        "bank_name": bank_name, "account_number": account_number, "balance": latest_balance,
    }
