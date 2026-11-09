"""HTTP boundary for the persisted Transfers Sorted history."""
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import current_user
from app.services.filed_transfers import list_filed_transfers

router = APIRouter(tags=["filed-transfers"])
logger = logging.getLogger(__name__)


@router.get("/transactions/filed-transfers")
async def get_filed_transfers(
    start: date | None = Query(None, alias="from"), end: date | None = Query(None, alias="to"),
    source: str = "all", page: int = 1, page_size: int = 20, user: dict = Depends(current_user),
):
    if source not in {"all", "sorted", "user"}:
        raise HTTPException(400, "source must be all, sorted or user")
    if page < 1:
        raise HTTPException(400, "page must be at least 1")
    if not 1 <= page_size <= 50:
        raise HTTPException(400, "page_size must be between 1 and 50")
    if bool(start) != bool(end):
        raise HTTPException(400, "Provide both from and to for a period")
    if start and end and end < start:
        raise HTTPException(400, "to must not be before from")
    return await list_filed_transfers(user["email"], start=start, end=end, source=source, page=page, page_size=page_size)


@router.post("/transactions/filed-transfers/undo")
async def undo_filed_transfer(body: dict, user: dict = Depends(current_user)):
    series_key = body.get("series_key")
    if not isinstance(series_key, str) or not series_key:
        raise HTTPException(400, "Provide 'series_key'")
    from app.services.filed_transfer_undo import undo_filed_series
    try:
        result = await undo_filed_series(user["email"], series_key)
    except ValueError as exc:
        logger.info("G449 transfer undo needs a history reload", exc_info=True)
        raise HTTPException(409, "This series changed or could not be undone safely. Reload history before trying again.") from exc
    if not result.get("undone"):
        raise HTTPException(404, "That transfer series is no longer filed")
    # The helper records one durable H145 marker before any possible write,
    # and invalidates review/cache state on both success and compensation.
    return {"ok": True, "undone": result["undone"], "transaction_ids": result.get("transaction_ids", []),
            "recomputed": False, "pending": True}
