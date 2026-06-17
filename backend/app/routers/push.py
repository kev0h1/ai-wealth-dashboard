"""Web Push subscription endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.auth import current_user
from app.core.config import VAPID_PUBLIC_KEY_B64
from app.db.collections import push_subscriptions_col

router = APIRouter(tags=["push"])


@router.get("/push/vapid-public-key")
async def get_vapid_public_key():
    return {"public_key": VAPID_PUBLIC_KEY_B64}


@router.post("/push/subscribe")
async def push_subscribe(request: Request, user: dict = Depends(current_user)):
    data     = await request.json()
    endpoint = data.get("endpoint")
    if not endpoint:
        raise HTTPException(400, "Missing endpoint")
    await push_subscriptions_col.update_one(
        {"_id": endpoint},
        {"$set": {
            "_id": endpoint, "user_id": user["email"],
            "endpoint": endpoint, "keys": data.get("keys", {}),
            "updated_at": datetime.now(),
        }},
        upsert=True,
    )
    return {"ok": True}


@router.delete("/push/subscribe")
async def push_unsubscribe(request: Request, user: dict = Depends(current_user)):
    data     = await request.json()
    endpoint = data.get("endpoint")
    if endpoint:
        await push_subscriptions_col.delete_one({"_id": endpoint, "user_id": user["email"]})
    return {"ok": True}
