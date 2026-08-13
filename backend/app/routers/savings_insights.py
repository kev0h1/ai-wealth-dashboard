"""Savings insights endpoints."""
import asyncio
import hashlib
import json
import logging
import re
from calendar import monthrange
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional
from urllib.parse import quote

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS, TAVILY_API_KEY, APP_URL
from app.core.subscription import Tier, require_tier
from app.db.collections import (
    savings_insights_col, savings_labels_col,
    transactions_col, yapily_transactions_col,
    mono_transactions_col, statement_transactions_col,
    preferences_col,
)

router = APIRouter(tags=["savings_insights"])
log    = logging.getLogger(__name__)

INSIGHT_CATEGORIES: dict[str, dict] = {
    "energy": {
        "icon": "⚡", "label": "Energy",
        "query": "best energy tariff switch UK {year} cheapest deals save money",
        "triggers": ["british gas", "eon ", "edf", "scottish power", "octopus energy", "npower", "sse ", "bulb energy", "shell energy", "utilita", "utility warehouse", "bg energy"],
    },
    "mortgage": {
        "icon": "🏠", "label": "Mortgage",
        "query": "best mortgage remortgage deals UK {year} lowest fixed rate switch lender",
        "triggers": ["mortgage", "nationwide", "halifax", "santander mortgage", "barclays mortgage", "lloyds mortgage", "natwest mortgage", "hsbc mortgage", "virgin money mortgage", "mortg"],
    },
    "car_finance": {
        "icon": "🚘", "label": "Car Finance",
        "query": "refinance car loan UK {year} best rate save money PCP HP alternatives",
        "triggers": ["black horse", "close brothers", "moneybarn", "evolution funding", "motonovo", "car loan", "car finance", "hire purchase", "santander consumer", "toyota finance", "volkswagen finance"],
    },
    "car_insurance": {
        "icon": "🚗", "label": "Car Insurance",
        "query": "cheapest car insurance deals UK {year} comparison save",
        "triggers": ["direct line", "admiral", "aviva", "hastings direct", "churchill", "more than", "lv= ", "esure", "elephant auto"],
    },
    "broadband": {
        "icon": "📡", "label": "Broadband",
        "query": "best broadband deals UK {year} switch provider save money",
        "triggers": ["bt ", "bt group", "virgin media", "sky broadband", "talktalk", "vodafone broadband", "now broadband", "plusnet", "community fibre", "hyperoptic"],
    },
    "mobile": {
        "icon": "📱", "label": "Mobile",
        "query": "best SIM only mobile plan UK {year} cheapest deal",
        "triggers": ["ee ltd", "ee limited", "ee ", "o2 ", "vodafone", "three ", "giffgaff", "sky mobile", "tesco mobile", "id mobile", "lycamobile"],
    },
    "groceries": {
        "icon": "🛒", "label": "Groceries",
        "query": "cheapest UK supermarket comparison {year} where to shop save groceries",
        "triggers": ["tesco", "sainsbury", "asda", "morrisons", "waitrose", "lidl", "aldi", "co-op", "marks and spencer food", "ocado", "m&s food"],
    },
    "eating_out": {
        "icon": "🍽️", "label": "Eating Out",
        "query": "restaurant dining offers discounts UK {year} deals save money eating out",
        "triggers": ["restaurant", "mcdonald", "kfc", "nando", "wagamama", "pizza express", "prezzo", "costa coffee", "starbucks", "pret a manger", "itsu", "leon ", "subway"],
    },
    "gym": {
        "icon": "💪", "label": "Gym",
        "query": "best value gym membership UK {year} cheapest monthly no contract",
        "triggers": ["pure gym", "the gym group", "david lloyd", "virgin active", "anytime fitness", "nuffield health", "fitness first", "bannatyne", "everyone active"],
    },
    "subscriptions": {
        "icon": "📺", "label": "Subscriptions",
        "query": "how to save on streaming subscriptions UK {year} cheaper alternatives deals",
        "triggers": ["netflix", "spotify", "amazon prime", "disney+", "disney plus", "apple tv", "youtube premium", "now tv", "sky entertainment", "paramount+", "apple music"],
    },
}

# Content format version: bump when the generation prompt changes materially so
# existing stored insights regenerate on the next pass instead of serving the
# old copy until their 30-day TTL.
# v4: savings_estimate must now be derivable from the supplied sources/facts
# (see _savings_estimate_is_derivable) — previously-generated estimates may
# be fabricated and need to pass through the new guard.
PROMPT_VERSION = 4

# In-app destination per category — the screen where the user can act on the
# insight with their own data (frontend renders this as the primary action).
CATEGORY_APP_ROUTES: dict[str, str] = {
    "subscriptions": "/planning",           # recurring list lives there
    "mobile":        "/spend?category=Bills",
    "broadband":     "/spend?category=Bills",
    "energy":        "/spend?category=Bills",
    "groceries":     "/spend?category=Groceries",
    "eating_out":    "/spend?category=Eating%20Out",
    "gym":           "/spend?category=Health",
    "car_finance":   "/planning",
    "mortgage":      "/planning",
    "car_insurance": "/spend?category=Bills",
    "insurance":     "/spend?category=Bills",
    "water":         "/spend?category=Bills",
}

# Non-UK guardrail: US-only services/terms that must never reach a UK user's
# card. Checked post-generation; one regeneration attempt, then the insight is
# dropped rather than stored.
_NON_UK_RE = re.compile(
    r"\bhulu\b|\bmax bundle\b|\bvenmo\b|\bzelle\b|\b401\s?\(?k\)?\b|\broth\b|\bmedicare\b|\bsales tax\b",
    re.IGNORECASE,
)

# Card-debt guardrail: this product treats balance transfers and moving credit
# card debt between cards/lenders as notice-and-ask, never advice (that ban is
# also stated in the prompt below). This is the fail-safe backstop for the two
# refinancing categories (mortgage, car_finance) where a model can drift into
# "open a 0% card and transfer the balance" territory. It does NOT catch
# switching a mortgage or car finance deal to a new lender — that's the
# intended feature and stays untouched. Checked post-generation like
# _NON_UK_RE: one regeneration attempt, then the insight is dropped rather
# than stored.
_CARD_DEBT_MOVE_RE = re.compile(
    r"balance transfer"
    r"|transfer(?:ring)?\s+(?:your\s+|the\s+)?(?:card\s+|credit[\s-]?card\s+)?balance"
    r"|(?:move|moving|shift|shifting|switch|switching|consolidat\w*)\s+(?:your\s+)?"
    r"(?:card|credit[\s-]?card)\s+(?:debt|balance)"
    r"|(?:move|moving|shift|shifting)\s+(?:your\s+)?debt\s+(?:to|onto|between)\s+"
    r"(?:a\s+|another\s+)?(?:card|credit[\s-]?card)"
    r"|(?:move|moving|shift|shifting|transfer|transferring|switch|switching)\s+"
    r"(?:your\s+|the\s+|any\s+|that\s+)?(?:outstanding\s+|remaining\s+|current\s+|existing\s+)?"
    r"balance\s+(?:to|onto)\s+(?:a\s+|another\s+)?(?:new\s+|different\s+|0%\s*)?"
    r"(?:credit[\s-]?card|card)\b"
    r"|0%\s*(?:purchase|balance transfer)\s*card",
    re.IGNORECASE,
)

# Savings-estimate guardrail: the prompt tells the model savings_estimate may
# only be a figure lifted straight from the sources or the arithmetic
# difference of two such figures — but models drift into "typical" ranges
# anyway (see _generate_savings_insight_content docstring history). This is
# the post-hoc backstop: every number quoted in the estimate is checked
# against an allowed set built from the actual inputs (Tavily snippets, user
# context, the user's own spend facts), their pairwise differences, and
# monthly<->annual conversions. Unlike _NON_UK_RE/_CARD_DEBT_MOVE_RE this
# never drops the whole insight — an ungrounded number is unsupported, not
# dangerous, so only savings_estimate is nulled and the title/body survive.
_NUMBER_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")

# "a pound or two, plus rounding" — generous enough to absorb £/mo->£/yr
# rounding (e.g. 1862/12 = 155.1666...) without being loose enough to wave
# through an unrelated number.
_SAVINGS_ESTIMATE_TOLERANCE = 1.5


def _extract_numbers(text: Optional[str]) -> list[float]:
    """Pull every numeric literal out of free text — handles £, %, commas
    and decimals ('£1,862', '4.13%', '300–600' all yield the bare numbers)."""
    if not text:
        return []
    out = []
    for m in _NUMBER_RE.finditer(str(text)):
        try:
            out.append(float(m.group(0).replace(",", "")))
        except ValueError:
            continue
    return out


def _build_allowed_savings_numbers(
    web_text: str,
    user_context: Optional[dict],
    triggered_by: Optional[list[dict]],
) -> set[float]:
    """The full set of numbers a savings_estimate figure is allowed to trace
    back to: every literal figure in the Tavily search results, every literal
    figure in the user-supplied context/facts actually passed into the
    prompt, their pairwise differences (a real subtraction between two stated
    numbers, e.g. price-cap minus cheapest-fix), and monthly<->annual
    conversions (the copy legitimately moves between '/mo' and '/yr').
    Anything not reachable from this set is a guess, not a calculation."""
    base: set[float] = set()
    base.update(_extract_numbers(web_text))
    if user_context:
        for v in user_context.values():
            base.update(_extract_numbers(str(v)))
    if triggered_by:
        for t in triggered_by:
            amt = t.get("monthly_amount")
            if amt is not None:
                base.update(_extract_numbers(str(amt)))

    allowed: set[float] = set(base)
    for n in base:
        allowed.add(round(n * 12, 2))
        allowed.add(round(n / 12, 2))
    values = list(base)
    for i in range(len(values)):
        for j in range(i + 1, len(values)):
            allowed.add(round(abs(values[i] - values[j]), 2))
    return allowed


def _number_is_derivable(n: float, allowed: set[float]) -> bool:
    if n == 0:
        return True  # "£0"/free is never a fabricated figure
    return any(abs(n - a) <= _SAVINGS_ESTIMATE_TOLERANCE for a in allowed)


def _savings_estimate_is_derivable(estimate: Optional[str], allowed: set[float]) -> bool:
    """True iff every number quoted in the estimate is derivable from the
    inputs (a source/user figure, or the difference/×12/÷12 of two of them).
    One fabricated number sitting next to a real one still fails the whole
    estimate — there's no way to tell which part the model made up."""
    if not estimate:
        return True  # null is always fine — nothing to check
    nums = _extract_numbers(estimate)
    if not nums:
        return True  # e.g. "Save on your plan" — no figure to fabricate
    return all(_number_is_derivable(n, allowed) for n in nums)


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


async def _generate_savings_insight_content(
    category_key: str,
    user_context: Optional[dict] = None,
    triggered_by: Optional[list[dict]] = None,
) -> Optional[dict]:
    cfg          = INSIGHT_CATEGORIES[category_key]
    now          = datetime.utcnow()
    today_label  = now.strftime("%B %Y")
    query        = cfg["query"].format(year=now.year)
    web_snippets: list[str] = []

    if TAVILY_API_KEY:
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": TAVILY_API_KEY, "query": f"{query} {today_label}",
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

    uk_rules = (
        f"Today is {today_label}. UK only — never recommend services, providers or products "
        "unavailable in the UK; all figures in GBP (£). "
        "Never present a past month or year as the current one; if the search results are dated, "
        "omit the date rather than repeating it.\n"
    )

    hard_rules = (
        "HARD RULES — non-negotiable:\n"
        "1. Balance transfers and moving credit card debt are NEVER advice in this product. "
        "Never tell the user to transfer, move, shift or consolidate a credit card balance, or "
        "to open a new card to pay off existing card debt. This ban is specifically about credit "
        "card debt movement — switching a mortgage or car finance deal to a new lender is NOT "
        "covered by this ban and is exactly what this insight should help with.\n"
        "2. Never promise or predict what a third party (a lender, bank or provider) will do. "
        "Every forward-looking statement about rates, offers or providers must be hedged — use "
        "words like 'expected', 'about', '~', 'could' or 'typically', never state it as certain.\n"
        "3. No alarm framing. A savings opportunity is not a risk — never use 'urgent', 'warning', "
        "'risk' or red/danger language.\n"
        "4. Any savings figure is an estimate, never a guarantee — hedge it ('~', 'could save', "
        "'typically saves'), never state it as a fact.\n"
        "5. savings_estimate must be DERIVED, never ESTIMATED. It may only be one of two things: "
        "(a) a figure stated explicitly in the search results or the user's own facts above, quoted "
        "as-is, or (b) the arithmetic difference between two figures explicitly stated in those "
        "sources (e.g. today's price cap minus a cheapest fixed deal, both given as numbers above). "
        "If neither (a) nor (b) is possible — no principal, no current rate, no two comparable prices "
        "to subtract — savings_estimate MUST be null. Never invent a figure from 'typical' savings, "
        "never guess a plausible-sounding range, never estimate from general knowledge of the market. "
        "null is a correct, expected, and common answer here, not a failure — a hedge word like '~' "
        "does not make an invented number acceptable, because the number itself must be real, not "
        "just softly worded.\n"
    )

    facts_block  = ""
    verdict_rule = ""
    if triggered_by:
        facts_lines = "\n".join(
            f"- {t.get('display_name') or t.get('merchant_key', '')}: "
            f"~£{float(t.get('monthly_amount') or 0):.0f}/month "
            f"({t.get('occurrences', 0)} transactions in the last 90 days)"
            for t in triggered_by[:4]
        )
        facts_block = (
            f"The user's own {cfg['label'].lower()} spending, from their bank transactions:\n"
            f"{facts_lines}\n\n"
        )
        verdict_rule = (
            "RULE — verdict first: the title or the opening sentence of the body MUST lead with the "
            "user's own figure from their spending above, e.g. "
            '"You pay EE £46/mo — SIM-only could cut that to ~£12". '
            "Their spending figures are facts; any saving is an estimate — hedge it with '~' or 'could'.\n"
        )

    if user_context:
        ctx_lines = "\n".join(f"- {k.replace('_', ' ').title()}: {v}" for k, v in user_context.items() if v)
        prompt    = (
            f"{uk_rules}{hard_rules}Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            f"{facts_block}"
            f"The user's current {cfg['label'].lower()} situation:\n{ctx_lines}\n\n"
            "Write a HIGHLY PERSONALISED savings insight. Reference their specific spend, rate, provider, "
            "amount or end date where relevant. Give concrete next steps they should take right now.\n"
            f"{verdict_rule}"
            "JSON: title (max 10 words, specific to their situation), "
            "body (2–3 sentences, direct advice referencing their details), "
            "savings_estimate (per rule 5 above: a stated figure or a subtraction of two stated "
            "figures, else null — null is expected and fine)\n\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"..."}'
        )
    else:
        prompt = (
            f"{uk_rules}{hard_rules}Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            f"{facts_block}"
            "Write a concise savings insight card in JSON with three fields:\n"
            "- title: max 10 words, punchy, present tense\n"
            "- body: 1–2 sentences, specific deal or tip, no filler\n"
            "- savings_estimate: per rule 5 above — e.g. '~£200/yr' ONLY if that figure or its two "
            "source numbers are stated above, else null (null is expected and fine)\n"
            f"{verdict_rule}\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"..."}'
        )

    # Two attempts: if the model names a non-UK product (Hulu, Venmo, 401(k)…)
    # or suggests moving/transferring/consolidating credit card debt, we
    # regenerate once with a sharper instruction, then drop the insight —
    # never store garbage, and never store regulated-sounding debt advice.
    violation: Optional[str] = None
    for attempt in range(2):
        if attempt == 0:
            attempt_prompt = prompt
        elif violation == "card_debt":
            attempt_prompt = (
                prompt
                + "\n\nIMPORTANT: your previous answer suggested transferring, moving, shifting "
                  "or consolidating a credit card balance/debt. That is NEVER allowed in this "
                  "product — remove any card balance-transfer or debt-consolidation suggestion "
                  "entirely. You may still suggest switching a mortgage or car finance deal to a "
                  "new lender; that is fine."
            )
        else:
            attempt_prompt = (
                prompt
                + "\n\nIMPORTANT: your previous answer mentioned a non-UK product or US-only term. "
                  "Mention ONLY services, providers and terms available in the UK."
            )
        parsed = None
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": APP_URL},
                    json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 220,
                          "messages": [{"role": "user", "content": attempt_prompt}],
                          "response_format": {"type": "json_object"},
                          "provider": OPENROUTER_PROVIDER_PREFS},
                )
                if r.status_code == 200:
                    raw = r.json()["choices"][0]["message"]["content"].strip()
                    if raw.startswith("```"):
                        raw = re.sub(r'^```(?:json)?\s*', '', raw)
                        raw = re.sub(r'\s*```$', '', raw).strip()
                    parsed = json.loads(raw)
            except Exception:
                parsed = None
        if not isinstance(parsed, dict):
            continue
        title    = str(parsed.get("title", cfg["label"]))
        body     = str(parsed.get("body", ""))
        estimate = str(parsed.get("savings_estimate") or "")
        combined = f"{title} {body} {estimate}"
        if _NON_UK_RE.search(combined):
            violation = "non_uk"
            continue
        if _CARD_DEBT_MOVE_RE.search(combined):
            violation = "card_debt"
            continue

        savings_estimate = parsed.get("savings_estimate") or None
        if savings_estimate is not None:
            allowed = _build_allowed_savings_numbers(web_text, user_context, triggered_by)
            if not _savings_estimate_is_derivable(savings_estimate, allowed):
                log.warning(
                    "savings_insights: ungrounded savings_estimate nulled — category=%s estimate=%r",
                    category_key, savings_estimate,
                )
                savings_estimate = None

        return {
            "title": title,
            "body":  body,
            "savings_estimate": savings_estimate,
        }
    return None


async def _refresh_single_insight(user_id: str, category_key: str, user_context: Optional[dict] = None) -> None:
    cfg = INSIGHT_CATEGORIES.get(category_key)
    if not cfg:
        return
    if user_context is None:
        existing_doc = await savings_insights_col.find_one({"user_id": user_id, "category": category_key})
        user_context = existing_doc.get("user_context") if existing_doc else None
    triggered_by = await _find_triggered_transactions(user_id, category_key)
    content = await _generate_savings_insight_content(category_key, user_context, triggered_by)
    if not content or not content.get("body"):
        return
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
        "prompt_version": PROMPT_VERSION,
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
        content        = await _generate_savings_insight_content(cat_key, stored_context, triggered_by)
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
                "prompt_version": PROMPT_VERSION,
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
                "prompt_version": PROMPT_VERSION,
            })


def _merchant_scoped_route(category: str, triggered_by: list[dict]) -> Optional[str]:
    """Deep-link the CTA at the insight's own merchants, not the whole
    category — "/spend?category=Bills" becomes
    "/spend?category=Bills&merchants=Ee%20Ltd" so the category sheet can
    highlight the rows that actually triggered this insight. Up to 3 display
    names, comma-separated, each URL-encoded. Routes that don't drill into a
    spend category (e.g. /planning) pass through untouched."""
    route = CATEGORY_APP_ROUTES.get(category)
    if not route or "/spend?" not in route:
        return route
    names: list[str] = []
    for t in triggered_by[:3]:
        name = str(t.get("display_name") or t.get("merchant_key") or "").strip()
        if name:
            names.append(name)
    if not names:
        return route
    return f"{route}&merchants={','.join(quote(n, safe='') for n in names)}"


def _serialize_insight(d: dict) -> dict:
    cat = d["category"]
    # Always resolve icon/label from the live config so stale cached docs
    # automatically pick up any correction — never trust the stored copy.
    _cfg = INSIGHT_CATEGORIES.get(cat) or LABEL_OPTIONS.get(cat) or {}
    return {
        "id":              d.get("insight_id", str(d["_id"])),
        "category":        cat,
        "icon":            _cfg.get("icon") or d.get("icon", "💡"),
        "label":           _cfg.get("label") or d.get("label", cat.replace("_", " ").title()),
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
        # In-app screen where the user can act on this with their own data,
        # scoped to the triggering merchants when it drills into a spend
        # category; null when no natural home exists.
        "app_route":       _merchant_scoped_route(cat, d.get("triggered_by") or []),
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
    if existing.get("prompt_version") != PROMPT_VERSION:
        return "prompt_upgraded"  # content predates the verdict-first format
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
    docs = await savings_insights_col.find({"user_id": uid}).to_list(None)

    for d in docs:
        if not d.get("triggered_by"):
            triggered_by = await _find_triggered_transactions(uid, d["category"])
            if triggered_by:
                await savings_insights_col.update_one({"_id": d["_id"]}, {"$set": {"triggered_by": triggered_by}})
                d["triggered_by"] = triggered_by

    # Biggest-impact card first: pinned, then verified wins, then the largest
    # parsed £ estimate, then the largest triggering monthly spend.
    from app.routers.analytics import _parse_saving_amount

    def _rank_key(d: dict):
        estimate = _parse_saving_amount(d.get("savings_estimate")) or 0.0
        spend    = sum(float(t.get("monthly_amount") or 0) for t in d.get("triggered_by") or [])
        return (bool(d.get("pinned")), bool(d.get("verified_savings")), estimate, spend)

    docs.sort(key=_rank_key, reverse=True)
    return [_serialize_insight(d) for d in docs]


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
