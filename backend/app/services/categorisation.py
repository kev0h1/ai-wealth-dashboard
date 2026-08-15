"""Merchant rules, AI categorisation, and rule application logic."""
import re
import json
import logging
import unicodedata
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
from app.services.categories import get_category_kinds, MOVEMENT

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
    "FP", "FPI", "FPO", "BP", "TFR", "DD", "SO", "CNP",
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


# --- canonical_merchant_key -------------------------------------------------
# ENGINE.md "Identity" stage: ONE shared merchant identity, stored on every
# transaction at sync time, so the similar-endpoint, the learned cache and the
# override propagation passes all agree that five differently-formatted
# statement lines are the same merchant. `normalise_merchant` above stays
# as-is (tested, still used nowhere critical to identity) — this supersedes
# it for every identity/cache purpose.

# Card-machine / POS-aggregator prefixes: the text BEFORE these markers is the
# processor's own name, not the merchant — e.g. "SQ *INDIAN BREWERY" is a
# Square terminal charging for "Indian Brewery"; "TST-Reginas" is Toast POS
# for "Reginas". Keep the TAIL for these, unlike the generic */# rule below.
# PAYPAL/GOOGLE/UBER are the same shape: "PAYPAL *TRAINLINE" is PayPal's own
# checkout wrapper for Trainline, "GOOGLE*YOUTUBEPREMIUM" is Google Play
# billing for YouTube Premium, "UBER *EATS"/"UBER *TRIP" are Uber's own app
# billing two different real services through one storefront name. Without
# this, the generic */# head-or-tail rule below keeps the head ("PAYPAL",
# "GOOGLE", "UBER") and collapses every merchant behind the wrapper into one
# key (confirmed: 43 live PAYPAL* rows -> 'paypal' spanning Trainline,
# DisneyPlus, Cernucci jewellery...; 24 GOOGLE* rows -> 'google'; 26 UBER*
# rows -> 'uber' conflating Uber Eats with Uber rides).
_PROCESSOR_PREFIX_RE = re.compile(
    r'^(?:DOJO\*|SQ \*|SQSP\*|Zettle_\*|TST-|SP |PAYPAL\s*\*\s*|GOOGLE\s*\*\s*|UBER\s*\*\s*)',
    re.I,
)

# A leading bank card-fragment ('9896 04JUN26 ', '1917 11JUN26 D ') sits
# BEFORE the processor prefix on some statement lines, which stops
# _PROCESSOR_PREFIX_RE (anchored at the start) from ever matching — e.g.
# '9896 04JUN26 PAYPAL *TRAINLINE' would otherwise key differently from
# 'PAYPAL *DISNEYPLUS' purely because one has the card fragment and the other
# doesn't. Strip it first so the real prefix/merchant match lines up. The
# optional flag is a known transaction-type marker (C/D/CD), never a real
# word (a genuine merchant starting with "The..." is NOT consumed — see
# tests).
_LEADING_CARD_DATE_RE = re.compile(
    r'^\d{4}\s+\d{1,2}[A-Za-z]{3}\d{2,4}\s+(?:(?:CD|C|D)\s+)?', re.I
)

# A trailing channel code ('FP', mechanism for Faster Payment) sometimes has
# no space before it on the statement ('CHIGOMEZYO GONDWEFP 01/06/26 30 ...'
# vs 'CHIGOMEZYO GONDWE FP 01/06/26 30 ...') — same payee, would otherwise key
# differently. Narrowly scoped to the "<name>FP <DD/MM/YY>" shape (a real bank
# faster-payment narrative), so it never touches an unrelated word that
# happens to end in "fp".
_GLUED_CHANNEL_CODE_RE = re.compile(r'(?<=[A-Za-z])(FP)(?=\s+\d{1,2}/\d{1,2}/\d{2,4}\b)', re.I)

# FX conversion boilerplate: "AMOUNT IN USD 52.75 ON 08 APR VISA 1.3208 FINAL
# GBP AMOUNT INCLUDES NON-STERLING TRANS FEE £1.19 [BCC]" — everything from
# "AMOUNT IN <CCY>" to the end of the line is mechanism, not merchant.
_FX_BOILERPLATE_RE = re.compile(r'\bAMOUNT\s+IN\s+[A-Z]{3}\b.*$', re.I | re.S)

# Monzo pot-funded purchases: "West Midlands Golf Club from Fun stuff Pot" —
# the pot name is bookkeeping, not merchant identity.
_MONZO_POT_SUFFIX_RE = re.compile(r'\s+from\s+.+?\s+pot\s*$', re.I)

# Bare URLs and merchant.tld[/path] domains — 'PLAYTOMIC.IO', 'BOLT.EU/O/123',
# 'DIGITALOCEAN.COM' should all identify as the bare word.
_BARE_URL_RE = re.compile(r'https?://\S+', re.I)
_DOMAIN_SUFFIX_RE = re.compile(
    r'\b([A-Za-z][A-Za-z0-9-]{1,30})\.(?:co\.uk|com|io|eu|net|org|app|co|me|ai)\b(?:/\S*)?',
    re.I,
)

# Card-terminal country annotations on FX/international rows, e.g. "...SPAIN
# ON 25 FEB BCC" or "...HONG KONG ON 21 FEB BCC". A small closed vocabulary —
# stripping any capitalised trailing word would wreck real one-word merchants
# ('KFC ON 25 MAY CPM', 'MOONPIG ON 06 APR CPM', 'VANGUARD ON 28 FEB BCC').
_MULTI_WORD_COUNTRIES = (
    "UNITED KINGDOM", "UNITED STATES", "UNITED ARAB EMIRATES", "HONG KONG",
    "SOUTH AFRICA", "SOUTH KOREA", "NORTH KOREA", "NEW ZEALAND",
    "SAUDI ARABIA", "COSTA RICA", "SRI LANKA", "EL SALVADOR", "PUERTO RICO",
    "DOMINICAN REPUBLIC", "CZECH REPUBLIC", "IVORY COAST",
)
# Spelled-out single-word country names — only ever stripped when the row has
# OTHER card-terminal annotation evidence (a channel code just got peeled off
# it, e.g. "...SPAIN ON 25 FEB BCC"). Without that gate this wrecks real
# merchants whose name legitimately ends in a country word, e.g. "TASTE OF
# INDIA" -> "taste of" (false merge with "SPICE OF INDIA"), "BANK OF CHINA" ->
# "bank of" (confirmed defect).
_SINGLE_WORD_COUNTRIES = frozenset({
    "SPAIN", "PORTUGAL", "FRANCE", "GERMANY", "ITALY", "IRELAND", "ESTONIA",
    "NETHERLANDS", "BELGIUM", "SWITZERLAND", "AUSTRIA", "POLAND", "SWEDEN",
    "NORWAY", "DENMARK", "FINLAND", "GREECE", "TURKEY", "CYPRUS", "MALTA",
    "CROATIA", "HUNGARY", "ROMANIA", "BULGARIA", "SLOVAKIA", "SLOVENIA",
    "LITHUANIA", "LATVIA", "LUXEMBOURG", "ICELAND", "MOROCCO", "EGYPT",
    "KENYA", "NIGERIA", "GHANA", "TANZANIA", "UGANDA", "INDIA", "CHINA",
    "JAPAN", "THAILAND", "SINGAPORE", "MALAYSIA", "INDONESIA", "VIETNAM",
    "PHILIPPINES", "AUSTRALIA", "CANADA", "MEXICO", "BRAZIL", "ARGENTINA",
    "CHILE", "COLOMBIA", "PERU", "RUSSIA", "UKRAINE", "ISRAEL", "QATAR",
    "JORDAN", "LEBANON", "GEORGIA", "ARMENIA", "MONACO",
})
# Bank-statement abbreviations/ISO codes — these are near-never the tail of a
# real merchant name, so they keep stripping unconditionally (this is the
# already-correct, live-verified behaviour: 'PAYPAL *DISNEYPLUS ... GBR').
_COUNTRY_CODES = frozenset({
    "USA", "UK", "UAE", "GBR", "IRL", "ESP", "FRA", "DEU", "ITA", "PRT",
    "NLD", "POL", "IND", "CHN", "JPN", "KOR", "AUS", "CAN", "MEX", "BRA",
    "ZAF", "EST", "NGA",
})


def _strip_trailing_country(text: str, allow_spelled_out: bool) -> str:
    """Drop a trailing 1-3 word country name/abbreviation, longest match first.

    Abbreviations/ISO codes (_COUNTRY_CODES) always strip. Spelled-out country
    NAMES (_MULTI_WORD_COUNTRIES / _SINGLE_WORD_COUNTRIES) only strip when
    `allow_spelled_out` is True — the caller sets this from other annotation
    evidence on the row (a channel code was just peeled off), so a real
    merchant name that happens to end in a country word is left alone.
    """
    words = text.split()
    for span in (3, 2, 1):
        if len(words) <= span:
            continue
        candidate = " ".join(w.upper() for w in words[-span:])
        if span == 1 and candidate in _COUNTRY_CODES:
            return " ".join(words[:-span])
        if allow_spelled_out and candidate in (
            _MULTI_WORD_COUNTRIES if span > 1 else _SINGLE_WORD_COUNTRIES
        ):
            return " ".join(words[:-span])
    return text


def _split_head_or_tail(text: str) -> str:
    """For a generic '*' or '#' inside the text (payment-intent / order refs,
    e.g. 'PLAYTOMIC* PI-C096', 'WEBSIT#23231'), the merchant is normally the
    HEAD — unless the head is trivial, in which case the tail is more likely
    to carry the real identity."""
    m = re.search(r'[*#]', text)
    if not m:
        return text
    head, tail = text[:m.start()].strip(), text[m.end():].strip()
    head_alpha = len(re.sub(r'[^A-Za-z]', '', head))
    if head_alpha >= 4:
        return head
    return tail or head


def _strip_one_reference_token(text: str) -> str:
    """Drop ONE trailing alphanumeric reference token (e.g. '0987A',
    '69559-0', 'AWC-0946-863-807'), but only when enough alphabetic identity
    survives — mirrors normalise_merchant's 'A/C 76526682' guard, where the
    number IS the identity."""
    words = text.split()
    if len(words) < 2:
        return text
    last = words[-1]
    if not re.fullmatch(r'(?=.*\d)[A-Za-z0-9/-]{2,20}', last):
        return text
    remainder = " ".join(words[:-1])
    if len(re.sub(r'[^A-Za-z]', '', remainder)) >= 4:
        return remainder
    return text


def canonical_merchant_key(merchant: str, description: str = "") -> str:
    """The ONE shared merchant identity function (ENGINE.md "Identity" stage).

    Conservative normalisation so that differently-formatted statement lines
    for the same real-world merchant collapse to one key — e.g. the five
    Playtomic formats ('Playtomic', 'PLAYTOMIC.IO 0987A SPAIN ON 25 FEB BCC',
    'PLAYTOMIC* PI-C096 ON 10 JUN BCC', ...) all become 'playtomic'.

    Prefers a real merchant name (already fairly clean); falls back to the
    description, stripping in order: POS-processor prefixes (keeping the
    tail), FX-conversion boilerplate, Monzo "from X Pot" suffixes, URLs, date
    fragments, trailing channel codes, trailing country annotations, a
    generic '*'/'#' payment-reference split (head, unless trivial), and
    finally ONE trailing alphanumeric reference token.
    """
    base = (merchant or "").strip() or (description or "").strip()
    if not base:
        return ""

    # Leading card-fragment ('9896 04JUN26 ', '1917 11JUN26 D ') would
    # otherwise block the processor-prefix match below, since that match is
    # anchored at the very start of the string.
    base = _LEADING_CARD_DATE_RE.sub('', base)
    # Payee name glued directly onto a trailing "FP <date>" channel code with
    # no separating space — normalise before date-stripping consumes the date
    # this depends on.
    base = _GLUED_CHANNEL_CODE_RE.sub(r' \1', base)

    m = _PROCESSOR_PREFIX_RE.match(base)
    if m:
        base = base[m.end():].strip()

    base = _FX_BOILERPLATE_RE.sub('', base).strip()
    base = _MONZO_POT_SUFFIX_RE.sub('', base).strip()
    base = _BARE_URL_RE.sub(' ', base)
    base = _DOMAIN_SUFFIX_RE.sub(r'\1', base)
    base = strip_date_fragments(base)
    before_numeric_date = base
    base = NUMERIC_DATE_RE.sub(' ', base)
    base = re.sub(r'\s{2,}', ' ', base).strip()
    had_date_signal = base != before_numeric_date.strip()

    # Peel off one or more trailing known channel codes.
    had_channel_code = False
    while True:
        cm = re.search(r'\s+([A-Za-z]{2,4})\s*$', base)
        if cm and cm.group(1).upper() in _CHANNEL_CODES:
            base = base[:cm.start()].strip()
            had_channel_code = True
        else:
            break

    # Spelled-out country NAMES only strip when the row shows other
    # card-terminal annotation evidence (a date or channel code was actually
    # present) — otherwise a real merchant ending in a country word (e.g.
    # "TASTE OF INDIA") would be wrongly truncated. Abbreviation/ISO codes
    # keep stripping unconditionally regardless of this signal.
    base = _strip_trailing_country(base, allow_spelled_out=had_date_signal or had_channel_code)
    base = _split_head_or_tail(base)
    base = _strip_one_reference_token(base)

    # Decompose accented Latin characters to their base letter + combining
    # mark (é -> e + ́) and drop the mark, so 'café' collapses to the
    # correct 'cafe' stem rather than the truncated 'caf' a raw [^a-z0-9]
    # strip would produce. Non-Latin scripts (no ASCII decomposition exists)
    # still safely fall through to an empty key, same as before.
    ascii_base = unicodedata.normalize('NFKD', base).encode('ascii', 'ignore').decode('ascii')
    key = re.sub(r'[^a-z0-9]+', ' ', ascii_base.lower()).strip()
    return re.sub(r'\s+', ' ', key)


def build_rule_pattern(merchant_key: str) -> str:
    """A word-boundary-safe, escaped regex for a rule PROPOSED from a
    merchant_key (ENGINE.md "One-Way Ladder" / teaching-endpoint acceptance).

    A naive substring pattern (the bare key, unescaped, unanchored) can match
    inside an unrelated word — the trigger word-boundary lesson: a rule for
    "ee" once matched the "ee" inside "Mowgli Street". Every token is
    re.escape'd (defence in depth — canonical_merchant_key already yields
    only [a-z0-9] tokens, but this function must stay safe even if that
    changes) and the whole phrase is anchored with \\b on both ends, with
    \\s+ between tokens so it still matches if whitespace in the live
    transaction text differs from the single-space-normalised key.

    Returns "" for an empty key — never a pattern that would match everything.
    """
    tokens = merchant_key.split()
    if not tokens:
        return ""
    body = r'\s+'.join(re.escape(tok) for tok in tokens)
    return r'\b' + body + r'\b'


# Bounds on what a user's own custom category names can inject into the
# Haiku prompts (categorise_others_bg, llm_name_check both join this list
# verbatim into cat_list). Blast radius is already scoped to that user's own
# categorisation (a custom name never reaches the global cache/catalog — the
# Firewall Rule), but an unbounded, unescaped list is still not something we
# should ever hand to a prompt: a name could be very long, or contain
# newlines/instruction-shaped text.
_MAX_CUSTOM_CATEGORIES = 30
_MAX_CATEGORY_NAME_LEN = 40


async def user_allowed_categories(uid: str) -> list[str]:
    """VALID_CATEGORIES plus this user's own custom SPEND categories.

    Custom categories with a MOVEMENT kind are excluded — movement resolves to
    a destination in the pot ledger, never a category (the Destination Rule),
    so a movement-kind custom is never something the ladder should learn or
    guess into. Used to widen every categorisation gate (cache write, the
    cache-application read, both LLM prompts) so a user's own words — Padel,
    Golf — are treated as first-class vocabulary, not silently discarded.

    Custom names are collapsed to a single line and length-capped, and the
    list is capped at _MAX_CUSTOM_CATEGORIES, before being returned — this is
    the one place every categorisation gate and both LLM prompts read from.
    """
    kinds = await get_category_kinds(uid)
    customs: list[str] = []
    for name, kind in kinds.items():
        if name in VALID_CATEGORIES or kind == MOVEMENT:
            continue
        clean = " ".join((name or "").split())[:_MAX_CATEGORY_NAME_LEN]
        if clean and clean not in customs:
            customs.append(clean)
        if len(customs) >= _MAX_CUSTOM_CATEGORIES:
            break
    return VALID_CATEGORIES + customs


async def cache_merchant(key: str, category: str, source: str, uid: str | None = None) -> None:
    """Persist a merchant->category decision. 'user' entries win: an 'llm' write
    will not overwrite a category a user has explicitly corrected.
    When uid is given the entry is scoped to that user (id = uid::key) so that
    name-based decisions don't leak between users.

    Category gate: VALID_CATEGORIES always qualify. A uid-scoped write may ALSO
    use one of THAT user's own custom categories (Padel, Golf, ...) — never a
    global (uid=None) write, per the Firewall Rule: a custom category name is
    one user's private vocabulary and must never leak into another user's
    global-cache lookup (Pass 3.4's `cache` dict, shared by everyone)."""
    if not key:
        return
    if category not in VALID_CATEGORIES:
        if not uid:
            return
        allowed = await user_allowed_categories(uid)
        if category not in allowed:
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

        # Pass 2.5: propagate manual overrides. Keyed on canonical_merchant_key
        # (not the raw lowercased description — no date/reference stripping at
        # all) so a correction on one dated statement line propagates to every
        # other row for the same merchant, not just byte-identical repeats.
        custom_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": {"$ne": None}},
            {"merchant_name": 1, "description": 1, "transaction_type": 1, "custom_category": 1},
        ).to_list(None)

        override_map: dict = defaultdict(Counter)
        for t in custom_txns:
            desc_key = canonical_merchant_key(t.get("merchant_name") or "", t.get("description") or "")
            if len(desc_key) >= 3:
                override_map[(desc_key, t.get("transaction_type", "debit"))][t["custom_category"]] += 1

        if override_map:
            no_custom = await transactions_col.find(
                {"user_id": user_id, "custom_category": None},
                {"_id": 1, "merchant_name": 1, "description": 1, "transaction_type": 1, "category": 1},
            ).to_list(None)
            for t in no_custom:
                desc_key = canonical_merchant_key(t.get("merchant_name") or "", t.get("description") or "")
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
    # Global entries are gated to VALID_CATEGORIES only (the Firewall Rule — a
    # custom category is one user's private vocabulary); user-scoped entries
    # may also carry this user's OWN custom categories (Padel, Golf, ...).
    allowed_cats = await user_allowed_categories(user_id)
    all_cache_docs = await merchant_categories_col.find(
        {"$or": [{"uid": {"$exists": False}}, {"uid": user_id}]},
        {"category": 1, "uid": 1},
    ).to_list(None)
    cache: dict[str, str] = {}
    user_cache: dict[str, str] = {}
    for d in all_cache_docs:
        cat = d.get("category")
        is_user_scoped = d.get("uid") == user_id
        if is_user_scoped:
            if cat not in allowed_cats:
                continue
        elif cat not in VALID_CATEGORIES:
            continue
        raw_id: str = d["_id"]
        if is_user_scoped:
            # User-scoped: strip the "uid::" prefix to get bare normalised key
            bare = raw_id[len(user_id) + 2:] if raw_id.startswith(f"{user_id}::") else raw_id
            user_cache[bare] = cat
        else:
            cache[raw_id] = cat
    # Merge: user-scoped wins
    merged_cache = {**cache, **user_cache}
    if merged_cache:
        cache_txns = await transactions_col.find(
            {"user_id": user_id, "custom_category": None,
             "$or": [{"category": None}, {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES) + ["Other"]}}]},
            {"merchant_name": 1, "description": 1, "category": 1},
        ).to_list(None)
        for t in cache_txns:
            cat = merged_cache.get(canonical_merchant_key(t.get("merchant_name") or "", t.get("description") or ""))
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

    # Pass 4: propagate custom_category to auto-categorised transactions. Keyed
    # on canonical_merchant_key (not the raw lowercased field — no date/
    # reference stripping at all), tried against merchant_name and description
    # independently so either field alone can still resolve a match.
    user_overrides = await transactions_col.find(
        {"user_id": user_id, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1, "custom_category": 1, "transaction_type": 1},
    ).to_list(None)

    override_map2: dict[tuple[str, str], str] = {}
    for h in user_overrides:
        cat = h["custom_category"]
        txn_type = h.get("transaction_type", "")
        for norm in (
            canonical_merchant_key(h.get("merchant_name") or "", ""),
            canonical_merchant_key("", h.get("description") or ""),
        ):
            map_key = (norm, txn_type)
            if len(norm) >= 3 and map_key not in override_map2:
                override_map2[map_key] = cat

    if override_map2:
        all_auto = await transactions_col.find(
            {"user_id": user_id, "custom_category": None},
            {"_id": 1, "merchant_name": 1, "description": 1, "category": 1, "transaction_type": 1},
        ).to_list(None)
        for t in all_auto:
            txn_type = t.get("transaction_type", "")
            for norm in (
                canonical_merchant_key(t.get("merchant_name") or "", ""),
                canonical_merchant_key("", t.get("description") or ""),
            ):
                desired = override_map2.get((norm, txn_type)) if len(norm) >= 3 else None
                if desired:
                    if t.get("category") != desired:
                        await transactions_col.update_one(
                            {"_id": t["_id"]}, {"$set": {"category": desired}}
                        )
                        updated += 1
                    break

    return updated


async def apply_single_rule(user_id: str, pattern: str, category: str) -> list[dict]:
    """Apply ONE newly-created rule (mirrors apply_rules_bulk's Pass 3.5, but
    scoped to a single pattern) synchronously, and return {id,
    previous_category} for every row it changes.

    Fix-round HIGH finding: the "Always" propagation offer used to fire this
    same matching as a fire-and-forget task with no record of what it
    touched, so the undo toast could only revert the one transaction the
    sheet was open on — every other matching sibling stayed silently
    recategorised even after "Undo". Running it here, awaited, with a return
    value lets the caller revert every affected row precisely.
    """
    affected: list[dict] = []
    try:
        compiled = re.compile(pattern, re.IGNORECASE)
    except re.error:
        return affected
    candidates = await transactions_col.find(
        {"user_id": user_id, "custom_category": None},
        {"_id": 1, "merchant_name": 1, "description": 1, "category": 1},
    ).to_list(None)
    for t in candidates:
        text = " ".join(filter(None, [t.get("merchant_name"), t.get("description")])).lower()
        if not compiled.search(text):
            continue
        prev = t.get("category")
        if prev == category:
            continue
        await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": category}})
        affected.append({"id": t["_id"], "previous_category": prev})
    return affected


async def categorise_others_bg(uid: str) -> int:
    """LLM-classify transactions still on None/Other across all collections."""
    if not OPENROUTER_API_KEY:
        return 0
    identity = await user_identity(uid)
    owner_name = " ".join(t.capitalize() for t in identity["name_tokens"]) if identity["name_tokens"] else None
    # This user's own vocabulary (VALID_CATEGORIES + their custom categories,
    # e.g. Padel) — so the model can propose a name the user actually coined,
    # instead of being limited to the 19 shared built-ins.
    allowed_cats = await user_allowed_categories(uid)

    col_map = [transactions_col, statement_transactions_col, mono_transactions_col, mpesa_transactions_col]
    # Structural / money-to-self categories (Transfer, Savings, Debt, Investment) are
    # assigned deterministically by earlier passes (Pass 2 / 2.6) and must never be
    # something the LLM guesses at — exclude them from the list it's allowed to pick.
    cat_list = ", ".join(c for c in allowed_cats if c not in {"Transfer", "Savings", "Debt", "Investment"})
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
            final = cat if (cat and cat in allowed_cats) else None
            update: dict = {"ai_attempted": True}
            if final and final != "Other":
                update["category"] = final
                total_updated += len(seen[label])
                # A custom category (Padel, ...) is this user's private
                # vocabulary — scope the cache write to them (Firewall Rule).
                cache_uid = uid if final not in VALID_CATEGORIES else None
                await cache_merchant(canonical_merchant_key("", label), final, "llm", uid=cache_uid)
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
    # This user's own vocabulary (VALID_CATEGORIES + their custom categories)
    # so the model can propose a name the user actually coined (e.g. Padel).
    allowed_cats = await user_allowed_categories(uid)
    cat_list = ", ".join(allowed_cats)

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
            if not cat or cat not in allowed_cats:
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
                norm_key = canonical_merchant_key("", d["desc"])
                if len(norm_key) >= 3:
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
