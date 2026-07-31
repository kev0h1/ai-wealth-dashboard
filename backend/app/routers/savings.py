"""Safety-net savings goal, insights and plan endpoints."""
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import (
    accounts_col, transactions_col, yapily_transactions_col,
    savings_goals_col, savings_plans_col, manual_accounts_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.cashflow import monthly_cashflow_cached

router = APIRouter(tags=["savings"])


async def _cashflow(uid: str, region: str, cutoff: datetime) -> tuple[float, float, float]:
    """(monthly_income, monthly_everyday_spending, monthly_surplus_after_debt), each a
    spike-smoothed 'typical month'. Surplus subtracts committed debt repayments so it
    reflects genuinely free cash. See app/services/cashflow.py."""
    cf = await monthly_cashflow_cached(uid, region, cutoff)
    surplus = round(cf["income"] - cf["spending"] - cf["debt"], 2)
    return cf["income"], cf["spending"], surplus


async def _bank_accounts(uid: str) -> list[dict]:
    accs = await accounts_col.find({"user_id": uid}).to_list(None)
    return [a for a in accs if a.get("type") == "bank"]


async def _manual_accounts(uid: str) -> list[dict]:
    """Manual accounts that hold savable cash (credit cards are debt, not savings)."""
    docs = await manual_accounts_col.find({"user_id": uid}).to_list(None)
    return [a for a in docs if a.get("account_type", "savings") != "credit_card"]


def _target_amount(goal: Optional[dict], monthly_spending: float) -> float:
    if not goal:
        return 0.0
    if goal.get("target_type") == "amount" and goal.get("target_amount") is not None:
        return round(float(goal["target_amount"]), 2)
    months = int(goal.get("target_months") or 3)
    return round(months * monthly_spending, 2)


async def _current_savings(uid: str, goal: Optional[dict]) -> float:
    balances: dict[str, float] = {}
    for a in await _bank_accounts(uid):
        balances[str(a["_id"])] = a.get("balance", 0)
    for a in await _manual_accounts(uid):
        balances[str(a["_id"])] = a.get("balance", 0)
    if goal and goal.get("account_ids"):
        ids = set(goal["account_ids"])
        return round(sum(v for k, v in balances.items() if k in ids), 2)
    # Not configured yet: preview against all cash
    return round(sum(balances.values()), 2)


def _project_funded(current: float, target: float, surplus: float) -> tuple[int, Optional[str]]:
    """Months until target reached at current surplus + projected calendar month."""
    if target <= 0 or current >= target:
        return 0, None
    if surplus <= 0:
        return 999, None
    import math
    months = math.ceil((target - current) / surplus)
    future = datetime.now().replace(day=1) + timedelta(days=32 * months)
    return months, future.strftime("%Y-%m")


@router.get("/savings/insights")
async def savings_insights(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    goal = await savings_goals_col.find_one({"_id": uid})
    monthly_income, monthly_spending, monthly_surplus = await _cashflow(uid, region, cutoff)

    banks       = await _bank_accounts(uid)
    manuals     = await _manual_accounts(uid)
    selected_ids = set(goal["account_ids"]) if goal and goal.get("account_ids") else set()
    accounts = [
        {"account_id": str(a["_id"]), "name": a["name"], "provider": a.get("provider", ""),
         "balance": round(a.get("balance", 0), 2),
         "selected": str(a["_id"]) in selected_ids, "manual": False}
        for a in banks
    ] + [
        {"account_id": str(a["_id"]), "name": a["name"], "provider": "Offline",
         "balance": round(a.get("balance", 0), 2),
         "selected": str(a["_id"]) in selected_ids, "manual": True}
        for a in manuals
    ]

    current  = await _current_savings(uid, goal)
    target   = _target_amount(goal, monthly_spending)
    pct      = round(min(100.0, current / target * 100), 1) if target > 0 else 0.0
    months_funded = round(current / monthly_spending, 1) if monthly_spending > 0 else 0.0
    months_to_target, funded_date = _project_funded(current, target, monthly_surplus)

    return {
        "configured":      bool(goal),
        "accounts":        accounts,
        "current_savings": current,
        "target_amount":   target,
        "target_type":     goal.get("target_type") if goal else None,
        "target_months":   int(goal.get("target_months")) if goal and goal.get("target_months") else None,
        "pct_funded":      pct,
        "months_funded":   months_funded,
        "monthly_income":  monthly_income,
        "monthly_spending": monthly_spending,
        "monthly_surplus": monthly_surplus,
        "months_to_target": months_to_target,
        "funded_date":     funded_date,
        "has_data":        monthly_spending > 0 or monthly_income > 0,
    }


@router.put("/savings/goal")
async def save_savings_goal(body: dict, user: dict = Depends(current_user)):
    uid         = user["email"]
    target_type = body.get("target_type")
    if target_type not in ("months", "amount"):
        raise HTTPException(400, "target_type must be 'months' or 'amount'")
    account_ids = [str(a) for a in body.get("account_ids", []) if a]
    doc: dict = {
        "_id": uid, "user_id": uid,
        "target_type": target_type,
        "account_ids": account_ids,
        "created_at": datetime.now(),
    }
    if target_type == "months":
        months = int(body.get("target_months") or 3)
        if months < 1 or months > 24:
            raise HTTPException(400, "target_months out of range")
        doc["target_months"] = months
        doc["target_amount"] = None
    else:
        amount = float(body.get("target_amount") or 0)
        if amount <= 0:
            raise HTTPException(400, "target_amount must be positive")
        doc["target_amount"] = round(amount, 2)
        doc["target_months"] = None
    await savings_goals_col.replace_one({"_id": uid}, doc, upsert=True)
    return await savings_insights(user)


@router.delete("/savings/goal")
async def delete_savings_goal(user: dict = Depends(current_user)):
    await savings_goals_col.delete_one({"_id": user["email"]})
    return {"configured": False}


# ── Offline (manually-tracked) accounts ──────────────────────────────────────

def _parse_balance(raw) -> float:
    try:
        bal = round(float(raw), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid balance")
    if bal < 0:
        raise HTTPException(400, "Balance must be 0 or more")
    return bal


@router.post("/savings/manual-account")
async def add_manual_account(body: dict, user: dict = Depends(current_user)):
    uid  = user["email"]
    name = str(body.get("name", "")).strip()[:60]
    if not name:
        raise HTTPException(400, "Account name is required")
    bal  = _parse_balance(body.get("balance") or 0)
    doc  = {
        "_id": str(uuid_lib.uuid4())[:8], "user_id": uid,
        "name": name, "balance": bal, "account_type": "savings",
        "created_at": datetime.now(), "updated_at": datetime.now(),
    }
    await manual_accounts_col.insert_one(doc)
    return await savings_insights(user)


@router.patch("/savings/manual-account/{acc_id}")
async def update_manual_account(acc_id: str, body: dict, user: dict = Depends(current_user)):
    uid     = user["email"]
    updates: dict = {}
    if "name" in body:
        name = str(body["name"]).strip()[:60]
        if not name:
            raise HTTPException(400, "Account name is required")
        updates["name"] = name
    if "balance" in body:
        updates["balance"] = _parse_balance(body["balance"])
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates["updated_at"] = datetime.now()
    res = await manual_accounts_col.update_one({"_id": acc_id, "user_id": uid}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(404, "Account not found")
    return await savings_insights(user)


@router.delete("/savings/manual-account/{acc_id}")
async def delete_manual_account(acc_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    await manual_accounts_col.delete_one({"_id": acc_id, "user_id": uid})
    await savings_goals_col.update_one({"_id": uid}, {"$pull": {"account_ids": acc_id}})
    return await savings_insights(user)


# ── Savings plan (milestones) ────────────────────────────────────────────────

def _plan_with_progress(plan: dict, current_savings: float) -> dict:
    """Savings milestones auto-complete once the balance reaches the target; actions stay manual."""
    milestones = []
    for m in plan.get("milestones", []):
        done = bool(m.get("done"))
        if m.get("type") == "savings" and m.get("target_balance") is not None:
            done = current_savings >= float(m["target_balance"])
        created = m.get("done_at")
        milestones.append({
            "id": m["id"], "type": m.get("type", "action"), "text": m.get("text", ""),
            "target_balance": m.get("target_balance"),
            "done": done,
            "done_at": created.isoformat() if isinstance(created, datetime) else created,
        })
    created_at = plan.get("created_at")
    return {
        "target_amount":      plan.get("target_amount"),
        "savings_at_creation": plan.get("savings_at_creation"),
        "created_at":         created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        "milestones":         milestones,
        "done_count":         sum(1 for m in milestones if m["done"]),
        "total_count":        len(milestones),
        "current_savings":    current_savings,
    }


async def _savings_balance(uid: str) -> float:
    goal = await savings_goals_col.find_one({"_id": uid})
    return await _current_savings(uid, goal)


def _norm_milestone(m: dict) -> Optional[dict]:
    mtype = "savings" if m.get("type") == "savings" else "action"
    text  = str(m.get("text", "")).strip()[:200]
    if not text:
        return None
    tb = m.get("target_balance")
    return {
        "id":             str(uuid_lib.uuid4())[:8],
        "type":           mtype,
        "text":           text,
        "target_balance": float(tb) if (mtype == "savings" and tb is not None) else None,
        "done":           False,
        "done_at":        None,
    }


@router.get("/savings/plan")
async def get_savings_plan(user: dict = Depends(current_user)):
    uid  = user["email"]
    plan = await savings_plans_col.find_one({"_id": uid})
    if not plan:
        return {"plan": None}
    return {"plan": _plan_with_progress(plan, await _savings_balance(uid))}


@router.put("/savings/plan")
async def save_savings_plan(body: dict, user: dict = Depends(current_user)):
    uid        = user["email"]
    milestones = body.get("milestones", [])
    if not isinstance(milestones, list) or not milestones:
        raise HTTPException(400, "Plan must have at least one milestone")
    norm = [n for m in milestones[:12] if (n := _norm_milestone(m))]
    if not norm:
        raise HTTPException(400, "Plan must have at least one milestone")
    current = await _savings_balance(uid)
    doc = {
        "_id": uid, "user_id": uid,
        "target_amount":       float(body["target_amount"]) if body.get("target_amount") else None,
        "savings_at_creation": current,
        "milestones":          norm,
        "created_at":          datetime.now(),
    }
    await savings_plans_col.replace_one({"_id": uid}, doc, upsert=True)
    return {"plan": _plan_with_progress(doc, current)}


@router.post("/savings/plan/milestones")
async def add_savings_plan_milestones(body: dict, user: dict = Depends(current_user)):
    uid      = user["email"]
    incoming = body.get("milestones", [])
    if not isinstance(incoming, list) or not incoming:
        raise HTTPException(400, "No milestones to add")

    current = await _savings_balance(uid)
    plan    = await savings_plans_col.find_one({"_id": uid})
    if not plan:
        plan = {
            "_id": uid, "user_id": uid,
            "target_amount":       float(body["target_amount"]) if body.get("target_amount") else None,
            "savings_at_creation": current,
            "milestones":          [],
            "created_at":          datetime.now(),
        }

    existing_texts = {m.get("text", "").strip().lower() for m in plan.get("milestones", [])}
    added = 0
    for m in incoming[:12]:
        norm = _norm_milestone(m)
        if not norm or norm["text"].lower() in existing_texts:
            continue
        if len(plan["milestones"]) >= 12:
            break
        plan["milestones"].append(norm)
        existing_texts.add(norm["text"].lower())
        added += 1

    if added == 0 and not plan.get("milestones"):
        raise HTTPException(400, "Plan must have at least one milestone")

    await savings_plans_col.replace_one({"_id": uid}, plan, upsert=True)
    return {"plan": _plan_with_progress(plan, current), "added": added}


@router.patch("/savings/plan/step/{step_id}")
async def toggle_savings_plan_step(step_id: str, body: dict, user: dict = Depends(current_user)):
    uid  = user["email"]
    done = bool(body.get("done"))
    plan = await savings_plans_col.find_one({"_id": uid})
    if not plan:
        raise HTTPException(404, "No plan")
    found = False
    for m in plan.get("milestones", []):
        if m["id"] == step_id and m.get("type") != "savings":
            m["done"]    = done
            m["done_at"] = datetime.now() if done else None
            found = True
            break
    if not found:
        raise HTTPException(404, "Step not found or not manually toggleable")
    await savings_plans_col.update_one({"_id": uid}, {"$set": {"milestones": plan["milestones"]}})
    return {"plan": _plan_with_progress(plan, await _savings_balance(uid))}


@router.delete("/savings/plan/step/{step_id}")
async def delete_savings_plan_step(step_id: str, user: dict = Depends(current_user)):
    uid  = user["email"]
    plan = await savings_plans_col.find_one({"_id": uid})
    if not plan:
        raise HTTPException(404, "No plan")
    remaining = [m for m in plan.get("milestones", []) if m["id"] != step_id]
    if len(remaining) == len(plan.get("milestones", [])):
        raise HTTPException(404, "Step not found")
    if not remaining:
        await savings_plans_col.delete_one({"_id": uid})
        return {"plan": None}
    await savings_plans_col.update_one({"_id": uid}, {"$set": {"milestones": remaining}})
    plan["milestones"] = remaining
    return {"plan": _plan_with_progress(plan, await _savings_balance(uid))}


@router.delete("/savings/plan")
async def delete_savings_plan(user: dict = Depends(current_user)):
    await savings_plans_col.delete_one({"_id": user["email"]})
    return {"plan": None}
