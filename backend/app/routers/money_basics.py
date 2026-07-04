"""Money basics — curated UK personal-finance explainers (general info, not advice)."""
from datetime import date

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.content.money_basics import MONEY_BASICS, GROW_TOPICS, TAX_YEAR

router = APIRouter(tags=["money-basics"])


@router.get("/money-basics/daily")
async def daily_money_basic(user: dict = Depends(current_user)):
    """Today's explainer — deterministic rotation, identical for every user on a given day."""
    idx = date.today().toordinal() % len(MONEY_BASICS)
    return {**MONEY_BASICS[idx], "tax_year": TAX_YEAR}


@router.get("/money-basics")
async def list_money_basics(topic: str | None = None, user: dict = Depends(current_user)):
    items = MONEY_BASICS
    if topic == "grow":
        items = [c for c in MONEY_BASICS if c["topic"] in GROW_TOPICS]
    elif topic:
        items = [c for c in MONEY_BASICS if c["topic"].lower() == topic.lower()]
    return {"items": items, "tax_year": TAX_YEAR}
