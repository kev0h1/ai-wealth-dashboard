"""Tax page endpoints — lightweight income signal for gating tax levers."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services.region import get_user_region
from app.services.cashflow import monthly_cashflow_cached

router = APIRouter(tags=["tax"])


@router.get("/tax/annualised-income")
async def get_annualised_income(user: dict = Depends(current_user)):
    """Annualised income derived from the same spike-smoothed median-monthly
    cashflow signal used elsewhere in the app (see app/services/cashflow.py),
    for gating tax levers that depend on income thresholds (e.g. self-assessment
    registration). Reuses the cached cashflow blob (6h TTL) — no new heavy
    computation.

    Returns {"annualised_income": null} when there's no observed income signal
    (e.g. no income transactions in the lookback window) — callers should treat
    null as "unknown" and hide income-gated content rather than guess.
    """
    uid = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)
    cf = await monthly_cashflow_cached(uid, region, cutoff)
    monthly_income = cf.get("income") or 0.0
    if monthly_income <= 0:
        return {"annualised_income": None}
    return {"annualised_income": round(monthly_income * 12, 2)}
