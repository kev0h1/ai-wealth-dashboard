"""Preference-gated notification triggers, fired after a transaction sync.

A single orchestrator (`notify_after_sync`) runs the per-type checks, each
gated by the user's notification preferences and de-duplicated via
`notification_state_col` so the same alert never fires twice for one event.
"""
import logging
from datetime import datetime, timedelta
from datetime import date as _date

from app.core.push import send_push_to_user, notify_new_transactions
from app.db.collections import (
    preferences_col, budgets_col, savings_goals_col,
    transactions_col, yapily_transactions_col, notification_state_col,
)
from app.services.pay_period import get_pay_period_for_date

log = logging.getLogger(__name__)

# Per-type defaults when the user hasn't set a preference. Transactions default
# off (noisiest); the rest are high-signal and default on.
NOTIF_DEFAULTS = {
    "transactions":    False,
    "budget_alerts":   True,
    "goal_milestones": True,
    "insights":        True,
}

# Outflows that aren't real consumption — never counted against a budget.
_NON_BUDGET = {"Transfer", "Savings", "Debt", "Income"}


async def notif_pref(user_id: str, key: str) -> bool:
    doc = await preferences_col.find_one({"user_id": user_id}, {"notification_prefs": 1})
    prefs = (doc or {}).get("notification_prefs") or {}
    return bool(prefs.get(key, NOTIF_DEFAULTS.get(key, False)))


async def _state(user_id: str) -> dict:
    return await notification_state_col.find_one({"_id": user_id}) or {}


async def notify_after_sync(user_id: str, region: str, new_txns: list) -> None:
    """Run every preference-gated check after a sync brought new transactions."""
    if not user_id or user_id == "unknown":
        return
    for label, coro in (
        ("transactions", _maybe_transactions(user_id, new_txns)),
        ("budget_alerts", _maybe_budget_exceeded(user_id, region)),
        ("goal_milestones", _maybe_goal_funded(user_id, region)),
        ("insights", _maybe_new_insights(user_id)),
    ):
        try:
            await coro
        except Exception as e:  # one failing check must not block the others
            log.warning("notify_after_sync %s failed for %s: %s", label, user_id, e)


async def _maybe_transactions(user_id: str, new_txns: list) -> None:
    if new_txns and await notif_pref(user_id, "transactions"):
        await notify_new_transactions(user_id, new_txns)


async def _maybe_budget_exceeded(user_id: str, region: str) -> None:
    if not await notif_pref(user_id, "budget_alerts"):
        return
    budget_doc = await budgets_col.find_one({"user_id": user_id, "region": region})
    budgets = (budget_doc or {}).get("budgets") or []
    limits = {b["category"]: b["monthly_limit"] for b in budgets if b.get("monthly_limit")}
    if not limits:
        return

    prefs = await preferences_col.find_one({"user_id": user_id}, {"pay_period_config": 1})
    pay_config = (prefs or {}).get("pay_period_config", {"type": "calendar_month"})
    start, _end = get_pay_period_for_date(_date.today(), pay_config)
    period_key = start.isoformat()
    start_dt = datetime(start.year, start.month, start.day)

    spend: dict[str, float] = {}
    if region != "Kenya":
        q = {"user_id": user_id, "transaction_type": "debit", "date": {"$gte": start_dt}}
        proj = {"amount": 1, "category": 1, "custom_category": 1}
        for col in (transactions_col, yapily_transactions_col):
            for t in await col.find(q, proj).to_list(None):
                cat = t.get("custom_category") or t.get("category") or "Other"
                if cat in _NON_BUDGET:
                    continue
                spend[cat] = spend.get(cat, 0.0) + abs(float(t.get("amount", 0) or 0))

    state = await _state(user_id)
    already = (state.get("budget_exceeded") or {}).get(period_key, [])
    newly: list[str] = []
    for cat, limit in limits.items():
        if spend.get(cat, 0.0) >= limit and cat not in already:
            newly.append(cat)

    if not newly:
        return
    sym = "KES " if region == "Kenya" else "£"
    for cat in newly:
        await send_push_to_user(
            user_id,
            f"Over budget: {cat}",
            f"You've spent {sym}{spend[cat]:,.0f} of your {sym}{limits[cat]:,.0f} {cat} budget this period.",
            "/budget",
        )
    await notification_state_col.update_one(
        {"_id": user_id},
        {"$set": {f"budget_exceeded.{period_key}": already + newly}},
        upsert=True,
    )


async def _maybe_goal_funded(user_id: str, region: str) -> None:
    if not await notif_pref(user_id, "goal_milestones"):
        return
    from app.routers.savings import _current_savings, _target_amount, _cashflow

    goal = await savings_goals_col.find_one({"_id": user_id})
    if not goal:
        return
    cutoff = datetime.now() - timedelta(days=90)
    _income, monthly_spending, _surplus = await _cashflow(user_id, region, cutoff)
    target = _target_amount(goal, monthly_spending)
    if target <= 0:
        return
    current = await _current_savings(user_id, goal)
    if current < target:
        return

    target_key = f"{target:.0f}"
    state = await _state(user_id)
    if state.get("goal_funded") == target_key:
        return
    sym = "KES " if region == "Kenya" else "£"
    await send_push_to_user(
        user_id,
        "Savings goal reached",
        f"You've hit your {sym}{target:,.0f} safety-net target. Nicely done.",
        "/insights",
    )
    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {"goal_funded": target_key}}, upsert=True,
    )


async def _maybe_new_insights(user_id: str) -> None:
    if not await notif_pref(user_id, "insights"):
        return
    from app.routers.analytics import compute_insights

    insights = await compute_insights(user_id)
    current_ids = [i.id for i in insights]
    state = await _state(user_id)

    # First run: record the baseline silently so we don't blast every existing
    # insight as if it were brand new.
    if "seen_insights" not in state:
        await notification_state_col.update_one(
            {"_id": user_id}, {"$set": {"seen_insights": current_ids}}, upsert=True,
        )
        return

    seen = set(state.get("seen_insights") or [])
    fresh = [i for i in insights if i.id not in seen]
    if fresh:
        top = max(fresh, key=lambda i: i.impact)
        title = "New money insight" if len(fresh) == 1 else f"{len(fresh)} new money insights"
        await send_push_to_user(user_id, title, top.title, "/insights")
    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {"seen_insights": current_ids}}, upsert=True,
    )
