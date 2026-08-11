"""Can-I-afford-X quick-fire Q&A endpoint.

Deterministic fact-gathering (safe-to-spend, cashflow, savings buffer,
upcoming bills, precomputed what-if arithmetic) feeds a short LLM call that
ONLY phrases the verdict — it never computes a figure itself. FCA doctrine
per grow.py: facts only, never "you should".
"""
import re
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import APP_URL, OPENROUTER_API_KEY
from app.core.subscription import check_ai_chat_limit, increment_ai_chat_usage
from app.db.collections import cashflow_cache_col, savings_goals_col
from app.routers.analytics import compute_safe_to_spend, _build_cashflow_response
from app.routers.savings import _cashflow, _current_savings
from app.services.region import get_user_region

router = APIRouter(tags=["can-i"])

MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]


def _extract_amount(question: str) -> float | None:
    """Largest plausible £ figure mentioned in the question, or None."""
    candidates = []
    for m in re.findall(r"£?\s?(\d[\d,]*(?:\.\d{1,2})?)", question):
        try:
            val = float(m.replace(",", ""))
        except ValueError:
            continue
        if 1 <= val <= 100_000:
            candidates.append(val)
    return max(candidates) if candidates else None


def _months_until_target(month_name: str, today: date) -> int:
    """1..12 — months from today to the NEXT occurrence of the named month."""
    target_idx = MONTH_NAMES.index(month_name) + 1  # 1..12
    delta = target_idx - today.month
    if delta <= 0:
        delta += 12
    return delta


@router.post("/can-i")
async def can_i(body: dict, user: dict = Depends(current_user)):
    question = (body.get("question") or "").strip()
    if not (3 <= len(question) <= 160):
        raise HTTPException(400, "question must be 3-160 characters")
    if not OPENROUTER_API_KEY:
        raise HTTPException(500, "AI not configured")

    # ── History — capped, validated, truncated (chat-with-a-cap) ────────
    raw_history = body.get("history") or []
    history: list[dict] = []
    if isinstance(raw_history, list):
        for entry in raw_history[-6:]:
            if not isinstance(entry, dict):
                continue
            role = entry.get("role")
            content = entry.get("content")
            if role not in ("user", "assistant") or not isinstance(content, str):
                continue
            history.append({"role": role, "content": content[:300]})

    uid = user["email"]
    await check_ai_chat_limit(uid)

    # ── Deterministic fact pack ──────────────────────────────────────────
    sts = await compute_safe_to_spend(uid)
    if sts.get("status") == "insufficient_data":
        return {"reply": "I don't have enough account data yet — connect an account and try again."}

    facts: dict = {
        "safe_to_spend":     sts.get("safe_to_spend"),
        "days_until_payday": sts.get("days_until_payday"),
        "next_payday":       sts.get("next_payday"),
        "state":             sts.get("state"),
        "bills_total":       sts.get("bills_total"),
        "card_debt":         sts.get("card_debt"),
    }
    days_until_payday = sts.get("days_until_payday") or 1
    safe_to_spend = sts.get("safe_to_spend") or 0.0
    facts["per_day"] = round(safe_to_spend / max(1, days_until_payday), 2)

    monthly_surplus = 0.0
    try:
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        monthly_income, monthly_spending, monthly_surplus = await _cashflow(uid, region, cutoff)
        facts["monthly_income"] = round(monthly_income, 2)
        facts["monthly_spending"] = round(monthly_spending, 2)
        facts["monthly_surplus"] = round(monthly_surplus, 2)
    except Exception:
        pass

    try:
        goal = await savings_goals_col.find_one({"_id": uid})
        facts["savings_buffer"] = round(await _current_savings(uid, goal), 2)
    except Exception:
        pass

    try:
        cached = await cashflow_cache_col.find_one({"_id": uid})
        if cached:
            resp = await _build_cashflow_response(cached, uid=uid)
            upcoming = [
                b for b in resp.get("upcoming_bills", [])
                if 0 <= b.get("days_away", 999) <= days_until_payday
            ]
            upcoming.sort(key=lambda b: -b.get("amount", 0))
            facts["upcoming_bills"] = [
                {"name": b.get("name"), "amount": round(b.get("amount", 0)), "in_days": b.get("days_away")}
                for b in upcoming[:3]
            ]
    except Exception:
        pass

    # ── Change intents (Mirror traits marked "change" → category pace) ──
    try:
        from app.db.collections import behaviour_portrait_col, preferences_col
        from app.services.checkpoints import checkpoint_map_for_period
        from app.services.pace import (
            _BASELINE_DAYS,
            _read_cached_baseline,
            _total_baseline,
            _write_cached_baseline,
            load_spend_txns,
        )
        from app.services.pay_period import get_pay_period_for_date

        portrait = await behaviour_portrait_col.find_one({"_id": uid}) or {}
        change_cats: list[str] = []
        for trait in portrait.get("traits") or []:
            if not isinstance(trait, dict) or trait.get("choice") != "change":
                continue
            cat = trait.get("ref_category")
            if not cat:
                # Defensive fallback until ref_category ships: parse the title.
                title = trait.get("title") or ""
                if title.startswith("Your Signature: "):
                    cat = title[len("Your Signature: "):].strip()
            if cat and cat not in change_cats:
                change_cats.append(cat)

        if change_cats:
            prefs = await preferences_col.find_one({"_id": uid}) or {}
            pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
            ci_today = date.today()
            period_start, period_end = get_pay_period_for_date(ci_today, pay_cfg)

            # Baseline: same cache key + fallback path pace/companion use.
            baseline_key = period_start.isoformat()
            cached_baseline = await _read_cached_baseline(uid, baseline_key)
            if cached_baseline is not None:
                baseline, baseline_months = cached_baseline
                spend_txns = await load_spend_txns(uid, period_start, period_end)
            else:
                spend_txns = await load_spend_txns(
                    uid, period_start - timedelta(days=_BASELINE_DAYS), period_end
                )
                baseline, baseline_months = _total_baseline(spend_txns, period_start)
                await _write_cached_baseline(uid, baseline_key, baseline, baseline_months)

            # Per-category spend this period (effective category = custom or raw,
            # debits only — load_spend_txns already normalises both).
            cat_spent: dict[str, float] = {}
            for t in spend_txns:
                if period_start <= t["date"] <= period_end:
                    cat_spent[t["category"]] = cat_spent.get(t["category"], 0.0) + t["amount"]

            days_elapsed = max(1, (ci_today - period_start).days)
            thin_history = baseline_months < 2

            aim_map = await checkpoint_map_for_period(
                uid, period_start, period_end, cat_spent=cat_spent
            )

            change_intents: list[dict] = []
            for cat in change_cats:
                usual_30d = None if thin_history else baseline.get(cat)
                aim_doc = aim_map.get(cat)
                change_intents.append({
                    "category": cat,
                    "usual_30d": round(float(usual_30d), 2) if usual_30d else None,
                    "spent_this_period": round(cat_spent.get(cat, 0.0), 2),
                    "pro_rata_usual": (
                        round(float(usual_30d) / 30 * days_elapsed, 2)
                        if usual_30d else None
                    ),
                    "active_aim": (
                        round(float(aim_doc["aim_amount"]), 2)
                        if aim_doc and aim_doc.get("aim_amount") is not None
                        else None
                    ),
                })
            if change_intents:
                facts["change_intents"] = change_intents
    except Exception:
        pass

    # ── Deterministic what-ifs (LLM never does arithmetic) ──────────────
    what_ifs: dict = {}
    amount_asked = _extract_amount(question)
    if amount_asked is not None:
        free_after_spend = round(safe_to_spend - amount_asked)
        what_ifs["amount_asked"] = amount_asked
        what_ifs["free_after_spend"] = free_after_spend
        what_ifs["per_day_after"] = round(free_after_spend / max(1, days_until_payday), 2)
        what_ifs["goes_negative"] = free_after_spend < 0
        what_ifs["months_of_saving_needed"] = (
            round(amount_asked / monthly_surplus, 1) if monthly_surplus > 0 else None
        )
        # Precompute per-category "where would this take me" so the LLM never
        # has to add two figures itself.
        for ci in facts.get("change_intents", []):
            ci["would_take_to"] = round(ci["spent_this_period"] + amount_asked, 2)

    today = date.today()
    q_lower = question.lower()
    for month_name in MONTH_NAMES:
        if month_name in q_lower:
            months_until = _months_until_target(month_name, today)
            what_ifs["months_until_target"] = months_until
            what_ifs["savable_by_target"] = (
                round(monthly_surplus * months_until) if monthly_surplus > 0 else 0
            )
            break

    facts["what_ifs"] = what_ifs

    # ── System prompt ─────────────────────────────────────────────────
    import json
    system_prompt = (
        "You are Penny, the AI inside a personal money app. The user asks quick-fire "
        "spending questions. Reply in AT MOST 2 short sentences: verdict first (Yes / "
        "Tight / No / or the number they asked for), then the single most important "
        "implication. Zero fluff — no greetings, no caveats, no moralising, never "
        "'you should'. British English. Every £ figure you write MUST be copied from "
        "the facts JSON below, rounded to whole pounds — NEVER compute, derive or "
        "invent a figure; the what_ifs are precomputed for you. If they name a thing "
        "but no price and you'd need one, give the envelope from the facts (free "
        "until payday, or per-day rate) and ask for a number in the same sentence. "
        "For future-month questions use months_until_target and savable_by_target. "
        "If the question maps to a category in change_intents, acknowledge the "
        "stated change in the answer using ONLY the provided figures — when an "
        "entry has would_take_to, that is the precomputed category total after "
        "this spend; copy it as-is (e.g. this £30 would take Eating Out to your "
        "would_take_to figure of your usual_30d usual pace — still inside the "
        "change you asked for). Never moralise. "
        "If the question is not about the user's own spending or affordability, reply "
        'exactly: I can answer spending questions — try "Can I spend £50 this '
        'weekend?". General cost knowledge may be used ONLY as a clearly rough range '
        "(say 'roughly'), never as their figure. Follow-up questions may reference "
        "earlier turns — use the conversation for context but ALWAYS ground figures "
        "in the current facts JSON.\n\n"
        f"FACTS: {json.dumps(facts, default=str)}"
    )

    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": question}]

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": APP_URL},
            json={
                "model": "anthropic/claude-haiku-4-5",
                "max_tokens": 120,
                "temperature": 0,
                "messages": messages,
            },
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    await increment_ai_chat_usage(uid)
    return {"reply": r.json()["choices"][0]["message"]["content"]}
