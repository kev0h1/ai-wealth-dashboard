"""B60: the safety buffer, view and update.

The safety buffer is the user's savings goal (``savings_goals_col``): either N
months of typical spending or a fixed amount, filled from the accounts they
pick. The Grow ladder's starter buffer and full emergency fund rungs read it.

View: ``buffer_extras`` adds the goal's own fields to get_savings_position
(type, months, account names, days covered). The ladder rung states are left
out: they come from the whole Grow computation (debt plan, safe to spend), which
is too heavy for a chat lookup, and the tool already returns the funded figure.

Update: propose_set_savings_goal and propose_clear_savings_goal. The executors
replay PUT and DELETE /savings/goal (see app.routers.can_i). The payday_buffer
preference is a separate thing and is deliberately not writable here.
"""
import logging

from fastapi import HTTPException

logger = logging.getLogger(__name__)

PROPOSE_SET_SAVINGS_GOAL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_set_savings_goal",
        "description": (
            "Propose setting the user's safety buffer (emergency fund target), the same thing the "
            "buffer sheet on Grow does. Either target_type 'months' with target_months 1 to 24 (that "
            "many months of typical spending) or target_type 'amount' with a target_amount in pounds. "
            "account_names optionally lists the accounts that count towards it (names as the user "
            "says them); leave it out to keep the accounts already chosen, or all cash if none. Use "
            "it for 'change my buffer to 3 months' and 'set my emergency fund to £2,000'. Call "
            "get_savings_position first to see the current setting. Setting it again is the undo."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_type": {"type": "string", "enum": ["months", "amount"]},
                "target_months": {"type": "integer", "minimum": 1, "maximum": 24},
                "target_amount": {"type": "number", "exclusiveMinimum": 0},
                "account_names": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["target_type"],
        },
    },
}

PROPOSE_CLEAR_SAVINGS_GOAL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_clear_savings_goal",
        "description": (
            "Propose clearing the user's safety buffer target, the same thing the buffer sheet's "
            "remove control does. Setting a target again is the undo, so nothing is lost."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def _money(amount, decimals: int = 0) -> str:
    val = round(float(amount or 0.0), decimals)
    return f"−£{abs(val):,.{decimals}f}" if val < 0 else f"£{val:,.{decimals}f}"


async def _account_labels(uid: str, ids: list[str]) -> list[str]:
    """Labels for the goal's account ids, holder-named accounts never by name (G337)."""
    if not ids:
        return []
    from app.routers.savings import _bank_accounts, _manual_accounts
    from app.services.account_names import display_account_name
    from app.services.notifications import _user_name_tokens
    from app.services.penny_consolidation import source_label

    wanted = set(ids)
    try:
        tokens = await _user_name_tokens(uid)
    except Exception:
        tokens = []
    labels = []
    for acc in [*await _bank_accounts(uid), *await _manual_accounts(uid)]:
        if str(acc.get("_id")) in wanted:
            labels.append(source_label(display_account_name(acc.get("name")), acc.get("provider"), tokens))
    return labels


async def buffer_extras(uid: str, goal: dict | None, current: float, monthly_spending: float) -> dict:
    """Fields get_savings_position adds about the goal itself. Never raises."""
    from app.routers.grow import DAYS_PER_MONTH

    daily = monthly_spending / DAYS_PER_MONTH if monthly_spending > 0 else 0.0
    extras = {
        "target_type": (goal or {}).get("target_type"),
        "target_months": int(goal["target_months"]) if goal and goal.get("target_months") else None,
        "days_covered": round(current / daily) if daily > 0 else 0,
        "account_names": [],
    }
    try:
        extras["account_names"] = await _account_labels(uid, [str(i) for i in (goal or {}).get("account_ids") or []])
    except Exception:
        logger.warning("penny_buffer: account names unavailable for %s", uid, exc_info=True)
    return extras


async def _current_goal_text(uid: str) -> tuple[dict | None, float, str]:
    """(goal doc, typical monthly spending, 'Not set' or the goal in words)."""
    from datetime import datetime, timedelta

    # The router's own collection name: the same object PUT /savings/goal writes through.
    from app.routers.savings import _cashflow, _target_amount, savings_goals_col

    goal = await savings_goals_col.find_one({"_id": uid})
    try:
        _, spending, _ = await _cashflow(uid, datetime.now() - timedelta(days=90))
    except Exception:
        logger.warning("penny_buffer: spending unavailable for %s", uid, exc_info=True)
        spending = 0.0
    return goal, spending, describe_goal(goal, spending, _target_amount)


def describe_goal(goal: dict | None, spending: float, target_amount_fn) -> str:
    if not goal:
        return "Not set"
    if goal.get("target_type") == "amount" and goal.get("target_amount") is not None:
        return _money(goal["target_amount"])
    months = int(goal.get("target_months") or 3)
    about = f" (about {_money(target_amount_fn(goal, spending))})" if spending > 0 else ""
    return f"{months} month{'s' if months != 1 else ''} of spending{about}"


async def exec_propose_set_savings_goal(uid: str, args: dict) -> dict:
    from app.routers.savings import _target_amount, build_savings_goal_doc
    from app.services import penny_tools as pt

    names = args.get("account_names")
    if names is not None and not isinstance(names, list):
        return pt._tool_error("account_names must be a list of names")
    body = {"target_type": args.get("target_type")}
    if args.get("target_months") is not None:
        body["target_months"] = args.get("target_months")
    if args.get("target_amount") is not None:
        body["target_amount"] = args.get("target_amount")
    try:
        doc = build_savings_goal_doc(uid, body)
    except HTTPException:
        return pt._tool_error("target_type must be months or amount, months 1 to 24, amount above zero")
    except (TypeError, ValueError):
        return pt._tool_error("target_months and target_amount must be numbers")

    goal, spending, before = await _current_goal_text(uid)
    account_ids = [str(i) for i in (goal or {}).get("account_ids") or []]
    if names:
        account_ids = []
        for name in names:
            resolved = await pt._resolve_account_for_propose(uid, str(name))
            if resolved.get("ambiguous"):
                return resolved
            if resolved.get("error"):
                return pt._tool_error(resolved["error"])
            if resolved.get("account") is not None:
                account_ids.append(str(resolved["account"].id))
    after = describe_goal(doc, spending, _target_amount)
    summary = f"Set your safety buffer to {after}"
    params = {"target_type": doc["target_type"], "account_ids": account_ids}
    if doc["target_type"] == "months":
        params["target_months"] = doc["target_months"]
    else:
        params["target_amount"] = doc["target_amount"]
    consequence = "Changes the target your buffer progress is measured against. Nothing moves between accounts."
    return await pt._create_proposal(
        uid, "set_savings_goal", params, summary, consequence,
        before=before, after=after, entity="Safety buffer",
    )


async def exec_propose_clear_savings_goal(uid: str) -> dict:
    from app.services import penny_tools as pt

    goal, _spending, before = await _current_goal_text(uid)
    if not goal:
        return pt._tool_error("no safety buffer is set")
    return await pt._create_proposal(
        uid, "clear_savings_goal", {}, "Clear your safety buffer target",
        "Removes the target only. Your accounts and balances are untouched, and you can set a target again at any time.",
        before=before, after="Not set", entity="Safety buffer",
    )
