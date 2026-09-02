"""Cross-pillar headline goals — one per pillar, auto-tracked.

The research-backed model: a single headline goal per pillar (debt-free,
safety net funded), tracked by the system, surfaced at moments (Home
scoreboard, Penny context, period-start digest) rather than maintained as
milestone checklists. A third pillar, "inside budget", was retired
2026-08-30 — see the note in goals_summary() below.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import accounts_col, debt_plans_col, savings_goals_col
from app.services.region import get_user_region

router = APIRouter(tags=["goals"])


async def _current_total_debt(uid: str) -> float:
    accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    cc = [a for a in accounts if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
    return round(sum(abs(a["balance"]) for a in cc), 2)


async def goals_summary(uid: str, region: str) -> list[dict]:
    """Up to two headline goals; pillars without a plan/goal are omitted."""
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

    # 2026-08-30 (owner decision, option C): the "Budget — inside the
    # envelope" pillar that used to live here was removed. Its data source
    # (budgets_col) was retired along with the deleted /budget page, and its
    # only live surface (GoalsStrip) was already gone — GoalsStrip and this
    # module's goals_summary() are only reachable from the archived
    # frontend/app/design/v1|v2|v3 exploration pages, not the live Home.
    # Pace-vs-typical (app.services.notifications._maybe_category_pace)
    # carries the ambient overspend signal now.

    return goals


def goals_context_text(goals: list[dict]) -> str:
    """Compact blob for Penny's system prompts — every chat sees every goal."""
    if not goals:
        return ""
    lines = [f"- {g['label']}: {g['detail']} ({g['pct']}%{', done' if g.get('done') else ''})"
             for g in goals]
    return (
        "\n\nTheir headline goals across the app (all auto-tracked; you can reference any of them in any conversation):\n"
        + "\n".join(lines)
    )


@router.get("/goals/summary")
async def get_goals_summary(user: dict = Depends(current_user)):
    region = await get_user_region(user["email"])
    return {"goals": await goals_summary(user["email"], region)}
