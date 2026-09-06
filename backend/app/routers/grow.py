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
import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.services import response_cache
from app.db.collections import (
    card_terms_col,
    investment_accounts_col,
    preferences_col,
    savings_goals_col,
)
from app.services.region import get_user_region
from app.routers.card_terms import _promos_from_legacy
from app.routers.savings import _cashflow, _current_savings, _target_amount
from app.services.debt_plan import get_debt_plan_cached, MATERIAL_BALANCE
from app.routers.investments import _investment_display

router = APIRouter(tags=["grow"])
logger = logging.getLogger(__name__)

DAYS_PER_MONTH = 30.44
FULL_FUND_MONTHS = 3

# UK income-tax facts used for the pension rungs (mirrors the client-side
# maths in frontend/app/tax/TaxPage.tsx — keep the two in sync).
PERSONAL_ALLOWANCE = 12_570
TAPER_START = 100_000
TAPER_END = 125_140
HIGHER_RATE_THRESHOLD = 50_270
PENSION_ANNUAL_ALLOWANCE = 60_000
TAX_LEVERS_LINK = {"label": "See your tax levers ›", "route": "/tax"}


# ── Small formatting helpers (facts only — no instructions) ──────────────────

def _money(x: float) -> str:
    return f"£{x:,.0f}"


def _safe_float(value, default: float = 0.0) -> float:
    """Tolerant float coercion for stored preference fields. A poisoned
    (non-numeric) income_value/pension_annual doc must degrade to the
    surface's existing no-income state, not 500 the whole endpoint."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _taper_loss(adjusted_income: float) -> float:
    """Personal allowance lost to the £100k taper.

    Mirrors `taperLoss()` in frontend/app/tax/TaxPage.tsx: £1 of
    allowance goes for every £2 of adjusted income above £100,000.
    """
    if adjusted_income <= TAPER_START:
        return 0.0
    if adjusted_income >= TAPER_END:
        return float(PERSONAL_ALLOWANCE)
    return float(int((adjusted_income - TAPER_START) // 2))


def _pension_rung_facts(prefs: dict) -> Optional[dict]:
    """Personalised pension_match / pension_topup rung fields from the user's
    stored income preferences (facts only — no instructions, per the FCA
    doctrine above; options stay generic).

    Returns None when no usable income is on file, or if anything in the
    maths fails — callers then keep the existing locked state.
    """
    try:
        income = _safe_float(prefs.get("income_value") or 0)
        if income <= 0:
            return None
        pension_annual = _safe_float(prefs.get("pension_annual") or 0)
        bracket = str(prefs.get("income_bracket") or "")
        # Adjusted income mirrors TaxPage.tsx: income minus annual pension
        # contributions (the figure the taper is assessed against).
        adjusted = income - pension_annual

        # Employer pension match — income is on file; contributions on file
        # are the best available signal that a pension is being paid into.
        if pension_annual > 0:
            match_resolved = "done"
            match_detail = (
                f"Your income ({_money(income)}) and pension contributions "
                f"(~{_money(pension_annual)}/year) are on file. An employer match is a "
                "guaranteed 100% return on the matched amount, some people check "
                "their scheme's match ceiling first."
            )
        else:
            match_resolved = "not_done"
            match_detail = (
                f"Your income is on file ({_money(income)}). An employer match is a "
                "guaranteed 100% return on the matched amount, some people check "
                "their scheme's match ceiling first."
            )

        # Pension top-up — personalised by bracket / adjusted income.
        topup_resolved = "not_done"
        high_bracket = bracket in ("100k_125k", "125k_plus")
        if high_bracket and TAPER_START < adjusted < TAPER_END:
            # The 60% trap: contributions inside the taper band claw back
            # personal allowance on top of higher-rate relief.
            extra = min(adjusted - TAPER_START, TAPER_END - TAPER_START)
            restored = _taper_loss(adjusted)
            topup_detail = (
                f"Contributing {_money(extra)} more this tax year would restore "
                f"{_money(restored)} of personal allowance, effective relief ~60%."
            )
        elif high_bracket and adjusted >= TAPER_END:
            topup_detail = (
                f"Your personal allowance is fully lost to the taper at an adjusted "
                f"income of {_money(adjusted)}, pension contributions attract "
                "~45% relief."
            )
        elif adjusted > HIGHER_RATE_THRESHOLD:
            topup_detail = (
                f"£1,000 into your pension costs you ~£600 at 40% relief. "
                f"Adjusted income on file: {_money(adjusted)}."
            )
        else:
            topup_detail = (
                f"Pension contributions attract tax relief at your marginal rate. "
                f"Adjusted income on file: {_money(adjusted)}."
            )

        # Headroom fact — acknowledge existing contributions against the
        # £60,000 annual allowance (facts only; ~ hedges the estimate).
        if pension_annual > 0:
            if pension_annual >= PENSION_ANNUAL_ALLOWANCE:
                topup_detail += (
                    f" You're at the {_money(PENSION_ANNUAL_ALLOWANCE)} annual allowance."
                )
            else:
                headroom = max(0.0, PENSION_ANNUAL_ALLOWANCE - pension_annual)
                topup_detail += (
                    f" You contribute ~{_money(pension_annual)}/yr, around "
                    f"{_money(headroom)} of this year's "
                    f"{_money(PENSION_ANNUAL_ALLOWANCE)} annual allowance remains."
                )

        return {
            "match_resolved": match_resolved,
            "match_detail": match_detail,
            "topup_resolved": topup_resolved,
            "topup_detail": topup_detail,
            "link": dict(TAX_LEVERS_LINK),
        }
    except Exception:
        return None


def _period_gate(sts: dict) -> dict:
    """Derive the period-truth gate from `compute_safe_to_spend`'s result.

    Owner decision, 2026-08-30: "if I'm short and to say I have money to
    stash away doesn't make sense." Grow's typical-month surplus is a
    90-day smoothed median (see `_cashflow`) and can read positive even
    while the CURRENT pay period is short — Home's Safe-to-Spend hero
    already gives that same fact its "Short this pay period, £X to cover"
    reading (state == "short", the only state that reserves a genuine
    shortfall; "comfortable"/"tight" both keep spare-framing valid). This
    function borrows that exact condition, unmodified, so Grow can never
    disagree with Home or Planning about whether the user is short right
    now. Pure and DB-free so it's unit-testable without mocking
    `compute_safe_to_spend`'s whole DB fan-out (mirrors
    `net_position.short_reason_for`'s own factoring).

    Returns `{"short": False, "to_cover": 0.0, "period_end": None}` when
    `compute_safe_to_spend` couldn't resolve (status != "ok") — degrading
    to "not short" rather than fabricating a gate from absent data.
    """
    if sts.get("status") != "ok":
        return {"short": False, "to_cover": 0.0, "period_end": None}
    short = sts.get("state") == "short"
    return {
        "short": short,
        "to_cover": round(abs(float(sts.get("safe_to_spend") or 0.0)), 2) if short else 0.0,
        "period_end": sts.get("next_payday"),
    }


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

    # ── Mongo-backed response cache (6h safety bound). Grow's own writers
    # never mutate anything directly — everything it reads (preferences,
    # debt plan, savings goal/plan, investments, card terms) is invalidated
    # elsewhere via the generic response_cache.invalidate(uid) full-wipe
    # (accounts.py, allocations.py, card_terms.py, analytics.py's
    # transaction/sync paths, checkpoints.py, planned.py, income.py,
    # account_cascade.py, and PATCH /preferences), so this entry is dropped
    # the same moment those writes drop debt_plan's own cache. ────────────
    cached = await response_cache.aget("grow", uid)
    if cached is not None:
        return cached
    v = await response_cache.snapshot(uid)

    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)

    # ── Income preferences (single read — powers the pension rungs) ──────────
    try:
        _prefs = await preferences_col.find_one({"user_id": uid}) or {}
    except Exception:
        _prefs = {}
    pension_facts = _pension_rung_facts(_prefs)

    # ── Period gate (reuses analytics.py's compute_safe_to_spend — the same
    # period-scoped, allocation-aware figure Home's Safe-to-Spend hero and
    # Planning's runway already read) ─────────────────────────────────────
    # Lazy import: avoids a circular import at module load, same pattern as
    # app/services/pace.py, app/services/spend_impact.py and
    # app/routers/planned.py's own calls into this function.
    #
    # get_cached_safe_to_spend never WRITES the "safe_to_spend" cache (see
    # its own docstring) — if there's no entry yet, it computes fresh here
    # and this "grow" payload becomes the only place that moment is cached.
    # That's fine: GET /safe-to-spend's own write path drops "grow"
    # whenever it caches a NEWER moment (backlog B1, see
    # response_cache.adrop's docstring), so the next Home/Penny visit that
    # populates "safe_to_spend" retires this entry rather than letting it
    # drift for up to 6h.
    from app.routers.analytics import get_cached_safe_to_spend
    try:
        _sts = await get_cached_safe_to_spend(uid)
    except Exception:
        logger.exception("grow: compute_safe_to_spend failed for %s — treating as not short", uid)
        _sts = {"status": "insufficient_data"}
    period_gate = _period_gate(_sts)

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
    _inv_displays = await asyncio.gather(*(_investment_display(a) for a in inv_accounts))
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
        # "In a typical month, " owns the lens explicitly: this rung is always
        # the 90-day smoothed median (see `_cashflow`), never the current pay
        # period. Without this prefix a CLEARED green tick here can land right
        # under the hero's red "this period needs you" verdict with no lens
        # change announced — same fact, two different time windows, no signal
        # that they're different. Applies in both the covered and short states
        # (it's always the typical-month claim, not just during a period gate).
        essentials_detail = (
            f"In a typical month, your everyday spending fits within your income, with about {_money(essentials_gap)}/month to spare. This excludes savings, investments and debt repayments"
            if essentials_gap >= 0
            else f"In a typical month, your everyday spending is about {_money(-essentials_gap)}/month more than your income. This excludes savings, investments and debt repayments"
        )

    # pension_match: personalised from stored income preferences when present,
    # otherwise locked (no income on file).
    pension_match_resolved = "locked"
    pension_match_detail = "Add your income to see this"
    pension_match_link = None
    if pension_facts:
        pension_match_resolved = pension_facts["match_resolved"]
        pension_match_detail = pension_facts["match_detail"]
        pension_match_link = pension_facts["link"]

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

    # pension_topup: personalised by income bracket / adjusted income when
    # income is on file, otherwise locked.
    pension_topup_resolved = "locked"
    pension_topup_detail = "Add your income to see this"
    pension_topup_link = None
    if pension_facts:
        pension_topup_resolved = pension_facts["topup_resolved"]
        pension_topup_detail = pension_facts["topup_detail"]
        pension_topup_link = pension_facts["link"]

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
            "options": [], "link": pension_match_link,
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
                "Overpaying debt is a guaranteed return equal to the rate, investing may return more or less and your capital is at risk",
                "Some people keep a small cash buffer alongside expensive debt rather than putting every spare pound towards it",
            ],
        },
        {
            "key": "full_fund", "title": "Full emergency fund",
            "resolved": full_fund_resolved, "detail": full_fund_detail,
            "options": [
                "Some people hold 3-6 months of essential spending in cash before investing more",
                "Others invest sooner and treat other credit as a backstop, that carries its own risk",
            ],
        },
        {
            "key": "pension_topup", "title": "Pension top-up",
            "resolved": pension_topup_resolved, "detail": pension_topup_detail,
            "link": pension_topup_link,
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
        entry = {
            "key": r["key"], "title": r["title"], "state": state,
            "detail": r["detail"], "options": r["options"],
        }
        if r.get("link"):
            entry["link"] = r["link"]
        ladder.append(entry)

    notes = [
        "Investing can lose money as well as gain it, and past performance isn't a guide to future returns. Your capital is at risk.",
        "The cash-ISA limit drops to £12,000 for under-65s from April 2027.",
    ]

    result = {
        "verdict": verdict,
        "surplus_monthly": round(monthly_surplus, 2),
        "buffer": buffer,
        "debt": debt,
        "invest": invest,
        "ladder": ladder,
        "notes": notes,
        "period_gate": period_gate,
    }
    await response_cache.aput("grow", uid, result, version=v)
    return result
