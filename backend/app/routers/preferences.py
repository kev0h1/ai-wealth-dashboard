"""User preferences endpoints."""
import asyncio
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import preferences_col, cashflow_cache_col
from app.services.notifications import NOTIF_DEFAULTS

router = APIRouter(tags=["preferences"])


def _notif_prefs(doc: dict) -> dict:
    saved = (doc or {}).get("notification_prefs") or {}
    return {k: bool(saved.get(k, default)) for k, default in NOTIF_DEFAULTS.items()}


def _coerce_money_field(value, field_name: str) -> int:
    """Accept int/float/numeric-string (commas and whitespace stripped) and
    return an int. Raises HTTPException(422) on anything non-coercible, so a
    bad client payload can never reach the write or the bracket derivation
    below with an unvalidated value (was: `v < 100_000` on a raw string
    500ing the whole save). None/absent stays 0, matching the prior
    `body.get(...) or 0` behaviour."""
    if value is None:
        return 0
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a number")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if cleaned == "":
            return 0
        try:
            return int(float(cleaned))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{field_name} must be a number")
    raise HTTPException(status_code=422, detail=f"{field_name} must be a number")


@router.get("/preferences")
async def get_preferences(user: dict = Depends(current_user)):
    doc = await preferences_col.find_one({"user_id": user["email"]})
    if not doc:
        return {
            "hide_net_worth": False, "dark_mode": False,
            "pay_period_config": {"type": "calendar_month"},
            "region": "UK", "debt_target_months": 12,
            "notification_prefs": _notif_prefs({}),
            "cover_plan_excluded_accounts": [],
            "payday_buffer": 50,
            "debt_burndown_overrides": None,
            # Penny Agent Mode v1 (owner decision, 2026-08-30) — absent/None
            # means the user has NOT granted consent for Penny to propose app
            # actions; an ISO timestamp once POST /penny/agent-consent has
            # been called. See app.services.penny_agent's own consent check.
            "penny_agent_consent": None,
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
        "home_pinned_widget": doc.get("home_pinned_widget"),
        # "What-if" figures for the Spend page's debt_burndown widget — local
        # experimentation only, never fed back into card_terms/accounts.
        "debt_burndown_overrides": doc.get("debt_burndown_overrides"),
        "recurring_categories": doc.get("recurring_categories") or ["Bills", "Savings", "Investment", "Subscriptions", "Health", "Software", "Debt", "Transfer"],
        "dismissed_recurring":  doc.get("dismissed_recurring", []),
        "cover_plan_excluded_accounts": doc.get("cover_plan_excluded_accounts", []),
        "payday_buffer": doc.get("payday_buffer", 50),
        "penny_agent_consent": doc.get("penny_agent_consent"),
    }
    if "debt_tracking_start" in doc:
        result["debt_tracking_start"] = doc["debt_tracking_start"]
    return result


@router.patch("/preferences")
async def update_preferences(body: dict, user: dict = Depends(current_user)):
    # income_bracket is derived, not chosen — the salary is the source of truth
    if "cover_plan_excluded_accounts" in body:
        body["cover_plan_excluded_accounts"] = sorted(
            {str(x) for x in (body.get("cover_plan_excluded_accounts") or []) if str(x).strip()}
        )
    if "income_value" in body:
        v = _coerce_money_field(body.get("income_value"), "income_value")
        body["income_value"] = v
        body["income_bracket"] = (
            "under_100k" if v < 100_000 else "100k_125k" if v <= 125_140 else "125k_plus"
        )
    if "pension_annual" in body:
        body["pension_annual"] = _coerce_money_field(body.get("pension_annual"), "pension_annual")
    uid = user["email"]
    pay_period_changed = "pay_period_config" in body
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {**body, "user_id": uid}},
        upsert=True,
    )
    doc = await preferences_col.find_one({"user_id": uid})

    if pay_period_changed:
        # Best-effort: recompute cashflow so the new pay period takes effect
        # immediately. Don't let a compute failure block the pref save.
        try:
            from app.routers.analytics import compute_and_cache_cashflow
            asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))
        except Exception:
            pass

    if "cover_plan_excluded_accounts" in body:
        try:
            from app.services import response_cache
            response_cache.invalidate(uid, "today")
        except Exception:
            pass

    return {"hide_net_worth": doc.get("hide_net_worth", False), "dark_mode": doc.get("dark_mode", False)}
