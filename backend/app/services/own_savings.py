"""G434: recognise a standing order into the user's OWN savings that sits at a
bank which does not share the savings account (so no destination can ever be
learned from a matching credit).

Engine-owned and conservative. Words alone are never enough: a series is only
recognised when its description carries savings wording AND independent
evidence that the money stays with the user, one of

  - the user's own name tokens (from their profile, never a literal),
  - the shape "<this account's own name> to <savings name>" that banks print
    on an own-account transfer, using the SOURCE account's own name,
  - the engine's own pair evidence (`own_transfer_match`) on the series.

The user outranks the engine both ways. A category the user chose on the
series (`custom_category`) that is not Savings or Investment switches the
heuristic off for it; Savings or Investment chosen by the user (the "Savings
or investments" choice on the teaching sheet) is recognised by category alone
in `account_walk.is_savings_order`, with no wording needed.

No user-specific text lives here: names come from the profile and the
accounts, the wording list is generic.
"""
from __future__ import annotations

import re

from app.services.categorisation import name_matches_owner

# Generic savings wording, whole words only. "pot" and "saver" are weak on their
# own, which is exactly why identity evidence is also required.
_SAVINGS_WORDS = re.compile(
    r"(?<![a-z0-9])(?:regular\s+savers?|easy\s+access|savers?|savings?|l?isa|pot|vault)(?![a-z0-9])",
    re.I,
)
_NON_WORD = re.compile(r"[^a-z0-9]+")
USER_SAVINGS_CATEGORIES = {"Savings", "Investment"}


def _norm(text: str | None) -> str:
    return _NON_WORD.sub(" ", (text or "").lower()).strip()


def has_savings_words(text: str | None) -> bool:
    return bool(_SAVINGS_WORDS.search(text or ""))


def own_account_to_shape(description: str | None, account_name: str | None, provider: str | None = None) -> bool:
    """True when the description reads "<this account's own name> to ...". The
    account name is tried whole and with the bank's own name stripped from the
    front (a bank prefixes its name onto an account title the user never typed)."""
    desc = _norm(description)
    full = _norm(account_name)
    candidates = {full}
    prov = _norm(provider)
    if prov and full.startswith(prov + " "):
        candidates.add(full[len(prov) + 1:])
    for c in candidates:
        c = re.sub(r"^uk\s+", "", c)
        if len(c) >= 3 and re.search(rf"(?:^| ){re.escape(c)} to ", desc):
            return True
    return False


def detect_savings_elsewhere(
    series_txns: list[dict],
    *,
    name_tokens: list[str],
    account_name: str | None,
    provider: str | None = None,
) -> bool:
    """Whether this recurring MOVEMENT debit series, with no learned destination,
    is a standing order into the user's own savings held elsewhere."""
    if not series_txns:
        return False
    for t in series_txns:
        user_cat = t.get("custom_category")
        if user_cat and user_cat not in USER_SAVINGS_CATEGORIES:
            return False  # the user said what it is; the engine does not argue
    texts = [f"{t.get('description') or ''} {t.get('merchant_name') or ''}".strip() for t in series_txns]
    if not any(has_savings_words(x) for x in texts):
        return False
    for t, x in zip(series_txns, texts):
        if not has_savings_words(x):
            continue
        if name_matches_owner(x, name_tokens or []):
            return True
        if own_account_to_shape(x, account_name, provider):
            return True
        if t.get("own_transfer_match"):
            return True
    return False
