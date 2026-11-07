"""G434: recognise a standing order into the user's OWN savings that sits at a
bank which does not share the savings account (so no destination can ever be
learned from a matching credit).

Engine-owned and conservative. Words alone are never enough: a series is only
recognised when its description carries savings wording AND independent
evidence that the money stays with the user, one of

  - the engine's own pair evidence (`own_transfer_match`) on the series,
  - the bank's counterparty sort code and account number naming an account on
    file (G437).

G438 (Kevin 2026-11-07): the user's own name is no longer evidence here, it is a
question for the transfers review. This whole module goes in G438 phase B.

The user outranks the engine both ways. A category the user chose on the
series (`custom_category`) that is not Savings or Investment switches the
heuristic off for it; Savings or Investment chosen by the user (the "Savings
or investments" choice on the teaching sheet) is recognised with no wording
needed. An engine-assigned category (for example Investment for a third-party
platform) never counts on its own.

No user-specific text lives here: names come from the profile and the
accounts, the wording list is generic.
"""
from __future__ import annotations

import re

from app.services.own_account_transfers import counterparty_key, resolve_own_account

# Generic savings wording, whole words only. "pot" and "saver" are weak on their
# own, which is exactly why identity evidence is also required.
_SAVINGS_WORDS = re.compile(
    r"(?<![a-z0-9])(?:regular\s+savers?|easy\s+access|savers?|savings?|l?isa|pot|vault)(?![a-z0-9])",
    re.I,
)
USER_SAVINGS_CATEGORIES = {"Savings", "Investment"}


def has_savings_words(text: str | None) -> bool:
    return bool(_SAVINGS_WORDS.search(text or ""))


def counterparty_names_own_account(row: dict, own_index: dict, source_account_id: str | None) -> bool:
    """Evidence (a): the row's counterparty sort code and account number equal
    an account on file (never the source account itself)."""
    key = counterparty_key(row.get("party_sort_code"), row.get("party_number"))
    return key is not None and resolve_own_account(own_index, key, str(source_account_id or "")) is not None


def detect_savings_elsewhere(
    series_txns: list[dict],
    *,
    name_tokens: list[str],
    account_name: str | None,
    provider: str | None = None,
    own_index: dict | None = None,
    source_account_id: str | None = None,
) -> bool:
    """Whether this recurring MOVEMENT debit series, with no learned destination,
    is a standing order into the user's own savings held elsewhere.

    `own_index` is `own_account_transfers.own_account_index(...)` over the
    accounts on file; with it, evidence (a) is read from each row's
    `party_sort_code` and `party_number`. `account_name` and `provider` are
    kept for callers but are no longer evidence."""
    if not series_txns:
        return False
    for t in series_txns:
        user_cat = t.get("custom_category")
        if user_cat and user_cat not in USER_SAVINGS_CATEGORIES:
            return False  # the user said what it is; the engine does not argue
    if any(t.get("custom_category") in USER_SAVINGS_CATEGORIES for t in series_txns):
        return True  # the user filed it as Savings or Investment (G376): their choice, no wording needed
    texts = [f"{t.get('description') or ''} {t.get('merchant_name') or ''}".strip() for t in series_txns]
    if not any(has_savings_words(x) for x in texts):
        return False
    for t, x in zip(series_txns, texts):
        if not has_savings_words(x):
            continue
        if own_index and counterparty_names_own_account(t, own_index, source_account_id):
            return True
        if t.get("own_transfer_match"):
            return True
    return False
