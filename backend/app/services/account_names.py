"""The ONE account display-name function (G282, Kevin 2026-10-17).

Python twin of frontend/lib/accountName.ts. Both are tested against the same
table, shared/account-name-cases.json, so the API, the web app and the mobile
app show an account's name identically.

Rules:
  * a name that mixes upper and lower case is the user's or the bank's own
    choice and is never altered ("Premier Current Account", "Kevin's Pot");
  * a wholly upper-case (or wholly lower-case) name is title-cased, with small
    words ("and", "of") kept lower case after the first word;
  * brands and acronyms keep their own casing (HSBC, ISA, GBP, NatWest, AJ, S&P);
  * a run of two or more single-letter initials stays upper case ("Maingi K M");
  * tokens containing digits are left alone.
"""
from __future__ import annotations

import re

_BRAND_LIST = [
    "NatWest", "HSBC", "TSB", "RBS", "Amex", "ISA", "LISA", "JISA", "SIPP", "ETF", "FTSE", "GIA", "PAYE",
    "GBP", "USD", "EUR", "UK", "NS&I", "S&P", "M&S", "ATM", "FX", "PEP", "NW", "AJ", "BOS", "AIB", "JLP", "PCA", "PLC", "MBNA", "PayPal",
    "Lloyds", "Barclays", "Barclaycard", "Halifax", "Santander", "Nationwide", "Monzo", "Starling", "Revolut", "Vanguard",
]
_BRANDS = {b.upper(): b for b in _BRAND_LIST}
_SMALL_WORDS = {"and", "of", "the", "for", "to", "in", "on", "at", "or", "an", "with", "by", "from"}
_TRIM = re.compile(r"^[^A-Za-z0-9&]+|[^A-Za-z0-9&]+$")
_AMP_INITIALISM = re.compile(r"^[A-Za-z]+(?:&[A-Za-z]+)+$")


def _core(word: str) -> str:
    return _TRIM.sub("", word)


def _is_initial(word: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z]", _core(word)))


_JOINERS = {"op", "and", "in", "on", "operative"}


def _cap_word(word: str) -> str:
    low = word.lower()
    return low[:1].upper() + low[1:]


def _cap(part: str) -> str:
    """Capitalise after an apostrophe only for a leading single letter O, D or L
    (O'Brien, D'Arcy, L'Oreal); "Kevin's" keeps its lower-case s."""
    i = part.find("'")
    if i < 0:
        return _cap_word(part)
    head, tail = part[:i], part[i + 1:]
    if re.fullmatch(r"[odlODL]", head) and tail:
        return head.upper() + "'" + _cap_word(tail)
    return _cap_word(head) + "'" + tail.lower()


def display_account_name(raw: str | None) -> str:
    name = (raw or "").strip()
    letters = re.sub(r"[^A-Za-z]", "", name)
    if len(letters) < 2:
        return name
    if letters != letters.upper() and letters != letters.lower():
        return name
    tokens = re.split(r"(\s+)", name)
    words = [t for t in tokens if t and not t.isspace()]
    in_run = []
    for i, w in enumerate(words):
        prev_i = _is_initial(words[i - 1]) if i > 0 else False
        next_i = _is_initial(words[i + 1]) if i + 1 < len(words) else False
        in_run.append(_is_initial(w) and (prev_i or next_i))
    out = []
    wi = -1
    for t in tokens:
        if not t or t.isspace():
            out.append(t)
            continue
        wi += 1
        if re.search(r"\d", t):
            out.append(t)
            continue
        core = _core(t)
        brand = _BRANDS.get(core.upper())
        if brand:
            out.append(t.replace(core, brand, 1))
        elif in_run[wi] or _AMP_INITIALISM.match(core):
            out.append(t.upper())
        elif wi > 0 and core.lower() in _SMALL_WORDS:
            out.append(t.lower())
        else:
            parts = []
            for pi, part in enumerate(t.split("-")):
                lead = re.match(r"^[^A-Za-z]*", part).group(0)
                rest = part[len(lead):]
                if pi > 0 and rest.lower() in _JOINERS:
                    parts.append(lead + rest.lower())
                else:
                    parts.append(lead + _cap(rest))
            out.append("-".join(parts))
    return "".join(out)
