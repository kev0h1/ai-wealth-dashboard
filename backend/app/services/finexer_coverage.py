"""A186: advisory map of what Finexer shares per bank.

Captured 2026-11-02 from finexer.com, Supported banking institutions.
Source: https://finexer.com (Supported banking institutions page).
Each value lists the account kinds the provider shares: C current,
S savings, K cards.

The map is ADVISORY. It decides whether we ask the bank for a sync and
what the account sheet says when no transactions arrive; it never drops
rows. Any transaction that does come back is stored as normal.
"""
from __future__ import annotations

from app.services.account_kinds import finexer_account_kind

COVERAGE_CAPTURED_ON = "2026-11-02"

_RAW: dict[str, str] = {
    "aib": "CSK",
    "amex": "K",
    "boi_365": "CS",
    "boi": "CS",
    "bos_personal": "CSK",
    "bos_business": "CSK",
    "bos_commercial": "CSK",
    "barclaycard_bcp": "K",
    "barclaycard_uk": "K",
    "barclays_personal": "CSK",
    "barclays_business": "CSK",
    "barclays_corporate": "CSK",
    "barclays_wealth": "CSK",
    "cap_tap": "K",
    "capital_one": "CK",
    "cater_allen": "CS",
    "chase_uk": "CSK",
    "coutts": "C",
    "coutts_cs": "C",
    "cumberland": "CS",
    "danske": "CSK",
    "danske_business": "CSK",
    "first_direct": "CSK",
    "halifax": "CSK",
    "hoares": "SK",
    "hsbc_personal": "CSK",
    "hsbc_business": "CSK",
    "hsbc_kinetic": "K",
    "hsbc_net": "CK",
    "lloyds_personal": "CSK",
    "lloyds_business": "CSK",
    "lloyds_commercial": "CSK",
    "hsbc_ms": "K",
    "mbna": "K",
    "mettle": "C",
    "monzo": "C",
    "nationwide": "CSK",
    "natwest": "CSK",
    "natwest_bankline": "CSK",
    "natwest_clearspend": "K",
    "revolut": "C",
    "rbs": "CSK",
    "rbs_bankline": "CSK",
    "rbs_clearspend": "K",
    "santander": "CSK",
    "santander_business": "CSK",
    "santander_corporate": "CSK",
    "starling": "C",
    "tesco": "C",
    "tide": "C",
    "tsb": "CSK",
    "ulster": "CSK",
    "ulster_bankline": "CSK",
    "ulster_clearspend": "K",
    "vanquis": "SK",
    "vm_08": "CSK",
    "vm_05": "CSK",
    "wise": "C",
    "zempler": "CS",
    "zopa": "CK",
}

_KIND_FOR_LETTER = {"C": "current", "S": "savings", "K": "card"}

COVERAGE: dict[str, frozenset] = {
    code: frozenset(_KIND_FOR_LETTER[ch] for ch in letters) for code, letters in _RAW.items()
}

# Banks whose current accounts are shared but whose pots or spaces are not:
# provider code -> the user-facing word for the sub-account.
_POT_PROVIDERS = {"monzo": "pot", "revolut": "vault or pocket", "starling": "space"}

_KIND_WORDS = {"current": "current account", "savings": "savings account", "card": "card"}


def supported_kinds(provider_code) -> frozenset:
    """Kinds the provider shares, or an empty set when the provider is unknown."""
    return COVERAGE.get(str(provider_code or "").strip().lower(), frozenset())


def _provider_label(provider_code: str) -> str:
    return provider_code.replace("_", " ").title()


def is_balance_only(provider_code, acc, display_name=None) -> tuple:
    """(True, reason) when this account is unlikely to share transactions.

    `acc` is the raw Finexer account object. Only decides when the provider
    is in the map and the account kind maps cleanly to current, savings or
    card; otherwise the account is treated as normal. The reason is
    user-facing and hedged and names the bank by `display_name` (the provider
    name Finexer reports) when given, else a title-cased provider code.
    """
    code = str(provider_code or "").strip().lower()
    kinds = COVERAGE.get(code)
    if kinds is None:
        return False, ""
    acc = acc or {}
    label = (str(display_name).strip() if display_name else "") or _provider_label(code)
    if code in _POT_PROVIDERS:
        ident = acc.get("identification") or {}
        if not (ident.get("sort_code") or ident.get("account_number") or ident.get("number")):
            return True, f"{label} does not share {_POT_PROVIDERS[code]} transactions through Open Banking."
    info = finexer_account_kind(acc.get("class"))
    kind = info["kind"]
    if info.get("class_unknown") or kind not in _KIND_WORDS:
        return False, ""
    if kind not in kinds:
        return True, (
            f"{label} does not appear to share {_KIND_WORDS[kind]} "
            "transactions through Open Banking."
        )
    return False, ""
