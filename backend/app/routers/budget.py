"""Budget management and budget chat endpoints."""
import asyncio
import json
import uuid as uuid_lib
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.db.collections import (
    budgets_col, preferences_col, chat_sessions_col, episodic_memory_col,
    transactions_col, yapily_transactions_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.memory import extract_episodic_memory

router = APIRouter(tags=["budget"])


@router.get("/budgets")
async def get_budgets(user: dict = Depends(current_user)):
    uid    = user["email"]
    region = await get_user_region(uid)
    doc    = await budgets_col.find_one({"user_id": uid, "region": region})
    return {"budgets": doc.get("budgets", []) if doc else []}


@router.put("/budgets")
async def set_budgets(body: dict, user: dict = Depends(current_user)):
    uid     = user["email"]
    region  = await get_user_region(uid)
    budgets = body.get("budgets", [])
    await budgets_col.update_one(
        {"user_id": uid, "region": region},
        {"$set": {"budgets": budgets, "user_id": uid, "region": region}},
        upsert=True,
    )
    return {"budgets": budgets}


@router.post("/budget/chat")
async def budget_chat(body: dict, user: dict = Depends(current_user)):
    messages   = body.get("messages", [])
    session_id = body.get("session_id")
    if not messages or not OPENROUTER_API_KEY:
        raise HTTPException(400, "No messages or AI not configured")

    uid    = user["email"]
    name   = user.get("name", "").split()[0] or "there"
    region = await get_user_region(uid)

    history = []
    if session_id:
        session_doc = await chat_sessions_col.find_one({"_id": session_id, "user_id": uid})
        if session_doc:
            history = session_doc.get("messages", [])

    mem_doc      = await episodic_memory_col.find_one({"_id": uid})
    memory_facts = mem_doc.get("facts", []) if mem_doc else []
    memory_section = ""
    if memory_facts:
        memory_section = "\n\nPersonal context from previous conversations:\n" + "\n".join(f"- {f}" for f in memory_facts)

    budget_doc      = await budgets_col.find_one({"user_id": uid, "region": region})
    current_budgets = budget_doc.get("budgets", []) if budget_doc else []

    cutoff    = datetime.now() - timedelta(days=90)
    non_budget = {"Transfer", "Savings", "Debt"}

    if region == "Kenya":
        currency    = "KES "
        all_kenya   = await get_kenya_transactions(uid, cutoff)
        debit_txns  = [t for t in all_kenya if t.get("transaction_type") == "debit"]
        income_txns = [t for t in all_kenya if t.get("transaction_type") == "credit" and
                       (t.get("custom_category") or t.get("category")) == "Income"]
    else:
        currency    = "£"
        debit_txns  = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        yap_debits  = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": cutoff}}).to_list(None)
        debit_txns  = debit_txns + yap_debits
        income_txns = await transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        yap_income  = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "credit", "category": "Income", "date": {"$gte": cutoff}}).to_list(None)
        income_txns = income_txns + yap_income

    budgets_text = "\n".join(f"  - {b['category']}: {currency}{b['monthly_limit']:.0f}/mo" for b in current_budgets) if current_budgets else "  None set yet"

    cat_totals: dict = {}
    for t in debit_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat in non_budget:
            continue
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
    monthly_avg  = {k: round(v / 3, 2) for k, v in cat_totals.items()}
    avg_text     = "\n".join(f"  - {k}: {currency}{v:.2f}/mo" for k, v in sorted(monthly_avg.items(), key=lambda x: -x[1]))
    monthly_income = round(sum(t["amount"] for t in income_txns) / 3, 2)

    system = f"""You are a friendly, practical personal finance assistant helping {name} set up and manage monthly budgets.

Their average monthly income: {currency}{monthly_income:.2f}

Their average monthly spending by category (last 3 months):
{avg_text}

Their current budget limits:
{budgets_text}{memory_section}

IMPORTANT: When the user wants to set or update budgets, respond with BOTH a friendly message AND a JSON block in this exact format (the app will parse it to save automatically):

```budgets
[
  {{"category": "Groceries", "monthly_limit": 300}},
  {{"category": "Eating Out", "monthly_limit": 150}}
]
```

Only include categories with actual limits. Don't include Transfer, Savings, Debt.
Be encouraging, practical, and specific to their numbers. Suggest realistic budgets based on their actual spending."""

    full_messages = history + messages

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 800,
                  "messages": [{"role": "system", "content": system}] + full_messages},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    reply = r.json()["choices"][0]["message"]["content"]

    suggested_budgets = None
    try:
        start = reply.find("```budgets")
        if start != -1:
            end      = reply.find("```", start + 9)
            json_str = reply[start + 10:end].strip()
            parsed   = json.loads(json_str)
            if isinstance(parsed, list):
                suggested_budgets = parsed
    except Exception:
        pass

    if session_id:
        new_msgs = messages + [{"role": "assistant", "content": reply}]
        await chat_sessions_col.update_one(
            {"_id": session_id, "user_id": uid},
            {"$push": {"messages": {"$each": new_msgs}}},
        )
        asyncio.create_task(extract_episodic_memory(uid, full_messages + [{"role": "assistant", "content": reply}]))

    return {"reply": reply, "session_id": session_id, "suggested_budgets": suggested_budgets}


@router.get("/budget/chat/session")
async def get_budget_chat_session(user: dict = Depends(current_user)):
    uid     = user["email"]
    session = await chat_sessions_col.find_one(
        {"user_id": uid, "session_type": "budget"},
        sort=[("created_at", -1)]
    )
    if not session:
        session_id = str(uuid_lib.uuid4())
        await chat_sessions_col.insert_one({
            "_id": session_id, "user_id": uid, "session_type": "budget",
            "messages": [], "created_at": datetime.now(),
        })
        return {"session_id": session_id, "messages": []}
    return {"session_id": session["_id"], "messages": session.get("messages", [])}


@router.post("/budget/chat/new")
async def new_budget_chat_session(user: dict = Depends(current_user)):
    uid        = user["email"]
    session_id = str(uuid_lib.uuid4())
    await chat_sessions_col.insert_one({
        "_id": session_id, "user_id": uid, "session_type": "budget",
        "messages": [], "created_at": datetime.now(),
    })
    return {"session_id": session_id, "messages": []}
