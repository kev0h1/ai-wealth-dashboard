"""Merchant rules, AI categorisation, and rule application logic."""
import re
import json
import logging
from collections import defaultdict, Counter
from typing import Optional
import httpx

from app.core.config import OPENROUTER_API_KEY, TAVILY_API_KEY
from app.db.collections import (
    transactions_col, accounts_col, user_rules_col,
    statement_transactions_col, mono_transactions_col, mpesa_transactions_col,
)

RAW_TRUELAYER_CATEGORIES = {
    "BILL_PAYMENT", "DEBIT", "DIRECT_DEBIT", "PURCHASE",
    "STANDING_ORDER", "CREDIT", "TRANSFER",
}

VALID_CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment",
    "Shopping", "Bills", "Subscriptions", "Health", "Travel",
    "Software", "Savings", "Debt", "Transfer", "Income",
    "Cash", "Charity", "Other",
]

MERCHANT_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'payment received|thank you for payment|card payment received|direct debit payment', re.I), 'Transfer'),
    (re.compile(r'american express.*ddr|amex.*ddr|american express.*direct debit|\bAMERICAN EXPRESS\b', re.I), 'Transfer'),
    (re.compile(r'goldman sachs.*bgc|goldman sachs.*bcc|goldman sachs.*salary|gs.*payroll', re.I), 'Income'),
    (re.compile(r'interest received|interest earned|interest credit|gross interest|net interest|interest payment to you|interest paid to you|credit interest', re.I), 'Income'),
    (re.compile(r'\bmarcus\b', re.I), 'Transfer'),
    (re.compile(r'nw world mastercar|natwest.*mastercard|world mastercard payment', re.I), 'Debt'),
    (re.compile(r'^natwest\s*$', re.I), 'Debt'),
    (re.compile(r'tesco|sainsbury|asda|morrisons?|waitrose|lidl|aldi|iceland food|co-?op\b|ocado|farmfoods|marks.{0,5}spencer food|m&s food|whole foods|budgens|londis|spar\b|nisa\b|costco', re.I), 'Groceries'),
    (re.compile(r"mcdonald'?s?|kfc\b|starbucks|costa coffee|pret\b|nando'?s?|pizza\b|burger king|subway\b|deliveroo|just.?eat|uber.{0,5}eat|ubereats|greggs|domino'?s?|papa.?john|wagamama|itsu\b|leon\b|five.?guys|wetherspoon|yo.?sushi|wasabi|eat\b|caffe nero|cafe\b|restaurant|bistro|brasserie|food.?delivery|hungry.?house|cabana\b|dishoom|hawksmoor|bills restaurant|turtle bay|wahaca|zizzi\b|bella italia|frankie|benny|carluccio|harvester\b|toby carvery|ember inns|mitchells.?butlers|stonehouse\b|vintage inns", re.I), 'Eating Out'),
    (re.compile(r'tfl\b|transport for london|oyster|uber\b|bolt\b|trainline|national rail|avanti|lner\b|cross.?country|great western|south western|south.?eastern|northern rail|arriva|stagecoach|first.?bus|megabus|national express|eurostar|heathrow express|gatwick express|stansted express|go.?ahead|chiltern rail|trainpal|train pal|railcard|splittickets|railsmartr|seatfrog', re.I), 'Transport'),
    (re.compile(r'\bbp\b|shell\b|esso\b|total energies|texaco|gulf\b|moto\b|roadchef|welcome break|petrol|fuel\b|\bparking\b|ncp\b|q-park|ringgo|paybyphone|car.?par\b|car.?park|airparks|purple.?parking|jfk.?park|airport.?park|birmingham.?int.*car|int.*car.*par', re.I), 'Transport'),
    (re.compile(r'netflix|spotify|disney\+?|amazon prime|apple music|youtube.?premium|google\*youtube|now tv|now\.tv|apple.?one|apple\.?com/bill|apple tv\+?|hulu|paramount\+?|bbc sounds|audible|kindle unlimited|duolingo|headspace|calm\b|grammarly|canva\b|adobe\b|microsoft 365|office 365|dropbox|icloud|google one|playstation|psn\b|ps\+|xbox.?game.?pass|nintendo online|nintendo switch online|twitch|squarespace|\bsqsp\b|claude\.ai|anthropic\b', re.I), 'Subscriptions'),
    (re.compile(r'odeon|vue cinema|cineworld|curzon|everyman cinema|ticketmaster|see.?tickets|eventbrite|sky sports|bt sport|dazn\b|steam\b|epic games|xbox store|nintendo eshop|nintendo\b|google play|app store|museum|theatre|gallery|gig\b|concert', re.I), 'Entertainment'),
    (re.compile(r'\bamazon\b(?!.*prime)|\bamzn\b|amazon marketplace|amznmkt|asos\b|zara\b|h&m\b|h and m|next\b|john lewis|argos\b|currys\b|pc world|ebay\b|very\b|boohoo|river island|topshop|primark|tkmaxx|tk maxx|matalan|new look|sports direct|jd sports|foot locker|footlocker|nike\b|adidas\b|vinted\b|etsy\b|zalando|prettylittlething|shein\b|uniqlo|gap\b|lush\b|holland.?barrett|the body shop|boots(?! pharmacy)|dunelm\b|habitat\b|b&q\b|homebase\b|wickes\b|screwfix|toolstation|ikea\b|wayfair|made\.com|next\.co|very\.co|littlewoods|kaleidoscope|qvc\b|ao\.com|\bao\b appliances|smyths|toy.?r.?us|the range\b|homebargains|home bargains|pound.?land|poundworld|savers\b', re.I), 'Shopping'),
    (re.compile(r'british gas|octopus energy|edf energy|e\.?on\b|scottish power|npower|bulb\b|ovo energy|shell energy|thames water|severn trent|yorkshire water|united utilities|south west water|bt group\b|bt broadband|virgin media|sky\b|vodafone|ee\b|o2\b|three\b|giffgaff|lycamobile|lyca mobile|lebara|voxi\b|smarty\b|talktalk|plusnet|now broadband|council tax|tv licence|water bill|electricity bill|gas bill|broadband|metropoli.*council|borough council|city council|district council|county council|local authority', re.I), 'Bills'),
    (re.compile(r'boots pharmacy|lloyds pharmacy|superdrug|pharmacy|chemist|puregym|the gym\b|gym ltd|gym group|anytime fitness|jd gyms|david lloyd|virgin active|planet fitness|nuffield health|bannatyne|snap fitness|dentist|dental|doctor\b|gp\b|nhs\b|hospital|optician|specsavers|vision express|holland.?barrett|vitabiotics|protein|\bspire\s+\w+|bupa\b|axa health|vitality health|aviva health|private.?health|medical.?centre|walk.?in.?centre|urgent.?care|physiotherapy|physio\b|osteopath|chiropractor|acupuncture|counselling|therapy\b|mental health', re.I), 'Health'),
    (re.compile(r'airbnb|booking\.com|hotels\.com|expedia|trivago|ryanair|easyjet|british airways|jet2|tui\b|virgin atlantic|wizz air|blue air|hilton|marriott|premier inn|travelodge|holiday inn|ibis\b|accor|airfare|holiday|travel insurance', re.I), 'Travel'),
    (re.compile(r'github\b|digitalocean|aws\b|amazon web services|google cloud|azure\b|heroku|netlify|vercel|cloudflare|linode|hetzner|namecheap|godaddy|1password|lastpass|dashlane|bitwarden|notion\b|figma\b|slack\b|zoom\b|webflow|railway\b|supabase|mongodb atlas|datadog|sentry\b|linear\b', re.I), 'Software'),
    (re.compile(r'moneybox|plum\b|chip\b|nutmeg|wealthify|wealthsimple|vanguard|hargreaves lansdown|fidelity|trading 212|freetrade|ii\b|interactive investor|isa\b|pension|\bsavings?\b', re.I), 'Savings'),
    (re.compile(r'interest on your|interest charge|late fee|overdraft fee|annual fee|card fee|bank charge', re.I), 'Bills'),
    (re.compile(r'balance transfer|internal transfer|faster payment|bacs payment|chaps payment|from .* pot\b', re.I), 'Transfer'),
    (re.compile(r'goldman sachs.{0,30}(purchase|payment|ddr|direct debit|repay)', re.I), 'Transfer'),
    (re.compile(r'\bfrom\s+\w+\s+\w+(\s+\w+)?\s+(payment|transfer|paid)\b|fps credit\b|faster payment credit|\bpayment from\b', re.I), 'Transfer'),
    (re.compile(r'valeting|car.?valet|car.?clean|car.?wash\b', re.I), 'Transport'),
    (re.compile(r'enterprise rent|rent.?a.?car|hertz\b|avis\b|sixt\b|national car|zipcar|enterprise.?car', re.I), 'Transport'),
    (re.compile(r'service.?station|s/stn\b|petrol station|auto service|car wash|mot\b|tyre', re.I), 'Transport'),
    (re.compile(r'playtomic|tennis|padel|squash|badminton|swimming|leisure.?centre|sports.?centre|golf|yoga|pilates|crossfit', re.I), 'Health'),
    (re.compile(r'\bnx bus\b|arriva bus|first bus|stagecoach bus|national express bus|megabus|coach\b', re.I), 'Transport'),
    (re.compile(r'\b(sto|standing order)\b', re.I), 'Transfer'),
    (re.compile(r'dining|diner\b|grill\b|kitchen\b|eatery|takeaway|take.?away|porters.?lodge|lodge.?cafe|kebab|shawarma|german.?diner|currywurst|schnitzel|bratwurst|falafel|gyros?\b', re.I), 'Eating Out'),
    (re.compile(r'\bpaypal\b', re.I), 'Shopping'),
    (re.compile(r'\batm\b|cash.?machine|cash.?withdrawal|cashpoint|notemachine|note.?machine', re.I), 'Other'),
    (re.compile(r'exchanged? to\b|fx\b|foreign.?exchange|currency.?exchange|transnational', re.I), 'Transfer'),
    (re.compile(r'from .* pot\b|to .* pot\b|pot.?transfer|pot.?withdrawal|pot.?deposit', re.I), 'Transfer'),
    (re.compile(r'post office\b|royal mail\b|parcelforce', re.I), 'Shopping'),
    (re.compile(r'\bperks?\b|cashback\b|reward.?payment|loyalty.?reward', re.I), 'Income'),
]


def rule_categorise(merchant: str, description: str) -> Optional[str]:
    text = f"{merchant} {description}"
    for pattern, category in MERCHANT_PATTERNS:
        if pattern.search(text):
            return category
    return None


async def tavily_lookup_merchants(merchants: list[str]) -> dict[str, str]:
    if not TAVILY_API_KEY or not merchants:
        return {}
    results: dict[str, str] = {}
    async with httpx.AsyncClient(timeout=15) as client:
        for merchant in merchants[:20]:
            try:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": TAVILY_API_KEY,
                        "query": f"What is \"{merchant}\"? What type of business or service is it?",
                        "search_depth": "basic",
                        "max_results": 1,
                        "include_answer": True,
                    },
                )
                if r.status_code == 200:
                    data = r.json()
                    answer = data.get("answer") or ""
                    if not answer and data.get("results"):
                        answer = data["results"][0].get("content", "")[:200]
                    if answer:
                        results[merchant] = answer[:200]
            except Exception:
                pass
    return results


async def apply_rules_bulk(user_id: str, structural: bool = False) -> int:
    """Apply merchant rules + structural passes to categorise transactions.
    Returns count of updated docs."""
    updated = 0

    if structural:
        # Pass 1: credits on credit card accounts → Transfer
        cc_ids = [d["_id"] async for d in accounts_col.find({"user_id": user_id, "type": "credit_card"}, {"_id": 1})]
        if cc_ids:
            result = await transactions_col.update_many(
                {"user_id": user_id, "account_id": {"$in": cc_ids},
                 "transaction_type": "credit", "category": "Income", "custom_category": None},
                {"$set": {"category": "Transfer"}},
            )
            updated += result.modified_count

        # Pass 2: match transfer pairs
        all_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": None, "description": {"$ne": None}},
            {"description": 1, "amount": 1, "transaction_type": 1, "date": 1, "category": 1},
        ).to_list(None)

        desc_map: dict = defaultdict(list)
        for t in all_txns:
            key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
            if key:
                desc_map[key].append(t)

        transfer_ids = []
        for key, txns in desc_map.items():
            credits = [t for t in txns if t["transaction_type"] == "credit"]
            debits  = [t for t in txns if t["transaction_type"] == "debit"]
            if not credits or not debits:
                continue
            from datetime import datetime
            for c in credits:
                for d in debits:
                    if abs(c["amount"] - d["amount"]) < 0.02:
                        date_diff = abs((c["date"] - d["date"]).days) if isinstance(c["date"], datetime) and isinstance(d["date"], datetime) else 999
                        if date_diff <= 5:
                            if c.get("category") != "Transfer":
                                transfer_ids.append(c["_id"])
                            if d.get("category") != "Transfer":
                                transfer_ids.append(d["_id"])

        if transfer_ids:
            result = await transactions_col.update_many(
                {"_id": {"$in": transfer_ids}, "custom_category": None},
                {"$set": {"category": "Transfer"}},
            )
            updated += result.modified_count

        # Pass 2.5: propagate manual overrides
        custom_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": {"$ne": None}},
            {"description": 1, "transaction_type": 1, "custom_category": 1},
        ).to_list(None)

        override_map: dict = defaultdict(Counter)
        for t in custom_txns:
            desc_key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
            if desc_key:
                override_map[(desc_key, t.get("transaction_type", "debit"))][t["custom_category"]] += 1

        if override_map:
            no_custom = await transactions_col.find(
                {"user_id": user_id, "custom_category": None},
                {"_id": 1, "description": 1, "transaction_type": 1, "category": 1},
            ).to_list(None)
            for t in no_custom:
                desc_key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
                key = (desc_key, t.get("transaction_type", "debit"))
                if key not in override_map:
                    continue
                target_cat = override_map[key].most_common(1)[0][0]
                if t.get("category") != target_cat:
                    await transactions_col.update_one(
                        {"_id": t["_id"], "custom_category": None},
                        {"$set": {"category": target_cat}},
                    )
                    updated += 1

    # Pass 3: merchant rules on null/raw/Other
    raw_txns = await transactions_col.find(
        {"user_id": user_id, "custom_category": None,
         "$or": [{"category": None}, {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES) + ["Other"]}}]},
        {"merchant_name": 1, "description": 1, "transaction_type": 1, "category": 1},
    ).to_list(None)

    for t in raw_txns:
        merchant = t.get("merchant_name") or ""
        description = t.get("description", "")
        txn_type = t.get("transaction_type", "debit")
        raw_cat  = t.get("category", "")

        if raw_cat == "TRANSFER":
            cat = "Transfer"
        elif txn_type == "credit" and raw_cat in ("CREDIT", None):
            cat = "Transfer"
        else:
            cat = rule_categorise(merchant, description)
            if cat is None and raw_cat in RAW_TRUELAYER_CATEGORIES:
                cat = "__clear__"

        if cat == "__clear__":
            await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": None}})
            updated += 1
        elif cat:
            await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": cat}})
            updated += 1

    # Pass 3.5: user-defined rules
    user_rules = await user_rules_col.find({"uid": user_id}).to_list(None)
    if user_rules:
        no_custom = await transactions_col.find(
            {"user_id": user_id, "custom_category": None},
            {"_id": 1, "merchant_name": 1, "description": 1, "category": 1},
        ).to_list(None)
        for t in no_custom:
            text = " ".join(filter(None, [t.get("merchant_name"), t.get("description")])).lower()
            for rule in user_rules:
                try:
                    if re.search(rule["pattern"], text, re.IGNORECASE):
                        if t.get("category") != rule["category"]:
                            await transactions_col.update_one(
                                {"_id": t["_id"]}, {"$set": {"category": rule["category"]}}
                            )
                            updated += 1
                        break
                except re.error:
                    continue

    # Pass 4: propagate custom_category to auto-categorised transactions
    user_overrides = await transactions_col.find(
        {"user_id": user_id, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1, "custom_category": 1, "transaction_type": 1},
    ).to_list(None)

    override_map2: dict[tuple[str, str], str] = {}
    for h in user_overrides:
        cat = h["custom_category"]
        txn_type = h.get("transaction_type", "")
        for key in [h.get("merchant_name"), h.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                map_key = (norm, txn_type)
                if norm and map_key not in override_map2:
                    override_map2[map_key] = cat

    if override_map2:
        all_auto = await transactions_col.find(
            {"user_id": user_id, "custom_category": None},
            {"_id": 1, "merchant_name": 1, "description": 1, "category": 1, "transaction_type": 1},
        ).to_list(None)
        for t in all_auto:
            txn_type = t.get("transaction_type", "")
            for key in [t.get("merchant_name"), t.get("description")]:
                if key:
                    norm = re.sub(r'\s+', ' ', key.strip().lower())
                    desired = override_map2.get((norm, txn_type))
                    if desired:
                        if t.get("category") != desired:
                            await transactions_col.update_one(
                                {"_id": t["_id"]}, {"$set": {"category": desired}}
                            )
                            updated += 1
                        break

    return updated


async def categorise_others_bg(uid: str) -> int:
    """LLM-classify transactions still on None/Other across all collections."""
    if not OPENROUTER_API_KEY:
        return 0

    col_map = [transactions_col, statement_transactions_col, mono_transactions_col, mpesa_transactions_col]
    cat_list = ", ".join(VALID_CATEGORIES)
    prompt_prefix = (
        "You are a UK personal finance assistant categorising bank transactions.\n"
        f"Assign each to exactly one of: {cat_list}.\n"
        "Rules:\n"
        "- Eating Out: restaurants, cafes, takeaways, delivery apps\n"
        "- Transport: trains, buses, taxis, Uber, parking, fuel, car-related services\n"
        "- Shopping: retail, online stores, non-food goods, homeware\n"
        "- Bills: utilities, broadband, mobile, insurance, rent, council tax\n"
        "- Subscriptions: streaming, software, recurring digital memberships\n"
        "- Health: hospitals, pharmacies, gyms, dentists, medical services\n"
        "- Travel: flights, hotels, holidays\n"
        "- Transfer: payments between accounts, credit card repayments, personal transfers\n"
        "- Income: salary, refunds, cashback, money received from people\n"
        "- Other: only if genuinely unclassifiable\n"
        "Reply ONLY with JSON: {\"1\": \"Category\", \"2\": \"Category\", ...}\n\nTransactions:\n"
    )

    total_updated = 0
    for col in col_map:
        batch = await col.find(
            {"user_id": uid, "custom_category": None, "ai_attempted": {"$ne": True},
             "category": {"$in": [None, "Other"]}},
            {"merchant_name": 1, "description": 1, "transaction_type": 1},
        ).to_list(80)

        if not batch:
            continue

        seen: dict[str, list] = {}
        for t in batch:
            label = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()[:100]
            seen.setdefault(label, []).append(t["_id"])

        unique_labels = list(seen.keys())
        lines = "\n".join(f"{i+1}. {lbl}" for i, lbl in enumerate(unique_labels))

        try:
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                    json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 600, "temperature": 0,
                          "messages": [{"role": "user", "content": prompt_prefix + lines}]},
                )
            data = r.json()
            if "choices" not in data:
                continue
            raw = data["choices"][0]["message"]["content"].strip()
            if raw.startswith("```"):
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```\s*$', '', raw).strip()
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            if not m:
                continue
            classifications: dict = json.loads(m.group())
        except Exception:
            await col.update_many(
                {"_id": {"$in": [t["_id"] for t in batch]}},
                {"$set": {"ai_attempted": True}},
            )
            continue

        for i, label in enumerate(unique_labels):
            cat = classifications.get(str(i + 1))
            final = cat if (cat and cat in VALID_CATEGORIES) else None
            update: dict = {"ai_attempted": True}
            if final and final != "Other":
                update["category"] = final
                total_updated += len(seen[label])
            await col.update_many({"_id": {"$in": seen[label]}}, {"$set": update})

        reached_ids = {_id for ids in seen.values() for _id in ids}
        all_ids = {t["_id"] for t in batch}
        missed = list(all_ids - reached_ids)
        if missed:
            await col.update_many({"_id": {"$in": missed}}, {"$set": {"ai_attempted": True}})

    return total_updated
