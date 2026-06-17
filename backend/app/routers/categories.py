"""Categories and categorisation rules endpoints."""
import asyncio
import re
import uuid as uuid_lib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
import httpx

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.db.collections import user_categories_col, user_rules_col
from app.services.categorisation import apply_rules_bulk

router = APIRouter(tags=["categories"])

BUILTIN_CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment", "Shopping",
    "Bills", "Subscriptions", "Health", "Travel", "Software",
    "Savings", "Debt", "Transfer", "Income", "Cash", "Charity", "Other",
]


def _clean_custom(raw: list) -> list:
    return [c for c in raw if c not in BUILTIN_CATEGORIES]


@router.get("/categories")
async def get_categories(user: dict = Depends(current_user)):
    doc    = await user_categories_col.find_one({"user_id": user["email"]})
    custom = _clean_custom(doc.get("categories", []) if doc else [])
    return {"builtin": BUILTIN_CATEGORIES, "custom": custom, "all": BUILTIN_CATEGORIES + custom}


@router.post("/categories")
async def add_category(body: dict, user: dict = Depends(current_user)):
    name = body.get("name", "").strip()
    if not name or len(name) > 40:
        raise HTTPException(400, "Invalid category name")
    if name in BUILTIN_CATEGORIES:
        raise HTTPException(400, "That's a built-in category")
    await user_categories_col.update_one(
        {"user_id": user["email"]},
        {"$addToSet": {"categories": name}, "$setOnInsert": {"user_id": user["email"]}},
        upsert=True,
    )
    doc    = await user_categories_col.find_one({"user_id": user["email"]})
    custom = _clean_custom(doc.get("categories", []) if doc else [])
    return {"builtin": BUILTIN_CATEGORIES, "custom": custom, "all": BUILTIN_CATEGORIES + custom}


@router.delete("/categories/{name}")
async def delete_category(name: str, user: dict = Depends(current_user)):
    await user_categories_col.update_one(
        {"user_id": user["email"]}, {"$pull": {"categories": name}}
    )
    if name in BUILTIN_CATEGORIES:
        raise HTTPException(400, "Cannot delete built-in categories")
    return {"deleted": name}


@router.get("/rules")
async def get_rules(user: dict = Depends(current_user)):
    uid  = user["email"]
    docs = await user_rules_col.find({"uid": uid}).sort("created_at", -1).to_list(None)
    return {"rules": [
        {"id": str(d["_id"]), "description": d["description"],
         "pattern": d["pattern"], "category": d["category"],
         "created_at": d["created_at"].isoformat()}
        for d in docs
    ]}


@router.post("/rules/parse")
async def parse_rule(body: dict, user: dict = Depends(current_user)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "No text provided")
    doc    = await user_categories_col.find_one({"user_id": user["email"]})
    custom = doc.get("categories", []) if doc else []
    all_cats = BUILTIN_CATEGORIES + custom
    prompt = (
        f"Extract a transaction categorisation rule from this instruction: \"{text}\"\n"
        f"Available categories: {', '.join(all_cats)}\n"
        f"Return ONLY JSON: {{\"pattern\": \"<simple regex>\", \"category\": \"<exact category name>\"}}\n"
        f"The pattern should be a lowercase regex that matches the merchant name or description.\n"
        f"If you cannot extract a valid rule, return: {{\"error\": \"reason\"}}"
    )
    if not OPENROUTER_API_KEY:
        raise HTTPException(503, "AI not configured")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                     "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
            json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 100,
                  "messages": [{"role": "user", "content": prompt}]},
        )
    if r.status_code != 200:
        raise HTTPException(502, "AI request failed")
    content = r.json()["choices"][0]["message"]["content"]
    import json as _json
    m = re.search(r"\{.*\}", content, re.DOTALL)
    if not m:
        raise HTTPException(422, "Could not parse rule")
    parsed = _json.loads(m.group())
    if "error" in parsed:
        raise HTTPException(422, parsed["error"])
    if parsed.get("category") not in all_cats:
        raise HTTPException(422, f"Unknown category: {parsed.get('category')}")
    try:
        re.compile(parsed["pattern"])
    except re.error:
        raise HTTPException(422, "Invalid pattern generated")
    return {"pattern": parsed["pattern"], "category": parsed["category"]}


@router.post("/rules")
async def add_rule(body: dict, user: dict = Depends(current_user)):
    uid         = user["email"]
    description = (body.get("description") or "").strip()
    pattern     = (body.get("pattern") or "").strip()
    category    = (body.get("category") or "").strip()
    if not description or not pattern or not category:
        raise HTTPException(400, "description, pattern and category are required")
    doc    = await user_categories_col.find_one({"user_id": uid})
    custom = doc.get("categories", []) if doc else []
    if category not in BUILTIN_CATEGORIES + custom:
        raise HTTPException(400, "Invalid category")
    try:
        re.compile(pattern)
    except re.error:
        raise HTTPException(400, "Invalid regex pattern")
    rule_id = str(uuid_lib.uuid4())
    await user_rules_col.insert_one({
        "_id": rule_id, "uid": uid, "description": description,
        "pattern": pattern.lower(), "category": category,
        "created_at": datetime.utcnow(),
    })
    asyncio.create_task(apply_rules_bulk(uid))
    return {"id": rule_id, "description": description, "pattern": pattern.lower(), "category": category}


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(current_user)):
    result = await user_rules_col.delete_one({"_id": rule_id, "uid": user["email"]})
    if result.deleted_count == 0:
        raise HTTPException(404, "Rule not found")
    return {"deleted": rule_id}
