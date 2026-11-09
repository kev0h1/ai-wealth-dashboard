"""G443: bank facts that rule a pair OUT as an own-account transfer, before any
model is asked and before the review asks the user.

ENGINE.md ladder, tier 1 (deterministic). Same amount, opposite direction and a
few days apart is only a candidate; these facts say a leg is not one:

* a CARD PURCHASE: a debit on a credit card account (a repayment is a credit on
  the card, never a debit), a debit whose narrative carries a bank's card
  purchase marker as a whole token (Barclays prints "RENEWAL ON 23 AUG CPM"), or
  a bank code that marks card spend;
* a debit to a BUSINESS: the bank named a merchant, or the machine category is
  a spending kind (declared in `categories.BUILTIN_CATEGORY_KINDS`, never a
  literal list here). Standing orders and funds transfers (STO, FT) and a debit
  carrying counterparty account details are never read as business by these two
  tests, because those are the rails own transfers use;
* a credit that names a THIRD institution: "Sent from Revolut" on a credit
  between a NatWest debit and a Barclays credit. Only a name that is neither
  leg's bank prunes. A credit naming its own (receiving) bank, or the sending
  bank, or no institution at all, is never pruned.

The user's own answers always win: a user link or a custom category on either
leg means the pair is never pruned here. Pure functions, no I/O, narratives are
inspected and never stored or logged.

The marker and institution tables live HERE and nowhere else.
"""
from __future__ import annotations

import re

from app.services.categories import BUILTIN_CATEGORY_KINDS, COMMITMENT, DISCRETIONARY

# A bank's card-purchase marker, matched as a WHOLE token of a debit's narrative.
# CPM: Barclays card payment (merchant). CLP: contactless. BCC: international
# card. CNP: card not present. The same codes are channel noise in
# categorisation._CHANNEL_CODES; this is the subset that means "a card paid a
# merchant".
CARD_PURCHASE_TOKENS = frozenset({"CPM", "CLP", "BCC", "CNP"})
# Whole phrases (after upper-casing and collapsing punctuation to spaces).
CARD_PURCHASE_PHRASES = ("CARD PURCHASE", "CARD PAYMENT TO")
# `bank_code` values that mark card spend (docs/ops/FINEXER_TRANSACTIONS.md: "POS
# or DEB for card spend"; CPM when a bank sends the narrative code as the code).
CARD_PURCHASE_BANK_CODES = frozenset({"POS", "DEB", "CPM", "CLP", "BCC", "CNP"})
# Rails an own transfer travels. A row on one of these is never a business by
# the merchant or category tests below.
TRANSFER_RAILS = frozenset({"STO", "FT"})

# Institution table: key -> printed forms. A credit names an institution when one
# form appears as a whole word; an account belongs to one when its provider or
# display name contains the form. Common words (Wise, Atom) are left out on
# purpose: a false "different institution" would hide a real transfer.
INSTITUTIONS: dict[str, tuple[str, ...]] = {
    "natwest": (r"nat\s*west", r"rbs", r"royal\s+bank\s+of\s+scotland", r"ulster\s+bank"),
    "barclays": (r"barclays", r"barclaycard", r"b/card"),
    "hsbc": (r"hsbc",),
    "lloyds": (r"lloyds",),
    "halifax": (r"halifax",),
    "santander": (r"santander",),
    "nationwide": (r"nationwide",),
    "monzo": (r"monzo",),
    "starling": (r"starling",),
    "revolut": (r"revolut",),
    "chase": (r"chase", r"j\.?\s?p\.?\s+morgan"),
    "tsb": (r"tsb",),
    "first_direct": (r"first\s+direct",),
    "virgin_money": (r"virgin\s+money",),
    "co_operative": (r"co-?operative\s+bank",),
    "metro": (r"metro\s+bank",),
    "american_express": (r"american\s+express", r"amex"),
}
_NARRATIVE = {k: re.compile(r"(?<![a-z0-9])(?:" + "|".join(v) + r")(?![a-z0-9])", re.I) for k, v in INSTITUTIONS.items()}
_PROVIDER = {k: re.compile("|".join(v), re.I) for k, v in INSTITUTIONS.items()}

# Machine categories that read as a business. Derived from the declared kinds.
BUSINESS_CATEGORIES = frozenset(
    name for name, kind in BUILTIN_CATEGORY_KINDS.items()
    if kind in (DISCRETIONARY, COMMITMENT) and name != "Other"
)


def _text(row: dict) -> str:
    return f"{row.get('merchant_name') or ''} {row.get('description') or ''}".strip()


def _tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^A-Za-z0-9]+", text.upper()) if t]


def bank_code(row: dict) -> str:
    return str(row.get("bank_code") or "").strip().upper()


def is_card_purchase_text(text: str) -> bool:
    """A card purchase marker as a whole token or phrase of the narrative."""
    tokens = _tokens(text)
    if any(t in CARD_PURCHASE_TOKENS for t in tokens):
        return True
    joined = " " + " ".join(tokens) + " "
    return any(f" {p} " in joined for p in CARD_PURCHASE_PHRASES)


def institutions_named(text: str) -> frozenset[str]:
    """Institution keys named in a narrative, whole words only."""
    return frozenset(k for k, rx in _NARRATIVE.items() if rx.search(text or ""))


def account_institutions(account: dict | None) -> frozenset[str]:
    """Institution keys an account belongs to, from its provider (and name when the
    provider names none). Empty when unknown, which never prunes anything."""
    if not account:
        return frozenset()
    found = frozenset(k for k, rx in _PROVIDER.items() if rx.search(str(account.get("provider") or "")))
    if found:
        return found
    return frozenset(k for k, rx in _PROVIDER.items()
                     if rx.search(str(account.get("display_name") or account.get("name") or "")))


def _is_card_account(account: dict | None) -> bool:
    if not account:
        return False
    values = {str(account.get(k) or "").lower() for k in ("type", "subtype", "account_type")}
    return bool(values & {"credit_card", "credit-card", "card"})


def is_card_purchase(debit: dict, account: dict | None) -> bool:
    """A debit that is a card purchase: on a credit card account, a card purchase
    marker in its narrative, or a bank code that marks card spend."""
    if _is_card_account(account):
        return True
    if bank_code(debit) in CARD_PURCHASE_BANK_CODES:
        return True
    return is_card_purchase_text(_text(debit))


def is_business_debit(debit: dict) -> bool:
    """A debit to a business: the bank named a merchant, or the machine category
    is a spending kind. Never on a transfer rail, never with counterparty account
    details, never when the user chose the category."""
    if debit.get("custom_category"):
        return False
    if bank_code(debit) in TRANSFER_RAILS or debit.get("party_sort_code") or debit.get("party_number"):
        return False
    if str(debit.get("merchant_name") or "").strip():
        return True
    return str(debit.get("category") or "") in BUSINESS_CATEGORIES


def names_third_institution(credit: dict, credit_account: dict | None, debit_account: dict | None) -> bool:
    """The credit's own narrative names an institution that is neither leg's bank.
    False when nothing is named, when the debit's bank is unknown, or when the
    name is the sending or the receiving bank."""
    named = institutions_named(_text(credit))
    if not named:
        return False
    debit_banks = account_institutions(debit_account)
    if not debit_banks:
        return False
    return not (named & (debit_banks | account_institutions(credit_account)))


def _user_answered(*legs: dict) -> bool:
    return any(x.get("linked_offline_account_id") or x.get("linked_goal_id") or x.get("custom_category") for x in legs)


def pair_pruned_reason(credit: dict, debit: dict, accounts: dict | None) -> str | None:
    """Why this pair is ruled out as an own transfer by bank facts, or None.
    `accounts` maps account id to an account-like dict (provider, name, type)."""
    if _user_answered(credit, debit):
        return None
    accounts = accounts or {}
    debit_account = accounts.get(debit.get("account_id"))
    credit_account = accounts.get(credit.get("account_id"))
    if is_card_purchase(debit, debit_account):
        return "card_purchase"
    if is_business_debit(debit):
        return "business"
    if names_third_institution(credit, credit_account, debit_account):
        return "third_institution"
    return None
