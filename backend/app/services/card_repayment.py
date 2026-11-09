"""G381: the ONE card repayment module.

Every way a payment to a credit card is recognised lives here, with one
decision order, so no second path can drift:

  both legs visible (`card_repayment_issuer`, called by the own-account pair builder):
    1. G403 route 1: a 12+ digit fragment ends in the card's stored last four.
    2. G403 route 2: the card credit carries its own tail and the debit names the issuer.
    3. G403 route 3 / A194: the debit names an issuer the user holds exactly one
       card with, and the credit has payment wording or the debit is a bank-coded
       direct debit, with no competing debit or credit of the amount.
    4. G443: the same-bank narrow rule (card's own wording, tail read from its name,
       sibling tails ruled out).
    5. G381: the card credit carries payment-received wording, ONE non-card debit
       of the amount sits in the window (no competitor), and the debit names no
       other issuer. The card account type and the amount are the evidence.
  only the current account leg visible (`debit_only_repayment`, used by the re-match):
    6. G381: the debit is only an issuer's name (plus filler such as a direct debit
       marker) and the user holds a card from that issuer; loans and two cards
       from one issuer with no tail are never filed.

Ambiguity is always no match. A user's own category always wins (callers skip
any row with a custom category). Narratives are inspected in memory, never
stored or logged.
"""
from __future__ import annotations

import re
from datetime import datetime

from app.services.card_issuers import CARD_ISSUERS
from app.services.card_names import last_four

CARD_REPAY_DAYS = 3
DIRECT_DEBIT_CODE = "DD"

def bank_code_of(row: dict | None) -> str | None:
    code = str((row or {}).get("bank_code") or "").strip().upper()
    return code or None


def is_direct_debit(row: dict | None) -> bool:
    return bank_code_of(row) == DIRECT_DEBIT_CODE


# G403: the issuer table lives in card_issuers (shared with categorisation).
_ISSUER_PRINTED = {
    key: re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(spec["printed"]) + r")(?![A-Za-z0-9])", re.I)
    for key, spec in CARD_ISSUERS.items()
}
# Card-side wording of a payment credit on the card's own statement.
_CARD_PAYMENT_WORDING = re.compile(
    r"payment\s+received|payment\s+by\s+direct\s+debit|direct\s+debit\s+payment|thank\s+you", re.I,
)
_PAN_FRAGMENT = re.compile(r"(?<!\d)\d{4,}(?:[- ]\d{4,}){0,4}(?!\d)")


def _provider_code(account: dict) -> str:
    code = re.sub(r"[^a-z0-9]", "", str(account.get("provider") or "").lower())
    return code[:-2] if code.endswith("uk") and len(code) > 4 else code


def card_issuer_key(account: dict | None) -> str | None:
    """Issuer table key for a CREDIT CARD account, from its provider code."""
    if not account or refine_transfer_target(account) != "Debt":
        return None
    code = _provider_code(account)
    if not code:
        return None
    for key, spec in CARD_ISSUERS.items():
        if any(code.startswith(c) for c in spec["codes"]):
            return key
    return None


def _names_issuer(text: str, issuer: str) -> bool:
    return bool(_ISSUER_PRINTED[issuer].search(text))


def _card_tail(account: dict) -> str | None:
    tail = last_four(account.get("account_number"))
    return tail if tail and tail.isdigit() else None


def _pan_fragments(text: str) -> list[str]:
    """Digit runs of 12 to 19 digits with hyphen or space separators removed."""
    out = []
    for match in _PAN_FRAGMENT.finditer(text):
        digits = re.sub(r"\D", "", match.group(0))
        if 12 <= len(digits) <= 19:
            out.append(digits)
    return out


def _fragment_matches_card(fragment: str, card: dict) -> bool:
    """Route 1 for ONE fragment against ONE card's stored number.

    A 15 digit fragment (an Amex PAN) is checked against the stored digits S
    with masks removed: with 4 digits stored it may END or START with S (Amex
    stores are sometimes the leading four); with a visible prefix and suffix
    both must match; a bare unmasked number must equal the fragment. Any other
    length keeps the suffix-only rule on the stored last four."""
    stored = str(card.get("account_number") or "")
    parts = re.findall(r"\d+", stored)
    if len(fragment) != 15:
        tail = _card_tail(card)
        return bool(tail) and fragment.endswith(tail)
    digits = "".join(parts)
    if len(digits) == 4:
        return fragment.endswith(digits) or fragment.startswith(digits)
    if len(parts) >= 2:
        return fragment.startswith(parts[0]) and fragment.endswith(parts[-1])
    if len(digits) >= 8:
        return fragment == digits
    tail = _card_tail(card)
    return bool(tail) and fragment.endswith(tail)


def card_repayment_issuer(
    credit: dict, debit: dict, accounts: dict[str, dict],
    cards_by_issuer: dict[str, list[str]], same_amount: list[dict],
) -> str | None:
    """G403 deterministic evidence route: a bank debit and a card credit of one
    amount within `CARD_REPAY_DAYS` that name the same card on file.

    Returns the issuer key when ONE of three routes identifies the card, else
    None (ambiguity is no match):
      1. a 12+ digit fragment in either narrative ends in the card's stored
         last four, and the issuer is named on either leg;
      2. the card credit carries its own four digit tail and the bank debit
         names that card's issuer;
      3. the bank debit names an issuer the user holds exactly one card with,
         the card credit has payment-received wording, and no other debit or
         credit of the amount sits within the window.
    The credit must land on a credit card and the debit must leave a non-card
    account, so a balance transfer between two cards, or to a current account,
    is never a repayment. Narratives are inspected, never stored or logged."""
    card = accounts.get(credit.get("account_id"))
    bank = accounts.get(debit.get("account_id"))
    issuer = card_issuer_key(card)
    if issuer is None or bank is None or refine_transfer_target(bank) == "Debt":
        return None
    if credit.get("account_id") == debit.get("account_id"):
        return None
    c_date, d_date = credit.get("date"), debit.get("date")
    if not isinstance(c_date, datetime) or not isinstance(d_date, datetime):
        return None
    if abs((c_date.date() - d_date.date()).days) > CARD_REPAY_DAYS:
        return None
    c_text, d_text = _text(credit), _text(debit)
    tail = _card_tail(card)
    fragments = _pan_fragments(c_text) + _pan_fragments(d_text)
    if fragments and (_names_issuer(d_text, issuer) or _names_issuer(c_text, issuer)):
        # Exactly one of the user's cards from this issuer may match a 15 digit
        # fragment (two Amex cards sharing a prefix or suffix never link).
        siblings = [accounts[i] for i in cards_by_issuer.get(issuer, []) if i in accounts]
        for frag in fragments:
            if len(frag) == 15:
                matching = [c for c in siblings if _fragment_matches_card(frag, c)]
                if len(matching) == 1 and matching[0] is card:
                    return issuer
            elif _fragment_matches_card(frag, card):
                return issuer
    if tail:
        if _names_issuer(d_text, issuer) and re.search(rf"(?<!\d){tail}(?!\d)", c_text):
            return issuer
    # A194: a bank-coded direct debit from the issuer's name stands in for the
    # card's payment-received wording (the bank itself says it is a direct
    # debit); every other route 3 condition, including uniqueness, still holds.
    if (_names_issuer(d_text, issuer) and len(cards_by_issuer.get(issuer, [])) == 1
            and (_CARD_PAYMENT_WORDING.search(c_text) or is_direct_debit(debit))):
        for other in same_amount:
            if other is credit or other is debit:
                continue
            o_date = other.get("date")
            if not isinstance(o_date, datetime) or abs((o_date.date() - c_date.date()).days) > CARD_REPAY_DAYS:
                continue
            o_card = refine_transfer_target(accounts.get(other.get("account_id")) or {}) == "Debt"
            if (other.get("transaction_type") == "debit" and not o_card) or (
                    other.get("transaction_type") == "credit" and other.get("account_id") == credit.get("account_id")):
                return None
        return issuer
    return (same_bank_card_repayment(credit, debit, accounts, cards_by_issuer, same_amount)
            or card_account_type_repayment(credit, debit, accounts, cards_by_issuer, same_amount))


def _card_tail_from_name(account: dict | None) -> str | None:
    """The four digit tail a card account carries in its own name or display name
    ("NatWest Mastercard 1432"), for a card whose number was not stored."""
    for field in ("display_name", "name"):
        match = re.search(r"(?<!\d)(\d{4})\s*$", str((account or {}).get(field) or ""))
        if match:
            return match.group(1)
    return None


def same_bank_card_repayment(
    credit: dict, debit: dict, accounts: dict[str, dict],
    cards_by_issuer: dict[str, list[str]], same_amount: list[dict],
) -> str | None:
    """G443 narrow rule (Kevin 2026-11-09), kept in this one helper so G381 can
    absorb it: a current account debit whose narrative names the same bank as a
    card on file ("NATWEST" for a NatWest Mastercard) or a named card issuer, and
    a credit on THAT card account with the card's own payment wording ("DIRECT
    DEBIT PAYMENT <tail>") for the same amount within `CARD_REPAY_DAYS`, is that
    card's repayment, filed exactly as the G403 link files it (the debit is Debt
    against the card, the credit stays Transfer).

    It adds to G403's routes the card's tail read from its name when no number was
    stored, and keeps G403's ambiguity doctrine: with more than one card from the
    issuer, the credit must print THIS card's tail, never another card's; and the
    money must be unambiguous (no second non-card debit, and no second credit from
    the issuer's cards, of the amount inside the window). The payment wording must
    be on the credit itself; a bank code alone is not enough here (A194 route 3
    keeps that case)."""
    card = accounts.get(credit.get("account_id"))
    bank = accounts.get(debit.get("account_id"))
    issuer = card_issuer_key(card)
    if issuer is None or bank is None or refine_transfer_target(bank) == "Debt":
        return None
    if credit.get("account_id") == debit.get("account_id"):
        return None
    c_date, d_date = credit.get("date"), debit.get("date")
    if not isinstance(c_date, datetime) or not isinstance(d_date, datetime):
        return None
    if abs((c_date.date() - d_date.date()).days) > CARD_REPAY_DAYS:
        return None
    c_text, d_text = _text(credit), _text(debit)
    if not _CARD_PAYMENT_WORDING.search(c_text) or not _names_issuer(d_text, issuer):
        return None
    tail = _card_tail(card) or _card_tail_from_name(card)
    siblings = cards_by_issuer.get(issuer, [])
    if len(siblings) > 1:
        if not tail or not re.search(rf"(?<!\d){tail}(?!\d)", c_text):
            return None
        for sibling_id in siblings:
            sibling = accounts.get(sibling_id)
            sib_tail = (_card_tail(sibling) or _card_tail_from_name(sibling)) if sibling else None
            if sibling is not card and sib_tail and sib_tail != tail and re.search(rf"(?<!\d){sib_tail}(?!\d)", c_text):
                return None
    for other in same_amount:
        if other is credit or other is debit:
            continue
        o_date = other.get("date")
        if not isinstance(o_date, datetime) or abs((o_date.date() - c_date.date()).days) > CARD_REPAY_DAYS:
            continue
        o_card = refine_transfer_target(accounts.get(other.get("account_id")) or {}) == "Debt"
        if (other.get("transaction_type") == "debit" and not o_card) or (
                other.get("transaction_type") == "credit" and o_card
                and issuer == card_issuer_key(accounts.get(other.get("account_id")))):
            return None
    return issuer


def _text(row: dict) -> str:
    return f"{row.get('merchant_name') or ''} {row.get('description') or ''}".strip()


def refine_transfer_target(account: dict) -> str | None:
    # Type metadata is bank/account data.  Do not infer a category from a
    # display name such as "Postcard current account".
    values = {str(account.get(k) or "").lower() for k in ("type", "subtype", "account_type")}
    if values & {"investment", "investment_account", "brokerage"}:
        return "Investment"
    if values & {"saving", "savings"}:
        return "Savings"
    if values & {"credit_card", "credit-card", "card"}:
        return "Debt"
    return None



def _competing_amount_rows(credit: dict, debit: dict, accounts: dict[str, dict], same_amount: list[dict],
                           c_date: datetime, *, any_card_credit: bool) -> bool:
    """True when another row of the same amount inside the window makes the money
    ambiguous: a second non-card debit, or a second credit on a card (this
    issuer's cards, or any card when `any_card_credit`)."""
    issuer = card_issuer_key(accounts.get(credit.get("account_id")))
    for other in same_amount:
        if other is credit or other is debit:
            continue
        o_date = other.get("date")
        if not isinstance(o_date, datetime) or abs((o_date.date() - c_date.date()).days) > CARD_REPAY_DAYS:
            continue
        o_card = refine_transfer_target(accounts.get(other.get("account_id")) or {}) == "Debt"
        if other.get("transaction_type") == "debit" and not o_card:
            return True
        if other.get("transaction_type") == "credit" and o_card and (
                any_card_credit or issuer == card_issuer_key(accounts.get(other.get("account_id")))):
            return True
    return False


def card_account_type_repayment(
    credit: dict, debit: dict, accounts: dict[str, dict],
    cards_by_issuer: dict[str, list[str]], same_amount: list[dict],
) -> str | None:
    """G381 route 5 (Kevin 2026-10-31): both legs visible. A credit on a credit
    card account with the card's own payment wording ("PAYMENT RECEIVED",
    "DIRECT DEBIT PAYMENT", "THANK YOU"), and ONE debit of the same amount
    leaving a non-card account within `CARD_REPAY_DAYS`, is that card's
    repayment even when the debit never names the issuer (the debit is Debt, the
    credit Transfer). The card account type, the amount, the direction and the
    window are the evidence; ambiguity is no match: a second non-card debit or a
    second card credit of the amount, or a debit that names a DIFFERENT issuer,
    and a direct debit must name this issuer (A194 keeps direct debits off any
    other pairing)."""
    card = accounts.get(credit.get("account_id"))
    bank = accounts.get(debit.get("account_id"))
    issuer = card_issuer_key(card)
    if issuer is None or bank is None or refine_transfer_target(bank) == "Debt":
        return None
    if credit.get("account_id") == debit.get("account_id"):
        return None
    c_date, d_date = credit.get("date"), debit.get("date")
    if not isinstance(c_date, datetime) or not isinstance(d_date, datetime):
        return None
    if abs((c_date.date() - d_date.date()).days) > CARD_REPAY_DAYS:
        return None
    c_text, d_text = _text(credit), _text(debit)
    if not _CARD_PAYMENT_WORDING.search(c_text):
        return None
    if any(_names_issuer(d_text, other) for other in CARD_ISSUERS if other != issuer):
        return None
    if is_direct_debit(debit) and not _names_issuer(d_text, issuer):
        return None
    tail = _card_tail(card) or _card_tail_from_name(card)
    if len(cards_by_issuer.get(issuer, [])) > 1 and tail and not re.search(rf"(?<!\d){tail}(?!\d)", c_text):
        return None  # two cards from one issuer: the credit must print THIS card's tail
    if _competing_amount_rows(credit, debit, accounts, same_amount, c_date, any_card_credit=True):
        return None
    return issuer


# ── Only the current account leg is visible (route 6) ───────────────────────

#: Words that may sit beside an issuer's name on a repayment narrative without
#: making it anything else. Anything else in the narrative (a branch, a product,
#: a person) means it is not just the issuer, so it is not filed.
_REPAYMENT_FILLER = frozenset({
    "direct", "debit", "dd", "ddr", "d", "payment", "pymt", "pmt", "card", "cards", "credit", "visa",
    "mastercard", "mastercar", "mc", "world", "plat", "platinum", "bacs", "faster", "fp", "bill", "ref",
    "reference", "the", "to", "from", "plc", "ltd", "limited", "bank", "uk", "gb", "gbp", "cc", "sto",
    "standing", "order", "online", "mobile", "app", "by", "on", "for", "of", "and", "no", "number", "acc",
    "account", "balance", "pay", "paid",
})
#: Words that make a narrative a different product from the issuer's card.
_NOT_A_CARD_WORDS = re.compile(
    r"\b(?:loan|loans|mortgage|fee|fees|charge|charges|interest|overdraft|insurance|isa|savings|saver|"
    r"pension|finance|student|slc|hp|lease|rent|current|account\s+fee|refund|reversal|reversed|returned|unpaid)\b",
    re.I,
)
_LOAN_ACCOUNT_VALUES = frozenset({"loan", "mortgage", "personal_loan", "car_loan", "student_loan", "hire_purchase"})
#: Bank codes that mark a card purchase or cash withdrawal, never a repayment.
_CARD_SPEND_CODES = frozenset({"POS", "DEB", "ATM", "CPT"})


def _issuer_forms_stripped(text: str, issuer: str) -> str:
    return _ISSUER_PRINTED[issuer].sub(" ", text)


def _only_issuer_and_filler(text: str, issuer: str) -> bool:
    """True when, once the issuer's printed forms are removed, only filler words,
    digits and punctuation remain (whole tokens, never substrings)."""
    rest = _issuer_forms_stripped(text, issuer)
    for token in re.split(r"[^a-z]+", rest.lower()):
        if token and token not in _REPAYMENT_FILLER:
            return False
    return True


def _holds_loan_with(issuer: str, accounts: dict[str, dict]) -> bool:
    """The user holds a loan or mortgage account whose provider is this issuer, so
    a bare issuer name on a debit could be that product's instalment."""
    spec = CARD_ISSUERS[issuer]
    for account in accounts.values():
        values = {str(account.get(k) or "").lower().replace(" ", "_") for k in ("type", "subtype", "account_type")}
        if values & _LOAN_ACCOUNT_VALUES:
            code = _provider_code(account)
            if code and any(code.startswith(c) for c in spec["codes"]):
                return True
    return False


def debit_only_repayment(
    debit: dict, accounts: dict[str, dict], cards_by_issuer: dict[str, list[str]],
) -> dict | None:
    """G381 route 6 (Kevin 2026-10-31): only the current account leg is visible.
    A debit leaving a non-card account whose narrative is ONLY a card issuer's
    name (plus filler such as a direct debit marker), where the user holds a
    card from that issuer, is that issuer's card repayment: Debt, no question.

    Returns {"issuer": key, "card_account_id": id or None} or None.
      * the user holds NO card from the issuer: never filed (it could be a loan
        or another product); the older unheld-card narrow rules in
        categorisation are untouched;
      * more than one card from the issuer: filed only when the narrative prints
        exactly one card's own four digit tail (the G403 ambiguity rule), else
        asked; with exactly one card the card account id is recorded;
      * a loan-shaped narrative (`_NOT_A_CARD_WORDS`) is never filed, and when
        the user also holds a loan or mortgage with the issuer a bare issuer
        name is asked unless the narrative carries a card-specific form
        (NW WORLD MASTERCAR, B/CARD) or a card tail;
      * a card spend or cash bank code, or a debit leaving a card, never.
    The caller skips any row with a custom category (a user answer wins)."""
    if debit.get("transaction_type") != "debit" or debit.get("is_pending"):
        return None
    bank = accounts.get(debit.get("account_id"))
    if bank is None or refine_transfer_target(bank) is not None:
        return None  # unknown account, or a card, savings or investment account
    if bank_code_of(debit) in _CARD_SPEND_CODES:
        return None
    text = _text(debit)
    if not text or _NOT_A_CARD_WORDS.search(text):
        return None
    named = [key for key in CARD_ISSUERS if _names_issuer(text, key) and _only_issuer_and_filler(text, key)]
    if len(named) != 1:
        return None
    issuer = named[0]
    held = [(i, accounts[i]) for i in cards_by_issuer.get(issuer, []) if i in accounts]
    if not held:
        return None
    printed = []
    for card_id, card in held:
        tail = _card_tail(card) or _card_tail_from_name(card)
        if tail and re.search(rf"(?<!\d){tail}(?!\d)", text):
            printed.append(card_id)
    if len(held) > 1 and len(printed) != 1:
        return None
    card_id = printed[0] if printed else (held[0][0] if len(held) == 1 else None)
    if _holds_loan_with(issuer, accounts):
        forms = CARD_ISSUERS[issuer]["card_forms"]
        specific = bool(forms) and bool(re.search(
            r"(?<![A-Za-z0-9])(?:" + "|".join(forms) + r")(?![A-Za-z0-9])", text, re.I))
        if not (specific or printed):
            return None
    return {"issuer": issuer, "card_account_id": str(card_id) if card_id is not None else None}
