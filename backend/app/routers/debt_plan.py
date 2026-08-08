"""Debt plan router — Phase A + narration.

GET /debt-plan  →  deterministic projection + Penny narration for the
authenticated user's credit cards.  Session-auth only (same pattern as all
other routers).

GET /debt-plan/summary  →  minimal, deterministic-only summary for the
Planning "Card plan" entry card.  Deliberately calls ONLY the 90s-cached
deterministic plan (get_debt_plan_cached) — never get_debt_plan_view /
app.services.debt_narration — so the card never waits on a cashflow fetch
or an LLM narration call it doesn't read.
"""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services.debt_narration import get_debt_plan_view
from app.services.debt_plan import get_debt_plan_cached

router = APIRouter(tags=["debt-plan"])


@router.get("/debt-plan")
async def get_debt_plan(user: dict = Depends(current_user)):
    uid = user["email"]
    return await get_debt_plan_view(uid)


@router.get("/debt-plan/summary")
async def get_debt_plan_summary(user: dict = Depends(current_user)):
    uid = user["email"]
    plan = await get_debt_plan_cached(uid)

    buckets = plan.get("totals", {}).get("buckets", {}) or {}
    cards = []
    for c in plan.get("cards", []):
        rate_schedule = c.get("rate_schedule") or []
        first_seg = rate_schedule[0] if rate_schedule else {}
        cards.append({
            "name": c.get("name"),
            "rate_schedule": [
                {
                    "source": first_seg.get("source"),
                    "until": first_seg.get("until"),
                }
            ],
        })

    return {
        "totals": {
            "buckets": {
                "carried_total": buckets.get("carried_total"),
                "float_total": buckets.get("float_total"),
            }
        },
        "cards": cards,
    }
