"""Grow — the single 'what next with my money' view.

Reuses the existing savings buffer helpers, the deterministic debt-plan
engine and the investments display helper rather than recomputing any of
their maths. Nothing here fabricates a number: rungs that need data we
don't have (income/pension-band) are marked 'locked' and say so plainly.

FCA doctrine: 'verdict' and rung 'detail' state facts only (amounts, dates,
percentages) — never an instruction. 'options' use generic trade-off
phrasing ("some people ...", "overpaying debt is a guaranteed return ...")
and never say "you should".
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import card_terms_col, investment_accounts_col, savings_goals_col
from app.services.region import get_user_region
from app.routers.card_terms import _promos_from_legacy
from app.routers.savings import _cashflow, _current_savings, _target_amount
from app.services.debt_plan import get_debt_plan_cached, MATERIAL_BALANCE
from app.routers.investments import _investment_display

router = APIRouter(tags=["grow"])

DAYS_PER_MONTH = 30.44
FULL_FUND_MONTHS = 3


# ── Small formatting helpers (facts only — no instructions) ──────────────────

def _money(x: float) -> str:
    return f"£{x:,.0f}"


async def _promo_cliff(uid: str, account_ids: set[str]) -> Optional[str]:
    """Earliest active 0% promo end (ISO date) across the given card accounts."""
    if not account_ids:
        return None
    today = date.today()
    earliest: Optional[date] = None
    async for doc in card_terms_col.find({"user_id": uid, "account_id": {"$in": list(account_ids)}}):
        stored_promos = doc.get("promos")
        promos = stored_promos if isinstance(stored_promos, list) else _promos_from_legacy(
            doc.get("on_promo"), doc.get("promo_kind"), doc.get("promo_end"),
        )
        for p in promos:
            try:
                until_d = date.fromisoformat(str(p.get("until") or ""))
            except (ValueError, TypeError):
                continue
            if until_d < today:
                continue
            if earliest is None or until_d < earliest:
                earliest = until_d
    return earliest.isoformat() if earliest else None


@router.get("/grow")
async def grow_view(user: dict = Depends(current_user)):
    uid = user["email"]
    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    # ── Surplus & buffer (reuses savings.py helpers) ─────────────────────────
    monthly_income, monthly_spending, monthly_surplus = await _cashflow(uid, region, cutoff)
    goal = await savings_goals_col.find_one({"_id": uid})
    current_savings = await _current_savings(uid, goal)
    target_amount = _target_amount(goal, monthly_spending)
    target_months = int(goal["target_months"]) if goal and goal.get("target_months") else 3
    pct = round(min(100.0, current_savings / target_amount * 100), 1) if target_amount > 0 else 0.0
    daily_spend = monthly_spending / DAYS_PER_MONTH if monthly_spending > 0 else 0.0
    days_covered = round(current_savings / daily_spend) if daily_spend > 0 else 0

    buffer = {
        "current": round(current_savings, 2),
        "target": target_amount,
        "pct": pct,
        "days_covered": days_covered,
        "target_months": target_months,
    }

    # ── Debt (reuses the deterministic debt-plan engine) ──────────────────────
    plan = await get_debt_plan_cached(uid)
    cards = plan.get("cards", [])
    total_debt = plan.get("totals", {}).get("debt", 0.0)
    has_debt = total_debt > 0

    material_cards = [
        c for c in cards
        if c.get("debt", 0) >= MATERIAL_BALANCE and c.get("classification") != "cleared_monthly"
    ]
    expensive_total = round(
        sum(c["debt"] for c in cards if c.get("classification") == "carried_interest"), 2
    )
    all_promo = bool(material_cards) and all(
        c.get("classification") == "carried_zero" for c in material_cards
    )
    promo_account_ids = {
        c["account_id"] for c in material_cards if c.get("classification") == "carried_zero"
    }
    promo_cliff = await _promo_cliff(uid, promo_account_ids)

    debt = {
        "has_debt": has_debt,
        "total": round(total_debt, 2),
        "all_promo": all_promo,
        "expensive_total": expensive_total,
        "promo_cliff": promo_cliff,
    }

    # ── Investments (reuses investments.py display helper) ───────────────────
    inv_accounts = await investment_accounts_col.find({"user_id": uid}).to_list(None)
    _inv_displays = [await _investment_display(a) for a in inv_accounts]
    portfolio_value = round(
        sum(d["display_value"] for d in _inv_displays), 2
    )
    invest = {
        "portfolio_value": portfolio_value,
        "has_investments": portfolio_value > 0,
    }

    # ── Verdict (facts only) ──────────────────────────────────────────────────
    if monthly_surplus > 0:
        headline = f"You've got ~{_money(monthly_surplus)}/month spare"
    elif monthly_surplus < 0 and has_debt:
        # The shortfall includes committed debt repayments, so attribute it honestly rather
        # than blaming spending alone. The pure spending-vs-income gap is shown separately
        # on the Essentials rung, so the two figures never get conflated.
        headline = f"After debt repayments, you're about {_money(-monthly_surplus)}/month short"
    elif monthly_surplus < 0:
        headline = f"Your spending has been running ~{_money(-monthly_surplus)}/month ahead of income"
    else:
        headline = "Your income and spending have been about even"

    if days_covered <= 0:
        sub = "Your buffer covers ~0 days of spending"
    elif days_covered < 30:
        sub = f"Your buffer covers ~{days_covered} days"
    else:
        months_covered = round(days_covered / DAYS_PER_MONTH, 1)
        sub = f"Your buffer covers ~{months_covered} months"

    verdict = {"headline": headline, "sub": sub}

    # ── Ladder ─────────────────────────────────────────────────────────────────
    one_month_target = round(monthly_spending, 2)
    full_fund_target = round(monthly_spending * FULL_FUND_MONTHS, 2)

    # essentials: does income cover spending (before debt repayments)?
    have_income_data = monthly_income > 0 or monthly_spending > 0
    if not have_income_data:
        essentials_resolved = "locked"
        essentials_detail = "Add your income and spending to see this"
    else:
        essentials_gap = round(monthly_income - monthly_spending, 2)
        essentials_resolved = "done" if essentials_gap >= 0 else "not_done"
        essentials_detail = (
            f"Your everyday spending fits within your income, with about {_money(essentials_gap)}/month to spare — this excludes savings, investments and debt repayments"
            if essentials_gap >= 0
            else f"Your everyday spending is about {_money(-essentials_gap)}/month more than your income — this excludes savings, investments and debt repayments"
        )

    # pension_match: no employer/pension-band data source exists yet
    pension_match_resolved = "locked"
    pension_match_detail = "Add your income to see this"

    # starter_buffer: 1 month essential spend
    if monthly_spending <= 0:
        starter_resolved = "locked"
        starter_detail = "Add your spending data to see this"
    else:
        starter_resolved = "done" if current_savings >= one_month_target else "not_done"
        starter_detail = f"Your buffer holds {_money(current_savings)} against a 1-month target of {_money(one_month_target)}"

    # expensive_debt: interest-bearing (non-promo) debt
    if not has_debt:
        expensive_resolved = "done"
        expensive_detail = "You have no debt on file"
    elif all_promo:
        expensive_resolved = "done"
        expensive_detail = (
            f"Your carried debt is all on a 0% deal, ending {promo_cliff}"
            if promo_cliff else "Your carried debt is all on a 0% deal"
        )
    elif expensive_total > 0:
        expensive_resolved = "not_done"
        expensive_detail = f"You're carrying {_money(expensive_total)} outside any 0% deal"
    else:
        expensive_resolved = "done"
        expensive_detail = "You have no debt carrying interest right now"

    # full_fund: ~3 months essential spend
    if monthly_spending <= 0:
        full_fund_resolved = "locked"
        full_fund_detail = "Add your spending data to see this"
    else:
        full_fund_resolved = "done" if current_savings >= full_fund_target else "not_done"
        full_fund_detail = f"Your buffer holds {_money(current_savings)} against a 3-month target of {_money(full_fund_target)}"

    # pension_topup: needs income/pension-band data we don't have
    pension_topup_resolved = "locked"
    pension_topup_detail = "Add your income to see this"

    # isa_invest: locked until buffer + debt are both satisfied
    buffer_and_debt_satisfied = (full_fund_resolved == "done") and (expensive_resolved == "done")
    if not buffer_and_debt_satisfied:
        isa_resolved = "locked"
        isa_detail = "This unlocks once your buffer reaches ~3 months of spending and any expensive debt is cleared"
    else:
        isa_resolved = "done" if invest["has_investments"] else "not_done"
        isa_detail = (
            f"You hold {_money(portfolio_value)} in investments on file"
            if invest["has_investments"]
            else "You have no investments on file yet"
        )

    rungs = [
        {
            "key": "essentials", "title": "Essentials",
            "resolved": essentials_resolved, "detail": essentials_detail,
            "options": [],
        },
        {
            "key": "pension_match", "title": "Employer pension match",
            "resolved": pension_match_resolved, "detail": pension_match_detail,
            "options": [],
        },
        {
            "key": "starter_buffer", "title": "Starter buffer",
            "resolved": starter_resolved, "detail": starter_detail,
            "options": [
                "Some people build a small cash buffer before tackling anything else",
                "Others prioritise clearing expensive debt first, since it's a guaranteed saving",
            ],
        },
        {
            "key": "expensive_debt", "title": "Expensive debt",
            "resolved": expensive_resolved, "detail": expensive_detail,
            "options": [
                "Overpaying debt is a guaranteed return equal to the rate — investing may return more or less and your capital is at risk",
                "Some people keep a small cash buffer alongside expensive debt rather than putting every spare pound towards it",
            ],
        },
        {
            "key": "full_fund", "title": "Full emergency fund",
            "resolved": full_fund_resolved, "detail": full_fund_detail,
            "options": [
                "Some people hold 3-6 months of essential spending in cash before investing more",
                "Others invest sooner and treat other credit as a backstop — that carries its own risk",
            ],
        },
        {
            "key": "pension_topup", "title": "Pension top-up",
            "resolved": pension_topup_resolved, "detail": pension_topup_detail,
            "options": [
                "Some people top up pension contributions for the tax relief before investing elsewhere",
                "Others prioritise ISA investing for easier access to the money",
            ],
        },
        {
            "key": "isa_invest", "title": "ISA / general investing",
            "resolved": isa_resolved, "detail": isa_detail,
            "options": [
                "Some people prioritise ISA or pension contributions once debt and buffer are sorted; others keep building cash",
                "Investing can lose money as well as gain it, and past performance isn't a guide to future returns",
            ],
        },
    ]

    # First unmet ("not_done") rung in order becomes 'active'; everything
    # after it locks regardless of its own resolved state; 'locked' rungs stay
    # locked; 'done' rungs before the active one stay 'done'.
    ladder = []
    active_assigned = False
    for r in rungs:
        resolved = r["resolved"]
        if active_assigned:
            state = "locked"
        elif resolved == "done":
            state = "done"
        elif resolved == "not_done":
            state = "active"
            active_assigned = True
        else:  # "locked" (missing data) — doesn't block later rungs
            state = "locked"
        ladder.append({
            "key": r["key"], "title": r["title"], "state": state,
            "detail": r["detail"], "options": r["options"],
        })

    notes = [
        "Investing can lose money as well as gain it, and past performance isn't a guide to future returns — your capital is at risk.",
        "The cash-ISA limit drops to £12,000 for under-65s from April 2027.",
    ]

    return {
        "verdict": verdict,
        "surplus_monthly": round(monthly_surplus, 2),
        "buffer": buffer,
        "debt": debt,
        "invest": invest,
        "ladder": ladder,
        "notes": notes,
    }
