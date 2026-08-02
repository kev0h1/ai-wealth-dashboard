"""Rules that mirror real transactions into an offline (manual) account.

A rule matches transactions on a real account and posts an offsetting (or
shadowing) amount to a manual account. Mirrors are recorded per (rule, txn) so
re-runs after every sync are idempotent, and a rule can be cleanly reversed.
"""
from datetime import datetime

from app.db.collections import (
    transactions_col, statement_transactions_col, yapily_transactions_col,
    mono_transactions_col, mpesa_transactions_col,
    manual_accounts_col, manual_account_rules_col, manual_account_mirrors_col,
)

_TXN_COLLECTIONS = [
    transactions_col, statement_transactions_col, yapily_transactions_col,
    mono_transactions_col, mpesa_transactions_col,
]


async def _all_user_transactions(uid: str) -> list[dict]:
    txns: list[dict] = []
    for col in _TXN_COLLECTIONS:
        txns.extend(await col.find(
            {"user_id": uid},
            {"amount": 1, "transaction_type": 1, "description": 1,
             "merchant_name": 1, "category": 1, "account_id": 1},
        ).to_list(None))
    return txns


def account_key(value) -> str:
    """Normalise an account identifier to a comparable string.

    The five source collections don't agree on the type they store in
    ``account_id`` (str for TrueLayer/Finexer/statements, potentially ObjectId
    for others), and a rule's scope arrives from the client as a string. Both
    sides go through here so a str-vs-ObjectId mismatch can never silently make
    a scoped rule match nothing.
    """
    return "" if value is None else str(value).strip()


def _matches(rule: dict, txn: dict) -> bool:
    # Optional account scope: absent/None means "any account", which is what
    # every rule written before scoping existed carries.
    scope = account_key(rule.get("source_account_id"))
    if scope and account_key(txn.get("account_id")) != scope:
        return False
    mt = rule.get("match_type")
    val = str(rule.get("match_value", "")).strip().lower()
    if not val:
        return False
    if mt == "category":
        return str(txn.get("category") or "").strip().lower() == val
    # description_contains: search description + merchant
    haystack = f"{txn.get('description', '')} {txn.get('merchant_name') or ''}".lower()
    return val in haystack


def _delta(rule: dict, txn: dict) -> float:
    m = abs(float(txn.get("amount", 0) or 0))
    natural = m if txn.get("transaction_type") == "credit" else -m
    return round(natural if rule.get("sign") == "same" else -natural, 2)


async def apply_rules(uid: str) -> None:
    """Idempotently apply all active rules for a user to all their transactions."""
    rules = await manual_account_rules_col.find({"user_id": uid, "active": True}).to_list(None)
    if not rules:
        return
    valid_accounts = {
        a["_id"] for a in await manual_accounts_col.find(
            {"user_id": uid}, {"_id": 1}).to_list(None)
    }
    rules = [r for r in rules if r.get("target_account_id") in valid_accounts]
    if not rules:
        return

    txns = await _all_user_transactions(uid)
    for rule in rules:
        rid = rule["_id"]
        acc_id = rule["target_account_id"]
        for txn in txns:
            if not _matches(rule, txn):
                continue
            delta = _delta(rule, txn)
            if delta == 0:
                continue
            mirror_id = f"{rid}:{txn['_id']}"
            res = await manual_account_mirrors_col.update_one(
                {"_id": mirror_id},
                {"$setOnInsert": {
                    "_id": mirror_id, "rule_id": rid, "txn_id": txn["_id"],
                    "account_id": acc_id, "user_id": uid, "delta": delta,
                    "created_at": datetime.now(),
                }},
                upsert=True,
            )
            if res.upserted_id is not None:
                await manual_accounts_col.update_one(
                    {"_id": acc_id, "user_id": uid},
                    {"$inc": {"balance": delta}, "$set": {"updated_at": datetime.now()}},
                )


async def reverse_rule(uid: str, rule_id: str) -> None:
    """Undo every mirror a rule has posted and drop its mirror records."""
    mirrors = await manual_account_mirrors_col.find(
        {"user_id": uid, "rule_id": rule_id}).to_list(None)
    totals: dict[str, float] = {}
    for m in mirrors:
        totals[m["account_id"]] = totals.get(m["account_id"], 0) + m.get("delta", 0)
    for acc_id, total in totals.items():
        if total:
            await manual_accounts_col.update_one(
                {"_id": acc_id, "user_id": uid},
                {"$inc": {"balance": round(-total, 2)}, "$set": {"updated_at": datetime.now()}},
            )
    await manual_account_mirrors_col.delete_many({"user_id": uid, "rule_id": rule_id})
