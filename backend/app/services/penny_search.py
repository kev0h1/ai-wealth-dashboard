"""G254: forgiving merchant, amount and FX matching for Penny's
search_transactions. Pure functions, no database access, so every rule is
testable on its own.

Why: a user typing "Digital Ocean" or "DigitalOcean LLC" has a transaction
stored as "DIGITALOCEAN.COM AMOUNT IN USD 14.40 ...". A plain substring match
misses both. Matching here is on a normalised form (lower case, punctuation
and spaces ignored, company suffixes dropped), expressed as a Mongo regex so
the stored side is normalised by the pattern itself.
"""
from __future__ import annotations

import re

# Words a person adds to a company name that the bank statement usually omits.
_SUFFIX_TOKENS = {
    "llc", "ltd", "limited", "inc", "incorporated", "plc", "corp", "corporation",
    "co", "company", "gmbh", "sa", "bv", "ag", "pty", "www", "com", "net", "org", "uk",
}
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_MIN_LOOSE_CHARS = 3
_MAX_LOOSE_CHARS = 40


def tokens(text: str | None) -> list[str]:
    """Lower-case alphanumeric tokens, with ".com"/".co.uk" style suffixes and
    company-form words dropped (but never to nothing: a name that is only a
    suffix word keeps its tokens)."""
    cleaned = _CONTROL_RE.sub(" ", str(text or "")).lower()
    words = re.findall(r"[a-z0-9]+", cleaned)
    kept = [w for w in words if w not in _SUFFIX_TOKENS]
    return kept or words


def loose_name(text: str | None) -> str:
    """The name with spaces, punctuation, case and company suffixes removed:
    "Digital Ocean", "DigitalOcean LLC" and "DIGITALOCEAN.COM" all become
    "digitalocean"."""
    return "".join(tokens(text))[:_MAX_LOOSE_CHARS]


def loose_regex(text: str | None) -> str | None:
    """A case-insensitive regex that matches the normalised name inside any
    stored string, tolerating spaces or punctuation between every character.
    None when the name is too short to match safely (a 1-2 letter needle
    would match half the history)."""
    name = loose_name(text)
    if len(name) < _MIN_LOOSE_CHARS:
        return None
    return r"[^a-z0-9]*".join(re.escape(ch) for ch in name)


# ── Amounts ──────────────────────────────────────────────────────────────

_AMOUNT_ONLY_RE = re.compile(
    r"^\s*(?:(?:usd|eur|gbp|[a-z]{3})\s*)?[$£€]?\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?\s*(?:usd|eur|gbp|[a-z]{3})?\s*$",
    re.I,
)


def parse_amount(value) -> float | None:
    """A positive amount from a number or a string like "$14.40", "USD 14.40",
    "£1,200.50". None for anything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value == value and value > 0 else None
    if not isinstance(value, str):
        return None
    m = _AMOUNT_ONLY_RE.match(value)
    if not m:
        return None
    whole = m.group(1).replace(",", "")
    out = float(whole + (m.group(2) or ""))
    return out if out > 0 else None


def amount_description_regex(amount: float) -> str:
    """Matches the amount, to two decimals, as a whole figure inside a
    description ("AMOUNT IN USD 14.40 ON 01 MAY"). Not part of a longer number."""
    return r"(^|[^0-9.,])" + re.escape(f"{amount:.2f}") + r"($|[^0-9])"


def amount_clause(amount: float) -> dict:
    """Mongo clause: the home amount, an original-currency amount field, or
    the figure inside the description. Amounts are stored absolute."""
    lo, hi = round(amount - 0.005, 4), round(amount + 0.005, 4)
    return {"$or": [
        {"amount": {"$gte": lo, "$lte": hi}},
        {"original_amount": {"$gte": lo, "$lte": hi}},
        {"description": {"$regex": amount_description_regex(amount), "$options": "i"}},
    ]}


# ── FX details written into the description by some banks ────────────────

FX_RATE_MIN, FX_RATE_MAX = 0.2, 20.0  # sanity band for a plausible GBP exchange rate
_FX_ORIG_RE = re.compile(r"AMOUNT IN ([A-Z]{3}) ([0-9][0-9,]*\.[0-9]{2})")
_FX_RATE_RE = re.compile(r"\b(?:VISA|MASTERCARD|MC|RATE)\s+([0-9]+\.[0-9]{2,6})\b")
_FX_FEE_RE = re.compile(r"TRANS(?:ACTION)? FEE\s*£\s*([0-9]+\.[0-9]{2})")


def fx_from_description(desc: str | None) -> dict | None:
    """Foreign-currency details only when the description really states them,
    e.g. "AMOUNT IN USD 14.40 ON 01 MAY VISA 1.3451 ... FEE £0.32". Parsed
    from the user's own row text, never inferred. None when it states none."""
    text = str(desc or "").upper()
    out: dict = {}
    m = _FX_ORIG_RE.search(text)
    if m:
        out["original_currency"] = m.group(1)
        out["original_amount"] = float(m.group(2).replace(",", ""))
    if not out:
        # A rate or fee is only read beside the "AMOUNT IN <CCY> <n>" marker,
        # so "COSTA RATE 2.50 PAID" or "REF 1.5 VISA 12.34" never invent one.
        return None
    m = _FX_RATE_RE.search(text)
    if m and FX_RATE_MIN <= float(m.group(1)) <= FX_RATE_MAX:
        out["rate"] = float(m.group(1))
    m = _FX_FEE_RE.search(text)
    if m:
        out["fee_gbp"] = float(m.group(1))
    return out


# ── Fuzzy merchant match ─────────────────────────────────────────────────

def _trigrams(s: str) -> set[str]:
    s = f"  {s} "
    return {s[i:i + 3] for i in range(len(s) - 2)}


def similarity(a: str | None, b: str | None) -> float:
    """0..1 closeness of two merchant names on their normalised forms: the
    better of trigram overlap (Dice) and token overlap. Order and spacing
    differences do not matter."""
    la, lb = loose_name(a), loose_name(b)
    if not la or not lb:
        return 0.0
    ta, tb = _trigrams(la), _trigrams(lb)
    dice = 2 * len(ta & tb) / (len(ta) + len(tb))
    wa, wb = set(tokens(a)), set(tokens(b))
    overlap = len(wa & wb) / max(1, min(len(wa), len(wb))) if wa and wb else 0.0
    return max(dice, overlap)


FUZZY_THRESHOLD = 0.5
FUZZY_MIN_NEEDLE = 3  # characters after normalisation; "ab" never fuzzy-matches


def best_fuzzy(needle: str | None, candidates: list[str]) -> tuple[str, float] | None:
    """The single closest candidate at or above the threshold, else None."""
    best: tuple[str, float] | None = None
    if len(loose_name(needle)) < FUZZY_MIN_NEEDLE:
        return None
    for c in candidates:
        if not c:
            continue
        score = similarity(needle, c)
        if score >= FUZZY_THRESHOLD and (best is None or score > best[1]):
            best = (c, score)
    return best
