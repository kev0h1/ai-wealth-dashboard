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
from app.services.description_match import matches_contains, matches_equals

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
             "merchant_name": 1, "category": 1, "account_id": 1, "date": 1},
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


def _as_datetime(value):
    """Coerce a stored date (datetime or ISO string) to a naive local datetime."""
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return dt.astimezone().replace(tzinfo=None) if dt.tzinfo else dt


def _within_window(rule: dict, txn: dict) -> bool:
    """Rules created before this feature carry no ``applies_from``; absent/None
    means "all history", which is exactly how every existing rule behaves. A
    rule created today carries its creation time and never reaches backwards."""
    start = _as_datetime(rule.get("applies_from"))
    if start is None:
        return True
    when = _as_datetime(txn.get("date"))
    if when is None:
        return False  # an undated transaction can't be shown to fall after the cutoff
    return when >= start


def _matches(rule: dict, txn: dict) -> bool:
    # Optional account scope: absent/None means "any account", which is what
    # every rule written before scoping existed carries.
    scope = account_key(rule.get("source_account_id"))
    if scope and account_key(txn.get("account_id")) != scope:
        return False
    if not _within_window(rule, txn):
        return False
    mt = rule.get("match_type")
    raw_val = rule.get("match_value", "")
    if not str(raw_val).strip():
        return False
    if mt == "category":
        return matches_equals(txn.get("category"), raw_val)
    if mt == "description_equals":
        # Exact comparison against one named field only — never the concatenated
        # haystack, so which field the rule targets is always unambiguous.
        field = rule.get("match_field") or "description"
        candidate = txn.get("merchant_name") if field == "merchant" else txn.get("description")
        return matches_equals(candidate, raw_val)
    # description_contains (and any other/legacy value): search description + merchant.
    # Shared with app/routers/allocations.py via app/services/description_match.py
    # so the two rule systems' equals/contains behaviour cannot drift apart.
    return matches_contains(raw_val, txn.get("description"), txn.get("merchant_name"))


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
