"""Conservative reconciliation of booked transfers between a user's accounts.

Bank narratives often disagree across the two legs of one move.  This service
only repairs a classification when the two booked rows are a unique pair and
there is evidence beyond their amount and date.  It deliberately has no model
call and never creates a shared merchant rule: this is a private fact about a
user's own accounts.
"""
from __future__ import annotations

import logging
import re
import hashlib
import itertools
import json
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable

from app.db.collections import accounts_col, confirmed_transfer_pairs_col, own_transfer_judgements_col, preferences_col, transactions_col, user_profiles_col
from app.services.card_issuers import CARD_ISSUERS
from app.services.card_repayment import (  # noqa: F401  G381: re-exported, one module owns the rules
    CARD_REPAY_DAYS, DIRECT_DEBIT_CODE, _CARD_PAYMENT_WORDING, _ISSUER_PRINTED, _PAN_FRAGMENT, _card_tail,
    _card_tail_from_name, _fragment_matches_card, _names_issuer, _pan_fragments, _provider_code, _text,
    bank_code_of, card_issuer_key, card_repayment_issuer, is_direct_debit, refine_transfer_target,
    same_bank_card_repayment, card_account_type_repayment, debit_only_repayment,
)
from app.services.card_names import last_four
from app.services.categorisation import NUMERIC_DATE_RE, _CHANNEL_CODES, _NOT_INITIALS, _text_has_account_pair, canonical_merchant_key, name_matches_owner, own_transfer_evidence, series_key as _base_series_key, word_matches_name_token
from app.services.categories import BUILTIN_CATEGORY_KINDS, MOVEMENT, get_category_kinds
from app.core.timeutil import to_user_date
from app.services.transfer_pruning import pair_pruned_reason

OWN_TRANSFER_MATCH_VERSION = 2
# G447: bump whenever a pair rule changes (timing, pruning, verdict order, evidence), so the
# stored transfers review (transfer_review_store) is rebuilt by the worker after the deploy.
REVIEW_RULES_VERSION = 2  # G451: a whole-history Undo also covers later variable amounts.
logger = logging.getLogger(__name__)
# G443: one history window for everything that reads pairs (reconcile, the model's
# candidates). It was 90 days, which left a pair imported at the start of history
# (10 Aug, read on 9 Nov) outside both, so it was never filed and never judged,
# yet the review (which has no window) asked it. Longer than any import.
HISTORY_DAYS = 400
RECONCILE_DAYS = HISTORY_DAYS
# G443: what the review shows for a pair the model could not decide and gave no reason for.
UNCLEAR_FALLBACK_REASON = "Sorted could not decide."
PAIR_DAYS = 5
# G447 (Kevin 2026-11-09), superseding G440's 24-hour automatic and 3-day ask
# windows: between two current accounts a candidate pair must be on the SAME
# CALENDAR DAY (Europe/London, see `same_calendar_day`). The only exceptions are
# a credit card repayment (the G381 routes keep CARD_REPAY_DAYS) and a learned,
# AI-learned or user-confirmed series (a learned description pair matches on any
# date, nearest first). One function, `pair_timing_ok`, states this for the
# matcher, the model's candidates, the transfers review and Spend alike.

# A194: Finexer's bank rail code leads classification. A direct debit is never
# an own transfer (it is a card repayment only when its issuer matches a card on
# file). The transfer rails make a row a candidate, never proof: the G438/G440
# name, pair and timing rules still decide. An absent code changes nothing.
TRANSFER_RAIL_CODES = frozenset({"BP", "FP", "STO", "FT"})


def is_transfer_rail_candidate(row: dict | None) -> bool:
    """True when the bank says the row travelled a rail own transfers use. A
    candidate only: never evidence on its own."""
    return bank_code_of(row) in TRANSFER_RAIL_CODES


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


def pan_repayment_series_key(txn: dict) -> str | None:
    """G413: series key for a card-repayment-shaped debit with no G403 stamp.

    "Card-repayment-shaped" means an issuer's printed form (services/
    card_issuers.py) plus a 12+ digit PAN fragment in the narrative, e.g.
    ``AMERICAN EXPRESS 3799-111111-20001``. Without this, a provider that
    sets ``merchant_name`` to the issuer alone folds every card of that
    issuer into one series. The key is the issuer label plus the fragment's
    last five digits, so each card keeps its own series even when the G403
    link did not fire. It names no card account: attribution to a card stays
    the job of the G403 stamp and the learned-destination path. The tail is
    five digits, never a 12+ character id, so `repayment_display_name`
    cannot mistake it for a per-card account key. None when the narrative
    is not shaped like that."""
    # A credit is never a repayment leg of this shape. A row with no
    # transaction_type (a pending row, or a projection that omits it) is read
    # as a debit, the same default pending_transactions.py uses.
    if txn.get("transaction_type", "debit") != "debit":
        return None
    text = _text(txn)
    if not text:
        return None
    fragments = _pan_fragments(text)
    if not fragments:
        return None
    for issuer, spec in CARD_ISSUERS.items():
        if _names_issuer(text, issuer):
            return f"{spec['label']} {fragments[0][-5:]}"
    return None


_TAIL_KEY = re.compile(r"^(?P<label>.+) (?P<tail>\d{5})$")


def bare_issuer_label(key) -> str | None:
    """G413: the bare card-issuer label behind a PAN-tail series key.

    "American Express 20001" gives "American Express". None for any key that is
    not exactly "<issuer label from card_issuers.py> <five digits>", so a
    non-issuer key never gets a fallback."""
    match = _TAIL_KEY.match(str(key or ""))
    if not match:
        return None
    label = match.group("label")
    return label if any(spec["label"] == label for spec in CARD_ISSUERS.values()) else None


def saved_key_applies(saved, key) -> bool:
    """A user decision saved under `saved` applies to series `key`: the same key,
    or the bare issuer label this PAN-tail key used to be merged under (G413)."""
    return saved == key or (saved is not None and saved == bare_issuer_label(key))


class IssuerFallbackSet(set):
    """A saved-key set (dismissals, judge overrides) that also answers for a
    PAN-tail series whose old merged bare issuer key was saved (G413)."""

    def __contains__(self, key):
        if set.__contains__(self, key):
            return True
        bare = bare_issuer_label(key)
        return bare is not None and set.__contains__(self, bare)


class IssuerFallbackDict(dict):
    """A saved-key map (recurrence rules) with the same fallback (G413)."""

    def get(self, key, default=None):
        if dict.__contains__(self, key):
            return dict.__getitem__(self, key)
        bare = bare_issuer_label(key)
        if bare is not None and dict.__contains__(self, bare):
            return dict.__getitem__(self, bare)
        return default

    def __contains__(self, key):
        return self.get(key, None) is not None or dict.__contains__(self, key)


def series_key_forms(txn: dict) -> set[str]:
    """Every key a repayment row can be known by: the stamped per-card key, the
    PAN-tail key and the base key (G413). A match rule saved under one form
    still finds the row once another form takes over, for example when the
    G403 link stamps a payment after the rule was saved."""
    forms = {f for f in (repayment_series_key(txn), pan_repayment_series_key(txn)) if f}
    # The base key is the bare issuer for a card-shaped row, which every card
    # of that issuer shares, so it only counts when no per-card form exists.
    return forms or {f for f in (_base_series_key(txn),) if f}


def series_key(txn: dict) -> str:
    """`categorisation.series_key`, except a linked card repayment keys per
    card (G403), and an unlinked card-repayment-shaped debit keys per PAN
    tail (G413). A G403 stamp always wins, so a linked series keeps its key.
    Recurring detection and its readers import this one."""
    return repayment_series_key(txn) or pan_repayment_series_key(txn) or _base_series_key(txn)


_STRIP_ACCOUNT_WORDS = frozenset({"account", "pot", "current", "savings", "saving", "the", "my"})
_GENERIC_ACCOUNT_WORDS = _STRIP_ACCOUNT_WORDS | frozenset({
    "main", "bills", "bill", "rent", "joint", "home", "spend", "spending", "everyday", "daily",
    "personal", "business", "reserve", "emergency", "budget", "card", "credit", "debit", "fund",
    "money", "cash",
})


def _norm_words(text) -> list[str]:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).split()


def account_name_in_text(text: str, account: dict | None) -> bool:
    """G438: the text carries the name of this account or pot on file as a whole
    word phrase (generic words such as "account" or "savings" do not count on
    their own, and a name under 4 letters never matches). Pots are accounts, so
    there is no pot-specific path."""
    if not account:
        return False
    words = [w for w in _norm_words(account.get("name") or account.get("display_name")) if w not in _STRIP_ACCOUNT_WORDS]
    if all(w in _GENERIC_ACCOUNT_WORDS for w in words):
        return False  # a name made only of generic words ("Main", "Bills") is never evidence
    phrase = " ".join(words)
    if len(phrase) < 4:
        return False
    return f" {phrase} " in f" {' '.join(_norm_words(text))} "


def _compact_owner_name(text: str, name_tokens: list[str]) -> bool:
    """Recognise `Maingi KM` only when a name token and initials both appear.

    A single surname, or a lone initial, is too weak to turn somebody else's
    payment into an internal transfer.  The normal full-name matcher remains
    accepted as well.

    G440: every order of the initials is accepted ("MK", "KM", or three in any
    order), and a name token may be a bank truncation of 4+ letters ("MAIN" for
    a surname starting that way). Common words and a repeated letter are never
    initials, and a shorter truncation never matches.
    """
    if name_matches_owner(text, name_tokens):
        return True
    if len(name_tokens) < 2:
        return False
    words = [w.lower() for w in re.findall(r"[A-Za-z]+", text)]
    initials = [token[0].lower() for token in name_tokens if token]
    # Banks compress names to initials in any order. Accept any two or three
    # initials from distinct tokens, in any order, but only beside a name token.
    combos = {
        "".join(c)
        for size in (2, 3)
        for c in itertools.permutations(initials, size)
    }
    has_name = any(word_matches_name_token(word, token)
                   for word in words for token in name_tokens if len(word) >= 3)
    return has_name and any(word in combos and word not in _NOT_INITIALS and len(set(word)) > 1 for word in words)


def has_owner_transfer_reference(row: dict, name_tokens: list[str]) -> bool:
    text = _text(row)
    return bool(_TRANSFER_NARRATIVE.search(text) and _compact_owner_name(text, name_tokens))


def _is_custom_movement(row: dict, movement_categories: set[str]) -> bool:
    return row.get("custom_category") in movement_categories


def _custom_blocks_auto(row: dict, movement_categories: set[str]) -> bool:
    """Every explicit user choice wins, including an explicit income choice."""
    return row.get("custom_category") is not None and not _is_custom_movement(row, movement_categories)


def build_match_metadata(row: dict, counterpart: dict, category: str, *, confirmed: bool = False,
                         card_repayment: dict | None = None, source: str | None = None) -> dict:
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
    if source and not stamp["confirmed"]:
        stamp["source"] = source  # G442: "ai" marks a pair the model judged to be one transfer
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
        if marker.get("series_single"):
            # G443: a single leg filed from a learned series has no counterpart row
            # to check; its own source fingerprint and the user's answers decide.
            single_ok = (
                marker.get("version") == OWN_TRANSFER_MATCH_VERSION
                and marker.get("source_signature") == transfer_source_signature(original)
                and not original.get("is_pending") and original.get("custom_category") is None
            )
            if single_ok:
                if marker.get("matched_category"):
                    row["category"] = marker["matched_category"]
            else:
                previous = marker.get("previous_category")
                if original.get("custom_category") is None and previous and (
                        row.get("category") == marker.get("matched_category") or row.get("category") in movement_categories):
                    row["category"] = previous
                row.pop("own_transfer_match", None)
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


def pair_doc_id(user_id: str, ids: Iterable[str]) -> str:
    """Stable verdict document id for one candidate pair: both transaction ids."""
    return f"{user_id}::" + ":".join(sorted(str(i) for i in ids))


async def load_ai_verdicts(user_id: str, *, collection=None) -> dict[frozenset, dict]:
    """G442: the model's standing verdicts for this user, keyed by the pair's
    two transaction ids. A verdict the user undid (`user_override`) is not
    standing and is left out, so a user answer always beats the model. Never
    raises: a failed read means no verdicts, which is today's behaviour."""
    collection = own_transfer_judgements_col if collection is None else collection
    try:
        docs = await collection.find(
            {"user_id": user_id, "kind": "pair", "user_override": {"$ne": True}},
            {"ids": 1, "verdict": 1, "reason": 1, "series_sig": 1},
        ).to_list(None)
    except Exception:
        return {}
    return {frozenset(str(i) for i in d.get("ids") or ()): d for d in docs if d.get("ids")}


async def load_ai_blocked(user_id: str, verdicts: dict | None = None, *, collection=None) -> frozenset:
    """G442: what switches the G440 named-within-24-hours fallback off. The pair
    ids of every standing not_transfer or unclear verdict, the pair ids the user
    overrode, and the series signatures the user undid (the user's undo is a
    user answer: it neither falls back nor is judged again). Never raises."""
    collection = own_transfer_judgements_col if collection is None else collection
    out: set = {k for k, v in (verdicts or {}).items() if v.get("verdict") in ("not_transfer", "unclear")}
    try:
        docs = await collection.find(
            {"user_id": user_id, "$or": [{"kind": "undo"}, {"kind": "pair", "user_override": True}]},
            {"kind": 1, "ids": 1, "series_sig": 1, "history_series_sig": 1},
        ).to_list(None)
    except Exception:
        return frozenset(out)
    for d in docs:
        if d.get("kind") == "undo" and d.get("series_sig"):
            out.add(d["series_sig"])
            if d.get("history_series_sig"):
                out.add(d["history_series_sig"])
        elif d.get("ids"):
            out.add(frozenset(str(i) for i in d["ids"]))
    return frozenset(out)


async def ai_state_signature(user_id: str, *, collection=None) -> list:
    """G442: a sortable summary of every verdict and undo override for this user,
    folded into the review state's fingerprint so a new verdict rebuilds it.
    Never raises: a failed read contributes nothing."""
    collection = own_transfer_judgements_col if collection is None else collection
    try:
        docs = await collection.find(
            {"user_id": user_id, "kind": {"$in": ["pair", "undo"]}},
            {"kind": 1, "verdict": 1, "user_override": 1},
        ).to_list(None)
    except Exception:
        return []
    return sorted((str(d.get("_id")), str(d.get("verdict")), bool(d.get("user_override"))) for d in docs)


# G442: the model's own-transfer learning normalisation. A faster-payment narrative
# reads "FP 31/07/26 0630 RP46532...": the date and the hhmm time after it change
# every month. This strips the time that FOLLOWS a numeric date, for own-transfer
# pair keys only. `canonical_merchant_key` itself is unchanged, because a four
# digit token after a date can be a store number for an ordinary merchant, and
# merchant caches and manual overrides are keyed on it.
_DATE_THEN_TIME = re.compile(r"(?P<date>" + NUMERIC_DATE_RE.pattern + r")\s+(?:[01]\d|2[0-3])[0-5]\d\b")
AI_KEY_PREFIX = "ai:"


def transfer_text_key(merchant, description) -> str:
    """The normalised identity of one leg for AI-learned pairs."""
    cleaned = _DATE_THEN_TIME.sub(lambda m: m.group("date"), str(description or ""))
    return canonical_merchant_key(str(merchant or ""), cleaned)


def ai_pair_keys(credit: dict, debit: dict) -> tuple[str, str]:
    """Sorted (key, key) under the AI normaliser, as stored on an AI-learned pair."""
    return tuple(sorted((  # type: ignore[return-value]
        transfer_text_key(credit.get("merchant_name"), credit.get("description")),
        transfer_text_key(debit.get("merchant_name"), debit.get("description")))))


def _learned_pair_keys(rows: Iterable[dict]) -> set[tuple[str, str]]:
    """Learned pairs as one set. A user's pair keeps its plain keys; a pair the
    model learned (`source: "ai"`) is held under the AI prefix, so each is only
    ever compared with the normaliser it was learned with."""
    out: set[tuple[str, str]] = set()
    for row in rows:
        a, b = str(row.get("key_a") or ""), str(row.get("key_b") or "")
        if not (a and b):
            continue
        if row.get("source") == "ai":
            a, b = AI_KEY_PREFIX + a, AI_KEY_PREFIX + b
        out.add(tuple(sorted((a, b))))
    return out


def learned_match(learned: set[tuple[str, str]], credit: dict, debit: dict, cache: dict | None = None) -> bool:
    """The pair is a learned one: by the user's plain keys, or by the model's keys.
    `cache` (optional, per call site) memoises each leg's two normalised keys by
    transaction id, because a wide-date scan asks about many pairs of few rows."""
    def keys(row: dict) -> tuple[str, str]:
        rid = row.get("_id")
        if cache is not None and rid is not None and rid in cache:
            return cache[rid]
        out = (canonical_merchant_key(row.get("merchant_name") or "", row.get("description") or ""),
               AI_KEY_PREFIX + transfer_text_key(row.get("merchant_name"), row.get("description")))
        if cache is not None and rid is not None:
            cache[rid] = out
        return out
    (cp, ca), (dp, da) = keys(credit), keys(debit)
    return tuple(sorted((cp, dp))) in learned or tuple(sorted((ca, da))) in learned


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


def _is_date_only(value: datetime) -> bool:
    """True when the timestamp is exactly midnight: banks that send only a date
    arrive as 00:00:00, so the time of day carries no information."""
    return value.hour == value.minute == value.second == value.microsecond == 0


def pair_gap_days(a: datetime, b: datetime) -> int:
    """Calendar days between two legs (London calendar days)."""
    da, db = to_user_date(a), to_user_date(b)
    return abs((da - db).days)


def same_calendar_day(a, b) -> bool:
    """G447: both legs fall on the same Europe/London calendar day. Booked dates
    are stored as naive UTC. A date-only row (midnight) keeps the bank's own date
    in London in both GMT and BST; a timestamped row is converted to its London
    day, so 23:30 UTC in summer is the next London day. Anything that is not a
    datetime is never the same day."""
    if not isinstance(a, datetime) or not isinstance(b, datetime):
        return False
    return to_user_date(a) == to_user_date(b)


def pair_timing_ok(credit: dict, debit: dict, accounts: dict | None = None, learned=frozenset(),
                   keys: dict | None = None) -> bool:
    """G447 (Kevin 2026-11-09): may these two legs be a pair by DATE?

    - same London calendar day: yes (current to current);
    - either leg on a credit card account: a repayment may span CARD_REPAY_DAYS
      calendar days (the G381 routes keep their own window);
    - a learned pair (the user's, the model's, or a confirmed series): any date.
    `accounts` maps account id to an account-like dict; `learned` is the learned
    pair-key set; `keys` is an optional per-call cache for learned lookups."""
    c_date, d_date = credit.get("date"), debit.get("date")
    if not isinstance(c_date, datetime) or not isinstance(d_date, datetime):
        return False
    if same_calendar_day(c_date, d_date):
        return True
    from app.services.transfer_pruning import _is_card_account
    accounts = accounts or {}
    if (_is_card_account(accounts.get(credit.get("account_id"))) or _is_card_account(accounts.get(debit.get("account_id")))):
        if pair_gap_days(c_date, d_date) <= CARD_REPAY_DAYS:
            return True
    return bool(learned) and learned_match(learned, credit, debit, keys)


def within_ask_window(a, b) -> bool:
    """G447: the review's date test between current accounts is the same
    calendar day. Kept under this name for callers that only have two dates
    (it supersedes G440's three day window). Card repayments and learned series
    use `pair_timing_ok`."""
    return same_calendar_day(a, b)


def within_auto_window(a, b) -> bool:
    """G447: automatic filing and asking share one window now (the same calendar
    day), so G440's separate 24-hour test is the same test."""
    return same_calendar_day(a, b)


def pair_is_named(credit: dict, debit: dict, identity: dict) -> bool:
    """G440 (G438 rule 2 name test, shared by sync, Spend and the review gate):
    either leg carries the user's own name in any form (full, truncated,
    initials in any order) or an account on file, or one leg names the OTHER
    leg's account or pot on file."""
    tokens = identity.get("name_tokens") or []
    for leg in (credit, debit):
        text = _text(leg)
        if own_transfer_evidence(text, identity, own_account_id=leg.get("account_id")) is not None:
            return True
        if _compact_owner_name(text, tokens):
            return True
    names = identity.get("account_names") or {}
    return (account_name_in_text(_text(debit), {"name": names.get(str(credit.get("account_id")))})
            or account_name_in_text(_text(credit), {"name": names.get(str(debit.get("account_id")))}))


def user_set_movement(row: dict) -> bool:
    """G447: the USER chose a movement category on this leg (`custom_category`, never the
    engine's `category`). It is a user answer and outranks the model's verdicts in the
    review, Spend and reconcile."""
    cc = row.get("custom_category")
    return cc is not None and BUILTIN_CATEGORY_KINDS.get(cc) == MOVEMENT


def ai_verdict_for(identity: dict | None, credit: dict, debit: dict) -> str | None:
    """The model's standing verdict (`same_transfer`, `not_transfer`, `unclear`) on
    this exact pair of transaction ids, or None when it has not judged it or the
    user overrode it. The one lookup the review, Spend and the matcher share."""
    ai = ((identity or {}).get("ai_pairs") or {}).get(pair_ids(credit, debit))
    return ai.get("verdict") if ai else None


def pair_ids(credit: dict, debit: dict) -> frozenset:
    """The identity of one candidate pair: both stable transaction ids."""
    return frozenset((str(credit.get("_id")), str(debit.get("_id"))))


def too_generic_to_learn(key: str) -> bool:
    """A `canonical_merchant_key` must be a real merchant identity, not a bare
    rail or channel word, before it may become a learned pair (which would
    stamp Transfer on every future row sharing it). Shared by the user's
    confirm path and the G442 judge so the two can never disagree."""
    if len(key) < 6:
        return True
    return " " not in key and key.upper() in _CHANNEL_CODES


def series_signature(credit: dict, debit: dict) -> str:
    """A recurring series: the same two accounts, the same amount and the same
    normalised descriptions (dates, times and reference numbers stripped), so
    every month's occurrence shares it."""
    money = _pair_key(credit)
    material = [
        str(credit.get("account_id")), str(debit.get("account_id")),
        f"{money[0]}{money[1]}" if money else "",
        transfer_text_key(credit.get("merchant_name"), credit.get("description")),
        transfer_text_key(debit.get("merchant_name"), debit.get("description")),
    ]
    return hashlib.sha1("|".join(material).encode()).hexdigest()[:16]


def history_series_signature(credit: dict, debit: dict) -> str:
    """G451 receipt key: route and normalised text, deliberately no amount.

    This belongs beside the amount-sensitive matcher key so history and Undo
    use one byte-identical representation without changing matching rules.
    """
    material = [
        str(debit.get("_filed_source") or credit.get("_filed_source") or "transactions"),
        str(debit.get("account_id") or ""), str(credit.get("account_id") or ""),
        str(debit.get("currency") or "").upper(),
        transfer_text_key(debit.get("merchant_name"), debit.get("description")),
        transfer_text_key(credit.get("merchant_name"), credit.get("description")),
    ]
    return hashlib.sha1("|".join(material).encode()).hexdigest()[:16]


def _strong_evidence(credit: dict, debit: dict, accounts: dict[str, dict], name_tokens: list[str], learned: set[tuple[str, str]], movement_categories: set[str],
                     ai_same: frozenset = frozenset(), named_blocked: frozenset = frozenset(),
                     skip_named_auto: bool = False) -> bool:
    """Evidence strong enough to decide a pair without asking (G438, Kevin's
    rule): counterparty evidence (a), a pair where either leg names the user or
    the other account or pot on file (b), a pair the user already answered
    (learned description pair, an explicit movement choice) or a card
    repayment (checked by the caller). A pair with no name, a name with no pair
    and a bare account number are only reasons to ASK, which the transfers
    review does (`has_pair_evidence` in the analytics router)."""
    history_undone = bool(named_blocked and history_series_signature(credit, debit) in named_blocked)
    if ai_same and not history_undone and pair_ids(credit, debit) in ai_same:
        return True  # G442: the model judged this pair to be one transfer (an undone verdict is never in the set)
    c_text, d_text = _text(credit), _text(debit)
    # G438 (b), Kevin's refined rule: a matched pair (the caller has already
    # required opposite directions, equal amounts, a few days, both legs on the
    # user's accounts) where either leg carries the user's own name, or the name
    # of the OTHER leg's account or pot on file, is decided without asking. A pair
    # with no name is a question for the review instead.
    # G440 (Kevin 2026-11-08), timing superseded by G447 (Kevin 2026-11-09): a
    # name alone files the pair only on the same London calendar day, which is
    # the only day the builder offers between current accounts.
    # G442 precedence: this named-within-24-hours rule is only the FALLBACK for a
    # pair the model has not judged (or could not). A standing not_transfer or
    # unclear verdict, or the user's undo of the series, switches it off; and the
    # model's own candidate set never counts it as already decided.
    named_ok = not skip_named_auto and not (
        named_blocked and (pair_ids(credit, debit) in named_blocked or series_signature(credit, debit) in named_blocked or history_undone))
    if named_ok and within_auto_window(credit.get("date"), debit.get("date")):
        if _compact_owner_name(c_text, name_tokens) or _compact_owner_name(d_text, name_tokens):
            return True
        if (account_name_in_text(c_text, accounts.get(debit["account_id"]))
                or account_name_in_text(d_text, accounts.get(credit["account_id"]))):
            return True
    # The text of either leg carries the OTHER leg's sort code AND account
    # number together. A bare account number, or a bare sort code, is not enough.
    for text, other in ((c_text, accounts.get(debit["account_id"])), (d_text, accounts.get(credit["account_id"]))):
        key = counterparty_key((other or {}).get("sort_code"), (other or {}).get("account_number"))
        if key is not None and _text_has_account_pair(text, key[0], key[1]):
            return True
    # A183: Finexer's own counterparty fields on either leg name the other
    # leg's account (sort code and account number both equal).
    if (counterparty_matches_account(credit, accounts.get(debit["account_id"]))
            or counterparty_matches_account(debit, accounts.get(credit["account_id"]))):
        return True
    if learned_match(learned, credit, debit) and (not history_undone or _user_answered_pair(credit, debit, learned, movement_categories)):
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
    exclude_ids: set[str] | frozenset[str] = frozenset(), ai_same: frozenset = frozenset(),
    named_blocked: frozenset = frozenset(),
) -> list[tuple[dict, dict]]:
    """Return only unambiguous `(credit, debit)` pairs from plain documents."""
    return [(c, d) for c, d, _ in select_unique_pairs_detailed(
        rows, accounts, name_tokens, learned, movement_categories=movement_categories,
        exclude_ids=exclude_ids, ai_same=ai_same, named_blocked=named_blocked)]


def _user_answered_pair(credit: dict, debit: dict, learned: set[tuple[str, str]], movement_categories: set[str]) -> bool:
    """A194: the user's own answers outrank the bank code: a learned pair or an
    explicit movement category on either leg. A pair the MODEL learned is not a
    user answer (it is held under the AI prefix, so this plain lookup misses it)
    and the DD guard still applies to it."""
    c_key = canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or "")
    d_key = canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or "")
    return (tuple(sorted((c_key, d_key))) in learned
            or _is_custom_movement(credit, movement_categories) or _is_custom_movement(debit, movement_categories))


def _confirmed_pairs(
    rows: list[dict], accounts: dict[str, dict], movement_categories: set[str],
) -> tuple[list[tuple[dict, dict, str | None]], set[str]]:
    """Pairs the user explicitly confirmed (still valid), and the ids they use."""
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
    return confirmed, consumed


def identity_from_accounts(accounts: dict[str, dict], name_tokens: list[str] | None) -> dict:
    """G447: the account-derived part of `categorisation.user_identity` (name
    tokens, own account numbers and sort codes, account names and facts), built
    from account documents already in hand. The pair builder prunes with this
    when the caller has no richer identity, so the matcher, the model's
    candidates and the transfers review read the same facts and cannot drift."""
    own_ids: set[str] = set()
    own_map: dict[str, dict] = {}
    own_keys: dict[tuple[str, str], set[str]] = {}
    names: dict[str, str] = {}
    meta: dict[str, dict] = {}
    for account_id, a in accounts.items():
        aid = str(account_id)
        meta[aid] = {k: a.get(k) for k in ("provider", "name", "display_name", "type", "subtype", "account_type")}
        nm = a.get("name") or a.get("display_name")
        if nm:
            names[aid] = str(nm)
        key = counterparty_key(a.get("sort_code"), a.get("account_number"))
        if key is not None:
            own_keys.setdefault(key, set()).add(aid)
        for field in ("account_number", "sort_code"):
            digits = re.sub(r"\D", "", str(a.get(field) or ""))
            if len(digits) >= 6:
                own_ids.add(digits)
                own_map[digits] = {"account_id": account_id, "type": a.get("type"), "subtype": a.get("subtype")}
    return {"name_tokens": name_tokens or [], "own_ids": own_ids, "own_map": own_map, "own_keys": own_keys,
            "account_names": names, "account_meta": meta}


def _same_amount_pairs(
    rows: list[dict], accounts: dict[str, dict], movement_categories: set[str], *,
    consumed: set[str], exclude_ids: set[str] | frozenset[str],
    learned: set[tuple[str, str]] | frozenset = frozenset(), name_tokens: list[str] | None = None,
    identity: dict | None = None, blocks=None,
):
    """The ONE pair builder (G438/G440, reused by G442, the review since G447):
    every same-amount, opposite-direction pair on two different accounts on file
    that `pair_timing_ok` allows (G447: the same London calendar day; a card
    repayment within CARD_REPAY_DAYS; a learned pair on any date), with the card
    issuer key (G403) when the pair is a card repayment, else None. The G443
    pruning runs here. The automatic matcher, the model's candidate set and the
    transfers review all read this, so they cannot drift."""
    # `blocks(row)`: does the user's own category on this row keep it out of any pair?
    # The matcher and the model's candidates stop at every non-movement choice; the
    # review passes a narrower test (only a spending choice stops it, an income
    # choice can still be asked about, owner device-testing fix 1a).
    blocks = blocks or (lambda r: _custom_blocks_auto(r, movement_categories))
    credits = [r for r in rows if str(r.get("_id")) not in consumed and str(r.get("_id")) not in exclude_ids and not r.get("is_pending") and r.get("transaction_type") == "credit" and not blocks(r)]
    debits = [r for r in rows if str(r.get("_id")) not in consumed and str(r.get("_id")) not in exclude_ids and not r.get("is_pending") and r.get("transaction_type") == "debit" and not blocks(r)]
    debit_buckets: dict[tuple[str, Decimal], list[dict]] = {}
    for debit in debits:
        key = _pair_key(debit)
        if key is not None:
            debit_buckets.setdefault(key, []).append(debit)
    prune_identity = identity or identity_from_accounts(accounts, name_tokens)
    cards_by_issuer: dict[str, list[str]] = {}
    for account_id, account in accounts.items():
        issuer_key = card_issuer_key(account)
        if issuer_key:
            cards_by_issuer.setdefault(issuer_key, []).append(account_id)
    learned_keys: dict = {}
    amount_rows: dict[tuple[str, Decimal], list[dict]] = {}
    for row in rows:
        key = _pair_key(row)
        if key is not None and not row.get("is_pending") and row.get("transaction_type") in ("credit", "debit"):
            amount_rows.setdefault(key, []).append(row)
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
            issuer = card_repayment_issuer(credit, debit, accounts, cards_by_issuer, amount_rows.get(key, []))
            if issuer is None and not pair_timing_ok(credit, debit, accounts, learned, learned_keys):
                continue  # G447: current accounts pair on the same calendar day only (a learned pair on any date)
            if (issuer is None and pair_pruned_reason(credit, debit, accounts, prune_identity,
                                                      credit.get("category") in movement_categories) is not None
                    and not _user_answered_pair(credit, debit, learned, movement_categories)
                    and not counterparty_matches_account(debit, accounts.get(credit.get("account_id")))
                    and not counterparty_matches_account(credit, accounts.get(debit.get("account_id")))):
                continue  # G443: bank facts rule it out (a card purchase, a business, a third institution)
            yield credit, debit, issuer


def _unique_only(candidates: list[tuple[dict, dict, str | None]]) -> list[tuple[dict, dict, str | None]]:
    """Keep only pairs whose two legs appear in no other candidate pair."""
    credit_counts: dict[object, int] = {}
    debit_counts: dict[object, int] = {}
    for credit, debit, _ in candidates:
        credit_counts[credit["_id"]] = credit_counts.get(credit["_id"], 0) + 1
        debit_counts[debit["_id"]] = debit_counts.get(debit["_id"], 0) + 1
    return [(c, d, i) for c, d, i in candidates if credit_counts[c["_id"]] == debit_counts[d["_id"]] == 1]


def select_unique_pairs_detailed(
    rows: list[dict], accounts: dict[str, dict], name_tokens: list[str],
    learned: set[tuple[str, str]], *, movement_categories: set[str] | None = None,
    exclude_ids: set[str] | frozenset[str] = frozenset(), ai_same: frozenset = frozenset(),
    named_blocked: frozenset = frozenset(),
) -> list[tuple[dict, dict, str | None]]:
    """`select_unique_pairs` plus the card issuer key (G403) when the pair is a
    card repayment found by `card_repayment_issuer`, else None."""
    if movement_categories is None:
        movement_categories = {name for name, kind in BUILTIN_CATEGORY_KINDS.items() if kind == MOVEMENT}
    confirmed, consumed = _confirmed_pairs(rows, accounts, movement_categories)
    candidates: list[tuple[dict, dict, str | None]] = []
    for credit, debit, issuer in _same_amount_pairs(
            rows, accounts, movement_categories, consumed=consumed, exclude_ids=exclude_ids,
            learned=learned, name_tokens=name_tokens):
        if (is_direct_debit(credit) or is_direct_debit(debit)) and not issuer and not _user_answered_pair(
                credit, debit, learned, movement_categories):
            continue  # A194: a direct debit is never an own transfer by bank evidence
        if issuer or _strong_evidence(credit, debit, accounts, name_tokens, learned, movement_categories, ai_same, named_blocked):
            candidates.append((credit, debit, issuer))
    # G447: a learned pair matches on any date, so a monthly series offers every
    # month's credit against every month's debit. Resolve ALL learned candidates
    # (the same day first) nearest first and one to one, then let the uniqueness
    # rule judge everything else.
    keys: dict = {}
    learned_wide = [x for x in candidates if not x[2] and learned and learned_match(learned, x[0], x[1], keys)]
    wide_ids = {id(x) for x in learned_wide}
    chosen: list[tuple[dict, dict, str | None]] = []
    used: set = set()
    for credit, debit, issuer in sorted(learned_wide, key=lambda x: (abs((x[0]["date"] - x[1]["date"]).total_seconds()), str(x[0]["_id"]), str(x[1]["_id"]))):
        if credit["_id"] in used or debit["_id"] in used:
            continue
        used.update((credit["_id"], debit["_id"]))
        chosen.append((credit, debit, issuer))
    rest = [x for x in candidates if id(x) not in wide_ids and x[0]["_id"] not in used and x[1]["_id"] not in used]
    return confirmed + chosen + _unique_only(rest)


def ai_candidate_pairs(
    rows: list[dict], accounts: dict[str, dict], name_tokens: list[str],
    learned: set[tuple[str, str]], *, movement_categories: set[str] | None = None,
    exclude_ids: set[str] | frozenset[str] = frozenset(),
) -> list[tuple[dict, dict]]:
    """G442: the pairs only the model can settle. Built on the same pair builder
    as the automatic matcher, over the G447 timing rule (the same calendar day), then
    stripped of everything a rule already decides: a card repayment, a direct
    debit, a pair the user answered or learned, and any pair automatic evidence
    files (a sort code and account number or counterparty fields). The G440
    named-within-24-hours rule does not pre-empt the model: it is the fallback
    for a pair not yet judged. A leg that sits in more than one candidate is ambiguous and never
    sent (the matcher would refuse it too). Returns `(credit, debit)`."""
    if movement_categories is None:
        movement_categories = {name for name, kind in BUILTIN_CATEGORY_KINDS.items() if kind == MOVEMENT}
    _, consumed = _confirmed_pairs(rows, accounts, movement_categories)
    leftovers: list[tuple[dict, dict, str | None]] = []
    for credit, debit, issuer in _same_amount_pairs(
            rows, accounts, movement_categories, consumed=consumed, exclude_ids=exclude_ids,
            learned=learned, name_tokens=name_tokens):
        if issuer or is_direct_debit(credit) or is_direct_debit(debit):
            continue
        if _user_answered_pair(credit, debit, learned, movement_categories):
            continue
        if _strong_evidence(credit, debit, accounts, name_tokens, learned, movement_categories, skip_named_auto=True):
            continue  # G442: a named pair within 24 hours is NOT decided here; the model judges it
        leftovers.append((credit, debit, None))
    return [(c, d) for c, d, _ in _unique_only(leftovers)]


SERIES_SINGLE_MARGIN_DAYS = 3  # G443 start-of-history margin; unrelated to the G447 pair-day rule


def series_evidence(pairs: Iterable[tuple[dict, dict, dict]]) -> list[dict]:
    """G443: one evidence entry per leg of every filed own-transfer pair (a card
    repayment is not part of this): the leg's account, the other leg's account,
    its direction, amount and normalised description, and the category the series
    was filed under. `pairs` yields (credit, debit, {credit_category, debit_category})."""
    out: list[dict] = []
    for credit, debit, cats in pairs:
        for row, other, category in ((credit, debit, cats["credit"]), (debit, credit, cats["debit"])):
            pair_key = _pair_key(row)
            text_key = transfer_text_key(row.get("merchant_name"), row.get("description"))
            if pair_key is None or too_generic_to_learn(text_key):
                continue
            out.append({"account_id": row.get("account_id"), "other_account_id": other.get("account_id"),
                        "transaction_type": row.get("transaction_type"), "pair_key": pair_key,
                        "text_key": text_key, "category": category})
    return out


def series_single_legs(
    evidence: list[dict], account_rows: dict[str, list[dict]], *,
    skip_ids: set[str] | frozenset[str] = frozenset(), dismissed_rows: set[str] | frozenset[str] = frozenset(),
    dismissed_series: set[str] | frozenset[str] = frozenset(),
) -> list[tuple[dict, str]]:
    """G443 (e): a single leg whose counterpart falls BEFORE the imported history.

    The first occurrence of a monthly standing order at the start of history has
    no other leg, because the other account's import starts later. When its
    normalised description (`transfer_text_key`), account, direction and amount
    equal a series already filed (AI-learned, user-confirmed or by bank evidence),
    it is filed as that series' own transfer, no question.

    Only NEAR THE START of history: the counterpart is expected on the other
    account at about this leg's date, and that date must fall before the other
    account's earliest imported transaction plus `SERIES_SINGLE_MARGIN_DAYS`.
    A same-description leg in the MIDDLE of history, where its counterpart should
    exist, is never filed here (it stays a question), and neither is a leg that has
    a possible counterpart within the ask window (the pair rules handle that). A
    user's answers win: a custom category, a link, a dismissed row or series.
    Returns [(row, category)]."""
    earliest = {aid: min(r["date"] for r in rows if isinstance(r.get("date"), datetime))
                for aid, rows in account_rows.items()
                if any(isinstance(r.get("date"), datetime) for r in rows)}
    out: list[tuple[dict, str]] = []
    done: set[str] = set()
    for ev in evidence:
        first = earliest.get(ev["other_account_id"])
        if first is None:
            continue
        horizon = first + timedelta(days=SERIES_SINGLE_MARGIN_DAYS)
        others = account_rows.get(ev["other_account_id"], [])
        for row in account_rows.get(ev["account_id"], []):
            rid = str(row.get("_id"))
            if rid in done or rid in skip_ids or rid in dismissed_rows:
                continue
            marker = row.get("own_transfer_match")
            if marker and not (isinstance(marker, dict) and marker.get("series_single")):
                continue
            if (row.get("custom_category") is not None or row.get("is_pending") or is_direct_debit(row)
                    or row.get("linked_offline_account_id") or row.get("linked_goal_id")):
                continue
            if row.get("transaction_type") != ev["transaction_type"] or not isinstance(row.get("date"), datetime):
                continue
            if row["date"] >= horizon or _pair_key(row) != ev["pair_key"]:
                continue
            if transfer_text_key(row.get("merchant_name"), row.get("description")) != ev["text_key"]:
                continue
            if (series_key(row) + ("|credit" if row.get("transaction_type") == "credit" else "")) in dismissed_series:
                continue
            if any(o.get("transaction_type") != row.get("transaction_type") and _pair_key(o) == ev["pair_key"]
                   and not o.get("is_pending") and isinstance(o.get("date"), datetime)
                   and within_ask_window(row["date"], o["date"]) for o in others):
                continue  # a possible counterpart exists: the pair rules decide, not this one
            done.add(rid)
            out.append((row, ev["category"]))
    return out


async def _series_single_matches(
    user_id: str, transaction_collection, preference_collection, accounts: dict[str, dict],
    detailed: list[tuple[dict, dict, str | None]], skip_ids: set[str], projection: dict,
) -> list[tuple[dict, str]]:
    """G443 (e): the single legs `series_single_legs` files, found from the pairs
    this pass filed. Never raises: a failure here files nothing, which is today's
    behaviour (the leg is asked)."""
    try:
        triples = []
        for credit, debit, issuer in detailed:
            if issuer:
                continue  # a card repayment is not an own-transfer series
            credit_target = refine_transfer_target(accounts[credit["account_id"]])
            debit_target = refine_transfer_target(accounts[debit["account_id"]])
            if credit_target and not debit_target:
                cats = {"credit": "Transfer", "debit": credit_target}
            elif debit_target and not credit_target:
                cats = {"credit": debit_target, "debit": "Transfer"}
            else:
                cats = {"credit": "Transfer", "debit": "Transfer"}
            triples.append((credit, debit, cats))
        evidence = series_evidence(triples)
        if not evidence:
            return []
        prefs = await preference_collection.find_one(
            {"user_id": user_id}, {"dismissed_miscategorised": 1, "dismissed_miscategorised_series": 1}) or {}
        account_rows: dict[str, list[dict]] = {}
        for account_id in {e["account_id"] for e in evidence} | {e["other_account_id"] for e in evidence}:
            fetched = await transaction_collection.find(
                {"user_id": user_id, "account_id": account_id}, projection).to_list(None)
            currency = str((accounts.get(account_id) or {}).get("currency") or "").upper()
            account_rows[account_id] = [{**r, "currency": str(r.get("currency") or currency).upper()} for r in fetched]
        return series_single_legs(
            evidence, account_rows, skip_ids=skip_ids,
            dismissed_rows=set(str(x) for x in prefs.get("dismissed_miscategorised") or []),
            dismissed_series=set(prefs.get("dismissed_miscategorised_series") or []))
    except Exception:
        logger.exception("series single legs could not be checked for %s", user_id)
        return []


CARD_REPAYMENT_RULE_VERSION = 1


def card_repayment_rule_hits(rows: list[dict], accounts: dict[str, dict], paired_ids: set[str],
                             queued_ids) -> dict[str, dict]:
    """G381: {row id: {"issuer", "card_account_id"}} for every unpaired, unanswered
    debit that `debit_only_repayment` files as a card repayment. A user's own
    category, any own-transfer stamp, a queued review row and a row already
    selected as a pair are skipped, so a user answer always wins."""
    cards_by_issuer: dict[str, list[str]] = {}
    for account_id, account in accounts.items():
        issuer_key = card_issuer_key(account)
        if issuer_key:
            cards_by_issuer.setdefault(issuer_key, []).append(account_id)
    if not cards_by_issuer:
        return {}
    hits: dict[str, dict] = {}
    for row in rows:
        rid = str(row.get("_id"))
        if (rid in paired_ids or rid in queued_ids or row.get("custom_category") is not None
                or row.get("own_transfer_match") or row.get("transaction_type") != "debit"):
            continue
        hit = debit_only_repayment(row, accounts, cards_by_issuer)
        if hit:
            hits[rid] = hit
    return hits


async def _apply_card_repayment_rules(transaction_collection, user_id: str, rows: list[dict], hits: dict[str, dict],
                                      paired_ids: set[str] = frozenset()) -> int:
    """Write the route 6 category and marker, and unwind a marker whose row no
    longer qualifies (the user answered it, a loan appeared, the card went).
    Idempotent. Returns the number of rows changed."""
    changed = 0
    for row in rows:
        rid = str(row.get("_id"))
        prior = row.get("card_repayment_rule")
        hit = hits.get(rid)
        if hit is None:
            if prior and row.get("custom_category") is None:
                update: dict = {"$unset": {"card_repayment_rule": ""}}
                previous = prior.get("previous_category")
                if previous and rid not in paired_ids and row.get("category") == prior.get("matched_category"):
                    update["$set"] = {"category": previous}
                result = await transaction_collection.update_one(
                    {"_id": row["_id"], "user_id": user_id, "custom_category": None}, update)
                changed += 1 if getattr(result, "modified_count", 0) else 0
            continue
        marker = {
            "issuer": hit["issuer"], "card_account_id": hit["card_account_id"],
            "previous_category": (prior or {}).get("previous_category", row.get("category")),
            "matched_category": "Debt", "version": CARD_REPAYMENT_RULE_VERSION,
        }
        if prior == marker and row.get("category") == "Debt":
            continue
        result = await transaction_collection.update_one(
            {"_id": row["_id"], "user_id": user_id, "custom_category": None},
            {"$set": {"category": "Debt", "card_repayment_rule": marker}})
        changed += 1 if getattr(result, "modified_count", 0) else 0
    return changed


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
    judgement_collection=None,
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
    account_rows = await account_collection.find({"user_id": user_id}, {"name": 1, "display_name": 1, "account_number": 1, "sort_code": 1, "provider": 1, "type": 1, "subtype": 1, "account_type": 1, "currency": 1}).to_list(None)
    accounts = {row["_id"]: row for row in account_rows}
    profile = await profile_collection.find_one({"_id": user_id}, {"name_tokens": 1}) or {}
    if movement_categories is None:
        kinds = await get_category_kinds(user_id)
        movement_categories = {name for name, kind in kinds.items() if kind == MOVEMENT}
    projection = {"account_id": 1, "amount": 1, "currency": 1, "date": 1, "transaction_type": 1,
                  "merchant_name": 1, "description": 1, "category": 1, "custom_category": 1,
                  "is_pending": 1, "own_transfer_match": 1, "card_repayment_rule": 1,
                  "party_sort_code": 1, "party_number": 1, "bank_code": 1}
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
    learned_rows = await pair_collection.find({"user_id": user_id}, {"key_a": 1, "key_b": 1, "source": 1}).to_list(None)
    # G442: the model's standing same-transfer verdicts file their pairs, and a
    # pair learned from one of them stamps its later occurrences as the model's.
    ai_verdicts = {} if confirmed_only else await load_ai_verdicts(user_id, collection=judgement_collection)
    ai_same = frozenset(k for k, v in ai_verdicts.items() if v.get("verdict") == "same_transfer")
    named_blocked = frozenset() if confirmed_only else await load_ai_blocked(user_id, ai_verdicts, collection=judgement_collection)
    learned_pairs = _learned_pair_keys(learned_rows)
    ai_learned = {k for k in learned_pairs if k[0].startswith(AI_KEY_PREFIX)}
    # An unmarked confirmed_transfer_pairs record is the user's durable answer
    # (the confirm endpoint deliberately removes an old `source: ai`).  Keep
    # that provenance when it matches later occurrences, without treating any
    # ordinary deterministic evidence as a user confirmation.
    user_learned = {k for k in learned_pairs if not k[0].startswith(AI_KEY_PREFIX)}
    queued_ids = await active_separate_review_ids(
        user_id, rows, accounts, preference_collection=preference_collection, movement_categories=movement_categories,
    )
    detailed = (
        select_unique_pairs_detailed(rows, accounts, profile.get("name_tokens") or [], learned_pairs,
                                     movement_categories=movement_categories, exclude_ids=queued_ids, ai_same=ai_same, named_blocked=named_blocked)
        if len(accounts) >= 2 else []
    )
    if confirmed_only:
        detailed = [(credit, debit, issuer) for credit, debit, issuer in detailed
                    if _confirmed_pair(credit, debit, accounts, movement_categories)
                    or _confirmed_pair(debit, credit, accounts, movement_categories)]
    pairs = [(credit, debit) for credit, debit, _ in detailed]
    issuers = {(str(credit["_id"]), str(debit["_id"])): issuer for credit, debit, issuer in detailed}
    selected_ids = {str(item["_id"]) for pair in pairs for item in pair}
    # G443 (e): a single leg at the start of history whose series is already filed.
    singles = [] if (confirmed_only or len(accounts) < 2) else await _series_single_matches(
        user_id, transaction_collection, preference_collection, accounts, detailed, set(selected_ids),
        {**projection, "linked_offline_account_id": 1, "linked_goal_id": 1})
    selected_ids |= {str(row["_id"]) for row, _ in singles}
    # G381 route 6: a debit whose only visible leg is the current account side and
    # whose narrative is a card issuer the user holds a card with. Never touches a
    # row that is paired, answered by the user, or already a confirmed own move.
    rule_hits = {} if (confirmed_only or len(accounts) < 2) else card_repayment_rule_hits(
        rows, accounts, selected_ids, queued_ids)
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
        pair_keys = tuple(sorted(AI_KEY_PREFIX + k for k in ai_pair_keys(credit, debit)))
        plain_keys = tuple(sorted((
            canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or ""),
            canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or ""),
        )))
        source = "user" if not issuer and plain_keys in user_learned else (
            "ai" if (not issuer and (pair_ids(credit, debit) in ai_same or pair_keys in ai_learned)) else None
        )
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
            match = build_match_metadata(row, counterpart, category, card_repayment=link, source=source)
            result = await transaction_collection.update_one(
                {"_id": row["_id"], "user_id": user_id, "custom_category": None},
                {"$set": {"category": category, "own_transfer_match": match}},
            )
            if getattr(result, "modified_count", 0):
                changed += 1
    changed += await _apply_card_repayment_rules(transaction_collection, user_id, rows, rule_hits, selected_ids)
    for row, category in singles:
        prior = row.get("own_transfer_match") or {}
        marker = {
            "series_single": True,
            "previous_category": prior.get("previous_category", row.get("category")),
            "matched_category": category,
            "source_signature": transfer_source_signature(row),
            "confirmed": False,
            "version": OWN_TRANSFER_MATCH_VERSION,
            "source": "series",
        }
        if prior == marker and row.get("category") == category:
            continue
        result = await transaction_collection.update_one(
            {"_id": row["_id"], "user_id": user_id, "custom_category": None},
            {"$set": {"category": category, "own_transfer_match": marker}},
        )
        if getattr(result, "modified_count", 0):
            changed += 1
    if changed:
        if mark_stale_fn is None:
            from app.services.derived_caches import mark_stale
            mark_stale_fn = mark_stale
        await mark_stale_fn(user_id, reason="own_account_transfer_reconciled")
    return changed
