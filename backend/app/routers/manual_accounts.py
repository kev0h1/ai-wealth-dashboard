"""Offline (manually-tracked) accounts: savings, current or credit-card balances
the user maintains by hand. Surfaced on the Accounts page and reused by the
safety-net savings tracker."""
import uuid as uuid_lib
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import (
    manual_accounts_col, manual_transactions_col, savings_goals_col,
    manual_account_rules_col, manual_account_mirrors_col,
    transactions_col, statement_transactions_col, yapily_transactions_col,
    mono_transactions_col, mpesa_transactions_col,
)
from app.services.manual_account_rules import apply_rules, reverse_rule
from app.services.region import get_user_region

_SOURCE_TXN_COLLECTIONS = [
    transactions_col, statement_transactions_col, yapily_transactions_col,
    mono_transactions_col, mpesa_transactions_col,
]

router = APIRouter(tags=["manual-accounts"])

ACCOUNT_TYPES = {"savings", "current", "credit_card"}
MATCH_TYPES   = {"description_contains", "category"}
SIGNS         = {"same", "opposite"}


def _parse_balance(raw) -> float:
    try:
        bal = round(float(raw), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid balance")
    if bal < 0:
        raise HTTPException(400, "Balance must be 0 or more")
    return bal


def _serialize(a: dict) -> dict:
    return {
        "id":           a["_id"],
        "name":         a.get("name", "Account"),
        "balance":      round(a.get("balance", 0), 2),
        "account_type": a.get("account_type", "savings"),
        "updated_at":   a["updated_at"].isoformat() if isinstance(a.get("updated_at"), datetime) else a.get("updated_at"),
    }


@router.get("/manual-accounts")
async def list_manual_accounts(user: dict = Depends(current_user)):
    docs = await manual_accounts_col.find({"user_id": user["email"]}).to_list(None)
    return [_serialize(a) for a in docs]


@router.post("/manual-accounts")
async def create_manual_account(body: dict, user: dict = Depends(current_user)):
    uid  = user["email"]
    name = str(body.get("name", "")).strip()[:60]
    if not name:
        raise HTTPException(400, "Account name is required")
    acc_type = body.get("account_type", "savings")
    if acc_type not in ACCOUNT_TYPES:
        raise HTTPException(400, "Invalid account type")
    doc = {
        "_id": str(uuid_lib.uuid4())[:8], "user_id": uid,
        "name": name, "balance": _parse_balance(body.get("balance") or 0),
        "account_type": acc_type,
        "created_at": datetime.now(), "updated_at": datetime.now(),
    }
    await manual_accounts_col.insert_one(doc)
    return _serialize(doc)


@router.patch("/manual-accounts/{acc_id}")
async def update_manual_account(acc_id: str, body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    updates: dict = {}
    if "name" in body:
        name = str(body["name"]).strip()[:60]
        if not name:
            raise HTTPException(400, "Account name is required")
        updates["name"] = name
    if "balance" in body:
        updates["balance"] = _parse_balance(body["balance"])
    if "account_type" in body:
        if body["account_type"] not in ACCOUNT_TYPES:
            raise HTTPException(400, "Invalid account type")
        updates["account_type"] = body["account_type"]
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates["updated_at"] = datetime.now()
    res = await manual_accounts_col.find_one_and_update(
        {"_id": acc_id, "user_id": uid}, {"$set": updates}, return_document=True,
    )
    if not res:
        raise HTTPException(404, "Account not found")
    return _serialize(res)


@router.delete("/manual-accounts/{acc_id}")
async def delete_manual_account(acc_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    await manual_accounts_col.delete_one({"_id": acc_id, "user_id": uid})
    await manual_transactions_col.delete_many({"user_id": uid, "account_id": acc_id})
    await savings_goals_col.update_one({"_id": uid}, {"$pull": {"account_ids": acc_id}})
    # Drop any rules that targeted this account (mirror records go with them).
    rules = await manual_account_rules_col.find(
        {"user_id": uid, "target_account_id": acc_id}, {"_id": 1}).to_list(None)
    for r in rules:
        await manual_account_mirrors_col.delete_many({"user_id": uid, "rule_id": r["_id"]})
    await manual_account_rules_col.delete_many({"user_id": uid, "target_account_id": acc_id})
    return {"deleted": acc_id}


# ── Ledger (hand-added entries + rule-posted mirror entries) ─────────────────

def _signed(amount: float, txn_type: str) -> float:
    return round(abs(amount) if txn_type == "credit" else -abs(amount), 2)


def _validate_entry_body(body: dict) -> dict:
    description = str(body.get("description", "")).strip()[:120]
    if not description:
        raise HTTPException(400, "Description is required")
    try:
        amount = round(abs(float(body.get("amount"))), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid amount")
    if amount <= 0:
        raise HTTPException(400, "Amount must be greater than 0")
    txn_type = body.get("transaction_type")
    if txn_type not in ("credit", "debit"):
        raise HTTPException(400, "transaction_type must be 'credit' or 'debit'")
    raw_date = body.get("date")
    when = datetime.now()
    if raw_date:
        try:
            when = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "Invalid date")
    return {"description": description, "amount": amount, "transaction_type": txn_type, "date": when}


async def _require_account(uid: str, acc_id: str) -> dict:
    acc = await manual_accounts_col.find_one({"_id": acc_id, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Account not found")
    return acc


def _entry_to_txn(t: dict, currency: str) -> dict:
    return {
        "id": t["_id"], "account_id": t["account_id"],
        "date": t["date"], "amount": round(t.get("amount", 0), 2), "currency": currency,
        "description": t.get("description", ""), "merchant_name": None,
        "category": "Transfer", "custom_category": None,
        "transaction_type": t.get("transaction_type", "debit"),
    }


@router.get("/manual-accounts/{acc_id}/transactions")
async def list_manual_transactions(acc_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    await _require_account(uid, acc_id)
    currency = "KES" if await get_user_region(uid) == "Kenya" else "GBP"

    entries = [
        _entry_to_txn(t, currency) for t in
        await manual_transactions_col.find({"user_id": uid, "account_id": acc_id}).to_list(None)
    ]

    # Rule-posted entries: read mirrors, join back to their source transactions.
    mirrors = await manual_account_mirrors_col.find(
        {"user_id": uid, "account_id": acc_id}).to_list(None)
    if mirrors:
        src_ids = [m["txn_id"] for m in mirrors]
        src: dict = {}
        for col in _SOURCE_TXN_COLLECTIONS:
            for d in await col.find(
                {"_id": {"$in": src_ids}},
                {"description": 1, "merchant_name": 1, "date": 1},
            ).to_list(None):
                src[d["_id"]] = d
        for m in mirrors:
            delta = m.get("delta", 0)
            s = src.get(m["txn_id"], {})
            entries.append({
                "id": f"mirror:{m['_id']}", "account_id": acc_id,
                "date": s.get("date") or m.get("created_at") or datetime.now(),
                "amount": round(abs(delta), 2), "currency": currency,
                "description": s.get("description") or "Rule posting",
                "merchant_name": s.get("merchant_name"),
                "category": "Transfer", "custom_category": None,
                "transaction_type": "credit" if delta > 0 else "debit",
            })

    entries.sort(key=lambda e: e["date"], reverse=True)
    return entries


@router.post("/manual-accounts/{acc_id}/transactions")
async def add_manual_transaction(acc_id: str, body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    await _require_account(uid, acc_id)
    fields = _validate_entry_body(body)
    doc = {
        "_id": str(uuid_lib.uuid4())[:12], "user_id": uid, "account_id": acc_id,
        "created_at": datetime.now(), **fields,
    }
    await manual_transactions_col.insert_one(doc)
    await manual_accounts_col.update_one(
        {"_id": acc_id, "user_id": uid},
        {"$inc": {"balance": _signed(fields["amount"], fields["transaction_type"])},
         "$set": {"updated_at": datetime.now()}},
    )
    currency = "KES" if await get_user_region(uid) == "Kenya" else "GBP"
    return _entry_to_txn(doc, currency)


@router.patch("/manual-accounts/{acc_id}/transactions/{tx_id}")
async def update_manual_transaction(acc_id: str, tx_id: str, body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    existing = await manual_transactions_col.find_one({"_id": tx_id, "account_id": acc_id, "user_id": uid})
    if not existing:
        raise HTTPException(404, "Transaction not found")
    fields = _validate_entry_body({**existing, **body})
    old_delta = _signed(existing.get("amount", 0), existing.get("transaction_type", "debit"))
    new_delta = _signed(fields["amount"], fields["transaction_type"])
    await manual_transactions_col.update_one({"_id": tx_id}, {"$set": fields})
    if new_delta != old_delta:
        await manual_accounts_col.update_one(
            {"_id": acc_id, "user_id": uid},
            {"$inc": {"balance": round(new_delta - old_delta, 2)},
             "$set": {"updated_at": datetime.now()}},
        )
    currency = "KES" if await get_user_region(uid) == "Kenya" else "GBP"
    return _entry_to_txn({**existing, **fields}, currency)


@router.delete("/manual-accounts/{acc_id}/transactions/{tx_id}")
async def delete_manual_transaction(acc_id: str, tx_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    existing = await manual_transactions_col.find_one({"_id": tx_id, "account_id": acc_id, "user_id": uid})
    if not existing:
        raise HTTPException(404, "Transaction not found")
    await manual_transactions_col.delete_one({"_id": tx_id})
    delta = _signed(existing.get("amount", 0), existing.get("transaction_type", "debit"))
    await manual_accounts_col.update_one(
        {"_id": acc_id, "user_id": uid},
        {"$inc": {"balance": round(-delta, 2)}, "$set": {"updated_at": datetime.now()}},
    )
    return {"deleted": tx_id}


# ── Transaction-mirror rules ─────────────────────────────────────────────────

def _serialize_rule(r: dict, account_name: str | None = None) -> dict:
    return {
        "id":                r["_id"],
        "name":              r.get("name", ""),
        "target_account_id": r.get("target_account_id"),
        "target_account_name": account_name,
        "match_type":        r.get("match_type"),
        "match_value":       r.get("match_value"),
        "sign":              r.get("sign"),
        "active":            r.get("active", True),
    }


@router.get("/manual-account-rules")
async def list_rules(user: dict = Depends(current_user)):
    uid = user["email"]
    rules = await manual_account_rules_col.find({"user_id": uid}).to_list(None)
    names = {a["_id"]: a.get("name") for a in
             await manual_accounts_col.find({"user_id": uid}, {"name": 1}).to_list(None)}
    return [_serialize_rule(r, names.get(r.get("target_account_id"))) for r in rules]


def _validate_rule_body(body: dict) -> dict:
    name = str(body.get("name", "")).strip()[:60]
    if not name:
        raise HTTPException(400, "Rule name is required")
    match_type = body.get("match_type")
    if match_type not in MATCH_TYPES:
        raise HTTPException(400, "Invalid match type")
    match_value = str(body.get("match_value", "")).strip()[:120]
    if not match_value:
        raise HTTPException(400, "Match value is required")
    sign = body.get("sign")
    if sign not in SIGNS:
        raise HTTPException(400, "Invalid sign")
    return {"name": name, "match_type": match_type, "match_value": match_value, "sign": sign}


@router.post("/manual-account-rules")
async def create_rule(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    target = body.get("target_account_id")
    acc = await manual_accounts_col.find_one({"_id": target, "user_id": uid})
    if not acc:
        raise HTTPException(404, "Target account not found")
    fields = _validate_rule_body(body)
    doc = {
        "_id": str(uuid_lib.uuid4())[:8], "user_id": uid,
        "target_account_id": target, "active": True,
        "created_at": datetime.now(), **fields,
    }
    await manual_account_rules_col.insert_one(doc)
    await apply_rules(uid)  # backfill existing transactions
    return _serialize_rule(doc, acc.get("name"))


@router.patch("/manual-account-rules/{rule_id}")
async def update_rule(rule_id: str, body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    rule = await manual_account_rules_col.find_one({"_id": rule_id, "user_id": uid})
    if not rule:
        raise HTTPException(404, "Rule not found")
    updates: dict = {}
    for key in ("name", "match_type", "match_value", "sign"):
        if key in body:
            updates[key] = body[key]
    if updates:
        merged = {**rule, **updates}
        updates = _validate_rule_body(merged)
    if "active" in body:
        updates["active"] = bool(body["active"])
    if not updates:
        raise HTTPException(400, "Nothing to update")
    # Reverse existing mirrors, apply the change, then re-apply if still active.
    await reverse_rule(uid, rule_id)
    await manual_account_rules_col.update_one({"_id": rule_id, "user_id": uid}, {"$set": updates})
    if updates.get("active", rule.get("active", True)):
        await apply_rules(uid)
    fresh = await manual_account_rules_col.find_one({"_id": rule_id, "user_id": uid})
    acc = await manual_accounts_col.find_one({"_id": fresh["target_account_id"], "user_id": uid}, {"name": 1})
    return _serialize_rule(fresh, (acc or {}).get("name"))


@router.delete("/manual-account-rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    rule = await manual_account_rules_col.find_one({"_id": rule_id, "user_id": uid})
    if not rule:
        raise HTTPException(404, "Rule not found")
    await reverse_rule(uid, rule_id)
    await manual_account_rules_col.delete_one({"_id": rule_id, "user_id": uid})
    return {"deleted": rule_id}
