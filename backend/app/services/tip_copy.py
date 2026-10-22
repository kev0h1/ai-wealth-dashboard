"""G283: the copy gate for tips. Tips state facts only: what the user pays, to
whom and how often, and what comparable options are listed at, with a source
and a date. They never claim or estimate a saving, never recommend, and never
call anything the best option (Kevin, 2026-10-17; feeds A165).

G315 (Kevin, 2026-10-21) widened the list to the whole rendered card and its
"Also listed" lines: bare "switch", "deal" and "worth" are banned too. The
structural rules (regulated categories, like for like, one figure, sources,
one freshness line) live in app.services.tip_facts and run through
`tip_facts.card_violations` on every serialized card.

`find_banned` is the single banned-phrase list. Every tip output path runs
it and fails closed: a composed tip, shared finding, deal text, Penny tool
output or stored tip that matches is dropped, never edited into shape.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional

# Static failure code recorded when a composed tip is dropped by this list.
BANNED_FAILURE_CODE = "banned_phrase"

# Allowed uses stripped before matching: the category name "Savings" (capital S,
# as a label) and the account type ("savings account", "savings pot", ...).
_ALLOWED_RE = re.compile(
    r"\bSavings\b"
    r"|\bsavings\s+(?:accounts?|pots?|ISAs?|goals?|buffers?)\b",
)

_BANNED_RE = re.compile(
    r"\b(?:"
    r"save|saves|saved|saving|savings"
    r"|cut|cuts|cutting"
    r"|cheaper|cheapest"
    r"|could|should"
    r"|recommend|recommends|recommended|recommending|recommendation|recommendations"
    r"|best"
    r"|worth"
    r"|switch|switches|switched|switching"
    r"|deal|deals"
    r")\b",
    re.IGNORECASE,
)


def find_banned(text: Optional[str]) -> Optional[str]:
    """The first banned phrase in `text`, lower-cased, or None when it is clean."""
    if not text:
        return None
    m = _BANNED_RE.search(_ALLOWED_RE.sub(" ", str(text)))
    return m.group(0).lower() if m else None


def is_clean(*texts: Optional[str]) -> bool:
    return all(find_banned(t) is None for t in texts)


def first_banned(texts: Iterable[Optional[str]]) -> Optional[str]:
    for t in texts:
        hit = find_banned(t)
        if hit:
            return hit
    return None


def serialized_tip_texts(tip: dict) -> list[Optional[str]]:
    """Every user-visible string of a serialized tip, for the output-path scan."""
    return [
        tip.get("title"), tip.get("body"), tip.get("expiry_line"), tip.get("stale_note"),
        tip.get("return_reason"), tip.get("substituted_line"), tip.get("stopped_line"),
    ]
