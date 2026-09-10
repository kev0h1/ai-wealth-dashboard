"""Display-name pass for credit-card accounts (G15).

`/cards/story` (app.routers.cards) used to pass the raw bank descriptor
straight through as `name`. Two problems with that: several banks return
the network name rather than a card name ("MASTERCARD"), so a user with
more than one card at the same bank sees the SAME label on every row, and a
few connections return the card's own account-holder name as the
descriptor ("MAINGI,KEVIN MBITHI/MR", "CHIGOMEZYO CHUB GOND"), which tells
the reader nothing about which card that is.

This module is a pure, reusable pass: `build_display_name` turns one raw
(name, provider) pair into a clean display string, and
`apply_card_display_names` runs it across a whole list of cards and then
disambiguates any names that still collide (same bank, same generic
descriptor) by appending the last four digits of the account number, and
if that's STILL not enough to tell two rows apart (two synced accounts can
legitimately share both a name and a last-four — see the two "NatWest
Mastercard 1432" rows in production data, one bare last-four, one a masked
PAN that happens to end the same way) a trailing " (2)", " (3)"... ordinal.

The raw `name` field is never overwritten — callers add `display_name`
alongside it, so anything that matches, searches or debugs against the raw
descriptor keeps working.

Scope: this landed for the Cards page (`GET /cards/story`) only, per the
G15 ticket. The Accounts page and other surfaces that render `Account.name`
directly do NOT go through this pass yet — see the G15 report for that as a
flagged follow-up, not something this module quietly changes today.
"""
import re

# ── Provider display map ────────────────────────────────────────────────────
#
# General bank/provider CODE -> DISPLAY NAME mapping. This is deliberately
# not user-specific (no lookup keyed on a particular person's cards) — it's
# the same kind of general provider vocabulary already maintained in
# frontend/components/AccountMiniCard.tsx's BANK_META/FINEXER_ALIAS, kept
# here as its own small backend copy since this module has no reason to
# import frontend TSX. Keys are normalised via `_normalise_provider_key`
# (uppercase, letters/digits/spaces only, trailing " UK" stripped), so
# "NATWEST", "NatWest" and "natwest_bankline" style inputs all resolve the
# same way. Anything not in this map falls back to title-casing the raw
# provider string as given (see `provider_display_name`), so an
# unrecognised provider still gets a readable label instead of vanishing.
PROVIDER_DISPLAY_MAP: dict[str, str] = {
    "NATWEST": "NatWest",
    "RBS": "NatWest",
    "BARCLAYS": "Barclays",
    "BARCLAYCARD": "Barclays",
    "HSBC": "HSBC",
    "LLOYDS": "Lloyds",
    "HALIFAX": "Halifax",
    "SANTANDER": "Santander",
    "NATIONWIDE": "Nationwide",
    "TSB": "TSB",
    "MONZO": "Monzo",
    "STARLING": "Starling",
    "REVOLUT": "Revolut",
    "FIRST DIRECT": "first direct",
    "MBNA": "MBNA",
    "CAPITAL ONE": "Capital One",
    "VIRGIN MONEY": "Virgin Money",
    "AMEX": "American Express",
    "AMERICAN EXPRESS": "American Express",
    "MS": "Marks & Spencer",
    "MARKS AND SPENCER": "Marks & Spencer",
    "MARKS SPENCER": "Marks & Spencer",
    "TESCO": "Tesco Bank",
    "SAINSBURYS": "Sainsbury's Bank",
    "JOHN LEWIS": "John Lewis",
    "CHASE": "Chase",
    "OFFLINE": "Offline",
}

# Generic card/product vocabulary used to keep the no-comma holder-name
# heuristic (see `looks_like_holder_name`) from misfiring on a genuine
# multi-word product descriptor. Deliberately generic (industry terms, not
# any one bank's or person's own branding).
_PRODUCT_WORDS = {
    "CARD", "CREDIT", "DEBIT", "MASTERCARD", "VISA", "AMEX", "EXPRESS",
    "PLATINUM", "GOLD", "SILVER", "BLACK", "BUSINESS", "CORPORATE",
    "PREMIER", "REWARDS", "REWARD", "CASHBACK", "CLASSIC", "WORLD", "ELITE",
    "SELECT", "PLUS", "ADVANTAGE", "AIRWAYS", "BRITISH", "AMERICAN", "BANK",
    "BANKING", "ACCOUNT", "CHARGE", "PREPAID", "STUDENT", "TRAVEL",
    "PURCHASE", "PURCHASES", "BALANCE", "TRANSFER", "ONE", "EVERYDAY",
}

_TITLE_SUFFIX_RE = re.compile(r"/(MR|MRS|MISS|MS|DR|SIR|PROF)\.?$", re.IGNORECASE)
_WORD_RE = re.compile(r"[A-Za-z']+")
_NAME_PART_RE = re.compile(r"[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3}")


def _normalise_provider_key(provider: str | None) -> str:
    s = (provider or "").strip().upper()
    s = re.sub(r"\s+UK$", "", s)
    s = re.sub(r"[^A-Z0-9\s]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def provider_display_name(provider: str | None) -> str:
    """Normalise a raw provider string to a display name via
    PROVIDER_DISPLAY_MAP, falling back to title-casing the raw value
    unchanged for anything not in the map (rule 2 of the G15 ticket: no
    user-specific hardcodes, just a general map plus a sensible default)."""
    key = _normalise_provider_key(provider)
    if key in PROVIDER_DISPLAY_MAP:
        return PROVIDER_DISPLAY_MAP[key]
    raw = (provider or "").strip()
    return raw.title() if raw else "Card"


def last_four(account_number: str | None) -> str | None:
    """Trailing four digits/letters of whatever form `account_number`
    arrives in — a bare last-four ("6271") or a masked PAN
    ("546811******1432") both just need their last four characters, and a
    missing/short value returns None rather than raising."""
    digits = re.sub(r"[^0-9A-Za-z]", "", str(account_number or ""))
    return digits[-4:] if len(digits) >= 4 else None


def _strip_title_suffix(s: str) -> str:
    return _TITLE_SUFFIX_RE.sub("", s.strip()).strip()


def _matches_holder_name(descriptor_core: str, holder_name: str | None) -> bool:
    """True when every significant word of the CURRENT session's own OAuth
    display name (current_user()'s `name`, passed in per-request — never a
    stored or hardcoded string) also appears in the descriptor. Catches a
    card labelled with just the account owner's own name in a form the
    comma/no-comma structural checks below don't already cover."""
    if not holder_name:
        return False
    holder_words = {w.upper() for w in _WORD_RE.findall(holder_name) if len(w) > 1}
    if len(holder_words) < 2:
        return False
    descriptor_words = {w.upper() for w in _WORD_RE.findall(descriptor_core) if len(w) > 1}
    return holder_words.issubset(descriptor_words)


def looks_like_holder_name(descriptor: str, holder_name: str | None = None) -> bool:
    """Detects a holder-name-shaped descriptor, per the G15 ticket: a card
    labelled with a person's name tells the reader nothing about which
    card it is, so these fall back to the bank name instead (see
    `build_display_name`). Three independent signals, any one is enough:

    1. Comma-and-title form ("SURNAME,FORENAME[ MIDDLE]" optionally
       followed by "/MR", "/MRS", "/MS", "/DR" in any case) — a structural
       shape, not a name lookup, so it catches ANY comma-formatted
       descriptor regardless of whose name it is.
    2. Three-or-more space-separated, purely-alphabetic ALL-CAPS words with
       none of them a generic card/product term (_PRODUCT_WORDS) — also
       structural. Two-word all-caps descriptors are deliberately NOT
       caught by this path ("IBCM PLATINUM", "MASTERCARD" are two words or
       fewer) since two generic words is too weak a signal on its own and
       would misclassify real product names.
    3. The descriptor's words are a superset of the CURRENT user's own
       session name's words (see `_matches_holder_name`) — catches a
       plain two-word "FORENAME SURNAME" descriptor for the account owner
       specifically, without hardcoding any name: `holder_name` always
       comes from the authenticated request, never a stored constant.
    """
    core = _strip_title_suffix(descriptor)
    if not core:
        return False

    if "," in core:
        parts = [p.strip() for p in core.split(",")]
        if len(parts) == 2 and all(parts) and all(_NAME_PART_RE.fullmatch(p) for p in parts):
            return True

    words = core.split()
    if (
        len(words) >= 3
        and all(re.fullmatch(r"[A-Za-z'\-]+", w) for w in words)
        and not any(w.upper() in _PRODUCT_WORDS for w in words)
    ):
        return True

    return _matches_holder_name(core, holder_name)


def _provider_already_named(descriptor: str, provider_display: str, raw_provider: str | None) -> bool:
    """True when the descriptor already names the bank (e.g. "American
    Express® Corporate Green C" under provider AMEX) so `build_display_name`
    doesn't double it up into "American Express American Express®...".
    Compares letters/digits only (case-insensitive, symbols like ® and
    punctuation stripped) against both the resolved display name and the
    raw provider string, since either could be the one that shows up in
    the descriptor text."""
    d = _normalise_provider_key(descriptor)
    if not d:
        return False
    for candidate in (provider_display, raw_provider):
        c = _normalise_provider_key(candidate)
        if c and c in d:
            return True
    return False


def _humanise(descriptor: str) -> str:
    """Title-cases a SHOUTY ALL-CAPS descriptor ("IBCM PLATINUM" ->
    "Ibcm Platinum"); a descriptor that already carries mixed case
    ("American Express® Corporate Green C") is left exactly as-is (rule 5
    of the G15 ticket) — str.isupper() is False for anything with a
    lowercase letter in it, so this only ever touches the fully-shouty
    ones. Truncated-by-the-provider descriptors (the two Amex names cut at
    34 characters) are ALREADY mixed case, so they pass through here
    untouched too — this function never tries to guess or restore missing
    text (rule 6)."""
    return descriptor.title() if descriptor.isupper() else descriptor


def build_display_name(
    raw_name: str | None,
    provider: str | None,
    holder_name: str | None = None,
) -> str:
    """Pure, single-card base display name: no cross-card disambiguation
    (see `apply_card_display_names` for the set-level last-four/ordinal
    pass that makes a name unique within one account's own card list).

    Rules, in order:
      - blank/missing name -> just the bank name.
      - holder-name-shaped name (`looks_like_holder_name`) -> just the bank
        name; printing a person's own name tells the reader nothing about
        which card it is.
      - name already contains the bank name -> title-cased (if shouty)
        name, unprefixed, so it doesn't double up.
      - otherwise -> "<bank name> <title-cased-if-shouty name>".
    """
    display_provider = provider_display_name(provider)
    name = (raw_name or "").strip()
    if not name:
        return display_provider
    if looks_like_holder_name(name, holder_name):
        return display_provider
    humanised = _humanise(name)
    if _provider_already_named(name, display_provider, provider):
        return humanised
    return f"{display_provider} {humanised}".strip()


def apply_card_display_names(cards: list[dict], holder_name: str | None = None) -> list[dict]:
    """Set-level disambiguation pass. `cards` is a list of dicts each
    carrying at least "name", "provider" and "account_number" (missing
    account_number is fine, see `last_four`); returns a NEW list of
    shallow copies with a "display_name" key added. "name" is left
    untouched.

    Two disambiguation passes, applied across the WHOLE list (not any
    fixed pair or count — a real account can have any number of cards
    sharing a base name, see the five "NatWest Mastercard" rows in
    production data):

      1. Any base name shared by 2+ cards gets the card's own last four
         digits appended (when available).
      2. Anything that STILL collides after step 1 (two synced accounts
         can legitimately share both a name and a last-four — a bare
         last-four and a masked PAN ending the same way both surface as
         "1432" for two different rows in production data) gets a
         trailing " (2)", " (3)"... ordinal appended, in list order.
    """
    out = []
    base_names = []
    for c in cards:
        base = build_display_name(c.get("name"), c.get("provider"), holder_name)
        base_names.append(base)
        out.append(dict(c))

    base_counts: dict[str, int] = {}
    for b in base_names:
        base_counts[b] = base_counts.get(b, 0) + 1

    stage1_names = []
    for c, base in zip(cards, base_names):
        if base_counts[base] > 1:
            l4 = last_four(c.get("account_number"))
            stage1_names.append(f"{base} {l4}" if l4 else base)
        else:
            stage1_names.append(base)

    seen: dict[str, int] = {}
    for entry, name in zip(out, stage1_names):
        seen[name] = seen.get(name, 0) + 1
        entry["display_name"] = name if seen[name] == 1 else f"{name} ({seen[name]})"

    return out
