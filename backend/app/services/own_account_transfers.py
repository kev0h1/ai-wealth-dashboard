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

from app.db.collections import accounts_col, confirmed_transfer_pairs_col, transactions_col, user_profiles_col
from app.services.categorisation import canonical_merchant_key, name_matches_owner
from app.services.categories import BUILTIN_CATEGORY_KINDS, MOVEMENT, get_category_kinds

OWN_TRANSFER_MATCH_VERSION = 2
RECONCILE_DAYS = 90
PAIR_DAYS = 5
_TRANSFER_NARRATIVE = re.compile(
    r"\b(?:transfer|xfer|xfr|ft|sto|standing\s+order|faster\s+payment|mobile\s+(?:bank\s+)?transfer|bank\s+transfer)\b",
    re.I,
)


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


def build_match_metadata(row: dict, counterpart: dict, category: str, *, confirmed: bool = False) -> dict:
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
    return {
        "counterpart_id": str(counterpart["_id"]),
        "counterpart_account_id": counterpart["account_id"],
        "previous_category": prior.get("previous_category", row.get("category")),
        "matched_category": category,
        "source_signature": source_signature,
        "counterpart_signature": counterpart_signature,
        "confirmed": bool(confirmed or preserve_confirmation),
        "version": OWN_TRANSFER_MATCH_VERSION,
    }


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


def select_unique_pairs(
    rows: list[dict], accounts: dict[str, dict], name_tokens: list[str],
    learned: set[tuple[str, str]], *, movement_categories: set[str] | None = None,
) -> list[tuple[dict, dict]]:
    """Return only unambiguous `(credit, debit)` pairs from plain documents."""
    if movement_categories is None:
        movement_categories = {name for name, kind in BUILTIN_CATEGORY_KINDS.items() if kind == MOVEMENT}
    by_id = {str(row.get("_id")): row for row in rows if row.get("_id") is not None}
    confirmed: list[tuple[dict, dict]] = []
    consumed: set[str] = set()
    for row in rows:
        marker = row.get("own_transfer_match") or {}
        other = by_id.get(str(marker.get("counterpart_id")))
        if not _confirmed_pair(row, other, accounts, movement_categories):
            continue
        if str(row["_id"]) in consumed or str(other["_id"]) in consumed:
            continue
        if row.get("transaction_type") == "credit" and other.get("transaction_type") == "debit":
            confirmed.append((row, other))
        elif row.get("transaction_type") == "debit" and other.get("transaction_type") == "credit":
            confirmed.append((other, row))
        else:
            continue
        consumed.update({str(row["_id"]), str(other["_id"])})
    credits = [r for r in rows if str(r.get("_id")) not in consumed and not r.get("is_pending") and r.get("transaction_type") == "credit" and not _custom_blocks_auto(r, movement_categories)]
    debits = [r for r in rows if str(r.get("_id")) not in consumed and not r.get("is_pending") and r.get("transaction_type") == "debit" and not _custom_blocks_auto(r, movement_categories)]
    debit_buckets: dict[tuple[str, Decimal], list[dict]] = {}
    for debit in debits:
        key = _pair_key(debit)
        if key is not None:
            debit_buckets.setdefault(key, []).append(debit)
    candidates: list[tuple[dict, dict]] = []
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
            if _strong_evidence(credit, debit, accounts, name_tokens, learned, movement_categories):
                candidates.append((credit, debit))
    credit_counts: dict[object, int] = {}
    debit_counts: dict[object, int] = {}
    for credit, debit in candidates:
        credit_counts[credit["_id"]] = credit_counts.get(credit["_id"], 0) + 1
        debit_counts[debit["_id"]] = debit_counts.get(debit["_id"], 0) + 1
    return confirmed + [(c, d) for c, d in candidates if credit_counts[c["_id"]] == debit_counts[d["_id"]] == 1]


async def reconcile_own_account_transfers(
    user_id: str,
    *,
    transaction_collection=None,
    account_collection=None,
    pair_collection=None,
    profile_collection=None,
    mark_stale_fn=None,
    movement_categories: set[str] | None = None,
) -> int:
    """Reclassify the last ninety days of certain own-account pairs.

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
    cutoff = datetime.utcnow() - timedelta(days=RECONCILE_DAYS)  # naive-ok: Mongo booked dates are naive UTC
    account_rows = await account_collection.find({"user_id": user_id}, {"account_number": 1, "type": 1, "subtype": 1, "account_type": 1, "currency": 1}).to_list(None)
    accounts = {row["_id"]: row for row in account_rows}
    profile = await profile_collection.find_one({"_id": user_id}, {"name_tokens": 1}) or {}
    if movement_categories is None:
        kinds = await get_category_kinds(user_id)
        movement_categories = {name for name, kind in kinds.items() if kind == MOVEMENT}
    rows = await transaction_collection.find(
        {"user_id": user_id, "date": {"$gte": cutoff},
         "transaction_type": {"$in": ["credit", "debit"]}},
        {"account_id": 1, "amount": 1, "currency": 1, "date": 1, "transaction_type": 1,
         "merchant_name": 1, "description": 1, "category": 1, "custom_category": 1,
         "is_pending": 1, "own_transfer_match": 1},
    ).to_list(None)
    # Legacy booked rows can omit currency.  Use their owning account's known
    # currency, never a global GBP default, and only in this local candidate
    # copy so no source value is silently changed.
    rows = [{**row, "currency": str(row.get("currency") or accounts.get(row.get("account_id"), {}).get("currency") or "").upper()} for row in rows]
    learned_rows = await pair_collection.find({"user_id": user_id}, {"key_a": 1, "key_b": 1}).to_list(None)
    pairs = (
        select_unique_pairs(rows, accounts, profile.get("name_tokens") or [], _learned_pair_keys(learned_rows), movement_categories=movement_categories)
        if len(accounts) >= 2 else []
    )
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
        if credit_target and not debit_target:
            classifications = ((credit, "Transfer", debit), (debit, credit_target, credit))
        elif debit_target and not credit_target:
            classifications = ((credit, debit_target, debit), (debit, "Transfer", credit))
        else:
            classifications = ((credit, "Transfer", debit), (debit, "Transfer", credit))
        for row, category, counterpart in classifications:
            if row.get("custom_category") is not None:
                continue
            match = build_match_metadata(row, counterpart, category)
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
