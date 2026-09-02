"""Planned one-off expenses — CRUD + safe-to-spend impact preview."""
from datetime import date, datetime
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import (
    accounts_col,
    planned_expenses_col,
    yapily_accounts_col,
)
from app.services import response_cache

router = APIRouter(tags=["planned"])


def _try_oid(v: str):
    try:
        return ObjectId(v)
    except Exception:
        return v


# ---------------------------------------------------------------------------
# POST /planned — create a planned expense and return impact preview
# ---------------------------------------------------------------------------

@router.post("/planned")
async def create_planned_expense(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]

    # ── Validate name ────────────────────────────────────────────────────────
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required and must not be blank")

    # ── Validate amount ──────────────────────────────────────────────────────
    try:
        amount = float(body["amount"])
        if amount <= 0:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "amount must be a positive number")

    # ── Validate date ────────────────────────────────────────────────────────
    try:
        expense_date = date.fromisoformat(body["date"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "date must be an ISO date string (YYYY-MM-DD)")
    if expense_date < date.today():
        raise HTTPException(400, "date must be today or in the future")

    # ── Validate account_id (optional) ──────────────────────────────────────
    account_id: str | None = body.get("account_id") or None
    if account_id:
        # Verify this account belongs to the user
        acct_doc = await accounts_col.find_one(
            {"_id": _try_oid(account_id), "user_id": uid}, {"_id": 1}
        )
        if not acct_doc:
            acct_doc = await yapily_accounts_col.find_one(
                {"_id": _try_oid(account_id), "user_id": uid}, {"_id": 1}
            )
        if not acct_doc:
            raise HTTPException(404, "Account not found")

    # ── BEFORE snapshot ──────────────────────────────────────────────────────
    from app.routers.analytics import compute_safe_to_spend
    before = await compute_safe_to_spend(uid)

    # ── Insert document ──────────────────────────────────────────────────────
    doc: dict[str, Any] = {
        "user_id":        uid,
        "name":           name,
        "amount":         amount,
        "date":           datetime(expense_date.year, expense_date.month, expense_date.day),
        "account_id":     account_id,
        "created_at":     datetime.now(),
        "status":         "planned",
        "matched_txn_id": None,
    }
    result = await planned_expenses_col.insert_one(doc)
    inserted_id = result.inserted_id

    # ── Invalidate cache + AFTER snapshot ───────────────────────────────────
    response_cache.invalidate(uid)
    after = await compute_safe_to_spend(uid)

    def _sts(r: dict):
        """Safe-to-spend value if status is ok, else None."""
        return r.get("safe_to_spend") if r.get("status") == "ok" else None

    return {
        "planned": {
            "id":         str(inserted_id),
            "name":       name,
            "amount":     amount,
            "date":       expense_date.isoformat(),
            "account_id": account_id,
            "status":     "planned",
            # Penny Agent Mode v1 origin badge (owner decision, 2026-08-30):
            # None here — a plain POST /planned save is never Penny-originated
            # on its own; app.routers.can_i's execute_proposal stamps this
            # field onto the doc (and mirrors it into this same response
            # dict) right after this function returns, when the caller WAS a
            # Penny proposal.
            "created_via": doc.get("created_via"),
        },
        "impact": {
            "safe_to_spend_before": _sts(before),
            "safe_to_spend_after":  _sts(after),
            "state_after":          after.get("state") if after.get("status") == "ok" else None,
        },
    }


# ---------------------------------------------------------------------------
# GET /planned — list active planned expenses
# ---------------------------------------------------------------------------

@router.get("/planned")
async def list_planned_expenses(user: dict = Depends(current_user)):
    uid = user["email"]
    docs = await planned_expenses_col.find(
        {"user_id": uid, "status": "planned"},
        {"user_id": 0},
    ).sort("date", 1).to_list(None)
    out = []
    for d in docs:
        pdate = d["date"]
        if isinstance(pdate, datetime):
            pdate = pdate.date()
        created = d.get("created_at")
        out.append({
            "id":         str(d["_id"]),
            "name":       d["name"],
            "amount":     float(d["amount"]),
            "date":       pdate.isoformat(),
            "account_id": d.get("account_id"),
            "created_at": created.isoformat() if created else None,
            # Penny Agent Mode v1 origin badge — see create_planned_expense's
            # own comment above.
            "created_via": d.get("created_via"),
        })
    return out


# ---------------------------------------------------------------------------
# DELETE /planned/{planned_id} — remove a planned expense
# ---------------------------------------------------------------------------

@router.delete("/planned/{planned_id}")
async def delete_planned_expense(planned_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    try:
        oid = ObjectId(planned_id)
    except InvalidId:
        raise HTTPException(400, "Invalid planned_id")

    result = await planned_expenses_col.delete_one({"_id": oid, "user_id": uid})
    if result.deleted_count == 0:
        raise HTTPException(404, "Planned expense not found")

    response_cache.invalidate(uid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# PATCH /planned/{planned_id} — update a planned expense
# ---------------------------------------------------------------------------

@router.patch("/planned/{planned_id}")
async def update_planned_expense(planned_id: str, body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    try:
        oid = ObjectId(planned_id)
    except InvalidId:
        raise HTTPException(400, "Invalid planned_id")

    doc = await planned_expenses_col.find_one({"_id": oid, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Planned expense not found")

    updates: dict = {}

    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise HTTPException(400, "name is required and must not be blank")
        updates["name"] = name

    if "amount" in body:
        try:
            amount = float(body["amount"])
            if amount <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(400, "amount must be a positive number")
        updates["amount"] = amount

    if "date" in body:
        try:
            new_date = date.fromisoformat(body["date"])
        except (TypeError, ValueError):
            raise HTTPException(400, "date must be an ISO date string (YYYY-MM-DD)")
        stored_date = doc["date"]
        if isinstance(stored_date, datetime):
            stored_date = stored_date.date()
        # Grandfathering: if new date == stored date, always accept (rolled pending item)
        if new_date != stored_date and new_date < date.today():
            raise HTTPException(400, "date must be today or in the future")
        updates["date"] = datetime(new_date.year, new_date.month, new_date.day)

    if "account_id" in body:
        raw_account_id = body.get("account_id")
        if not raw_account_id:
            updates["account_id"] = None
        else:
            account_id = str(raw_account_id)
            acct_doc = await accounts_col.find_one(
                {"_id": _try_oid(account_id), "user_id": uid}, {"_id": 1}
            )
            if not acct_doc:
                acct_doc = await yapily_accounts_col.find_one(
                    {"_id": _try_oid(account_id), "user_id": uid}, {"_id": 1}
                )
            if not acct_doc:
                raise HTTPException(404, "Account not found")
            updates["account_id"] = account_id

    if not updates:
        # Nothing to update — return current item
        pdate = doc["date"]
        if isinstance(pdate, datetime):
            pdate = pdate.date()
        return {
            "id": str(doc["_id"]),
            "name": doc["name"],
            "amount": float(doc["amount"]),
            "date": pdate.isoformat(),
            "account_id": doc.get("account_id"),
            "status": doc.get("status", "planned"),
            "created_via": doc.get("created_via"),
        }

    await planned_expenses_col.update_one({"_id": oid, "user_id": uid}, {"$set": updates})
    response_cache.invalidate(uid)

    # Merge updates over doc to return updated item
    merged = {**doc, **updates}
    pdate = merged["date"]
    if isinstance(pdate, datetime):
        pdate = pdate.date()
    return {
        "id": str(merged["_id"]),
        "name": merged["name"],
        "amount": float(merged["amount"]),
        "date": pdate.isoformat(),
        "account_id": merged.get("account_id"),
        "status": merged.get("status", "planned"),
        "created_via": merged.get("created_via"),
    }
