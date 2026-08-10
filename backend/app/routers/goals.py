"""Cross-pillar headline goals — one per pillar, auto-tracked.

The research-backed model: a single headline goal per pillar (debt-free,
safety net funded, inside budget), tracked by the system, surfaced at
moments (Home scoreboard, Penny context, period-start digest) rather than
maintained as milestone checklists.
"""
from datetime import datetime, timedelta, date as _date

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import (
    accounts_col, debt_plans_col, savings_goals_col, budgets_col, preferences_col,
    transactions_col, yapily_transactions_col,
)
from app.services.region import get_user_region
from app.services.pay_period import get_pay_period_for_date

router = APIRouter(tags=["goals"])

_NON_BUDGET = {"Transfer", "Savings", "Investment", "Debt", "Income"}


async def _current_total_debt(uid: str) -> float:
    accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    cc = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
    return round(sum(abs(a["balance"]) for a in cc), 2)


async def budget_period_spend(uid: str, start: _date, end: _date) -> dict[str, float]:
    """Net spend per category (refunds subtract) over a period, GBP only."""
    start_dt = datetime(start.year, start.month, start.day)
    end_dt = datetime(end.year, end.month, end.day, 23, 59, 59)
    spend: dict[str, float] = {}
    q = {"user_id": uid, "date": {"$gte": start_dt, "$lte": end_dt}}
    proj = {"amount": 1, "category": 1, "custom_category": 1, "transaction_type": 1, "currency": 1}
    for col in (transactions_col, yapily_transactions_col):
        for t in await col.find(q, proj).to_list(None):
            if t.get("currency") not in (None, "", "GBP"):
                continue
            ttype = t.get("transaction_type")
            if ttype not in ("debit", "credit"):
                continue
            cat = t.get("custom_category") or t.get("category") or "Other"
            if cat in _NON_BUDGET:
                continue
            amt = abs(float(t.get("amount", 0) or 0))
            spend[cat] = spend.get(cat, 0.0) + (-amt if ttype == "credit" else amt)
    return spend


async def goals_summary(uid: str, region: str) -> list[dict]:
    """Up to three headline goals; pillars without a plan/budget are omitted."""
    goals: list[dict] = []
    sym = "KSh " if region == "Kenya" else "£"

    # Debt — the plan's end state is the goal: balance to zero by the target date
    plan = await debt_plans_col.find_one({"_id": uid})
    if plan:
        current = await _current_total_debt(uid)
        baseline = float(plan.get("debt_at_creation") or 0)
        pct = 100 if current <= 0 else (
            round(max(0.0, min(1.0, (baseline - current) / baseline)) * 100) if baseline > 0 else 0
        )
        label = "Debt-free"
        created, months = plan.get("created_at"), plan.get("target_months")
        if isinstance(created, datetime) and months:
            label += f" by {(created + timedelta(days=30.44 * int(months))).strftime('%b %Y')}"
        goals.append({
            "pillar": "debt", "label": label,
            "detail": "Done 🎉" if current <= 0 else f"{sym}{current:,.0f} to go",
            "pct": pct, "done": current <= 0, "url": "/debt-plan",
        })

    # Savings — safety net funded
    goal = await savings_goals_col.find_one({"_id": uid})
    if goal:
        from app.routers.savings import _cashflow, _target_amount, _current_savings
        cutoff = datetime.now() - timedelta(days=90)
        _inc, monthly_spending, _sur = await _cashflow(uid, region, cutoff)
        target = _target_amount(goal, monthly_spending)
        if target > 0:
            current = await _current_savings(uid, goal)
            goals.append({
                "pillar": "savings", "label": "Safety net",
                "detail": f"{sym}{current:,.0f} of {sym}{target:,.0f}",
                "pct": round(max(0.0, min(1.0, current / target)) * 100),
                "done": current >= target, "url": "/grow",
            })

    # Budget — inside the envelope this pay period (GBP regions only for now)
    budget_doc = await budgets_col.find_one({"user_id": uid, "region": region})
    limits = {b["category"]: b["monthly_limit"]
              for b in (budget_doc or {}).get("budgets") or [] if b.get("monthly_limit")}
    if limits and region != "Kenya":
        prefs = await preferences_col.find_one({"user_id": uid}, {"pay_period_config": 1})
        pay_config = (prefs or {}).get("pay_period_config", {"type": "calendar_month"})
        start, end = get_pay_period_for_date(_date.today(), pay_config)
        spend = await budget_period_spend(uid, start, end)
        total_limit = sum(limits.values())
        spent = sum(max(0.0, spend.get(c, 0.0)) for c in limits)
        over = [c for c, lim in limits.items() if spend.get(c, 0.0) > lim]
        # Label states the truth, not the aspiration — "Inside budget" while
        # overspent reads as a bug to the user.
        blown = bool(over) or (total_limit > 0 and spent > total_limit)
        goals.append({
            "pillar": "budget", "label": "Over budget" if blown else "Inside budget",
            "detail": f"{sym}{spent:,.0f} of {sym}{total_limit:,.0f}"
                      + (f" · {len(over)} over" if over else ""),
            "pct": round(min(1.0, spent / total_limit) * 100) if total_limit > 0 else 0,
            "done": False, "at_risk": blown, "url": "/budget",
        })

    return goals


def goals_context_text(goals: list[dict]) -> str:
    """Compact blob for Penny's system prompts — every chat sees every goal."""
    if not goals:
        return ""
    lines = [f"- {g['label']}: {g['detail']} ({g['pct']}%{' — done' if g.get('done') else ''})"
             for g in goals]
    return (
        "\n\nTheir headline goals across the app (all auto-tracked; you can reference any of them in any conversation):\n"
        + "\n".join(lines)
    )


@router.get("/goals/summary")
async def get_goals_summary(user: dict = Depends(current_user)):
    region = await get_user_region(user["email"])
    return {"goals": await goals_summary(user["email"], region)}
