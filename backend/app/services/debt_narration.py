"""Penny narration layer for the debt-plan view.

Doctrine (same as cycle_story.py):
- compute_debt_plan / get_debt_plan_cached provides every figure.
- The LLM only narrates; it may never invent a figure.
- Hard validation: every £ in the LLM text must map to a fact value.
- Deterministic fallback always available; the page never breaks.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

import httpx

from app.core.config import OPENROUTER_API_KEY, APP_URL
from app.services.debt_plan import (
    MATERIAL_BALANCE,
    MOVEMENT_FLAT_EPS,
    get_debt_plan_cached,
)

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


def _collect_numeric_leaves(obj, values: set[float]) -> None:
    """Recursively collect all numeric leaf values from a nested dict/list."""
    if isinstance(obj, dict):
        for v in obj.values():
            _collect_numeric_leaves(v, values)
    elif isinstance(obj, list):
        for v in obj:
            _collect_numeric_leaves(v, values)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        f = float(obj)
        values.add(abs(f))
        values.add(abs(round(f)))


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


def _fallback_text(facts: dict, monthly_surplus: Optional[float]) -> str:
    """Build deterministic fallback narration from facts. Max 5 sentences."""
    buckets = facts.get("buckets") or {}
    carried_total = buckets.get("carried_total") or 0.0
    float_total = buckets.get("float_total") or 0.0
    carried_interest = buckets.get("carried_interest") or 0.0
    carried_zero = buckets.get("carried_zero") or 0.0
    mi_now = facts.get("monthly_interest_now") or 0.0
    potential = facts.get("potential_monthly_interest") or 0.0
    nc = facts.get("nonclearing") or {}
    nc_count = nc.get("count") or 0
    nc_share = nc.get("monthly_interest_share") or 0.0
    cliff = facts.get("cliff")
    ask_card = facts.get("ask_card")
    usage_conflict_card = facts.get("usage_conflict_card")

    # Build list of (sentence, droppable) tuples
    items: list[tuple[str, bool]] = []

    # 1. Opening split
    if carried_total >= 1 and float_total >= 1:
        if carried_interest >= 1:
            opening = (
                f"You're carrying £{carried_total:,.0f} on your cards"
                f" — £{carried_interest:,.0f} of it costing interest"
                f" — plus £{float_total:,.0f} of monthly spending you clear as you go."
            )
        elif carried_zero >= 0.9 * carried_total:
            opening = (
                f"You're carrying £{carried_total:,.0f} on 0% deals,"
                f" plus £{float_total:,.0f} of monthly spending you clear as you go."
            )
        else:
            opening = (
                f"You're carrying £{carried_total:,.0f} on your cards,"
                f" plus £{float_total:,.0f} of monthly spending you clear as you go."
            )
    else:
        opening = f"You're carrying £{carried_total:,.0f} across your cards."
    items.append((opening, False))

    # 2. Bleed / no-interest
    if mi_now >= 1:
        bleed = f"The cards are costing about £{mi_now:,.0f} a month in interest right now."
        if nc_count > 0 and nc_share >= 1.0:
            plural = "cards that aren't" if nc_count > 1 else "card that isn't"
            bleed += f" £{nc_share:,.0f} of that is on {nc_count} {plural} clearing at your pace."
        items.append((bleed, False))
    else:
        items.append(("No interest is hitting your cards right now.", False))
        if potential >= 1:
            items.append((
                f"If these balances ran past their 0% windows at the rates on file, they'd cost about £{potential:,.0f} a month.",
                True,
            ))

    # 3. Cliff
    if cliff:
        try:
            from datetime import datetime as _dt
            cliff_human = _dt.strptime(cliff["month"], "%Y-%m").strftime("%b %Y")
        except Exception:
            cliff_human = cliff["month"]
        bafi = cliff.get("balance_at_first_interest", 0)
        mif = cliff.get("monthly_interest_at_first", 0)
        cliff_name = cliff.get("name", "the card")
        cliff_sentence = (
            f"£{bafi:,.0f} will still be on {cliff_name} when its 0% ends in {cliff_human}"
            f" — from then it'd cost about £{mif:,.0f} a month unless it's cleared or moved."
        )
        items.append((cliff_sentence, False))

    # 4. Trend (carried-only)
    trend = facts.get("history_trend_3m") or 0.0
    if trend > 1:
        items.append((f"Your carried debt has risen £{trend:,.0f} over the last three months.", False))
    elif trend < -1:
        items.append((f"Your carried debt has come down £{abs(trend):,.0f} over the last three months.", False))

    # 5. Surplus (droppable)
    if monthly_surplus is not None and abs(monthly_surplus) > 1.0:
        if monthly_surplus < 0:
            surplus_sentence = f"A typical month currently runs about £{abs(monthly_surplus):,.0f} short after spending."
        else:
            surplus_sentence = f"A typical month leaves about £{monthly_surplus:,.0f} after spending that could point at the cards."
        items.append((surplus_sentence, True))

    # 6. growth_card (droppable)
    gc = facts.get("growth_card")
    if gc:
        provider = gc.get("provider") or gc.get("name") or "card"
        card_ref = f"your {provider} card" if gc.get("provider") else gc.get("name", "your card")
        spend = gc.get("spend_last_period", 0)
        pays = gc.get("payments_last_period", 0)
        has_rate = gc.get("has_rate_on_file", True)
        if has_rate:
            gc_sentence = (
                f"Most of the growth is {card_ref} — £{spend:,.0f} of spending against £{pays:,.0f} of payments last period."
            )
        else:
            gc_sentence = (
                f"Most of the growth is {card_ref} — £{spend:,.0f} of spending against £{pays:,.0f} of payments last period."
                f" If that's deliberate, tell me its rate and I'll price it; if not, that's the biggest lever here."
            )
        items.append((gc_sentence, True))

    # 7. extra_to_clear (droppable)
    etc = facts.get("extra_to_clear")
    if etc and (etc.get("amount") or 0) > 0:
        dfm = _month_label_to_human(etc.get("debt_free_month") or "")
        items.append((f"£{etc.get('amount', 0):,.0f} more a month clears every card by {dfm}.", True))

    # 8. whats_working (droppable)
    ww = facts.get("whats_working")
    if ww:
        ww_dfm = _month_label_to_human(ww.get("payoff_month") or "")
        items.append((f"{ww.get('name', 'One card')} is already on its way out, clearing {ww_dfm}.", True))

    # 9. ask_card (NEVER dropped)
    if ask_card:
        apr_pct = ask_card.get("apr_pct")
        prov = ask_card.get("provider") or ask_card.get("name") or "card"
        if apr_pct is not None:
            ask_sentence = (
                f"Your {prov} card shows no interest charges even though its rate on file is {apr_pct}%"
                f" — that could mean you clear it in full each month, or it's on a 0% deal I don't have."
                f" Tell me how you use it and the picture sharpens."
            )
        else:
            ask_sentence = (
                f"Your {prov} card's balance doesn't show me enough yet — tell me how you use it and the picture sharpens."
            )
        items.append((ask_sentence, False))

    # 10. usage_conflict_card (NEVER dropped)
    if usage_conflict_card:
        uc_name = usage_conflict_card.get("name") or usage_conflict_card.get("provider") or "a card"
        items.append((
            f"You've told me you clear {uc_name} monthly, but interest charges are appearing on it — worth a look.",
            False,
        ))

    # 11. missing rates (droppable)
    n_missing = facts.get("missing_rates_count") or 0
    if n_missing > 0:
        s = "s" if n_missing > 1 else ""
        items.append((
            f"{n_missing} card{s} have no rate on file — add them and I can price every lever exactly.",
            True,
        ))

    # Named items: (name, sentence, droppable)
    # Rebuild items with names for deterministic priority ordering
    named_items: list[tuple[str, str, bool]] = []
    _name_cursor = 0

    # Assign names based on known positions in items list
    # We'll re-tag by matching known droppable identifiers, and use positional names for mandatory ones
    _name_map = {
        "opening": False,
        "bleed": False,
        "potential": True,
        "cliff": False,
        "trend": False,
        "surplus": True,
        "growth": True,
        "extra_to_clear": True,
        "whats_working": True,
        "ask": False,
        "usage_conflict": False,
        "missing_rates": True,
    }

    # Walk items and assign names in the order they were appended
    _item_names: list[str] = []
    _item_idx = 0
    # opening is always first
    _item_names.append("opening")
    _item_idx = 1
    # bleed or no-interest (always appended after opening)
    _item_names.append("bleed")
    _item_idx += 1
    # potential is appended directly after no-interest when mi_now < 1 and potential >= 1
    if mi_now < 1 and potential >= 1:
        _item_names.append("potential")
        _item_idx += 1
    # cliff
    if cliff:
        _item_names.append("cliff")
        _item_idx += 1
    # trend
    trend_val = facts.get("history_trend_3m") or 0.0
    if trend_val > 1 or trend_val < -1:
        _item_names.append("trend")
        _item_idx += 1
    # surplus
    if monthly_surplus is not None and abs(monthly_surplus) > 1.0:
        _item_names.append("surplus")
        _item_idx += 1
    # growth_card
    if facts.get("growth_card"):
        _item_names.append("growth")
        _item_idx += 1
    # extra_to_clear
    etc = facts.get("extra_to_clear")
    if etc and (etc.get("amount") or 0) > 0:
        _item_names.append("extra_to_clear")
        _item_idx += 1
    # whats_working
    if facts.get("whats_working"):
        _item_names.append("whats_working")
        _item_idx += 1
    # ask_card
    if ask_card:
        _item_names.append("ask")
        _item_idx += 1
    # usage_conflict
    if usage_conflict_card:
        _item_names.append("usage_conflict")
        _item_idx += 1
    # missing_rates
    if (facts.get("missing_rates_count") or 0) > 0:
        _item_names.append("missing_rates")
        _item_idx += 1

    # Pair names with sentences
    sentences_list = [s for s, _ in items]
    named_items = [
        (_item_names[i], sentences_list[i], _name_map.get(_item_names[i], False))
        for i in range(min(len(_item_names), len(sentences_list)))
    ]

    # Drop order: remove droppables in this order until count <= 5
    DROP_ORDER = ["surplus", "whats_working", "growth", "potential", "extra_to_clear", "missing_rates"]

    # If still over 5 after all droppables gone, sacrifice mandatory sentences in this order
    # (opening, ask, usage_conflict are NEVER sacrificed)
    MANDATORY_SACRIFICE_ORDER = ["cliff", "trend", "bleed"]

    for drop_name in DROP_ORDER:
        if len(named_items) <= 5:
            break
        named_items = [(n, s, d) for n, s, d in named_items if n != drop_name]

    for drop_name in MANDATORY_SACRIFICE_ORDER:
        if len(named_items) <= 5:
            break
        named_items = [(n, s, d) for n, s, d in named_items if n != drop_name]

    return " ".join(s for _, s, _ in named_items)


_GBP_RE = re.compile(r"£\s?([\d,]+(?:\.\d{1,2})?)")


def _validate_llm_text(text: str, facts: dict, monthly_surplus: Optional[float]) -> bool:
    """Return True if the LLM text passes all validation checks."""
    # Basic structural checks
    if not text or len(text) > 900:
        log.warning("debt_narration: LLM text too long or empty (%d chars)", len(text))
        return False
    if "\n" in text or any(c in text for c in ["•", "*", "#", "-\n"]):
        log.warning("debt_narration: LLM text contains newlines/bullets/headings")
        return False

    # Collect allowed numbers from facts
    allowed: set[float] = set()
    _collect_numeric_leaves(facts, allowed)
    if monthly_surplus is not None:
        _collect_numeric_leaves({"surplus": monthly_surplus}, allowed)

    # Extract every £ figure from text
    for raw_match in _GBP_RE.findall(text):
        val_str = raw_match.replace(",", "")
        try:
            val = float(val_str)
        except ValueError:
            log.warning("debt_narration: could not parse £ figure '%s'", raw_match)
            return False
        # Check within 0.5 of any allowed value
        if not any(abs(val - a) <= 0.5 for a in allowed):
            log.warning(
                "debt_narration: £%s not in allowed set (allowed=%s)",
                val_str,
                sorted(allowed)[:20],
            )
            return False

    return True


async def get_debt_plan_view(uid: str) -> dict:
    """Return the debt plan enriched with Penny narration.

    The underlying plan comes from get_debt_plan_cached (90 s cache).
    Narration is additionally memoised by facts_hash — the LLM fires only
    when the underlying figures change.
    """
    plan = await get_debt_plan_cached(uid)

    totals = plan.get("totals") or {}
    if (totals.get("debt") or 0) < MATERIAL_BALANCE:
        return {**plan, "narration": None}

    # Build facts
    facts = _build_facts(plan)
    if facts is None:
        return {**plan, "narration": None}

    # Monthly surplus (Debt-tab semantic: does not subtract debt)
    monthly_surplus = await _get_monthly_surplus(uid)
    facts["monthly_surplus"] = monthly_surplus

    # Check narration memo
    facts_json = json.dumps(facts, sort_keys=True, default=str)
    facts_hash = hashlib.sha256(facts_json.encode()).hexdigest()

    memo = _narration_memo.get(uid)
    if memo and memo[0] == facts_hash:
        log.debug("debt_narration: memo hit for user")
        return {**plan, "narration": memo[1]}

    # LLM call
    narration_dict: Optional[dict] = None

    if OPENROUTER_API_KEY:
        try:
            log.info("debt_narration: LLM call for user")

            system_prompt = (
                "You are Penny, the AI adviser in a personal money app. "
                "British English, warm, plain, calm, second person, zero blame or moralising.\n\n"
                "Every £ figure written MUST be copied from the facts JSON, rounded to the nearest "
                "whole pound (e.g. 2168.99 → £2,169). NEVER compute, derive, combine or invent a "
                "figure. Never state a rate, date or amount not present in the facts.\n\n"
                "Write ONE plain paragraph, 3–5 short sentences, no headings, no bullet points, "
                "no newlines within or between sentences.\n\n"
                "Sentence order:\n"
                "(1) Opening split — ALWAYS lead:\n"
                "  • If buckets.carried_total >= 1 AND buckets.float_total >= 1:\n"
                "    - If carried_interest >= 1: 'You're carrying £{carried_total} on your cards — £{carried_interest} of it costing interest — plus £{float_total} of monthly spending you clear as you go.'\n"
                "    - elif carried_zero >= 90% of carried_total: 'You're carrying £{carried_total} on 0% deals, plus £{float_total} of monthly spending you clear as you go.'\n"
                "    - else: 'You're carrying £{carried_total} on your cards, plus £{float_total} of monthly spending you clear as you go.'\n"
                "  • If float_total < 1: 'You're carrying £{carried_total} across your cards.'\n"
                "(2) Bleed / no-interest:\n"
                "  • If monthly_interest_now >= 1: 'The cards are costing about £{monthly_interest_now} a month in interest right now.' If nonclearing.count > 0, add that £{nonclearing.monthly_interest_share} is on N cards not clearing.\n"
                "  • Else: 'No interest is hitting your cards right now.' If potential_monthly_interest >= 1: 'If these balances ran past their 0% windows at the rates on file, they'd cost about £{potential} a month.'\n"
                "(3) Cliff (when facts.cliff is present) — CONDITIONAL framing, NEVER 'starts':\n"
                "  '£{balance_at_first_interest} will still be on {name} when its 0% ends in {Mon YYYY} — from then it'd cost about £{monthly_interest_at_first} a month unless it's cleared or moved.'\n"
                "(4) Trend (uses history_trend_3m — carried-only):\n"
                "  • trend > 1: 'Your carried debt has risen £{trend} over the last three months.'\n"
                "  • trend < -1: 'Your carried debt has come down £{abs(trend)} over the last three months.'\n"
                "(5) Surplus (droppable): a typical month sentence when monthly_surplus present.\n"
                "(6) growth_card (droppable): 'Most of the growth is your {provider} card — £{spend} of spending against £{payments} of payments last period.' Append 'If that's deliberate, tell me its rate and I'll price it; if not, that's the biggest lever here.' ONLY when has_rate_on_file is False.\n"
                "(7) extra_to_clear (droppable): '£{amount} more a month clears every card by {Mon YYYY}.'\n"
                "(8) whats_working (droppable): '{name} is already on its way out, clearing {Mon YYYY}.'\n"
                "(9) ask_card (NEVER dropped — when present):\n"
                "  • If apr_pct not None: 'Your {provider} card shows no interest charges even though its rate on file is {apr_pct}% — that could mean you clear it in full each month, or it's on a 0% deal I don't have. Tell me how you use it and the picture sharpens.'\n"
                "  • If apr_pct None: 'Your {provider} card's balance doesn't show me enough yet — tell me how you use it and the picture sharpens.'\n"
                "  CRITICAL: Only ask about the ONE card in ask_card. NEVER ask about any card whose classification is cleared_monthly or carried_zero.\n"
                "(10) usage_conflict_card (NEVER dropped — when present): 'You've told me you clear {name} monthly, but interest charges are appearing on it — worth a look.'\n"
                "(11) missing_rates_count (droppable): close with adding rates sentence.\n\n"
                "Fit-within-5 drop order: surplus first, then whats_working, then growth_card, then the potential conditional, then extra_to_clear, then the missing-rates close. The opening split, the ask_card question and the usage_conflict sentence are NEVER dropped.\n\n"
                "Month labels 'YYYY-MM' must be written as 'Mon YYYY' (e.g. 2027-06 → Jun 2027).\n\n"
                "CRITICAL: The output must be a single paragraph with no newlines, no bullet points, "
                "no headings, no markdown. 3–5 sentences only."
            )

            user_prompt = f"Facts JSON:\n{json.dumps(facts, indent=2, default=str)}"

            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "HTTP-Referer": APP_URL,
                    },
                    json={
                        "model": "anthropic/claude-sonnet-4-6",
                        "max_tokens": 400,
                        "temperature": 0.2,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                    },
                )
            data = r.json()
            raw_text = data["choices"][0]["message"]["content"].strip()
            # Remove any newlines within the text (collapse to spaces)
            raw_text = " ".join(raw_text.split("\n")).strip()

            if _validate_llm_text(raw_text, facts, monthly_surplus):
                narration_dict = {"text": raw_text, "source": "llm"}
            else:
                log.warning("debt_narration: LLM text failed validation, using fallback")

        except Exception as e:
            log.warning("debt_narration: LLM call failed: %s", e)

    if narration_dict is None:
        fallback = _fallback_text(facts, monthly_surplus)
        narration_dict = {"text": fallback, "source": "fallback"}

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

    return {**plan, "narration": narration_dict}
