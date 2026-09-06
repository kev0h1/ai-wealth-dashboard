"""Tax chat endpoints.

`answer_tax_question` is the reusable core: deterministic tax fact pack
(from preferences_col) + system prompt + OpenRouter call, returning the
reply string. It deliberately does NOT touch the AI-chat usage limit
(check_ai_chat_limit / increment_ai_chat_usage) — callers own that, so a
single question is never counted twice against a user's quota.

Ground-up loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md): POST /can-i
no longer has a dedicated tax-routing branch that calls this function — see
`/chat/tax`'s own comment below for where the doctrine here now lives
instead (folded into app.services.penny_agent's system prompt). This module
is otherwise unchanged and `answer_tax_question` is still a valid, working
function; nothing currently calls it.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.llm import openrouter_chat
from app.core.subscription import check_ai_chat_limit, increment_ai_chat_usage

import httpx

router = APIRouter(tags=["chat"])


def _safe_float(value, default: float = 0.0) -> float:
    """Tolerant float coercion for stored preference fields. A poisoned
    (non-numeric) income_value/pension_annual doc must degrade to the
    surface's existing no-income state, not 500 the whole endpoint."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


async def build_tax_fact_pack(uid: str) -> dict:
    """The user's own UK tax fact pack (tax year 2026/27): income, pension
    contributions, adjusted net income, and the personal-allowance taper
    line/remaining-allowance figure — computed from preferences_col.

    Extracted out of `answer_tax_question` below (audit fix, 2026-08-26,
    the ground-up loop-first rebuild's own independent review): the deleted
    can_i.py tax-routing branch used to call `answer_tax_question` directly,
    which is where a "how much personal allowance do I have left" question
    got the user's own real figures from. The rebuilt Penny agent loop has
    no equivalent — general UK tax MECHANICS moved into that loop's own
    system prompt, but the user's own PERSONAL figures never did — so this
    is exposed as its own function precisely so app.services.penny_tools's
    `get_tax_position` tool can call it too, both callers reading the exact
    same arithmetic rather than two copies that could drift.
    """
    from app.db.collections import preferences_col
    prefs          = await preferences_col.find_one({"user_id": uid}) or {}
    income         = _safe_float(prefs.get("income_value", 0))
    pension_annual = _safe_float(prefs.get("pension_annual", 0))
    bracket        = prefs.get("income_bracket", "")
    has_cb         = prefs.get("has_child_benefit", False)

    adjusted = income - pension_annual
    over     = max(0.0, adjusted - 100_000)
    taper_end = 125_140

    if adjusted >= taper_end:
        allowance_remaining = 0.0
        allowance_line = "Personal allowance fully withdrawn (adjusted income ≥ £125,140)"
    elif over > 0:
        lost   = int(over / 2)
        needed = int(over)
        allowance_remaining = float(12570 - lost)
        allowance_line = f"Personal allowance: £{12570 - lost:,} remaining, needs £{needed:,} more pension to restore in full"
    else:
        allowance_remaining = 12570.0
        allowance_line = "Full personal allowance intact (£12,570)"

    income_line = f"£{income:,.0f}" if income else f"bracket {bracket} (exact income not entered)"

    return {
        "income": income,
        "income_known": bool(income),
        "income_bracket": bracket,
        "pension_annual": pension_annual,
        "adjusted_net_income": adjusted,
        "personal_allowance_remaining": allowance_remaining,
        "personal_allowance_taper_over": over,
        "allowance_line": allowance_line,
        "income_line": income_line,
        "has_child_benefit": bool(has_cb),
    }


async def answer_tax_question(uid: str, name: str, messages: list[dict]) -> str:
    """Deterministic tax fact pack (`build_tax_fact_pack` above) + system
    prompt, then one OpenRouter call. Returns the reply string only — no
    limit check, no usage increment, no HTTP status handling beyond raising
    on a non-200 response; that's the caller's job (see module docstring).
    """
    fact_pack      = await build_tax_fact_pack(uid)
    income_line    = fact_pack["income_line"]
    pension_annual = fact_pack["pension_annual"]
    adjusted       = fact_pack["adjusted_net_income"]
    allowance_line = fact_pack["allowance_line"]
    has_cb         = fact_pack["has_child_benefit"]

    system = f"""You are Penny, {name}'s personal finance advisor, currently acting as their UK tax adviser. Be direct — 2-3 sentences max per reply, no preamble, no encouragement. Lead with the answer.

{name}'s situation (tax year 2026/27):
- Income: {income_line}
- Pension contributions this year: £{pension_annual:,.0f}
- Adjusted net income: £{adjusted:,.0f}
- {allowance_line}
- Receiving Child Benefit: {"Yes, high income charge applies" if has_cb else "No"}

UK tax facts:
- Personal allowance tapers above £100,000, lost entirely at £125,140
- Effective marginal rate in taper band: 60% (40% income tax + 20% from lost allowance)
- Annual pension allowance: £60,000; unused allowance from last 3 years can be carried forward
- Salary sacrifice (pension, cycle to work, EV) reduces gross pay before tax
- Gift Aid donations reduce adjusted net income — same mechanism as pension
- ISA allowance: £20,000/year, can't carry forward
- EIS: 30% income tax relief; SEIS: 50% — qualifying startup investors can claim
- Self-assessment is mandatory above £100,000
- Child benefit high income charge starts at £60,000 adjusted income

Answer in 2-3 sentences. Bold key numbers. No bullet lists unless listing 3+ items.

Write in plain, human punctuation: no em-dashes (—) or en-dashes (–); use a comma, a full stop, or a plain conjunction instead. A plain hyphen is fine only inside a compound word or a range."""

    async with httpx.AsyncClient(timeout=30) as client:
        r = await openrouter_chat(
            {"model": "anthropic/claude-haiku-4-5", "max_tokens": 300,
             "messages": [{"role": "system", "content": system}] + messages},
            user_id=uid, pipeline="tax_chat", client=client,
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    return r.json()["choices"][0]["message"]["content"]


# The app no longer calls this route after tax Q&A folded into POST /can-i.
# Ground-up loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md): can_i.py no
# longer has a dedicated tax-routing branch at all — a UK tax mechanics
# question now reaches the Penny agent loop (app.services.penny_agent) like
# any other question, and the loop's own system prompt folds in this
# module's UK tax facts/doctrine directly rather than calling
# `answer_tax_question` as a sub-routine. Left in place as a thin wrapper so
# nothing that still points at it breaks; candidate for retirement in a
# later route cleanup once the old Tax tab chat UI is confirmed gone from
# the frontend.
@router.post("/chat/tax")
async def tax_chat(body: dict, user: dict = Depends(current_user)):
    messages = body.get("messages", [])
    if not messages or not OPENROUTER_API_KEY:
        raise HTTPException(400, "No messages or AI not configured")

    uid  = user["email"]
    await check_ai_chat_limit(uid)
    name = user.get("name", "").split()[0] or "there"

    reply = await answer_tax_question(uid, name, messages)

    await increment_ai_chat_usage(uid)
    return {"reply": reply}
