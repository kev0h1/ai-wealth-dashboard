"""Web Push subscription endpoints."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.core.auth import current_user
from app.core.config import VAPID_PUBLIC_KEY_B64
from app.core.push import send_push_to_user
from app.core.ratelimit import check_rate_limit
from app.db.collections import (
    push_subscriptions_col, apns_tokens_col, fcm_tokens_col,
)

router = APIRouter(tags=["push"])


class APNsRegisterBody(BaseModel):
    token: str
    platform: str = "ios"


class APNsUnregisterBody(BaseModel):
    token: str


class FCMRegisterBody(BaseModel):
    token: str
    platform: str = "android"


class FCMUnregisterBody(BaseModel):
    token: str


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


@router.post("/push/apns/register")
async def apns_register(body: APNsRegisterBody, user: dict = Depends(current_user)):
    """Register an APNs device token from the native iOS app."""
    await apns_tokens_col.update_one(
        {"_id": body.token},
        {"$set": {
            "_id": body.token, "user_id": user["email"],
            "token": body.token, "platform": body.platform,
            "updated_at": datetime.now(),
        },
         "$setOnInsert": {"created_at": datetime.now()}},
        upsert=True,
    )
    return {"ok": True}


@router.delete("/push/apns/register")
async def apns_unregister(body: APNsUnregisterBody, user: dict = Depends(current_user)):
    await apns_tokens_col.delete_one({"_id": body.token, "user_id": user["email"]})
    return {"ok": True}


@router.post("/push/fcm/register")
async def fcm_register(body: FCMRegisterBody, user: dict = Depends(current_user)):
    """Register an FCM device token from the native Android app."""
    await fcm_tokens_col.update_one(
        {"_id": body.token},
        {"$set": {
            "_id": body.token, "user_id": user["email"],
            "token": body.token, "platform": body.platform,
            "updated_at": datetime.now(),
        },
         "$setOnInsert": {"created_at": datetime.now()}},
        upsert=True,
    )
    return {"ok": True}


@router.delete("/push/fcm/register")
async def fcm_unregister(body: FCMUnregisterBody, user: dict = Depends(current_user)):
    await fcm_tokens_col.delete_one({"_id": body.token, "user_id": user["email"]})
    return {"ok": True}


@router.get("/push/native/status")
async def native_push_status(token: str, user: dict = Depends(current_user)):
    """Check whether a device token is registered for the caller, and on which platform."""
    fcm_doc = await fcm_tokens_col.find_one({"_id": token, "user_id": user["email"]})
    if fcm_doc:
        return {"registered": True, "platform": "android"}
    apns_doc = await apns_tokens_col.find_one({"_id": token, "user_id": user["email"]})
    if apns_doc:
        return {"registered": True, "platform": "ios"}
    return {"registered": False, "platform": None}


@router.post("/push/test")
async def push_test(request: Request, user: dict = Depends(current_user)):
    """Send a test push to every device registered for the caller, so setup can be verified."""
    if limited := check_rate_limit(request):
        return limited

    user_id = user["email"]
    fcm_count = await fcm_tokens_col.count_documents({"user_id": user_id})
    apns_count = await apns_tokens_col.count_documents({"user_id": user_id})
    webpush_count = await push_subscriptions_col.count_documents({"user_id": user_id})

    if fcm_count + apns_count + webpush_count == 0:
        return {
            "ok": False,
            "sent": False,
            "devices": {"apns": 0, "fcm": 0, "webpush": 0},
            "detail": "No devices are registered for push on this backend.",
        }

    result = await send_push_to_user(
        user_id,
        "Test notification",
        "Push notifications are set up on this device.",
        "/settings",
    )
    return {
        "ok": True,
        "sent": True,
        "devices": {"apns": apns_count, "fcm": fcm_count, "webpush": webpush_count},
        "result": result,
    }
