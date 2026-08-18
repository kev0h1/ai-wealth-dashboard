"""Penny narration layer for the debt-plan view.

Doctrine (same as cycle_story.py):
- compute_debt_plan / get_debt_plan_cached provides every figure.
- Narration text is composed deterministically from those figures — no LLM
  is involved; it never invents a figure.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from app.db.collections import preferences_col
from app.services.debt_plan import (
    MATERIAL_BALANCE,
    MOVEMENT_FLAT_EPS,
    get_debt_plan_cached,
)
from app.services.pay_period import period_rhythm_label

log = logging.getLogger(__name__)

# Module-level narration memo: {uid: (facts_hash, narration_dict)}
_narration_memo: dict[str, tuple[str, dict]] = {}


def _r2(x: float) -> float:
    return round(x, 2)


def _month_label_to_human(label: str) -> str:
    """Convert 'YYYY-MM' to 'Mon YYYY', e.g. '2031-08' → 'Aug 2031'."""
    try:
        d = datetime.strptime(label, "%Y-%m")
        return d.strftime("%b %Y")
    except Exception:
        return label


def _find_contradiction_card(cards: list[dict]) -> Optional[dict]:
    """Among cards with terms_contradiction True, pick the one with the largest debt.

    Returns {"name", "provider", "apr_pct", "debt"} where apr_pct is the card's
    standard rate: the first rate_schedule segment with source == "standard".
    Returns None when no contradiction cards.
    """
    candidates = [c for c in cards if c.get("terms_contradiction") and (c.get("debt") or 0) >= MATERIAL_BALANCE]
    if not candidates:
        return None
    card = max(candidates, key=lambda c: c.get("debt", 0.0))
    # Find standard rate
    std_apr: Optional[float] = None
    for seg in (card.get("rate_schedule") or []):
        if seg.get("source") == "standard" and seg.get("apr_pct") is not None:
            std_apr = seg["apr_pct"]
            break
    return {
        "name": card.get("name", ""),
        "provider": card.get("provider", ""),
        "apr_pct": std_apr,
        "debt": card.get("debt", 0.0),
    }


def _build_facts(plan: dict) -> Optional[dict]:
    try:
        totals = plan.get("totals") or {}
        history = plan.get("history") or {}
        cards = plan.get("cards") or []
        extra_to_clear = plan.get("extra_to_clear")
        whats_working = plan.get("whats_working") or []
        refinance_options = plan.get("refinance_options") or []
        buckets = totals.get("buckets") or {}

        # growth_card
        growth_card = None
        worst_monthly: Optional[float] = None
        for c in cards:
            if c.get("debt", 0) < MATERIAL_BALANCE:
                continue
            mov = (c.get("movement") or {}).get("monthly")
            if mov is None or mov >= -MOVEMENT_FLAT_EPS:
                continue
            if worst_monthly is None or mov < worst_monthly:
                worst_monthly = mov
                per_period = (c.get("movement") or {}).get("per_period") or []
                latest_period = per_period[0] if per_period else {}
                growth_card = {
                    "name": c.get("name", ""),
                    "provider": c.get("provider", ""),
                    "spend_last_period": _r2(latest_period.get("debits", 0.0)),
                    "payments_last_period": _r2(latest_period.get("credits", 0.0)),
                    "has_rate_on_file": any(
                        seg.get("apr_pct") is not None
                        for seg in (c.get("rate_schedule") or [])
                    ),
                }

        # ask_card: largest-debt unclear card with material balance
        ask_card = None
        unclear_candidates = [
            c for c in cards
            if c.get("debt", 0) >= MATERIAL_BALANCE and c.get("classification") == "unclear"
        ]
        if unclear_candidates:
            ac = max(unclear_candidates, key=lambda c: c.get("debt", 0.0))
            # Find first standard-segment apr_pct
            std_apr = None
            for seg in (ac.get("rate_schedule") or []):
                if seg.get("source") == "standard" and seg.get("apr_pct") is not None:
                    std_apr = seg["apr_pct"]
                    break
            ask_card = {
                "account_id": ac.get("account_id", ""),
                "name": ac.get("name", ""),
                "provider": ac.get("provider", ""),
                "apr_pct": std_apr,
                "debt": ac.get("debt", 0.0),
                "kind": "usage",
            }

        # usage_conflict_card
        usage_conflict_card = None
        conflict_candidates = [c for c in cards if c.get("usage_conflict")]
        if conflict_candidates:
            uc = max(conflict_candidates, key=lambda c: c.get("debt", 0.0))
            usage_conflict_card = {
                "name": uc.get("name", ""),
                "provider": uc.get("provider", ""),
            }

        # cliff: earliest first_interest_month among carried material cards with balance_at_first_interest
        cliff = None
        for c in cards:
            if (c.get("debt") or 0) < MATERIAL_BALANCE:
                continue
            if c.get("classification") == "cleared_monthly":
                continue
            fim = c.get("first_interest_month")
            bafi = c.get("balance_at_first_interest")
            mif = c.get("monthly_interest_at_first")
            if not fim or bafi is None or mif is None:
                continue
            if cliff is None or fim < cliff["month"]:
                cliff = {
                    "name": c.get("name", ""),
                    "provider": c.get("provider", ""),
                    "month": fim,
                    "monthly_interest_at_first": mif,
                    "balance_at_first_interest": bafi,
                }

        # classifications list
        classifications = [
            {
                "name": c.get("name"),
                "provider": c.get("provider"),
                "classification": c.get("classification"),
                "debt": c.get("debt"),
            }
            for c in cards if (c.get("debt") or 0) > 0
        ]

        # whats_working: first entry only
        whats_working_first = None
        if whats_working:
            w = whats_working[0]
            whats_working_first = {
                "name": w.get("name", ""),
                "payoff_month": w.get("payoff_month", ""),
                "monthly": w.get("monthly"),
            }

        # missing_rates_count
        missing_rates_count = sum(
            1 for c in cards
            if (c.get("flags") or {}).get("terms_missing") and c.get("debt", 0) > 0
        )

        # refinance_best
        refinance_best = None
        if refinance_options:
            best = max(refinance_options, key=lambda x: x.get("net_saving", 0))
            refinance_best = {
                "source_name": best.get("source_name", ""),
                "destination_name": best.get("destination_name", ""),
                "net_saving": best.get("net_saving", 0),
                "fee": best.get("fee", 0),
                "window_months": best.get("window_months", 0),
            }

        # extra_to_clear facts
        etc_facts = None
        if extra_to_clear and (extra_to_clear.get("amount") or 0) > 0:
            etc_facts = {
                "amount": extra_to_clear.get("amount"),
                "debt_free_month": extra_to_clear.get("debt_free_month"),
            }

        nonclearing = totals.get("nonclearing") or {}

        facts: dict = {
            "total_debt": totals.get("debt"),
            "verdict": totals.get("verdict"),
            "monthly_interest_now": totals.get("monthly_interest_now"),
            "interest_to_clear": totals.get("interest_to_clear"),
            "nonclearing": {
                "count": nonclearing.get("count"),
                "total_balance": nonclearing.get("total_balance"),
                "monthly_interest_share": nonclearing.get("monthly_interest_share"),
            },
            "history_trend_3m": history.get("trend_3m"),
            "history_trend_3m_all": history.get("trend_3m_all"),
            "history_rising": history.get("rising"),
            "growth_card": growth_card,
            "extra_to_clear": etc_facts,
            "whats_working": whats_working_first,
            "missing_rates_count": missing_rates_count,
            "refinance_best": refinance_best,
            "potential_monthly_interest": totals.get("potential_monthly_interest"),
            "buckets": buckets,
            "classifications": classifications,
            "cliff": cliff,
            "ask_card": ask_card,
            "usage_conflict_card": usage_conflict_card,
        }
        return facts

    except Exception as e:
        log.warning("debt_narration: _build_facts failed: %s", e)
        return None


async def _get_monthly_surplus(uid: str) -> Optional[float]:
    """Fetch monthly surplus (income − spending) from cashflow, Debt-tab semantic."""
    try:
        from app.services.cashflow import monthly_cashflow_cached
        from app.services.region import get_user_region
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        cf = await monthly_cashflow_cached(uid, region, cutoff)
        # Debt-tab surplus: income − spending (does NOT subtract debt)
        surplus = _r2(cf.get("income", 0.0) - cf.get("spending", 0.0))
        return surplus
    except Exception as e:
        log.warning("debt_narration: cashflow fetch failed: %s", e)
        return None


def _compose_narration(facts: dict, monthly_surplus: Optional[float]) -> str:
    """Build Penny's debt-plan narration text deterministically from facts.

    Shape: a reassurance/interest-status opener, the localised cause of any
    drift, and the user's own lever — never the totals, three-month rise or
    "extra a month" figures the page already shows in the hero, verdict line
    and "WHAT IT WOULD TAKE" block. Situational facts not shown anywhere else
    on the page (a 0%-cliff date, an unclear card, a usage contradiction) are
    appended when present and are never dropped. Capped at 5 sentences —
    cliff is dropped first if all situational facts land at once.
    """
    buckets = facts.get("buckets") or {}
    carried_total = buckets.get("carried_total") or 0.0
    carried_zero = buckets.get("carried_zero") or 0.0
    mi_now = facts.get("monthly_interest_now") or 0.0
    cliff = facts.get("cliff")
    ask_card = facts.get("ask_card")
    usage_conflict_card = facts.get("usage_conflict_card")
    gc = facts.get("growth_card")

    sentences: list[str] = []

    # 1. Interest status — the reassurance when there is one, plain fact otherwise.
    if mi_now >= 1:
        sentences.append(f"The cards are costing about £{mi_now:,.0f} a month in interest right now.")
    elif carried_total >= 1 and carried_zero >= 0.9 * carried_total:
        sentences.append("Nothing's accruing interest right now, your balances sit on 0% deals.")
    else:
        sentences.append("No interest is hitting your cards right now.")

    # 2 & 3. Localised cause + the user's own lever (only when a card is driving the growth).
    if gc:
        provider = gc.get("provider") or gc.get("name") or "card"
        card_ref = f"your {provider} card" if gc.get("provider") else gc.get("name", "your card")
        spend = gc.get("spend_last_period", 0)
        pays = gc.get("payments_last_period", 0)
        sentences.append(
            f"Most of the growth is {card_ref}, £{spend:,.0f} of spending against £{pays:,.0f} of payments last period."
        )
        if gc.get("has_rate_on_file", True):
            sentences.append("Matching what goes onto it to what comes off is what stops it climbing.")
        else:
            sentences.append("If that's deliberate, tell me its rate and I'll price it. If not, that's the lever.")

    # 4. Cliff — factual promo-expiry date and its consequence, never a moving-balance suggestion.
    if cliff:
        cliff_human = _month_label_to_human(cliff.get("month", ""))
        bafi = cliff.get("balance_at_first_interest", 0)
        mif = cliff.get("monthly_interest_at_first", 0)
        cliff_name = cliff.get("name", "the card")
        sentences.append(
            f"£{bafi:,.0f} will still be on {cliff_name} when its 0% ends in {cliff_human}"
            f", from then it'd cost about £{mif:,.0f} a month unless it's cleared first."
        )

    # 5. ask_card (NEVER dropped)
    if ask_card:
        apr_pct = ask_card.get("apr_pct")
        prov = ask_card.get("provider") or ask_card.get("name") or "card"
        if apr_pct is not None:
            sentences.append(
                f"Your {prov} card shows no interest charges even though its rate on file is {apr_pct}%"
                f", that could mean you clear it in full each month, or it's on a 0% deal I don't have."
                f" Tell me how you use it and the picture sharpens."
            )
        else:
            sentences.append(
                f"Your {prov} card's balance doesn't show me enough yet, tell me how you use it and the picture sharpens."
            )

    # 6. usage_conflict_card (NEVER dropped)
    if usage_conflict_card:
        uc_name = usage_conflict_card.get("name") or usage_conflict_card.get("provider") or "a card"
        sentences.append(
            f"You've told me you clear {uc_name} monthly, but interest charges are appearing on it, worth a look."
        )

    # Cap at 5 sentences: drop the cliff sentence first (it's the one situational
    # fact that's purely informational rather than tied to an action button).
    if len(sentences) > 5 and cliff:
        cliff_human = _month_label_to_human(cliff.get("month", ""))
        bafi = cliff.get("balance_at_first_interest", 0)
        mif = cliff.get("monthly_interest_at_first", 0)
        cliff_name = cliff.get("name", "the card")
        cliff_sentence = (
            f"£{bafi:,.0f} will still be on {cliff_name} when its 0% ends in {cliff_human}"
            f", from then it'd cost about £{mif:,.0f} a month unless it's cleared first."
        )
        sentences = [s for s in sentences if s != cliff_sentence]

    return " ".join(sentences)


async def get_debt_plan_view(uid: str) -> dict:
    """Return the debt plan enriched with Penny narration.

    The underlying plan comes from get_debt_plan_cached (90 s cache).
    Narration is additionally memoised by facts_hash — composition is cheap,
    but the memo still avoids redundant work when the underlying figures
    haven't changed.
    """
    plan = await get_debt_plan_cached(uid)

    # Transparency ingredient — total £/period this user's active commitment
    # plans reserve, so the clear-by claim below can honestly admit those
    # plans can change it. Failure-tolerant; omitted (not even a null key)
    # when the user has no active reserve. Deferred import — commitments.py
    # is a router this service must never depend on at module load time.
    commitments_extra: dict = {}
    try:
        from app.routers.commitments import total_reserved_slices
        reserved, count = await total_reserved_slices(uid)
        if reserved:
            prefs = await preferences_col.find_one({"user_id": uid}) or {}
            cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
            commitments_extra["commitments_reserved"] = {
                "total_slice": reserved,
                "count": count,
                "period_label": period_rhythm_label(cfg),
            }
    except Exception:
        pass

    totals = plan.get("totals") or {}
    if (totals.get("debt") or 0) < MATERIAL_BALANCE:
        return {**plan, "narration": None, **commitments_extra}

    # Build facts
    facts = _build_facts(plan)
    if facts is None:
        return {**plan, "narration": None, **commitments_extra}

    # Monthly surplus (Debt-tab semantic: does not subtract debt)
    monthly_surplus = await _get_monthly_surplus(uid)
    facts["monthly_surplus"] = monthly_surplus

    # Check narration memo
    facts_json = json.dumps(facts, sort_keys=True, default=str)
    facts_hash = hashlib.sha256(facts_json.encode()).hexdigest()

    memo = _narration_memo.get(uid)
    if memo and memo[0] == facts_hash:
        log.debug("debt_narration: memo hit for user")
        return {**plan, "narration": memo[1], **commitments_extra}

    text = _compose_narration(facts, monthly_surplus)
    narration_dict: dict = {"text": text, "source": "fallback"}

    ask_payload = None
    ask_card_facts = facts.get("ask_card")
    if ask_card_facts:
        ask_payload = {
            "account_id": ask_card_facts["account_id"],
            "name": ask_card_facts["name"],
            "provider": ask_card_facts["provider"],
            "kind": ask_card_facts["kind"],
        }

    # Attach ask to narration_dict
    narration_dict["ask"] = ask_payload

    # Store in memo
    _narration_memo[uid] = (facts_hash, narration_dict)

    return {**plan, "narration": narration_dict, **commitments_extra}
