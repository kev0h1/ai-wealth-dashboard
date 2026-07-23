"""Debt chat endpoints."""
import asyncio
import json
import uuid as uuid_lib
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.subscription import check_ai_chat_limit, increment_ai_chat_usage
from app.db.collections import (
    chat_sessions_col, episodic_memory_col,
    transactions_col, yapily_transactions_col,
    accounts_col, debt_plans_col,
    savings_goals_col, savings_plans_col, savings_insights_col,
    cashflow_cache_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.memory import extract_episodic_memory
from app.routers.savings import _current_savings, _target_amount

router = APIRouter(tags=["chat"])

_NON_DISC = {"Transfer", "Savings", "Debt", "Income"}


@router.get("/debt/chat/session")
async def get_chat_session(user: dict = Depends(current_user)):
    uid     = user["email"]
    session = await chat_sessions_col.find_one(
        {"user_id": uid, "session_type": "debt"},
        sort=[("created_at", -1)]
    )
    if not session:
        session_id = str(uuid_lib.uuid4())
        await chat_sessions_col.insert_one({
            "_id": session_id, "user_id": uid, "session_type": "debt",
            "messages": [], "created_at": datetime.now(),
        })
        return {"session_id": session_id, "messages": []}
    return {"session_id": session["_id"], "messages": session.get("messages", [])}


@router.post("/debt/chat/new")
async def new_chat_session(user: dict = Depends(current_user)):
    uid        = user["email"]
    session_id = str(uuid_lib.uuid4())
    await chat_sessions_col.insert_one({
        "_id": session_id, "user_id": uid, "session_type": "debt",
        "messages": [], "created_at": datetime.now(),
    })
    return {"session_id": session_id, "messages": []}


@router.post("/debt/chat")
async def debt_chat(body: dict, user: dict = Depends(current_user)):
    messages   = body.get("messages", [])
    session_id = body.get("session_id")
    if not messages or not OPENROUTER_API_KEY:
        raise HTTPException(400, "No messages or AI not configured")

    uid      = user["email"]
    await check_ai_chat_limit(uid)
    name     = user.get("name", "").split()[0] or "there"
    region   = await get_user_region(uid)
    currency = "KES " if region == "Kenya" else "£"

    history = []
    if session_id:
        session_doc = await chat_sessions_col.find_one({"_id": session_id, "user_id": uid})
        if session_doc:
            history = session_doc.get("messages", [])

    mem_doc      = await episodic_memory_col.find_one({"_id": uid})
    memory_facts = mem_doc.get("facts", []) if mem_doc else []
    memory_section = ""
    if memory_facts:
        memory_section = "\n\nWhat you know about this user from previous conversations:\n" + "\n".join(f"- {f}" for f in memory_facts)

    # Contract/bill details the user entered via insight workflows — Penny and
    # the workflows share one brain
    ctx_docs = await savings_insights_col.find(
        {"user_id": uid, "user_context": {"$exists": True, "$ne": None}},
        {"category": 1, "user_context": 1},
    ).to_list(None)
    ctx_lines = []
    for d in ctx_docs:
        details = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in (d.get("user_context") or {}).items() if v)
        if details:
            ctx_lines.append(f"- {d['category'].replace('_', ' ').title()}: {details}")
    if ctx_lines:
        memory_section += "\n\nContract & bill details the user has provided (treat as current facts):\n" + "\n".join(ctx_lines)

    cutoff = datetime.now() - timedelta(days=90)

    if region == "Kenya":
        cc_accounts = []
        total_debt  = 0.0
        all_txns    = await get_kenya_transactions(uid, cutoff)
        income_txns = [t for t in all_txns if t.get("transaction_type") == "credit" and
                       (t.get("custom_category") or t.get("category")) == "Income"]
        debit_txns  = [t for t in all_txns if t.get("transaction_type") == "debit"]
    else:
        accs        = await accounts_col.find({"user_id": uid}).to_list(None)
        cc_accounts = [a for a in accs if a.get("type") == "credit_card" and a.get("balance", 0) < 0]
        total_debt  = sum(abs(a["balance"]) for a in cc_accounts)
        income_txns = await transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        yap_income  = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        income_txns = income_txns + yap_income
        debit_txns  = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        yap_debits  = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        debit_txns  = debit_txns + yap_debits

    monthly_income = sum(t["amount"] for t in income_txns) / 3
    cat_totals: dict = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
    monthly_cat      = {k: round(v / 3, 2) for k, v in cat_totals.items()}
    monthly_spending = sum(v for k, v in monthly_cat.items() if k not in _NON_DISC)
    monthly_surplus  = monthly_income - monthly_spending
    months_to_clear  = round(total_debt / monthly_surplus, 1) if monthly_surplus > 0 and total_debt > 0 else 0
    payment_12mo     = round(total_debt / 12, 2)
    gap              = max(0, round(payment_12mo - monthly_surplus, 2))

    cards_text = "\n".join(f"  - {a['name']} ({a.get('provider', '')}): {currency}{abs(a['balance']):.2f}" for a in cc_accounts)
    cats_text  = "\n".join(f"  - {k}: {currency}{v:.2f}/mo" for k, v in sorted(monthly_cat.items(), key=lambda x: -x[1]) if k not in _NON_DISC and v > 0)
    debt_line  = f"- Total credit card debt: {currency}{total_debt:.2f} across {len(cc_accounts)} card(s)\n{cards_text}" if total_debt > 0 else "- No credit card debt"

    is_savings = total_debt <= 0

    if is_savings:
        goal            = await savings_goals_col.find_one({"_id": uid})
        current_savings = await _current_savings(uid, goal)
        target_amount   = _target_amount(goal, monthly_spending)
        months_funded   = round(current_savings / monthly_spending, 1) if monthly_spending > 0 else 0
        gap_to_target   = max(0.0, round(target_amount - current_savings, 2))
        months_to_target = (
            __import__("math").ceil(gap_to_target / monthly_surplus)
            if monthly_surplus > 0 and gap_to_target > 0 else 0
        )
        plan_doc = await savings_plans_col.find_one({"_id": uid})
    else:
        plan_doc = await debt_plans_col.find_one({"_id": uid})

    has_plan = bool(plan_doc and plan_doc.get("milestones"))
    if has_plan:
        existing_lines = "\n".join(f"  - {m.get('text', '')}" for m in plan_doc["milestones"])
        kind_label     = "safety-net savings" if is_savings else "debt-free"
        plan_section   = f"\n\nThe user already has a saved {kind_label} plan with these goals:\n{existing_lines}"
    else:
        kind_label     = "safety-net savings" if is_savings else "debt-free"
        plan_section   = f"\n\nThe user does not have a saved {kind_label} plan yet."

    if is_savings:
        target_desc = f"{currency}{target_amount:,.2f}" if target_amount > 0 else "an emergency fund of 3-6 months of essential expenses"
        funded_line = (
            f"- At current surplus, fully funded in: {months_to_target} months" if months_to_target else ""
        )
        system = f"""You are Penny, {name}'s friendly and practical personal finance advisor. You are helping them build a savings safety net.

Their current financial situation:
- No credit card debt 🎉
- Current safety-net savings: {currency}{current_savings:,.2f}
- Target safety net: {target_desc}{f"  ({months_funded} months of expenses saved so far)" if monthly_spending > 0 else ""}
- Average monthly income (last 3 months): {currency}{monthly_income:.2f}
- Average monthly spending (last 3 months): {currency}{monthly_spending:.2f}
- Monthly surplus available to save: {currency}{monthly_surplus:.2f}
{funded_line}

Monthly spending breakdown:
{cats_text}{memory_section}{plan_section}

Help them set and reach a realistic emergency-fund or savings target. Be specific to their numbers. Keep it brief — 2-3 sentences max, lead with the direct answer, no preamble or encouragement. Use plain English.

Format replies in markdown: **bold** key numbers, use bullet points (-) only for lists of 3+ items. No headings.

When the user wants to build or change a trackable SAVINGS plan (not for general questions), end your reply with a JSON block in this exact format (the app parses it so the user can save it):

```plan
{{
  "mode": "replace",
  "target_amount": {round(target_amount, 2) if target_amount > 0 else 0},
  "milestones": [
    {{"type": "savings", "text": "Build a {currency}500 starter buffer", "target_balance": 500}},
    {{"type": "action", "text": "Set up a {currency}200 standing order on payday"}}
  ]
}}
```

Rules for the plan block:
- "mode" is "replace" to build a whole new plan, or "add" to append goals to their existing plan.
- If they have NO saved plan, use "replace" with 4-6 milestones ordered from the soonest starter buffer up to the full target.
- If they DO have a saved plan and want to add or adjust a goal, confer with them first to rationalise it against their numbers, then use "add" with ONLY the new goal(s) — never repeat goals already in their plan.
- Only use "replace" on an existing plan if they explicitly want to start over.
- Use "savings" type for balance targets (always include a numeric "target_balance" that steps UP toward the goal) and "action" type for habits/behaviour changes (no target_balance).
- Keep each "text" short and specific to their numbers. Only emit the block once you and the user have settled on the goal(s)."""
    else:
        system = f"""You are Penny, {name}'s friendly and practical personal finance advisor. You are helping them manage their finances.

Their current financial situation:
{debt_line}
- Average monthly income (last 3 months): {currency}{monthly_income:.2f}
- Average monthly spending (last 3 months): {currency}{monthly_spending:.2f}
- Monthly surplus available: {currency}{monthly_surplus:.2f}
{f"- At current rate, debt-free in: {months_to_clear} months" if total_debt > 0 else ""}
{f"- To clear debt in 12 months, need: {currency}{payment_12mo:.2f}/month" if total_debt > 0 else ""}
{f"- Monthly shortfall to 12-month goal: {currency}{gap:.2f}" if total_debt > 0 else ""}

Monthly spending breakdown:
{cats_text}{memory_section}{plan_section}

Be specific to their numbers. Keep it brief — 2-3 sentences max, lead with the direct answer, no preamble or encouragement. Use plain English.

Format replies in markdown: **bold** key numbers, use bullet points (-) only for lists of 3+ items. No headings.

When the user wants to build or change a trackable debt-free PLAN (not for general questions), end your reply with a JSON block in this exact format (the app parses it so the user can save it):

```plan
{{
  "mode": "replace",
  "target_months": 12,
  "milestones": [
    {{"type": "payment", "text": "Get your total balance below {currency}2,000", "target_balance": 2000}},
    {{"type": "action", "text": "Cancel unused subscriptions to free up {currency}25/month"}}
  ]
}}
```

Rules for the plan block:
- "mode" is "replace" to build a whole new plan, or "add" to append goals to their existing plan.
- If they have NO saved plan, use "replace" with 4-6 milestones ordered from soonest to debt-free.
- If they DO have a saved plan and want to add or adjust a specific goal, confer with them first to rationalise it against their numbers, then use "add" with ONLY the new goal(s) — never repeat goals already in their plan.
- Only use "replace" on an existing plan if they explicitly want to start over.
- Use "payment" type for balance targets (always include a numeric "target_balance" that steps down toward 0) and "action" type for behaviour changes (no target_balance).
- Keep each "text" short and specific to their numbers. Only emit the block once you and the user have settled on the goal(s)."""

    # Every chat sees every headline goal, so "how am I doing?" works anywhere
    try:
        from app.routers.goals import goals_summary, goals_context_text
        system += goals_context_text(await goals_summary(uid, region))
    except Exception:
        pass

    system += """

The app already tracks everything automatically from their connected banks — spending by category, budgets, upcoming bills, and plan milestones (which auto-complete from transactions and balances). NEVER suggest tracking anything outside the app: no notebooks, phone notes, spreadsheets, or manual logs of any kind. When they commit to a change, anchor it to an in-app tracker instead — a category budget on the Budget page, a goal in their debt-free or savings plan, or the live category view on the Spend page — and tell them the app will track it from here.

Work towards a close: end with a concrete recommendation or a confirmation of what's now in place, not a question. Ask a question only when you cannot proceed without the answer — never as a sign-off."""

    # Situational awareness: tell the model which screen the user is on, so
    # "why is this so high?" resolves to what they're actually looking at.
    _PAGE_CONTEXTS = {
        "debt":      "the Debt tab: their debt burndown chart, payoff plan and credit cards",
        "savings":   "the Savings tab: their safety-net progress and ways-to-save insights",
        "transport": "the Mobility tab: their transport spending breakdown (car, rideshare, fuel, public transport)",
        "home":      "the Home dashboard: net worth, cash, runway and upcoming bills",
        "budget":    "the Budget page: category budgets for the current pay period",
        "spend":     "the Spend page: their transactions for the current pay period, plus upcoming bills in the next ~30 days",
    }
    page_ctx = body.get("page_context") or ""
    if page_desc := _PAGE_CONTEXTS.get(page_ctx):
        system += f"\n\nRight now the user is looking at {page_desc}. If they refer to 'this' or ask about what's on screen, assume they mean that."

    # Upcoming-bills context — injected when user is on spend/home/budget pages
    if page_ctx in ("spend", "home", "budget"):
        try:
            cf_cached = await cashflow_cache_col.find_one({"_id": uid})
            if cf_cached:
                from app.routers.analytics import _build_cashflow_response
                cf = _build_cashflow_response(cf_cached)
                bills = [b for b in cf.get("upcoming_bills", []) if b.get("days_away", 99) <= 30]
                if bills:
                    total_due = sum(b["amount"] for b in bills)
                    next_b = bills[0]
                    next_desc = f"{next_b['name']} £{next_b['amount']:.0f} on {next_b['expected_date']}"
                    at_risk = [b for b in bills if b.get("account_balance") is not None and b["account_balance"] < b["amount"]]
                    risk_note = f"; {len(at_risk)} flagged at-risk (balance may not cover payment)" if at_risk else ""
                    system += (
                        f"\n\nUpcoming bills (next ~30 days): about £{total_due:.0f} across {len(bills)} bills; "
                        f"next up: {next_desc}{risk_note}."
                    )
        except Exception:
            pass  # never let cashflow read break chat

    full_messages = history + messages

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 350,
                  "messages": [{"role": "system", "content": system}] + full_messages},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    reply = r.json()["choices"][0]["message"]["content"]
    await increment_ai_chat_usage(uid)

    suggested_plan = None
    try:
        start = reply.find("```plan")
        if start != -1:
            end      = reply.find("```", start + 7)
            json_str = reply[start + 7:end].strip()
            parsed   = json.loads(json_str)
            if isinstance(parsed, dict) and isinstance(parsed.get("milestones"), list) and parsed["milestones"]:
                mode = parsed.get("mode")
                if mode not in ("add", "replace"):
                    mode = "add" if has_plan else "replace"
                parsed["mode"] = mode
                parsed["kind"] = "savings" if is_savings else "debt"
                suggested_plan = parsed
    except Exception:
        pass

    if session_id:
        new_msgs = messages + [{"role": "assistant", "content": reply}]
        await chat_sessions_col.update_one(
            {"_id": session_id, "user_id": uid},
            {"$push": {"messages": {"$each": new_msgs}}},
        )
        asyncio.create_task(extract_episodic_memory(uid, full_messages + [{"role": "assistant", "content": reply}]))

    return {"reply": reply, "session_id": session_id, "suggested_plan": suggested_plan}


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
                  "messages": [{"role": "system", "content": system}] + messages},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    await increment_ai_chat_usage(uid)
    return {"reply": r.json()["choices"][0]["message"]["content"]}
