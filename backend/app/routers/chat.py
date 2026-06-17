"""Debt chat endpoints."""
import asyncio
import uuid as uuid_lib
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.db.collections import (
    chat_sessions_col, episodic_memory_col,
    transactions_col, yapily_transactions_col,
    accounts_col,
)
from app.services.region import get_user_region, get_kenya_transactions
from app.services.memory import extract_episodic_memory

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

    system = f"""You are a friendly, practical personal finance advisor helping {name} manage their finances.

Their current financial situation:
{debt_line}
- Average monthly income (last 3 months): {currency}{monthly_income:.2f}
- Average monthly spending (last 3 months): {currency}{monthly_spending:.2f}
- Monthly surplus available: {currency}{monthly_surplus:.2f}
{f"- At current rate, debt-free in: {months_to_clear} months" if total_debt > 0 else ""}
{f"- To clear debt in 12 months, need: {currency}{payment_12mo:.2f}/month" if total_debt > 0 else ""}
{f"- Monthly shortfall to 12-month goal: {currency}{gap:.2f}" if total_debt > 0 else ""}

Monthly spending breakdown:
{cats_text}{memory_section}

Be specific to their numbers. Be encouraging but realistic. Give concrete, actionable advice. Keep responses concise (2-4 short paragraphs max). Use plain English, no jargon."""

    full_messages = history + messages

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 600,
                  "messages": [{"role": "system", "content": system}] + full_messages},
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    reply = r.json()["choices"][0]["message"]["content"]

    if session_id:
        new_msgs = messages + [{"role": "assistant", "content": reply}]
        await chat_sessions_col.update_one(
            {"_id": session_id, "user_id": uid},
            {"$push": {"messages": {"$each": new_msgs}}},
        )
        asyncio.create_task(extract_episodic_memory(uid, full_messages + [{"role": "assistant", "content": reply}]))

    return {"reply": reply, "session_id": session_id}
