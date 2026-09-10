"""Cards story endpoint — pure reading surface.

Returns a descriptive snapshot of what happened with credit cards this pay
cycle: movement totals, per-card breakdown, spending drivers, a behavioural
pattern line from the portrait, and a trajectory of recent periods.

Descriptive only, no advice, no judgement, no LLM calls (BEHAVIOURS.md).

Per-card "outlook" fields (payoff_month, promo_end, apr_pct,
paying_interest, monthly_interest_now, cleared_monthly) and the top-level
extra_to_clear are sourced from app.services.debt_plan.get_debt_plan_cached
(G10, 2026-09-09): a cached read, not a new heavy compute. The debt engine
is a separate, more failure-prone surface (it reads confirmed card_terms
and does amortisation); if it errors or has nothing for a card, this
endpoint must still return the plain story it always has — the outlook
fields are additive and degrade to null, never a 500.
"""
import logging
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import current_user
from app.db.collections import (
    accounts_col,
    preferences_col,
    needle_history_col,
    behaviour_portrait_col,
    account_rates_col,
)
from app.services.debt_plan import get_debt_plan_cached
from app.services.pay_period import get_pay_period_for_date, prev_pay_period
from app.services.needle import (
    _credit_card_account_ids,
    _txns_for_period,
    _abs_amounts,
)
from app.services.categories import get_category_kinds, is_non_spend

log = logging.getLogger(__name__)

router = APIRouter(tags=["cards"])


def _current_apr_and_promo_end(plan_card: dict, today: date) -> tuple:
    """Read the debt-plan card's own `rate_schedule` (the same segments
    compute_debt_plan built from confirmed card_terms) for the segment
    covering `today`'s month, and return (apr_pct, promo_end).

    apr_pct is the rate actually in effect right now (0% during an active
    promo, the standard rate once it's rolled off, or None when there's no
    confirmed rate on file for this month). promo_end is that segment's
    "until" month label, but only when the segment is a promo — a standard-
    rate segment has no promo to report.

    rate_schedule segments are {"from", "until", "apr_pct", "source", "kind"}
    month labels ("YYYY-MM"), "until" inclusive or None when open-ended —
    see app.services.debt_plan._compute_rate_schedule.
    """
    month_str = today.strftime("%Y-%m")
    for seg in plan_card.get("rate_schedule") or []:
        seg_from = seg.get("from")
        seg_until = seg.get("until")
        if seg_from is None or seg_from > month_str:
            continue
        if seg_until is not None and month_str > seg_until:
            continue
        apr_pct = seg.get("apr_pct")
        promo_end = seg_until if seg.get("source") == "promo" else None
        return apr_pct, promo_end
    return None, None


@router.get("/cards/story")
async def cards_story(
    user: dict = Depends(current_user),
    which: str = Query("current"),
):
    if which not in ("current", "last"):
        raise HTTPException(status_code=400, detail="which must be 'current' or 'last'")

    uid = user["email"]
    today = date.today()

    # ── Pay period ────────────────────────────────────────────────────────────
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    start, end = get_pay_period_for_date(today, pay_cfg)
    if which == "last":
        start, end = prev_pay_period(start, pay_cfg)
    days_elapsed = (min(today, end) - start).days + 1

    # ── Credit-card account ids ───────────────────────────────────────────────
    cc_ids = await _credit_card_account_ids(uid)

    # ── Period transactions ───────────────────────────────────────────────────
    txns = await _txns_for_period(uid, start, min(end, today), cc_ids) if cc_ids else []
    # `delta` drives the frontend's "Held steady / balances grew / balances
    # shrank" verdict and its colour, so it must reflect the card's ACTUAL
    # balance movement: every debit minus every payment, regardless of
    # category. Narrowing it to spend-only debits would make a card that
    # grew by, say, £1,298 (because £877 of that was a balance transfer)
    # report as barely moving, which is wrong, and would disagree with the
    # per-card `delta` figures below (those already sum every debit per
    # card, uncategorised). So this value and its meaning are UNCHANGED;
    # only the local variable is renamed to `full_debits` since it no
    # longer doubles as the (now narrower) `new_spend` figure (G20).
    full_debits, payments = _abs_amounts(txns)
    delta = full_debits - payments

    # ── Per-card breakdown ────────────────────────────────────────────────────
    # Fetch account docs for credit cards
    cc_account_docs = []
    if cc_ids:
        raw_accounts = await accounts_col.find({"user_id": uid}).to_list(None)
        for a in raw_accounts:
            aid = str(a.get("account_id") or a.get("_id"))
            if aid in cc_ids:
                cc_account_docs.append(a)

    # Build per-card txn buckets
    card_txns: dict[str, list] = {}
    for t in txns:
        aid = str(t.get("account_id", ""))
        card_txns.setdefault(aid, []).append(t)

    # APR map
    rates = await account_rates_col.find({"user_id": uid}).to_list(None)
    apr_map = {r["account_id"]: r.get("apr") for r in rates}

    per_card = []
    for a in cc_account_docs:
        aid = str(a.get("account_id") or a.get("_id"))
        balance = float(
            a.get("balance") or a.get("current_balance") or a.get("available_balance") or 0
        )
        card_debits, card_credits = _abs_amounts(card_txns.get(aid, []))
        card_delta = card_debits - card_credits
        if abs(card_delta) < 1 and balance == 0:
            continue
        per_card.append({
            "account_id": aid,
            "name": a.get("name"),
            "provider": a.get("provider"),
            "balance": round(balance, 2),
            "delta": round(card_delta, 2),
            "apr": apr_map.get(aid),
            # Outlook fields (G10) — default to absent/null; filled in below
            # from the debt-plan engine when it's available for this card.
            "payoff_month": None,
            "promo_end": None,
            "apr_pct": None,
            "paying_interest": None,
            "monthly_interest_now": None,
            "cleared_monthly": None,
        })

    per_card.sort(key=lambda c: abs(c["delta"]), reverse=True)

    # ── Outlook (debt-plan derived) ────────────────────────────────────────────
    # Best-effort only: a bad debt-plan read must never break this page, it
    # must just come back without the outlook fields (see module docstring).
    extra_to_clear = None
    if per_card:
        try:
            plan = await get_debt_plan_cached(uid)
            plan_cards_by_id = {c["account_id"]: c for c in plan.get("cards", [])}
            for c in per_card:
                pc = plan_cards_by_id.get(c["account_id"])
                if pc is None:
                    continue
                apr_pct, promo_end = _current_apr_and_promo_end(pc, today)
                c["payoff_month"] = pc.get("payoff_month")
                c["promo_end"] = promo_end
                c["apr_pct"] = apr_pct
                c["paying_interest"] = pc.get("paying_interest")
                c["monthly_interest_now"] = pc.get("monthly_interest_now")
                c["cleared_monthly"] = pc.get("classification") == "cleared_monthly"

            extra = plan.get("extra_to_clear")
            if extra:
                extra_to_clear = {
                    "extra_per_month": extra.get("amount"),
                    "debt_free_month": extra.get("debt_free_month"),
                }
        except Exception:
            log.warning(
                "cards_story: debt plan unavailable for %s, outlook fields omitted", uid,
                exc_info=True,
            )

    # ── Spending drivers ──────────────────────────────────────────────────────
    # Categories are split by declared kind (app.services.categories), not a
    # hardcoded set (G20, 2026-09-10, replaces the old _EXCLUDE_CATEGORIES,
    # which silently dropped a £876.76 Transfer debit and then truncated to
    # the top five with no accounting for the rest). Movement-kind debits
    # (Transfer, Debt, Savings, Investment, and any user-defined movement
    # category) are money moved between cards, not spend: they are reported
    # in `moved_between_cards`, never as a driver. `new_spend` is the sum of
    # every SPEND-kind debit, and the drivers list (top five + "Other
    # categories") is built to sum to it exactly, so the page always
    # reconciles.
    kind_map = await get_category_kinds(uid)
    category_totals: dict[str, float] = {}
    new_spend = 0.0
    moved_between_cards = 0.0
    for t in txns:
        if t.get("transaction_type") != "debit":
            continue
        amt = float(t.get("amount", 0) or 0)
        cat = t.get("custom_category") or t.get("category") or "Other"
        if is_non_spend(kind_map, cat):
            moved_between_cards += amt
            continue
        new_spend += amt
        category_totals[cat] = category_totals.get(cat, 0.0) + amt

    ranked_cats = sorted(category_totals.items(), key=lambda kv: kv[1], reverse=True)
    drivers = [{"category": cat, "total": round(total, 2)} for cat, total in ranked_cats[:5]]
    other_total = round(sum(total for _, total in ranked_cats[5:]), 2)
    if other_total > 0:
        drivers.append({"category": "Other categories", "total": other_total})

    # ── Pattern line (credit_switch trait) ────────────────────────────────────
    pattern_line = None
    try:
        portrait = await behaviour_portrait_col.find_one({"_id": uid})
        if portrait:
            for trait in portrait.get("traits", []):
                if trait.get("id") == "credit_switch":
                    pattern_line = trait.get("narrative")
                    break
    except Exception:
        pass

    # ── Trajectory ────────────────────────────────────────────────────────────
    raw_history = (
        await needle_history_col.find({"uid": uid})
        .sort("period_end", -1)
        .limit(6)
        .to_list(6)
    )
    raw_history.reverse()  # oldest-first
    trajectory = [
        {"period_end": h.get("period_end"), "delta": round(float(h.get("card_delta", 0)), 2)}
        for h in raw_history
    ]

    return {
        "status": "ok",
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
            "days_elapsed": days_elapsed,
        },
        "movement": {
            "delta": round(delta, 2),
            "new_spend": round(new_spend, 2),
            "payments": round(payments, 2),
            "moved_between_cards": round(moved_between_cards, 2),
        },
        "per_card": per_card,
        "drivers": drivers,
        "pattern_line": pattern_line,
        "trajectory": trajectory,
        "extra_to_clear": extra_to_clear,
    }
