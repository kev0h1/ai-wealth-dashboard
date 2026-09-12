"""Account-type classification — the single source of truth for what kind of
account an account doc (TrueLayer, Finexer or Yapily row) is: credit card,
savings/ISA pot, or current (transaction) account.

Moved out of `services/card_rates.py` (H35, 2026-09-13): `is_credit_card_account`
set the precedent there before `is_savings_account`/`is_current_account` were
promoted out of `services/companion.py`'s former private helpers (G55,
2026-09-12) so the engine and `routers/accounts.py` could share one
definition. That module is about card product identity and representative-APR
lookup via Tavily, so three generic account-type classifiers ended up
somewhere nobody looking for account classification would think to look.
This module has no dependency on Tavily, `app.core.config` or `app.db.collections` —
it is pure classification over an already-fetched account dict, which is part
of why it belongs on its own.
"""


def is_credit_card_account(acc: dict) -> bool:
    """True when an account doc (TrueLayer or Finexer row in accounts_col,
    or a yapily row) is a credit card — same test as needle.py."""
    subtype = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
    atype = (acc.get("account_type") or acc.get("type") or "").lower()
    return "CREDIT" in subtype or atype in ("credit", "credit_card")


def is_savings_account(acc: dict) -> bool:
    """True when an account doc's subtype marks it a savings/ISA pot.

    Promoted out of `services/companion.py`'s former private `_is_savings`
    (G55, 2026-09-12) so `companion.py`'s `source_capacity` build and
    `routers/accounts.py`'s `cover_source_eligible` computation share the
    SAME function rather than each restating the rule and risking drift —
    `companion.py` imports this (aliased `_is_current`/`_is_savings` for its
    existing call sites) instead of defining it locally."""
    st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
    return "SAVING" in st or "ISA" in st


def is_current_account(acc: dict) -> bool:
    """True when an account doc's subtype/type marks it a current
    (transaction) account — see `is_savings_account` for why this lives
    here rather than as a private helper duplicated in `companion.py`."""
    st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
    t = (acc.get("type") or "").upper()
    return "TRANSACTION" in st or "CURRENT" in st or t == "BANK"
