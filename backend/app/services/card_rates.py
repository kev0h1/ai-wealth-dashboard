"""Card product identity + representative-APR lookup (Tavily).

Phase 1 of the debt planner: open-banking AIS never carries card terms
(APR, 0% promo end dates, BT offers), so terms are ASKED. To cut typing
friction we prefill with the card product's publicly advertised
REPRESENTATIVE rate, which the user confirms or corrects.

FCA honesty (the 51% rule): a representative APR is the advertised rate at
least 51% of accepted applicants receive — it is NOT the user's actual rate.
Every figure produced here is product-level and is surfaced as such; a
re-lookup that finds a changed rate NEVER touches a user's confirmed
card_terms doc — the user owns their corrections (BEHAVIOURS.md).

Facts must be real: a rate is extracted only when a % figure sits next to an
APR mention in a snippet from the issuer's own domain or a major UK
comparison site, range-checked 5–60. When parsing fails the status is
"not_found" and the flow degrades to manual entry — never a fabricated rate.

Graceful degradation: with no TAVILY_API_KEY everything works minus prefill.
"""
import logging
import re
from datetime import datetime, timedelta
from urllib.parse import urlparse

import httpx

from app.core.config import TAVILY_API_KEY
from app.db.collections import card_product_rates_col

log = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"
TAVILY_TIMEOUT = 8.0
CACHE_REVALIDATE_DAYS = 60   # product-rate cache freshness window
RE_ASK_DAYS = 14             # 'Later' (skipped) suppresses the ask this long

# Count of real Tavily HTTP calls made by this process — lets verification
# prove that a repeat lookup was served from the shared cache.
TAVILY_CALLS = 0


# ── Credit-card classification (mirrors services/needle.py) ──────────────────

def is_credit_card_account(acc: dict) -> bool:
    """True when an account doc (TrueLayer or Finexer row in accounts_col,
    or a yapily row) is a credit card — same test as needle.py."""
    subtype = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
    atype = (acc.get("account_type") or acc.get("type") or "").lower()
    return "CREDIT" in subtype or atype in ("credit", "credit_card")


# ── Ask eligibility ──────────────────────────────────────────────────────────

def is_ask_eligible(terms_doc: dict | None, now: datetime | None = None) -> bool:
    """Should we still ask this user for this card's terms?

    - no doc            → yes (never asked, or they cleared it)
    - confirmed         → no (they told us; user owns corrections)
    - skipped < 14 days → no (an explicit 'Later' must not nag every visit)
    - skipped ≥ 14 days → yes (gentle re-ask)
    """
    if not terms_doc:
        return True
    if terms_doc.get("status") == "confirmed":
        return False
    if terms_doc.get("status") == "skipped":
        ts = terms_doc.get("confirmed_at")
        if not isinstance(ts, datetime):
            return True
        return (now or datetime.utcnow()) - ts >= timedelta(days=RE_ASK_DAYS)
    return True


# ── Product identity ─────────────────────────────────────────────────────────

_ISSUER_DISPLAY = {
    "AMEX": "American Express",
    "NATWEST": "NatWest",
    "BARCLAYS": "Barclays",
    "HSBC": "HSBC",
    "CHASE UK": "Chase",
    "MONZO": "Monzo",
    "LLOYDS": "Lloyds",
    "HALIFAX": "Halifax",
    "SANTANDER": "Santander",
}

# Bank-supplied "names" that carry zero product information.
_GENERIC_NAMES = {
    "credit card", "card", "mastercard", "visa", "visa card",
    "mastercard credit card", "visa credit card", "credit",
}

# HSBC (and others) send the CARDHOLDER's name, e.g. "SMITH,JOHN JAMES/MR".
_PERSON_NAME_RE = re.compile(r",.*/\s*(MR|MRS|MS|MISS|DR|PROF)\b\.?\s*$", re.IGNORECASE)


def _normalise(s: str) -> str:
    """lowercase, strip digits/trademark glyphs/punctuation runs, collapse spaces."""
    s = (s or "").lower()
    s = re.sub(r"[®™©]", " ", s)
    s = re.sub(r"\d+", " ", s)
    s = re.sub(r"[^a-z& ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _clean_product_name(raw: str) -> str:
    """Display-ready product name: strip trademark glyphs, digit runs and the
    dangling single-letter token left by provider truncation ('…American Express® C')."""
    s = re.sub(r"[®™©]", "", raw or "")
    s = re.sub(r"\d{2,}", "", s)
    s = re.sub(r"\s+[A-Za-z]$", "", s.strip())  # truncated trailing letter
    return re.sub(r"\s+", " ", s).strip()


def derive_product_identity(acc: dict) -> dict:
    """Derive {product_key, display_name, query, ambiguous, issuer} from an
    account doc. Uses nickname → display_name → name, falling back to the
    provider alone when the name is generic ('MASTERCARD', 'Credit Card') or
    is the cardholder's own name (never sent to search)."""
    provider = str(acc.get("provider") or acc.get("provider_id") or "").strip()
    issuer = _ISSUER_DISPLAY.get(provider.upper(), provider.title() or "Unknown")

    raw = next(
        (str(v).strip() for v in (acc.get("nickname"), acc.get("display_name"), acc.get("name")) if v and str(v).strip()),
        "",
    )
    product = _clean_product_name(raw)
    norm_product = _normalise(product)
    is_person = bool(_PERSON_NAME_RE.search(raw))
    is_generic = norm_product in _GENERIC_NAMES or not norm_product

    if is_person or is_generic:
        # Provider-only identity — ambiguous: the issuer sells many cards.
        product_key = _normalise(issuer)
        display_name = f"{issuer} credit card"
        query = f"{issuer} credit card representative APR UK"
        return {"product_key": product_key, "display_name": display_name,
                "query": query, "ambiguous": True, "issuer": issuer}

    issuer_tokens = set(_normalise(issuer).split())
    product_tokens = set(norm_product.split())
    if issuer_tokens <= product_tokens:
        display_name = product          # product already names the issuer
        product_key = norm_product
    else:
        display_name = f"{issuer} {product}"
        product_key = _normalise(display_name)

    if "credit card" in display_name.lower():
        query = f"{display_name} representative APR UK"
    else:
        query = f"{display_name} credit card representative APR UK"
    return {"product_key": product_key, "display_name": display_name,
            "query": query, "ambiguous": False, "issuer": issuer}


# ── Trusted-domain gate ──────────────────────────────────────────────────────

_COMPARISON_DOMAINS = {
    "moneysavingexpert.com", "moneysupermarket.com", "comparethemarket.com",
    "uswitch.com", "money.co.uk", "moneyfactscompare.co.uk", "moneyfacts.co.uk",
    "which.co.uk", "experian.co.uk", "clearscore.com", "totallymoney.com",
    "finder.com", "nerdwallet.com", "confused.com", "gocompare.com",
}

_ISSUER_DOMAINS = {
    "american express": {"americanexpress.com"},
    "barclays": {"barclays.co.uk", "barclaycard.co.uk"},
    "natwest": {"natwest.com"},
    "hsbc": {"hsbc.co.uk"},
    "chase": {"chase.co.uk"},
    "monzo": {"monzo.com"},
    "lloyds": {"lloydsbank.com"},
    "halifax": {"halifax.co.uk"},
    "santander": {"santander.co.uk"},
}


def _domain(url: str) -> str:
    try:
        host = (urlparse(url).netloc or "").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _is_issuer_domain(domain: str, issuer: str) -> bool:
    for d in _ISSUER_DOMAINS.get(issuer.lower(), set()):
        if domain == d or domain.endswith("." + d):
            return True
    # heuristic: a distinctive issuer token (≥5 chars) inside the domain
    token = _normalise(issuer).replace(" ", "")
    return len(token) >= 5 and token in domain.replace("-", "").replace(".", "")


def _is_comparison_domain(domain: str) -> bool:
    return any(domain == d or domain.endswith("." + d) for d in _COMPARISON_DOMAINS)


# ── Conservative APR extraction ──────────────────────────────────────────────

_PCT = r"(\d{1,2}(?:\.\d{1,2})?)\s*%"
# "representative APR (variable) 24.9%", "rep APR of 29.9%"
_REP_BEFORE = re.compile(
    r"(?:representative(?:\s+variable)?\s+apr|rep\.?\s*apr|apr\s+representative)"
    r"\W{0,3}(?:\(variable\))?\W{0,3}(?:of|is|at|:)?\W{0,3}" + _PCT, re.IGNORECASE)
# "24.9% APR representative", "24.9% APR (variable) representative"
_REP_AFTER = re.compile(
    _PCT + r"\s*apr\s*(?:\(variable\)\s*)?representative", re.IGNORECASE)
# plain "APR 24.9%" / "24.9% APR" — accepted only from trusted domains
_APR_BEFORE = re.compile(r"\bapr\b\W{0,10}" + _PCT, re.IGNORECASE)
_APR_AFTER = re.compile(_PCT + r"\s*apr\b", re.IGNORECASE)


def _extract_apr(text: str) -> tuple[float, bool] | None:
    """Return (rate, was_labelled_representative) or None. Range-check 5–60."""
    for pattern, labelled in ((_REP_BEFORE, True), (_REP_AFTER, True),
                              (_APR_BEFORE, False), (_APR_AFTER, False)):
        for m in pattern.finditer(text or ""):
            try:
                rate = float(m.group(1))
            except ValueError:
                continue
            if 5.0 <= rate <= 60.0:
                return rate, labelled
    return None


def _extract_candidates(results: list[dict], issuer: str) -> list[str]:
    """Plausible product names for an ambiguous identity — pulled only from
    trusted-domain result titles, deduped, capped at 5."""
    out: list[str] = []
    seen: set[str] = set()
    for r in results:
        domain = _domain(r.get("url") or "")
        if not (_is_issuer_domain(domain, issuer) or _is_comparison_domain(domain)):
            continue
        title = (r.get("title") or "").strip()
        # keep the leading segment before site-name separators
        title = re.split(r"\s*[|–—]\s*|\s+-\s+", title)[0].strip()
        low = title.lower()
        if not (3 <= len(title) <= 70):
            continue
        if "card" not in low and _normalise(issuer) not in _normalise(title):
            continue
        key = _normalise(title)
        if key and key not in seen:
            seen.add(key)
            out.append(title)
        if len(out) >= 5:
            break
    return out


# ── Tavily client ────────────────────────────────────────────────────────────

async def _tavily_search(query: str) -> list[dict] | None:
    """POST to Tavily; 8 s timeout, one retry. None = search unavailable
    (no key / network failure) — distinct from an empty result list."""
    global TAVILY_CALLS
    if not TAVILY_API_KEY:
        log.info("card_rates: TAVILY_API_KEY absent — degrading to manual entry")
        return None
    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "basic",
        "max_results": 5,
    }
    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(timeout=TAVILY_TIMEOUT) as client:
                resp = await client.post(TAVILY_URL, json=payload)
            TAVILY_CALLS += 1
            log.info("card_rates: tavily call #%d (attempt %d) query=%r status=%s",
                     TAVILY_CALLS, attempt, query, resp.status_code)
            if resp.status_code == 200:
                results = resp.json().get("results") or []
                return results if isinstance(results, list) else []
        except Exception as exc:
            log.warning("card_rates: tavily attempt %d failed for %r: %s", attempt, query, exc)
    return None


async def _fresh_lookup(identity: dict) -> dict | None:
    """Run a real Tavily lookup. Returns the fields for a card_product_rates
    doc, or None when search was unavailable (nothing worth caching)."""
    results = await _tavily_search(identity["query"])
    if results is None:
        return None

    now = datetime.utcnow()
    doc = {
        "display_name": identity["display_name"],
        "representative_apr": None,
        "source_url": None,
        "looked_up_at": now,
        "status": "not_found",
        "candidates": [],
    }

    if identity["ambiguous"]:
        # Never pin a rate to an unknown product — offer a shortlist instead.
        doc["candidates"] = _extract_candidates(results, identity["issuer"])
        return doc

    best: tuple[int, float, str] | None = None  # (score, rate, url)
    for r in results:
        url = r.get("url") or ""
        domain = _domain(url)
        from_issuer = _is_issuer_domain(domain, identity["issuer"])
        from_comparison = _is_comparison_domain(domain)
        if not (from_issuer or from_comparison):
            continue
        text = " ".join(str(r.get(k) or "") for k in ("title", "content"))
        hit = _extract_apr(text)
        if not hit:
            continue
        rate, labelled = hit
        # prefer representative-labelled figures, then issuer's own domain
        score = (2 if labelled else 0) + (1 if from_issuer else 0)
        if best is None or score > best[0]:
            best = (score, rate, url)

    if best is not None:
        doc["representative_apr"] = best[1]
        doc["source_url"] = best[2]
        doc["status"] = "found"
    return doc


async def lookup_product_rate(identity: dict) -> dict:
    """Cached-or-fresh product rate for an identity.

    - cache < 60 days old  → cached value, no Tavily call
    - cache ≥ 60 days old  → lazy refresh now (this IS the lookup call);
                             if the refresh fails, cached value with stale=True
    - no cache             → fresh lookup; unavailable search → honest
                             not_found, nothing cached (a network failure is
                             not a fact about the product)

    A changed rate on re-lookup only updates the SHARED product cache —
    never any user's confirmed card_terms.
    """
    key = identity["product_key"]
    cached = await card_product_rates_col.find_one({"_id": key})
    now = datetime.utcnow()

    if cached is not None:
        looked_up = cached.get("looked_up_at")
        fresh_enough = (
            isinstance(looked_up, datetime)
            and now - looked_up < timedelta(days=CACHE_REVALIDATE_DAYS)
        )
        if fresh_enough:
            log.info("card_rates: cache hit for %r (no tavily call)", key)
            return {**_public(cached), "product_key": key, "stale": False}
        fresh = await _fresh_lookup(identity)
        if fresh is not None:
            await card_product_rates_col.update_one({"_id": key}, {"$set": fresh}, upsert=True)
            return {**_public(fresh), "product_key": key, "stale": False}
        log.info("card_rates: stale cache served for %r (refresh unavailable)", key)
        return {**_public(cached), "product_key": key, "stale": True}

    fresh = await _fresh_lookup(identity)
    if fresh is not None:
        await card_product_rates_col.update_one({"_id": key}, {"$set": fresh}, upsert=True)
        return {**_public(fresh), "product_key": key, "stale": False}

    return {
        "product_key": key,
        "display_name": identity["display_name"],
        "representative_apr": None,
        "source_url": None,
        "status": "not_found",
        "candidates": [],
        "stale": False,
    }


def _public(doc: dict) -> dict:
    return {
        "display_name": doc.get("display_name"),
        "representative_apr": doc.get("representative_apr"),
        "source_url": doc.get("source_url"),
        "status": doc.get("status") or "not_found",
        "candidates": doc.get("candidates") or [],
    }
