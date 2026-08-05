"""Debt plan router — Phase A + narration.

GET /debt-plan  →  deterministic projection + Penny narration for the
authenticated user's credit cards.  Session-auth only (same pattern as all
other routers).
"""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services.debt_narration import get_debt_plan_view

router = APIRouter(tags=["debt-plan"])


@router.get("/debt-plan")
async def get_debt_plan(user: dict = Depends(current_user)):
    uid = user["email"]
    return await get_debt_plan_view(uid)
