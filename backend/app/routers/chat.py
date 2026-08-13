"""Tax chat endpoints."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS
from app.core.subscription import check_ai_chat_limit, increment_ai_chat_usage

import httpx

router = APIRouter(tags=["chat"])


@router.post("/chat/tax")
async def tax_chat(body: dict, user: dict = Depends(current_user)):
    messages = body.get("messages", [])
    if not messages or not OPENROUTER_API_KEY:
        raise HTTPException(400, "No messages or AI not configured")

    uid  = user["email"]
    await check_ai_chat_limit(uid)
    name = user.get("name", "").split()[0] or "there"

    from app.db.collections import preferences_col
    prefs          = await preferences_col.find_one({"user_id": uid}) or {}
    income         = float(prefs.get("income_value", 0))
    pension_annual = float(prefs.get("pension_annual", 0))
    bracket        = prefs.get("income_bracket", "")
    has_cb         = prefs.get("has_child_benefit", False)

    adjusted = income - pension_annual
    over     = max(0.0, adjusted - 100_000)
    taper_end = 125_140

    if adjusted >= taper_end:
        allowance_line = "Personal allowance fully withdrawn (adjusted income ≥ £125,140)"
    elif over > 0:
        lost   = int(over / 2)
        needed = int(over)
        allowance_line = f"Personal allowance: £{12570 - lost:,} remaining — needs £{needed:,} more pension to restore in full"
    else:
        allowance_line = "Full personal allowance intact (£12,570)"

    income_line = f"£{income:,.0f}" if income else f"bracket {bracket} (exact income not entered)"

    system = f"""You are Penny, {name}'s personal finance advisor, currently acting as their UK tax adviser. Be direct — 2-3 sentences max per reply, no preamble, no encouragement. Lead with the answer.

{name}'s situation (tax year 2026/27):
- Income: {income_line}
- Pension contributions this year: £{pension_annual:,.0f}
- Adjusted net income: £{adjusted:,.0f}
- {allowance_line}
- Receiving Child Benefit: {"Yes — high income charge applies" if has_cb else "No"}

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

Answer in 2-3 sentences. Bold key numbers. No bullet lists unless listing 3+ items."""

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 300,
                  "messages": [{"role": "system", "content": system}] + messages,
                  "provider": OPENROUTER_PROVIDER_PREFS},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    await increment_ai_chat_usage(uid)
    return {"reply": r.json()["choices"][0]["message"]["content"]}
