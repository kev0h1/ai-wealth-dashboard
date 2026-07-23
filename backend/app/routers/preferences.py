"""User preferences endpoints."""
from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import preferences_col
from app.services.notifications import NOTIF_DEFAULTS

router = APIRouter(tags=["preferences"])


def _notif_prefs(doc: dict) -> dict:
    saved = (doc or {}).get("notification_prefs") or {}
    return {k: bool(saved.get(k, default)) for k, default in NOTIF_DEFAULTS.items()}


@router.get("/preferences")
async def get_preferences(user: dict = Depends(current_user)):
    doc = await preferences_col.find_one({"user_id": user["email"]})
    if not doc:
        return {
            "hide_net_worth": False, "dark_mode": False,
            "pay_period_config": {"type": "calendar_month"},
            "region": "UK", "debt_target_months": 12,
            "notification_prefs": _notif_prefs({}),
        }
    region = doc.get("region", "UK")
    result = {
        "hide_net_worth":     doc.get("hide_net_worth", False),
        "dark_mode":          doc.get("dark_mode", False),
        "pay_period_config":  doc.get("pay_period_config", {"type": "calendar_month"}),
        "region":             region,
        "debt_target_months": doc.get("debt_target_months", 12),
        "notification_prefs": _notif_prefs(doc),
        "income_bracket":     doc.get("income_bracket", ""),
        "income_value":       doc.get("income_value", 0),
        "pension_annual":     doc.get("pension_annual", 0),
        "has_child_benefit":  doc.get("has_child_benefit", False),
        "home_pinned_accounts": doc.get("home_pinned_accounts", []),
        "home_pinned_cards":  doc.get("home_pinned_cards", []),
        "spend_widgets":      doc.get("spend_widgets"),
        "budget_widgets":     doc.get("budget_widgets"),
        "home_pinned_widget": doc.get("home_pinned_widget"),
        "recurring_categories": doc.get("recurring_categories") or ["Bills", "Savings", "Subscriptions", "Health", "Software", "Debt"],
        "dismissed_recurring":  doc.get("dismissed_recurring", []),
    }
    if "debt_tracking_start" in doc:
        result["debt_tracking_start"] = doc["debt_tracking_start"]
    return result


@router.patch("/preferences")
async def update_preferences(body: dict, user: dict = Depends(current_user)):
    # income_bracket is derived, not chosen — the salary is the source of truth
    if "income_value" in body:
        v = body.get("income_value") or 0
        body["income_bracket"] = (
            "under_100k" if v < 100_000 else "100k_125k" if v <= 125_140 else "125k_plus"
        )
    await preferences_col.update_one(
        {"user_id": user["email"]},
        {"$set": {**body, "user_id": user["email"]}},
        upsert=True,
    )
    doc = await preferences_col.find_one({"user_id": user["email"]})
    return {"hide_net_worth": doc.get("hide_net_worth", False), "dark_mode": doc.get("dark_mode", False)}
