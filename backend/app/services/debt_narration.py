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


def _build_facts(plan: dict) -> Optional[dict]:
    """Build compact, deterministic facts dict from a plan.

    Returns None on any exception (caller falls back to None narration).
    """
    try:
        totals = plan.get("totals") or {}
        history = plan.get("history") or {}
        cards = plan.get("cards") or []
        extra_to_clear = plan.get("extra_to_clear")
        whats_working = plan.get("whats_working") or []
        refinance_options = plan.get("refinance_options") or []

        # growth_card: among cards with debt ≥ MATERIAL_BALANCE,
        # movement.monthly not None, monthly < −MOVEMENT_FLAT_EPS,
        # pick the one with the most negative monthly (worst grower).
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
                # Get the most recent closed period (index 0 = most recent in per_period,
                # which is appended walking backward from current period)
                per_period = (c.get("movement") or {}).get("per_period") or []
                latest_period = per_period[0] if per_period else {}
                growth_card = {
                    "name": c.get("name", ""),
                    "provider": c.get("provider", ""),
                    "spend_last_period": _r2(latest_period.get("debits", 0.0)),
                    "payments_last_period": _r2(latest_period.get("credits", 0.0)),
                }

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

        # refinance_best: max net_saving option
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

        facts: dict = {
            "total_debt": totals.get("debt"),
            "verdict": totals.get("verdict"),
            "history_trend_3m": history.get("trend_3m"),
            "history_rising": history.get("rising"),
            "growth_card": growth_card,
            "extra_to_clear": etc_facts,
            "whats_working": whats_working_first,
            "missing_rates_count": missing_rates_count,
            "refinance_best": refinance_best,
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
    sentences: list[str] = []

    # (a) History trend
    trend = facts.get("history_trend_3m") or 0.0
    if trend > 1.0:
        sentences.append(f"Your card total has risen £{trend:,.0f} over the last three months.")
    elif trend < -1.0:
        sentences.append(f"Your card total has come down £{abs(trend):,.0f} over the last three months.")
    else:
        sentences.append("Your card total has held roughly flat over the last three months.")

    # (b) Surplus (only if present and |surplus| > 1)
    surplus_sentence = None
    if monthly_surplus is not None and abs(monthly_surplus) > 1.0:
        if monthly_surplus < 0:
            surplus_sentence = f"A typical month currently runs about £{abs(monthly_surplus):,.0f} short after spending."
        else:
            surplus_sentence = f"A typical month leaves about £{monthly_surplus:,.0f} after spending that could point at the cards."

    # (c) growth_card
    gc = facts.get("growth_card")
    gc_sentence = None
    if gc:
        provider = gc.get("provider") or gc.get("name") or "card"
        card_ref = f"your {provider} card" if gc.get("provider") else gc.get("name", "your card")
        spend = gc.get("spend_last_period", 0)
        pays = gc.get("payments_last_period", 0)
        gc_sentence = (
            f"Most of the growth is {card_ref} — £{spend:,.0f} of spending against £{pays:,.0f} "
            f"of payments last period. "
            f"If that's deliberate, tell me its rate and I'll price it; if not, that's the biggest lever here."
        )

    # (d) extra_to_clear + whats_working
    etc = facts.get("extra_to_clear")
    ww = facts.get("whats_working")
    etc_sentence = None
    ww_sentence = None
    if etc and (etc.get("amount") or 0) > 0:
        dfm = _month_label_to_human(etc.get("debt_free_month") or "")
        etc_sentence = f"£{etc.get('amount', 0):,.0f} more a month clears every card by {dfm}."
    if ww:
        ww_dfm = _month_label_to_human(ww.get("payoff_month") or "")
        ww_sentence = f"{ww.get('name', 'One card')} is already on its way out, clearing {ww_dfm}."

    # (e) missing rates
    n_missing = facts.get("missing_rates_count") or 0
    missing_sentence = None
    if n_missing > 0:
        s = "s" if n_missing > 1 else ""
        missing_sentence = (
            f"{n_missing} card{s} have no rate on file — add them and I can price every lever exactly."
        )

    # Assemble up to 5 sentences, priority: (a), (b), (c), (d)etc, (d)ww, (e)
    # If >5, drop (b) first, then (d)'s ww clause
    candidates = [sentences[0]]  # (a) always first
    if surplus_sentence:
        candidates.append(surplus_sentence)
    if gc_sentence:
        candidates.append(gc_sentence)
    if etc_sentence:
        candidates.append(etc_sentence)
    if ww_sentence:
        candidates.append(ww_sentence)
    if missing_sentence:
        candidates.append(missing_sentence)

    if len(candidates) > 5:
        # Drop (b) first
        if surplus_sentence and surplus_sentence in candidates:
            candidates.remove(surplus_sentence)
    if len(candidates) > 5:
        # Drop ww_sentence
        if ww_sentence and ww_sentence in candidates:
            candidates.remove(ww_sentence)

    return " ".join(candidates[:5])


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
                "(1) The situation — if history_rising is true, the total has risen £{history_trend_3m} "
                "over the last three months; if monthly_surplus is negative, connect it ('a typical month "
                "runs about £X short after spending').\n"
                "(2) If growth_card is present, EXACTLY one sentence in this shape, asking rather than "
                "assuming intent: \"Most of the growth is your {provider} card — £{spend_last_period} of "
                "spending against £{payments_last_period} of payments last period. If that's deliberate, "
                "tell me its rate and I'll price it; if not, that's the biggest lever here.\" "
                "(refer to the card as 'your {provider} card' when provider is set, else the name).\n"
                "(3) The fastest lever — extra_to_clear ('£{amount} more a month clears every card by "
                "{Mon YYYY}') and/or whats_working ('{name} is already on its way out, clearing {Mon YYYY}'); "
                "include refinance_best when present.\n"
                "(4) If missing_rates_count > 0, close with one sentence that adding those rates lets "
                "every lever be priced exactly.\n\n"
                "Month labels 'YYYY-MM' must be written as 'Mon YYYY' (e.g. 2031-08 → Aug 2031).\n\n"
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
                        "model": "anthropic/claude-haiku-4-5",
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

    # Store in memo
    _narration_memo[uid] = (facts_hash, narration_dict)

    return {**plan, "narration": narration_dict}
