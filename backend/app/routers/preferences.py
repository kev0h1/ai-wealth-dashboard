"""User preferences endpoints."""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import preferences_col

router = APIRouter(tags=["preferences"])


@router.get("/preferences")
async def get_preferences(user: dict = Depends(current_user)):
    doc = await preferences_col.find_one({"user_id": user["email"]})
    if not doc:
        return {
            "hide_net_worth": False, "dark_mode": False,
            "pay_period_config": {"type": "calendar_month"},
            "region": "UK", "debt_target_months": 12,
        }
    region = doc.get("region", "UK")
    result = {
        "hide_net_worth":     doc.get("hide_net_worth", False),
        "dark_mode":          doc.get("dark_mode", False),
        "pay_period_config":  doc.get("pay_period_config", {"type": "calendar_month"}),
        "region":             region,
        "debt_target_months": doc.get("debt_target_months", 12),
    }
    if "debt_tracking_start" in doc:
        result["debt_tracking_start"] = doc["debt_tracking_start"]
    return result


@router.patch("/preferences")
async def update_preferences(body: dict, user: dict = Depends(current_user)):
    await preferences_col.update_one(
        {"user_id": user["email"]},
        {"$set": {**body, "user_id": user["email"]}},
        upsert=True,
    )
    doc = await preferences_col.find_one({"user_id": user["email"]})
    return {"hide_net_worth": doc.get("hide_net_worth", False), "dark_mode": doc.get("dark_mode", False)}
