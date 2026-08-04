"""Debt plan router — Phase A.

GET /debt-plan  →  deterministic projection for the authenticated user's
credit cards.  Session-auth only (same pattern as all other routers).
Zero LLM; see app/services/debt_plan.py for the doctrine.
"""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services.debt_plan import get_debt_plan_cached

router = APIRouter(tags=["debt-plan"])


@router.get("/debt-plan")
async def get_debt_plan(user: dict = Depends(current_user)):
    uid = user["email"]
    return await get_debt_plan_cached(uid)
