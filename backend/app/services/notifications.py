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
from app.services.categories import get_category_kinds, is_non_spend
from app.services.pay_period import get_pay_period_for_date

log = logging.getLogger(__name__)

# Per-type defaults when the user hasn't set a preference. Transactions default
# off (noisiest); the rest are high-signal and default on.
NOTIF_DEFAULTS = {
    "transactions":    False,
    "budget_alerts":   True,
    "goal_milestones": True,
    "insights":        True,
    "period_digest":   True,
    "bill_alerts":     True,
}

# Outflows that aren't real consumption are never counted against a budget.
# That set is no longer duplicated here — it is the declared category kind
# (movement / income), read once per check via app.services.categories.


async def notif_pref(user_id: str, key: str) -> bool:
    doc = await preferences_col.find_one({"user_id": user_id}, {"notification_prefs": 1})
    prefs = (doc or {}).get("notification_prefs") or {}
    return bool(prefs.get(key, NOTIF_DEFAULTS.get(key, False)))


async def _state(user_id: str) -> dict:
    return await notification_state_col.find_one({"_id": user_id}) or {}


async def _maybe_settle_planned(user_id: str) -> None:
    from app.services.planned import settle_planned_expenses
    await settle_planned_expenses(user_id)


async def notify_after_sync(user_id: str, region: str, new_txns: list) -> None:
    """Run every preference-gated check after a sync brought new transactions."""
    if not user_id or user_id == "unknown":
        return
    for label, coro in (
        ("planned_settlement", _maybe_settle_planned(user_id)),
        ("transactions", _maybe_transactions(user_id, new_txns)),
        ("budget_alerts", _maybe_budget_exceeded(user_id, region)),
        ("goal_milestones", _maybe_goal_funded(user_id, region)),
        ("insights", _maybe_new_insights(user_id)),
        ("bill_alerts", _maybe_bill_shortfall(user_id, region)),
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
        # ONE kind-map read for the whole period scan below.
        kinds = await get_category_kinds(user_id)
        q = {"user_id": user_id, "transaction_type": "debit", "date": {"$gte": start_dt}}
        proj = {"amount": 1, "category": 1, "custom_category": 1}
        for col in (transactions_col, yapily_transactions_col):
            for t in await col.find(q, proj).to_list(None):
                cat = t.get("custom_category") or t.get("category") or "Other"
                if is_non_spend(kinds, cat):
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


async def _maybe_bill_shortfall(user_id: str, region: str) -> None:
    if not await notif_pref(user_id, "bill_alerts"):
        return

    from app.db.collections import cashflow_cache_col
    from app.routers.analytics import _build_cashflow_response

    cached = await cashflow_cache_col.find_one({"_id": user_id})
    if not cached:
        return
    resp = await _build_cashflow_response(cached)
    upcoming_bills = resp.get("upcoming_bills") or []

    at_risk = [
        b for b in upcoming_bills
        if b["days_away"] <= 7
        and b.get("account_balance") is not None
        and b["account_balance"] >= 0
        and b["amount"] > b["account_balance"]
    ]
    if not at_risk:
        return

    prefs = await preferences_col.find_one({"user_id": user_id}, {"pay_period_config": 1})
    pay_config = (prefs or {}).get("pay_period_config", {"type": "calendar_month"})
    start, _end = get_pay_period_for_date(_date.today(), pay_config)
    period_key = start.isoformat()

    state = await _state(user_id)
    already: list[str] = (state.get("bill_shortfall") or {}).get(period_key, [])

    sym = "KES " if region == "Kenya" else "£"
    newly: list[str] = []
    for b in at_risk:
        name = b["name"]
        if name in already:
            continue
        days = b["days_away"]
        if days == 0:
            timing = "today"
        elif days == 1:
            timing = "tomorrow"
        else:
            timing = f"in {days}d"
        account_label = b.get("account_bank") or "your account"
        body = (
            f"{name} ({sym}{b['amount']:,.2f}) is due {timing}"
            f" — {account_label} only has {sym}{b['account_balance']:,.2f}."
        )
        await send_push_to_user(user_id, "Bill may not clear", body, "/spend?view=upcoming")
        newly.append(name)

    if not newly:
        return
    await notification_state_col.update_one(
        {"_id": user_id},
        {"$set": {f"bill_shortfall.{period_key}": already + newly}},
        upsert=True,
    )


async def send_period_digest(user_id: str) -> None:
    """Fresh-start digest on the first day of a new pay period.

    One push: how last period went against the budget, plus the standing
    headline goals. This is the primary re-encounter moment for goals —
    the scoreboard comes to the user instead of living on a page they
    have to remember to visit.
    """
    if not await notif_pref(user_id, "period_digest"):
        return
    prefs = await preferences_col.find_one({"user_id": user_id}) or {}
    pay_config = prefs.get("pay_period_config", {"type": "calendar_month"})
    today = _date.today()
    start, _end = get_pay_period_for_date(today, pay_config)
    if start != today:
        return  # not a period boundary
    state = await _state(user_id)
    if state.get("last_digest_period") == start.isoformat():
        return  # already sent for this period

    region = prefs.get("region", "UK")
    sym = "KES " if region == "Kenya" else "£"
    from app.routers.goals import goals_summary, budget_period_spend
    from app.services.pay_period import prev_pay_period

    parts: list[str] = []

    # How last period went against the budget (the fresh-start hook)
    budget_doc = await budgets_col.find_one({"user_id": user_id, "region": region})
    limits = {b["category"]: b["monthly_limit"]
              for b in (budget_doc or {}).get("budgets") or [] if b.get("monthly_limit")}
    if limits and region != "Kenya":
        prev_start, prev_end = prev_pay_period(start, pay_config)
        spend = await budget_period_spend(user_id, prev_start, prev_end)
        spent = sum(max(0.0, spend.get(c, 0.0)) for c in limits)
        total = sum(limits.values())
        verdict = "under" if spent <= total else "over"
        parts.append(f"Last period: {sym}{spent:,.0f} of {sym}{total:,.0f} budgeted ({verdict})")

    # Standing goals (skip budget — covered above with last period's numbers)
    for g in await goals_summary(user_id, region):
        if g["pillar"] != "budget":
            parts.append(f"{g['label']}: {g['detail']}")

    if not parts:
        return
    body = " · ".join(parts)
    if len(body) > 175:
        body = body[:172] + "…"
    await send_push_to_user(user_id, "New pay period — fresh start", body, "/")
    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {"last_digest_period": start.isoformat()}}, upsert=True,
    )

    # Needle push — fired on period boundary, gated by period_digest pref (same gate).
    # Deduped: only once per (uid, period_end) via needle_history_col.pushed flag.
    try:
        from app.services.needle import compute_needle
        from app.services.pay_period import prev_pay_period as _prev_period
        from app.db.collections import needle_history_col

        prev_start, prev_end = _prev_period(start, pay_config)
        needle_id = f"{user_id}:{prev_end.isoformat()}"
        stored = await needle_history_col.find_one({"_id": needle_id})
        already_pushed = stored.get("pushed", False) if stored else False

        if not already_pushed:
            if stored and "lines" in stored:
                needle_doc = stored
            else:
                needle_doc = await compute_needle(user_id, prev_start, prev_end)

            lines = needle_doc.get("lines", {})
            push_headline = lines.get("headline", "Your month, closed.")
            push_body = lines.get("movement", "")
            if push_body and len(push_body) > 130:
                push_body = push_body[:127] + "…"
            if push_body:
                await send_push_to_user(user_id, push_headline, push_body, "/month/story?which=last")
            await needle_history_col.update_one(
                {"_id": needle_id},
                {"$set": {"pushed": True, "pushed_at": datetime.utcnow().isoformat()}},
                upsert=True,
            )
    except Exception as _needle_push_exc:
        log.warning("needle push failed for %s: %s", user_id, _needle_push_exc)
