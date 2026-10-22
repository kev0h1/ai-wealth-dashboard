"""G316: the shared vendor directory and the sync-time categorisation ladder.

ENGINE.md Tier 3, moved from a manual endpoint to sync time. The idea:

* A merchant is looked up on the web ONCE, by anyone. A reasoning-tier model
  writes a plain one or two sentence description of what it is into
  `vendors_col`, keyed by the shared `merchant_key`. That description is a fact
  about the world, so it is global. It never carries a category, a user id, an
  amount or a transaction (`assert_directory_doc` enforces the field list on
  every write and fails closed).
* Each user's categories (built-in plus their own custom ones) are then matched
  to the DESCRIPTION, never to the raw bank text, by the cheap model. The
  answer is that user's own choice: it lives in `user_vendor_categories_col`
  under `uid::merchant_key`, with the reason. Two users with the same merchant
  and different categories never see each other's answer (the Firewall Rule).

Ladder, per merchant, for a user who has custom categories and no correction
or rule for it (`run_vendor_ladder`):

    structural passes (own transfers, card payments, income) stay deterministic
    and first, in `apply_rules_bulk`; this ladder never sees those rows.
    1. the user's stored decision for the merchant;
    2. the directory description;
    3. a lookup, if the directory has nothing fresh (all guards apply).

A broad MERCHANT_PATTERNS keyword match no longer ends categorisation for such
a user: it is passed to the model as a hint and the description decides. A user
with NO custom categories is never touched by this module, so their
categorisation is exactly what it was before G316.

Privacy: before a merchant name leaves the user's scope (to Tavily, the
directory, or a model) `privacy_exclusion` refuses person-to-person payments,
text carrying the user's own name tokens, anything with account or sort-code
digit patterns (or an email or phone-shaped number), and transfers. Only the
normalised merchant key is ever searched, never the raw descriptor.

Cost: caps per sync and per UTC day, a Mongo claim document per merchant so two
users hitting the same new merchant trigger one lookup, and a quota backoff
(Tavily HTTP 432, auth, rate) that stops lookups for a day and shows on
/ops/health under `vendor_lookups`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

import httpx
from pymongo.errors import DuplicateKeyError

from app.core import config as cfg
from app.core.config import OPENROUTER_API_KEY, TAVILY_API_KEY
from app.db.collections import (
    accounts_col, transactions_col, user_rules_col, user_vendor_categories_col,
    vendor_claims_col, vendors_col, worker_runs_col,
)

log = logging.getLogger(__name__)

FOUND, NOT_FOUND, NOT_A_BUSINESS = "found", "not_found", "not_a_business"
STATUSES = (FOUND, NOT_FOUND, NOT_A_BUSINESS)
CONFIDENCES = ("high", "medium", "low")

STATE_DOC_ID = "vendor_lookups"
DAY_PREFIX = "day:"
CLAIM_PREFIX = "lookup:"

# The only fields a directory document may hold. No category, no user id.
DIRECTORY_FIELDS = frozenset({
    "_id", "merchant_key", "display_name", "description", "type_tags", "domain",
    "sources", "looked_up_at", "confidence", "status", "version",
})
FORBIDDEN_DIRECTORY_FIELDS = frozenset({
    "category", "custom_category", "uid", "user_id", "user", "email", "amount",
    "amounts", "transaction", "transactions", "transaction_id", "account_id",
    "reason", "raw_description",
})

# Categories a merchant description is never matched into. Structural kinds are
# decided earlier and deterministically; a debit merchant is never Income.
_NEVER_MATCH = frozenset({"Transfer", "Savings", "Debt", "Investment", "Income"})
# Keyword results that are specific enough to stay final (lender, landlord and
# structural matches). Every other keyword result becomes a hint to the model.
_FINAL_KEYWORD_CATEGORIES = frozenset({
    "Transfer", "Income", "Debt", "Savings", "Investment", "Mortgage", "Rent", "Car finance",
})
_RAW_CATEGORIES = frozenset({
    "BILL_PAYMENT", "DEBIT", "DIRECT_DEBIT", "PURCHASE", "STANDING_ORDER", "CREDIT",
})


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: persisted naive-UTC convention for these collections


# ── Privacy exclusions ──────────────────────────────────────────────────────

_SORT_CODE_RE = re.compile(r"(?<!\d)\d{2}[-\s]\d{2}[-\s]\d{2}(?!\d)")
_DIGIT_RUN_RE = re.compile(r"\d{6,}")
_GROUPED_DIGITS_RE = re.compile(r"(?<![\w])(?:\d[\s-]?){8,}(?![\w])")
_IBAN_RE = re.compile(r"\b[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,}\b")
_ACCOUNT_WORDS_RE = re.compile(r"\b(?:sort\s*code|a/c|acc(?:ount)?\s*(?:no|number|num))\b", re.I)
_CONTACT_RE = re.compile(r"@|\+\d{2}|\b0\d{9,10}\b")
_P2P_TEXT_RE = re.compile(
    r"^\s*to\s+[a-z]|\bvia\s+mobile\b|\bfp\s*\d|\bfaster\s+payments?\b|\bbank\s+transfer\b|"
    r"\btransfer\s+(?:to|from)\b|\bpayment\s+(?:to|from)\b|\bbacs\b|\bchaps\b|\bxfer\b|\bsto\b",
    re.I,
)

# Words that mark a key as a business. A key of two to four plain alphabetic
# words with none of these (and no provider merchant name) is shaped like a
# person ("c c gondwe", "j smith", "daniel gondwe") and is never sent anywhere.
BUSINESS_TOKENS = frozenset("""
ltd limited plc llp inc co company group holdings services service shop shops store stores centre center
club golf cafe coffee restaurant bar pub inn hotel gym fitness leisure sport sports market supermarket
pharmacy chemist garage motors cars car taxi bank insurance energy water gas electric council school
college university hospital clinic dental dentist optician vet salon barber beauty spa nails bakery
butchers grocer foods food kitchen grill pizza burger kebab curry takeaway deli diner bistro brasserie
books music games travel tours airlines airways air rail trains train bus coach parking fuel petrol
station shell tesco asda amazon apple google microsoft paypal uber eats deliveroo online direct retail
pay payments play app apps tv radio media digital software cloud hosting mobile telecom broadband
fitness yoga pilates padel tennis squash badminton swimming pool course links estate lettings
properties property rentals rent builders building plumbing electrical joinery roofing decorating
cleaning laundry dry florist flowers gifts cards toys kids baby pets pet feed farm nursery
church trust charity foundation society association union fund pension isa invest investments
""".split())

_WORD_RE = re.compile(r"[a-z]+")


def looks_like_a_person(key: str, *, has_merchant_name: bool = False) -> bool:
    """Deterministic person-shape refusal for a bare payee name that carries no
    FP, TO or via wording. Safe direction is exclusion."""
    words = key.lower().split()
    if not words:
        return False
    if any(len(w) == 1 and w.isalpha() for w in words):
        return True                      # a standalone initial: "j smith", "c c gondwe"
    if not all(_WORD_RE.fullmatch(w) for w in words):
        return False
    if any(w in BUSINESS_TOKENS for w in words):
        return False
    if len(words) == 1:
        return False
    if len(words) <= 3 and not has_merchant_name:
        return True
    return len(words) == 4                # every word name-like, four plain words


PRIVACY_REASONS = ("empty_key", "transfer", "person_payment", "own_name", "account_digits", "contact_detail")


def privacy_exclusion(
    key: str,
    texts: list[str],
    *,
    category: Optional[str] = None,
    identity: Optional[dict] = None,
    own_account_id=None,
    has_merchant_name: bool = False,
) -> Optional[str]:
    """Why this merchant must NOT leave the user's scope, or None when it may.

    `key` is the normalised merchant key; `texts` are the raw bank strings the
    key was built from (merchant name plus description), checked as well so a
    key that looks clean after normalisation cannot hide a personal descriptor.
    A hit on ANY sample excludes the whole merchant: false positives only mean
    the keyword path keeps the row, a false negative leaks personal text."""
    from app.services.categorisation import (
        _PERSON_PAYMENT_RE, _name_token_hits, is_own_transfer,
    )
    if not key or len(key) < 3:
        return "empty_key"
    identity = identity or {}
    samples = [t for t in (texts or []) if t] or [key]
    if category in ("Transfer", "TRANSFER") or category in _FINAL_KEYWORD_CATEGORIES - {"Mortgage", "Rent", "Car finance"}:
        return "transfer"
    for text in [key] + samples:
        if _SORT_CODE_RE.search(text) or _DIGIT_RUN_RE.search(text) or _GROUPED_DIGITS_RE.search(text) \
                or _IBAN_RE.search(text) or _ACCOUNT_WORDS_RE.search(text):
            return "account_digits"
        if _CONTACT_RE.search(text):
            return "contact_detail"
    tokens = list(identity.get("name_tokens") or [])
    if tokens:
        initials = {t[0] for t in tokens if t}
        for text in [key] + samples:
            if _name_token_hits(text, tokens):
                return "own_name"
            words = re.split(r"[^a-zA-Z]+", text.lower())
            if any(w for w in words if len(w) == 1 and w in initials):
                return "own_name"
    for text in samples:
        if identity.get("own_ids") or identity.get("name_tokens"):
            try:
                if is_own_transfer(text, identity, own_account_id):
                    return "transfer"
            except Exception:  # never let a malformed identity block the sync
                pass
    if _PERSON_PAYMENT_RE.search(key):
        return "person_payment"
    for text in samples:
        if _P2P_TEXT_RE.search(text):
            return "person_payment"
    if looks_like_a_person(key, has_merchant_name=has_merchant_name):
        return "person_payment"
    return None


# ── Directory documents ─────────────────────────────────────────────────────

def assert_directory_doc(doc: dict) -> None:
    """Fail closed: a directory document holds merchant facts only."""
    bad = FORBIDDEN_DIRECTORY_FIELDS & set(doc)
    extra = set(doc) - DIRECTORY_FIELDS
    if bad or extra:
        raise ValueError(f"vendor directory document has disallowed fields: {sorted(bad | extra)}")


_DASH_RE = re.compile(r"\s*[—–]\s*")


def _clean_text(value, limit: int) -> str:
    s = " ".join(str(value or "").split())
    s = _DASH_RE.sub(", ", s)
    return s[:limit].strip()


_DOMAIN_RE = re.compile(r"^(?=.{4,100}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$")


def _clean_domain(value) -> Optional[str]:
    d = str(value or "").strip().lower()
    d = re.sub(r"^https?://", "", d).split("/")[0]
    d = d[4:] if d.startswith("www.") else d
    return d if _DOMAIN_RE.match(d) else None


def _clean_tags(value) -> list[str]:
    out: list[str] = []
    for t in value if isinstance(value, list) else []:
        s = re.sub(r"[^a-z0-9 &/-]+", "", str(t or "").lower()).strip()[:30]
        if s and s not in out:
            out.append(s)
        if len(out) >= 5:
            break
    return out


def _is_fresh(doc: Optional[dict], now: datetime) -> bool:
    looked = (doc or {}).get("looked_up_at")
    return bool(looked) and now - looked < timedelta(days=cfg.VENDOR_REFRESH_DAYS)


async def get_vendor(merchant_key: str) -> Optional[dict]:
    return await vendors_col.find_one({"_id": merchant_key})


async def vendor_display_name(merchant_key: str) -> Optional[str]:
    """The directory's clean display name for a merchant key, or None when the
    merchant is not in the directory or was not found. For G282 (merchant
    display names) and G315 (tips merchant names) to read later; nothing
    consumes it yet. Never raises."""
    if not merchant_key:
        return None
    try:
        doc = await vendors_col.find_one({"_id": merchant_key}, {"display_name": 1, "status": 1})
    except Exception:
        log.warning("vendor_display_name: directory read failed")
        return None
    if doc and doc.get("status") == FOUND and doc.get("display_name"):
        return doc["display_name"]
    return None


# ── Quota backoff and health state ──────────────────────────────────────────

def _classify_status(status: int) -> str:
    from app.services import tips_research_health as trh
    return trh.classify_http_status(status)


async def _load_state() -> dict:
    try:
        return await worker_runs_col.find_one({"_id": STATE_DOC_ID}) or {}
    except Exception:
        log.warning("vendor lookups: could not read state document")
        return {}


async def backoff_until(now: Optional[datetime] = None) -> Optional[datetime]:
    """When lookups may resume, or None. Honours this module's own record and the
    tips research record (one Tavily key, one quota)."""
    now = now or _now()
    candidates = []
    own = (await _load_state()).get("skip_until")
    if own and own > now:
        candidates.append(own)
    try:
        from app.services import tips_research_health as trh
        tips = await trh.load()
        if trh.backoff_active(tips, now):
            candidates.append(tips["skip_until"])
    except Exception:
        pass
    return max(candidates) if candidates else None


async def record_failure(code: str, http_status: Optional[int], now: Optional[datetime] = None) -> None:
    from app.services import tips_research_health as trh
    now = now or _now()
    try:
        doc = await _load_state()
        update: dict = {
            "lookup_status": "failing", "last_error_code": code, "last_http_status": http_status,
            "last_error_at": now, "updated_at": now,
        }
        if doc.get("lookup_status") != "failing" or not doc.get("failing_since"):
            update["failing_since"] = now
        if code in trh.BACKOFF_CODES:
            update["skip_until"] = now + timedelta(hours=cfg.VENDOR_BACKOFF_HOURS)
        await worker_runs_col.update_one({"_id": STATE_DOC_ID}, {"$set": update}, upsert=True)
    except Exception:
        log.warning("vendor lookups: could not record failure code=%s", code)


async def record_success(now: Optional[datetime] = None) -> None:
    now = now or _now()
    try:
        await worker_runs_col.update_one(
            {"_id": STATE_DOC_ID},
            {"$set": {"lookup_status": "ok", "last_ok_at": now, "updated_at": now},
             "$unset": {"failing_since": "", "skip_until": ""}},
            upsert=True,
        )
    except Exception:
        log.warning("vendor lookups: could not record success")


def _day_id(now: datetime) -> str:
    return DAY_PREFIX + now.strftime("%Y-%m-%d")


async def lookups_today(now: Optional[datetime] = None) -> int:
    now = now or _now()
    doc = await vendor_claims_col.find_one({"_id": _day_id(now)})
    return int((doc or {}).get("count") or 0)


async def _reserve_daily_slot(now: datetime) -> bool:
    """Atomically take one of today's lookup slots. The filter only matches
    while the count is under the cap; at the cap the upsert collides on _id and
    the DuplicateKeyError means "full"."""
    cap = cfg.VENDOR_LOOKUP_CAP_PER_DAY
    if cap <= 0:
        return False
    try:
        await vendor_claims_col.update_one(
            {"_id": _day_id(now), "count": {"$lt": cap}},
            {"$inc": {"count": 1}, "$setOnInsert": {"kind": "day", "expires_at": now + timedelta(days=3)}},
            upsert=True,
        )
        return True
    except DuplicateKeyError:
        return False


async def _release_daily_slot(now: datetime) -> None:
    try:
        await vendor_claims_col.update_one({"_id": _day_id(now), "count": {"$gt": 0}}, {"$inc": {"count": -1}})
    except Exception:
        pass


async def health_snapshot(now: Optional[datetime] = None) -> dict:
    """Numbers for the /ops/health `vendor_lookups` block. Never raises."""
    now = now or _now()
    try:
        state = await _load_state()
        until = await backoff_until(now)
        queue = await vendor_claims_col.count_documents({"kind": "lookup", "expires_at": {"$gt": now}})
        size = await vendors_col.count_documents({})
        return {
            "enabled": bool(cfg.VENDOR_LADDER_ENABLED),
            "lookups_today": await lookups_today(now),
            "cap_per_day": cfg.VENDOR_LOOKUP_CAP_PER_DAY,
            "cap_per_sync": cfg.VENDOR_LOOKUP_CAP_PER_SYNC,
            "backoff_active": bool(until),
            "backoff_until": until.isoformat() + "Z" if until else None,
            "queue_depth": int(queue),
            "directory_size": int(size),
            "lookup_status": state.get("lookup_status") or "unknown",
            "last_error_code": state.get("last_error_code"),
        }
    except Exception as exc:
        log.warning("vendor lookups: health snapshot failed (%s)", type(exc).__name__)
        return {"enabled": bool(cfg.VENDOR_LADDER_ENABLED), "error": type(exc).__name__}


# ── The lookup: claim, Tavily search, reasoning-model write-up ──────────────

class ProviderFailure(Exception):
    def __init__(self, code: str, http_status: Optional[int] = None):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


async def _tavily_search(query: str) -> dict:
    """One basic Tavily search. Returns {"answer", "snippets", "urls"}; raises
    ProviderFailure with a static code on any provider problem. Sends only the
    query, which is built from the normalised merchant key."""
    from app.core.llm import record_tavily_call
    import time as _time
    if not TAVILY_API_KEY:
        raise ProviderFailure("not_configured")
    t0 = _time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                r = await client.post(
                    "https://api.tavily.com/search",
                    json={"api_key": TAVILY_API_KEY, "query": query, "search_depth": "basic",
                          "max_results": 3, "include_answer": True},
                )
            finally:
                await record_tavily_call(pipeline="vendor_lookup", latency_ms=int((_time.monotonic() - t0) * 1000))
    except httpx.TimeoutException:
        raise ProviderFailure("timeout")
    except Exception:
        raise ProviderFailure("error")
    if r.status_code != 200:
        raise ProviderFailure(_classify_status(r.status_code), r.status_code)
    data = r.json()
    results = data.get("results") or []
    return {
        "answer": _clean_text(data.get("answer"), 500),
        "snippets": [_clean_text(x.get("content"), 250) for x in results[:3] if x.get("content")],
        "urls": [str(x.get("url")) for x in results[:3]
                 if str(x.get("url") or "").startswith("https://") and len(str(x.get("url"))) <= 200],
    }


async def _llm_json(model: str, prompt: str, *, user_id: Optional[str], pipeline: str, max_tokens: int) -> Optional[dict]:
    """One OpenRouter call that must return a JSON object; None on any failure."""
    from app.core.llm import openrouter_chat
    if not OPENROUTER_API_KEY:
        return None
    try:
        async with httpx.AsyncClient(timeout=45) as http:
            r = await openrouter_chat(
                {"model": model, "max_tokens": max_tokens, "temperature": 0,
                 "messages": [{"role": "user", "content": prompt}]},
                user_id=user_id, pipeline=pipeline, client=http,
            )
        if r.status_code != 200:
            return None
        raw = r.json()["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```\s*$", "", raw).strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(m.group()) if m else None
    except Exception:
        return None


def _describe_prompt(key: str, found: dict) -> str:
    evidence = "\n".join(
        [f"Search answer: {found['answer']}"] if found.get("answer") else []
    ) + "\n" + "\n".join(f"Result {i + 1}: {s}" for i, s in enumerate(found.get("snippets") or []))
    return (
        "You write one entry for a shared UK merchant directory.\n"
        f'The merchant, as normalised from bank statements: "{key}".\n'
        f"Web search evidence:\n{evidence.strip()}\n\n"
        "Reply ONLY with JSON: {\"status\": \"found\" | \"not_a_business\" | \"not_found\", "
        "\"display_name\": \"clean trading name\", \"description\": \"one or two plain sentences\", "
        "\"type_tags\": [\"up to five short tags\"], \"domain\": \"website domain or empty\", "
        "\"confidence\": \"high\" | \"medium\" | \"low\"}.\n"
        "Rules:\n"
        "- found only when the evidence clearly identifies a business or service that matches the name. "
        "The description says what it is and where, for example: Members golf club and course in Solihull.\n"
        "- not_a_business when the name looks like a private person or an individual.\n"
        "- not_found when the evidence does not identify it. Do not guess.\n"
        "- Facts about the business only. Never mention a customer, a payment or an amount.\n"
        "- British English. No em dashes.\n"
    )


def _doc_from_llm(key: str, llm: dict, urls: list[str], now: datetime) -> Optional[dict]:
    status = llm.get("status")
    if status not in STATUSES:
        return None
    doc = {
        "_id": key, "merchant_key": key, "status": status, "looked_up_at": now, "version": 1,
        "sources": urls[:3], "type_tags": [], "domain": None, "confidence": "low",
        "display_name": None, "description": None,
    }
    if status == FOUND:
        description = _clean_text(llm.get("description"), 280)
        if not description:
            return None
        doc["description"] = description
        doc["display_name"] = _clean_text(llm.get("display_name"), 80) or key.title()
        doc["type_tags"] = _clean_tags(llm.get("type_tags"))
        doc["domain"] = _clean_domain(llm.get("domain"))
        conf = str(llm.get("confidence") or "").lower()
        doc["confidence"] = conf if conf in CONFIDENCES else "low"
    return doc


async def _write_directory(doc: dict) -> None:
    assert_directory_doc(doc)
    await vendors_col.update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)


class SyncBudget:
    """Lookups one sync run may still start."""

    def __init__(self, cap: Optional[int] = None):
        self.cap = cfg.VENDOR_LOOKUP_CAP_PER_SYNC if cap is None else cap
        self.used = 0

    @property
    def left(self) -> int:
        return max(0, self.cap - self.used)


async def _claim(key: str, now: datetime) -> bool:
    """Take the global in-flight claim on a merchant. The same pattern as the
    webhook debounce: an insert that collides means someone else holds it, and a
    claim whose `expires_at` has passed (the TTL sweep runs once a minute) is
    taken over atomically."""
    doc_id = CLAIM_PREFIX + key
    expires = now + timedelta(seconds=cfg.VENDOR_CLAIM_TTL_SECONDS)
    try:
        await vendor_claims_col.insert_one({"_id": doc_id, "kind": "lookup", "expires_at": expires})
        return True
    except DuplicateKeyError:
        res = await vendor_claims_col.update_one(
            {"_id": doc_id, "expires_at": {"$lt": now}}, {"$set": {"expires_at": expires}},
        )
        return bool(res.modified_count)


async def _release(key: str, cooldown: bool = False, now: Optional[datetime] = None) -> None:
    """Drop the claim, or (after a write-up failure) keep it as a cooldown so the
    merchant is not searched again at once."""
    try:
        if cooldown:
            now = now or _now()
            await vendor_claims_col.update_one(
                {"_id": CLAIM_PREFIX + key},
                {"$set": {"expires_at": now + timedelta(seconds=cfg.VENDOR_FAILURE_COOLDOWN_SECONDS)}},
            )
        else:
            await vendor_claims_col.delete_one({"_id": CLAIM_PREFIX + key})
    except Exception:
        pass


async def _store_refresh(existing: Optional[dict], doc: dict, now: datetime) -> dict:
    """Write a looked-up entry. A refresh that comes back not_found or not_a_business
    never wipes a good found entry: its date is bumped and its description kept."""
    if existing and existing.get("status") == FOUND and doc.get("status") != FOUND:
        await vendors_col.update_one({"_id": doc["_id"]}, {"$set": {"looked_up_at": now}})
        return {**existing, "looked_up_at": now}
    await _write_directory(doc)
    return doc


WRITEUP_FAILURES_BEFORE_BACKOFF = 5
WRITEUP_BACKOFF = timedelta(hours=1)


async def _note_writeup_failure(now: datetime) -> None:
    """A dead model key would otherwise burn one Tavily call per merchant per hour:
    after N consecutive write-up failures, stop all lookups for an hour."""
    try:
        await worker_runs_col.update_one({"_id": STATE_DOC_ID}, {"$inc": {"writeup_failures": 1}}, upsert=True)
        doc = await worker_runs_col.find_one({"_id": STATE_DOC_ID})
        if int((doc or {}).get("writeup_failures") or 0) >= WRITEUP_FAILURES_BEFORE_BACKOFF:
            await worker_runs_col.update_one(
                {"_id": STATE_DOC_ID},
                {"$set": {"skip_until": now + WRITEUP_BACKOFF, "last_error_code": "write_up",
                          "lookup_status": "failing", "writeup_failures": 0}},
            )
    except Exception:
        log.warning("vendor lookups: could not record write-up failure")


async def _reset_writeup_failures() -> None:
    try:
        await worker_runs_col.update_one({"_id": STATE_DOC_ID, "writeup_failures": {"$gt": 0}},
                                         {"$set": {"writeup_failures": 0}})
    except Exception:
        pass


async def ensure_vendor(
    key: str, budget: SyncBudget, now: Optional[datetime] = None,
) -> tuple[Optional[dict], Optional[str]]:
    """The directory entry for `key`, looking it up if it is missing or older than
    the refresh period. Returns (doc, deferred_reason). `doc` may be a stale entry
    when a refresh was deferred. The caller has already applied the privacy
    exclusions: nothing here re-checks them.

    Deferred reasons: claimed (another process is on it), backoff (Tavily quota),
    cap_sync, cap_day, provider_error, write_up_failed, not_configured."""
    now = now or _now()
    existing = await vendors_col.find_one({"_id": key})
    if _is_fresh(existing, now):
        return existing, None
    if not cfg.VENDOR_LADDER_ENABLED:
        return existing, "disabled"
    if budget.left <= 0:
        return existing, "cap_sync"
    if await backoff_until(now):
        return existing, "backoff"
    if not await _claim(key, now):
        return existing, "claimed"
    cooldown = False
    try:
        # Someone may have finished while we waited for the claim.
        latest = await vendors_col.find_one({"_id": key})
        if _is_fresh(latest, now):
            return latest, None
        if not await _reserve_daily_slot(now):
            return existing, "cap_day"
        budget.used += 1
        try:
            found = await _tavily_search(f'"{key}" UK: what is this business or service, and where is it?')
        except ProviderFailure as pf:
            if pf.code != "not_configured":
                await record_failure(pf.code, pf.http_status, now)
            else:
                await _release_daily_slot(now)
                budget.used -= 1
            return existing, pf.code if pf.code == "not_configured" else "provider_error"
        await record_success(now)
        if not found["answer"] and not found["snippets"]:
            doc = _doc_from_llm(key, {"status": NOT_FOUND}, found["urls"], now)
            return await _store_refresh(existing, doc, now), None
        llm = await _llm_json(
            cfg.VENDOR_REASONING_MODEL, _describe_prompt(key, found),
            user_id=None, pipeline="vendor_lookup", max_tokens=400,
        )
        doc = _doc_from_llm(key, llm, found["urls"], now) if llm else None
        if doc is None:
            cooldown = True
            await _note_writeup_failure(now)
            return existing, "write_up_failed"
        await _reset_writeup_failures()
        return await _store_refresh(existing, doc, now), None
    finally:
        await _release(key, cooldown=cooldown, now=now)


# ── Per-user matching ───────────────────────────────────────────────────────

def categories_hash(allowed: list[str]) -> str:
    custom = sorted(c for c in allowed if c not in _builtin_names())
    return hashlib.sha1("|".join(custom).encode()).hexdigest()[:12]


def _builtin_names() -> list[str]:
    from app.services.categorisation import VALID_CATEGORIES
    return VALID_CATEGORIES


def _match_prompt(allowed: list[str], items: list[dict]) -> str:
    choices = ", ".join(c for c in allowed if c not in _NEVER_MATCH)
    lines = []
    for i, it in enumerate(items):
        tags = ", ".join(it.get("type_tags") or [])
        hint = it.get("hint")
        lines.append(
            f"{i + 1}. {it['display_name']}: {it['description']}"
            + (f" (tags: {tags})" if tags else "")
            + (f" [broad keyword rule suggests: {hint}]" if hint else "")
        )
    return (
        "You file a UK customer's spending into THEIR OWN categories, from a plain description of the "
        "business they paid.\n"
        f"Their categories: {choices}.\n"
        "Rules:\n"
        "- Categories that are not common names (for example Golf, Padel, Business, Family) are the "
        "customer's own words. Prefer one of them over a broader built-in when the description clearly "
        "fits it.\n"
        "- A broad keyword rule suggestion is only a hint. Ignore it when the description says otherwise.\n"
        "- Other only if nothing fits.\n"
        "- reason: one short plain sentence. British English. No em dashes.\n"
        "Reply ONLY with JSON: {\"1\": {\"category\": \"Name\", \"reason\": \"...\"}, \"2\": ...}\n\n"
        "Businesses:\n" + "\n".join(lines)
    )


async def match_descriptions(
    uid: str, allowed: list[str], items: list[dict],
) -> dict[int, tuple[str, str]]:
    """Cheap-model match of directory descriptions to this user's categories.
    `items` carry description, display_name, type_tags and an optional keyword
    hint, never raw bank text. Returns {index: (category, reason)} for answers
    that name one of the user's categories."""
    out: dict[int, tuple[str, str]] = {}
    for start in range(0, len(items), 20):
        chunk = items[start:start + 20]
        data = await _llm_json(
            cfg.VENDOR_MATCH_MODEL, _match_prompt(allowed, chunk),
            user_id=uid, pipeline="vendor_match", max_tokens=900,
        )
        if not data:
            continue
        for i in range(len(chunk)):
            ans = data.get(str(i + 1))
            if not isinstance(ans, dict):
                continue
            cat = ans.get("category")
            if cat in allowed and cat not in _NEVER_MATCH:
                out[start + i] = (cat, _clean_text(ans.get("reason"), 140))
    return out


def decision_id(uid: str, key: str) -> str:
    return f"{uid}::{key}"


async def _store_decision(uid: str, key: str, category: str, reason: str, allowed: list[str],
                          vendor: Optional[dict], now: datetime) -> None:
    await user_vendor_categories_col.update_one(
        {"_id": decision_id(uid, key)},
        {"$set": {
            "user_id": uid, "merchant_key": key, "category": category, "reason": reason,
            "decided_at": now, "categories_hash": categories_hash(allowed),
            "vendor_looked_up_at": (vendor or {}).get("looked_up_at"),
        }},
        upsert=True,
    )


# ── Candidate gathering (shared by the ladder and the cache-only pass) ──────

def _row_text(t: dict) -> str:
    return " ".join(x for x in [(t.get("merchant_name") or "").strip(), (t.get("description") or "").strip()] if x)


def row_is_eligible(category: Optional[str], kind_map: dict, builtin_kinds: dict, non_spend: frozenset) -> bool:
    """A debit row is open to the ladder when its category is unset, raw, Other,
    or a spend category. Structural and lender/landlord results stay final."""
    if category is None or category == "Other":
        return True
    if category == "TRANSFER":
        return False
    if category in _RAW_CATEGORIES:
        return True
    if category in _FINAL_KEYWORD_CATEGORIES:
        return False
    kind = kind_map.get(category) or builtin_kinds.get(category)
    return kind not in non_spend


async def _gather(uid: str) -> tuple[list[str], dict, dict, dict]:
    """(allowed categories, kind map, identity, groups). Groups are the user's
    eligible debit rows keyed by canonical merchant key."""
    from app.services import categorisation as cat
    from app.services.categories import BUILTIN_CATEGORY_KINDS, NON_SPEND_KINDS, get_category_kinds
    allowed = await cat.user_allowed_categories(uid)
    kind_map = dict(await get_category_kinds(uid))
    identity = await cat.user_identity(uid)
    rows = await transactions_col.find(
        {"user_id": uid, "custom_category": None, "transaction_type": "debit"},
        {"merchant_name": 1, "description": 1, "category": 1, "account_id": 1, "date": 1},
    ).to_list(None)
    groups: dict[str, dict] = {}
    for t in rows:
        if not row_is_eligible(t.get("category"), kind_map, BUILTIN_CATEGORY_KINDS, NON_SPEND_KINDS):
            continue
        key = cat.canonical_merchant_key(t.get("merchant_name") or "", t.get("description") or "")
        if not key:
            continue
        g = groups.setdefault(key, {"ids": [], "texts": [], "all_texts": set(), "named": False, "cats": Counter(), "latest": None, "accounts": set(),
                                    "sample": t})
        g["ids"].append(t["_id"])
        text = _row_text(t)
        if text:
            g["all_texts"].add(text)
        if (t.get("merchant_name") or "").strip():
            g["named"] = True
        if text and text not in g["texts"] and len(g["texts"]) < 5:
            g["texts"].append(text)
        g["cats"][t.get("category")] += 1
        g["accounts"].add(t.get("account_id"))
        d = t.get("date")
        if isinstance(d, datetime) and (g["latest"] is None or d > g["latest"]):
            g["latest"] = d
    return allowed, kind_map, identity, groups


async def _corrected_keys(uid: str) -> set[str]:
    """Every merchant key the user has corrected by hand (a row with a
    custom_category). The ladder never touches these, matching the keys Pass 2.5
    and Pass 4 of apply_rules_bulk use (combined, name only, description only)."""
    from app.services import categorisation as cat
    rows = await transactions_col.find(
        {"user_id": uid, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1},
    ).to_list(None)
    keys: set[str] = set()
    for t in rows:
        m, d = t.get("merchant_name") or "", t.get("description") or ""
        for k in (cat.canonical_merchant_key(m, d), cat.canonical_merchant_key(m, ""), cat.canonical_merchant_key("", d)):
            if k:
                keys.add(k)
    return keys


async def _rule_patterns(uid: str) -> list[re.Pattern]:
    out = []
    for r in await user_rules_col.find({"uid": uid}).to_list(None):
        try:
            out.append(re.compile(r["pattern"], re.IGNORECASE))
        except (re.error, KeyError, TypeError):
            continue
    return out


def _rule_matches(rules: list, g: dict) -> bool:
    """A user rule matching ANY row of the merchant (not just the sampled few)."""
    return any(p.search(t.lower()) for p in rules for t in g["all_texts"])


def has_custom_categories(allowed: list[str]) -> bool:
    return len(allowed) > len(_builtin_names())


async def apply_decisions_for_user(uid: str) -> int:
    """Cache-only pass for apply_rules_bulk (no network, no model): write each stored
    per-user decision onto the user's still-open debit rows. Returns 0 at once when the
    ladder is switched off or the user has no custom categories. Skips decisions made
    against a different set of categories, merchants the user corrected, and merchants a
    user rule covers."""
    if not cfg.VENDOR_LADDER_ENABLED:
        return 0
    from app.services import categorisation as cat
    allowed = await cat.user_allowed_categories(uid)
    if not has_custom_categories(allowed):
        return 0
    decisions = {
        d["merchant_key"]: d
        for d in await user_vendor_categories_col.find({"user_id": uid}).to_list(None)
        if d.get("merchant_key")
    }
    if not decisions:
        return 0
    chash = categories_hash(allowed)
    decisions = {k: d for k, d in decisions.items() if d.get("categories_hash") == chash}
    if not decisions:
        return 0
    allowed, _kinds, _identity, groups = await _gather(uid)
    if not groups:
        return 0
    corrected = await _corrected_keys(uid)
    rules = await _rule_patterns(uid)
    updated = 0
    for key, g in groups.items():
        d = decisions.get(key)
        if not d or d.get("category") in (None, "Other") or d.get("category") not in allowed:
            continue
        if key in corrected or _rule_matches(rules, g):
            continue
        res = await transactions_col.update_many(
            {"_id": {"$in": g["ids"]}, "custom_category": None, "category": {"$ne": d["category"]}},
            {"$set": {"category": d["category"]}},
        )
        updated += res.modified_count
    return updated


# ── The ladder ──────────────────────────────────────────────────────────────

async def run_vendor_ladder(
    uid: str,
    *,
    dry_run: bool = False,
    allow_lookups: bool = True,
    allow_match: bool = True,
    now: Optional[datetime] = None,
    budget: Optional[SyncBudget] = None,
    ensure_fn: Optional[Callable[..., Awaitable]] = None,
    match_fn: Optional[Callable[..., Awaitable]] = None,
) -> dict:
    """Run the sync-time ladder for one user and return counts (and `proposals`).

    `dry_run` writes nothing (no decision, no row). `allow_lookups` False means a
    merchant missing from the directory is only counted. `allow_match` False means
    a described merchant with no stored decision is only counted. `ensure_fn` and
    `match_fn` replace the real lookup and model match (tests, the report)."""
    from app.services import categorisation as cat
    now = now or _now()
    stats: dict = {
        "ran": False, "skipped": None, "merchants": 0, "rows": 0, "corrected_skipped": 0, "rule_skipped": 0,
        "private_skipped": {}, "decided_cached": 0, "decided_new": 0, "no_description": 0,
        "needs_lookup": 0, "needs_match": 0, "lookups_started": 0, "deferred": {}, "rows_updated": 0,
        "would_update_rows": 0, "proposals": [],
    }
    if not cfg.VENDOR_LADDER_ENABLED:
        stats["skipped"] = "disabled"
        return stats
    allowed = await cat.user_allowed_categories(uid)
    if not has_custom_categories(allowed):
        stats["skipped"] = "no_custom_categories"  # today's behaviour, unchanged
        return stats
    allowed, kind_map, identity, groups = await _gather(uid)
    stats["ran"] = True
    corrected = await _corrected_keys(uid)
    rules = await _rule_patterns(uid)
    budget = budget or SyncBudget()
    injected_ensure, injected_match = ensure_fn is not None, match_fn is not None
    ensure_fn = ensure_fn or ensure_vendor
    match_fn = match_fn or match_descriptions
    chash = categories_hash(allowed)

    ordered = sorted(groups.items(), key=lambda kv: kv[1]["latest"] or datetime.min, reverse=True)
    pending: list[tuple[str, dict, dict]] = []   # (key, group, vendor doc) awaiting a match
    handled = 0
    for key, g in ordered:
        stats["merchants"] += 1
        stats["rows"] += len(g["ids"])
        if key in corrected:
            stats["corrected_skipped"] += 1
            continue
        if _rule_matches(rules, g):
            stats["rule_skipped"] += 1
            continue
        top_cat = g["cats"].most_common(1)[0][0]
        why = privacy_exclusion(key, g["texts"], category=top_cat, identity=identity, has_merchant_name=g["named"],
                                own_account_id=next(iter(g["accounts"]), None))
        if why:
            stats["private_skipped"][why] = stats["private_skipped"].get(why, 0) + 1
            continue
        if handled >= cfg.VENDOR_MATCH_CAP_PER_SYNC:
            stats["deferred"]["cap_match"] = stats["deferred"].get("cap_match", 0) + 1
            continue

        vendor = await vendors_col.find_one({"_id": key})
        decision = await user_vendor_categories_col.find_one({"_id": decision_id(uid, key)})
        decision_ok = bool(
            decision and decision.get("categories_hash") == chash and decision.get("category") in allowed
            and (vendor is None or decision.get("vendor_looked_up_at") == vendor.get("looked_up_at"))
        )
        if decision_ok:
            handled += 1
            stats["decided_cached"] += 1
            await _apply(uid, key, g, decision["category"], vendor, decision.get("reason", ""), stats, dry_run)
            continue

        if vendor is None or not _is_fresh(vendor, now):
            stats["needs_lookup"] += 1
            if allow_lookups and (not dry_run or injected_ensure):
                fresh, deferred = await ensure_fn(key, budget, now)
                if deferred is None:
                    stats["lookups_started"] += 1
                else:
                    stats["deferred"][deferred] = stats["deferred"].get(deferred, 0) + 1
                vendor = fresh or vendor
        if not vendor or vendor.get("status") != FOUND or not vendor.get("description"):
            stats["no_description"] += 1   # not_found / not_a_business / unavailable: the keyword path stands
            continue
        handled += 1
        stats["needs_match"] += 1
        hint = cat.rule_categorise(g["sample"].get("merchant_name") or "", g["sample"].get("description") or "")
        pending.append((key, g, {**vendor, "_hint": hint if hint and hint not in _FINAL_KEYWORD_CATEGORIES else None}))

    if pending and allow_match and (not dry_run or injected_match):
        items = [{"display_name": v.get("display_name") or k, "description": v["description"],
                  "type_tags": v.get("type_tags") or [], "hint": v.get("_hint")} for k, _g, v in pending]
        answers = await match_fn(uid, allowed, items)
        for i, (key, g, v) in enumerate(pending):
            ans = answers.get(i)
            if not ans:
                continue
            category, reason = ans
            stats["decided_new"] += 1
            if not dry_run:
                await _store_decision(uid, key, category, reason, allowed, v, now)
            await _apply(uid, key, g, category, v, reason, stats, dry_run)
    return stats


async def _apply(uid: str, key: str, g: dict, category: str, vendor: Optional[dict], reason: str,
                 stats: dict, dry_run: bool) -> None:
    """Write a decided category onto the merchant's open rows (never a corrected
    row: the filter re-checks custom_category at write time). 'Other' means the
    model had no opinion, so the keyword category stands."""
    current = g["cats"].most_common(1)[0][0]
    if len(stats["proposals"]) < 500:
        stats["proposals"].append({
            "merchant_key": key,
            "display_name": (vendor or {}).get("display_name") or key,
            "description": (vendor or {}).get("description"),
            "rows": len(g["ids"]), "current_category": current,
            "proposed_category": category, "reason": reason,
        })
    if category in (None, "Other"):
        return
    if dry_run:
        stats["would_update_rows"] += sum(n for c, n in g["cats"].items() if c != category)
        return
    res = await transactions_col.update_many(
        {"_id": {"$in": g["ids"]}, "custom_category": None, "category": {"$ne": category}},
        {"$set": {"category": category}},
    )
    stats["rows_updated"] += res.modified_count
