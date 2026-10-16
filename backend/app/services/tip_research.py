"""Shared savings-tip research (B48).

A savings tip has two layers. The research layer is market knowledge (typical
prices, alternatives, a deal and its deadline) and is not personal: one
document per shared key in `tip_research`, fetched once and read by every user
who matches the key. The personal layer (the user's own figures and wording)
is composed deterministically in routers/savings_insights.py from these
findings and never calls anything external.

Key: (insight_category, provider_key, price_band, region "UK", prompt_version).
  - provider_key is a normalised provider name from the category's own curated
    trigger list ("ee", "british gas"), never a free-text merchant string. A
    merchant outside that list becomes "other". Grocery and eating-out tips
    share by behaviour profile instead ("profile_front_loader").
  - price_band is a coarse bucket from PRICE_BANDS, never an amount.

Privacy rule: a document holds NO user id, amount, transaction, name or
per-user count. `assert_no_user_data` is run on every document before it is
written and fails closed. The per-user erasure sweep deliberately matches
nothing in this collection (see ERASURE_MANIFEST).

Refresh rule: a key is fetched at most once per TTL (7 days, the same
`content_valid_until` rule as a tip: the sooner of the deal deadline and the
TTL) across all users, with an in-process in-flight guard plus a short database
lease so concurrent callers share one fetch. A failed fetch keeps the last good
findings, marks them `stale`, and is not retried for RETRY_AFTER (B44: quota,
auth and rate failures also stop the whole pass, handled by the caller).
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional

from pymongo.errors import DuplicateKeyError

from app.db.collections import tip_research_col

log = logging.getLogger(__name__)

REGION = "UK"
# Version of the research prompt and findings shape. Bump to force every key
# to be fetched again. Independent of the per-user tip PROMPT_VERSION.
RESEARCH_PROMPT_VERSION = 1

TTL = timedelta(days=7)
# After a failed attempt the key is left alone this long, so a flaky provider
# is never hammered by every user in every pass.
RETRY_AFTER = timedelta(hours=6)
# Short database lease so a second process (API versus worker) does not
# duplicate a fetch another one is already running.
LEASE = timedelta(minutes=5)
_EPOCH = datetime(1970, 1, 1)

# One table: upper edges of each band in pounds per month. Five buckets per
# category: under e0, e0 to e1, e1 to e2, e2 to e3, over e3. Categories
# absent here are shared by behaviour profile and use the single band "all".
PRICE_BANDS: dict[str, tuple[int, int, int, int]] = {
    "mobile":        (10, 20, 40, 60),
    "broadband":     (20, 30, 45, 70),
    "energy":        (60, 100, 150, 250),
    "car_insurance": (30, 60, 100, 150),
    "car_finance":   (150, 250, 400, 600),
    "mortgage":      (500, 1000, 1500, 2500),
    "gym":           (20, 40, 60, 100),
    "subscriptions": (10, 25, 50, 100),
}
PROFILE_CATEGORIES = frozenset({"groceries", "eating_out"})
PROFILE_BAND = "all"
UNKNOWN_BAND = "unknown"
GENERIC_PROVIDER = "other"

# Behaviour profiles (Mirror trait keys) a profile-shared category may use.
# Anything else collapses to "general".
PROFILE_KEYS = frozenset({"front_loader", "eating_out_signature", "general"})

STATUSES = ("ok", "stale", "failed", "pending")

# Keys that must never appear anywhere in a tip_research document.
FORBIDDEN_KEYS = frozenset({
    "user_id", "uid", "user", "users", "email", "amount", "amounts", "monthly_amount",
    "occurrences", "count", "counts", "transaction", "transactions", "transaction_id",
    "triggered_by", "merchant_name", "merchant_key", "display_name", "user_context",
    "name_of_user", "account", "account_id", "balance", "verified_savings",
})

_LEGAL_SUFFIX_RE = re.compile(r"\s+(?:ltd|limited|plc|llp|uk|co)$", re.IGNORECASE)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: persisted naive-UTC convention for this collection


# ── Key ─────────────────────────────────────────────────────────────────────

def provider_slug(phrase: str | None) -> str:
    """Normalise a provider name: lowercase, "+" read as "plus", punctuation
    removed, legal and "uk" suffixes stripped. "EE Ltd" -> "ee",
    "British Gas" -> "british gas", "Disney+" -> "disney plus"."""
    s = (phrase or "").lower().replace("+", " plus ").replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    for _ in range(2):
        stripped = _LEGAL_SUFFIX_RE.sub("", s)
        if stripped and stripped != s:
            s = stripped
    return s or GENERIC_PROVIDER


def band_for(category: str, monthly_amount: float | None) -> str:
    """Coarse price band label for a monthly amount, or "unknown" when there
    is no amount. Profile-shared categories always use "all"."""
    if category in PROFILE_CATEGORIES:
        return PROFILE_BAND
    edges = PRICE_BANDS.get(category)
    if edges is None or monthly_amount is None or monthly_amount <= 0:
        return UNKNOWN_BAND
    e0, e1, e2, e3 = edges
    if monthly_amount < e0:
        return f"under_{e0}"
    if monthly_amount < e1:
        return f"{e0}_{e1}"
    if monthly_amount < e2:
        return f"{e1}_{e2}"
    if monthly_amount < e3:
        return f"{e2}_{e3}"
    return f"over_{e3}"


def band_phrase(category: str, band: str) -> str:
    """Human wording for a band, used only inside the research prompt."""
    if band in (PROFILE_BAND, UNKNOWN_BAND):
        return ""
    if band.startswith("under_"):
        return f"under £{band[6:]} a month"
    if band.startswith("over_"):
        return f"over £{band[5:]} a month"
    lo, _, hi = band.partition("_")
    return f"£{lo} to £{hi} a month"


@dataclass(frozen=True)
class TipKey:
    category: str
    provider_key: str
    price_band: str
    region: str = REGION
    prompt_version: int = RESEARCH_PROMPT_VERSION

    @property
    def doc_id(self) -> str:
        return f"{self.category}|{self.provider_key}|{self.price_band}|{self.region}|v{self.prompt_version}"


def make_key(category: str, provider_phrase: str | None, monthly_amount: float | None,
             profile: str | None = None) -> TipKey:
    if category in PROFILE_CATEGORIES:
        p = profile if profile in PROFILE_KEYS else "general"
        return TipKey(category, f"profile_{p}", PROFILE_BAND)
    provider = provider_slug(provider_phrase) if provider_phrase else GENERIC_PROVIDER
    return TipKey(category, provider, band_for(category, monthly_amount))


# ── Privacy ─────────────────────────────────────────────────────────────────

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
_PERSONAL_WORD_RE = re.compile(r"\b(?:you|your|yours|i|my|me|we|our|ours)\b", re.IGNORECASE)
_MONEY_OR_DECIMAL_RE = re.compile(r"£|\d\.\d")
# The only places a figure may live: grounded numbers, not text.
_NUMBER_PATHS = re.compile(
    r"^findings\.(?:typical_low|typical_high|deal\.price|alternatives\.\d+\.price)$"
)


def assert_no_user_data(doc) -> None:
    """Raise ValueError if `doc` could carry user data. Checked on every write
    (fail closed):
      - a forbidden key anywhere;
      - any string value that looks like an email address;
      - a "£" or a decimal figure inside any string (figures belong only in
        findings.typical_low, typical_high, alternatives[].price and
        deal.price, which must be plain numbers);
      - a plain number inside `findings` anywhere else;
      - a first or second person word (you, your, I, my, me, we, our) in a
        text field.
    Source URLs are exempt from the figure and pronoun checks only."""
    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                if str(k).lower() in FORBIDDEN_KEYS:
                    raise ValueError(f"tip_research document carries forbidden key {path}{k}")
                walk(v, f"{path}{k}.")
        elif isinstance(node, (list, tuple)):
            for i, v in enumerate(node):
                walk(v, f"{path}{i}.")
        elif isinstance(node, str):
            where = path.rstrip(".")
            if _EMAIL_RE.search(node):
                raise ValueError(f"tip_research document carries an email address at {where}")
            if where.startswith("findings.sources."):
                return
            if _MONEY_OR_DECIMAL_RE.search(node):
                raise ValueError(f"tip_research document carries a figure in text at {where}")
            if _PERSONAL_WORD_RE.search(node):
                raise ValueError(f"tip_research document carries personal wording at {where}")
        elif isinstance(node, (int, float)) and not isinstance(node, bool):
            where = path.rstrip(".")
            if where.startswith("findings.") and not _NUMBER_PATHS.match(where):
                raise ValueError(f"tip_research document carries a figure outside the number fields at {where}")
    walk(doc, "")


# ── Fetch orchestration ─────────────────────────────────────────────────────

@dataclass
class FetchOutcome:
    findings: Optional[dict] = None
    claim_valid_until: Optional[datetime] = None
    failure: Optional[str] = None  # static code from tips_research_health, never provider text


@dataclass
class ResearchResult:
    doc: Optional[dict]          # stored document (may carry stale findings) or None
    state: str                   # "fresh" | "fetched" | "stale" | "none"
    fetched: bool = False        # True only for the caller whose call did the fetch
    failure: Optional[str] = None


Fetcher = Callable[[TipKey], Awaitable[FetchOutcome]]

_inflight: dict[str, "asyncio.Future[ResearchResult]"] = {}


def _usable(doc: Optional[dict], now: datetime) -> bool:
    return bool(
        doc and doc.get("status") == "ok" and doc.get("findings")
        and doc.get("content_valid_until") and now < doc["content_valid_until"]
    )


def _has_findings(doc: Optional[dict]) -> bool:
    return bool(doc and doc.get("findings"))


def content_valid_until(fetched_at: datetime, claim_valid_until: Optional[datetime]) -> datetime:
    """The sooner of a deal's own deadline and the TTL, the same rule a tip
    uses (`_compute_content_valid_until` in routers/savings_insights.py)."""
    expiry = fetched_at + TTL
    return min(claim_valid_until, expiry) if claim_valid_until else expiry


async def ensure_research(
    key: TipKey, fetcher: Fetcher, *, allow_fetch: bool = True, now: Optional[datetime] = None,
) -> ResearchResult:
    """Return usable findings for `key`, fetching at most once per TTL across
    every caller. With allow_fetch False it only ever reads."""
    now = now or _now()
    doc = await tip_research_col.find_one({"_id": key.doc_id})
    if _usable(doc, now):
        return ResearchResult(doc, "fresh")
    stale_state = "stale" if _has_findings(doc) else "none"
    if not allow_fetch:
        return ResearchResult(doc, stale_state)
    attempted = (doc or {}).get("last_attempt_at")
    if (
        doc and attempted and doc.get("status") in ("stale", "failed")
        and doc.get("last_failure_code") != "backoff" and now - attempted < RETRY_AFTER
    ):
        return ResearchResult(doc, stale_state, failure=doc.get("last_failure_code") or "error")

    existing = _inflight.get(key.doc_id)
    if existing is not None:
        shared = await asyncio.shield(existing)
        return ResearchResult(shared.doc, shared.state, fetched=False, failure=shared.failure)

    fut: "asyncio.Future[ResearchResult]" = asyncio.get_running_loop().create_future()
    _inflight[key.doc_id] = fut
    try:
        result = await _fetch_once(key, fetcher, now)
    except BaseException as exc:  # never leave waiters hanging
        if not fut.done():
            fut.set_exception(exc)
            fut.exception()  # mark retrieved so an unawaited future does not warn
        raise
    else:
        fut.set_result(result)
        return result
    finally:
        _inflight.pop(key.doc_id, None)


def _stub(key: TipKey, lease_until: datetime) -> dict:
    """An empty document: key fields only, no findings and no timestamps other
    than the lease. last_attempt_at is set only by a real fetch outcome."""
    return {
        "_id": key.doc_id, "insight_category": key.category, "provider_key": key.provider_key,
        "price_band": key.price_band, "region": key.region, "prompt_version": key.prompt_version,
        "findings": None, "as_of": None, "fetched_at": None, "content_valid_until": None,
        "claim_valid_until": None, "status": "pending", "last_failure_code": None,
        "lease_until": lease_until,
    }


async def _claim_lease(key: TipKey, now: datetime) -> bool:
    lease_until = now + LEASE
    res = await tip_research_col.update_one(
        {"_id": key.doc_id, "lease_until": {"$lt": now}}, {"$set": {"lease_until": lease_until}},
    )
    if res.modified_count:
        return True
    doc = _stub(key, lease_until)
    assert_no_user_data(doc)
    try:
        await tip_research_col.insert_one(doc)
        return True
    except DuplicateKeyError:
        return False


async def _fetch_once(key: TipKey, fetcher: Fetcher, now: datetime) -> ResearchResult:
    if not await _claim_lease(key, now):
        # Another process holds the lease: use whatever is stored, no fetch.
        doc = await tip_research_col.find_one({"_id": key.doc_id})
        return ResearchResult(doc, "stale" if _has_findings(doc) else "none")
    try:
        outcome = await fetcher(key)
    except Exception as exc:  # a fetcher bug must not break the pass or hold the lease
        log.warning("tip research: fetcher raised %s for key=%s", type(exc).__name__, key.doc_id)
        outcome = FetchOutcome(failure="error")

    prior = await tip_research_col.find_one({"_id": key.doc_id}) or {}
    if outcome.findings:
        fetched_at = _now()
        update = {
            "findings": outcome.findings, "as_of": fetched_at.date().isoformat(), "fetched_at": fetched_at,
            "claim_valid_until": outcome.claim_valid_until,
            "content_valid_until": content_valid_until(fetched_at, outcome.claim_valid_until),
            "status": "ok", "last_attempt_at": fetched_at, "last_failure_code": None,
            "lease_until": _EPOCH, "origin": "fetched",
        }
        try:
            assert_no_user_data(update)
        except ValueError:
            # Fail closed: a document that could carry user data is never
            # written. Treated as a failed fetch (the lease is released below).
            log.error("tip research: refused to write findings carrying a forbidden key, key=%s", key.doc_id)
            outcome = FetchOutcome(failure="error")
        else:
            await tip_research_col.update_one({"_id": key.doc_id}, {"$set": update})
            doc = await tip_research_col.find_one({"_id": key.doc_id})
            return ResearchResult(doc, "fetched", fetched=True)

    code = outcome.failure or "error"
    update = {
        "status": "stale" if _has_findings(prior) else "failed",
        "last_attempt_at": _now(), "last_failure_code": code, "lease_until": _EPOCH,
    }
    await tip_research_col.update_one({"_id": key.doc_id}, {"$set": update})
    doc = await tip_research_col.find_one({"_id": key.doc_id})
    return ResearchResult(doc, "stale" if _has_findings(doc) else "none", fetched=True, failure=code)


async def precreate_pending(key: TipKey, *, dry_run: bool = False) -> bool:
    """Backfill helper: create an EMPTY pending stub for a key that has no
    document yet, so the first pass fetches it. Carries no findings, no
    timestamps and nothing derived from any tip. Returns True if created (in
    dry_run, if it would be); nothing is written in dry_run."""
    if await tip_research_col.find_one({"_id": key.doc_id}):
        return False
    if dry_run:
        return True
    try:
        await tip_research_col.insert_one(_stub(key, _EPOCH))
    except DuplicateKeyError:
        return False
    return True
