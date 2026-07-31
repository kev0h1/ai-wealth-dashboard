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
