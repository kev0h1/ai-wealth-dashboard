"""Money Shape — GET /money-shape.

Thin router; all computation lives in app.services.money_shape (see that
module's docstring for the Facts/Voice split, the Consent Rule, and the
no-refetch scope-selector architecture this respects). The response carries
every valid period plus rolling averages so the frontend's scope selector
switches client-side with no round trip -- there is no query param here.
"""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services.money_shape import get_money_shape_cached

router = APIRouter(tags=["money_shape"])


@router.get("/money-shape")
async def money_shape(user: dict = Depends(current_user)):
    uid = user["email"]
    return await get_money_shape_cached(uid)
