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
from urllib.parse import parse_qs, quote, urlparse

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS, TAVILY_API_KEY, APP_URL
from app.core.subscription import Tier, require_tier
from app.services.categories import (
    BUILTIN_CATEGORY_KINDS, COMMITMENT, DISCRETIONARY, get_category_kinds, kind_of,
)
from app.db.collections import (
    savings_insights_col, savings_labels_col,
    transactions_col, yapily_transactions_col,
    mono_transactions_col, statement_transactions_col,
    preferences_col, cashflow_cache_col,
)

router = APIRouter(tags=["savings_insights"])
log    = logging.getLogger(__name__)

INSIGHT_CATEGORIES: dict[str, dict] = {
    "energy": {
        "icon": "⚡", "label": "Energy",
        "query": "best energy tariff switch UK {year} cheapest deals save money",
        "triggers": ["british gas", "eon", "edf", "scottish power", "octopus energy", "npower", "sse", "bulb energy", "shell energy", "utilita", "utility warehouse", "bg energy"],
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
        "triggers": ["direct line", "admiral", "aviva", "hastings direct", "churchill", "more than", "lv=", "esure", "elephant auto"],
    },
    "broadband": {
        "icon": "📡", "label": "Broadband",
        "query": "best broadband deals UK {year} switch provider save money",
        "triggers": ["bt", "bt group", "virgin media", "sky broadband", "talktalk", "vodafone broadband", "now broadband", "plusnet", "community fibre", "hyperoptic"],
    },
    "mobile": {
        "icon": "📱", "label": "Mobile",
        "query": "best SIM only mobile plan UK {year} cheapest deal",
        "triggers": ["ee ltd", "ee limited", "ee", "o2", "vodafone", "three", "giffgaff", "sky mobile", "tesco mobile", "id mobile", "lycamobile"],
    },
    "groceries": {
        "icon": "🛒", "label": "Groceries",
        "query": "cheapest UK supermarket comparison {year} where to shop save groceries",
        "triggers": ["tesco", "sainsbury", "asda", "morrisons", "waitrose", "lidl", "aldi", "co-op", "marks and spencer food", "ocado", "m&s food"],
    },
    "eating_out": {
        "icon": "🍽️", "label": "Eating Out",
        "query": "restaurant dining offers discounts UK {year} deals save money eating out",
        "triggers": ["restaurant", "mcdonald", "kfc", "nando", "wagamama", "pizza express", "prezzo", "costa coffee", "starbucks", "pret a manger", "itsu", "leon", "subway"],
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
# v5: trigger merchants are now grouped on a normalised key (see
# _normalize_merchant_key) instead of the raw bank descriptor, and a
# duplicate-payment claim ("paying N times") is rejected unless the data
# shows genuinely overlapping same-month charges (see
# _duplicate_claim_is_supported) — previously-generated insights may carry a
# fragmented trigger list or an unsupported duplicate claim from before this
# fix and need to regenerate through the new logic.
# v6: two data-quality fixes to the trigger pipeline. (a) trigger matching is
# now word-boundary phrase matching (see _TRIGGER_PATTERNS), not substring
# containment — previously-stored `triggered_by` lists may contain
# transactions that only matched by accident (the confirmed live case: the
# "ee" mobile trigger matching inside "...Mowgli Stree Birmin" and "...Avios
# Fee..." via a bare "ee" substring), which is wrong evidence baked into a
# stored doc that word-boundary matching alone can't retroactively clean —
# only a regeneration re-runs _find_triggered_transactions from scratch. (b)
# _normalize_merchant_key now also collapses UK company-suffix noise
# (Ltd/Limited/PLC/LLP/& Co/Co, trailing bare "UK"), apostrophes, domain
# suffixes (.co.uk/.com) and bank date-stamp noise ("1435 ON 29 MAY CLP")
# into a single key — previously-generated insights may carry a merchant
# split across two of these variants (the confirmed live case: "Ee Ltd" and
# "Ee Limited" as two separate trigger lines, so the card's bold lead figure
# — triggered_by[0] alone — disagreed with the generated title, which sums
# every trigger line) and need to regenerate through the new grouping.
PROMPT_VERSION = 6

# In-app destination per category — the screen where the user can act on the
# insight with their own data (frontend renders this as the primary action).
#
# Points at the global search hub (/transactions), not the period-scoped
# Spend view — this was the original trust bug: an insight about a merchant
# used to open Spend's CategorySheet, which is scoped to the current pay
# period, so a merchant with history outside that window showed only a
# fraction of its transactions ("2 payments" for a bill paid every month for
# years). /transactions?category=X searches ALL history via
# GET /transactions/search, so the evidence behind the insight is complete.
# mortgage/car_finance: no single reliable category — a mortgage payment can
# land in "Bills" or "Other" depending on how the user's bank labels it, and
# a wrong category guess would silently hide the very payments the CTA
# promises. Routed on merchant alone (bare "/transactions", which
# _merchant_scoped_route turns into "/transactions?merchants=<names>") so the
# search is scoped to the transactions that actually triggered the insight,
# not a category that may not contain them.
CATEGORY_APP_ROUTES: dict[str, str] = {
    "subscriptions": "/transactions?category=Subscriptions",
    "mobile":        "/transactions?category=Bills",
    "broadband":     "/transactions?category=Bills",
    "energy":        "/transactions?category=Bills",
    "groceries":     "/transactions?category=Groceries",
    "eating_out":    "/transactions?category=Eating%20Out",
    "gym":           "/transactions?category=Health",
    "car_finance":   "/transactions",
    "mortgage":      "/transactions",
    "car_insurance": "/transactions?category=Bills",
    "insurance":     "/transactions?category=Bills",
    "water":         "/transactions?category=Bills",
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

# House-style guardrail: rule 7 in the prompt above tells the model never to
# use an em-dash or en-dash, but live testing showed the model can still
# produce one (search-result text it's summarising often carries them, and
# instructions alone aren't a hard guarantee). Post-hoc backstop, same
# pattern as _NON_UK_RE / _CARD_DEBT_MOVE_RE: replace rather than reject, so
# a single stray dash doesn't burn a regeneration attempt or drop an
# otherwise-good insight. A plain hyphen (compound words, numeric ranges) is
# untouched.
#
# Two different jobs share the "no em/en-dash" rule and need two different
# replacements. A dash BETWEEN numeric-ish tokens (£15–£30, 4–8×, 50–100
# Mbps) is a range — collapsing it to a comma reads as nonsense ("£15,
# £30"), so that case is normalised to a plain hyphen instead (matches the
# CATEGORY_WORKFLOWS dropdown labels above, e.g. "50-100 Mbps"). A dash in
# prose (Tuesday–Friday, "you pay X — try Y") is a clause break, not a
# range, so that case becomes a comma as before. Numeric-range detection
# runs FIRST so those dashes are already plain hyphens (no longer matched
# by _DASH_RE) by the time the prose rule runs on what's left.
_NUMERIC_RANGE_DASH_RE = re.compile(r"(?<=[0-9×%])\s*[–—]\s*(?=[£0-9])")
_DASH_RE = re.compile(r"\s*[—–]\s*")

# Broken-decimal guardrail: a digit, a period, one-or-more whitespace chars,
# then another digit ("4. 47%", "£17. 99") is essentially always a decimal
# literal that picked up a stray space, never a genuine sentence break (a
# real sentence boundary is a period followed by a capital letter or the end
# of the string, not by a bare digit). Investigated 2026-08-18: stored
# savings-insight docs in Mongo were already clean (0/27 matches across
# title/body/savings_estimate), so the space is not being written by the
# generation pipeline. The actual corruption was traced to the frontend's
# sentence-preview splitter (InsightBody in
# frontend/app/insights/InsightsPage.tsx), which tokenised prose on every
# ".", including inside "4.47%", and rejoined the fragments with
# .join(" ") -- turning "4.47%" into "4." + "47%" -> "4. 47%". That frontend
# bug is the real fix (see InsightsPage.tsx), but this backend pass is added
# anyway as requested defense-in-depth: applied at both generation-time and
# serve-time so any other consumer of this JSON (or a future frontend
# regression) can't resurface the same artefact. Guarded to require a digit
# on both sides so it can never touch a real sentence break ("...available.
# If your..." has a capital letter after the space, not a digit, so it's
# untouched).
_DECIMAL_SPACE_RE = re.compile(r"(?<=\d)\.\s+(?=\d)")


# Duplicate-payment guardrail: the model can read several trigger lines for
# the same brand and narrate it as "you're paying N times" / "N separate
# charges". That's only true if the charges genuinely overlap (2+ similar
# amounts landing in the SAME calendar month) — a merchant billed once a
# month under a rotating bank descriptor is one subscription, not several.
# Checked post-generation like _NON_UK_RE/_CARD_DEBT_MOVE_RE: one
# regeneration attempt, then the insight is dropped rather than stored.
_DUPLICATE_CLAIM_RE = re.compile(
    r"\btwice\b"
    r"|\b(?:two|three|four|five|six|\d+)\s*(?:times|x)\b"
    r"|\b(?:two|three|four|five|six|\d+)\s+separate\b"
    r"|duplicat\w*\s+(?:charge|payment|subscription)s?"
    r"|(?:charged|billed)\s+(?:twice|multiple\s+times)",
    re.IGNORECASE,
)


def _duplicate_claim_is_supported(text: str, triggered_by: Optional[list[dict]]) -> bool:
    """True unless `text` accuses the user of a duplicate/repeat payment
    ("paying twice", "three times", "N separate charges", "duplicate
    payments"...) that the underlying transaction data doesn't back up.

    A genuine duplicate needs 2+ charges of similar amount landing close
    together in time (within ~20 days — comfortably shorter than any normal
    monthly cycle) somewhere in `triggered_by` (see the `overlapping_charge`
    flag set by `_find_triggered_transactions`, which is computed on
    merchant-normalised buckets using a day-gap test, not a calendar-month
    one — a monthly subscription billed near a month boundary can land on,
    say, 1 Jul and 31 Jul, which is the same calendar month but 30 days
    apart and perfectly normal). A merchant billed once a month under a
    rotating bank descriptor (e.g. "NETFLIX.COM 18665797172" one month,
    "NETFLIX.COM LONDON" the next, "NETFLIX.COM 203832 LND" the month after)
    is ONE subscription, not several — even if merchant normalisation
    somehow failed to collapse the descriptor variants into a single trigger
    bucket, this check still refuses to store the false claim. Belt and
    braces alongside the normaliser, not a replacement for it."""
    if not _DUPLICATE_CLAIM_RE.search(text):
        return True
    return any(t.get("overlapping_charge") for t in (triggered_by or []))


# Dated-promo guardrail (Insights honesty review, Package A #5): a generated
# body can describe a specific, time-bound promotion ("this month's energy
# switch offer", "the January sale") that reads as evergreen advice but is
# actually only true until some date the model didn't state. Unlike the
# BILL categories (energy, mortgage, broadband, mobile, car_insurance),
# which already track a real deal/contract end date via CATEGORY_WORKFLOWS +
# `deadline_window`, the categories in `_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY`
# have nothing else keeping a dated claim honest once its window passes.
#
# Heuristic, not a parser: fires when an offer/discount/deal/promo/sale word
# sits near (within ~60 chars) a date-ish or event-ish token — "until",
# "ends", "expires", a calendar month, or a named shopping event (Black
# Friday, Boxing Day, Prime Day, Cyber Monday) or the word "results" (a
# provider quoting its own quarterly/annual results as the reason for a
# time-limited deal). Deliberately generous on the gap so "20% off until 31
# March" and "a Black Friday deal, expect it to end late November" both
# match; deliberately still narrow on the trigger words so it doesn't fire
# on every mention of a month (a plain "cheaper in March" with no offer/deal
# word nearby is not a promo claim).
_PROMO_WORD_RE_FRAG = r"(?:offers?|discounts?|deals?|promos?|promotions?|sale)"
_PROMO_DATE_TOKEN_RE_FRAG = (
    r"(?:until|ends?|ending|expir\w*|valid\s+(?:until|through)|results?|day|"
    r"black\s+friday|cyber\s+monday|boxing\s+day|prime\s+day|"
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|"
    r"aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
# Bidirectional on purpose: everyday phrasing puts the event/date BEFORE the
# offer word just as often as after it ("a Black Friday deal", "a January
# sale" vs. "a deal that ends in March") — a one-directional regex missed
# the first, much more common, shape.
_DATED_PROMO_RE = re.compile(
    rf"\b{_PROMO_WORD_RE_FRAG}\b(?:(?!\.).){{0,60}}?\b{_PROMO_DATE_TOKEN_RE_FRAG}\b"
    rf"|\b{_PROMO_DATE_TOKEN_RE_FRAG}\b(?:(?!\.).){{0,60}}?\b{_PROMO_WORD_RE_FRAG}\b",
    re.IGNORECASE | re.DOTALL,
)


def _parse_claim_valid_until(raw: Optional[str]) -> Optional[datetime]:
    """Parse a `claim_valid_until` value the generation prompt was asked to
    supply whenever the dated-promo guardrail above fires (see the hard_rules
    contract in `_generate_savings_insight_content`). Returns a real date, or
    None when `raw` is missing, blank, the literal 'no_expiry_known', or not
    parseable as a date. Deliberately reuses the same three date shapes
    `_parse_deadline` already accepts ('2027-03-31', '2027-03', 'March
    2027') plus a full ISO date, so the model has one consistent date
    contract across both features rather than two subtly different ones."""
    if not raw:
        return None
    text = str(raw).strip()
    if not text or text.lower() == "no_expiry_known":
        return None
    m = re.search(r"(20\d{2})-(\d{1,2})-(\d{1,2})", text)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 2020 <= year <= 2100:
            try:
                return datetime(year, month, min(day, monthrange(year, month)[1]))
            except ValueError:
                return None
    m = re.search(r"(20\d{2})[-/](\d{1,2})\b", text)
    if m:
        year, month = int(m.group(1)), int(m.group(2))
        if 1 <= month <= 12 and 2020 <= year <= 2100:
            return datetime(year, month, monthrange(year, month)[1])
    m = re.search(r"([a-z]{3,9})\s*'?(\d{2,4})", text.lower())
    if m and m.group(1)[:3] in _MONTHS_MAP:
        month = _MONTHS_MAP[m.group(1)[:3]]
        year  = int(m.group(2))
        if year < 100:
            year += 2000
        if 2020 <= year <= 2100:
            return datetime(year, month, monthrange(year, month)[1])
    return None


# Dated-promo STRIP FALLBACK (owner phone report 2026-09-01, 20:04, live tap
# on subscriptions): the guardrail above is right that a dated claim without
# a parseable claim_valid_until must never be stored, but dropping the WHOLE
# insight when both generation attempts trip it made deal-heavy categories
# (subscriptions especially — the underlying web results are almost always
# phrased as "offer ends...", bundle deals, etc.) structurally unable to
# produce a card at all: three straight 502s in one session. The retry
# already tells the model exactly what to fix (see the
# "dated_promo_missing_expiry" branch in the attempt-prompt chain below), so
# a second failure means the model still couldn't comply, not that it wasn't
# told. Rather than burn a third attempt or drop everything, this removes
# only the offending SENTENCE(s) and keeps the rest of the body/title —
# degrade by stripping, not dropping, same philosophy as
# `_strip_unsupported_savings_claims` just above.
#
# Sentence, not clause, granularity: a dated-promo claim reads as a whole
# sentence ("Switch during this January's offer, it ends soon.") rather than
# a comma-separated fragment the way an unsupported-savings clause does, so
# splitting on `,` (as the clause-level stripper does) would either leave the
# promo half of the sentence behind or mangle unrelated prose sharing the
# same sentence. `_DATED_PROMO_RE`'s own inner `(?:(?!\.).){0,60}?` already
# refuses to span a literal "." (see the regex above), so a single sentence
# is also the largest unit that regex can match within, which keeps this
# strip precise: dropping sentence N never touches sentence N+1.
def _strip_dated_promo_sentences(text: Optional[str]) -> Optional[str]:
    """Remove every sentence in `text` that matches `_DATED_PROMO_RE` (a
    dated/time-bound promo claim), keep every other sentence untouched, and
    rejoin. Blank input, or input with nothing left after stripping, returns
    "" — same "never re-show a blank as content" contract
    `_strip_unsupported_savings_claims` already follows. Returns `text`
    byte-for-byte unchanged when no sentence actually matches, so a title/body
    that never tripped the guardrail can't pick up an incidental
    reformatting side effect."""
    if not text:
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    kept = [s for s in sentences if s.strip() and not _DATED_PROMO_RE.search(s)]
    if len(kept) == len([s for s in sentences if s.strip()]):
        return text  # nothing matched — unchanged, byte-for-byte
    return " ".join(kept).strip()


def _house_style(text: str) -> str:
    """Replace any em-dash/en-dash with a comma (prose) so the house "no
    em-dashes" rule holds even when the model doesn't follow it unprompted,
    except a dash between numeric-ish tokens (£15–£30, 4–8×), which is a
    range and becomes a plain hyphen instead of a comma. Also collapses a
    broken decimal ("4. 47%" -> "4.47%") -- see _DECIMAL_SPACE_RE above."""
    text = _DECIMAL_SPACE_RE.sub(".", text)
    text = _NUMERIC_RANGE_DASH_RE.sub("-", text)
    return _DASH_RE.sub(", ", text).strip()


_WHITESPACE_RUN_RE = re.compile(r"\s+")


def _verified_saving_sentence(merchant: Optional[str], amount: float, tier: str) -> str:
    """The loop-closed sentence for a verified saving (a trigger merchant
    with 45+ days of silence AND category-net confirmation, see
    `_check_verified_saving` / `_verified_copy_tier`).

    Two copy tiers, per the Insights honesty review (Package A #2) — a
    celebratory "You did it" is an unearned claim unless we have actual
    evidence the user looked at this card before the win fired:

    - "earned": the celebratory tier. Only reachable when
      `_verified_copy_tier` confirms `card_opened_at` predates `verified_at`
      — the user engaged with this insight's evidence/CTA before the spend
      genuinely ceased, so crediting them for the change is honest.
    - "fact": the honest default. No "You did it", no "staying in your
      pocket" (both imply agency/reward we can't actually attribute) — just
      the two facts a deterministic check can prove: the payment stopped,
      and what it was worth. This is also what every PRE-EXISTING stored
      insight regenerates to, since none of them carry a `card_opened_at`
      from before this feature existed.

    `tier` has no default — every call site must consciously choose one
    rather than silently inheriting the old always-celebratory behaviour.

    Built as whole phrase CHUNKS joined with `" ".join()`, never by splicing
    a bare `{merchant}` straight up against the next word in one f-string.
    Each chunk already carries its own boundary space, and `join()` enforces
    exactly one space between chunks — so a merchant name landing flush
    against the following word (the class of bug this guards against, e.g.
    a name rendering as "Nandoshave" with the space silently dropped) is
    structurally impossible here, not just avoided by convention. The
    trailing whitespace-collapse is a second belt-and-braces pass in case a
    future edit interpolates a value that itself carries stray whitespace.
    """
    merchant = (merchant or "").strip()
    amt = f"{amount:,.0f}"
    if tier == "earned":
        chunks = [
            "You did it,",
            f"payments to {merchant} have stopped." if merchant else "that payment has stopped.",
            f"That's ~£{amt}/mo staying in your pocket.",
        ]
    else:
        chunks = [
            f"Payments to {merchant} stopped." if merchant else "That payment stopped.",
            f"That was ~£{amt}/mo.",
        ]
    return _WHITESPACE_RUN_RE.sub(" ", " ".join(chunks)).strip()


def _verified_copy_tier(d: dict) -> str:
    """"earned" only when the user is confirmed to have opened this card's
    evidence/workflow/CTA (`card_opened_at`, stamped by
    POST /savings-insights/{id}/opened) BEFORE the spend was confirmed to
    have ceased (`verified_at`) — i.e. before the cessation window closed.
    Everything else, including an insight with no engagement recorded at
    all (every insight that existed before this feature shipped), is the
    honest "fact" default. Never guess engagement from anything other than
    this explicit, first-write-wins timestamp."""
    verified_at = d.get("verified_at")
    opened_at   = d.get("card_opened_at")
    if verified_at and opened_at and opened_at < verified_at:
        return "earned"
    return "fact"


def _substituted_line(merchant: Optional[str], category_label: Optional[str]) -> str:
    """Neutral (not celebratory) sentence for the `substituted` state
    (Package B #6): the triggering merchant genuinely went silent, but the
    insight's whole spend category didn't net down — the money most likely
    moved to a different merchant in the same category, not out of the
    budget entirely. Same whole-chunk-join discipline as
    `_verified_saving_sentence` for the same reason (no flush-merchant-name
    bug)."""
    merchant = (merchant or "").strip()
    chunks = [
        f"Payments to {merchant} stopped," if merchant else "That payment stopped,",
        (f"but {category_label} overall hasn't moved." if category_label
         else "but your overall spending here hasn't moved."),
        "Worth a look at where it went.",
    ]
    return _WHITESPACE_RUN_RE.sub(" ", " ".join(chunks)).strip()


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


# Unsupported-savings-claim guardrail (Insights honesty review, incoherence
# C — owner phone report 2026-09-01: energy's card showed "No number yet"
# directly under a title claiming "fixed deals could save up to £173", with
# savings_estimate correctly nulled by the derivability guard above. Root
# cause: `_savings_estimate_is_derivable` only ever checked the
# `savings_estimate` FIELD — a number the model embedded straight into the
# title or body prose instead of (or in addition to) `savings_estimate` was
# never checked against anything, so a rejected/fabricated figure could
# still reach the screen as a plain sentence. Facts/Voice rule: either a
# number is derivable (then it belongs in `savings_estimate`) or the prose
# must not assert it — so once `savings_estimate` is null, any clause that
# both names a specific £ figure AND claims a saving ("could save up to
# £173", "cut your bill by £40") is stripped, UNLESS that £ figure is
# actually the user's own known spend (`triggered_by`'s monthly_amount,
# e.g. "your £1,124 mortgage could drop" — £1,124 is a fact this product
# already knows and states elsewhere, not a fabricated saving). Narrower
# than re-running the full derivability check on title/body: it doesn't
# need the ephemeral Tavily `web_text` that produced generation-time
# `allowed`, so it is safe to run again at SERVE time (see
# `_serialize_insight`) against docs generated before this guardrail
# existed, without the false-positive risk of treating every legitimately-
# sourced £ figure ("Virgin Media M1 broadband from £17.99 a month" — a
# price statement, not a savings claim, no "save" word nearby) as
# unsupported. Applied at generation time too (see
# `_generate_savings_insight_content`) so new content is clean from write,
# not just cleaned on the way out.
_SAVE_CLAIM_WORD_RE = re.compile(r"\b(?:save|saves|saving|savings|cut|drop|reduce\w*)\b", re.IGNORECASE)
_MONEY_TOKEN_RE = re.compile(r"£\s*\d[\d,]*(?:\.\d+)?")

_THOUSANDS_COMMA_RE = re.compile(r"(?<=\d),(?=\d)")
_THOUSANDS_COMMA_PLACEHOLDER = "\0"


def _clause_asserts_unsupported_saving(clause: str, allowed: set[float]) -> bool:
    if not _SAVE_CLAIM_WORD_RE.search(clause):
        return False
    money_matches = _MONEY_TOKEN_RE.findall(clause)
    if not money_matches:
        return False
    nums = [float(m.lstrip("£").replace(" ", "").replace(",", "")) for m in money_matches]
    return any(not _number_is_derivable(n, allowed) for n in nums)


def _strip_unsupported_savings_claims(
    text: Optional[str], has_estimate: bool, triggered_by: Optional[list[dict]] = None,
) -> Optional[str]:
    """Remove any comma-separated clause from `text` that both claims a
    saving and names a £ figure NOT traceable to the user's own known spend
    (`triggered_by`'s `monthly_amount` figures — always legitimate to
    restate), UNLESS `has_estimate` is True (a real, guardrail-passed
    `savings_estimate` exists elsewhere on the card, so the prose's own
    figure is trusted). A clause is the unit removed, not the whole
    sentence — "You pay £160/mo, fixed deals could save up to £173" keeps
    the user's own, verifiable £160 figure and drops only the ungrounded
    "£173" clause, leaving "You pay £160/mo." Blank input, or a sentence
    with nothing left after stripping, returns "" (never re-shown as-is) —
    the caller's existing `{insight.title && ...}` / `{insight.body &&
    ...}` guards already treat an empty string as "nothing to render here",
    which is the honest outcome once every numeric claim in it turns out to
    be unsupported.

    Returns `text` completely UNCHANGED (not just semantically equivalent)
    when nothing needs stripping — this function never reformats
    punctuation it didn't have a reason to touch, so a title with no
    unsupported claim at all can't pick up an incidental side effect like a
    trailing full stop it never had.

    A thousands-separator comma inside a figure like "£1,124" is protected
    before splitting (same placeholder-then-restore technique the
    frontend's InsightBody sentence-splitter already uses for decimal
    points) — a naive `text.split(",")` would otherwise cut "£1,124
    mortgage could drop" into "£1" and "124 mortgage could drop", corrupting
    the number into "£1, 124" once rejoined even when neither half ends up
    stripped."""
    if not text or has_estimate:
        return text
    if not _SAVE_CLAIM_WORD_RE.search(text) or not _MONEY_TOKEN_RE.search(text):
        return text  # nothing that could possibly be an unsupported claim

    allowed: set[float] = set()
    for t in (triggered_by or []):
        amt = t.get("monthly_amount")
        if amt is not None:
            allowed.add(round(float(amt), 2))

    protected = _THOUSANDS_COMMA_RE.sub(_THOUSANDS_COMMA_PLACEHOLDER, text)
    sentences = re.split(r"(?<=[.!?])\s+", protected)
    any_removed = False
    out_sentences: list[str] = []
    for sent in sentences:
        # Restore the placeholder back to "," immediately after splitting —
        # the placeholder's only job was to survive the split() call intact;
        # every clause below must have its real punctuation back before it's
        # matched (a still-placeholder'd "£1\0124" would extract as the
        # money token "£1", not "£1,124", corrupting the derivability check
        # itself) or rendered.
        clauses = [c.strip().replace(_THOUSANDS_COMMA_PLACEHOLDER, ",") for c in sent.split(",")]
        non_empty = [c for c in clauses if c]
        kept = [c for c in non_empty if not _clause_asserts_unsupported_saving(c, allowed)]
        if len(kept) != len(non_empty):
            any_removed = True
        if not kept:
            continue
        rejoined = ", ".join(kept)
        if rejoined and rejoined[-1] not in ".!?":
            rejoined += "."
        out_sentences.append(rejoined)
    if not any_removed:
        # Nothing was actually stripped — return the original, byte-for-byte
        # unchanged (never pick up an incidental side effect, like a
        # trailing full stop a title never had, from a rebuild that turned
        # out to have nothing to do).
        return text
    return " ".join(out_sentences).strip()


LABEL_OPTIONS: dict[str, dict] = {
    **{k: {"icon": v["icon"], "label": v["label"]} for k, v in INSIGHT_CATEGORIES.items()},
    "home_insurance": {"icon": "🛡️", "label": "Home Insurance"},
    "life_insurance": {"icon": "❤️",  "label": "Life Insurance"},
    "council_tax":    {"icon": "🏛️",  "label": "Council Tax"},
    "water":          {"icon": "💧",  "label": "Water"},
    "tv_licence":     {"icon": "📻",  "label": "TV Licence"},
    "pension":        {"icon": "🏦",  "label": "Pension/Savings"},
}

# ── job (fixed vs free) ───────────────────────────────────────────────────
# A savings-insight `category` (an INSIGHT_CATEGORIES/LABEL_OPTIONS key, e.g.
# "mobile", "gym") isn't itself an app spend category, so it can't be looked
# up in a category-kind map directly. This maps each insight category to the
# app category it represents, so `job` can be resolved through the SAME
# category-kind single source of truth (app.services.categories) everything
# else uses, rather than a second hardcoded fixed/free judgement drifting
# apart from it. `pension` deliberately has no entry: pension/savings
# contributions are a MOVEMENT, not spend, so they have no job at all.
_INSIGHT_CATEGORY_TO_APP_CATEGORY: dict[str, str] = {
    "mobile":         "Bills",
    "broadband":      "Bills",
    "energy":         "Bills",
    "mortgage":       "Bills",
    "car_insurance":  "Bills",
    "home_insurance": "Bills",
    "life_insurance": "Bills",
    "council_tax":    "Bills",
    "water":          "Bills",
    "tv_licence":     "Bills",
    "car_finance":    "Transport",
    "gym":            "Health",
    "subscriptions":  "Subscriptions",
    "groceries":      "Groceries",
    "eating_out":     "Eating Out",
}


def _job_for_category(category_key: str, kinds: dict | None) -> str | None:
    """"fixed" (COMMITMENT), "free" (DISCRETIONARY), or None (no mapping, or
    a kind that's neither, e.g. a pension/savings MOVEMENT).

    `kinds` is the caller's own per-user kind map (from
    `get_category_kinds(uid)`, ONE DB read per request) when available. When
    it isn't (callers that haven't been threaded through yet), falls back to
    the built-in kind table, which `kind_of` accepts directly since it's a
    plain `dict[str, str]` — no DB read needed for that path, and it still
    gives the right answer for every built-in app category, just blind to a
    user's own custom-category kind overrides.
    """
    app_category = _INSIGHT_CATEGORY_TO_APP_CATEGORY.get(category_key)
    if not app_category:
        return None
    kind = kind_of(kinds if kinds is not None else BUILTIN_CATEGORY_KINDS, app_category)
    if kind == COMMITMENT:
        return "fixed"
    if kind == DISCRETIONARY:
        return "free"
    return None

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
            {"id": "speed",        "label": "Download speed",    "type": "select", "options": ["Under 50 Mbps", "50-100 Mbps", "100-500 Mbps", "500 Mbps+", "Not sure"]},
        ],
    },
    "mobile": {
        "cta": "Add your plan details",
        "steps": [
            {"id": "contract_end", "label": "Contract end date",  "type": "text",   "placeholder": "e.g. Dec 2026 or Rolling"},
            {"id": "data",         "label": "Monthly data usage", "type": "select", "options": ["Under 5 GB", "5-20 GB", "20-50 GB", "50 GB+", "Unlimited"]},
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
            {"id": "frequency", "label": "How often do you eat out?", "type": "select", "options": ["Daily", "2-3× per week", "Once a week", "Few times a month", "Rarely"]},
        ],
    },
}

# Moved up from ~line 1426 (still used there, by `_parse_deadline`) so they
# can also be used here, at import time — module order only matters for
# top-level code that runs at import time; a function body (like
# `_parse_deadline`'s) resolves the module-level name when it's CALLED, not
# when it's defined, so moving these earlier changes nothing about its
# behaviour.
_DEADLINE_KEYS = ("deal_end", "contract_end", "renewal_date")
_MONTHS_MAP = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}

# ── Category lifecycle registry — SINGLE SOURCE OF TRUTH ────────────────────
# OWNER DECISION (2026-09-01, verbatim, REVERSING the pull model on cost
# grounds): "this pattern would mean that users would do a lot of searches
# which mean tavily calls would be high, I think the app should be
# responsible for the refreshes, but it should indicate an expiry on the
# offers perhaps a ttl on the entry, these should come on a weekly basis".
# The pull model below (live, user-initiated research via the since-removed
# POST .../research tap) is retired: EVERY category is now "push" — the
# weekly cron researches it, on a predictable batch schedule, full stop.
#
# The dict (and the single-membership assertion) stay as the one explicit,
# auditable place cadence is decided, even though every value is "push"
# today — a future cadence class (e.g. a category that only needs
# fortnightly research) has one obvious place to be added without
# re-deriving cadence from some other structure's side effects again, the
# exact trap car_finance's dual CATEGORY_WORKFLOWS/pull membership fell into
# before this registry existed (see git history / STRUCTURAL FIX commentary
# in test_category_lifecycle_registry.py for that story).
#
# IMPORTANT: cadence (this dict) and "does this category have a real
# deal/contract/renewal date anchoring a claim's honesty" are two DIFFERENT
# facts that used to accidentally coincide 1:1 with push/pull and got
# conflated into one frozenset as a result. They no longer coincide (every
# category is push now, but car_finance/gym/subscriptions/groceries/
# eating_out still have no such date), so `_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY`
# below is re-derived directly from CATEGORY_WORKFLOWS/_DEADLINE_KEYS again,
# independent of this dict — see its own comment.
CATEGORY_LIFECYCLE: dict[str, str] = {
    "energy":        "push",
    "mortgage":      "push",
    "broadband":     "push",
    "mobile":        "push",
    "car_insurance": "push",
    "car_finance":   "push",
    "gym":           "push",
    "subscriptions": "push",
    "groceries":     "push",
    "eating_out":    "push",
}
assert set(CATEGORY_LIFECYCLE) == set(INSIGHT_CATEGORIES) and set(CATEGORY_LIFECYCLE.values()) <= {"push", "pull"}, (
    "CATEGORY_LIFECYCLE must classify every INSIGHT_CATEGORIES key as exactly "
    "one of push|pull — see test_category_lifecycle_registry.py"
)

# Categories with no CATEGORY_WORKFLOWS field that anchors a real deal/
# contract/renewal date (a step whose id is one of _DEADLINE_KEYS, feeding
# `_parse_deadline`) — car_finance, gym, subscriptions, groceries, eating_out.
# Used ONLY by the dated-promo guardrail in `_generate_savings_insight_content`
# (a specific, time-bound promo claim needs its own `claim_valid_until`
# precisely because nothing else here is keeping it honest over time) — NOT a
# cadence signal any more (see CATEGORY_LIFECYCLE above; every category is
# push/weekly regardless of membership here). Computed directly from
# CATEGORY_WORKFLOWS, not from CATEGORY_LIFECYCLE, now that the two facts can
# diverge.
_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY: frozenset[str] = frozenset(
    cat for cat, wf in CATEGORY_WORKFLOWS.items()
    if not any(step.get("id") in _DEADLINE_KEYS for step in wf.get("steps", []))
)

# Content TTL (owner decision above): EVERY researched entry — push or, as of
# this reversal, the former pull categories too — carries a displayed expiry.
# `content_valid_until` (stamped alongside title/body/savings_estimate at
# every write site: `_refresh_single_insight`, `_refresh_savings_insights_for_user`)
# is `min(claim_valid_until, researched_at + DEFAULT_RESEARCH_TTL)` when the
# model supplied a real claim_valid_until (a dated offer with a genuine
# deadline sooner than the default), else just `researched_at +
# DEFAULT_RESEARCH_TTL`. Seven days, not the old 48h RESEARCH_TTL — aligned
# to the weekly cadence above so content normally refreshes before it
# expires; a slow/failed cron pass is the only way a card is ever seen
# expired by a real user.
DEFAULT_RESEARCH_TTL_DAYS = 7
DEFAULT_RESEARCH_TTL = timedelta(days=DEFAULT_RESEARCH_TTL_DAYS)


def _compute_content_valid_until(
    researched_at: datetime, claim_valid_until: Optional[datetime],
) -> datetime:
    """TTL derivation (owner decision 2026-09-01): the claim's own deadline
    wins when it's SOONER than the default weekly TTL (a real, dated offer
    that expires in 3 days must not be shown as good for a full week); the
    default TTL wins otherwise, including whenever no claim_valid_until was
    supplied at all. Plain `min()` gives exactly this: a claim_valid_until
    later than the default is simply never the minimum, so the default
    silently governs — no separate branch needed."""
    default_expiry = researched_at + DEFAULT_RESEARCH_TTL
    if claim_valid_until:
        return min(claim_valid_until, default_expiry)
    return default_expiry

# `is_new` time-box (owner phone report 2026-09-01, the is_new override bug):
# every write path that sets `is_new: True` does so alongside real content
# (see `_refresh_single_insight` / the push-category insert branch — no path
# writes `is_new: True` on its own), and most paths that later touch the doc
# explicitly reset it to False (the weekly cron's "no material change"
# branch, verified/substituted resolution). But a doc that falls out of
# every one of those paths — e.g. pinned so `_regen_reason` never fires
# again, or a category later dropped from `_detect_insight_categories` for
# this user — would otherwise carry a stuck `is_new: True` forever with
# nothing left to clear it: the latent bug flagged alongside the override
# fix. Rather than rely on every future write path remembering to clear it,
# `_serialize_insight` gates the SERVED value on this TTL from the doc's own
# `refreshed_at` (the timestamp stamped in the same write as `is_new: True`)
# — self-healing on every read, the same belt-and-braces pattern already
# used for `content_live` above, not a stored value that can drift out of
# sync with reality.
IS_NEW_TTL = timedelta(days=7)

# RESEARCH_THROTTLE (the 10-minute double-tap guard for the live,
# user-initiated POST /savings-insights/{id}/research pull) retired alongside
# that endpoint — see the owner decision above CATEGORY_LIFECYCLE. Cost
# control now lives entirely in the weekly cron (per-user category cap +
# WARNING summary log, see `_refresh_savings_insights_for_user`), not a
# per-request throttle, since there is no longer a user-facing tap to throttle.

BILL_CATEGORIES = {"bills", "housing", "utilities", "insurance"}


def _uid_hash(user_id: str) -> str:
    """Short, non-reversible stand-in for a user in a log line. Reuses the
    exact md5-hexdigest[:8] convention this module already uses to derive a
    stable `insight_id` from a user_id (see `_refresh_single_insight` /
    `_refresh_savings_insights_for_user`), so a WARNING log line can name
    "which user" for correlation/debugging without ever printing their email
    into journalctl."""
    return hashlib.md5(user_id.encode()).hexdigest()[:8]


# Trigger matching: word-boundary phrase matching, not substring containment.
# Plain `trigger in text` (the old approach) lets a short trigger match
# inside an unrelated longer word — the live bug this was built to fix was
# the mobile trigger "ee " matching inside "Cko*Sunday*Mowgli Stree Birmin"
# (a restaurant, via the "e-e-space" inside "Stree ") and inside "Barclays
# Avios Fee " (a card fee, via the "e-e-space" inside "Fee "). Both were
# being stored as `triggered_by` evidence for a mobile-spend insight.
#
# Boundary definition: a trigger phrase must not be immediately preceded or
# followed by an alphanumeric character. This is NOT Python's `\b` — `\b`
# is defined relative to `\w` (word chars), and several triggers end or
# start on a character that already sits outside `\w` in a way that makes
# bare `\b` behave unexpectedly next to it:
#   - "disney+", "paramount+": `\b` does not fire between a word character
#     and "+" the way it does between two word characters, so a naive
#     `\btrigger\b` can fail to anchor cleanly at the "+". Anchoring on
#     "the next character is not alphanumeric" instead sidesteps that
#     entirely, and "+" being itself non-alphanumeric already guarantees
#     the boundary is meaningful without relying on `\b` at all.
#   - "co-op": the trigger contains an internal "-"; `\b` would insert an
#     (unwanted, harmless here since we don't rely on it) boundary either
#     side of the hyphen. Our custom lookaround only inspects the
#     characters immediately OUTSIDE the trigger, so the internal hyphen
#     is untouched and matched literally.
#   - "m&s food", "lv=", "o2": internal/trailing "&", "=" and digit-letter
#     runs are matched literally (via `re.escape`); only the characters
#     just outside the phrase are boundary-checked.
# Every trigger that previously carried a hand-rolled trailing space
# ("ee ", "o2 ", "three ", "leon ", "eon ", "sse ", "bt ", "lv= ") has had
# that space removed from INSIGHT_CATEGORIES above — with a real boundary
# in place, the trailing space is redundant (the boundary already stops a
# mid-word match) AND was actively harmful, because it also stopped the
# trigger from matching a merchant name ending exactly in that word (e.g.
# a bank descriptor that is bare "EE" with nothing after it would never
# have matched "ee " even though it should).
_TRIGGER_BOUNDARY_LEFT  = r"(?<![A-Za-z0-9])"
# The strict right boundary: nothing alphanumeric may follow the trigger.
_TRIGGER_BOUNDARY_RIGHT_STRICT = r"(?![A-Za-z0-9])"
# The stem right boundary additionally absorbs exactly one bare trailing "s"
# — used ONLY for the small, explicit set of triggers in _STEM_TRIGGERS
# below, never applied globally (see that set for why). A bare
# `(?![A-Za-z0-9])` alone matches the apostrophe form of a possessive brand
# fine (the apostrophe itself is already non-alphanumeric) but rejects a
# bank's bare-plural spelling of the same brand, since the "s" immediately
# following the stem is alphanumeric — confirmed live: "NANDOS.CO.UK" and
# "MCDONALDS 1435 ON 29 MAY CLP" stopped matching their category under a
# plain right boundary. This does NOT reopen the original left-boundary bug
# (the "ee" in "Stree"/"Fee" problem) — that was a LEFT-boundary failure
# (the trigger starting mid-word), and the left boundary here is unchanged
# and still requires a non-alphanumeric character immediately before the
# trigger.
_TRIGGER_BOUNDARY_RIGHT_STEM = r"(?:s(?![A-Za-z0-9])|(?![A-Za-z0-9]))"

# Triggers that deliberately omit their trailing "s" so the same stem
# matches both a possessive and a bare-plural bank spelling of one brand.
# Kept to an explicit, justified allow-list rather than applied to every
# trigger — the trailing-"s" absorption was briefly global and that was a
# real regression: it let "bt" (broadband) match "BTS MERCH STORE" and
# "leon" (eating_out) match "LEONS GARAGE", neither of which has anything to
# do with the intended merchant. Every trigger below is a brand whose
# OFFICIAL registered name carries a possessive apostrophe, so a bank
# descriptor that drops punctuation ("NANDOS", "MCDONALDS", "SAINSBURYS")
# is a spelling variant of the SAME merchant, not a different one:
#   "nando"     -> Nando's        (confirmed live: "NANDOS.CO.UK")
#   "mcdonald"  -> McDonald's     (confirmed live: "MCDONALDS 1435 ON 29 MAY CLP")
#   "sainsbury" -> Sainsbury's    (same shape — UK bank descriptors routinely
#                                  render this as bare "SAINSBURYS ..." with
#                                  no apostrophe)
# Every other trigger in INSIGHT_CATEGORIES — including other short ones
# with plausible-looking plurals ("eon"->"eons", "admiral"->"admirals",
# "co-op"->"co-ops", "churchill"->"churchills", "subway"->"subways") — gets
# the strict boundary, because in none of those cases is "trigger+s" the
# same brand under a different spelling; it is either an unrelated English
# word or an unrelated business, so absorbing the "s" would only reopen the
# bt/leon class of bug.
_STEM_TRIGGERS: frozenset[str] = frozenset({"nando", "mcdonald", "sainsbury"})


def _compile_trigger_patterns(categories: dict[str, dict]) -> dict[str, list[re.Pattern]]:
    compiled: dict[str, list[re.Pattern]] = {}
    for cat_key, cfg in categories.items():
        pats = []
        for trig in cfg.get("triggers", []):
            phrase = trig.strip()
            if not phrase:
                continue
            right = (
                _TRIGGER_BOUNDARY_RIGHT_STEM
                if phrase.lower() in _STEM_TRIGGERS
                else _TRIGGER_BOUNDARY_RIGHT_STRICT
            )
            pats.append(re.compile(
                _TRIGGER_BOUNDARY_LEFT + re.escape(phrase) + right,
                re.IGNORECASE,
            ))
        compiled[cat_key] = pats
    return compiled


# Precompiled once at import time, not per-transaction — _find_triggered_transactions
# runs this over every transaction in a 90-day window across four collections.
_TRIGGER_PATTERNS: dict[str, list[re.Pattern]] = _compile_trigger_patterns(INSIGHT_CATEGORIES)
_ALL_TRIGGER_PATTERNS: list[re.Pattern] = [p for pats in _TRIGGER_PATTERNS.values() for p in pats]


def _text_matches_triggers(text: str, patterns: list[re.Pattern]) -> bool:
    return any(p.search(text) for p in patterns)


# Merchant-key normalisation for insight grouping: bank descriptors for one
# merchant routinely rotate a trailing token (a card-processor reference
# code, a phone number, a branch/location word) while the brand prefix stays
# fixed. Left ungrouped, `_find_triggered_transactions` below treats each
# variant as a different merchant, which both fragments the monthly-spend
# maths (a single £12.99/mo charge split across 3 descriptor variants reads
# as three £4.33/mo charges) and can read to a downstream LLM as "you're
# paying for this three times" — a false duplicate-payment claim.
#
# Real corpus examples (kevin.maingi12@gmail.com, one £12.99/mo Netflix
# subscription, six months, three rotating descriptors):
#   "NETFLIX.COM 18665797172"   -> "netflix.com"   (trailing phone-number run)
#   "NETFLIX.COM 203832 LND"    -> "netflix.com"   (refcode + location word)
#   "NETFLIX.COM LONDON"        -> "netflix.com"   (bare location word)
# Also seen in the same corpus, a legitimate Amazon Prime subscription whose
# card-processor reference code changes every charge:
#   "Amazon Prime*OO3WG21W5"              -> "amazon prime"
#   "AMAZON PRIME*NL8WS29I4 AMZN.CO.UK/PM" -> "amazon prime"
#
# Conservative by design: every rule only strips a trailing token, never
# touches the leading brand token(s), and only commits the strip if a
# non-trivial prefix (>=3 chars) remains. Grouping itself is still an exact
# string match on the *normalised* key, so merchants that only share a brand
# word but differ earlier in the string stay distinct — "SAINSBURYS S/MKT
# 1234" and "SAINSBURYS PETROL 5678" normalise to "sainsburys s/mkt" and
# "sainsburys petrol" respectively, not to a shared "sainsburys" bucket.
_MERCHANT_REFCODE_STAR_RE = re.compile(r"\*\S*\d\S*.*$")           # "*OO3WG21W5 AMZN.CO.UK/PM"
_MERCHANT_TRAILING_PHONE_RE = re.compile(r"\s+\(?\d[\d ]{5,}\d\)?$")  # " 18665797172"
_MERCHANT_TRAILING_LOCATION_RE = re.compile(r"\s+(?:LND|LDN|LONDON)$", re.IGNORECASE)  # " LND" / " LONDON"
_MERCHANT_TRAILING_REFCODE_RE = re.compile(r"\s+\d{3,}$")          # " 203832"
# Bank date-stamp noise on card-present transactions, e.g.
# "MCDONALDS 1435 ON 29 MAY CLP" / "COSTA COFFEE 43010 ON 16 JUL CPM" / (no
# leading terminal number in this variant) "LYCAMOBILE ON 08 AUG BCC" — an
# optional terminal/reference number, the literal word "ON", a day-of-month,
# a 3-letter month name, then a short processor code. Specific enough (needs
# the literal " ON " plus a real month name) that it won't misfire on
# ordinary brand text.
_MERCHANT_TRAILING_DATESTAMP_RE = re.compile(
    r"\s+(?:\d+\s+)?ON\s+\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+[A-Z]{2,4}$",
    re.IGNORECASE,
)
# Domain-suffix noise on online merchants written as a bare domain, e.g.
# "NANDOS.CO.UK" — dot-attached, not space-separated, so it needs its own
# pattern rather than folding into the space-anchored rules above.
#
# Deliberately UK-specific (".co.uk" / ".org.uk"), NOT the bare ".com" /
# ".net" a naive version of this rule would also strip — this codebase
# already has a merchant, "Netflix.com", where ".com" is genuinely part of
# the display brand rather than noise (see the module comment above and
# test_verified_saving.py's `test_rotating_descriptor_still_matches_on_both_sides`,
# which asserts `_normalize_merchant_key("NETFLIX.COM ...") == "netflix.com"`
# with the ".com" intact). Stripping ".com" here would silently break that
# existing, deliberate behaviour to fix an unrelated case, so ".com"/".net"
# are left untouched; only the UK-only suffixes are treated as noise.
_MERCHANT_TRAILING_DOMAIN_RE = re.compile(r"\.(?:co\.uk|org\.uk)$", re.IGNORECASE)
_MERCHANT_MIN_PREFIX_LEN = 3

# Straight (') and curly (’) apostrophes are punctuation noise, not a
# brand-distinguishing feature — "Nando's" / "Nando’s" / "Nandos" are the
# same merchant under three different bank-descriptor spellings. Stripped
# globally (not just trailing), since the apostrophe usually sits mid-string
# (before a possessive "s").
_MERCHANT_APOSTROPHE_RE = re.compile(r"['’]")

# UK company-suffix noise: "Ee Ltd" and "Ee Limited" are the same merchant
# under two different legal-suffix spellings the bank happens to have on
# file, but plain equality treated them as different keys, which both
# fragmented monthly_amount (a single ~£57/mo EE bill split into two ~£28
# lines) and produced two disagreeing on-screen figures — the card's bold
# lead line reads triggered_by[0] alone ("~£36/mo at Ee Ltd") while the
# generated title sums every trigger line the LLM was shown ("You pay EE
# £57/mo"). Deliberately narrow to the trailing token only (never mid-string)
# so "Co-op" keeps its "co" (the string ends in "-op", not in whitespace+"co",
# so the pattern below can never match it) and "Limitless Gym" is untouched
# (it doesn't end in "limited" at all — this only strips a suffix that is
# actually the last token).
#
# Given its own minimum-prefix guard, shorter than the generic
# _MERCHANT_MIN_PREFIX_LEN: "Ltd"/"Limited"/"PLC"/"LLP"/"& Co"/"Co" are
# unambiguous, deliberate legal-suffix words (unlike a bare digit run or
# phone number, which could coincidentally be noise OR a genuine short
# code), so even a very short remaining brand is trustworthy. "EE" is only
# two characters but is exactly the real, common bank descriptor for the
# mobile network once "Ltd"/"Limited" is stripped — rejecting it under the
# standard 3-char floor would leave "Ee Ltd" and "Ee Limited" as two
# separate keys forever, defeating the point of this fix.
_MERCHANT_COMPANY_SUFFIX_RE = re.compile(r"\s+(?:ltd|limited|plc|llp|&\s*co|co)\.?$", re.IGNORECASE)
_MERCHANT_COMPANY_SUFFIX_MIN_PREFIX_LEN = 2

# Trailing bare "UK" as a country-qualifier token ("Vodafone UK" ->
# "Vodafone"). Riskier than the legal suffixes above — "uk" is a common,
# generic two-letter fragment rather than an unambiguous legal-suffix word —
# so this keeps the STANDARD (3-char) minimum-prefix guard rather than the
# relaxed one above, and only strips a SPACE-separated trailing token, never
# the ".co.uk"/".uk" domain suffix (handled separately by
# _MERCHANT_TRAILING_DOMAIN_RE, which only fires on a dot-attached domain,
# not a bare word).
_MERCHANT_UK_SUFFIX_RE = re.compile(r"\s+uk$", re.IGNORECASE)


def _normalize_merchant_key(key: str) -> str:
    """Collapse rotating-descriptor variants of one merchant into a single
    grouping key. See the module comment above for the corpus this was built
    from and the exact examples it targets."""
    raw = (key or "").strip()
    if not raw:
        return raw
    normalized = raw

    # Apostrophes first (see _MERCHANT_APOSTROPHE_RE) — order-independent
    # relative to everything below, since it's a global substitution, not an
    # anchored trailing strip.
    normalized = _MERCHANT_APOSTROPHE_RE.sub("", normalized)

    # Card-processor reference codes are introduced with "*" and always carry
    # a digit (e.g. "*OO3WG21W5"); everything from "*" to the end — including
    # any trailing "AMZN.CO.UK/PM"-style suffix — is noise, not brand.
    m = _MERCHANT_REFCODE_STAR_RE.search(normalized)
    if m and m.start() >= _MERCHANT_MIN_PREFIX_LEN:
        normalized = normalized[:m.start()].strip()

    # Some descriptors stack more than one trailing token (a reference code
    # AND a location word, e.g. "NETFLIX.COM 203832 LND") — strip repeatedly
    # until nothing more matches.
    changed = True
    while changed:
        changed = False
        for pat in (
            _MERCHANT_TRAILING_PHONE_RE,
            _MERCHANT_TRAILING_LOCATION_RE,
            _MERCHANT_TRAILING_REFCODE_RE,
            _MERCHANT_TRAILING_DATESTAMP_RE,
            _MERCHANT_TRAILING_DOMAIN_RE,
        ):
            mm = pat.search(normalized)
            if mm:
                candidate = normalized[:mm.start()].rstrip()
                if len(candidate) >= _MERCHANT_MIN_PREFIX_LEN:
                    normalized = candidate
                    changed = True

    # UK company-suffix noise (Ltd/Limited/PLC/LLP/& Co/Co) — its own,
    # relaxed minimum-prefix guard; see _MERCHANT_COMPANY_SUFFIX_RE above.
    changed = True
    while changed:
        changed = False
        mm = _MERCHANT_COMPANY_SUFFIX_RE.search(normalized)
        if mm:
            candidate = normalized[:mm.start()].rstrip()
            if len(candidate) >= _MERCHANT_COMPANY_SUFFIX_MIN_PREFIX_LEN:
                normalized = candidate
                changed = True

    # Trailing bare "UK" token — standard minimum-prefix guard; see
    # _MERCHANT_UK_SUFFIX_RE above.
    mm = _MERCHANT_UK_SUFFIX_RE.search(normalized)
    if mm:
        candidate = normalized[:mm.start()].rstrip()
        if len(candidate) >= _MERCHANT_MIN_PREFIX_LEN:
            normalized = candidate

    return normalized.lower()


# Minimum length (post-normalisation) a key must have before a PREFIX match
# is trusted instead of falling back to exact equality. Guards against a
# short or generic key over-matching an unrelated merchant it merely happens
# to be a prefix of — e.g. the mobile carrier "EE" (2 chars) must not
# prefix-match "EE VILLAGE CAFE" or "EESOME UNRELATED LTD"; 6 chars is enough
# to cover real short-but-specific brand keys ("boots.", "amazon") while
# still rejecting 2-4 char fragments that are common substrings of unrelated
# names.
_MERCHANT_KEY_MIN_PREFIX_MATCH_LEN = 6


def _merchant_keys_match(stored_key_norm: str, txn_key_norm: str, txn_key_truncated: bool) -> bool:
    """Equivalence check between a stored insight's merchant key and one
    derived from a transaction, both ALREADY-NORMALISED (i.e. already passed
    through `_normalize_merchant_key`).

    Exact equality is always accepted. A prefix relationship is accepted
    ONLY when `txn_key_truncated` is True — i.e. only when the caller has
    confirmed the transaction-side key was actually built from the
    `description[:30]` fallback (no `merchant_name`, and the full
    description was longer than the 30-char slice), so the key really is a
    cut-off string rather than a clean, complete merchant name. In that case
    normalisation and truncation only ever remove characters from the end,
    never the start, so the two keys for the SAME merchant still share a
    common leading prefix.

    This is deliberately narrow. Two DIFFERENT products from the same brand
    ("Vodafone" mobile vs. "Vodafone Broadband", "Amazon" vs. "Amazon
    Prime", "Sky Sports" vs. "Sky Sports Cinema", "giffgaff" vs. "giffgaff
    plus") are legitimate prefixes of each other yet are genuinely different
    recurring charges — when the transaction carries a clean `merchant_name`
    there was no truncation, so those must NOT match, only exact equality
    does. Prefix leniency is reserved for the truncation artifact it exists
    to paper over, not extended to every pair of keys that happen to share a
    prefix.

    Even when truncation is confirmed, the shorter of the two keys must
    still be at least `_MERCHANT_KEY_MIN_PREFIX_MATCH_LEN` chars long — a
    very short key must never be trusted as a prefix, truncated or not.
    """
    if stored_key_norm == txn_key_norm:
        return True
    if not txn_key_truncated:
        return False  # no truncation in play — exact match only
    if not stored_key_norm or not txn_key_norm:
        return False
    shorter, longer = (
        (stored_key_norm, txn_key_norm)
        if len(stored_key_norm) <= len(txn_key_norm)
        else (txn_key_norm, stored_key_norm)
    )
    if len(shorter) < _MERCHANT_KEY_MIN_PREFIX_MATCH_LEN:
        return False  # too short to trust as a prefix — exact match only
    return longer.startswith(shorter)


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

    detected = [k for k in INSIGHT_CATEGORIES if _text_matches_triggers(all_text, _TRIGGER_PATTERNS[k])]

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

    # Bucketed on the *normalised* merchant key so descriptor-rotation
    # variants of one merchant (see _normalize_merchant_key) merge into a
    # single trigger instead of fragmenting into several — that fragmentation
    # is what previously produced both an undercounted monthly_amount (one
    # £12.99/mo charge split 3 ways reads as £4.33/mo each) and a false
    # "you're paying N times" narrative downstream. Raw per-transaction keys
    # and dates are kept alongside so a display name and a same-month
    # duplicate-cadence flag can be derived per bucket below.
    buckets: dict[str, list[tuple[float, Optional[datetime], str]]] = defaultdict(list)
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col, mono_transactions_col]:
        try:
            txns = await col.find(
                {"user_id": user_id, "date": {"$gte": cutoff}, "transaction_type": "debit"},
                {"merchant_name": 1, "description": 1, "amount": 1, "date": 1},
            ).to_list(None)
        except Exception:
            continue
        for t in txns:
            key       = (t.get("merchant_name") or t.get("description", "")[:30]).strip()
            if not key:
                continue
            key_lower = key.lower()
            if (labelled_key and key == labelled_key) or _text_matches_triggers(key_lower, _TRIGGER_PATTERNS[category_key]):
                norm_key = _normalize_merchant_key(key)
                buckets[norm_key].append((float(t.get("amount", 0)), t.get("date"), key))

    # Recurring engine's own per-series monthly figure (`avg_amount` in
    # `cashflow_cache_col.recurring_spend`) — the SAME number the insight's
    # LLM-written title/body already trusts as fact (see the `facts_block`
    # prompt below, which quotes this list's `monthly_amount` straight into
    # the "user's own spending" fact the copy has to agree with). Preferring
    # it here, instead of a plain window average, is the fix for a live bug:
    # this window is a fixed 90 days, so a plain `sum(amounts) / 3` silently
    # undershoots whenever the window clips an occurrence of a genuinely
    # monthly series — 2-of-3 monthly charges caught in the window reads as
    # exactly 2/3 of the true monthly amount (confirmed live: a £1,124.44/mo
    # mortgage showed as £749.63/mo in this footer, 1124.44 * 2/3 =
    # £749.63 to the penny), which then contradicted the body copy quoting
    # the correct figure from an earlier generation. Only trusted when the
    # matched series' own detected interval is genuinely monthly (26-35
    # days) — `avg_amount` for a weekly/biweekly series is a PER-CHARGE
    # amount, not a monthly one, and converting it would mean inventing a
    # cadence multiplier this function has no business guessing at. Matched
    # by normalised merchant key (same normaliser used for the bucket keys
    # above), so descriptor-rotation variants line up on both sides.
    #
    # SUMMED per key, not overwritten: the recurring engine's own `series_key`
    # has no legal-suffix normalisation, so "EE LTD" and "EE LIMITED" survive
    # there as two distinct series (confirmed live: Kevin's account carries
    # both, ~£35.99/mo and ~£20.65/mo on different billing days) even though
    # `_normalize_merchant_key` merges them into one "ee" evidence bucket
    # above. Picking just one engine amount for that merged bucket would
    # silently drop the other bill (~£36 instead of the correct ~£57 the
    # title already quotes); summing every matching series reconstructs the
    # true combined monthly figure the merged bucket represents.
    cached_doc      = await cashflow_cache_col.find_one({"_id": user_id}) or {}
    recurring_by_key: dict[str, float] = defaultdict(float)
    for p in (cached_doc.get("recurring_spend") or []):
        interval = p.get("avg_interval")
        amt      = p.get("avg_amount")
        if amt is None or interval is None or not (26 <= interval <= 35):
            continue
        pk = _normalize_merchant_key(str(p.get("key") or ""))
        if pk:
            recurring_by_key[pk] += float(amt)

    result = []
    for norm_key, entries in sorted(buckets.items(), key=lambda x: -sum(e[0] for e in x[1])):
        amounts = [e[0] for e in entries]
        # Display name is derived from the NORMALISED key, not one raw
        # descriptor variant — "Netflix.Com" (not "Netflix.Com
        # 18665797172") so that _merchant_scoped_route's substring match
        # against /transactions still finds every rotating-descriptor
        # variant of the merchant, not just the one that happened to win a
        # tie-break.
        display_name = norm_key.title()

        # Duplicate-cadence test (belt-and-braces alongside the normaliser —
        # see _duplicate_claim_is_supported): true only if two charges of
        # similar amount land close enough together in time that they can't
        # both be one merchant's normal monthly cycle. Deliberately a
        # day-gap test, NOT a calendar-month bucket: a monthly subscription
        # billed near a month boundary can land on, say, 1 Jul and 31 Jul —
        # 30 days apart, textbook monthly, but the SAME calendar month — so
        # bucketing by (year, month) would misfire on ordinary billing-date
        # drift. A real duplicate (two live subscriptions to the same
        # service) shows charges close together in days, not just in the
        # same named month; monthly cycles are never shorter than ~28 days,
        # so a 20-day threshold gives comfortable margin against drift while
        # still catching genuine overlap.
        dated = sorted((dt, amt) for amt, dt, _raw in entries if dt is not None)
        overlapping_charge = any(
            (d2 - d1).days <= 20 and abs(a2 - a1) <= 0.1 * max(a1, a2) + 0.5
            for (d1, a1), (d2, a2) in zip(dated, dated[1:])
        )

        engine_amount = recurring_by_key.get(norm_key)
        is_recurring  = engine_amount is not None
        # Ad-hoc merchants (no matching monthly series — genuine one-off/
        # variable spend like eating out) keep the honest window average:
        # sum of what actually landed in the 90-day window, over the 3
        # months that window covers. That average is legitimate on its own
        # terms; it just must never be presented as if it were a known
        # monthly bill, which is why the frontend hedges it with "~" while a
        # recurring-matched figure (an exact, engine-known amount) is not.
        monthly_amount = round(engine_amount, 2) if is_recurring else round(sum(amounts) / 3, 2)

        result.append({
            "merchant_key": norm_key, "display_name": display_name,
            "monthly_amount": monthly_amount, "occurrences": len(amounts),
            "overlapping_charge": overlapping_charge,
            "is_recurring": is_recurring,
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

    # Observability (owner phone report 2026-08-28: a live "Find me
    # alternatives" tap failed with the generic "Couldn't check just now",
    # and uvicorn runs `--log-level warning` in prod, so this whole block's
    # original bare `except Exception: pass` left NOTHING in journalctl to
    # diagnose it with — Tavily itself tested healthy afterwards, so the
    # cause (deploy-restart window vs throttle vs something else) could
    # never be confirmed. Every branch below that can lead to a failed
    # research pass now logs its own specific cause at WARNING, which is the
    # level actually visible under that prod flag.
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
                else:
                    log.warning(
                        "savings_insights research: tavily HTTP %s for category=%s",
                        r.status_code, category_key,
                    )
            except httpx.TimeoutException:
                log.warning(
                    "savings_insights research: tavily timeout for category=%s", category_key,
                )
            except Exception as e:
                log.warning(
                    "savings_insights research: tavily request error for category=%s: %r",
                    category_key, e,
                )
    else:
        log.warning(
            "savings_insights research: TAVILY_API_KEY not configured, skipping search for category=%s",
            category_key,
        )

    if not web_snippets:
        log.warning(
            "savings_insights research: no usable web snippets for category=%s, aborting",
            category_key,
        )
        return None
    if not OPENROUTER_API_KEY:
        log.warning(
            "savings_insights research: OPENROUTER_API_KEY not configured, aborting for category=%s",
            category_key,
        )
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
        "6. savings_estimate is always on a MONTHLY basis ('~£15/mo' style) — never annualise it to "
        "'/yr', even if a source figure is yearly (convert it down to monthly first). A monthly figure "
        "reads as a smaller, more honest number than its yearly multiple; the app shows the yearly "
        "total elsewhere if the user wants it.\n"
        "7. Write in plain, human punctuation: no em-dashes (—) or en-dashes (–) anywhere in title or "
        "body. Use a comma, a full stop, a colon, or a plain conjunction ('and', 'but', 'so') instead. "
        "A plain hyphen (-) is fine only inside a compound word (e.g. 'zero-percent') or a number range "
        "(e.g. '15-30').\n"
        "8. If your body mentions a SPECIFIC, time-bound offer, discount, deal, promotion or sale (e.g. "
        "'this January's switching offer', 'a Black Friday deal'), you MUST also set claim_valid_until "
        "to either the date or month that offer is valid until (e.g. '2027-03-31' or 'March 2027'), or "
        "the literal string 'no_expiry_known' if the sources never state one. If nothing in your answer "
        "is a limited-time promotion, set claim_valid_until to null. Never invent a date that isn't in "
        "the sources above.\n"
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
            '"You pay EE £46/mo, SIM-only could cut that to ~£12". '
            "Their spending figures are facts; any saving is an estimate, hedge it with '~' or 'could'.\n"
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
            "savings_estimate (per rules 5–6 above: a stated figure or a subtraction of two stated "
            "figures, always /mo, else null — null is expected and fine), "
            "claim_valid_until (per rule 8 above, else null)\n\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"...",'
            '"claim_valid_until":"..."}'
        )
    else:
        prompt = (
            f"{uk_rules}{hard_rules}Based on these UK search results about {cfg['label']} savings:\n\n{web_text}\n\n"
            f"{facts_block}"
            "Write a concise savings insight card in JSON with three fields:\n"
            "- title: max 10 words, punchy, present tense\n"
            "- body: 1–2 sentences, specific deal or tip, no filler\n"
            "- savings_estimate: per rules 5–6 above — e.g. '~£15/mo' ONLY if that figure or its two "
            "source numbers are stated above, else null (null is expected and fine)\n"
            "- claim_valid_until: per rule 8 above, else null\n"
            f"{verdict_rule}\n"
            'Respond ONLY with valid JSON: {"title":"...","body":"...","savings_estimate":"...",'
            '"claim_valid_until":"..."}'
        )

    # Two attempts: if the model names a non-UK product (Hulu, Venmo, 401(k)…),
    # suggests moving/transferring/consolidating credit card debt, or claims
    # a duplicate/repeat payment the transaction data doesn't back up, we
    # regenerate once with a sharper instruction, then drop the insight —
    # never store garbage, never store regulated-sounding debt advice, and
    # never store a false "you're paying twice" accusation.
    violation: Optional[str] = None
    # Last successfully-parsed attempt's title/body, kept regardless of
    # whether it went on to trip a guardrail — the dated-promo STRIP FALLBACK
    # below needs the actual offending text to strip sentences out of, not
    # just the fact that attempt 2 also failed. Only ever read after the loop
    # exits without an early `return`, i.e. every attempt tripped a guardrail.
    last_content: Optional[dict] = None
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
        elif violation == "duplicate_claim":
            attempt_prompt = (
                prompt
                + "\n\nIMPORTANT: your previous answer claimed the user is being charged twice, "
                  "multiple times, or N separate times for the same thing. Their transaction data "
                  "does not show genuinely overlapping charges (similar-amount payments landing in "
                  "the same month) — the merchant lines above may just be one subscription or bill "
                  "billed once a month under slightly different bank descriptor text each time. Do "
                  "not claim duplicate, repeat or multiple billing; describe it as a single "
                  "recurring payment instead."
            )
        elif violation == "dated_promo_missing_expiry":
            attempt_prompt = (
                prompt
                + "\n\nIMPORTANT: your previous answer mentioned a specific time-bound offer, "
                  "discount, deal or promotion but did not give a usable claim_valid_until. Either "
                  "state the exact date or month the offer is valid until in claim_valid_until, or "
                  "set claim_valid_until to the literal string 'no_expiry_known', or remove the "
                  "specific time-bound claim from the body entirely and describe the saving in "
                  "general, evergreen terms instead."
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
                    try:
                        parsed = json.loads(raw)
                    except (json.JSONDecodeError, ValueError) as e:
                        log.warning(
                            "savings_insights research: LLM response not valid JSON for "
                            "category=%s attempt=%d: %r", category_key, attempt, e,
                        )
                else:
                    log.warning(
                        "savings_insights research: LLM HTTP %s for category=%s attempt=%d",
                        r.status_code, category_key, attempt,
                    )
            except httpx.TimeoutException:
                log.warning(
                    "savings_insights research: LLM timeout for category=%s attempt=%d",
                    category_key, attempt,
                )
            except Exception as e:
                log.warning(
                    "savings_insights research: LLM request error for category=%s attempt=%d: %r",
                    category_key, attempt, e,
                )
        if not isinstance(parsed, dict):
            continue
        title    = _house_style(str(parsed.get("title", cfg["label"])))
        body     = _house_style(str(parsed.get("body", "")))
        estimate = str(parsed.get("savings_estimate") or "")
        combined = f"{title} {body} {estimate}"
        last_content = {"title": title, "body": body, "parsed": parsed}
        if _NON_UK_RE.search(combined):
            violation = "non_uk"
            continue
        if _CARD_DEBT_MOVE_RE.search(combined):
            violation = "card_debt"
            continue
        if not _duplicate_claim_is_supported(combined, triggered_by):
            violation = "duplicate_claim"
            continue

        claim_valid_until_dt: Optional[datetime] = None
        if category_key in _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY and _DATED_PROMO_RE.search(combined):
            raw_claim = parsed.get("claim_valid_until")
            raw_claim_str = str(raw_claim).strip() if raw_claim not in (None, "") else ""
            if not raw_claim_str:
                violation = "dated_promo_missing_expiry"
                continue
            if raw_claim_str.lower() != "no_expiry_known":
                claim_valid_until_dt = _parse_claim_valid_until(raw_claim_str)
                if claim_valid_until_dt is None:
                    violation = "dated_promo_missing_expiry"
                    continue

        savings_estimate = parsed.get("savings_estimate") or None
        if savings_estimate is not None:
            # House-style (incl. the decimal-space repair) at write-time too,
            # not just at serve-time in _serialize_insight — mirrors the
            # title/body treatment above so a stored doc is clean from the
            # moment it's written, not only when read back through the API.
            savings_estimate = _house_style(str(savings_estimate))
            allowed = _build_allowed_savings_numbers(web_text, user_context, triggered_by)
            if not _savings_estimate_is_derivable(savings_estimate, allowed):
                log.warning(
                    "savings_insights: ungrounded savings_estimate nulled — category=%s estimate=%r",
                    category_key, savings_estimate,
                )
                savings_estimate = None

        # Unsupported-savings-claim guardrail (incoherence C — see
        # _strip_unsupported_savings_claims above): once savings_estimate is
        # settled (possibly just nulled above), a title/body clause that
        # still claims a specific £ saving with nothing backing it must not
        # be stored in the first place.
        has_estimate = savings_estimate is not None
        title = _strip_unsupported_savings_claims(title, has_estimate, triggered_by)
        body  = _strip_unsupported_savings_claims(body, has_estimate, triggered_by)

        return {
            "title": title,
            "body":  body,
            "savings_estimate": savings_estimate,
            "claim_valid_until": claim_valid_until_dt,
        }
    if violation == "dated_promo_missing_expiry" and last_content is not None:
        # STRIP FALLBACK (owner phone report 2026-09-01, 20:04): both
        # attempts still tripped the dated-promo guardrail even after the
        # second one was told exactly what to fix (see the
        # "dated_promo_missing_expiry" branch in the attempt-prompt chain
        # above) — for deal-heavy categories like subscriptions the model
        # can genuinely fail to produce a compliant answer twice in a row.
        # Degrade by stripping the offending sentence(s), not by dropping
        # the whole card.
        raw_title = last_content["title"]
        raw_body  = last_content["body"]
        stripped_title = _strip_dated_promo_sentences(raw_title) or ""
        stripped_body  = _strip_dated_promo_sentences(raw_body) or ""

        # Belt-and-braces (same pattern as the serve-time repairs): the
        # surviving content must not itself still match the dated-promo
        # pattern. Sentence-level stripping should always clear this — the
        # regex's own `(?:(?!\.).){0,60}?` refuses to span a literal "."  —
        # but if it somehow doesn't, treat the strip as failed rather than
        # ever store a dated claim with no expiry attached.
        still_dated = bool(_DATED_PROMO_RE.search(f"{stripped_title} {stripped_body}"))

        # "Meaningful" is conservative on purpose: a body under ~40 chars
        # ("Switch and save." with nothing else) isn't a real card, even if
        # it's technically non-empty. title empty AND body too short is the
        # only case that 502s — anything else survives with what's left.
        meaningful = bool(stripped_title.strip()) or len(stripped_body.strip()) >= 40

        if still_dated or not meaningful:
            log.warning(
                "savings_insights research: dated-promo strip left nothing usable for "
                "category=%s (still_dated=%s title=%r body_len=%d), dropping",
                category_key, still_dated, stripped_title, len(stripped_body),
            )
            return None

        log.warning(
            "savings_insights research: dated-promo guardrail tripped both attempts for "
            "category=%s, stripped offending sentence(s) and kept surviving content "
            "(title_changed=%s body_changed=%s)",
            category_key, stripped_title != raw_title, stripped_body != raw_body,
        )

        parsed = last_content["parsed"]
        savings_estimate = parsed.get("savings_estimate") or None
        if savings_estimate is not None:
            savings_estimate = _house_style(str(savings_estimate))
            allowed = _build_allowed_savings_numbers(web_text, user_context, triggered_by)
            if not _savings_estimate_is_derivable(savings_estimate, allowed):
                log.warning(
                    "savings_insights: ungrounded savings_estimate nulled — category=%s estimate=%r",
                    category_key, savings_estimate,
                )
                savings_estimate = None

        has_estimate = savings_estimate is not None
        stripped_title = _strip_unsupported_savings_claims(stripped_title, has_estimate, triggered_by) or ""
        stripped_body  = _strip_unsupported_savings_claims(stripped_body, has_estimate, triggered_by) or ""

        return {
            "title": stripped_title or cfg["label"],
            "body":  stripped_body,
            "savings_estimate": savings_estimate,
            # The dated claim itself was stripped out, not kept with a real
            # expiry attached — nothing here to anchor a claim_valid_until to.
            "claim_valid_until": None,
        }

    if violation:
        log.warning(
            "savings_insights research: guardrail violation exhausted both attempts for "
            "category=%s, dropping: %s", category_key, violation,
        )
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
    claim_valid_until_dt = content.get("claim_valid_until")
    base_update: dict = {
        "title": title, "body": body_text, "savings_estimate": savings_estimate,
        "triggered_by": triggered_by, "refreshed_at": now,
        "content_hash": content_hash, "is_new": is_new,
        "prompt_version": PROMPT_VERSION,
        "deadline_at": _parse_deadline(user_context),
        "deadline_flagged": False,  # fresh context resets the one-shot deadline alert
        "claim_valid_until": claim_valid_until_dt,
        # This path is a real, user-initiated research run (the user just
        # filled in workflow details) — stamp it exactly like the weekly
        # cron does, so `content_valid_until`/state stay consistent
        # regardless of which write path produced the content.
        "researched_at": now,
        "content_valid_until": _compute_content_valid_until(now, claim_valid_until_dt),
    }
    if user_context is not None:
        base_update["user_context"] = user_context
    if existing:
        if not existing.get("pinned"):
            base_update["expires_at"] = now + timedelta(days=30)
        # This path only runs when generation actually succeeded (the
        # `content.get("body")` guard above already returned otherwise), so
        # fresh, real content is about to be written — that's grounds enough
        # to resurrect a doc that was previously retired for lack of
        # evidence, same as the automatic resurrection branch in
        # `_refresh_savings_insights_for_user`.
        await savings_insights_col.update_one(
            {"_id": existing["_id"]},
            {"$set": base_update, "$unset": {"retired_at": "", "retire_reason": ""}},
        )
    else:
        insight_id = f"{category_key}-{hashlib.md5(user_id.encode()).hexdigest()[:8]}"
        await savings_insights_col.insert_one({
            "insight_id": insight_id, "user_id": user_id, "category": category_key,
            "icon": cfg["icon"], "label": cfg["label"], "pinned": False,
            "created_at": now, "expires_at": now + timedelta(days=30), **base_update,
        })


# Per-user cap on how many categories can actually be RESEARCHED (a real
# Tavily + OpenRouter call) in one weekly pass — cost control (owner decision
# 2026-09-01: "the app should be responsible for the refreshes... predictable
# batch spend"). In steady state almost every category hits `_regen_reason ==
# None` most weeks (nothing material changed) and costs nothing, but a bulk
# event — a PROMPT_VERSION bump forcing every stored insight to regenerate,
# or a brand-new user whose first pass needs `first_generation` for every
# detected category — could otherwise fire up to len(INSIGHT_CATEGORIES) (10)
# paid calls for one user in one pass. Capped well under that; any category
# that doesn't make the cut this pass is simply picked up on the NEXT weekly
# pass (nothing is lost, `_regen_reason` fires again next time since nothing
# was written).
MAX_RESEARCHED_PER_PASS = 5


async def _refresh_savings_insights_for_user(user_id: str) -> None:
    applicable = await _detect_insight_categories(user_id)
    for cat in ("energy", "groceries"):
        if cat not in applicable:
            applicable.append(cat)

    # Cost-observability (owner decision 2026-09-01, item 5): one WARNING
    # summary per user pass — which categories were actually researched (a
    # real paid call), which were skipped (and why), which attempted
    # research but the generation pass itself came back empty. Spend is
    # observable from `journalctl -u wealth-worker` alone, no need to
    # reproduce or add print debugging after the fact.
    researched: list[str] = []
    skipped: list[str] = []
    failed: list[str] = []

    for cat_key in applicable:
        cfg = INSIGHT_CATEGORIES.get(cat_key)
        if not cfg:
            continue
        existing = await savings_insights_col.find_one({"user_id": user_id, "category": cat_key})

        # Tri-state repair (Insights honesty review, incoherence A — owner
        # phone report 2026-09-01: "£49.10 already banked" chip still showing
        # for a card whose card body correctly rendered as substituted).
        # `_check_verified_saving`'s early-return guard used to read only
        # `if existing.get("verified_at"):`, not also `substituted_at` — a
        # doc already resolved as `substituted` could still be re-evaluated
        # on a later pass and additionally stamped `verified_savings` /
        # `verified_merchant` / `verified_at` on top, leaving BOTH
        # resolutions set at once. Confirmed live on this exact data
        # (kevin.maingi12@gmail.com, eating_out/Nando's: `substituted_at`
        # 2026-08-31 21:10:43, then `verified_at` 2026-08-31 22:00:31 on the
        # same doc, ~50 minutes later). The guard below now checks both
        # fields so this can never be written again; this block is the
        # one-time heal for a doc already corrupted before that fix shipped.
        # First-write-wins, same doctrine as `card_opened_at` elsewhere in
        # this file: whichever resolution happened FIRST is the real one,
        # the later write was the bug, so the loser's fields are cleared.
        # Idempotent — a no-op once a doc only carries one resolution.
        if existing and existing.get("verified_at") and existing.get("substituted_at"):
            if existing["substituted_at"] <= existing["verified_at"]:
                loser_unset = {"verified_savings": "", "verified_merchant": "", "verified_at": ""}
            else:
                loser_unset = {"substituted_at": "", "substituted_merchant": "", "substituted_amount": ""}
            await savings_insights_col.update_one({"_id": existing["_id"]}, {"$unset": loser_unset})
            for _k in loser_unset:
                existing.pop(_k, None)

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
                skipped.append(cat_key)
                continue

        # Evidence-gone retirement / resurrection — see `_evidence_is_gone`
        # above for the bug this closes. Only acts on an EXISTING, unresolved
        # doc: a category with no doc yet is a different (pre-existing) code
        # path, not this bug, and a doc already resolved to
        # `verified_at`/`substituted_at` is a closed historical fact (the
        # spend genuinely stopped, that's confirmed) that doesn't need live
        # evidence to keep being true — retiring it would just hide an
        # earned win once the ceased merchant's old transactions roll past
        # the 90-day window.
        if existing and not existing.get("verified_at") and not existing.get("substituted_at"):
            if not triggered_by:
                if await _evidence_is_gone(user_id, cat_key, triggered_by):
                    retire_update: dict = {"triggered_by": triggered_by, "is_new": False}
                    if not existing.get("retired_at"):
                        # First time this doc goes evidence-gone — stamp it.
                        # A doc that's already retired keeps its original
                        # retired_at (history, not re-stamped every pass).
                        retire_update["retired_at"] = datetime.utcnow()
                        retire_update["retire_reason"] = "evidence_gone"
                    await savings_insights_col.update_one(
                        {"_id": existing["_id"]}, {"$set": retire_update},
                    )
                    skipped.append(cat_key)
                    continue
            elif existing.get("retired_at"):
                # Resurrection: real triggers found again for a category that
                # was previously retired for lack of evidence. Clear the
                # retirement and fall through (deliberately no `continue`) so
                # the normal lifecycle resumes below via `_regen_reason`'s
                # `spend_appeared` branch.
                await savings_insights_col.update_one(
                    {"_id": existing["_id"]},
                    {"$unset": {"retired_at": "", "retire_reason": ""}},
                )
                existing.pop("retired_at", None)
                existing.pop("retire_reason", None)

        # OWNER DECISION (2026-09-01): every category is push/weekly now (see
        # CATEGORY_LIFECYCLE above) — the Package C pull carve-out that used
        # to skip content generation for five categories here, and the
        # research-endpoint-only path that used to be their sole route to
        # fresh content, are both retired. Every category below runs through
        # the exact same `_regen_reason` gate.
        #
        # Cost control (owner decision 2026-09-01, item 5) — "categories with
        # active triggers only": CONFIRMED already true for every category
        # except the two deliberate evergreen exceptions. `applicable` (built
        # above) already only contains categories `_detect_insight_categories`
        # found real trigger evidence for, or that the user manually labelled
        # — EXCEPT "energy"/"groceries", which are force-appended regardless
        # of detected evidence (every UK household has one of each, so a
        # generic best-tariff/best-supermarket pointer is still useful with
        # zero matched transactions). That force-append is the one existing,
        # intentional exception to "active triggers only", not a gap to close
        # here — narrowing it would silently stop researching either category
        # for a user whose bank descriptors don't happen to match a trigger
        # phrase, which is a real, common case (see `_TRIGGER_PATTERNS`).
        reason = _regen_reason(existing, triggered_by, datetime.utcnow())

        # _regen_reason is now the sole gate (the old blanket "skip anything
        # refreshed <7d ago" early-continue used to run BEFORE this and could
        # suppress it entirely — including prompt_upgraded, which exists
        # specifically to force a regen when PROMPT_VERSION is bumped to
        # invalidate stored content, e.g. the substring-matching trigger-
        # evidence bug fixed alongside PROMPT_VERSION 5->6. first_generation,
        # ttl and deadline_window are likewise one-shot/rare events that must
        # never be age-suppressed.
        #
        # spend_changed is the one branch that can legitimately retrigger
        # inside a week — grocery/fuel spend can swing past the 20%/£10
        # threshold in both directions within days, and re-phrasing the same
        # underlying trend twice in a week is exactly the "cry wolf" cost the
        # old guard existed to prevent. Keep a minimum-age floor for that
        # branch alone rather than paying for an LLM call every time weekly
        # spend wobbles.
        if reason == "spend_changed" and existing and existing.get("refreshed_at"):
            age_days = (datetime.utcnow() - existing["refreshed_at"]).days
            if age_days < 7:
                reason = None

        if reason is None:
            if existing:
                await savings_insights_col.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"triggered_by": triggered_by, "is_new": False}},
                )
            skipped.append(cat_key)
            continue

        # Per-user cap (MAX_RESEARCHED_PER_PASS, see above) — a category that
        # legitimately needs regeneration but doesn't make the cut this pass
        # is left completely untouched (not even `triggered_by` refreshed):
        # `_regen_reason` will fire again next weekly pass and pick it up
        # then, exactly as if this pass hadn't run for it at all.
        if len(researched) >= MAX_RESEARCHED_PER_PASS:
            skipped.append(cat_key)
            continue

        stored_context = existing.get("user_context") if existing else None
        content        = await _generate_savings_insight_content(cat_key, stored_context, triggered_by)
        if not content or not content.get("body"):
            # Generation failed (e.g. Tavily quota exhausted) but the fresh
            # triggered_by is still correct and free — persist it so stored
            # evidence doesn't keep showing known-corrupt merchants (stale
            # substring matches etc) while we wait to retry. Leave
            # refreshed_at/prompt_version/expires_at untouched: the copy was
            # not regenerated, so `reason` must keep firing next pass and the
            # TTL clock must not reset on a failed attempt. Evidence may
            # briefly disagree with the older, unregenerated copy until
            # generation next succeeds — preferred over displaying known-
            # corrupt evidence in the meantime. Nothing to update for a brand
            # new document; just move on.
            if existing:
                await savings_insights_col.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {"triggered_by": triggered_by, "is_new": False}},
                )
            failed.append(cat_key)
            continue
        title          = content["title"]
        body           = content["body"]
        savings_estimate = content.get("savings_estimate")
        claim_valid_until_dt = content.get("claim_valid_until")
        content_hash   = hashlib.md5(f"{title}{body}".encode()).hexdigest()
        now            = datetime.utcnow()
        is_new         = not existing or existing.get("content_hash") != content_hash
        content_valid_until = _compute_content_valid_until(now, claim_valid_until_dt)

        if existing:
            update: dict = {
                "title": title, "body": body, "savings_estimate": savings_estimate,
                "triggered_by": triggered_by, "refreshed_at": now,
                "content_hash": content_hash, "is_new": is_new,
                "prompt_version": PROMPT_VERSION,
                "deadline_at": _parse_deadline(stored_context),
                "deadline_flagged": reason == "deadline_window" or bool(existing.get("deadline_flagged")),
                "claim_valid_until": claim_valid_until_dt,
                # Every category is pushed weekly by this cron now (see
                # CATEGORY_LIFECYCLE above); researched_at is the reliable
                # "last real content generation" marker for all of them.
                "researched_at": now,
                "content_valid_until": content_valid_until,
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
                "claim_valid_until": claim_valid_until_dt,
                "researched_at": now,
                "content_valid_until": content_valid_until,
            })
        researched.append(cat_key)

    # Cost-observability summary (owner decision 2026-09-01, item 5) — one
    # WARNING per user pass, not one line per category: enough to see spend
    # at a glance in `journalctl -u wealth-worker`, without flooding it on a
    # user base where most categories are "skipped" (no material change)
    # most weeks.
    log.warning(
        "savings_insights weekly pass user=%s researched=%d skipped=%d failed=%d "
        "researched_categories=%s failed_categories=%s",
        _uid_hash(user_id), len(researched), len(skipped), len(failed),
        ",".join(researched) or "none", ",".join(failed) or "none",
    )


def _merchant_scoped_route(category: str, triggered_by: list[dict]) -> Optional[str]:
    """Deep-link the CTA at the insight's own merchants, not the whole
    category — "/transactions?category=Bills" becomes
    "/transactions?category=Bills&merchants=Ee%20Ltd" so the search hub can
    pre-filter to the rows that actually triggered this insight. A bare
    "/transactions" (no category — used where category is unreliable, e.g.
    mortgage/car_finance) becomes "/transactions?merchants=Ee%20Ltd" instead.
    Up to 3 display names, comma-separated, each URL-encoded. Routes that
    don't drill into a filtered transaction list (e.g. /planning) pass
    through untouched."""
    route = CATEGORY_APP_ROUTES.get(category)
    if not route or not route.startswith("/transactions"):
        return route
    names: list[str] = []
    for t in triggered_by[:3]:
        name = str(t.get("display_name") or t.get("merchant_key") or "").strip()
        if name:
            names.append(name)
    if not names:
        return route
    sep = "&" if "?" in route else "?"
    return f"{route}{sep}merchants={','.join(quote(n, safe='') for n in names)}"


def _savings_estimate_monthly(estimate: Optional[str]) -> Optional[float]:
    """Numeric monthly £ figure behind a `savings_estimate` display string,
    or None when there's nothing to parse.

    Delegates the actual parsing to analytics._parse_saving_amount (lazy
    import, same circular-import workaround already used elsewhere in this
    file) rather than re-deriving the regex here — one parser, one place it
    can drift. That helper returns 0.0 both for a blank/None estimate AND
    for a string with no £ amount in it (e.g. a malformed value), so the
    presence of a literal "£" is checked here first: without it, there's
    nothing for the helper to have found, so the result is null rather than
    a 0.0 that would read as a genuine (and wrong) zero-cost estimate.
    """
    if not estimate or "£" not in estimate:
        return None
    from app.routers.analytics import _parse_saving_amount
    return _parse_saving_amount(estimate)


# ── Single-source insight state (STRUCTURAL FIX, Insights honesty review,
# owner phone report 2026-09-01: "some have data some do not and it ruins
# the credibility of this page") ───────────────────────────────────────────
# Every downstream consumer of a savings-insight doc — this serializer, the
# Insights page's card/compact-row/hero, penny_tools' get_insights — used to
# each independently re-derive "is this resolved? is it fresh? is it worth a
# full card?" from combinations of raw stored fields (verified_at,
# substituted_at, research_fresh, is_new...). Incoherences A and B (see the
# module's git history / PR description) traced back to exactly that: a
# field combination the reading code didn't anticipate. This function is the
# one place that decision gets made; every consumer below switches on the
# resulting string, never on the raw fields again.
#
#   verified    - a genuine, bank-confirmed saving (see _check_verified_saving)
#   substituted - the triggering spend stopped, but the category didn't net
#                 down — honestly NOT a saving (see _check_verified_saving)
#   fresh       - researched content (title/body/[savings_estimate]) is
#                 current (now < content_valid_until, see
#                 _compute_content_valid_until) and safe to render, every
#                 category alike now (OWNER DECISION 2026-09-01: the push/
#                 pull cadence split is retired, see CATEGORY_LIFECYCLE)
#   quiet       - no current research — compact row, no tap affordance
#                 (the live "Find me alternatives" research tap is retired
#                 alongside pull cadence). This is the normal state for
#                 content that has simply aged past its displayed TTL between
#                 weekly cron passes, not just a first-run/no-evidence state
#                 — was two states (`quiet`/`push_stale`) before this
#                 reversal, collapsed into one now that every category ages
#                 out the same way.
#   retired     - evidence-gone. Every caller already filters `retired_at`
#                 out of its own query before a doc reaches this function
#                 (GET /savings-insights, the spotlight endpoint,
#                 penny_tools' get_insights), so this label is defensive —
#                 it is never actually returned to a live consumer today.
#
# verified/substituted precedence: a doc should never carry both
# `verified_at` and `substituted_at` (see the tri-state repair at the top of
# `_refresh_savings_insights_for_user`'s per-category loop, which heals an
# already-corrupted doc the next time the cron visits it), but explicit
# None-handling here means even an unhealed doc renders consistently
# everywhere immediately, not only after the next cron pass: first-write-
# wins, same doctrine as `card_opened_at` elsewhere in this file — the
# earlier timestamp is the real resolution, the later one was the bug.
def _has_researched_content(d: dict) -> bool:
    """True iff `d` actually carries non-blank title AND body text. THE
    INVARIANT (owner phone report 2026-09-01): `state == "fresh"` requires
    this to be true — a doc can never be presented as fresh on content alone
    it doesn't have. Used by both branches of `_derive_insight_state` below,
    so "does this doc have anything to say" is asked exactly one way,
    whether the category is push or pull."""
    return bool((d.get("title") or "").strip()) and bool((d.get("body") or "").strip())


def _derive_insight_state(d: dict) -> str:
    if d.get("retired_at"):
        return "retired"

    verified_at = d.get("verified_at")
    substituted_at = d.get("substituted_at")
    if verified_at and substituted_at:
        return "substituted" if substituted_at <= verified_at else "verified"
    if substituted_at:
        return "substituted"
    if verified_at:
        return "verified"

    # OWNER DECISION (2026-09-01): every category ages the same way now — a
    # doc is only "fresh" while it carries real content (has_content, the
    # STRUCTURAL FIX invariant that used to be pull-only, see prior git
    # history) AND its displayed TTL hasn't passed
    # (`content_valid_until`, stamped at every write site — see
    # `_compute_content_valid_until`). Content past its TTL is left sitting
    # in storage untouched (same "degrade by not rendering, not by mutating"
    # principle the old pull-clearing branch violated) — "quiet" here, a
    # compact row client-side, until the next weekly cron pass repopulates
    # it. `content_valid_until` being recent is necessary but not
    # sufficient; content presence is checked too, same STRUCTURAL FIX
    # discipline as before.
    has_content = _has_researched_content(d)
    content_valid_until = d.get("content_valid_until")
    fresh = has_content and bool(content_valid_until) and datetime.utcnow() < content_valid_until
    return "fresh" if fresh else "quiet"


def _relative_age(dt: datetime, now: datetime) -> str:
    """Day-granularity relative age ("today" / "yesterday" / "2d ago" /
    "3w ago" / "2mo ago"), used only to build the `expiry_line` sentence
    below. The frontend's own `timeAgo` twin (InsightsPage.tsx) was removed
    2026-09-02 alongside the cadence-copy deletion — `expiry_line` is now
    the sole source of age wording, rendered verbatim client-side, so there
    is nothing left for a client-side twin to keep in sync with. Guarded
    against clock-skew going slightly negative."""
    days = (now - dt).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days}d ago"
    if days < 30:
        return f"{days // 7}w ago"
    return f"{days // 30}mo ago"


def _expiry_line(
    researched_at: Optional[datetime],
    content_valid_until: Optional[datetime],
    claim_valid_until: Optional[datetime],
    now: datetime,
) -> Optional[str]:
    """Zone 2's honesty stamp for a FURNISHED (state == "fresh") card only.

    OWNER RULING (2026-09-02, verbatim: "we shouldn't show the cadence of
    the refresh"): internal refresh scheduling is never narrated to the
    user — no "weekly", no "refreshes", no cadence word anywhere in this
    string. Two cases survive:

    - A real, dated offer whose own deadline is sooner than the default
      weekly TTL (`claim_valid_until` is the value that actually governed
      `content_valid_until` — see `_compute_content_valid_until`): a fact
      about the offer, "Valid until Mon 8 Sep".
    - Everything else (generic researched content on the default TTL, no
      claim or one that outlives the default): "Researched 2d ago" — honesty
      about how current the content shown actually is, nothing about when
      it might next change.

    Only called while `content_live` (state == "fresh"); returns None if
    `content_valid_until` is somehow missing (a doc from before this field
    existed reaching this path some other way), or if `researched_at` is
    missing in the non-claim case (there is no honest age to state, and
    cadence wording is no longer an allowed fallback)."""
    if not content_valid_until:
        return None
    claim_governs = claim_valid_until is not None and content_valid_until == claim_valid_until
    if claim_governs:
        return f"Valid until {content_valid_until.strftime('%a')} {content_valid_until.day} {content_valid_until.strftime('%b')}"
    if researched_at:
        return f"Researched {_relative_age(researched_at, now)}"
    return None


def _serialize_insight(d: dict, kinds: dict | None = None) -> dict:
    cat = d["category"]
    state = _derive_insight_state(d)
    # Always resolve icon/label from the live config so stale cached docs
    # automatically pick up any correction — never trust the stored copy.
    _cfg = INSIGHT_CATEGORIES.get(cat) or LABEL_OPTIONS.get(cat) or {}
    # House-style at SERVE time, not just generation time: _house_style() is
    # applied when new content is written (_generate_savings_insight_content),
    # but docs written before that guardrail existed (prompt_version < 4, or
    # even some prompt_version 4 docs generated in the gap before the dash
    # guardrail landed — content_hash isn't versioned on copy-only fixes)
    # still carry raw em/en-dashes. Sanitising here is cheap (regex, no LLM
    # call) and retroactively cleans every stored doc without a migration or
    # forcing a regen — the DB keeps the original text, only the API response
    # is scrubbed.
    #
    # OWNER DECISION (2026-09-01): researched content (title/body/
    # savings_estimate/claim_valid_until/content_valid_until) is only served
    # while `content_valid_until` is in the future (see
    # `_derive_insight_state` — every category ages the same way now) — even
    # if the doc still physically carries older text (the weekly cron only
    # overwrites it on its own next pass), the API must never render it as
    # current once it's past its TTL, so it's nulled out here, at serve
    # time, not just eventually overwritten in storage.
    researched_at = d.get("researched_at")
    # Researched content (title/body/savings_estimate/claim_valid_until)
    # only ever renders in the `fresh` state — once an insight resolves to
    # `verified` or `substituted` its job is to state that fact, not keep
    # re-pitching researched copy the user has already acted on (or that
    # turned out not to be a real saving); `quiet` has no current content by
    # construction.
    content_live = state == "fresh"
    savings_estimate = d.get("savings_estimate") if content_live else None
    title_raw = d.get("title", "") if content_live else ""
    body_raw = d.get("body", "") if content_live else ""
    claim_valid_until_raw = d.get("claim_valid_until") if content_live else None
    content_valid_until_raw = d.get("content_valid_until") if content_live else None

    # Unsupported-savings-claim repair (incoherence C): belt-and-braces,
    # same pattern as the em/en-dash and decimal-space repairs above — runs
    # at SERVE time too, not just generation time, so a doc written before
    # this guardrail existed (or one whose estimate got nulled by a change
    # to the derivability check after it was generated) never shows a
    # dangling "could save up to £NNN" next to a "No number yet" pill. See
    # `_strip_unsupported_savings_claims` for why this is safe to re-run
    # without the generation-time `allowed` set (it targets specifically
    # save-worded clauses, not every £ figure).
    has_estimate = savings_estimate is not None
    _triggered_by = d.get("triggered_by")
    title_raw = _strip_unsupported_savings_claims(title_raw, has_estimate, _triggered_by)
    body_raw = _strip_unsupported_savings_claims(body_raw, has_estimate, _triggered_by)

    # THE INVARIANT, enforced a second time, at the end of the line (owner
    # phone report 2026-09-01): `_derive_insight_state` already requires
    # `_has_researched_content` before it will return "fresh" (see the
    # STRUCTURAL FIX comment there), so `state == "fresh"` is guaranteed
    # non-empty on the DOC'S OWN STORED fields at the moment `state` was
    # computed, a few lines above. But the belt-and-braces
    # `_strip_unsupported_savings_claims` pass just above THIS comment can
    # still reduce that same title/body to "" on THIS read — e.g. a later
    # cron pass refreshed `triggered_by` to a different set of monetary
    # figures than the ones the stored prose was written against, so a
    # clause that was derivable when generated no longer is now. That is the
    # actual mechanism behind the reported car_finance oscillation: `state`
    # said fresh, the content that justified it evaporated one step later in
    # this same function. Never trust the earlier `state` once that's
    # happened — downgrade to the correct no-content state instead of
    # serving "fresh" with nothing in it. This can only ever fire when
    # `content_live` is true; every other state already has no content by
    # construction, so there's nothing for this branch to do there.
    if content_live and not (title_raw.strip() and body_raw.strip()):
        state = "quiet"
        content_live = False
        savings_estimate = None
        claim_valid_until_raw = None
        content_valid_until_raw = None

    # `is_new` time-box (see IS_NEW_TTL): served as False once its own
    # anchor timestamp (the `refreshed_at` stamped in the same write that set
    # `is_new: True`) is older than the TTL, even if the stored value is
    # still raw `True` — closes the latent "stuck forever" bug for a doc no
    # later write path ever revisits. Deliberately NOT additionally gated on
    # `content_live`/`state` here: a contentless-but-new pull insight still
    # earns the subtle "New" affordance on its compact row (see
    # CompactInsightRow in InsightsPage.tsx) — `is_new` no longer forces a
    # FULL card on that doc (that's `isCompactPullInsight`'s fix, not this
    # one), but it's still true that the category is new to the user.
    _is_new_raw = bool(d.get("is_new", False))
    _is_new_anchor = d.get("refreshed_at") or d.get("created_at")
    is_new = _is_new_raw and bool(_is_new_anchor) and (datetime.utcnow() - _is_new_anchor) <= IS_NEW_TTL

    # THE INVARIANT, as a hard assertion (owner phone report 2026-09-01: "no
    # content -> no full card, ever, no override"). Everything above this
    # line should already make this unreachable — `_derive_insight_state`
    # requires content before returning "fresh", and the downgrade a few
    # lines up catches the one case where serve-time stripping removes it
    # again afterwards. This is the backstop: a future edit to either of
    # those that reopens the gap fails LOUDLY here (and in
    # test_category_lifecycle_registry.py's
    # test_serializer_invariant_fresh_requires_content) instead of quietly
    # shipping a hollow full card again.
    assert state != "fresh" or (title_raw.strip() and body_raw.strip()), (
        f"invariant violated: state=fresh with empty content (insight_id="
        f"{d.get('insight_id')!r}, category={cat!r})"
    )
    assert state in {"fresh", "verified", "substituted"} or not (title_raw.strip() and body_raw.strip()), (
        f"invariant violated: state={state!r} carries non-empty researched "
        f"content (insight_id={d.get('insight_id')!r}, category={cat!r})"
    )

    # Resolution fields (verified_savings/substituted and everything
    # derived from them) are gated on `state`, not on the raw
    # `verified_at`/`substituted_at` fields directly — this is what makes
    # incoherence A's tri-state slip structurally impossible even for a doc
    # the repair pass in `_refresh_savings_insights_for_user` hasn't visited
    # yet: `_derive_insight_state` already resolved the precedence, so
    # exactly one side is live here regardless of what's still sitting in
    # storage on the losing side.
    is_verified = state == "verified"
    is_substituted = state == "substituted"

    return {
        "id":              d.get("insight_id", str(d["_id"])),
        "category":        cat,
        # "fixed" (a committed bill) | "free" (discretionary) | None — see
        # `_job_for_category`; resolved through the same category-kind
        # single source of truth as the rest of the app.
        "job":             _job_for_category(cat, kinds),
        "icon":            _cfg.get("icon") or d.get("icon", "💡"),
        "label":           _cfg.get("label") or d.get("label", cat.replace("_", " ").title()),
        "title":           _house_style(title_raw),
        "body":            _house_style(body_raw),
        "savings_estimate": _house_style(savings_estimate) if savings_estimate else savings_estimate,
        # Numeric twin of the display string above, for clients that need to
        # sum estimates (the Insights hero) without re-parsing "~£32/mo"
        # themselves — reimplementing that parse in the frontend would drift
        # from _parse_saving_amount (analytics.py) the moment either changes.
        # null whenever the string is absent OR has no £ amount to parse
        # (e.g. a malformed/legacy value) — never a silent 0.0, which would
        # read as a real, costed £0 estimate to a summing caller.
        "savings_estimate_monthly": _savings_estimate_monthly(savings_estimate),
        "pinned":          d.get("pinned", False),
        "is_new":          is_new,
        # Stored naive-UTC; the Z suffix makes browsers parse it as UTC, not local
        "refreshed_at":    d["refreshed_at"].isoformat() + "Z" if d.get("refreshed_at") else None,
        "return_reason":   _house_style(d["_return_reason"]) if d.get("_return_reason") else d.get("_return_reason"),
        "verified_savings": d.get("verified_savings") if is_verified else None,
        "verified_merchant": (
            (_house_style(d["verified_merchant"]) if d.get("verified_merchant") else d.get("verified_merchant"))
            if is_verified else None
        ),
        # "fact" (honest default — no card_opened_at recorded before the
        # cessation window closed) or "earned" (the user is confirmed to
        # have engaged with this card's evidence/CTA before it verified) —
        # see _verified_copy_tier. Only meaningful when verified_savings is
        # set; null otherwise.
        "verified_tier": _verified_copy_tier(d) if is_verified and d.get("verified_savings") else None,
        # Server-composed celebration/fact copy (see _verified_saving_sentence)
        # — the client renders this string verbatim instead of re-splicing
        # verified_merchant into its own JSX/template, so the sentence has
        # exactly one source of truth and can't drift out of house style (or
        # out of spacing, or out of tier) per surface.
        "verified_savings_line": (
            _verified_saving_sentence(
                d.get("verified_merchant"), float(d["verified_savings"]), _verified_copy_tier(d),
            )
            if is_verified and d.get("verified_savings") else None
        ),
        # `substituted` (Package B #6): the triggering merchant went silent,
        # but the insight's whole spend category never net'd down — the
        # money most likely moved to a different merchant in the same
        # category, so this is NOT a verified saving (verified_savings stays
        # unset, never counts toward /value-delivered's verified_monthly_saving
        # or the Home "insight_win" celebration — both gate on verified_savings
        # alone). Neutral copy, no celebration styling.
        "substituted":          is_substituted,
        "substituted_merchant": (
            (_house_style(d["substituted_merchant"]) if d.get("substituted_merchant") else d.get("substituted_merchant"))
            if is_substituted else None
        ),
        "substituted_amount":   d.get("substituted_amount") if is_substituted else None,
        "substituted_line": (
            _substituted_line(d.get("substituted_merchant"), _cfg.get("label"))
            if is_substituted else None
        ),
        "deadline_at":     d["deadline_at"].isoformat() + "Z" if d.get("deadline_at") else None,
        # A dated-promo claim's own expiry (Package A #5) — when present and
        # in the past, `_regen_reason` has already forced (or will force on
        # the next refresh pass) the researched title/body/estimate to
        # regenerate; exposed here mainly for debuggability. Nulled above
        # (claim_valid_until_raw) for a stale pull-category insight, same as
        # title/body/savings_estimate.
        "claim_valid_until": claim_valid_until_raw.isoformat() + "Z" if claim_valid_until_raw else None,
        # TTL (owner decision 2026-09-01, item 2): every researched entry's
        # own expiry, `min(claim_valid_until, researched_at +
        # DEFAULT_RESEARCH_TTL)` — see `_compute_content_valid_until`. Nulled
        # above (content_valid_until_raw) whenever content isn't currently
        # live, same as claim_valid_until_raw.
        "content_valid_until": content_valid_until_raw.isoformat() + "Z" if content_valid_until_raw else None,
        # Zone 2's expiry indicator — server-composed sentence, same house-
        # style-consistency pattern as verified_savings_line/substituted_line
        # above (see `_expiry_line`). Only meaningful (non-null) while
        # content_live.
        "expiry_line": (
            _expiry_line(researched_at, content_valid_until_raw, claim_valid_until_raw, datetime.utcnow())
            if content_live else None
        ),
        # STRUCTURAL FIX — the single source of truth every consumer should
        # switch on now (see the comment above `_derive_insight_state`):
        # "verified" | "substituted" | "fresh" | "quiet".
        # ("retired" is never returned here — every caller already excludes
        # `retired_at` docs from its own query before this function runs.)
        "state":           state,
        "researched_at":   researched_at.isoformat() + "Z" if content_live and researched_at else None,
        "triggered_by":    d.get("triggered_by", []),
        "user_context":    d.get("user_context"),
        "has_workflow":    d["category"] in CATEGORY_WORKFLOWS,
        # In-app screen where the user can act on this with their own data,
        # scoped to the triggering merchants when it drills into a spend
        # category; null when no natural home exists.
        "app_route":       _merchant_scoped_route(cat, d.get("triggered_by") or []),
    }


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
        # Self-explanatory sentence, no arrow/direction word — the frontend
        # renders this verbatim with no "Back because:" prefix added.
        return f"Updated: estimated saving now ~£{new:,.0f}/mo"

    dismissed = d.get("spotlight_dismissed_at")
    if dismissed is None or dismissed < datetime.utcnow() - timedelta(days=30):
        return ""  # cooldown expired — eligible again, no callout needed
    return None


def _category_for_net_check(category_key: str) -> Optional[str]:
    """The transaction `category`/`custom_category` text an insight category
    should net-check against (e.g. "eating_out" -> "Eating Out"), or None
    when this insight category has no single reliable spend category to net
    against. Deliberately derived from `CATEGORY_APP_ROUTES` rather than a
    second hand-maintained mapping — that dict already carries exactly this
    text for every category where it exists (see its own module comment:
    mortgage/car_finance are routed on merchant alone because no single
    category is reliable for them, so they correctly fall through to None
    here too — the category-net check simply can't run for them, and
    `_check_verified_saving` falls back to merchant-silence-only, the
    pre-Package-B behaviour)."""
    route = CATEGORY_APP_ROUTES.get(category_key)
    if not route or "category=" not in route:
        return None
    qs = parse_qs(urlparse(route).query)
    vals = qs.get("category")
    return vals[0] if vals else None


async def _category_net_totals(user_id: str, category_label: str) -> tuple[float, float]:
    """Total category debit spend in the 45-90 day window ('before') vs the
    last 45 days ('after'), across all four transaction sources — the exact
    same before/after split `_check_verified_saving` already uses for
    merchant silence, so the two checks describe one consistent picture."""
    now    = datetime.utcnow()
    cutoff = now - timedelta(days=90)
    before_total, after_total = 0.0, 0.0
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col, mono_transactions_col]:
        try:
            txns = await col.find(
                {"user_id": user_id, "transaction_type": "debit", "date": {"$gte": cutoff}},
                {"amount": 1, "date": 1, "category": 1, "custom_category": 1},
            ).to_list(None)
        except Exception:
            continue
        for t in txns:
            cat = t.get("custom_category") or t.get("category")
            if cat != category_label:
                continue
            amt = float(t.get("amount") or 0)
            if t["date"] >= now - timedelta(days=45):
                after_total += amt
            else:
                before_total += amt
    return round(before_total, 2), round(after_total, 2)


# Category-net verification threshold (Insights honesty review, Package B
# #6): a merchant going silent only counts as a genuine, celebratable saving
# if the money didn't just move to a different merchant in the same
# category. Named, generic constant (no per-user overrides — see the
# categorisation-pipeline precedent this product already follows) — the
# category must net down by at least this fraction of the ceased merchant's
# own monthly figure. 0.5 is deliberately lenient: even if the user picked
# up a *partial* replacement habit (spends less elsewhere in the category
# than they used to at the ceased merchant), that still counts as a real net
# win. Only a category that's flat or grew counts as `substituted`.
_SUBSTITUTION_NET_DOWN_FRACTION = 0.5


async def _category_confirms_net_down(
    user_id: str, category_key: str, merchant_monthly_amount: float,
) -> Optional[bool]:
    """True: the insight's whole spend category net-down by at least
    `_SUBSTITUTION_NET_DOWN_FRACTION` of the ceased merchant's own monthly
    figure -> a genuine saving, not just a merchant swap. False: the
    category is flat or grew -> the merchant went silent but the spend
    substituted elsewhere, see the `substituted` state. None: this insight
    category has no single reliable spend category to net against (see
    `_category_for_net_check`), or there's no `before` spend to compare
    against at all -> the category-net check cannot run, so the caller
    falls back to merchant-silence-only (the pre-Package-B behaviour)
    rather than guessing either way."""
    category_label = _category_for_net_check(category_key)
    if category_label is None:
        return None
    before, after = await _category_net_totals(user_id, category_label)
    if before <= 0:
        return None  # nothing to compare against — can't judge net movement
    drop = before - after
    return drop >= _SUBSTITUTION_NET_DOWN_FRACTION * merchant_monthly_amount


# Evidence-gone retirement (Insights honesty review): a push-category card
# can keep serving old researched prose ("Virgin Media M1 broadband from
# £17.99...") long after the merchant(s) it was grounded on have vanished
# from the user's transaction history entirely — the regen-reason ladder
# below (`_regen_reason`) only ever sees an empty `triggered_by` as a large
# `spend_changed` swing, which regenerates NEW ungrounded prose rather than
# retiring the claim. Confirmed live case (kevin.maingi12@gmail.com,
# 2026-08-28 census): broadband's `triggered_by` recomputed to `[]` — zero
# ISP-shaped transactions anywhere in the 90-day window — yet the card kept
# rendering 12-day-old researched copy with no deterministic grounding left
# under it.
async def _category_trigger_spend_total(user_id: str, category_key: str) -> float:
    """Belt-and-braces companion to `_find_triggered_transactions`: sums
    debit spend across all four transaction sources over the last 90 days
    whose merchant_name/description matches this category's OWN trigger
    patterns (`_TRIGGER_PATTERNS`), computed directly rather than through
    `_find_triggered_transactions`'s per-merchant bucketing/grouping — so a
    bug in that bucketing, or one collection's query being silently
    swallowed by its `except Exception: continue`, can't be the sole reason
    a category looks evidence-less. Used only by `_evidence_is_gone` below,
    never as a substitute for `_find_triggered_transactions` itself."""
    patterns = _TRIGGER_PATTERNS.get(category_key) or []
    if not patterns:
        return 0.0
    cutoff = datetime.utcnow() - timedelta(days=90)
    total = 0.0
    for col in [transactions_col, yapily_transactions_col, statement_transactions_col, mono_transactions_col]:
        try:
            txns = await col.find(
                {"user_id": user_id, "date": {"$gte": cutoff}, "transaction_type": "debit"},
                {"merchant_name": 1, "description": 1, "amount": 1},
            ).to_list(None)
        except Exception:
            continue
        for t in txns:
            text = f"{t.get('merchant_name', '')} {t.get('description', '')}"
            if _text_matches_triggers(text, patterns):
                total += float(t.get("amount") or 0)
    return round(total, 2)


_EVIDENCE_GONE_SPEND_EPSILON = 1.0  # a pound of rounding noise, not a real signal


async def _evidence_is_gone(user_id: str, category_key: str, triggered_by: list[dict]) -> bool:
    """True when there is no deterministic grounding left for this insight's
    category: the just-recomputed `triggered_by` came back empty AND, belt-
    and-braces, an independent re-derivation of the category's own trigger
    spend (`_category_trigger_spend_total` — NOT `_find_triggered_transactions`
    run twice) also comes back ~zero for the same 90-day window. Both checks
    must agree — if the independent one finds real matching spend that
    `_find_triggered_transactions` somehow missed, this returns False rather
    than retiring on a possibly-buggy signal."""
    if triggered_by:
        return False
    spend = await _category_trigger_spend_total(user_id, category_key)
    return spend < _EVIDENCE_GONE_SPEND_EPSILON


async def _check_verified_saving(user_id: str, existing: dict) -> Optional[dict]:
    """Has the user actually acted on this insight? If the merchant that
    triggered it had payments in the 45-90 day window but NONE in the last 45
    days, the spend genuinely ceased. That alone used to be enough to call it
    a verified saving — Package B of the Insights honesty review added a
    second gate: the insight's whole spend category must ALSO have net'd
    down by a material amount (see `_category_confirms_net_down`), or the
    "saving" may just be the same money moving to a different merchant in
    the same category (the confirmed live case: Nando's payments stopped,
    but Eating Out spend substituted to Wagamama the same month, so the
    category never actually dropped). Category-net-down -> `verified`
    (a real saving). Merchant-silent but category flat/grew -> `substituted`
    (honest, neutral, not a saving). Category-net check inconclusive (no
    reliable category, or nothing to compare against) -> falls back to
    merchant-silence-only, same as before Package B."""
    if existing.get("verified_at") or existing.get("substituted_at"):
        return None  # already resolved, one way or the other
    prev = existing.get("triggered_by") or []
    if not prev:
        return None
    top = prev[0]
    key, amt = top.get("merchant_key"), float(top.get("monthly_amount") or 0)
    if not key or amt < 5:
        return None
    # Normalise both sides before comparing: `key` may be a pre-fix raw
    # descriptor (older stored docs, not yet regenerated) or a post-fix
    # normalised key — _normalize_merchant_key is idempotent on an
    # already-normalised key, so this compares like-for-like either way and
    # still matches every rotating-descriptor variant of the merchant.
    key_norm = _normalize_merchant_key(key)
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
            merchant_name = t.get("merchant_name")
            description = t.get("description") or ""  # full field, not yet sliced
            # Truncation can only have happened when there was no clean
            # merchant_name AND the raw description ran past the 30-char
            # fallback slice below — that's the only case `_merchant_keys_match`
            # is allowed to treat a prefix relationship as the same merchant.
            # A clean merchant_name (even a short one, e.g. "Vodafone") is
            # never truncated and must match exactly, so a sibling product
            # billed separately ("Vodafone Broadband") cannot mask a
            # genuinely ceased merchant ("Vodafone" mobile).
            txn_key_truncated = not merchant_name and len(description) > 30
            k = (merchant_name or description[:30]).strip()
            if not _merchant_keys_match(key_norm, _normalize_merchant_key(k), txn_key_truncated):
                continue
            if t["date"] >= now - timedelta(days=45):
                recent += 1
            else:
                before += 1
    if before > 0 and recent == 0:
        net_down = await _category_confirms_net_down(user_id, existing.get("category", ""), amt)
        if net_down is False:
            return {
                "substituted_at": now,
                "substituted_merchant": top.get("display_name", key),
                "substituted_amount": round(amt, 2),
            }
        return {"verified_savings": round(amt, 2), "verified_merchant": top.get("display_name", key),
                "verified_at": now}
    return None


def _regen_reason(existing: dict | None, triggered_by: list[dict], now: datetime) -> Optional[str]:
    """Event-driven regeneration: return why content should be rebuilt, or None.

    Material events: no insight yet, content_valid_until has passed (or was
    never set), trigger spend moved ≥20%/£10, or a user-entered deadline
    entered the 60-day window (once)."""
    if not existing or not existing.get("refreshed_at"):
        return "first_generation"
    if existing.get("prompt_version") != PROMPT_VERSION:
        return "prompt_upgraded"  # content predates the verdict-first format
    # TTL (owner decision 2026-09-01): the regen cadence now runs on the SAME
    # clock its displayed expiry uses, `content_valid_until` (see
    # `_compute_content_valid_until`), not a separate, disconnected 30-day
    # `refreshed_at` window — otherwise "Refreshes weekly" (the default TTL,
    # see DEFAULT_RESEARCH_TTL) would be a display claim the actual regen
    # cadence didn't back up, and a card could sit `quiet` for weeks between
    # a content_valid_until expiry and the next real regen. A doc with no
    # `content_valid_until` at all is a legacy shape from before this field
    # existed (or a category that has never once generated successfully) —
    # treated the same as expired, so it gets a real regen pass to catch up
    # rather than waiting on some other, unrelated reason to eventually fire.
    content_valid_until = existing.get("content_valid_until")
    if not content_valid_until or now >= content_valid_until:
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
    # Dated-promo guardrail (Package A #5): a generated body claimed a
    # specific time-bound offer and gave a `claim_valid_until` date for it
    # (see `_generate_savings_insight_content`) — once that date passes, the
    # researched body/title/estimate are stale and must regenerate. The
    # deterministic half (triggered_by, the user's own spend facts) is
    # unaffected either way; it's recomputed fresh on every pass regardless
    # of `reason`.
    claim_deadline = existing.get("claim_valid_until")
    if claim_deadline and now >= claim_deadline:
        return "promo_claim_expired"
    return None


def _spotlight_snoozed(d: dict) -> bool:
    until = d.get("spotlight_snoozed_until")
    return bool(until and until > datetime.utcnow())


def _spotlight_candidates(docs: list[dict]) -> list[dict]:
    """Insights eligible for the home spotlight, ranked pinned-first then freshest.

    Dismissal is durable: a retired insight only returns after a 30-day
    cooldown, or earlier when something material changed (estimate moved
    ≥20%/£10, or a user-provided deadline is inside 60 days) — and then it
    carries the reason so the card can say why it's back.

    Content-presence gate (owner phone report 2026-09-01, "should we render
    a card if there is no content" — same invariant that fixed the Insights
    page's compact/full decision applies here): HomeInsightSpotlight always
    renders `title`/`body` directly with no compact fallback (unlike
    InsightCard, it has no CompactInsightRow to drop back to), so a
    a quiet doc winning this ranking would render the exact same
    hollow card on the Home screen. `_rank_key` below scores purely on
    `savings_estimate`/`triggered_by` spend, neither of which implies
    `title`/`body` are populated, so this can't be left to ranking alone —
    excluded here, before ranking ever runs. verified/substituted docs are
    ALSO excluded by this same check (they render no title/body either,
    Zone 2 is retired once resolved) — belt-and-braces alongside the
    `spotlight_retired` stamp `_check_verified_saving`'s caller already sets
    on them, not a behaviour change: they're supposed to leave the
    candidate pool the moment they resolve."""
    cands = []
    for d in docs:
        if _spotlight_snoozed(d):
            continue
        if _derive_insight_state(d) not in {"fresh"}:
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
    # Evidence-gone retirement (`retired_at`) excludes a doc from every
    # surface, not just this one — see `_evidence_is_gone` and the
    # retirement block in `_refresh_savings_insights_for_user`. Distinct
    # from `spotlight_retired` below, which only means "dismissed from the
    # home spotlight" and still serves fine here.
    docs = await savings_insights_col.find(
        {"user_id": uid, "retired_at": {"$exists": False}}
    ).to_list(None)

    for d in docs:
        if not d.get("triggered_by"):
            triggered_by = await _find_triggered_transactions(uid, d["category"])
            if triggered_by:
                await savings_insights_col.update_one({"_id": d["_id"]}, {"$set": {"triggered_by": triggered_by}})
                d["triggered_by"] = triggered_by
        # A retired (dismissed-from-spotlight) insight that has since earned
        # a legitimate return_reason (_material_change_reason — same check
        # _spotlight_candidates uses) is about to resurface on the Home
        # spotlight. It must carry that same reason here too, so the /insights
        # page can keep showing it instead of the spotlight-dedup rule below
        # hiding a resurfaced card the user can no longer find anywhere else.
        if d.get("spotlight_retired"):
            d["_return_reason"] = _material_change_reason(d) or None

    # Biggest-impact card first: pinned, then verified wins, then the largest
    # parsed £ estimate, then the largest triggering monthly spend.
    from app.routers.analytics import _parse_saving_amount

    def _rank_key(d: dict):
        estimate = _parse_saving_amount(d.get("savings_estimate")) or 0.0
        spend    = sum(float(t.get("monthly_amount") or 0) for t in d.get("triggered_by") or [])
        # `and not d.get("substituted_at")`: same precedence
        # `_derive_insight_state` resolves (incoherence A) — a doc an
        # unrepaired race left with both `verified_savings` and
        # `substituted_at` set must not rank as if it were a genuine win.
        is_verified = bool(d.get("verified_savings")) and not d.get("substituted_at")
        return (bool(d.get("pinned")), is_verified, estimate, spend)

    docs.sort(key=_rank_key, reverse=True)
    kinds = await get_category_kinds(uid)  # ONE DB read per request, see categories.py's contract
    return [_serialize_insight(d, kinds=kinds) for d in docs]


@router.get("/savings-insights/spotlight")
async def get_spotlight_insight(user: dict = Depends(current_user), _sub=Depends(require_tier(Tier.PRO))):
    """The single insight to feature on the home screen, or null.

    Applies supersession: if the insight shown last time has been replaced by a
    different top insight, the old one is retired permanently so it never returns.
    """
    uid  = user["email"]
    # Same evidence-gone exclusion as GET /savings-insights above — an
    # evidence-gone card must never win the home spotlight either.
    docs = await savings_insights_col.find(
        {"user_id": uid, "retired_at": {"$exists": False}}
    ).to_list(None)
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
    kinds = await get_category_kinds(uid)  # ONE DB read per request, see categories.py's contract
    return _serialize_insight(top, kinds=kinds)


@router.post("/savings-insights/{insight_id}/opened")
async def mark_insight_opened(insight_id: str, user: dict = Depends(current_user)):
    """Engagement signal (Insights honesty review, Package A #1): the
    frontend fires this the first time a card's evidence footer or workflow
    drawer is expanded, or its primary CTA is tapped. It's the only proof
    this product has that a human actually looked at an insight — the
    copy-tier logic (`_verified_copy_tier`) needs `card_opened_at` to decide
    whether a later "spend ceased" win is earned (engaged before it
    verified) or just an honest fact (no engagement evidence, including
    every insight that existed before this endpoint shipped).

    First-write-wins / idempotent: once stamped, later calls are a no-op, so
    a genuinely early engagement can never be overwritten by a later one,
    and the frontend firing this more than once for the same card (it
    shouldn't, but network retries happen) can't move the timestamp later
    than the truth."""
    uid = user["email"]
    doc = await savings_insights_col.find_one({"user_id": uid, "insight_id": insight_id})
    if not doc:
        raise HTTPException(404, "Insight not found")
    if not doc.get("card_opened_at"):
        await savings_insights_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"card_opened_at": datetime.utcnow()}},
        )
    return {"ok": True}


# POST /savings-insights/{insight_id}/research — retired (owner decision
# 2026-09-01, verbatim: "this pattern would mean that users would do a lot
# of searches which mean tavily calls would be high, I think the app should
# be responsible for the refreshes"). The live, user-initiated research pull
# this endpoint ran (Insights honesty review, Package C, owner-approved
# 2026-08-31) is superseded by the weekly cron researching every category
# for every user on its own predictable schedule (see
# `_refresh_savings_insights_for_user`) with a displayed TTL per entry (see
# `_compute_content_valid_until` / `_expiry_line`) — there is no longer a
# per-insight "research this now" action for a client to call. Deleted
# rather than 410'd: this codebase's convention for a fully superseded
# surface is removal, not a stub (see e.g. the Penny tool-loop ladder
# deletion, the deleted management surfaces under the engine doctrine) —
# there is no legitimate caller left to leave a landing pad for, and the
# frontend's ResearchTap/api.researchInsight are removed in the same change
# (see InsightsPage.tsx / lib/api.ts). RESEARCH_THROTTLE and
# `research_requested_at`, this endpoint's own double-tap guard, are retired
# alongside it.


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
        if _text_matches_triggers(key.lower(), _ALL_TRIGGER_PATTERNS):
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
