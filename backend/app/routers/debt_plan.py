"""Debt plan router — Phase A + narration.

GET /debt-plan  →  deterministic projection + Penny narration for the
authenticated user's credit cards.  Session-auth only (same pattern as all
other routers).

GET /debt-plan/summary  →  minimal, deterministic-only summary for the
Planning "Card plan" entry card and Spend's debt burn-down chart widget.
Deliberately calls ONLY the 90s-cached deterministic plan
(get_debt_plan_cached), never get_debt_plan_view / app.services.debt_narration,
so neither consumer waits on a cashflow fetch or an LLM narration call it
doesn't read.
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
    total_monthly = 0.0
    have_monthly = False
    for c in plan.get("cards", []):
        rate_schedule = c.get("rate_schedule") or []
        movement = c.get("movement") or {}
        monthly = movement.get("monthly")
        if c.get("debt", 0) and c.get("debt", 0) > 0 and monthly is not None:
            total_monthly += monthly
            have_monthly = True
        cards.append({
            "account_id": c.get("account_id"),
            "name": c.get("name"),
            "debt": c.get("debt"),
            "currency": c.get("currency"),
            "classification": c.get("classification"),
            "monthly": monthly,
            # Full segment list (from/until/apr_pct/source/kind), not just the
            # first — a burn-down projection needs the whole schedule so it
            # can honour a 0%-promo card's expiry rather than treating today's
            # rate as forever. index 0 stays "the segment covering now",
            # unchanged for existing consumers (Planning's next-cliff read).
            "rate_schedule": [
                {
                    "from": seg.get("from"),
                    "until": seg.get("until"),
                    "apr_pct": seg.get("apr_pct"),
                    "source": seg.get("source"),
                    "kind": seg.get("kind"),
                }
                for seg in rate_schedule
            ],
        })

    return {
        "totals": {
            "buckets": {
                "carried_total": buckets.get("carried_total"),
                "float_total": buckets.get("float_total"),
            },
            # Σ demonstrated monthly paydown across cards carrying a balance —
            # the real default for a burn-down projection's payment control.
            # None (not 0) when no card has enough history for a movement
            # figure, so the client can tell "no data" from "genuinely £0".
            "monthly_payment": _r2_or_none(total_monthly) if have_monthly else None,
        },
        "cards": cards,
        # Passed through verbatim from the cached plan rather than recomputed
        # here, since it's the same _amortise walk that produces Penny's
        # payoff months, so a chart built off it and Penny's narration can
        # never drift apart. Each point is {"month": "YYYY-MM", "total": float},
        # anchored at today's month with today's total debt.
        "projection": plan.get("projection") or [],
    }


def _r2_or_none(v):
    return round(v, 2) if v is not None else None
