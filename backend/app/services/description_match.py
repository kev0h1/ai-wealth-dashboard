"""Shared exact/contains description-matching semantics.

Two rule systems match transactions off a chosen description/merchant text:
offline-account mirror rules (manual_account_rules.py) and allocation fill
rules (routers/allocations.py). Both import from here so the equals/contains
comparison can never drift apart between the two.

Two comparisons only:
- equals: one candidate field compared exactly, case-insensitive, trimmed.
- contains: the match value searched as a substring of a description +
  merchant_name haystack, case-insensitive.
"""


def normalize(value) -> str:
    return str(value or "").strip().lower()


def matches_equals(candidate, match_value) -> bool:
    """Exact match against one field, case-insensitive, trimmed. An empty
    match_value never matches (a rule with no value is inert, not a
    wildcard)."""
    val = normalize(match_value)
    if not val:
        return False
    return normalize(candidate) == val


def matches_contains(match_value, description, merchant_name) -> bool:
    """Substring match against the description + merchant_name haystack,
    case-insensitive. An empty match_value never matches."""
    val = normalize(match_value)
    if not val:
        return False
    haystack = f"{description or ''} {merchant_name or ''}".lower()
    return val in haystack
