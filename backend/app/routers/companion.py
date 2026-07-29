"""Companion spine — today-engine router."""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services.companion import compute_today_items, dismiss_item

router = APIRouter(tags=["companion"])


@router.get("/today")
async def get_today(user: dict = Depends(current_user)):
    uid = user["email"]
    items = await compute_today_items(uid)
    return {"status": "ok", "items": items}


@router.post("/today/dismiss")
async def dismiss_today_item(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        from fastapi import HTTPException
        raise HTTPException(400, "item_id required")
    await dismiss_item(uid, item_id)
    return {"ok": True}
