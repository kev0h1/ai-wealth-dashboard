"""Merchant rules, AI categorisation, and rule application logic."""
import re
import json
import logging
from collections import defaultdict, Counter
from datetime import datetime
from typing import Optional
import httpx

from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS, TAVILY_API_KEY
from app.db.collections import (
    transactions_col, accounts_col, user_rules_col, user_profiles_col,
    merchant_categories_col,
    statement_transactions_col, mono_transactions_col, mpesa_transactions_col,
)

RAW_TRUELAYER_CATEGORIES = {
    "BILL_PAYMENT", "DEBIT", "DIRECT_DEBIT", "PURCHASE",
    "STANDING_ORDER", "CREDIT", "TRANSFER",
}

VALID_CATEGORIES = [
    "Groceries", "Eating Out", "Transport", "Entertainment",
    "Shopping", "Bills", "Subscriptions", "Health", "Beauty", "Travel",
    "Software", "Savings", "Investment", "Debt", "Transfer", "Income",
    "Cash", "Charity", "Other",
]

MERCHANT_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'payment received|thank you for payment|card payment received|direct debit payment', re.I), 'Transfer'),
    (re.compile(r'american express.*ddr|amex.*ddr|american express.*direct debit|\bAMERICAN EXPRESS\b', re.I), 'Transfer'),
    (re.compile(r'interest received|interest earned|interest credit|gross interest|net interest|interest payment to you|interest paid to you|credit interest', re.I), 'Income'),
    (re.compile(r'\bmarcus\b', re.I), 'Transfer'),
    (re.compile(r'nw world mastercar|natwest.*mastercard|world mastercard payment', re.I), 'Debt'),

    (re.compile(r'tesco|sainsbury|asda|morrisons?|waitrose|lidl|aldi|iceland food|co-?op\b|ocado|farmfoods|marks.{0,5}spencer food|m&s food|whole foods|budgens|londis|spar\b|nisa\b|costco', re.I), 'Groceries'),
    (re.compile(r"mcdonald'?s?|kfc\b|starbucks|costa coffee|pret\b|nando'?s?|pizza\b|burger king|subway\b|deliveroo|just.?eat|uber.{0,5}eat|ubereats|greggs|domino'?s?|papa.?john|wagamama|itsu\b|leon\b|five.?guys|wetherspoon|yo.?sushi|wasabi|eat\b|caffe nero|cafe\b|restaurant|bistro|brasserie|food.?delivery|hungry.?house|cabana\b|dishoom|hawksmoor|bills restaurant|turtle bay|wahaca|zizzi\b|bella italia|frankie|benny|carluccio|harvester\b|toby carvery|ember inns|mitchells.?butlers|stonehouse\b|vintage inns", re.I), 'Eating Out'),
    (re.compile(r'tfl\b|transport for london|oyster|uber\b|bolt\b|trainline|national rail|avanti|lner\b|cross.?country|great western|south western|south.?eastern|northern rail|arriva|stagecoach|first.?bus|megabus|national express|eurostar|heathrow express|gatwick express|stansted express|go.?ahead|chiltern rail|trainpal|train pal|railcard|splittickets|railsmartr|seatfrog', re.I), 'Transport'),
    (re.compile(r'\bbp\b|shell\b|esso\b|total energies|texaco|gulf\b|moto\b|roadchef|welcome break|petrol|fuel\b|\bparking\b|ncp\b|q-park|ringgo|paybyphone|car.?par\b|car.?park|airparks|purple.?parking|jfk.?park|airport.?park|birmingham.?int.*car|int.*car.*par', re.I), 'Transport'),
    (re.compile(r'netflix|spotify|disney\+?|amazon prime|apple music|youtube.?premium|google\*youtube|now tv|now\.tv|apple.?one|apple\.?com/bill|apple tv\+?|hulu|paramount\+?|bbc sounds|audible|kindle unlimited|duolingo|headspace|calm\b|grammarly|canva\b|adobe\b|microsoft 365|office 365|dropbox|icloud|google one|playstation|psn\b|ps\+|xbox.?game.?pass|nintendo online|nintendo switch online|twitch|squarespace|\bsqsp\b|claude\.ai|anthropic\b', re.I), 'Subscriptions'),
    (re.compile(r'odeon|vue cinema|cineworld|curzon|everyman cinema|ticketmaster|see.?tickets|eventbrite|sky sports|bt sport|dazn\b|steam\b|epic games|xbox store|nintendo eshop|nintendo\b|google play|app store|museum|theatre|gallery|gig\b|concert', re.I), 'Entertainment'),
    # Beauty before Shopping/Health so specialist retailers and salons win the match
    (re.compile(r'lush\b|the body shop|superdrug(?! pharmacy)|sephora|space ?nk|lookfantastic|look fantastic|cult ?beauty|beauty ?bay|feelunique|glossier|charlotte tilbury|the perfume shop|fragrance (?:shop|direct)|jo malone|molton brown|rituals\b|kiko milano|barber|hairdress|hair (?:salon|studio|lounge|cuttery)|\bsalon\b|toni ?& ?guy|supercuts|headmasters|rush hair|regis hair|nail (?:bar|salon|studio|lounge)|\bnails\b|manicure|pedicure|waxing|\bbrows?\b|\blashes\b|tanning|\bspa\b|treatwell|fresha\b|booksy|beautician|aesthetics\b|cosmetics\b', re.I), 'Beauty'),
    (re.compile(r'\bamazon\b(?!.*prime)|\bamzn\b|amazon marketplace|amznmkt|asos\b|zara\b|h&m\b|h and m|next\b|john lewis|argos\b|currys\b|pc world|ebay\b|very\b|boohoo|river island|topshop|primark|tkmaxx|tk maxx|matalan|new look|sports direct|jd sports|foot locker|footlocker|nike\b|adidas\b|vinted\b|etsy\b|zalando|prettylittlething|shein\b|uniqlo|gap\b|holland.?barrett|boots(?! pharmacy)|dunelm\b|habitat\b|b&q\b|homebase\b|wickes\b|screwfix|toolstation|ikea\b|wayfair|made\.com|next\.co|very\.co|littlewoods|kaleidoscope|qvc\b|ao\.com|\bao\b appliances|smyths|toy.?r.?us|the range\b|homebargains|home bargains|pound.?land|poundworld|savers\b', re.I), 'Shopping'),
    (re.compile(r'british gas|octopus energy|edf energy|e\.?on\b|scottish power|npower|bulb\b|ovo energy|shell energy|thames water|severn trent|yorkshire water|united utilities|south west water|bt group\b|bt broadband|virgin media|sky\b|vodafone|ee\b|o2\b|three\b|giffgaff|lycamobile|lyca mobile|lebara|voxi\b|smarty\b|talktalk|plusnet|now broadband|council tax|tv licence|water bill|electricity bill|gas bill|broadband|metropoli.*council|borough council|city council|district council|county council|local authority', re.I), 'Bills'),
    (re.compile(r'boots pharmacy|lloyds pharmacy|superdrug|pharmacy|chemist|puregym|the gym\b|gym ltd|gym group|anytime fitness|jd gyms|david lloyd|virgin active|planet fitness|nuffield health|bannatyne|snap fitness|dentist|dental|doctor\b|gp\b|nhs\b|hospital|optician|specsavers|vision express|holland.?barrett|vitabiotics|protein|\bspire\s+\w+|bupa\b|axa health|vitality health|aviva health|private.?health|medical.?centre|walk.?in.?centre|urgent.?care|physiotherapy|physio\b|osteopath|chiropractor|acupuncture|counselling|therapy\b|mental health', re.I), 'Health'),
    (re.compile(r'airbnb|booking\.com|hotels\.com|expedia|trivago|ryanair|easyjet|british airways|jet2|tui\b|virgin atlantic|wizz air|blue air|hilton|marriott|premier inn|travelodge|holiday inn|ibis\b|accor|airfare|holiday|travel insurance', re.I), 'Travel'),
    (re.compile(r'github\b|digitalocean|aws\b|amazon web services|google cloud|azure\b|heroku|netlify|vercel|cloudflare|linode|hetzner|namecheap|godaddy|1password|lastpass|dashlane|bitwarden|notion\b|figma\b|slack\b|zoom\b|webflow|railway\b|supabase|mongodb atlas|datadog|sentry\b|linear\b', re.I), 'Software'),
    (re.compile(r'vanguard|nutmeg|wealthify|wealthsimple|hargreaves lansdown|hl invest|fidelity|trading ?212|freetrade|interactive investor|\bii\b', re.I), 'Investment'),
    (re.compile(r'\bsavings?\b|\bsaver\b|isa|moneybox|plum\b|chip\b|pension', re.I), 'Savings'),
    (re.compile(r'interest on your|interest charge|late fee|overdraft fee|annual fee|card fee|bank charge', re.I), 'Bills'),
    (re.compile(r'balance transfer|internal transfer|faster payment|bacs payment|chaps payment|from .* pot\b', re.I), 'Transfer'),

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
    (re.compile(r'from .* pot\b|transfer\s+from\s+(?:\w+\s+)*pot\b|to\s+(?:\w+\s+)*pot\b|pot.?transfer|pot.?withdrawal|pot.?deposit', re.I), 'Transfer'),
    (re.compile(r'post office\b|royal mail\b|parcelforce', re.I), 'Shopping'),
    (re.compile(r'\bperks?\b|cashback\b|reward.?payment|loyalty.?reward', re.I), 'Income'),
]


def rule_categorise(merchant: str, description: str) -> Optional[str]:
    text = f"{merchant} {description}"
    for pattern, category in MERCHANT_PATTERNS:
        if pattern.search(text):
            return category
    return None


async def user_identity(user_id: str) -> dict:
    """Name tokens (from profile) + the user's own account number/sort-code
    digit strings (from their TrueLayer accounts). Used to classify FT transfers.

    Also builds "own_map": digit-string -> {"account_id", "type", "subtype"}
    so a hit can be resolved back to the specific destination account (needed
    to refine own-transfers into Savings/Debt by destination account type)."""
    profile = await user_profiles_col.find_one({"_id": user_id}) or {}
    name_tokens = profile.get("name_tokens", [])
    own_ids: set[str] = set()
    own_map: dict[str, dict] = {}
    async for a in accounts_col.find(
        {"user_id": user_id},
        {"account_number": 1, "sort_code": 1, "type": 1, "subtype": 1},
    ):
        for field in ("account_number", "sort_code"):
            digits = re.sub(r"\D", "", str(a.get(field) or ""))
            if len(digits) >= 6:
                own_ids.add(digits)
                own_map[digits] = {
                    "account_id": a["_id"],
                    "type": a.get("type"),
                    "subtype": a.get("subtype"),
                }
    return {"name_tokens": name_tokens, "own_ids": own_ids, "own_map": own_map}


def _name_token_hits(description: str, name_tokens: list[str]) -> set:
    """Return a set of indices into name_tokens whose token fuzzy-matches any
    word in the description.  A match is a >=3-char prefix overlap either way
    (so 'MAING' matches 'maingi' and vice-versa).  Only words of length >=3
    are considered for full-token matching."""
    words = re.split(r"[^a-zA-Z]+", description.lower())
    words = [w for w in words if len(w) >= 3]
    matched_indices: set = set()
    for idx, tok in enumerate(name_tokens):
        if any(w == tok or w.startswith(tok) or tok.startswith(w) for w in words):
            matched_indices.add(idx)
    return matched_indices


def name_matches_owner(text: str, name_tokens: list[str]) -> bool:
    """Does this text carry the user's own name?

    Rules:
    1. Return False when fewer than 2 name tokens are available.
    2. Two or more distinct token indices fully matched → True.
    3. Exactly one token index matched → True only if a standalone
       single-letter word in text equals the first letter of a *different*
       (unmatched) token.  'Maingi M' is False because 'M' is the initial of
       the matched token itself, not of another token.
    4. Otherwise False.
    """
    if len(name_tokens) < 2:
        return False
    matched = _name_token_hits(text, name_tokens)
    if len(matched) >= 2:
        return True
    if len(matched) == 0:
        return False
    # Exactly one full match — look for an initial from a *different* token.
    unmatched_initials = {
        name_tokens[i][0]
        for i in range(len(name_tokens))
        if i not in matched and name_tokens[i]
    }
    words = re.split(r"[^a-zA-Z]+", text.lower())
    return any(w for w in words if len(w) == 1 and w in unmatched_initials)


def is_own_transfer(text: str, identity: dict, own_account_id=None) -> bool:
    """True when a payment is corroborated as moving between the user's own
    accounts: their own account/sort-code digits, or their own name.
    With no identity data at all we can't judge — treat as own (legacy).

    own_account_id: the account this txn is booked on. Its own number/sort-code
    is ignored as evidence because banks echo the host account's own number
    into its narrative (e.g. "27MAR A/C 76526682" on account 76526682 itself),
    which is not evidence of a move BETWEEN the user's accounts. Digits
    belonging to any OTHER own account still count as transfer evidence."""
    if not identity["name_tokens"] and not identity["own_ids"]:
        return True
    digits = set(re.findall(r"\d{6,}", text))
    own_map = identity.get("own_map") or {}
    for oid in identity["own_ids"]:
        if oid not in digits:
            continue
        if own_account_id is not None and own_map.get(oid, {}).get("account_id") == own_account_id:
            continue  # self-reference: host account echoing its own number
        return True
    return name_matches_owner(text, identity["name_tokens"])


def classify_ft(description: str, amount: float, identity: dict, own_account_id=None) -> Optional[str]:
    """Classify a TrueLayer 'FT' (funds transfer) transaction.
    Returns a category, or None if the description isn't an FT line."""
    desc = (description or "").strip()
    if not re.search(r"\bFT\s*$", desc, re.I):
        return None
    digits_in_desc = set(re.findall(r"\d{6,}", desc))
    own_map = identity.get("own_map") or {}
    for oid in identity["own_ids"]:
        if oid not in digits_in_desc:
            continue
        if own_account_id is not None and own_map.get(oid, {}).get("account_id") == own_account_id:
            continue  # self-reference: host account echoing its own number
        return "Transfer"
    # The Income/Other split hinges on the name not matching, which is only
    # meaningful once we know the user's name. Until then, leave it be.
    if not identity["name_tokens"]:
        return None
    if name_matches_owner(desc, identity["name_tokens"]):
        return "Transfer"
    return "Income" if amount > 0 else "Other"


# Barclays-style trailing channel codes (mechanism, not merchant) — see project notes.
_CHANNEL_CODES = {
    "FT", "CPM", "BCC", "BGC", "DDR", "STO", "CLP", "CB",
    "FP", "FPI", "FPO", "BP", "TFR", "DD", "SO",
}

# Bank-statement date fragments: '29MAY', '29 MAY', 'ON 05 JUN 26'. They change
# every billing cycle, so any key or match that includes one can never learn.
_MONTHS = r'(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)'
DATE_FRAGMENT_RE = re.compile(r'\b(?:ON\s+)?\d{1,2}\s*' + _MONTHS + r'(?:\s*\d{2,4})?\b', re.I)
# For prefix-anchored similar-matching: an optional leading date on stored rows
LEADING_DATE_RE = r'(?:(?:ON\s+)?\d{1,2}\s*' + _MONTHS + r'(?:\s*\d{2,4})?\s+)?'


def strip_date_fragments(text: str) -> str:
    """Remove date fragments anywhere in the text (leading, trailing, embedded)."""
    return re.sub(r'\s{2,}', ' ', DATE_FRAGMENT_RE.sub(' ', text or '')).strip()


# Numeric date fragments: '29/06', '29-06-26', '31/07/2026'. Day and month
# ranges are enforced so sort codes ('60-15-33') and card refs survive.
NUMERIC_DATE_RE = re.compile(
    r'\b(?:3[01]|[12]\d|0?[1-9])[/\-](?:1[0-2]|0?[1-9])(?:[/\-]\d{2}(?:\d{2})?)?\b'
)


def has_date_fragment(text: str) -> bool:
    """True when the text contains a statement date fragment (word or numeric)."""
    t = text or ""
    return bool(DATE_FRAGMENT_RE.search(t) or NUMERIC_DATE_RE.search(t))


def series_key(txn: dict) -> str:
    """Stable recurrence-series key for a transaction.

    merchant_name when present; otherwise the description with date fragments
    ('29JUN', 'ON 3 JUN 25', '29/06', '29-06-26') stripped BEFORE the 35-char
    cut, so date-stamped statement lines ('29APR A/C 76526682',
    '29MAY A/C 76526682') collapse to one series instead of one ghost series
    per billing cycle. Descriptions without date fragments keep their exact
    historical key (slice-then-strip), so stored references stay valid.
    """
    m = (txn.get("merchant_name") or "").strip()
    if m:
        return m
    desc = txn.get("description") or ""
    cleaned = NUMERIC_DATE_RE.sub(" ", DATE_FRAGMENT_RE.sub(" ", desc))
    if cleaned == desc:
        return desc[:35].strip()
    return re.sub(r"\s{2,}", " ", cleaned).strip()[:35].strip()


def normalise_merchant(merchant: str, description: str = "") -> str:
    """Reduce a merchant/description to a stable lowercase key for cache lookup.

    Prefers a real merchant name; otherwise strips the statement template noise
    (date fragments anywhere, reference numbers, channel codes) so
    '29APR A/C 76526682' and '29MAY A/C 76526682' collapse to the same key.
    """
    base = (merchant or "").strip()
    if not base:
        base = strip_date_fragments((description or "").strip())
        # Drop long reference/card numbers — but only when enough alphabetic
        # identity remains. For keys like 'A/C 76526682' the number IS the
        # stable identity and must be kept.
        without_numbers = re.sub(r'\s+\d{4,}\b', ' ', base)
        if len(re.sub(r'[^a-zA-Z]', '', without_numbers)) >= 4:
            base = without_numbers
        # Peel off one or more trailing known channel codes.
        while True:
            m = re.search(r'\s+([A-Za-z]{2,4})\s*$', base)
            if m and m.group(1).upper() in _CHANNEL_CODES:
                base = base[:m.start()]
            else:
                break
    key = re.sub(r'[^a-z0-9]+', ' ', base.lower()).strip()
    return re.sub(r'\s+', ' ', key)


async def cache_merchant(key: str, category: str, source: str, uid: str | None = None) -> None:
    """Persist a merchant->category decision. 'user' entries win: an 'llm' write
    will not overwrite a category a user has explicitly corrected.
    When uid is given the entry is scoped to that user (id = uid::key) so that
    name-based decisions don't leak between users."""
    if not key or category not in VALID_CATEGORIES:
        return
    store_id = f"{uid}::{key}" if uid else key
    if source != "user":
        existing = await merchant_categories_col.find_one({"_id": store_id}, {"source": 1})
        if existing and existing.get("source") == "user":
            return
    doc = {"category": category, "source": source, "updated_at": datetime.utcnow()}
    if uid:
        doc["uid"] = uid
    await merchant_categories_col.update_one(
        {"_id": store_id},
        {"$set": doc},
        upsert=True,
    )


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
        # Pass 0: classify FT (funds transfer) lines via the user's identity
        identity = await user_identity(user_id)
        ft_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": None,
             "description": {"$regex": r"FT\s*$", "$options": "i"}},
            {"description": 1, "amount": 1, "transaction_type": 1, "category": 1, "account_id": 1},
        ).to_list(None)
        for t in ft_txns:
            signed = t["amount"] if t.get("transaction_type") == "credit" else -t["amount"]
            cat = classify_ft(t.get("description", ""), signed, identity, own_account_id=t.get("account_id"))
            if cat and t.get("category") != cat:
                await transactions_col.update_one(
                    {"_id": t["_id"], "custom_category": None},
                    {"$set": {"category": cat}},
                )
                updated += 1

        # Pass 1: credits on CC accounts → Transfer ONLY when text matches payment wording
        # (refunds and other credits are left as Income for the LLM path)
        CC_PAYMENT_RE = re.compile(
            r'payment received|thank you for.{0,15}payment|card payment received|'
            r'direct debit|faster payment|bank transfer|payment - thank you',
            re.I,
        )
        cc_ids = [d["_id"] async for d in accounts_col.find({"user_id": user_id, "type": "credit_card"}, {"_id": 1})]
        if cc_ids:
            cc_credits = await transactions_col.find(
                {"user_id": user_id, "account_id": {"$in": cc_ids},
                 "transaction_type": "credit", "category": "Income", "custom_category": None},
                {"_id": 1, "merchant_name": 1, "description": 1},
            ).to_list(None)
            cc_transfer_ids = []
            for t in cc_credits:
                text = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()
                if CC_PAYMENT_RE.search(text):
                    cc_transfer_ids.append(t["_id"])
            if cc_transfer_ids:
                result = await transactions_col.update_many(
                    {"_id": {"$in": cc_transfer_ids}, "custom_category": None},
                    {"$set": {"category": "Transfer"}},
                )
                updated += result.modified_count

        # Pass 2: match transfer pairs
        all_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": None, "description": {"$ne": None}},
            {"description": 1, "amount": 1, "transaction_type": 1, "date": 1, "category": 1, "account_id": 1},
        ).to_list(None)

        desc_map: dict = defaultdict(list)
        for t in all_txns:
            key = re.sub(r'\s+', ' ', (t.get("description") or "").strip().lower())
            if key:
                desc_map[key].append(t)

        transfer_ids = []
        transfer_pairs = []  # (credit_txn, debit_txn) — the matched pairs, for Pass 2.6
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
                            transfer_pairs.append((c, d))
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

        # Pass 2.6: refine own-transfers into Savings/Debt by placing the
        # intent on the CURRENT-account leg, in BOTH directions. For a
        # matched own-transfer pair, whichever leg sits on the SAVINGS/ISA
        # or CREDIT-CARD account always stays "Transfer"; the OTHER leg (the
        # current account) carries the intent:
        #
        #   direction            | current leg      | savings/card leg
        #   ----------------------|-------------------|------------------
        #   current -> savings   | debit  -> Savings | credit -> Transfer
        #   savings -> current   | credit -> Savings | debit  -> Transfer
        #   current -> card      | debit  -> Debt    | credit -> Transfer
        #   card -> current      | credit -> Debt    | debit  -> Transfer
        #
        # This is never "Income" — both legs are internal movements of the
        # user's own money. Savings/Debt are not in RAW_TRUELAYER_CATEGORIES,
        # so Pass 3 below leaves these rows alone.
        from app.services.companion import _is_savings  # deferred: companion -> analytics -> categorisation

        acct_lookup = {
            str(acc["_id"]): acc
            async for acc in accounts_col.find(
                {"user_id": user_id}, {"type": 1, "subtype": 1}
            )
        }

        def _refine_target(account_id) -> Optional[str]:
            acc = acct_lookup.get(str(account_id)) if account_id else None
            if not acc:
                return None
            if _is_savings(acc):
                return "Savings"
            if (acc.get("type") or "") == "credit_card":
                return "Debt"
            return None

        refine_targets: dict = {}  # _id -> target category

        # 2.6a: transfer pairs matched in Pass 2 (c=credit leg, d=debit leg).
        # Figure out which leg (if either) sits on a savings/card account;
        # the OTHER leg is the current-account side and gets the intent.
        # These pairs were just set to "Transfer" by Pass 2 in the DB; the
        # in-memory `c`/`d` dicts still hold their pre-Pass-2 category, so we
        # must NOT gate on category here (that stale read skips fresh pairs
        # on their first sync). The update_many below filters on the DB's
        # current category == "Transfer", which is the real guard.
        for c, d in transfer_pairs:
            c_target = _refine_target(c.get("account_id"))
            d_target = _refine_target(d.get("account_id"))
            if c_target and not d_target:
                # credit leg is on savings/card (money arriving there from
                # current) -> the debit (current) leg carries the intent.
                refine_targets[d["_id"]] = c_target
            elif d_target and not c_target:
                # debit leg is on savings/card (money leaving there into
                # current) -> the credit (current) leg carries the intent.
                refine_targets[c["_id"]] = d_target
            # if both legs are savings/card, or neither is, leave both as Transfer

        # 2.6b: classify_ft own-account digit hits — resolve the matched
        # digit string back to the specific counterparty account via
        # own_map. Works in both directions: skip a txn if it is itself on
        # the savings/card account (that's the side that stays "Transfer");
        # otherwise it's the current-account leg, so stamp it with the
        # counterparty account's target.
        own_map = identity.get("own_map") or {}
        if own_map:
            transfer_txns = await transactions_col.find(
                {"user_id": user_id, "custom_category": None,
                 "category": "Transfer"},
                {"description": 1, "account_id": 1},
            ).to_list(None)
            for t in transfer_txns:
                if _refine_target(t.get("account_id")) is not None:
                    # this txn is itself on the savings/card account leg
                    continue
                digits_in_desc = set(re.findall(r"\d{6,}", t.get("description") or ""))
                hit = digits_in_desc & own_map.keys()
                if not hit:
                    continue
                matched_acc = own_map[next(iter(hit))]
                target = _refine_target(matched_acc.get("account_id"))
                if target:
                    refine_targets.setdefault(t["_id"], target)

        if refine_targets:
            by_target: dict = defaultdict(list)
            for _id, target in refine_targets.items():
                by_target[target].append(_id)
            for target, ids in by_target.items():
                result = await transactions_col.update_many(
                    {"_id": {"$in": ids}, "custom_category": None, "category": "Transfer"},
                    {"$set": {"category": target}},
                )
                updated += result.modified_count

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
            # Own-account transfers are already caught above (raw TRANSFER) and by the
            # FT/identity rule. A remaining incoming credit is income unless a rule
            # refines it (e.g. a merchant refund nets against its category).
            _match = rule_categorise(merchant, description)
            cat = _match if _match else "Income"
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

    # Pass 3.4: learned merchant cache (persisted LLM + user decisions)
    # Load global entries (no uid field) + user-scoped entries for this user.
    # User-scoped entries take priority (name-based decisions must not cross users).
    all_cache_docs = await merchant_categories_col.find(
        {"$or": [{"uid": {"$exists": False}}, {"uid": user_id}]},
        {"category": 1, "uid": 1},
    ).to_list(None)
    cache: dict[str, str] = {}
    user_cache: dict[str, str] = {}
    for d in all_cache_docs:
        if d.get("category") not in VALID_CATEGORIES:
            continue
        raw_id: str = d["_id"]
        if d.get("uid") == user_id:
            # User-scoped: strip the "uid::" prefix to get bare normalised key
            bare = raw_id[len(user_id) + 2:] if raw_id.startswith(f"{user_id}::") else raw_id
            user_cache[bare] = d["category"]
        else:
            cache[raw_id] = d["category"]
    # Merge: user-scoped wins
    merged_cache = {**cache, **user_cache}
    if merged_cache:
        cache_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": None,
             "$or": [{"category": None}, {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES) + ["Other"]}}]},
            {"merchant_name": 1, "description": 1, "category": 1},
        ).to_list(None)
        for t in cache_txns:
            cat = merged_cache.get(normalise_merchant(t.get("merchant_name") or "", t.get("description") or ""))
            if cat and t.get("category") != cat:
                await transactions_col.update_one(
                    {"_id": t["_id"], "custom_category": None},
                    {"$set": {"category": cat}},
                )
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
    identity = await user_identity(uid)
    owner_name = " ".join(t.capitalize() for t in identity["name_tokens"]) if identity["name_tokens"] else None

    col_map = [transactions_col, statement_transactions_col, mono_transactions_col, mpesa_transactions_col]
    # Structural / money-to-self categories (Transfer, Savings, Debt, Investment) are
    # assigned deterministically by earlier passes (Pass 2 / 2.6) and must never be
    # something the LLM guesses at — exclude them from the list it's allowed to pick.
    cat_list = ", ".join(c for c in VALID_CATEGORIES if c not in {"Transfer", "Savings", "Debt", "Investment"})
    _name_clause = (
        f"- The account owner's name is {owner_name}. "
        "A credit into a bank account whose text does NOT reference the owner's name → Income.\n"
    ) if owner_name else ""
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
        "- Income: salary, refunds, cashback, money received from people\n"
        f"{_name_clause}"
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
                          "messages": [{"role": "user", "content": prompt_prefix + lines}],
                          "provider": OPENROUTER_PROVIDER_PREFS},
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
            if cat in {"Transfer", "Savings", "Debt", "Investment"}:
                # Defensive: these are structural/money-to-self categories the LLM was
                # never offered (see cat_list above) but may still hallucinate. Never
                # let a hallucinated answer land here — fall back to Other.
                cat = "Other"
            final = cat if (cat and cat in VALID_CATEGORIES) else None
            update: dict = {"ai_attempted": True}
            if final and final != "Other":
                update["category"] = final
                total_updated += len(seen[label])
                await cache_merchant(normalise_merchant("", label), final, "llm")
            await col.update_many({"_id": {"$in": seen[label]}}, {"$set": update})

        reached_ids = {_id for ids in seen.values() for _id in ids}
        all_ids = {t["_id"] for t in batch}
        missed = list(all_ids - reached_ids)
        if missed:
            await col.update_many({"_id": {"$in": missed}}, {"$set": {"ai_attempted": True}})

    return total_updated


async def llm_name_check(uid: str) -> int:
    """LLM pass that judges whether a transaction references the account owner's name.

    Prefilter: any transaction (custom_category=None, not already Transfer) whose
    merchant/description has a >=3-char prefix overlap with any name token, OR whose
    text contains a standalone initial matching a name token's first letter.
    LLM: batched Haiku call asking whether the text references the owner; result
    stored in user-scoped cache so decisions never leak between users.
    Returns count of updated transactions.
    """
    if not OPENROUTER_API_KEY:
        return 0

    identity = await user_identity(uid)
    name_tokens = identity["name_tokens"]
    if not name_tokens:
        return 0

    owner_name = " ".join(t.capitalize() for t in name_tokens)
    cat_list = ", ".join(VALID_CATEGORIES)

    # --- Prefilter: pull candidates from transactions_col only (primary data source)
    candidates_raw = await transactions_col.find(
        {"user_id": uid, "custom_category": None,
         "category": {"$nin": ["Transfer"]}},
        {"merchant_name": 1, "description": 1, "transaction_type": 1,
         "amount": 1, "category": 1},
    ).to_list(None)

    # Python-side fuzzy prefilter using existing _name_token_hits
    candidates = []
    for t in candidates_raw:
        text = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()
        # Also check for standalone initials of any name token
        hits = _name_token_hits(text, name_tokens)
        if hits:
            candidates.append(t)
            continue
        # Standalone initial check
        words = re.split(r"[^a-zA-Z]+", text.lower())
        initials = {tok[0] for tok in name_tokens if tok}
        if any(w for w in words if len(w) == 1 and w in initials):
            candidates.append(t)

    log = logging.getLogger(__name__)
    log.info("llm_name_check uid=%s prefilter_candidates=%d", uid, len(candidates))

    if not candidates:
        return 0

    # --- Batch LLM calls (up to 40 per call)
    BATCH_SIZE = 40
    total_updated = 0
    flip_counts: dict[str, int] = {}
    spot_examples: list[dict] = []

    prompt_prefix = (
        f"The account owner's full name is: {owner_name}.\n"
        "For each transaction below, decide:\n"
        "1. Does this transaction's text reference the account owner's name "
        "(full name, first name only, last name only, initials, or truncated)?\n"
        "   - If YES and it is a credit (money in) → Transfer (between own accounts)\n"
        "   - If YES and it is a debit (money out) → Transfer\n"
        "2. If NO reference to the owner's name:\n"
        "   - A credit into a bank account (money in, not from owner) → Income\n"
        f"   - Otherwise assign the best category from: {cat_list}\n"
        "Reply ONLY with JSON: {\"1\": \"Category\", \"2\": \"Category\", ...}\n\n"
        "Transactions:\n"
    )

    for batch_start in range(0, len(candidates), BATCH_SIZE):
        batch = candidates[batch_start: batch_start + BATCH_SIZE]

        lines_data = []
        for t in batch:
            direction = "credit (money in)" if t.get("transaction_type") == "credit" else "debit (money out)"
            amt = t.get("amount", 0)
            desc = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()[:120]
            lines_data.append({"id": t["_id"], "desc": desc, "direction": direction, "amount": amt, "old_cat": t.get("category")})

        lines_text = "\n".join(
            f"{i+1}. [{d['direction']}, £{d['amount']:.2f}] {d['desc']}"
            for i, d in enumerate(lines_data)
        )

        try:
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                    json={
                        "model": "anthropic/claude-haiku-4-5",
                        "max_tokens": 600,
                        "temperature": 0,
                        "messages": [{"role": "user", "content": prompt_prefix + lines_text}],
                        "provider": OPENROUTER_PROVIDER_PREFS,
                    },
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
        except Exception as exc:
            log.warning("llm_name_check batch error: %s", exc)
            continue

        for i, d in enumerate(lines_data):
            cat = classifications.get(str(i + 1))
            if not cat or cat not in VALID_CATEGORIES:
                continue
            old_cat = d["old_cat"]
            if cat == old_cat:
                continue
            # Apply
            result = await transactions_col.update_one(
                {"_id": d["id"], "custom_category": None},
                {"$set": {"category": cat}},
            )
            if result.modified_count:
                total_updated += 1
                flip_key = f"{old_cat or 'None'} → {cat}"
                flip_counts[flip_key] = flip_counts.get(flip_key, 0) + 1
                # Cache user-scoped so future syncs don't re-ask
                norm_key = normalise_merchant("", d["desc"])
                if norm_key:
                    await cache_merchant(norm_key, cat, "llm", uid=uid)
                # Collect up to 5 spot-check examples
                if len(spot_examples) < 5:
                    spot_examples.append({
                        "description": d["desc"],
                        "direction": d["direction"],
                        "amount": d["amount"],
                        "old_category": old_cat,
                        "new_category": cat,
                    })

    log.info(
        "llm_name_check uid=%s examined=%d flips=%s examples=%s",
        uid, len(candidates), flip_counts, spot_examples,
    )
    return total_updated
