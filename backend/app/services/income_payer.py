"""Payer identity for income series (G157).

Why this exists: `app/services/categorisation.py`'s `series_key` groups a
transaction by its raw statement text (merchant_name, or the description
with only DATE fragments stripped). That is the right key for spend
categorisation, but it is the wrong key for INCOME: a payroll reference
embedded in the statement text (a sort-code/account fragment, a payslip
number) can change from one payday to the next while the payer is exactly
the same person or company. When it does, `series_key` forks one salary
into two "series", each below `_detect_recurring`'s occurrence floor on its
own -- the exact 2026-09-24 defect (Goldman Sachs' reference changed from
"185008 12702436 GOLDMAN SACHS" to "0201 GOLDMAN SACHS GOLDMAN SACHS PAY"
and the confirmed salary dropped out of the forecast the day before
payday).

This module gives income its own identity key -- `payer_key` -- built from
counterparty TOKENS (alphabetic words, reference numbers/leading digits/
account-number-shaped fragments normalised out by construction: the token
regex is alphabetic-only, so any all-digit fragment is simply never a
token) plus the destination account id. `series_key` itself is untouched;
spend categorisation keeps using it exactly as before.

`resolve_confirmed_alias` is the migration-free bridge: an EXISTING
confirmed stream in `preferences.income_streams` is still stored under its
old raw `series_key`-shaped key (this module never rewrites user
preferences), so a detected/synthesised entry keyed by the NEW `payer_key`
format needs a way to find that old record. It tokenises the stored raw key
text the same way and matches on an exact token-SET match -- deliberately
stricter than the partial-overlap evidence `deterministic_match` uses below,
since this is asserting "this IS the same stream", not "this LOOKS like the
same payer".
"""
import hashlib
import re
from datetime import date as _date, datetime, timedelta

from app.services.categorisation import _CHANNEL_CODES, series_key

# Generic UK bank-narrative / payroll boilerplate: words that show up on
# huge swathes of UNRELATED income lines and so carry no evidence of one
# specific payer (mirrors analytics.py's `_GENERIC_BANKING_TOKENS`, kept as
# its own smaller copy here rather than imported -- analytics.py imports
# THIS module, so the reverse import would cycle).
_GENERIC_PAYER_TOKENS = {
    "payment", "payments", "paid", "pay", "payroll", "salary", "salaries",
    "wage", "wages", "wagepayment", "credit", "credits", "transfer",
    "transfers", "transferred", "deposit", "deposits", "standing", "order",
    "orders", "faster", "request", "account", "accounts", "reference", "ref",
    "thank", "you", "from", "for", "via", "the", "and", "of", "on", "at",
    "in", "out", "ltd", "limited", "plc", "llp", "inc", "corp", "mr", "mrs",
    "ms", "dr", "bank", "banking", "new", "not", "your", "with", "bgc",
    "bacs",
}

_MONTH_TOKENS = {
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
}

# Missed-cycles lapse rule (build step 4): a confirmed stream is "lapsed"
# only after this many full expected cycles pass with no attached credit.
# Monthly (and anything slower than fortnightly) gets 2 full cycles' grace
# -- one missed payday alone is well within normal payroll jitter (a
# reference change, a bank holiday shift); two in a row is the point it's
# worth asking the user whether pay actually changed. Weekly/biweekly get
# more cycles at the same wall-clock generosity (roughly 2 months either
# way) since a single missed weekly payment is noise, not signal.
LAPSE_CYCLES_MONTHLY = 2
LAPSE_CYCLES_BIWEEKLY = 4
LAPSE_CYCLES_WEEKLY = 8

# Cadence tolerance for the deterministic payer match (build step 2): a
# candidate credit must land within this many days of an expected
# occurrence to count as "on the stream's cadence" at all. Matches the
# grace `OBSERVATION_LOOKBACK_DAYS` gives elsewhere in analytics.py for
# "did the money land yet" checks, kept as this module's own constant so it
# never silently drifts if that one changes for an unrelated reason.
ATTACH_CADENCE_TOLERANCE_DAYS = 6

# Amount-band tolerance for the deterministic payer match. Same 15% band
# `_within_pct_tolerance` in analytics.py uses for every other income
# amount comparison -- kept as a local copy (not an import) to avoid a
# cycle back into analytics.py.
ATTACH_AMOUNT_TOLERANCE = 0.15


def _within_pct(a: float, b: float, pct: float = ATTACH_AMOUNT_TOLERANCE) -> bool:
    ref = max(abs(a), abs(b))
    return ref == 0 or abs(a - b) / ref <= pct


def payer_tokens(text: str) -> frozenset:
    """Alphabetic tokens (>=3 chars) from `text`, lowercased, with rail/
    channel codes, month names and generic payroll/banking boilerplate
    excluded. Digits (reference numbers, leading digit groups, account-
    number-shaped fragments) are never tokens at all -- the token regex is
    alphabetic-only by construction, so nothing needs a separate digit-
    stripping pass."""
    out: set = set()
    for tok in re.findall(r"[A-Za-z]+", text or ""):
        if len(tok) < 3:
            continue
        if tok.upper() in _CHANNEL_CODES:
            continue
        low = tok.lower()
        if low in _MONTH_TOKENS or low in _GENERIC_PAYER_TOKENS:
            continue
        out.add(low)
    return frozenset(out)


def payer_key(txn: dict) -> str:
    """Stable payer-identity key for an income transaction: counterparty
    tokens (see `payer_tokens`) plus the destination account id, so the
    same payer paying into two different accounts is never silently
    merged into one series, but a payroll reference change into the SAME
    account collapses to one series exactly as it should.

    Falls back to `series_key` (still date/merchant-stripped, just not
    token-normalised) when a line carries no meaningful alphabetic token at
    all -- e.g. a purely numeric statement line -- so it never collapses
    every such line under one empty-token bucket."""
    text = f"{txn.get('merchant_name') or ''} {txn.get('description') or ''}"
    tokens = payer_tokens(text)
    acct = str(txn.get("account_id") or "")
    if not tokens:
        return f"{series_key(txn)}::{acct}"
    return "|".join(sorted(tokens)) + "::" + acct


def stable_stream_id(raw_key: str) -> str:
    """A stable, opaque id for a confirmed stream's raw key -- logged
    instead of the raw key/reference text itself (2026-09-24 review
    finding: the old suppression log printed series keys, which can carry
    an account-number-shaped fragment when `series_key` falls back to the
    raw description)."""
    return hashlib.sha1((raw_key or "").encode()).hexdigest()[:16]


def resolve_confirmed_alias(confirmed_income_map: dict, key: str) -> tuple | None:
    """Find the confirmed stream `key` (a payer_key, or a plain series_key
    for a not-yet-migrated caller) stands in for, when it is not already a
    literal entry in `confirmed_income_map` (whose own keys are still the
    OLD raw `series_key`-shaped text stored in preferences -- this module
    never rewrites that). Returns `(raw_key, stream)` or None.

    Matches on an EXACT token-set equality between `key`'s own token
    component and the tokenised raw stored key -- deliberately stricter
    than `deterministic_match`'s partial-overlap evidence gate below, since
    this is asked to assert identity ("this IS the confirmed stream"), not
    merely "this looks like the same payer, worth a suggestion".
    """
    if key in confirmed_income_map:
        return key, confirmed_income_map[key]
    if "::" in key:
        tok_part = key.rsplit("::", 1)[0]
        key_tokens = frozenset(tok_part.split("|")) if tok_part else frozenset()
    else:
        key_tokens = payer_tokens(key)
    if not key_tokens:
        return None
    for raw_key, stream in confirmed_income_map.items():
        if raw_key == "manual":
            continue
        if payer_tokens(raw_key) == key_tokens:
            return raw_key, stream
    return None


def _to_date(d) -> _date:
    return d.date() if isinstance(d, datetime) else d


def deterministic_match(
    stream_key: str,
    stream: dict,
    candidate: dict,
    today: _date,
    stream_account_id: str | None = None,
) -> dict | None:
    """Evidence-gated payer match between a confirmed stream (whose own
    detected series lost this candidate credit, e.g. after a reference
    change so drastic the tokens no longer alias-match at all) and one
    unattributed income-sized credit `candidate` (a transaction dict).

    Returns None when there is no meaningful evidence at all (no shared
    counterparty token). Otherwise returns a dict:
      `{"decision": "confident" | "ambiguous", "evidence": {...}}`

    "confident" (build step 2 -- deterministic, no model needed) requires
    ALL of:
      - FULL containment, not merely one shared token: the smaller side's
        entire (already non-generic -- `payer_tokens` filters rail codes,
        month names and payroll/banking boilerplate before either set is
        built) token set must be a subset of the larger side's, and equal
        to the shared set. One coincidental shared word between two
        otherwise-different counterparties (e.g. two unrelated employers
        both trading as "... CORP", or a shared "PAYROLL"/"WAGES" suffix
        that slipped past the generic list) is explicitly NOT enough --
        see the ACME/SUNRISE regression test this guards;
      - same destination account as the stream's own known landing account
        (or the stream has no known account yet -- nothing to contradict);
      - amount within the stream's band (15%, `_within_pct`);
      - lands within `ATTACH_CADENCE_TOLERANCE_DAYS` of an expected
        occurrence on the stream's own schedule.

    "ambiguous" (build step 3 -- routes to the judge, never auto-attaches)
    is any case with at least one shared token and cadence support, but
    where full containment fails, or the account or amount evidence
    disagrees -- e.g. tokens partially overlap but the account is
    different (a partner's similar salary), or the account matches but the
    amount is well outside the band (a genuine pay change, not evidence of
    a DIFFERENT payer, but not confident enough to auto-attach either).

    Returns None only when there is NO shared token, or no cadence support,
    at all -- no evidence whatsoever, nothing even worth asking about.
    """
    cand_text = f"{candidate.get('merchant_name') or ''} {candidate.get('description') or ''}"
    cand_tokens = payer_tokens(cand_text)
    stream_tokens = payer_tokens(stream_key)
    shared = stream_tokens & cand_tokens
    if not shared:
        return None

    schedule = stream.get("schedule")
    cand_date = _to_date(candidate.get("date"))
    if not schedule or cand_date is None:
        return None
    cadence_ok = _within_cadence(schedule, cand_date, today)
    if not cadence_ok:
        return None

    cand_acct = str(candidate.get("account_id") or "") or None
    same_account = stream_account_id is None or cand_acct is None or str(stream_account_id) == cand_acct

    avg_amount = stream.get("avg_amount")
    amount_ok = avg_amount is not None and _within_pct(abs(float(candidate.get("amount") or 0)), float(avg_amount))

    # Full containment: the SMALLER token set must be entirely covered by
    # the shared set (equivalently, entirely covered by the larger set) --
    # one word in common out of several is partial evidence (ambiguous at
    # best), never confident on its own. Guards the ACME/SUNRISE case:
    # "PAYROLL SALARY LTD ACME" and "PAYROLL SALARY LTD SUNRISE" would
    # otherwise both reduce to a single shared token if a boilerplate word
    # ever slipped past `_GENERIC_PAYER_TOKENS` -- this is deliberate
    # defence in depth on top of that list, not a replacement for it.
    smaller = stream_tokens if len(stream_tokens) <= len(cand_tokens) else cand_tokens
    full_containment = bool(smaller) and shared == smaller

    evidence = {
        "shared_tokens": sorted(shared),
        "candidate_account_id": cand_acct,
        "stream_account_id": str(stream_account_id) if stream_account_id else None,
        "candidate_amount": round(abs(float(candidate.get("amount") or 0)), 2),
        "stream_avg_amount": round(float(avg_amount), 2) if avg_amount is not None else None,
        "candidate_date": cand_date.isoformat(),
    }
    if full_containment and same_account and amount_ok:
        return {"decision": "confident", "evidence": evidence}
    return {"decision": "ambiguous", "evidence": evidence}


def _within_cadence(schedule: dict, cand_date: _date, today: _date) -> bool:
    """True when `cand_date` lands within `ATTACH_CADENCE_TOLERANCE_DAYS`
    of some occurrence the schedule generates -- checked against the
    occurrence immediately before and after `cand_date` itself so this
    works regardless of whether the candidate is earlier or later than
    `today`."""
    from app.services.income import next_occurrence
    try:
        probe = cand_date - timedelta(days=ATTACH_CADENCE_TOLERANCE_DAYS + 1)
        for _ in range(6):
            nxt = next_occurrence(schedule, probe)
            if abs((nxt - cand_date).days) <= ATTACH_CADENCE_TOLERANCE_DAYS:
                return True
            if nxt > cand_date + timedelta(days=ATTACH_CADENCE_TOLERANCE_DAYS):
                return False
            probe = nxt
    except (KeyError, ValueError, TypeError):
        return False
    return False


def _cycle_days(schedule: dict) -> tuple[float, int]:
    """(nominal cycle length in days, missed-cycles-to-lapse threshold) for
    a schedule type."""
    t = (schedule or {}).get("type")
    if t == "weekly":
        return 7.0, LAPSE_CYCLES_WEEKLY
    if t == "biweekly":
        return 14.0, LAPSE_CYCLES_BIWEEKLY
    # day_of_month / last_weekday / anything else defaults to the monthly
    # cycle length -- every schedule type this module sees today besides
    # weekly/biweekly IS monthly (see app/services/income.py's
    # derive_schedule), so this is not a silent guess for an unknown type,
    # it is the only remaining type.
    return 30.4, LAPSE_CYCLES_MONTHLY


def missed_cycles(schedule: dict, last_credit_date: _date | None, today: _date) -> float:
    """How many full expected cycles have elapsed since `last_credit_date`
    with no attached credit. `last_credit_date=None` (never observed at
    all) reports 0 -- nothing to have lapsed FROM yet; a brand-new
    confirmed stream is not "lapsed", it simply has no history."""
    if last_credit_date is None:
        return 0.0
    days, _ = _cycle_days(schedule)
    elapsed = (today - last_credit_date).days
    if elapsed <= 0:
        return 0.0
    return elapsed / days


def is_lapsed(schedule: dict, last_credit_date: _date | None, today: _date) -> bool:
    """The missed-CYCLES lapse rule (build step 4): a confirmed stream is
    lapsed only once `missed_cycles` clears the schedule's own threshold
    (2 full cycles for monthly, scaled for faster cadences -- see
    `_cycle_days`), never a fixed day count. A fixed-day cutoff (the
    original bug this item exists to fix) can expire between two ordinary
    monthly paydays purely because the calendar gap between them is wide;
    counting missed CYCLES instead means a stream is never called lapsed
    while it is still on-time by its own cadence, however long that cadence
    is."""
    if last_credit_date is None:
        return False
    _, threshold = _cycle_days(schedule)
    return missed_cycles(schedule, last_credit_date, today) >= threshold
