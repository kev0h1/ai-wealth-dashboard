"""Conservative reconciliation of booked transfers between a user's accounts.

Bank narratives often disagree across the two legs of one move.  This service
only repairs a classification when the two booked rows are a unique pair and
there is evidence beyond their amount and date.  It deliberately has no model
call and never creates a shared merchant rule: this is a private fact about a
user's own accounts.
"""
from __future__ import annotations

import re
import hashlib
import json
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable

from app.db.collections import accounts_col, confirmed_transfer_pairs_col, preferences_col, transactions_col, user_profiles_col
from app.services.card_issuers import CARD_ISSUERS
from app.services.card_names import last_four
from app.services.categorisation import canonical_merchant_key, name_matches_owner, series_key as _base_series_key
from app.services.categories import BUILTIN_CATEGORY_KINDS, MOVEMENT, get_category_kinds

OWN_TRANSFER_MATCH_VERSION = 2
RECONCILE_DAYS = 90
PAIR_DAYS = 5
CARD_REPAY_DAYS = 3

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
_TRANSFER_NARRATIVE = re.compile(
    r"\b(?:transfer|xfer|xfr|ft|sto|standing\s+order|faster\s+payment|mobile\s+(?:bank\s+)?transfer|bank\s+transfer)\b",
    re.I,
)


def normalise_sort_code(value) -> str | None:
    """Six digits, or None. Dashes and spaces are ignored; anything else that
    is not exactly six digits is treated as absent, never guessed."""
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if len(digits) == 6 else None


def normalise_account_number(value) -> str | None:
    """Eight digits, or None. An IBAN, card PAN or short value is not a UK
    account number and never matches."""
    digits = re.sub(r"\D", "", str(value or ""))
    return digits if len(digits) == 8 else None


def counterparty_key(sort_code, number) -> tuple[str, str] | None:
    """A (sort code, account number) pair only when both normalise."""
    sort, num = normalise_sort_code(sort_code), normalise_account_number(number)
    return (sort, num) if sort and num else None


def counterparty_matches_account(row: dict, account: dict | None) -> bool:
    """A183: the bank's own counterparty fields on `row` name `account`'s
    sort code and account number exactly. Deterministic, no narrative guess."""
    if not account:
        return False
    key = counterparty_key(row.get("party_sort_code"), row.get("party_number"))
    return key is not None and key == counterparty_key(account.get("sort_code"), account.get("account_number"))


def own_account_index(accounts: Iterable[dict]) -> dict[tuple[str, str], list[dict]]:
    """(sort code, account number) -> every account doc carrying that
    identification (a stale duplicate or joint twin can share one)."""
    index: dict[tuple[str, str], list[dict]] = {}
    for account in accounts:
        key = counterparty_key(account.get("sort_code"), account.get("account_number"))
        if key is not None:
            index.setdefault(key, []).append(account)
    return index


def resolve_own_account(index: dict, key: tuple[str, str], walking_account_id: str) -> dict | None:
    """The user's own account a counterparty key names, for a row on
    `walking_account_id`. None when the walking account itself carries that
    identification (a duplicate must never label its own rows as transfers).
    When several accounts share the key with different refined kinds, a plain
    Transfer is the only safe answer, so a kind-less stand-in is returned."""
    docs = index.get(key) or []
    if not docs or any(d.get("_id") == walking_account_id for d in docs):
        return None
    if len({refine_transfer_target(d) for d in docs}) > 1:
        return {"_id": docs[0].get("_id")}
    return docs[0]


async def load_own_account_index(user_id: str, *, account_collection=None) -> dict[tuple[str, str], list[dict]]:
    """Index the user's connected accounts by identification. Never raises:
    a failed read means no counterparty match, not a failed sync."""
    account_collection = accounts_col if account_collection is None else account_collection
    try:
        docs = await account_collection.find(
            {"user_id": user_id},
            {"sort_code": 1, "account_number": 1, "type": 1, "subtype": 1, "account_type": 1},
        ).to_list(None)
    except Exception:
        return {}
    return own_account_index(docs)


def counterparty_category(own_account: dict, transaction_type: str) -> str:
    """Category for ONE leg whose counterparty is the user's own account.
    The money-out leg takes the destination's refined kind (Debt for a card,
    Savings, Investment) and otherwise Transfer; the money-in leg is Transfer.
    Card-side wording beyond this belongs to G381."""
    if transaction_type == "debit":
        return refine_transfer_target(own_account) or "Transfer"
    return "Transfer"


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
    if (_names_issuer(d_text, issuer) and len(cards_by_issuer.get(issuer, [])) == 1
            and _CARD_PAYMENT_WORDING.search(c_text)):
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
    return None


def repayment_series_key(txn: dict) -> str | None:
    """Recurring series key for a linked card repayment leg: issuer plus card
    account id, never the issuer alone, so two cards from one issuer are two
    series. None when the row carries no card repayment stamp."""
    marker = txn.get("own_transfer_match") or {}
    link = marker.get("card_repayment") if isinstance(marker, dict) else None
    if not isinstance(link, dict) or link.get("issuer") not in CARD_ISSUERS or not link.get("card_account_id"):
        return None
    return f"{CARD_ISSUERS[link['issuer']]['label']} {link['card_account_id']}"


def repayment_display_name(key: str, card_name: str | None = None) -> str | None:
    """Clean label for a per-card repayment key, never the account id.

    The key stays the stable identity for dismiss, edit and skip; only
    presentation uses this. Returns None when `key` is not shaped like
    "<issuer label> <card account id>" (an id is one token of 12+ chars)."""
    for spec in CARD_ISSUERS.values():
        label = spec["label"]
        if key.startswith(label + " "):
            rest = key[len(label) + 1:]
            if rest and " " not in rest and len(rest) >= 12:
                name = (card_name or "").strip()
                if not name:
                    return label
                return name if label.lower() in name.lower() else f"{label} {name}"
    return None


def series_key(txn: dict) -> str:
    """`categorisation.series_key`, except a linked card repayment keys per
    card (G403). Recurring detection and its readers import this one."""
    return repayment_series_key(txn) or _base_series_key(txn)


def _text(row: dict) -> str:
    return f"{row.get('merchant_name') or ''} {row.get('description') or ''}".strip()


def _account_number_tokens(account: dict) -> set[str]:
    """Only account-number length identifiers count, never a shared sort code."""
    value = re.sub(r"\D", "", str(account.get("account_number") or ""))
    return {value} if len(value) >= 7 else set()


def _compact_owner_name(text: str, name_tokens: list[str]) -> bool:
    """Recognise `Maingi KM` only when both surname and two initials appear.

    A single surname, or a lone initial, is too weak to turn somebody else's
    payment into an internal transfer.  The normal full-name matcher remains
    accepted as well.
    """
    if name_matches_owner(text, name_tokens):
        return True
    if len(name_tokens) < 2:
        return False
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", text)]
    initials = "".join(token[0].lower() for token in name_tokens if token)
    # Banks commonly compress first and last names to two initials.  Accept
    # any ordered two-initial subsequence, but only beside a full owner token.
    pairs = {initials[i] + initials[j] for i in range(len(initials)) for j in range(i + 1, len(initials))}
    has_name = any(word == token or word.startswith(token) or token.startswith(word)
                   for word in words for token in name_tokens if len(word) >= 3)
    return has_name and any(word in pairs for word in words)


def has_owner_transfer_reference(row: dict, name_tokens: list[str]) -> bool:
    text = _text(row)
    return bool(_TRANSFER_NARRATIVE.search(text) and _compact_owner_name(text, name_tokens))


def _is_custom_movement(row: dict, movement_categories: set[str]) -> bool:
    return row.get("custom_category") in movement_categories


def _custom_blocks_auto(row: dict, movement_categories: set[str]) -> bool:
    """Every explicit user choice wins, including an explicit income choice."""
    return row.get("custom_category") is not None and not _is_custom_movement(row, movement_categories)


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


def build_match_metadata(row: dict, counterpart: dict, category: str, *, confirmed: bool = False,
                         card_repayment: dict | None = None) -> dict:
    """Build the durable evidence stamp for an automatic or confirmed pair.

    Callers can pass a copy with a proposed custom choice removed when an
    explicit confirmation intentionally supersedes it.  The saved signatures
    then describe the post-confirmation state on both legs.
    """
    prior = row.get("own_transfer_match") or {}
    source_signature = transfer_source_signature(row)
    counterpart_signature = transfer_source_signature(counterpart)
    preserve_confirmation = bool(
        prior.get("confirmed")
        and prior.get("version") == OWN_TRANSFER_MATCH_VERSION
        and prior.get("counterpart_id") == str(counterpart["_id"])
        and prior.get("source_signature") == source_signature
        and prior.get("counterpart_signature") == counterpart_signature
    )
    stamp = {
        "counterpart_id": str(counterpart["_id"]),
        "counterpart_account_id": counterpart["account_id"],
        "previous_category": prior.get("previous_category", row.get("category")),
        "matched_category": category,
        "source_signature": source_signature,
        "counterpart_signature": counterpart_signature,
        "confirmed": bool(confirmed or preserve_confirmation),
        "version": OWN_TRANSFER_MATCH_VERSION,
    }
    if card_repayment:
        stamp["card_repayment"] = card_repayment
    return stamp


def _signature_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def transfer_source_signature(row: dict) -> str:
    """Fingerprint bank-supplied matching facts, deliberately excluding category.

    Category is the conclusion we are allowed to refresh.  Including it would
    make a generic category reset look like new bank evidence and preserve an
    invalid conclusion forever.
    """
    source = {
        key: _signature_value(row.get(key))
        for key in ("_id", "account_id", "transaction_type", "amount", "currency", "date",
                    "merchant_name", "description", "custom_category")
    }
    return hashlib.sha256(json.dumps(source, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def separate_review_leg_matches(row: dict, snapshot: dict) -> bool:
    """Whether a saved separate-review fingerprint still names this bank row.

    Category deliberately does not participate.  It is an interpretation of
    the bank record and may have been changed by an automatic pass; only an
    explicit custom category ends the user's queued review.
    """
    date = row.get("date")
    row_date = date.isoformat() if hasattr(date, "isoformat") else date
    return (
        str(row.get("_id")) == str(snapshot.get("id"))
        and row.get("transaction_type") == snapshot.get("transaction_type")
        and row.get("account_id") == snapshot.get("account_id")
        and row.get("amount") == snapshot.get("amount")
        and str(row.get("currency") or "").upper() == str(snapshot.get("currency") or "").upper()
        and row_date == snapshot.get("date")
        and row.get("merchant_name") == snapshot.get("merchant_name")
        and row.get("description") == snapshot.get("description")
    )


def _separate_review_snapshots(raw: object) -> list[dict]:
    if isinstance(raw, dict):
        return [{"pair_key": key, **value} for key, value in raw.items() if isinstance(value, dict)]
    if isinstance(raw, list):
        return [value for value in raw if isinstance(value, dict)]
    return []


async def active_separate_review_ids(user_id: str, rows: list[dict], accounts: dict[str, dict], *, preference_collection=None, movement_categories: set[str] | None = None) -> set[str]:
    """Validated queued review IDs which automatic pairing must not touch."""
    preference_collection = preferences_col if preference_collection is None else preference_collection
    prefs = await preference_collection.find_one({"user_id": user_id}, {"separate_transfer_pair_reviews": 1}) or {}
    snapshots = _separate_review_snapshots(prefs.get("separate_transfer_pair_reviews"))
    if not snapshots:
        return set()
    if movement_categories is None:
        kinds = await get_category_kinds(user_id)
        movement_categories = {name for name, kind in kinds.items() if kind == MOVEMENT}
    by_id = {
        str(row.get("_id")): {
            **row,
            "currency": str(row.get("currency") or accounts.get(row.get("account_id"), {}).get("currency") or "").upper(),
        }
        for row in rows if row.get("_id") is not None
    }
    blocked: set[str] = set()
    for pair in snapshots:
        for leg_name in ("credit", "debit"):
            snapshot = pair.get(leg_name)
            if not isinstance(snapshot, dict):
                continue
            row = by_id.get(str(snapshot.get("id")))
            if not row or row.get("is_pending") or row.get("custom_category") is not None:
                continue
            normalised = row
            if has_valid_explicit_confirmation(normalised, by_id, accounts, movement_categories=movement_categories):
                continue
            if separate_review_leg_matches(normalised, snapshot):
                blocked.add(str(row["_id"]))
    return blocked


def resolve_transfer_evidence(
    rows: list[dict], movement_categories: set[str], *, owned_account_ids: set[str] | None = None,
) -> list[dict]:
    """Return display-safe copies after validating persisted pair evidence.

    A marker is a cache of a bank-data conclusion, never a user instruction.
    When its source or counterpart no longer matches, remove it and recover
    the remembered pre-match automatic category only when the current value
    is still the machine-applied one.  A custom category is never rewritten.
    """
    originals = {str(row.get("_id")): row for row in rows if row.get("_id") is not None}
    owned = owned_account_ids if owned_account_ids is not None else {row.get("account_id") for row in rows}
    owned_accounts = {account_id: {} for account_id in owned}
    resolved: list[dict] = []
    for original in rows:
        row = dict(original)
        marker = row.get("own_transfer_match") or {}
        if not marker:
            resolved.append(row)
            continue
        counterpart = originals.get(str(marker.get("counterpart_id")))
        valid = (
            marker.get("version") == OWN_TRANSFER_MATCH_VERSION
            and counterpart is not None
            and counterpart.get("account_id") == marker.get("counterpart_account_id")
            and (owned_account_ids is None or original.get("account_id") in owned_account_ids)
            and (owned_account_ids is None or counterpart.get("account_id") in owned_account_ids)
            and marker.get("source_signature") == transfer_source_signature(original)
            and marker.get("counterpart_signature") == transfer_source_signature(counterpart)
            and not original.get("is_pending")
            and not counterpart.get("is_pending")
            and (original.get("custom_category") is None or _is_custom_movement(original, movement_categories))
            and (counterpart.get("custom_category") is None or _is_custom_movement(counterpart, movement_categories))
        )
        if valid and marker.get("confirmed"):
            valid = _confirmed_pair(original, counterpart, owned_accounts, movement_categories)
        if valid and original.get("custom_category") is None:
            # A bank re-pull can reset either automatic leg to a generic
            # category. The recorded target is still justified by unchanged
            # source evidence, so restore it for the reader.
            target = marker.get("matched_category")
            if target:
                row["category"] = target
        elif not valid:
            if original.get("custom_category") is None:
                target = marker.get("matched_category")
                previous = marker.get("previous_category")
                if previous and (row.get("category") == target or row.get("category") in movement_categories):
                    row["category"] = previous
            row.pop("own_transfer_match", None)
        resolved.append(row)
    return resolved


def _learned_pair_keys(rows: Iterable[dict]) -> set[tuple[str, str]]:
    return {
        tuple(sorted((str(row.get("key_a") or ""), str(row.get("key_b") or ""))))
        for row in rows if row.get("key_a") and row.get("key_b")
    }


def _pennies(value) -> Decimal | None:
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None
    return amount if amount.is_finite() and amount > 0 else None


def _pair_key(row: dict) -> tuple[str, Decimal] | None:
    currency = str(row.get("currency") or "").strip().upper()
    amount = _pennies(row.get("amount"))
    return (currency, amount) if currency and amount is not None else None


def _strong_evidence(credit: dict, debit: dict, accounts: dict[str, dict], name_tokens: list[str], learned: set[tuple[str, str]], movement_categories: set[str]) -> bool:
    c_text, d_text = _text(credit), _text(debit)
    # A reference to the specific other account is strongest.  Sort codes
    # are intentionally absent from `_account_number_tokens`.
    c_other = _account_number_tokens(accounts[debit["account_id"]])
    d_other = _account_number_tokens(accounts[credit["account_id"]])
    digits_c = set(re.findall(r"\d{7,}", c_text))
    digits_d = set(re.findall(r"\d{7,}", d_text))
    if digits_c & c_other or digits_d & d_other:
        return True
    # A183: Finexer's own counterparty fields on either leg name the other
    # leg's account (sort code and account number both equal).
    if (counterparty_matches_account(credit, accounts.get(debit["account_id"]))
            or counterparty_matches_account(debit, accounts.get(credit["account_id"]))):
        return True
    # Both legs must independently identify the owner and the rail language.
    if (_TRANSFER_NARRATIVE.search(c_text) and _TRANSFER_NARRATIVE.search(d_text)
            and _compact_owner_name(c_text, name_tokens) and _compact_owner_name(d_text, name_tokens)):
        return True
    c_key = canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or "")
    d_key = canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or "")
    if tuple(sorted((c_key, d_key))) in learned:
        return True
    # An explicit movement resolution is a private user fact and can anchor
    # the counterpart, but not a coincident salary or purchase.  The other
    # leg must still look like it travelled over a transfer rail.
    if _is_custom_movement(credit, movement_categories) or _is_custom_movement(debit, movement_categories):
        other = debit if _is_custom_movement(credit, movement_categories) else credit
        return bool(_TRANSFER_NARRATIVE.search(_text(other)))
    return False


def _confirmed_pair(
    row: dict, counterpart: dict | None, accounts: dict[str, dict], movement_categories: set[str],
) -> bool:
    """Whether one explicit, pair-specific confirmation still describes reality.

    This is deliberately narrower than learned merchant rules: it only keeps
    these exact two transaction IDs together while both source fingerprints
    still match.  It cannot teach a broad description pattern.
    """
    marker = row.get("own_transfer_match") or {}
    if marker.get("version") != OWN_TRANSFER_MATCH_VERSION or not marker.get("confirmed") or counterpart is None:
        return False
    if row.get("is_pending") or counterpart.get("is_pending"):
        return False
    if row.get("account_id") not in accounts or counterpart.get("account_id") not in accounts:
        return False
    if row.get("account_id") == counterpart.get("account_id"):
        return False
    if _pair_key(row) is None or _pair_key(row) != _pair_key(counterpart):
        return False
    row_date, other_date = row.get("date"), counterpart.get("date")
    if not isinstance(row_date, datetime) or not isinstance(other_date, datetime):
        return False
    if abs((row_date.date() - other_date.date()).days) > PAIR_DAYS:
        return False
    if marker.get("counterpart_id") != str(counterpart.get("_id")):
        return False
    if marker.get("counterpart_account_id") != counterpart.get("account_id"):
        return False
    if marker.get("source_signature") != transfer_source_signature(row):
        return False
    if marker.get("counterpart_signature") != transfer_source_signature(counterpart):
        return False
    if _custom_blocks_auto(row, movement_categories) or _custom_blocks_auto(counterpart, movement_categories):
        return False
    other_marker = counterpart.get("own_transfer_match") or {}
    reciprocal = (
        other_marker.get("version") == OWN_TRANSFER_MATCH_VERSION
        and other_marker.get("confirmed")
        and other_marker.get("counterpart_id") == str(row.get("_id"))
        and other_marker.get("counterpart_account_id") == row.get("account_id")
        and other_marker.get("source_signature") == transfer_source_signature(counterpart)
        and other_marker.get("counterpart_signature") == transfer_source_signature(row)
    )
    return reciprocal or _is_custom_movement(counterpart, movement_categories)


def has_valid_explicit_confirmation(
    row: dict, rows_by_id: dict[str, dict], accounts: dict[str, dict],
    *, movement_categories: set[str] | None = None,
) -> bool:
    """True when a current explicit confirmation beats an older queue entry."""
    marker = row.get("own_transfer_match") or {}
    if not marker.get("confirmed"):
        return False
    if movement_categories is None:
        movement_categories = {name for name, kind in BUILTIN_CATEGORY_KINDS.items() if kind == MOVEMENT}
    return _confirmed_pair(
        row, rows_by_id.get(str(marker.get("counterpart_id"))), accounts, movement_categories,
    )


def select_unique_pairs(
    rows: list[dict], accounts: dict[str, dict], name_tokens: list[str],
    learned: set[tuple[str, str]], *, movement_categories: set[str] | None = None,
    exclude_ids: set[str] | frozenset[str] = frozenset(),
) -> list[tuple[dict, dict]]:
    """Return only unambiguous `(credit, debit)` pairs from plain documents."""
    return [(c, d) for c, d, _ in select_unique_pairs_detailed(
        rows, accounts, name_tokens, learned, movement_categories=movement_categories, exclude_ids=exclude_ids)]


def select_unique_pairs_detailed(
    rows: list[dict], accounts: dict[str, dict], name_tokens: list[str],
    learned: set[tuple[str, str]], *, movement_categories: set[str] | None = None,
    exclude_ids: set[str] | frozenset[str] = frozenset(),
) -> list[tuple[dict, dict, str | None]]:
    """`select_unique_pairs` plus the card issuer key (G403) when the pair is a
    card repayment found by `card_repayment_issuer`, else None."""
    if movement_categories is None:
        movement_categories = {name for name, kind in BUILTIN_CATEGORY_KINDS.items() if kind == MOVEMENT}
    by_id = {str(row.get("_id")): row for row in rows if row.get("_id") is not None}
    confirmed: list[tuple[dict, dict, str | None]] = []
    consumed: set[str] = set()
    for row in rows:
        marker = row.get("own_transfer_match") or {}
        other = by_id.get(str(marker.get("counterpart_id")))
        if not _confirmed_pair(row, other, accounts, movement_categories):
            continue
        if str(row["_id"]) in consumed or str(other["_id"]) in consumed:
            continue
        if row.get("transaction_type") == "credit" and other.get("transaction_type") == "debit":
            confirmed.append((row, other, None))
        elif row.get("transaction_type") == "debit" and other.get("transaction_type") == "credit":
            confirmed.append((other, row, None))
        else:
            continue
        consumed.update({str(row["_id"]), str(other["_id"])})
    credits = [r for r in rows if str(r.get("_id")) not in consumed and str(r.get("_id")) not in exclude_ids and not r.get("is_pending") and r.get("transaction_type") == "credit" and not _custom_blocks_auto(r, movement_categories)]
    debits = [r for r in rows if str(r.get("_id")) not in consumed and str(r.get("_id")) not in exclude_ids and not r.get("is_pending") and r.get("transaction_type") == "debit" and not _custom_blocks_auto(r, movement_categories)]
    debit_buckets: dict[tuple[str, Decimal], list[dict]] = {}
    for debit in debits:
        key = _pair_key(debit)
        if key is not None:
            debit_buckets.setdefault(key, []).append(debit)
    cards_by_issuer: dict[str, list[str]] = {}
    for account_id, account in accounts.items():
        issuer_key = card_issuer_key(account)
        if issuer_key:
            cards_by_issuer.setdefault(issuer_key, []).append(account_id)
    amount_rows: dict[tuple[str, Decimal], list[dict]] = {}
    for row in rows:
        key = _pair_key(row)
        if key is not None and not row.get("is_pending") and row.get("transaction_type") in ("credit", "debit"):
            amount_rows.setdefault(key, []).append(row)
    candidates: list[tuple[dict, dict, str | None]] = []
    for credit in credits:
        key = _pair_key(credit)
        if key is None:
            continue
        for debit in debit_buckets.get(key, []):
            if credit.get("account_id") == debit.get("account_id"):
                continue
            if credit.get("account_id") not in accounts or debit.get("account_id") not in accounts:
                continue
            c_date, d_date = credit.get("date"), debit.get("date")
            if not isinstance(c_date, datetime) or not isinstance(d_date, datetime):
                continue
            if abs((c_date.date() - d_date.date()).days) > PAIR_DAYS:
                continue
            issuer = card_repayment_issuer(credit, debit, accounts, cards_by_issuer, amount_rows.get(key, []))
            if issuer or _strong_evidence(credit, debit, accounts, name_tokens, learned, movement_categories):
                candidates.append((credit, debit, issuer))
    credit_counts: dict[object, int] = {}
    debit_counts: dict[object, int] = {}
    for credit, debit, _ in candidates:
        credit_counts[credit["_id"]] = credit_counts.get(credit["_id"], 0) + 1
        debit_counts[debit["_id"]] = debit_counts.get(debit["_id"], 0) + 1
    return confirmed + [(c, d, i) for c, d, i in candidates if credit_counts[c["_id"]] == debit_counts[d["_id"]] == 1]


async def reconcile_own_account_transfers(
    user_id: str,
    *,
    transaction_collection=None,
    account_collection=None,
    pair_collection=None,
    profile_collection=None,
    preference_collection=None,
    mark_stale_fn=None,
    movement_categories: set[str] | None = None,
    confirmed_only: bool = False,
) -> int:
    """Reclassify recent pairs and preserve explicit confirmations of any age.

    The caller may run this after every full sync.  Re-running is idempotent:
    a machine classification can be refreshed, while any later user custom
    correction stops the row being selected at all.
    """
    # Optional collections make this function usable in the sync pipeline's
    # tightly scoped tests without crossing Motor event loops. Production uses
    # the module handles, so this is dependency injection, not a second path.
    transaction_collection = transactions_col if transaction_collection is None else transaction_collection
    account_collection = accounts_col if account_collection is None else account_collection
    pair_collection = confirmed_transfer_pairs_col if pair_collection is None else pair_collection
    profile_collection = user_profiles_col if profile_collection is None else profile_collection
    preference_collection = preferences_col if preference_collection is None else preference_collection
    cutoff = datetime.utcnow() - timedelta(days=RECONCILE_DAYS)  # naive-ok: Mongo booked dates are naive UTC
    # Most non-structural calls have no confirmed pairs. Avoid extra account
    # and profile reads for that common case.
    stamped = await transaction_collection.find(
        {"user_id": user_id, "own_transfer_match": {"$exists": True, "$ne": None}},
    ).to_list(None)
    confirmed_rows = [row for row in stamped if (row.get("own_transfer_match") or {}).get("confirmed")]
    if confirmed_only and not confirmed_rows:
        return 0
    account_rows = await account_collection.find({"user_id": user_id}, {"account_number": 1, "sort_code": 1, "provider": 1, "type": 1, "subtype": 1, "account_type": 1, "currency": 1}).to_list(None)
    accounts = {row["_id"]: row for row in account_rows}
    profile = await profile_collection.find_one({"_id": user_id}, {"name_tokens": 1}) or {}
    if movement_categories is None:
        kinds = await get_category_kinds(user_id)
        movement_categories = {name for name, kind in kinds.items() if kind == MOVEMENT}
    projection = {"account_id": 1, "amount": 1, "currency": 1, "date": 1, "transaction_type": 1,
                  "merchant_name": 1, "description": 1, "category": 1, "custom_category": 1,
                  "is_pending": 1, "own_transfer_match": 1,
                  "party_sort_code": 1, "party_number": 1}
    rows = [] if confirmed_only else await transaction_collection.find(
        {"user_id": user_id, "date": {"$gte": cutoff},
         "transaction_type": {"$in": ["credit", "debit"]}}, projection,
    ).to_list(None)
    # Discovery windows must not expire a user's decision. Older automatic
    # matches remain outside this pass unless referenced by a current marker.
    by_id = {str(row["_id"]): row for row in rows}
    for row in confirmed_rows:
        by_id[str(row["_id"])] = row
    counterpart_ids = {
        (row.get("own_transfer_match") or {}).get("counterpart_id") for row in by_id.values()
    } - set(by_id) - {None}
    if counterpart_ids:
        counterparts = await transaction_collection.find(
            {"user_id": user_id, "_id": {"$in": list(counterpart_ids)}}, projection,
        ).to_list(None)
        by_id.update({str(row["_id"]): row for row in counterparts})
    rows = list(by_id.values())
    # Legacy booked rows can omit currency.  Use their owning account's known
    # currency, never a global GBP default, and only in this local candidate
    # copy so no source value is silently changed.
    rows = [{**row, "currency": str(row.get("currency") or accounts.get(row.get("account_id"), {}).get("currency") or "").upper()} for row in rows]
    learned_rows = await pair_collection.find({"user_id": user_id}, {"key_a": 1, "key_b": 1}).to_list(None)
    queued_ids = await active_separate_review_ids(
        user_id, rows, accounts, preference_collection=preference_collection, movement_categories=movement_categories,
    )
    detailed = (
        select_unique_pairs_detailed(rows, accounts, profile.get("name_tokens") or [], _learned_pair_keys(learned_rows),
                                     movement_categories=movement_categories, exclude_ids=queued_ids)
        if len(accounts) >= 2 else []
    )
    if confirmed_only:
        detailed = [(credit, debit, issuer) for credit, debit, issuer in detailed
                    if _confirmed_pair(credit, debit, accounts, movement_categories)
                    or _confirmed_pair(debit, credit, accounts, movement_categories)]
    pairs = [(credit, debit) for credit, debit, _ in detailed]
    issuers = {(str(credit["_id"]), str(debit["_id"])): issuer for credit, debit, issuer in detailed}
    selected_ids = {str(item["_id"]) for pair in pairs for item in pair}
    changed = 0
    # A row can remain after its counterpart is deleted, becomes pending, or
    # is no longer uniquely matched.  Unwind only our own automatic result;
    # a newer user category stays exactly as they set it.
    for raw in rows:
        marker = raw.get("own_transfer_match") or {}
        if not marker or str(raw.get("_id")) in selected_ids:
            continue
        update: dict = {"$unset": {"own_transfer_match": ""}}
        previous = marker.get("previous_category")
        target = marker.get("matched_category")
        if raw.get("custom_category") is None and previous and (raw.get("category") == target or raw.get("category") in movement_categories):
            update["$set"] = {"category": previous}
        result = await transaction_collection.update_one(
            {"_id": raw["_id"], "user_id": user_id, "custom_category": raw.get("custom_category")},
            update,
        )
        if getattr(result, "modified_count", 0):
            changed += 1
    for credit, debit in pairs:
        credit_target = refine_transfer_target(accounts[credit["account_id"]])
        debit_target = refine_transfer_target(accounts[debit["account_id"]])
        issuer = issuers.get((str(credit["_id"]), str(debit["_id"])))
        link = {"issuer": issuer, "card_account_id": str(credit["account_id"])} if issuer else None
        if issuer:
            # G403: the bank debit is Debt against the card, the card credit stays Transfer.
            classifications = ((credit, "Transfer", debit),
                               (debit, counterparty_category(accounts[credit["account_id"]], "debit"), credit))
        elif credit_target and not debit_target:
            classifications = ((credit, "Transfer", debit), (debit, credit_target, credit))
        elif debit_target and not credit_target:
            classifications = ((credit, debit_target, debit), (debit, "Transfer", credit))
        else:
            classifications = ((credit, "Transfer", debit), (debit, "Transfer", credit))
        for row, category, counterpart in classifications:
            if row.get("custom_category") is not None:
                continue
            match = build_match_metadata(row, counterpart, category, card_repayment=link)
            result = await transaction_collection.update_one(
                {"_id": row["_id"], "user_id": user_id, "custom_category": None},
                {"$set": {"category": category, "own_transfer_match": match}},
            )
            if getattr(result, "modified_count", 0):
                changed += 1
    if changed:
        if mark_stale_fn is None:
            from app.services.derived_caches import mark_stale
            mark_stale_fn = mark_stale
        await mark_stale_fn(user_id, reason="own_account_transfer_reconciled")
    return changed
