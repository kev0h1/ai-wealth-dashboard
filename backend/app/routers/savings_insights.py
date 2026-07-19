"""Savings insights endpoints."""
import asyncio
import hashlib
import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, TAVILY_API_KEY, APP_URL
from app.core.subscription import Tier, require_tier
from app.db.collections import (
    savings_insights_col, savings_labels_col,
    transactions_col, yapily_transactions_col,
    mono_transactions_col, statement_transactions_col,
    preferences_col,
)

router = APIRouter(tags=["savings_insights"])

INSIGHT_CATEGORIES: dict[str, dict] = {
    "energy": {
        "icon": "⚡", "label": "Energy",
        "query": "best energy tariff switch UK 2025 cheapest deals save money",
        "triggers": ["british gas", "eon ", "edf", "scottish power", "octopus energy", "npower", "sse ", "bulb energy", "shell energy", "utilita", "utility warehouse", "bg energy"],
    },
    "mortgage": {
        "icon": "🏠", "label": "Mortgage",
        "query": "best mortgage remortgage deals UK 2025 lowest fixed rate switch lender",
        "triggers": ["mortgage", "nationwide", "halifax", "santander mortgage", "barclays mortgage", "lloyds mortgage", "natwest mortgage", "hsbc mortgage", "virgin money mortgage", "mortg"],
    },
    "car_finance": {
        "icon": "🚘", "label": "Car Finance",
        "query": "refinance car loan UK 2025 best rate save money PCP HP alternatives",
        "triggers": ["black horse", "close brothers", "moneybarn", "evolution funding", "motonovo", "car loan", "car finance", "hire purchase", "santander consumer", "toyota finance", "volkswagen finance"],
    },
    "car_insurance": {
        "icon": "🚗", "label": "Car Insurance",
        "query": "cheapest car insurance deals UK 2025 comparison save",
        "triggers": ["direct line", "admiral", "aviva", "hastings direct", "churchill", "more than", "lv= ", "esure", "elephant auto"],
    },
    "broadband": {
        "icon": "📡", "label": "Broadband",
        "query": "best broadband deals UK 2025 switch provider save money",
        "triggers": ["bt ", "bt group", "virgin media", "sky broadband", "talktalk", "vodafone broadband", "now broadband", "plusnet", "community fibre", "hyperoptic"],
    },
    "mobile": {
        "icon": "📱", "label": "Mobile",
        "query": "best SIM only mobile plan UK 2025 cheapest deal",
        "triggers": ["ee ltd", "ee limited", "ee ", "o2 ", "vodafone", "three ", "giffgaff", "sky mobile", "tesco mobile", "id mobile", "lycamobile"],
    },
    "groceries": {
        "icon": "🛒", "label": "Groceries",
        "query": "cheapest UK supermarket comparison 2025 where to shop save groceries",
        "triggers": ["tesco", "sainsbury", "asda", "morrisons", "waitrose", "lidl", "aldi", "co-op", "marks and spencer food", "ocado", "m&s food"],
    },
    "eating_out": {
        "icon": "🍽️", "label": "Eating Out",
        "query": "restaurant dining offers discounts UK 2025 deals save money eating out",
        "triggers": ["restaurant", "mcdonald", "kfc", "nando", "wagamama", "pizza express", "prezzo", "costa coffee", "starbucks", "pret a manger", "itsu", "leon ", "subway"],
    },
    "gym": {
        "icon": "💪", "label": "Gym",
        "query": "best value gym membership UK 2025 cheapest monthly no contract",
        "triggers": ["pure gym", "the gym group", "david lloyd", "virgin active", "anytime fitness", "nuffield health", "fitness first", "bannatyne", "everyone active"],
    },
    "subscriptions": {
        "icon": "📺", "label": "Subscriptions",
        "query": "how to save on streaming subscriptions UK 2025 cheaper alternatives deals",
        "triggers": ["netflix", "spotify", "amazon prime", "disney+", "disney plus", "apple tv", "youtube premium", "now tv", "sky entertainment", "paramount+", "apple music"],
    },
}

LABEL_OPTIONS: dict[str, dict] = {
    **{k: {"icon": v["icon"], "label": v["label"]} for k, v in INSIGHT_CATEGORIES.items()},
    "home_insurance": {"icon": "🛡️", "label": "Home Insurance"},
    "life_insurance": {"icon": "❤️",  "label": "Life Insurance"},
    "council_tax":    {"icon": "🏛️",  "label": "Council Tax"},
    "water":          {"icon": "💧",  "label": "Water"},
    "tv_licence":     {"icon": "📻",  "label": "TV Licence"},
    "pension":        {"icon": "🏦",  "label": "Pension/Savings"},
}

CATEGORY_WORKFLOWS: dict[str, dict] = {
    "mortgage": {
        "cta": "Add your mortgage details",
        "steps": [
            {"id": "type",           "label": "Mortgage type",            "type": "select", "options": ["Fixed Rate", "Tracker", "Variable/SVR", "Interest Only", "Not sure"]},
            {"id": "rate",           "label": "Current interest rate",    "type": "number", "placeholder": "e.g. 4.5", "unit": "%"},
            {"id": "outstanding",    "label": "Amount outstanding",       "type": "currency", "placeholder": "e.g. 250000"},
            {"id": "deal_end",       "label": "When does your deal end?", "type": "text",   "placeholder": "e.g. March 2027"},
            {"id": "term_remaining", "label": "Years remaining",          "type": "number", "placeholder": "e.g. 22", "unit": "yrs"},
        ],
    },
    "car_finance": {
        "cta": "Add your finance details",
        "steps": [
            {"id": "type",             "label": "Finance type",        "type": "select", "options": ["Personal Loan", "PCP", "Hire Purchase (HP)", "Lease/PCH", "Not sure"]},
            {"id": "rate",             "label": "Interest rate / APR", "type": "number", "placeholder": "e.g. 6.9", "unit": "%"},
            {"id": "outstanding",      "label": "Amount outstanding",  "type": "currency", "placeholder": "e.g. 8000"},
            {"id": "months_remaining", "label": "Months remaining",    "type": "number", "placeholder": "e.g. 36", "unit": "mo"},
        ],
    },
    "energy": {
        "cta": "Add your energy details",
        "steps": [
            {"id": "tariff_type", "label": "Tariff type",             "type": "select", "options": ["Fixed Rate", "Variable/SVR", "Not sure"]},
            {"id": "deal_end",    "label": "When does your deal end?", "type": "text",  "placeholder": "e.g. Oct 2026 or Rolling"},
        ],
    },
    "broadband": {
        "cta": "Add your broadband details",
        "steps": [
            {"id": "contract_end", "label": "Contract end date", "type": "text",   "placeholder": "e.g. Aug 2026 or Rolling"},
            {"id": "speed",        "label": "Download speed",    "type": "select", "options": ["Under 50 Mbps", "50–100 Mbps", "100–500 Mbps", "500 Mbps+", "Not sure"]},
        ],
    },
    "mobile": {
        "cta": "Add your plan details",
        "steps": [
            {"id": "contract_end", "label": "Contract end date",  "type": "text",   "placeholder": "e.g. Dec 2026 or Rolling"},
            {"id": "data",         "label": "Monthly data usage", "type": "select", "options": ["Under 5 GB", "5–20 GB", "20–50 GB", "50 GB+", "Unlimited"]},
        ],
    },
    "car_insurance": {
        "cta": "Add your insurance details",
        "steps": [
            {"id": "renewal_date", "label": "Renewal date", "type": "text", "placeholder": "e.g. September 2026"},
        ],
    },
    "gym": {
        "cta": "Add your gym details",
        "steps": [
            {"id": "gym_name", "label": "Which gym?",    "type": "text",   "placeholder": "e.g. David Lloyd"},
            {"id": "contract", "label": "Contract type", "type": "select", "options": ["Monthly rolling", "3-month", "6-month", "12-month", "Not sure"]},
        ],
    },
    "subscriptions": {
        "cta": "Tell us about your subscriptions",
        "steps": [
            {"id": "services", "label": "Which services do you subscribe to?", "type": "text", "placeholder": "e.g. Netflix, Spotify, Disney+"},
        ],
    },
    "groceries": {
        "cta": "Add your shopping habits",
        "steps": [
            {"id": "main_supermarket", "label": "Where do you mostly shop?", "type": "select", "options": ["Tesco", "Sainsbury's", "ASDA", "Morrisons", "Waitrose", "M&S", "Lidl", "Aldi", "Mix of stores"]},
        ],
    },
    "eating_out": {
        "cta": "Add your dining habits",
        "steps": [
            {"id": "frequency", "label": "How often do you eat out?", "type": "select", "options": ["Daily", "2–3× per week", "Once a week", "Few times a month", "Rarely"]},
        ],
    },
}

BILL_CATEGORIES = {"bills", "housing", "utilities", "insurance"}
_ALL_TRIGGERS: set[str] = {t for cfg in INSIGHT_CATEGORIES.values() for t in cfg.get("triggers", [])}


async def _detect_insight_categories(user_id: str) -> list[str]:
    cutoff    = datetime.utcnow() - timedelta(days=90)
    pipelines = [
        transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
        yapily_transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
        mono_transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
        statement_transactions_col.find({"user_id": user_id, "date": {"$gte": cutoff}}, {"merchant_name": 1, "description": 1, "category": 1}).to_list(None),
    ]
    all_lists = await asyncio.gather(*pipelines, return_exceptions=True)

    text_parts = []
    for lst in all_lists:
        if isinstance(lst, list):
            for t in lst:
                text_parts.append(f"{t.get('merchant_name', '')} {t.get('description', '')} {t.get('category', '')}".lower())
    all_text = " ".join(text_parts)

    detected = [k for k, cfg in INSIGHT_CATEGORIES.items() if any(trigger in all_text for trigger in cfg["triggers"])]

    labels = await savings_labels_col.find(
        {"user_id": user_id, "category": {"$in": list(INSIGHT_CATEGORIES.keys())}}
    ).to_list(None)
    for lbl in labels:
        if lbl["category"] not in detected:
            detected.append(lbl["category"])

    return detected


async def _find_triggered_transactions(user_id: str, category_key: str) -> list[dict]:
    cfg = INSIGHT_CATEGORIES.get(category_key)
    if not cfg:
        return []
    cutoff = datetime.utcnow() - timedelta(days=90)

    label       = await savings_labels_col.find_one({"user_id": user_id, "category": category_key})
    labelled_key = label["merchant_key"] if label else None

    buckets: dict[str, list[float]] = defaultdict(list)
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col, mono_transactions_col]:
        try:
            txns = await col.find(
                {"user_id": user_id, "date": {"$gte": cutoff}, "transaction_type": "debit"},
                {"merchant_name": 1, "description": 1, "amount": 1},
            ).to_list(None)
        except Exception:
            continue
        for t in txns:
            key       = (t.get("merchant_name") or t.get("description", "")[:30]).strip()
            if not key:
                continue
            key_lower = key.lower()
            if (labelled_key and key == labelled_key) or any(tr in key_lower for tr in cfg.get("triggers", [])):
                buckets[key].append(float(t.get("amount", 0)))

    result = []
    for key, amounts in sorted(buckets.items(), key=lambda x: -sum(x[1])):
        result.append({
            "merchant_key": key, "display_name": key.title(),
            "monthly_amount": round(sum(amounts) / 3, 2), "occurrences": len(amounts),
        })
        if len(result) >= 4:
            break
    return result


async def _generate_savings_insight_content(category_key: str, user_context: Optional[dict] = None) -> Optional[dict]:
    cfg          = INSIGHT_CATEGORIES[category_key]
    today_label  = datetime.utcnow().strftime("%B %Y")
    web_snippets: list[str] = []

    if TAVILY_API_KEY:
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": TAVILY_API_KEY, "query": f"{cfg['query']} {today_label}",
                          "search_depth": "basic", "max_results": 3, "include_answer": True},
                )
                if r.status_code == 200:
                    data = r.json()
                    if data.get("answer"):
                        web_snippets.append(data["answer"][:500])
                    for res in (data.get("results") or [])[:2]:
                        snippet = res.get("content", "")[:250]
                        if snippet:
                            web_snippets.append(snippet)
            except Exception:
                pass

    if not web_snippets or not OPENROUTER_API_KEY:
        return None

    web_text = "\n\n".join(web_snippets)
    if user_context:
        ctx_lines = "\n".join(f"- {k.replace('_', ' ').title()}: {v}" for k, v in user_context.items() if v)
        prompt    = (
            f"Today is {today_label}. Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            f"The user's current {cfg['label'].lower()} situation:\n{ctx_lines}\n\n"
            "Write a HIGHLY PERSONALISED savings insight. Reference their specific rate, provider, amount or end date where relevant. "
            "Give concrete next steps they should take right now. "
            "Never present a past month or year as the current one; if the search results are dated, omit the date rather than repeating it.\n"
            "JSON: title (max 8 words, specific to their situation), "
            "body (2–3 sentences, direct advice referencing their details), "
            "savings_estimate (calculate from their numbers if possible, else null)\n\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"..."}'
        )
    else:
        prompt = (
            f"Today is {today_label}. Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            "Write a concise savings insight card in JSON with three fields:\n"
            "- title: max 8 words, punchy, present tense\n"
            "- body: 1–2 sentences, specific deal or tip, no filler. "
            "Never present a past month or year as the current one; if the search results are dated, omit the date.\n"
            "- savings_estimate: e.g. 'Up to £200/yr' or 'Save 30%' if clearly stated, else null\n\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"..."}'
        )

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": APP_URL},
                json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 200,
                      "messages": [{"role": "user", "content": prompt}],
                      "response_format": {"type": "json_object"}},
            )
            if r.status_code == 200:
                raw = r.json()["choices"][0]["message"]["content"].strip()
                if raw.startswith("```"):
                    raw = re.sub(r'^```(?:json)?\s*', '', raw)
                    raw = re.sub(r'\s*```$', '', raw).strip()
                parsed = json.loads(raw)
                return {
                    "title": str(parsed.get("title", cfg["label"])),
                    "body":  str(parsed.get("body", "")),
                    "savings_estimate": parsed.get("savings_estimate") or None,
                }
        except Exception:
            pass
    return None


async def _refresh_single_insight(user_id: str, category_key: str, user_context: Optional[dict] = None) -> None:
    cfg = INSIGHT_CATEGORIES.get(category_key)
    if not cfg:
        return
    if user_context is None:
        existing_doc = await savings_insights_col.find_one({"user_id": user_id, "category": category_key})
        user_context = existing_doc.get("user_context") if existing_doc else None
    content = await _generate_savings_insight_content(category_key, user_context)
    if not content or not content.get("body"):
        return
    triggered_by   = await _find_triggered_transactions(user_id, category_key)
    title          = content["title"]
    body_text      = content["body"]
    savings_estimate = content.get("savings_estimate")
    content_hash   = hashlib.md5(f"{title}{body_text}".encode()).hexdigest()
    now            = datetime.utcnow()
    existing       = await savings_insights_col.find_one({"user_id": user_id, "category": category_key})
    is_new         = not existing or existing.get("content_hash") != content_hash
    base_update: dict = {
        "title": title, "body": body_text, "savings_estimate": savings_estimate,
        "triggered_by": triggered_by, "refreshed_at": now,
        "content_hash": content_hash, "is_new": is_new,
        "deadline_at": _parse_deadline(user_context),
        "deadline_flagged": False,  # fresh context resets the one-shot deadline alert
    }
    if user_context is not None:
        base_update["user_context"] = user_context
    if existing:
        if not existing.get("pinned"):
            base_update["expires_at"] = now + timedelta(days=30)
        await savings_insights_col.update_one({"_id": existing["_id"]}, {"$set": base_update})
    else:
        insight_id = f"{category_key}-{hashlib.md5(user_id.encode()).hexdigest()[:8]}"
        await savings_insights_col.insert_one({
            "insight_id": insight_id, "user_id": user_id, "category": category_key,
            "icon": cfg["icon"], "label": cfg["label"], "pinned": False,
            "created_at": now, "expires_at": now + timedelta(days=30), **base_update,
        })


async def _refresh_savings_insights_for_user(user_id: str) -> None:
    applicable = await _detect_insight_categories(user_id)
    for cat in ("energy", "groceries"):
        if cat not in applicable:
            applicable.append(cat)

    for cat_key in applicable:
        cfg = INSIGHT_CATEGORIES.get(cat_key)
        if not cfg:
            continue
        existing = await savings_insights_col.find_one({"user_id": user_id, "category": cat_key})
        if existing and existing.get("refreshed_at"):
            age_days = (datetime.utcnow() - existing["refreshed_at"]).days
            if age_days < 7:
                continue

        # Triggers are cheap — compute first and only pay for search + LLM
        # when something material changed. Rephrasing on a timer is what made
        # the badge cry wolf.
        triggered_by = await _find_triggered_transactions(user_id, cat_key)

        # Closure: if the triggering spend ceased, mark the win and retire the
        # card from advice duty — it flips to "done, saving £X/mo"
        if existing:
            verified = await _check_verified_saving(user_id, existing)
            if verified:
                await savings_insights_col.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {**verified, "spotlight_retired": True, "is_new": False}},
                )
                continue

        reason = _regen_reason(existing, triggered_by, datetime.utcnow())
        if reason is None:
            await savings_insights_col.update_one(
                {"_id": existing["_id"]},
                {"$set": {"triggered_by": triggered_by, "is_new": False}},
            )
            continue

        stored_context = existing.get("user_context") if existing else None
        content        = await _generate_savings_insight_content(cat_key, stored_context)
        if not content or not content.get("body"):
            continue
        title          = content["title"]
        body           = content["body"]
        savings_estimate = content.get("savings_estimate")
        content_hash   = hashlib.md5(f"{title}{body}".encode()).hexdigest()
        now            = datetime.utcnow()
        is_new         = not existing or existing.get("content_hash") != content_hash

        if existing:
            update: dict = {
                "title": title, "body": body, "savings_estimate": savings_estimate,
                "triggered_by": triggered_by, "refreshed_at": now,
                "content_hash": content_hash, "is_new": is_new,
                "deadline_at": _parse_deadline(stored_context),
                "deadline_flagged": reason == "deadline_window" or bool(existing.get("deadline_flagged")),
            }
            if not existing.get("pinned"):
                update["expires_at"] = now + timedelta(days=30)
            await savings_insights_col.update_one({"_id": existing["_id"]}, {"$set": update})
        else:
            insight_id = f"{cat_key}-{hashlib.md5(user_id.encode()).hexdigest()[:8]}"
            await savings_insights_col.insert_one({
                "insight_id": insight_id, "user_id": user_id, "category": cat_key,
                "icon": cfg["icon"], "label": cfg["label"],
                "title": title, "body": body, "savings_estimate": savings_estimate,
                "triggered_by": triggered_by, "pinned": False, "created_at": now,
                "refreshed_at": now, "expires_at": now + timedelta(days=30),
                "content_hash": content_hash, "is_new": True,
            })


def _serialize_insight(d: dict) -> dict:
    return {
        "id":              d.get("insight_id", str(d["_id"])),
        "category":        d["category"],
        "icon":            d.get("icon", "💡"),
        "label":           d.get("label", d["category"].replace("_", " ").title()),
        "title":           d.get("title", ""),
        "body":            d.get("body", ""),
        "savings_estimate": d.get("savings_estimate"),
        "pinned":          d.get("pinned", False),
        "is_new":          d.get("is_new", False),
        # Stored naive-UTC; the Z suffix makes browsers parse it as UTC, not local
        "refreshed_at":    d["refreshed_at"].isoformat() + "Z" if d.get("refreshed_at") else None,
        "return_reason":   d.get("_return_reason"),
        "verified_savings": d.get("verified_savings"),
        "verified_merchant": d.get("verified_merchant"),
        "deadline_at":     d["deadline_at"].isoformat() + "Z" if d.get("deadline_at") else None,
        "triggered_by":    d.get("triggered_by", []),
        "user_context":    d.get("user_context"),
        "has_workflow":    d["category"] in CATEGORY_WORKFLOWS,
    }


_DEADLINE_KEYS = ("deal_end", "contract_end", "renewal_date")
_MONTHS_MAP = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def _parse_deadline(context: dict | None) -> Optional[datetime]:
    """Extract a hard end date from user-provided context text like
    'March 2027', 'Oct 26', '2027-03'. Rolling/unsure/blank → None."""
    if not context:
        return None
    for key in _DEADLINE_KEYS:
        raw = str(context.get(key) or "").strip().lower()
        if not raw or "roll" in raw or "not sure" in raw:
            continue
        m = re.search(r"(20\d{2})[-/](\d{1,2})", raw)  # 2027-03 / 2027/3
        if m:
            year, month = int(m.group(1)), int(m.group(2))
        else:
            m = re.search(r"([a-z]{3,9})\s*'?(\d{2,4})", raw)  # march 2027 / oct 26
            if not m or m.group(1)[:3] not in _MONTHS_MAP:
                continue
            month = _MONTHS_MAP[m.group(1)[:3]]
            year  = int(m.group(2))
            if year < 100:
                year += 2000
        if not (1 <= month <= 12 and 2020 <= year <= 2100):
            continue
        return datetime(year, month, monthrange(year, month)[1])
    return None


def _material_change_reason(d: dict) -> Optional[str]:
    """Why a dismissed insight has earned its way back, or None if it hasn't."""
    from app.routers.analytics import _parse_saving_amount

    deadline = d.get("deadline_at")
    if deadline and datetime.utcnow() < deadline <= datetime.utcnow() + timedelta(days=60):
        return f"Your deal ends around {deadline.strftime('%b %Y')}"

    old = d.get("estimate_at_dismissal")
    new = _parse_saving_amount(d.get("savings_estimate"))
    if old and new and abs(new - old) >= max(10.0, 0.2 * old):
        direction = "up" if new > old else "down"
        return f"Estimated saving {direction}: ~£{old:,.0f}/mo → ~£{new:,.0f}/mo"

    dismissed = d.get("spotlight_dismissed_at")
    if dismissed is None or dismissed < datetime.utcnow() - timedelta(days=30):
        return ""  # cooldown expired — eligible again, no callout needed
    return None


async def _check_verified_saving(user_id: str, existing: dict) -> Optional[dict]:
    """Has the user actually acted on this insight? If the merchant that
    triggered it had payments in the 45-90 day window but NONE in the last 45
    days, the spend genuinely ceased — that's a verified saving, not an estimate."""
    if existing.get("verified_at"):
        return None  # already verified
    prev = existing.get("triggered_by") or []
    if not prev:
        return None
    top = prev[0]
    key, amt = top.get("merchant_key"), float(top.get("monthly_amount") or 0)
    if not key or amt < 5:
        return None
    now = datetime.utcnow()
    recent, before = 0, 0
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col, mono_transactions_col]:
        try:
            txns = await col.find(
                {"user_id": user_id, "transaction_type": "debit", "date": {"$gte": now - timedelta(days=90)}},
                {"merchant_name": 1, "description": 1, "date": 1},
            ).to_list(None)
        except Exception:
            continue
        for t in txns:
            k = (t.get("merchant_name") or t.get("description", "")[:30]).strip()
            if k != key:
                continue
            if t["date"] >= now - timedelta(days=45):
                recent += 1
            else:
                before += 1
    if before > 0 and recent == 0:
        return {"verified_savings": round(amt, 2), "verified_merchant": top.get("display_name", key),
                "verified_at": now}
    return None


def _regen_reason(existing: dict | None, triggered_by: list[dict], now: datetime) -> Optional[str]:
    """Event-driven regeneration: return why content should be rebuilt, or None.

    Material events: no insight yet, 30-day TTL, trigger spend moved ≥20%/£10,
    or a user-entered deadline entered the 60-day window (once)."""
    if not existing or not existing.get("refreshed_at"):
        return "first_generation"
    if (now - existing["refreshed_at"]).days >= 30:
        return "ttl"
    old_total = sum(t.get("monthly_amount", 0) for t in existing.get("triggered_by") or [])
    new_total = sum(t.get("monthly_amount", 0) for t in triggered_by)
    if old_total > 0 and abs(new_total - old_total) >= max(10.0, 0.2 * old_total):
        return "spend_changed"
    if old_total == 0 and new_total > 0:
        return "spend_appeared"
    deadline = existing.get("deadline_at")
    if deadline and now < deadline <= now + timedelta(days=60) and not existing.get("deadline_flagged"):
        return "deadline_window"
    return None


def _spotlight_snoozed(d: dict) -> bool:
    until = d.get("spotlight_snoozed_until")
    return bool(until and until > datetime.utcnow())


def _spotlight_candidates(docs: list[dict]) -> list[dict]:
    """Insights eligible for the home spotlight, ranked pinned-first then freshest.

    Dismissal is durable: a retired insight only returns after a 30-day
    cooldown, or earlier when something material changed (estimate moved
    ≥20%/£10, or a user-provided deadline is inside 60 days) — and then it
    carries the reason so the card can say why it's back."""
    cands = []
    for d in docs:
        if _spotlight_snoozed(d):
            continue
        if not d.get("spotlight_retired"):
            d["_return_reason"] = None
            cands.append(d)
            continue
        reason = _material_change_reason(d)
        if reason is not None:
            d["_return_reason"] = reason or None
            cands.append(d)
    cands.sort(
        key=lambda d: (bool(d.get("pinned")), bool(d.get("_return_reason")), d.get("refreshed_at") or datetime.min),
        reverse=True,
    )
    return cands


@router.get("/savings-insights")
async def get_savings_insights(user: dict = Depends(current_user), _sub=Depends(require_tier(Tier.PRO))):
    uid  = user["email"]
    docs = await savings_insights_col.find({"user_id": uid}).sort([("pinned", -1), ("refreshed_at", -1)]).to_list(None)

    results = []
    for d in docs:
        if not d.get("triggered_by"):
            triggered_by = await _find_triggered_transactions(uid, d["category"])
            if triggered_by:
                await savings_insights_col.update_one({"_id": d["_id"]}, {"$set": {"triggered_by": triggered_by}})
                d["triggered_by"] = triggered_by
        results.append(_serialize_insight(d))
    return results


@router.get("/savings-insights/spotlight")
async def get_spotlight_insight(user: dict = Depends(current_user), _sub=Depends(require_tier(Tier.PRO))):
    """The single insight to feature on the home screen, or null.

    Applies supersession: if the insight shown last time has been replaced by a
    different top insight, the old one is retired permanently so it never returns.
    """
    uid  = user["email"]
    docs = await savings_insights_col.find({"user_id": uid}).to_list(None)
    cands = _spotlight_candidates(docs)
    if not cands:
        return None
    top    = cands[0]
    top_id = top.get("insight_id", str(top["_id"]))

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    last  = prefs.get("spotlight_last_shown")
    if last and last != top_id:
        prev = next((d for d in docs if d.get("insight_id") == last), None)
        if prev is not None and not prev.get("spotlight_retired"):
            from app.routers.analytics import _parse_saving_amount
            await savings_insights_col.update_one(
                {"_id": prev["_id"]},
                {"$set": {
                    "spotlight_retired": True,
                    "spotlight_dismissed_at": datetime.utcnow(),
                    "estimate_at_dismissal": _parse_saving_amount(prev.get("savings_estimate")) or None,
                }, "$unset": {"spotlight_snoozed_until": ""}},
            )
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {"user_id": uid, "spotlight_last_shown": top_id}},
        upsert=True,
    )
    return _serialize_insight(top)


@router.post("/savings-insights/{insight_id}/dismiss")
async def dismiss_spotlight_insight(insight_id: str, user: dict = Depends(current_user)):
    """Dismiss an insight from the home spotlight.

    Durable: 30-day cooldown regardless of content regeneration. Snapshots the
    current estimate so a material change can earn an early return."""
    uid = user["email"]
    doc = await savings_insights_col.find_one({"user_id": uid, "insight_id": insight_id})
    if not doc:
        raise HTTPException(404, "Insight not found")

    from app.routers.analytics import _parse_saving_amount
    await savings_insights_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "spotlight_retired": True,
            "spotlight_dismissed_at": datetime.utcnow(),
            "estimate_at_dismissal": _parse_saving_amount(doc.get("savings_estimate")) or None,
        }, "$unset": {"spotlight_snoozed_until": ""}},
    )
    return {"status": "retired"}


@router.get("/savings-insights/new-count")
async def new_insight_count(user: dict = Depends(current_user)):
    """Badge count: new-content insights the user hasn't looked at since they
    refreshed. Viewing the list clears it (mark-viewed); the per-card "New"
    chip keeps its own lifecycle."""
    n = await savings_insights_col.count_documents({
        "user_id": user["email"],
        "is_new": True,
        "$expr": {"$gt": ["$refreshed_at", {"$ifNull": ["$viewed_at", datetime(1970, 1, 1)]}]},
    })
    return {"count": n}


@router.post("/savings-insights/mark-viewed")
async def mark_insights_viewed(user: dict = Depends(current_user)):
    """The user opened the insights list — everything current counts as seen."""
    await savings_insights_col.update_many(
        {"user_id": user["email"]},
        {"$set": {"viewed_at": datetime.utcnow()}},
    )
    return {"ok": True}


@router.get("/savings-insights/workflows")
async def get_workflows(_user: dict = Depends(current_user)):
    return CATEGORY_WORKFLOWS


@router.post("/savings-insights/{insight_id}/context")
async def save_insight_context(
    insight_id: str,
    body: dict,
    background_tasks: BackgroundTasks,
    user: dict = Depends(current_user),
):
    uid = user["email"]
    doc = await savings_insights_col.find_one({"user_id": uid, "insight_id": insight_id})
    if not doc:
        raise HTTPException(404, "Insight not found")
    context = body.get("context", {})
    await savings_insights_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"user_context": context, "deadline_at": _parse_deadline(context)}},
    )
    background_tasks.add_task(_refresh_single_insight, uid, doc["category"], context)
    return {"message": "Saved, regenerating insight"}


@router.patch("/savings-insights/{insight_id}/pin")
async def toggle_pin_insight(insight_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    doc = await savings_insights_col.find_one({"user_id": uid, "insight_id": insight_id})
    if not doc:
        raise HTTPException(404, "Insight not found")
    new_pinned = not doc.get("pinned", False)
    update: dict = {"pinned": new_pinned}
    update["expires_at"] = None if new_pinned else datetime.utcnow() + timedelta(days=30)
    await savings_insights_col.update_one({"_id": doc["_id"]}, {"$set": update})
    return {"pinned": new_pinned}


@router.post("/savings-insights/refresh")
async def trigger_refresh_insights(background_tasks: BackgroundTasks, user: dict = Depends(current_user)):
    uid = user["email"]
    background_tasks.add_task(_refresh_savings_insights_for_user, uid)
    return {"message": "Refresh started"}


@router.get("/savings-insights/unknown-bills")
async def get_unknown_bills(user: dict = Depends(current_user)):
    uid    = user["email"]
    cutoff = datetime.utcnow() - timedelta(days=90)

    labelled_keys = {
        lbl["merchant_key"]
        async for lbl in savings_labels_col.find({"user_id": uid}, {"merchant_key": 1})
    }

    buckets: dict[str, list[float]] = defaultdict(list)
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col]:
        txns = await col.find(
            {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": "debit"},
            {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1, "amount": 1},
        ).to_list(None)
        for t in txns:
            cat = (t.get("custom_category") or t.get("category") or "").lower()
            if cat not in BILL_CATEGORIES:
                continue
            key = (t.get("merchant_name") or t.get("description", "")[:30]).strip()
            if not key:
                continue
            buckets[key].append(float(t.get("amount", 0)))

    results = []
    for key, amounts in sorted(buckets.items(), key=lambda x: -sum(x[1])):
        if len(amounts) < 2:
            continue
        if any(trigger in key.lower() for trigger in _ALL_TRIGGERS):
            continue
        if key in labelled_keys:
            continue
        results.append({
            "merchant_key": key, "display_name": key.title(),
            "monthly_amount": round(sum(amounts) / 3, 2), "occurrences": len(amounts),
        })
        if len(results) >= 8:
            break

    return {"unknown_bills": results, "label_options": LABEL_OPTIONS}


@router.post("/savings-insights/label")
async def label_bill(body: dict, background_tasks: BackgroundTasks, user: dict = Depends(current_user)):
    uid          = user["email"]
    merchant_key = (body.get("merchant_key") or "").strip()
    category     = (body.get("category") or "").strip()
    if not merchant_key or not category:
        raise HTTPException(400, "merchant_key and category required")
    valid_cats = set(INSIGHT_CATEGORIES.keys()) | set(LABEL_OPTIONS.keys()) | {"skip"}
    if category not in valid_cats:
        raise HTTPException(400, "Invalid category")

    await savings_labels_col.update_one(
        {"user_id": uid, "merchant_key": merchant_key},
        {"$set": {"user_id": uid, "merchant_key": merchant_key, "category": category, "updated_at": datetime.utcnow()}},
        upsert=True,
    )
    if category in INSIGHT_CATEGORIES:
        background_tasks.add_task(_refresh_single_insight, uid, category)
    return {"message": "Labelled", "category": category}


@router.get("/savings-insights/labels")
async def get_bill_labels(user: dict = Depends(current_user)):
    uid  = user["email"]
    docs = await savings_labels_col.find({"user_id": uid}).sort("merchant_key", 1).to_list(None)
    return [
        {
            "merchant_key": d["merchant_key"], "display_name": d["merchant_key"].title(),
            "category": d["category"],
            "icon":  LABEL_OPTIONS.get(d["category"], {}).get("icon", "💡"),
            "label": LABEL_OPTIONS.get(d["category"], {}).get("label", d["category"].replace("_", " ").title()),
            "is_skip": d["category"] == "skip",
        }
        for d in docs
    ]


@router.delete("/savings-insights/labels/{merchant_key}")
async def delete_bill_label(merchant_key: str, user: dict = Depends(current_user)):
    uid = user["email"]
    await savings_labels_col.delete_one({"user_id": uid, "merchant_key": merchant_key})
    return {"deleted": merchant_key}
