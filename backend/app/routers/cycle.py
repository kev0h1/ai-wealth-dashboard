"""Cycle (pay-period) story router."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.services.cycle_story import get_cycle_story
from app.services.cycle_story_personas import get_persona_story, PERSONAS

router = APIRouter(tags=["cycle"])


@router.get("/cycle/story")
async def cycle_story(
    which: str = "current",
    preview_close: int = 0,
    persona: str | None = None,
    user: dict = Depends(current_user),
):
    if persona is not None:
        if persona not in PERSONAS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown persona '{persona}'. Valid: {sorted(PERSONAS.keys())}",
            )
        return await get_persona_story(persona)
    if which not in ("current", "last"):
        raise HTTPException(status_code=400, detail="which must be 'current' or 'last'")
    uid = user["email"]
    return await get_cycle_story(uid, which, preview_close=bool(preview_close))
