"""Transaction read/write + auto-categorise endpoints."""
import re
import json
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
import httpx

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, TAVILY_API_KEY
from app.core.models import Transaction
from app.db.collections import (
    transactions_col, accounts_col, yapily_accounts_col, yapily_transactions_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
)
from app.services.categorisation import (
    RAW_TRUELAYER_CATEGORIES, VALID_CATEGORIES,
    apply_rules_bulk, rule_categorise, tavily_lookup_merchants,
)

router = APIRouter(tags=["transactions"])


def _description_stem(desc: str) -> str:
    s = desc.strip()
    s = re.sub(r'\s+[A-Z]{2,4}\s*$', '', s).strip()
    s = re.sub(r'\s+(?:ON\s+)?\d{1,2}\s+[A-Z]{3}\b.*$', '', s, flags=re.I).strip()
    s = re.sub(r'\s+\d{2}[A-Z]{3}\b.*$', '', s, flags=re.I).strip()
    s = re.sub(r'\s+\d{6,}\s*$', '', s).strip()
    return s or desc


def _doc_to_tx(d) -> Transaction:
    eff = d.get("custom_category") or d.get("category") or "Other"
    return Transaction(
        id=str(d["_id"]), category=eff, custom_category=d.get("custom_category"),
        **{k: v for k, v in d.items() if k not in ("_id", "category", "custom_category")},
    )


@router.get("/accounts/{account_id}/transactions", response_model=List[Transaction])
async def get_transactions(account_id: str, days: int = 90, user: dict = Depends(current_user)):
    uid    = user["email"]
    cutoff = datetime.now() - timedelta(days=days)

    if account_id.startswith("mono-"):
        docs = await mono_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    if account_id.startswith("mpesa-"):
        docs = await mpesa_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    if account_id.startswith("statement-"):
        docs = await statement_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    yapily_acc = await yapily_accounts_col.find_one({"_id": account_id, "user_id": uid})
    if yapily_acc:
        docs = await yapily_transactions_col.find(
            {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
        ).sort("date", -1).to_list(None)
        return [_doc_to_tx(d) for d in docs]

    docs = await transactions_col.find(
        {"account_id": account_id, "user_id": uid, "date": {"$gte": cutoff}}
    ).sort("date", -1).to_list(None)
    return [_doc_to_tx(d) for d in docs]


@router.get("/transactions/{transaction_id}/similar", response_model=List[Transaction])
async def similar_transactions(transaction_id: str, scope: str = "all", user: dict = Depends(current_user)):
    ref = await transactions_col.find_one({"_id": transaction_id, "user_id": user["email"]})
    if not ref:
        raise HTTPException(404, "Transaction not found")

    merchant    = ref.get("merchant_name")
    description = ref.get("description", "")
    txn_type    = ref.get("transaction_type", "debit")

    match: dict = {
        "_id": {"$ne": transaction_id},
        "user_id": user["email"],
        "transaction_type": txn_type,
    }
    if merchant:
        match["merchant_name"] = merchant
    else:
        stem = _description_stem(description)
        match["description"] = re.compile(r'^\s*' + re.escape(stem), re.IGNORECASE)
    if scope == "future":
        match["date"] = {"$gte": ref["date"]}

    docs = await transactions_col.find(match).sort("date", -1).to_list(200)
    return [_doc_to_tx(d) for d in docs]


@router.patch("/transactions/{transaction_id}")
async def update_transaction(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    if "category" not in body:
        raise HTTPException(400, "Provide 'category' in body")
    category       = body["category"]
    additional_ids = body.get("additional_ids", [])

    await transactions_col.update_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"$set": {"custom_category": category}},
    )
    bulk_count = 0
    if additional_ids:
        result = await transactions_col.update_many(
            {"_id": {"$in": additional_ids}, "user_id": user["email"]},
            {"$set": {"custom_category": category}},
        )
        bulk_count = result.modified_count

    return {"updated": transaction_id, "custom_category": category, "bulk_count": bulk_count}


@router.patch("/transactions/{transaction_id}/planned")
async def set_transaction_planned(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    planned = bool(body.get("planned", True))
    result  = await transactions_col.update_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"$set": {"planned": planned}},
    )
    if result.matched_count == 0:
        await yapily_transactions_col.update_one(
            {"_id": transaction_id, "user_id": user["email"]},
            {"$set": {"planned": planned}},
        )
    return {"updated": transaction_id, "planned": planned}


@router.post("/transactions/auto-categorise")
async def auto_categorise(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: dict = Depends(current_user),
):
    uid = user["email"]
    await transactions_col.update_many(
        {"user_id": uid, "category": "Other", "custom_category": None, "ai_attempted": True},
        {"$unset": {"ai_attempted": ""}},
    )
    rules_fixed = await apply_rules_bulk(uid, structural=True)

    try:
        start_dt = datetime.fromisoformat(from_date) if from_date else None
        end_dt   = datetime.fromisoformat(to_date)   if to_date   else None
    except ValueError as e:
        raise HTTPException(400, f"Invalid date format: {e}")

    date_filter: dict = {}
    if start_dt:
        date_filter["$gte"] = start_dt
    if end_dt:
        date_filter["$lte"] = end_dt

    query: dict = {
        "user_id": uid, "custom_category": None,
        "$or": [
            {"category": None}, {"category": "Other"},
            {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}},
        ],
    }
    if date_filter:
        query["date"] = date_filter

    uncategorised = await transactions_col.find(query).to_list(1000)
    if not uncategorised:
        return {"rules_fixed": rules_fixed, "ai_categorised": 0}

    historical = await transactions_col.find(
        {"user_id": uid,
         "$or": [{"custom_category": {"$ne": None}},
                 {"category": {"$nin": list(RAW_TRUELAYER_CATEGORIES) + [None]}}]},
        {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1, "transaction_type": 1},
    ).to_list(None)

    merchant_map: dict[tuple[str, str], str] = {}
    for h in historical:
        cat = h.get("custom_category") or h.get("category")
        if not cat or cat in RAW_TRUELAYER_CATEGORIES:
            continue
        txn_type = h.get("transaction_type", "")
        for key in [h.get("merchant_name"), h.get("description")]:
            if key:
                norm    = re.sub(r'\s+', ' ', key.strip().lower())
                map_key = (norm, txn_type)
                if norm and map_key not in merchant_map:
                    merchant_map[map_key] = cat

    needs_ai: list = []
    history_matched = 0
    for t in uncategorised:
        txn_type = t.get("transaction_type", "")
        matched  = None
        for key in [t.get("merchant_name"), t.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                if (norm, txn_type) in merchant_map:
                    matched = merchant_map[(norm, txn_type)]
                    break
        if matched:
            await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": matched}})
            history_matched += 1
        else:
            needs_ai.append(t)

    if not needs_ai or not OPENROUTER_API_KEY:
        return {"rules_fixed": rules_fixed, "history_matched": history_matched, "ai_categorised": 0}

    manual = await transactions_col.find(
        {"user_id": uid, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1, "custom_category": 1},
    ).limit(50).to_list(50)
    example_block = ""
    if manual:
        lines_ex = "\n".join(
            f'  "{(e.get("merchant_name") or e.get("description", ""))[:50]}" → {e["custom_category"]}'
            for e in manual
        )
        example_block = f"User-confirmed examples (follow these patterns):\n{lines_ex}\n\n"

    unknown_merchants = list({
        name for t in needs_ai
        if (name := (t.get("merchant_name") or "").strip()) and 2 < len(name) < 50
        and not re.search(r'\d{6,}', name)
    })
    tavily_info = await tavily_lookup_merchants(unknown_merchants) if TAVILY_API_KEY else {}

    ai_total = 0
    for i in range(0, len(needs_ai), 30):
        batch = needs_ai[i:i + 30]
        lines = "\n".join(
            f'{j}: merchant="{t.get("merchant_name") or ""}" '
            f'desc="{t.get("description", "")[:80]}" '
            f'amount=£{t["amount"]:.2f} type={t.get("transaction_type", "debit")}'
            + (f' [web: {tavily_info[t.get("merchant_name") or t.get("description", "")][:120]}]'
               if (t.get("merchant_name") or t.get("description", "")) in tavily_info else "")
            for j, t in enumerate(batch)
        )
        prompt = (
            f"You are an expert UK personal finance categoriser. "
            f"Assign each transaction to exactly one category from this list: {', '.join(VALID_CATEGORIES)}.\n\n"
            f"Rules:\n"
            f"- Use the merchant name and description to determine WHAT the business/service is.\n"
            f"- Ignore payment method words (direct debit, standing order, purchase, faster payment, BACS).\n"
            f"- '[web: ...]' entries contain a web search result about the merchant.\n"
            f"- 'Other' is a last resort.\n"
            f"- Credits to a current account are usually 'Income' or 'Transfer'.\n"
            f"- UK-specific: Monzo pots, Starling spaces, Marcus savings = 'Savings'; Amex/Barclaycard payments = 'Debt'.\n\n"
            f"Reply with ONLY a JSON object mapping index to category, e.g. {{\"0\": \"Groceries\", \"1\": \"Transport\"}}.\n\n"
            f"{example_block}Transactions:\n{lines}"
        )
        try:
            async with httpx.AsyncClient(timeout=45) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                             "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
                    json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 600,
                          "messages": [{"role": "user", "content": prompt}]},
                )
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                m = re.search(r"\{.*\}", content, re.DOTALL)
                if m:
                    mapping = json.loads(m.group())
                    for k, cat in mapping.items():
                        if k.isdigit() and int(k) < len(batch):
                            final_cat = cat if cat in VALID_CATEGORIES else "Other"
                            await transactions_col.update_one(
                                {"_id": batch[int(k)]["_id"]}, {"$set": {"category": final_cat}}
                            )
                            ai_total += 1
            for t in batch:
                doc = await transactions_col.find_one(
                    {"_id": t["_id"], "$or": [{"category": None},
                     {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}}]}, {"_id": 1}
                )
                if doc:
                    await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": "Other"}})
        except Exception:
            for t in batch:
                await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": "Other"}})

    return {"rules_fixed": rules_fixed, "history_matched": history_matched, "ai_categorised": ai_total}
