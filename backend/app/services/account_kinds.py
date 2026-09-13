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


def manual_account_class(account_type) -> str:
    """Map a manual (offline) account's stored `account_type` — the string
    `manual_accounts_col` holds, validated by `routers/manual_accounts.py`'s
    `ACCOUNT_TYPES = {"savings", "current", "credit_card"}` on every write
    path — to its class for cover-plan/API purposes: the literal "CURRENT"
    or "SAVINGS". Credit cards are NOT handled here: both callers branch on
    `account_type == "credit_card"` themselves before ever reaching this
    function (companion.py skips the doc outright when building
    `offline_accounts`; `routers/accounts.py`'s `_manual_to_account` returns
    a differently-shaped `Account` for a card), so this is only ever asked
    to resolve the current/savings pair (and the missing/unrecognised cases
    below).

    G65 (2026-09-13, reviewer major on G47): `services/companion.py` and
    `routers/accounts.py`'s `_manual_to_account` used to each restate this
    mapping locally, and for a value outside the three-value enum they
    disagreed in OPPOSITE directions — companion.py fell to "SAVINGS",
    `_manual_to_account` fell to "CURRENT" — while a comment in
    companion.py falsely claimed the two were the same mapping. Nothing
    can write an out-of-enum value today (`routers/manual_accounts.py`
    validates against `ACCOUNT_TYPES`, and `routers/savings.py` /
    `routers/transactions.py` both hardcode `"savings"`), so the disagreement
    was unreachable, but it is exactly the engine-versus-screen drift G50
    and G55 exist to close: both callers now import this ONE function
    instead of each owning a copy of the rule that can drift independently.

    Out-of-enum (including missing/`None`) choice: "SAVINGS", matching
    companion.py's prior default rather than `_manual_to_account`'s. A cover
    plan moves real money; the engine ranks current accounts before savings
    (see `services/companion.py`'s `class_specs`), so classifying an
    unrecognised value as SAVINGS means it is only ever reached, and drawn
    from, after every current account is exhausted. Classifying it as
    CURRENT risks the opposite: an account of truly unknown type being
    drawn from FIRST. A value that should never occur is safer parked at
    the back of the queue than at the front.
    """
    return "CURRENT" if account_type == "current" else "SAVINGS"
