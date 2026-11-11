"""Apply and undo an explicitly selected payment scope."""
from __future__ import annotations

import asyncio
import re
from datetime import datetime
from hashlib import sha256
from weakref import WeakValueDictionary

from bson import ObjectId
from fastapi import HTTPException
from pymongo import UpdateOne
from pymongo.errors import DuplicateKeyError

from app.db.collections import (
    commitments_col, manual_accounts_col, scoped_correction_operations_col,
    transactions_col, user_rules_col,
)
from app.services.categorisation import VALID_CATEGORIES, user_allowed_categories
from app.services.scoped_correction_rules import (
    correction_fields, correction_identity, is_booked_payment, make_correction_rule,
)

MOVEMENT_RESOLUTIONS = {
    "mine-here": "Transfer",
    "mine-goal": "Transfer",
    "mine-offline": "Transfer",
    "mine-card": "Debt",
    "mine-savings": "Savings",
    "mine-investment": "Investment",
}
_BOOKED = {key: {"$ne": True} for key in ("is_pending", "pending", "planned")}
_OBSERVED_FIELDS = (
    "account_id", "merchant_key", "merchant_name", "description",
    "transaction_type", "currency", "date", "status",
)
_MATCH_PROJECTION = {
    field: 1 for field in (
        *_OBSERVED_FIELDS, *_BOOKED, "category", "custom_category", "custom_category_at",
        "linked_goal_id", "linked_offline_account_id", "card_repayment_taught", "card_repayment_rule",
        "correction_scope", "correction_scope_operation_id", "correction_scope_saved_at",
    )
}
_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def correction_lock(uid: str) -> asyncio.Lock:
    """Serialise correction mutations in the API process.

    The worker may update a payment concurrently. Each row write still checks
    the observed identity, booked state and its manual-category guard.
    """
    return _locks.setdefault(uid, asyncio.Lock())


def operation_key(uid: str, operation_id: str) -> str:
    return f"{uid}::scoped-correction::{operation_id}"


def _id_values(value: str) -> list[str | ObjectId]:
    return [value, ObjectId(value)] if ObjectId.is_valid(value) else [value]


async def _anchor(uid: str, transaction_id: str) -> dict:
    rows = await transactions_col.find(
        {"_id": {"$in": _id_values(transaction_id)}, "user_id": uid}, _MATCH_PROJECTION,
    ).to_list(2)
    if not rows:
        raise HTTPException(404, "Payment not found")
    if len(rows) != 1:
        raise HTTPException(409, "This payment could not be identified uniquely")
    if not is_booked_payment(rows[0]):
        raise HTTPException(400, "This payment is still settling")
    return rows[0]


async def _matches(uid: str, anchor: dict) -> list[dict]:
    identity = correction_identity(anchor)
    if identity is None:
        return [anchor]
    key, direction, _currency = identity
    # The user/key/direction index bounds both the exact-key read and the
    # compatibility scan of older rows that have no stored merchant key.
    cursor = transactions_col.find({
        "user_id": uid, "merchant_key": {"$in": [key, None, ""]},
        "transaction_type": direction, **_BOOKED,
    }, _MATCH_PROJECTION)
    return [anchor, *[
        row async for row in cursor
        if row["_id"] != anchor["_id"] and is_booked_payment(row) and correction_identity(row) == identity
    ]]


def _on_or_before(row: dict, anchor: dict) -> bool:
    if row["_id"] == anchor["_id"]:
        return True
    date, selected_date = row.get("date"), anchor.get("date")
    return isinstance(date, datetime) and isinstance(selected_date, datetime) and date <= selected_date


def _available(rows: list[dict]) -> list[dict]:
    # A missing field and explicit null are both automatic. Even an empty
    # saved custom value is protected.
    return [row for row in rows if row.get("custom_category") is None]


async def scope_summary(uid: str, transaction_id: str) -> dict:
    anchor = await _anchor(uid, transaction_id)
    rows = await _matches(uid, anchor)
    available = _available(rows)
    one = int(anchor.get("custom_category") is None)
    identified = correction_identity(anchor) is not None
    history = sum(_on_or_before(row, anchor) for row in available) if identified else 0
    return {
        "one_count": one,
        "earlier_count": max(0, history - one),
        "history_count": history,
        "all_count": len(available) if identified else 0,
        "protected_count": len(rows) - len(available),
        "can_save_rule": identified and bool(available),
        "selected_protected": not one,
    }


async def _offline_destination(uid: str, raw_name: str | None, stamp: datetime) -> tuple[str, dict | None]:
    name = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", raw_name or "")
    name = " ".join(name.split())[:60] or "An account of mine elsewhere"
    existing = await manual_accounts_col.find_one({
        "user_id": uid, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"},
    }, {"_id": 1})
    if existing:
        return str(existing["_id"]), None
    key = sha256(f"{uid}\x1f{name.casefold()}".encode()).hexdigest()[:24]
    account = {
        "_id": f"correction-{key}", "user_id": uid, "name": name, "balance": 0.0,
        "account_type": "savings", "created_at": stamp, "updated_at": stamp,
    }
    return account["_id"], account


async def _resolution(uid: str, anchor: dict, body: dict, stamp: datetime) -> tuple[dict, dict, dict | None]:
    resolution = body["resolution"]
    category = MOVEMENT_RESOLUTIONS.get(resolution, body.get("category"))
    if resolution in MOVEMENT_RESOLUTIONS and anchor.get("transaction_type") != "debit":
        raise HTTPException(400, "Movement corrections apply to outgoing payments")
    if not category or (category not in VALID_CATEGORIES and category not in await user_allowed_categories(uid)):
        raise HTTPException(400, "Choose a valid category")

    goal_id = None
    offline_id = None
    account = None
    if resolution == "mine-goal":
        requested_goal = body.get("goal_id")
        if not requested_goal:
            raise HTTPException(400, "Choose a goal")
        goal = await commitments_col.find_one({
            "_id": {"$in": _id_values(requested_goal)}, "user_id": uid, "status": {"$in": [None, "active"]},
        }, {"_id": 1})
        if not goal:
            raise HTTPException(404, "Active goal not found")
        goal_id = str(goal["_id"])
    elif resolution == "mine-offline":
        offline_id, account = await _offline_destination(uid, body.get("offline_pot_name"), stamp)

    values, clear = correction_fields(
        category, goal_id=goal_id, offline_account_id=offline_id,
        card_repayment=resolution == "mine-card",
    )
    return values, clear, account


async def _plan(uid: str, transaction_id: str, body: dict) -> dict:
    anchor = await _anchor(uid, transaction_id)
    scope = body["scope"]
    identity = correction_identity(anchor)
    if scope != "one" and identity is None:
        raise HTTPException(400, "This payee could not be matched safely")

    rows = await _matches(uid, anchor)
    available = _available(rows)
    if scope == "one":
        candidates = [row for row in available if row["_id"] == anchor["_id"]]
    elif scope == "history":
        candidates = [row for row in available if _on_or_before(row, anchor)]
    else:
        candidates = available
    if not candidates or len(candidates) != body["expected_count"]:
        raise HTTPException(409, "Matching payments changed. Check the count again.")

    operation_id = body["operation_id"]
    stamp = datetime.utcnow()
    values, clear, account = await _resolution(uid, anchor, body, stamp)
    category = values["custom_category"]
    applied = {
        **values, "custom_category_at": stamp, "correction_scope": scope,
        "correction_scope_operation_id": operation_id, "correction_scope_saved_at": stamp,
    }
    touched = set(applied) | set(clear)
    snapshots = [{
        "id": row["_id"],
        "observed": {field: row.get(field) for field in _OBSERVED_FIELDS},
        "previous": {field: row[field] for field in touched if field in row},
    } for row in candidates]
    rule = previous_rule = None
    if scope == "history-future":
        payee = (anchor.get("merchant_name") or anchor.get("description") or "Matching payee")[:160]
        direction = "Outgoing" if identity[1] == "debit" else "Incoming"
        rule = make_correction_rule(
            uid, identity, operation_id=operation_id,
            label=f"{payee} · {direction} {identity[2]} payments",
            fields=(values, clear), stamp=stamp,
        )
        previous_rule = await user_rules_col.find_one({"_id": rule["_id"], "uid": uid})
    return {
        "_id": operation_key(uid, operation_id), "user_id": uid,
        "transaction_id": transaction_id, "operation_id": operation_id,
        "request": body, "status": "applying", "created_at": stamp,
        "snapshots": snapshots, "applied": applied, "clear": clear,
        "category": category, "account": account, "rule": rule, "previous_rule": previous_rule,
        "protected_count": len(rows) - len(available),
    }


async def _save_rule(operation: dict) -> str | None:
    rule = operation["rule"]
    if rule is None:
        return None
    key = {"_id": rule["_id"], "uid": operation["user_id"]}
    previous = operation["previous_rule"]
    if previous is None:
        try:
            await user_rules_col.insert_one(rule)
            return rule["_id"]
        except DuplicateKeyError:
            pass
    else:
        result = await user_rules_col.replace_one(
            {**key, "operation_id": previous["operation_id"]}, rule,
        )
        if result.matched_count:
            return rule["_id"]
    # The rule write may have committed before its response was lost.
    saved = await user_rules_col.find_one({**key, "operation_id": operation["operation_id"]}, {"_id": 1})
    return rule["_id"] if saved else None


async def _apply_plan(operation: dict) -> dict:
    uid, op = operation["user_id"], operation["operation_id"]
    account = operation["account"]
    if account is not None:
        await manual_accounts_col.update_one(
            {"_id": account["_id"], "user_id": uid}, {"$setOnInsert": account}, upsert=True,
        )
    applied, clear = operation["applied"], operation["clear"]
    await transactions_col.bulk_write([
        UpdateOne(
            {
                "_id": row["id"], "user_id": uid, "custom_category": None,
                "correction_undo_id": {"$ne": op}, **row["observed"], **_BOOKED,
            },
            {"$set": applied, "$unset": clear},
        )
        for row in operation["snapshots"]
    ], ordered=False)
    owned = await transactions_col.find({
        "user_id": uid, "correction_scope_operation_id": op,
        "correction_scope_saved_at": applied["correction_scope_saved_at"],
        "custom_category_at": applied["custom_category_at"],
    }, {"_id": 1}).to_list(None)
    ids = [str(row["_id"]) for row in owned]
    rule_id = await _save_rule(operation) if ids else None
    result = {
        "category": operation["category"], "affected_ids": ids, "updated_count": len(ids),
        "protected_count": operation["protected_count"], "rule_id": rule_id,
        "rule_conflict": bool(ids and operation["rule"] and not rule_id),
        "refresh_pending": bool(ids),
    }
    await scoped_correction_operations_col.update_one(
        {"_id": operation["_id"], "status": "applying"},
        {"$set": {"status": "applied", "result": result}},
    )
    return result


async def apply_scoped_correction(uid: str, transaction_id: str, body: dict) -> dict:
    async with correction_lock(uid):
        key = operation_key(uid, body["operation_id"])
        operation = await scoped_correction_operations_col.find_one({"_id": key, "user_id": uid})
        if operation is None:
            operation = await _plan(uid, transaction_id, body)
            try:
                await scoped_correction_operations_col.insert_one(operation)
            except DuplicateKeyError:
                operation = await scoped_correction_operations_col.find_one({"_id": key, "user_id": uid})
                if operation is None:
                    raise
        if operation["transaction_id"] != transaction_id or operation["request"] != body:
            raise HTTPException(409, "This correction attempt has different details")
        if operation["status"] == "applied":
            return operation["result"]
        if operation["status"] != "applying":
            raise HTTPException(409, "This correction has already been undone")
        return await _apply_plan(operation)


async def _undo_rule(operation: dict) -> None:
    rule_id = operation["result"]["rule_id"]
    if rule_id is None:
        return
    op = operation["operation_id"]
    guard = {"_id": rule_id, "uid": operation["user_id"], "operation_id": op}
    previous = operation["previous_rule"]
    if previous is not None:
        await user_rules_col.replace_one(guard, previous)
    else:
        # Keep a tombstone so an interrupted apply cannot recreate a removed
        # rule when it resumes with the same operation ID.
        await user_rules_col.update_one(guard, {
            "$set": {"removed_at": datetime.utcnow(), "operation_id": f"undo:{op}"},
        })


async def undo_scoped_correction(uid: str, transaction_id: str, operation_id: str) -> dict:
    async with correction_lock(uid):
        key = operation_key(uid, operation_id)
        operation = await scoped_correction_operations_col.find_one({
            "_id": key, "user_id": uid, "transaction_id": transaction_id,
        })
        if operation is None:
            raise HTTPException(404, "Correction not found")
        if operation["status"] == "undone":
            return operation["undo_result"]
        if operation["status"] not in {"applied", "undoing"}:
            raise HTTPException(503, "Finish saving this correction before undoing it")

        await scoped_correction_operations_col.update_one(
            {"_id": key, "status": "applied"}, {"$set": {"status": "undoing"}},
        )
        await _undo_rule(operation)
        applied = operation["applied"]
        touched = set(applied) | set(operation["clear"])
        writes = []
        for row in operation["snapshots"]:
            previous = row["previous"]
            writes.append(UpdateOne(
                {
                    "_id": row["id"], "user_id": uid, **applied,
                    **{field: {"$exists": False} for field in operation["clear"]},
                },
                {
                    "$set": {**previous, "correction_undo_id": operation_id},
                    "$unset": {field: "" for field in touched - previous.keys()},
                },
            ))
        await transactions_col.bulk_write(writes, ordered=False)
        restored = await transactions_col.find(
            {"user_id": uid, "correction_undo_id": operation_id},
            {"category": 1, "custom_category": 1},
        ).to_list(None)
        categories = {
            str(row["_id"]): row.get("custom_category") or row.get("category") or "Other"
            for row in restored
        }
        result = {
            "affected_ids": list(categories), "restored_categories": categories,
            "updated_count": len(categories), "refresh_pending": bool(categories),
        }
        await scoped_correction_operations_col.update_one(
            {"_id": key, "status": "undoing"},
            {"$set": {"status": "undone", "undo_result": result}},
        )
        return result
