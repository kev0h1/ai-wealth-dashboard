"""POST /penny/chip — engine-owned answers for the per-screen chips
(pennyScreenConfig.tsx's fixed labels) and the personalised "Can I spend
£40 this weekend?" chips GET /can-i/suggestions composes.

See app.services.penny_chips's own module docstring for the full doctrine:
every chip here is composed in Python from the same read tools/engines the
Penny tool loop and the screen itself already use, no model call, never
recorded to llm_usage_col, never counted against the Penny message cap
(app.core.subscription.penny_allowance, enforced on POST /can-i only).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.services.penny_chips import answer_chip

logger = logging.getLogger(__name__)

router = APIRouter(tags=["penny"])


@router.post("/penny/chip")
async def penny_chip(body: dict, user: dict = Depends(current_user)):
    chip_id = body.get("chip_id")
    if not isinstance(chip_id, str) or not chip_id:
        raise HTTPException(400, "chip_id required")

    raw_params = body.get("params")
    params = raw_params if isinstance(raw_params, dict) else None
    screen = body.get("screen")  # grounding only, not used for routing here
    uid = user["email"]

    try:
        result = await answer_chip(uid, chip_id, params)
    except LookupError:
        raise HTTPException(404, "Unknown chip")

    logger.info(
        "penny_chip: uid=%s chip_id=%s kind=%s screen=%s",
        uid, chip_id, result.get("kind"), screen,
    )
    return result
