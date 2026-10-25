"""B59: get_set_asides, the read tool for the user's set-asides.

A set-aside is an allocation: a per-period amount reserved from left to spend
and filled from an account. They live on Upcoming in the app, and
propose_update_allocation, propose_delete_allocation and
propose_create_allocation change them. Until this tool existed Penny had no
way to list them, so asked "can I edit it here" she invented an answer.

The tool lists what the Upcoming screen shows (the same list_allocations route
the screen reads), with the ids a follow-up proposal needs. Its executor
records an allocation focus on the conversation (see penny_focus).
"""
import logging

from app.core import timeutil
from app.services import penny_period
from app.services.account_names import display_account_name
from app.services.pay_period import get_pay_period_for_date

logger = logging.getLogger(__name__)

HOW_TO_EDIT = "Ask me to change it, or open Upcoming in the app."
_CAP = 30

SET_ASIDES_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_set_asides",
        "description": (
            "The user's set-asides (also called allocations, envelopes or pots to fill) for the "
            "current pay period: each one's id, name, target for this period, how much has been "
            "filled, how much is still to go, the account it fills from, whether it is active or "
            "paused, and whether it repeats. Use it for 'what are my set asides', 'what am I "
            "setting aside this month' and before changing one. Quote the figures verbatim, never "
            "recompute them."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def _money(amount) -> dict:
    val = round(float(amount or 0.0), 2)
    return {"raw": val, "formatted": f"−£{abs(val):,.2f}" if val < 0 else f"£{val:,.2f}"}


def _status(item: dict) -> str:
    if item.get("completed"):
        return "completed"
    if not item.get("active", True):
        return "paused"
    if item.get("pending"):
        return "starts later"
    return "active"


async def exec_get_set_asides(uid: str) -> dict:
    try:
        from app.routers.accounts import get_accounts as _route_get_accounts
        from app.routers.allocations import _pay_cfg, list_allocations as _route_list_allocations

        resp = await _route_list_allocations(user={"email": uid})
        accounts = await _route_get_accounts(user={"email": uid})
        start, end = get_pay_period_for_date(timeutil.user_today(), await _pay_cfg(uid))
    except Exception:
        logger.exception("penny_set_asides: get_set_asides failed for %s", uid)
        return {"error": "set-asides lookup failed"}
    names = {a.id: display_account_name(a.name) for a in accounts}
    items = resp.get("items") or []
    rows = []
    for a in items[:_CAP]:
        fill_id = a.get("fill_account_id") or a.get("destination_account_id")
        rows.append({
            "id": a["id"],
            "name": a.get("name"),
            "target": _money(a.get("period_amount", a.get("amount_per_period"))),
            "usual_per_period": _money(a.get("amount_per_period")),
            "filled": _money(a.get("filled_this_period")),
            "remaining": _money(a.get("remaining")),
            "fill_account": names.get(fill_id) or a.get("fill_display_name") or None,
            "status": _status(a),
            "repeats": a.get("recurrence") != "once",
        })
    result = {
        "set_asides": rows,
        "count": len(rows),
        "period": penny_period.pay_period_period(start, end),
        "how_to_edit": HOW_TO_EDIT,
    }
    if len(items) > len(rows):
        result["capped"] = len(items) - len(rows)
    if not rows:
        result["note"] = "The user has no set-asides yet. Ask me to set one up, or open Upcoming in the app."
    return result
