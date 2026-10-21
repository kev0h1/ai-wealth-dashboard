"""G315: tips are factual, consistent and never advisory (Kevin, 2026-10-21).

One module holds the rules the tip composer and the serve-time gate share:

  (a) regulated categories get no market alternatives at all
  (b) "Also listed" only when like for like (`is_like_for_like`, fails closed)
  (c) one figure per card (`headline_for`)
  (d) cleaned, merged merchant names (`present_triggers`)
  (e) a named, allowlisted source, never a bare or SEO domain (`source_name`)
  (f) one freshness line (enforced in the serializer, checked in `card_violations`)

Every predicate fails closed: when in doubt the market line is dropped, never
softened. `card_violations` is the rendered-card half of the G283 banned-phrase
gate (see app.services.tip_copy for the phrase list).
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from typing import Iterable, Optional
from urllib.parse import urlparse

from app.services import tip_copy
from app.services.account_names import display_account_name

# ── (a) regulated categories ────────────────────────────────────────────────

# Tip categories that are regulated products: no market alternative is ever
# shown or researched until A166 answers. Own-fact only, or no tip.
REGULATED_CATEGORIES = frozenset({
    "mortgage", "car_finance", "car_insurance", "insurance", "loan", "loans",
    "credit_card", "credit_cards", "balance_transfer", "pension", "pensions",
    "investment", "investments",
})

# Fail closed: a category outside the list whose key or label contains any of
# these words is treated as regulated too.
_REGULATED_WORD_RE = re.compile(
    r"\b(?:mortgages?|remortgag\w*|loans?|finance|financing|credit|overdrafts?|bnpl|klarna|clearpay|debt|"
    r"balance transfers?|insur\w*|pensions?|annuit\w*|invest\w*|isas?|sipps?|lenders?|brokers?|"
    r"equity|bonds?|funds?|stocks?|shares?)\b",
    re.IGNORECASE,
)


def _spaced(text: str) -> str:
    """Keys use underscores and hyphens; word boundaries need spaces."""
    return re.sub(r"[_\-]+", " ", text or "")

# Words that turn a research query into a market pitch.
_QUERY_PITCH_RE = re.compile(
    r"\b(?:best|cheapest|cheaper|cheap|switch(?:ing)?|save|saving|savings|save\s+money|deals?|compare|comparison)\b",
    re.IGNORECASE,
)


def is_regulated_category(category_key: Optional[str], label: Optional[str] = None) -> bool:
    """True for a regulated product category, and for any category that is
    unknown to this module whose key or label names one (fail closed)."""
    key = (category_key or "").strip().lower()
    if key in REGULATED_CATEGORIES:
        return True
    if key in _KNOWN_UNREGULATED:
        return False
    return bool(_REGULATED_WORD_RE.search(_spaced(f"{key} {label or ''}")))


# Categories that are known to be outside the regulated list. Anything not here
# and not regulated by name is still checked by the word match above.
_KNOWN_UNREGULATED = frozenset({
    "energy", "broadband", "mobile", "groceries", "eating_out", "gym", "subscriptions", "water",
})


def safe_research_query(category_key: str, label: Optional[str], query: str) -> Optional[str]:
    """The query to send to the search provider, or None when none may be sent.
    A regulated category never gets one. Pitch words are stripped from every
    other query so a search is never framed as a hunt for a better deal."""
    if is_regulated_category(category_key, label):
        return None
    cleaned = re.sub(r"\s+", " ", _QUERY_PITCH_RE.sub(" ", query or "")).strip()
    return cleaned or None


# Marker written ONLY by the G315 `_build_findings`. Shared findings without it
# were fetched before the like-for-like rules and are never used for a range, a
# deal or an alternative (fail closed). It is a string, not a number, because a
# shared document may hold numbers only in its price fields.
FINDINGS_SCHEMA = "g315-2"


# ── (b) like for like ───────────────────────────────────────────────────────

# Categories where a market list beside the user's own spend is never shown:
# a basket average beside someone's own shop, or a voucher list beside a meal.
NO_COMPARE_CATEGORIES = frozenset({"groceries", "eating_out"})

# The one product type a category's market figures are allowed to describe.
# Research must label each alternative with it, and the user's own fact must
# carry the same one, or nothing is listed.
PRODUCT_TYPE = {
    "mobile": "sim_only",
    "broadband": "broadband_only",
    "energy": "energy_tariff",
    "gym": "gym_membership",
    # Subscriptions are deliberately absent: streaming prices differ by tier (with
    # adverts, standard, premium) and a bank row cannot say which tier the user is
    # on, nor can it tell video from audio, so no like-for-like pairing is reliable.
}

RESELLER_RE = re.compile(
    r"groupon|voucher|via\s|reseller|resale|cashback|quidco|topcashback|gift\s*card|ebay|"
    r"marketplace|coupon|promo\s*code|discount\s*code|tastecard|wowcher|vouchercodes|"
    r"day\s*passes?|\bpass(?:es)?\b|hussle|classpass",
    re.IGNORECASE,
)


def user_product_type(category_key: str, user_context: Optional[dict] = None) -> Optional[str]:
    """The product type the user's OWN payment can be said to be, or None when
    their bank data cannot tell. A gym payment is a membership and a streaming
    payment is a streaming subscription. A mobile bill may include a handset, a
    broadband bill a bundle and an energy bill its usage, so those stay unknown
    unless the user said otherwise: nothing market-priced is set beside them."""
    ctx = user_context or {}
    if category_key == "gym":
        return "gym_membership"
    if category_key == "mobile" and str(ctx.get("plan_type") or "").strip().lower() in ("sim only", "sim-only"):
        return "sim_only"
    return None


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def is_like_for_like(user_fact: dict, alternative: dict) -> bool:
    """True only when `alternative` can honestly sit beside `user_fact`: same
    product type, a stated price on the same monthly basis, from a named
    allowlisted source, not a reseller or voucher, not the user's own provider,
    in a category where a comparison may be shown at all. Fails closed: any
    missing field, odd type or exception is False."""
    try:
        category = str(user_fact.get("category") or "")
        if not category or is_regulated_category(category) or category in NO_COMPARE_CATEGORIES:
            return False
        expected = PRODUCT_TYPE.get(category)
        if not expected:
            return False
        if user_fact.get("product_type") != expected or alternative.get("product_type") != expected:
            return False
        if user_fact.get("period") != "month" or alternative.get("basis") != "month":
            return False
        price = alternative.get("price")
        if isinstance(price, bool) or not isinstance(price, (int, float)) or price <= 0:
            return False
        name = str(alternative.get("name") or "").strip()
        if not name or RESELLER_RE.search(name) or not tip_copy.is_clean(name):
            return False
        own = _norm_name(str(user_fact.get("merchant") or ""))
        if own and (own == _norm_name(name) or _norm_name(name).startswith(own)):
            return False
        return allowed_source_name(str(alternative.get("source_host") or ""), name) is not None
    except Exception:
        return False


# ── (e) sources ─────────────────────────────────────────────────────────────

# Host suffix -> the name shown. Regulators, consumer bodies and the major
# comparison sites. Providers' own sites are allowed separately, by name.
SOURCE_NAMES = {
    "ofcom.org.uk": "Ofcom",
    "ofgem.gov.uk": "Ofgem",
    "fca.org.uk": "FCA",
    "gov.uk": "GOV.UK",
    "moneyhelper.org.uk": "MoneyHelper",
    "citizensadvice.org.uk": "Citizens Advice",
    "which.co.uk": "Which?",
    "moneysavingexpert.com": "MoneySavingExpert",
    "uswitch.com": "Uswitch",
    "moneysupermarket.com": "MoneySuperMarket",
    "comparethemarket.com": "Compare the Market",
    "gocompare.com": "GoCompare",
    "confused.com": "Confused.com",
}

# SEO price and calculator sites are never a source.
_SEO_HOST_RE = re.compile(
    r"(?:^|[.-])(?:price|prices|pricing|calculator|calculators|cost|costs)(?:[.-]|$)|calculator\.site$|\.site$|\.xyz$|\.top$",
    re.IGNORECASE,
)


def host_of(value: str) -> str:
    v = (value or "").strip().lower()
    if "//" in v:
        v = urlparse(v).netloc or ""
    v = v.split("/")[0].split(":")[0]
    return v[4:] if v.startswith("www.") else v


def _registrable_label(host: str) -> str:
    parts = [p for p in host.split(".") if p]
    if len(parts) >= 3 and parts[-2] in ("co", "org", "gov", "ac"):
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else host


def allowed_source_name(source: str, provider_name: Optional[str] = None) -> Optional[str]:
    """The display name for `source` (a URL or host), or None when it is not on
    the allowlist. Named bodies and comparison sites come from SOURCE_NAMES; a
    provider's own site is allowed only when its registrable label IS the
    provider's name ("davidlloyd.co.uk" for David Lloyd). SEO price sites are
    refused before anything else."""
    host = host_of(source)
    if not host or "." not in host or _SEO_HOST_RE.search(host):
        return None
    for suffix, name in SOURCE_NAMES.items():
        if host == suffix or host.endswith("." + suffix):
            return name
    pn = _norm_name(provider_name or "")
    label = _norm_name(_registrable_label(host))
    if pn and len(pn) >= 3 and label == pn:
        return (provider_name or "").strip()
    return None


def source_names(sources: Iterable[str], provider_name: Optional[str] = None, limit: int = 2) -> list[str]:
    names: list[str] = []
    for s in sources or []:
        n = allowed_source_name(s, provider_name)
        if n and n not in names and tip_copy.is_clean(n):
            names.append(n)
    return names[:limit]


def allowed_source_urls(sources: Iterable[str], provider_name: Optional[str] = None) -> list[str]:
    return [s for s in (sources or []) if allowed_source_name(s, provider_name)]


# ── (d) merchant names ──────────────────────────────────────────────────────

# Curated provider vocabulary (the same phrases as INSIGHT_CATEGORIES triggers)
# -> the name a person would write. Phrases that are not a brand are generic.
_BRAND_NAMES = {
    "ee": "EE", "ee ltd": "EE", "ee limited": "EE", "bt": "BT", "bt group": "BT",
    "eon": "E.ON", "edf": "EDF", "sse": "SSE", "british gas": "British Gas", "bg energy": "British Gas",
    "scottish power": "Scottish Power", "octopus energy": "Octopus Energy", "npower": "npower",
    "bulb energy": "Bulb Energy", "shell energy": "Shell Energy", "utilita": "Utilita",
    "utility warehouse": "Utility Warehouse",
    "nationwide": "Nationwide", "halifax": "Halifax", "santander mortgage": "Santander",
    "barclays mortgage": "Barclays", "lloyds mortgage": "Lloyds", "natwest mortgage": "NatWest",
    "hsbc mortgage": "HSBC", "virgin money mortgage": "Virgin Money",
    "m&s loans": "M&S Loans", "m&s bank": "M&S Bank",
    "black horse": "Black Horse", "close brothers": "Close Brothers", "moneybarn": "Moneybarn",
    "evolution funding": "Evolution Funding", "motonovo": "MotoNovo",
    "santander consumer": "Santander Consumer Finance", "toyota finance": "Toyota Finance",
    "volkswagen finance": "Volkswagen Finance",
    "direct line": "Direct Line", "admiral": "Admiral", "aviva": "Aviva", "hastings direct": "Hastings Direct",
    "churchill": "Churchill", "more than": "More Than", "lv=": "LV=", "esure": "esure",
    "elephant auto": "Elephant",
    "virgin media": "Virgin Media", "sky broadband": "Sky", "talktalk": "TalkTalk",
    "vodafone broadband": "Vodafone", "now broadband": "NOW", "plusnet": "Plusnet",
    "community fibre": "Community Fibre", "hyperoptic": "Hyperoptic",
    "o2": "O2", "vodafone": "Vodafone", "three": "Three", "giffgaff": "giffgaff", "sky mobile": "Sky Mobile",
    "tesco mobile": "Tesco Mobile", "id mobile": "iD Mobile", "lycamobile": "Lycamobile",
    "tesco": "Tesco", "sainsbury": "Sainsbury's", "asda": "Asda", "morrisons": "Morrisons",
    "waitrose": "Waitrose", "lidl": "Lidl", "aldi": "Aldi", "co-op": "Co-op", "ocado": "Ocado",
    "marks and spencer food": "M&S Food", "m&s food": "M&S Food",
    "mcdonald": "McDonald's", "kfc": "KFC", "nando": "Nando's", "wagamama": "Wagamama",
    "pizza express": "Pizza Express", "prezzo": "Prezzo", "costa coffee": "Costa Coffee",
    "starbucks": "Starbucks", "pret a manger": "Pret A Manger", "itsu": "itsu", "leon": "Leon",
    "subway": "Subway",
    "pure gym": "PureGym", "the gym group": "The Gym Group", "david lloyd": "David Lloyd",
    "virgin active": "Virgin Active", "anytime fitness": "Anytime Fitness", "nuffield health": "Nuffield Health",
    "fitness first": "Fitness First", "bannatyne": "Bannatyne", "everyone active": "Everyone Active",
    "netflix": "Netflix", "spotify": "Spotify", "amazon prime": "Amazon Prime", "disney+": "Disney+",
    "disney plus": "Disney+", "apple tv": "Apple TV", "youtube premium": "YouTube Premium",
    "now tv": "NOW", "sky entertainment": "Sky", "paramount+": "Paramount+", "apple music": "Apple Music",
}

# Trigger words that are a product, not a brand: they never name a lender.
_GENERIC_PHRASES = frozenset({"mortgage", "mortg", "car loan", "car finance", "hire purchase", "restaurant"})

_GENERIC_NAME = {
    "mortgage": "your mortgage lender",
    "car_finance": "your car finance provider",
    "car_insurance": "your insurer",
    "insurance": "your insurer",
}

_REGULATED_NOUN = {
    "mortgage": "your mortgage", "car_finance": "your car finance",
    "car_insurance": "your car insurance", "insurance": "your insurance",
}

# The curated provider phrases of each tip category (the same vocabulary as the
# INSIGHT_CATEGORIES triggers). A payee is only rebranded by a phrase of ITS OWN
# category, so "Three Rivers" paid under eating out is never "Three".
_CATEGORY_PHRASES = {
    "energy": ["british gas", "eon", "edf", "scottish power", "octopus energy", "npower", "sse", "bulb energy",
               "shell energy", "utilita", "utility warehouse", "bg energy"],
    "mortgage": ["nationwide", "halifax", "santander mortgage", "barclays mortgage", "lloyds mortgage",
                 "natwest mortgage", "hsbc mortgage", "virgin money mortgage"],
    "car_finance": ["m&s loans", "m&s bank", "black horse", "close brothers", "moneybarn", "evolution funding",
                    "motonovo", "santander consumer", "toyota finance", "volkswagen finance"],
    "car_insurance": ["direct line", "admiral", "aviva", "hastings direct", "churchill", "more than", "lv=",
                      "esure", "elephant auto"],
    "broadband": ["bt", "virgin media", "sky broadband", "talktalk", "vodafone broadband", "now broadband",
                  "plusnet", "community fibre", "hyperoptic"],
    "mobile": ["ee ltd", "ee limited", "ee", "o2", "vodafone", "three", "giffgaff", "sky mobile", "tesco mobile",
               "id mobile", "lycamobile"],
    "groceries": ["tesco", "sainsbury", "asda", "morrisons", "waitrose", "lidl", "aldi", "co-op",
                  "marks and spencer food", "m&s food", "ocado"],
    "eating_out": ["mcdonald", "kfc", "nando", "wagamama", "pizza express", "prezzo", "costa coffee", "starbucks",
                   "pret a manger", "itsu", "leon", "subway"],
    "gym": ["pure gym", "the gym group", "david lloyd", "virgin active", "anytime fitness", "nuffield health",
            "fitness first", "bannatyne", "everyone active"],
    "subscriptions": ["netflix", "spotify", "amazon prime", "disney+", "disney plus", "apple tv", "youtube premium",
                      "now tv", "paramount+", "apple music", "sky entertainment"],
}

_BRAND_PATTERNS: dict[str, list] = {
    cat: sorted(
        ((re.compile(r"(?<![a-z0-9])" + re.escape(p) + r"s?(?![a-z0-9])"), p, _BRAND_NAMES[p])
         for p in phrases if p in _BRAND_NAMES),
        key=lambda x: -len(x[1]),
    )
    for cat, phrases in _CATEGORY_PHRASES.items()
}

# Brand phrases that are also ordinary words or names. They rebrand a payee only when
# the rest of the payee is plain company noise ("Three Mobile Ltd", "Admiral Insurance"),
# so "Three Rivers Cafe" or "Leon Smith" keeps its own name.
_AMBIGUOUS_PHRASES = frozenset({"three", "leon", "admiral", "churchill", "more than", "subway", "bt", "ee", "o2"})
_NOISE_TOKENS = frozenset({
    "ltd", "limited", "plc", "llp", "uk", "mobile", "mobiles", "bill", "bills", "payment", "payments", "direct",
    "insurance", "group", "stores", "store", "services", "telecom", "broadband", "energy", "ee", "bs", "cy",
})

_COMPANY_TAIL_RE = re.compile(r"\s+(?:ltd|limited|plc|llp|uk)\.?$", re.IGNORECASE)
# Fragments banks have actually been seen to cut a payee at, and their completions.
# Nothing else is ever completed or dropped: an unseen fragment stays exactly as it
# came (ugly, never a false name).
_KNOWN_FRAGMENTS = {
    "castle bromw": "Castle Bromwich", "birming": "Birmingham", "birmin": "Birmingham",
    "leisur": "Leisure", "supermark": "Supermarket", "s/mkts": "Supermarkets", "s/mkt": "Supermarket",
}
_FRAGMENT_END_RE = re.compile(
    r"(?<![A-Za-z/])(" + "|".join(re.escape(k) for k in sorted(_KNOWN_FRAGMENTS, key=len, reverse=True)) + r")$",
    re.IGNORECASE,
)


def _complete_known_fragment(name: str) -> str:
    m = _FRAGMENT_END_RE.search(name)
    return name[:m.start()] + _KNOWN_FRAGMENTS[m.group(1).lower()] if m else name


def _known_brand(raw: str, category: str) -> Optional[str]:
    low = re.sub(r"['\u2019]", "", (raw or "").lower())
    for pat, phrase, name in _BRAND_PATTERNS.get(category, []):
        m = pat.search(low)
        if not m:
            continue
        if phrase in _AMBIGUOUS_PHRASES:
            rest = (low[:m.start()] + " " + low[m.end():]).split()
            if any(t not in _NOISE_TOKENS and not t.isdigit() for t in rest):
                continue
        return name
    return None


def clean_merchant(raw: str, category: str, label: Optional[str] = None) -> tuple[str, bool]:
    """(display name, is_generic). A known brand of the tip's own category reads as
    its own name. An unknown lender in a regulated category reads as a plain noun
    ("your mortgage lender"), never an abbreviation. Any other merchant is
    title-cased; a trailing fragment banks have been seen to cut (see
    _KNOWN_FRAGMENTS) is completed, and anything else is left exactly as given."""
    brand = _known_brand(raw, category)
    if brand:
        return brand, False
    if is_regulated_category(category, label):
        return _GENERIC_NAME.get(category, "your provider"), True
    name = re.sub(r"\s+", " ", (raw or "").strip())
    name = _COMPANY_TAIL_RE.sub("", name).strip()
    return _complete_known_fragment(display_account_name(name) or "your provider"), False


def present_triggers(category: str, triggered_by: Optional[list[dict]], label: Optional[str] = None) -> list[dict]:
    """The user's evidence rows as the card shows them: cleaned names, the same
    brand merged into one row (amounts and counts summed), biggest first."""
    groups: dict[str, list[dict]] = defaultdict(list)
    names: dict[str, tuple[str, bool]] = {}
    for t in triggered_by or []:
        raw = str(t.get("display_name") or t.get("merchant_key") or "")
        name, generic = clean_merchant(raw, category, label)
        # two unknown payees stay two rows: "your mortgage lender" is not one lender
        k = f"generic:{t.get('merchant_key') or raw}".lower() if generic else name.lower()
        groups[k].append(t)
        names[k] = (name, generic)
    out: list[dict] = []
    for k, rows in groups.items():
        name, generic = names[k]
        biggest = max(rows, key=lambda r: float(r.get("monthly_amount") or 0))
        dated = [r for r in rows if r.get("last_date")]
        latest = max(dated, key=lambda r: str(r["last_date"])) if dated else None
        merged = dict(biggest)
        merged.update({
            # a generic noun starts a sentence in the evidence list ("Your mortgage
            # lender") and sits lower case inside the headline (see headline_for)
            "display_name": name[:1].upper() + name[1:] if generic else name,
            "generic": generic,
            "monthly_amount": round(sum(float(r.get("monthly_amount") or 0) for r in rows), 2),
            "occurrences": sum(int(r.get("occurrences") or 0) for r in rows),
            "is_recurring": all(bool(r.get("is_recurring")) for r in rows),
            "overlapping_charge": any(bool(r.get("overlapping_charge")) for r in rows),
        })
        if latest:
            merged["last_date"] = latest["last_date"]
            merged["last_amount"] = latest.get("last_amount")
        out.append(merged)
    return sorted(out, key=lambda r: -float(r.get("monthly_amount") or 0))


# ── (c) one figure ──────────────────────────────────────────────────────────

def money(n: float) -> str:
    return f"£{n:,.0f}"


def money2(n: float) -> str:
    return f"£{n:,.2f}"


def short_date(iso: str) -> Optional[str]:
    try:
        y, m, d = (int(x) for x in str(iso)[:10].split("-"))
        dt = date(y, m, d)
    except (TypeError, ValueError):
        return None
    return f"{dt.day} {dt.strftime('%b')}"


def headline_for(category: str, label: str, rows: list[dict], profile_categories: frozenset = frozenset()) -> Optional[str]:
    """The single sentence that states the user's own figure. Used verbatim as
    the card's headline AND as the lead line, so the two can never disagree.
    One amount, one period; "about" whenever the figure is an average or a sum
    across places, never "across N places"."""
    tb = [t for t in rows if t.get("monthly_amount")]
    if not tb:
        return None
    total = sum(float(t["monthly_amount"]) for t in tb)
    label_l = label.lower()
    primary = tb[0]
    name = primary.get("display_name") or ""
    if is_regulated_category(category, label):
        if len(tb) > 1:
            # more than one distinct payee: name nobody, state the one total
            return f"You pay about {money(total)} a month on {_REGULATED_NOUN.get(category, 'your ' + label_l)}"
        who = name[:1].lower() + name[1:] if primary.get("generic") else name
        when = short_date(primary.get("last_date")) if primary.get("last_date") else None
        last = primary.get("last_amount")
        if len(tb) == 1 and when and isinstance(last, (int, float)) and last > 0:
            return f"You paid {who} {money2(float(last))} on {when}"
        about = "" if all(t.get("is_recurring") for t in tb) else "about "
        return f"You pay {who} {about}{money(total)} a month"
    if len(tb) == 1 and primary.get("is_recurring"):
        return f"You pay {name} {money(total)} a month"
    if category in profile_categories:
        return f"You spend about {money(total)} a month on {label_l}"
    return f"You pay about {money(total)} a month for {label_l}"


# ── rendered-card gate ──────────────────────────────────────────────────────

_ALSO_ITEM_RE = re.compile(r"^[A-Za-z0-9&'+.\- ]+ £[\d,]+(?:\.\d+)? a month$")
_DOMAIN_SPACE_RE = re.compile(r"\b[a-z0-9-]{3,}\.\s+(?:com|co\.uk|co|org|net|uk|io)\b", re.IGNORECASE)
_ACROSS_PLACES_RE = re.compile(r"\bacross\s+\d+\s+places?\b", re.IGNORECASE)
_ABBREV_RE = re.compile(r"\bMtg\b")
_DASH_OR_BANG_RE = re.compile(r"[—–!]")
_CHECKED_RE = re.compile(r"\bChecked \d{1,2} [A-Z][a-z]{2}\b")
_OTHER_FRESHNESS_RE = re.compile(r"\bResearched\b|\bValid until\b", re.IGNORECASE)
_TRUNCATED_NAME_RE = re.compile(r"\b(?:Leisur|Birmin|Birming|Bromw|Supermark|S/Mkts?)\b")


def has_checked_line(body: Optional[str]) -> bool:
    return bool(_CHECKED_RE.search(body or ""))


def also_listed_items(body: str) -> list[str]:
    m = re.search(r"Also listed:\s*(.*?)(?:\.\s+[A-Z]|\.$)", body or "", re.DOTALL)
    if not m:
        return []
    return [p.strip() for p in m.group(1).split(", ") if p.strip()]


def card_violations(card: dict, category: str, label: Optional[str] = None) -> list[str]:
    """Every rule a rendered tip card breaks, as short static codes. Empty means
    clean. Run at serve time on the serialized card and in the tests on every
    fixture; a non-empty result hides the card's researched copy (fail closed)."""
    found: list[str] = []
    texts = [t for t in tip_copy.serialized_tip_texts(card) + [card.get("lead_line")] if t]
    blob = " ".join(texts)
    banned = tip_copy.first_banned(texts)
    if banned:
        found.append(f"banned_phrase:{banned}")
    if _DASH_OR_BANG_RE.search(blob):
        found.append("punctuation")
    if _ACROSS_PLACES_RE.search(blob):
        found.append("across_n_places")
    if _ABBREV_RE.search(blob) or _TRUNCATED_NAME_RE.search(blob):
        found.append("raw_merchant_name")
    if _DOMAIN_SPACE_RE.search(blob):
        found.append("domain_spacing")
    for r in card.get("triggered_by") or []:
        nm = str(r.get("display_name") or "")
        if _ABBREV_RE.search(nm) or _TRUNCATED_NAME_RE.search(nm):
            found.append("raw_merchant_name")
            break
    body = card.get("body") or ""
    if _CHECKED_RE.search(body) and _OTHER_FRESHNESS_RE.search(blob):
        found.append("two_freshness_lines")
    items = also_listed_items(body)
    if items:
        if is_regulated_category(category, label) or category in NO_COMPARE_CATEGORIES:
            found.append("also_listed_not_allowed")
        for it in items:
            if not _ALSO_ITEM_RE.match(it) or RESELLER_RE.search(it):
                found.append("also_listed_not_like_for_like")
                break
    if is_regulated_category(category, label) and re.search(r"\blisted\b|\bcompar", body, re.IGNORECASE):
        found.append("regulated_market_text")
    lead = card.get("lead_line")
    if lead and card.get("title") and lead != card.get("title"):
        found.append("headline_mismatch")
    return found
