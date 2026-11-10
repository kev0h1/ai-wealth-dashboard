"""Persisted transfer receipts for the Transfers Sorted sheet (G449/G451).

Sync, edits and deployment build scopes from durable filing evidence using
Spend's period definition. Sheet reads only select a saved scope; they never
match transactions, calculate money or ask a model.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
import asyncio
import logging
from math import ceil
from urllib.parse import quote

from app.db.collections import accounts_col, confirmed_transfer_pairs_col, filed_transfer_store_col, own_transfer_judgements_col, transactions_col, yapily_transactions_col
from app.services.categories import MOVEMENT, get_category_kinds
from app.services.account_names import display_account_name
from app.services.own_account_transfers import resolve_transfer_evidence, series_signature, history_series_signature
from app.services.categorisation import canonical_merchant_key
from app.services.spend_verdict import _load_period_txns, bucket_transactions
from app.services.spending import MOVED, classify_flow
from app.services.filed_transfer_undo import filing_actor, reversible_pair

logger = logging.getLogger(__name__)

_PROJECTION = {"account_id": 1, "amount": 1, "currency": 1, "date": 1,
               "transaction_type": 1, "merchant_name": 1, "description": 1,
               "category": 1, "custom_category": 1, "is_pending": 1,
               "own_transfer_match": 1, "bank_code": 1, "party_name": 1,
               "party_sort_code": 1, "party_number": 1, "reference": 1}


def _iso(value) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def _date_in_scope(row: dict, start: date | None, end: date | None) -> bool:
    value = row.get("date")
    value = value.date() if isinstance(value, datetime) else value
    return isinstance(value, date) and (start is None or value >= start) and (end is None or value <= end)


def _money(row: dict) -> float:
    try:
        return abs(float(row.get("amount") or 0))
    except (TypeError, ValueError):
        return 0.0


def _movement_identity(row: dict) -> tuple:
    """Join Spend evidence back to source rows without assuming global ids.

    Spend normalises both providers into one list. Its account, date, amount
    and effective category keep differently shaped duplicate ids distinct;
    identical records in both feeds remain two contributions, as in Spend.
    """
    when = row.get("date")
    day = when.date() if isinstance(when, datetime) else when
    return (str(row.get("_id") or row.get("id") or ""), str(row.get("account_id") or ""), day,
            _money(row), row.get("custom_category") or row.get("category") or "Other")


def _account(row: dict, accounts: dict) -> dict | None:
    account_id = str(row.get("account_id") or "")
    if not account_id:
        return None
    account = accounts.get(account_id) or {}
    provider = account.get("provider") or account.get("institution") or ""
    if isinstance(provider, dict):
        provider = provider.get("name") or provider.get("display_name") or provider.get("id") or ""
    raw_name = account.get("display_name") or account.get("name") or "Account"
    if isinstance(raw_name, dict):
        raw_name = raw_name.get("name") or raw_name.get("display_name") or "Account"
    return {"id": account_id, "name": display_account_name(str(raw_name)),
            "bank": str(provider)}


def _leg(row: dict | None, accounts: dict) -> dict | None:
    if not row:
        return None
    account = _account(row, accounts) or {"id": "", "name": "Account", "bank": ""}
    return {"id": str(row.get("_id") or ""), "account_id": account["id"],
            "account_name": account["name"], "account_bank": account["bank"],
            "date": _iso(row.get("date")), "amount": _money(row),
            "currency": str(row.get("currency") or "").upper(),
            "transaction_type": row.get("transaction_type")}


def _actor(marker: dict) -> str:
    return filing_actor(marker)


def _cadence(dates: list[date]) -> str | None:
    if len(dates) < 2:
        return None
    ordered = sorted(dates)
    gaps = [(b - a).days for a, b in zip(ordered, ordered[1:])]
    average = sum(gaps) / len(gaps)
    if 25 <= average <= 35:
        return "Monthly"
    if 6 <= average <= 8:
        return "Weekly"
    return None


def _amount_pattern(occurrences: list[dict], currency: str) -> str | None:
    """Return a conservative amount pattern only when every step proves it."""
    if len(occurrences) < 2:
        return None
    ordered = sorted(occurrences, key=lambda occurrence: occurrence.get("date") or "")
    try:
        dates = [date.fromisoformat(occurrence["date"][:10]) for occurrence in ordered]
        amounts = [round(float(occurrence["amount"]), 2) for occurrence in ordered]
    except (KeyError, TypeError, ValueError):
        return "Varying amounts"
    gaps = [(later - earlier).days for earlier, later in zip(dates, dates[1:])]
    steps = [round(later - earlier, 2) for earlier, later in zip(amounts, amounts[1:])]
    if len(set(amounts)) == 1:
        return f"{_pattern_money(amounts[0], currency)} each"
    if len(occurrences) < 3 or not gaps or len(set(gaps)) != 1 or gaps[0] < 1 or len(set(steps)) != 1 or steps[0] == 0:
        return "Varying amounts"
    direction = "Rising" if steps[0] > 0 else "Falling"
    interval = "a day" if gaps[0] == 1 else f"every {gaps[0]} days"
    return f"{direction} {_pattern_money(abs(steps[0]), currency)} {interval}"


def _pattern_money(value: float, currency: str) -> str:
    symbols = {"GBP": "£", "USD": "$", "EUR": "€"}
    return f"{symbols.get(currency, currency + ' ')}{value:,.2f}"


async def _all_rows(uid: str) -> list[dict]:
    """One batched read per provider, rather than a query per series."""
    rows: list[dict] = []
    for collection, source in ((transactions_col, "transactions"), (yapily_transactions_col, "yapily")):
        found = await collection.find({"user_id": uid, "transaction_type": {"$in": ["debit", "credit"]}}, _PROJECTION).to_list(None)
        rows.extend({**row, "_filed_source": source} for row in found)
    return rows


async def _backfill_user_source(uid: str, credit: dict, debit: dict, originals: dict) -> bool:
    """Promote only unchanged, already valid receipts for a saved user rule.

    A partial earlier backfill can leave one marker with source=user. Both
    legs must still have compatible provenance. A changed bank fact or user
    choice aborts this snapshot rather than advertising an unusable Undo.
    """
    pair = (credit, debit)
    if any((leg.get("own_transfer_match") or {}).get("source") not in (None, "ai", "user") for leg in pair):
        return False
    for leg, other in ((credit, debit), (debit, credit)):
        marker = leg.get("own_transfer_match") or {}
        if marker.get("counterpart_id") != str(other.get("_id")) or marker.get("counterpart_account_id") != other.get("account_id"):
            return False
    if credit.get("_filed_source") != "transactions" or debit.get("_filed_source") != "transactions":
        return False
    for leg in pair:
        original = originals[("transactions", str(leg["_id"]))]
        guard = {"user_id": uid, "_id": original["_id"], **{key: original.get(key) for key in (
            "account_id", "transaction_type", "amount", "currency", "date", "merchant_name",
            "description", "category", "custom_category", "is_pending", "own_transfer_match",
        )}}
        result = await transactions_col.update_one(guard, {"$set": {"own_transfer_match.source": "user"}})
        if result.matched_count != 1:
            raise ValueError("Transfer evidence changed during provenance refresh")
    for leg in pair:
        original = originals[("transactions", str(leg["_id"]))]
        original["own_transfer_match"] = {**original["own_transfer_match"], "source": "user"}
        leg["own_transfer_match"] = {**leg["own_transfer_match"], "source": "user"}
    return True


async def _build_filed_transfers(uid: str, *, start: date | None = None, end: date | None = None,
                               source: str = "all", page: int = 1, page_size: int = 20) -> dict:
    """Return paginated stored filing evidence and, when scoped, Spend's exact moved total."""
    rows = await _all_rows(uid)
    account_rows = await accounts_col.find({"user_id": uid}, {"name": 1, "display_name": 1, "provider": 1, "institution": 1, "currency": 1}).to_list(None)
    accounts = {str(row.get("_id")): row for row in account_rows}
    movement_identities = {(row.get("_filed_source"), str(row.get("_id"))): _movement_identity(row) for row in rows}
    home_currency_ids = {(row.get("_filed_source"), str(row.get("_id"))) for row in rows if not row.get("currency") or row.get("currency") == "GBP"}
    for row in rows:
        if not row.get("currency"):
            row["currency"] = str((accounts.get(str(row.get("account_id"))) or {}).get("currency") or "").upper()
    kinds = await get_category_kinds(uid)
    movement_categories = {name for name, kind in kinds.items() if kind == MOVEMENT}
    original_by_id = {(row.get("_filed_source"), str(row.get("_id"))): row for row in rows}
    stamped_ids = {(row.get("_filed_source"), str(row.get("_id"))) for row in rows if row.get("own_transfer_match")}
    # Provider ids are only stable within their own collection.
    rows = [row for source_name in {row.get("_filed_source") for row in rows}
            for row in resolve_transfer_evidence([row for row in rows if row.get("_filed_source") == source_name], movement_categories, owned_account_ids=set(accounts))]
    invalid_evidence = bool(stamped_ids - {(row.get("_filed_source"), str(row.get("_id"))) for row in rows if row.get("own_transfer_match")})
    by_id = {(row.get("_filed_source"), str(row.get("_id"))): row for row in rows}
    moved_ids: set[tuple] = set()
    evidence_start, evidence_end = start, end
    if evidence_start is None:
        all_dates = [row.get("date").date() if isinstance(row.get("date"), datetime) else row.get("date") for row in rows]
        all_dates = [value for value in all_dates if isinstance(value, date)]
        if all_dates:
            evidence_start, evidence_end = min(all_dates), max(all_dates)
    if evidence_start is not None and evidence_end is not None:
        period_txns = await _load_period_txns(uid, evidence_start, evidence_end)
        _, moved, _ = bucket_transactions(period_txns, kinds)
        moved_evidence = {_movement_identity(txn) for txn in period_txns if txn.get("debit") and classify_flow(
            kinds, txn["category"], True, bool(txn.get("own_move")), bool(txn.get("card_repayment")),
        ).kind == MOVED}
        moved_ids = {key for key, identity in movement_identities.items() if key in home_currency_ids and identity in moved_evidence}
        scope_total = round(sum(group["amount"] for group in moved.values()), 2) if start is not None else None
    else:
        scope_total = None
    if start is None:
        # Spend's headline is GBP-only. All-time history has no aggregate
        # headline and also includes stored movements in their native money.
        moved_ids.update((row.get("_filed_source"), str(row["_id"])) for row in rows if row.get("transaction_type") == "debit" and classify_flow(
            kinds, row.get("custom_category") or row.get("category") or "Other", True, False, False,
        ).kind == MOVED)
    groups: dict[str, dict] = {}
    represented_debit_ids: set[tuple] = set()
    verdict_rows = await own_transfer_judgements_col.find(
        {"user_id": uid, "kind": "pair"}, {"series_sig": 1, "reason": 1}
    ).to_list(None)
    reasons = {row.get("series_sig"): row.get("reason") for row in verdict_rows if row.get("series_sig") and row.get("reason")}
    learned_rows = await confirmed_transfer_pairs_col.find(
        {"user_id": uid}, {"key_a": 1, "key_b": 1, "source": 1},
    ).to_list(None)
    user_rules = {tuple(sorted((str(item.get("key_a") or ""), str(item.get("key_b") or ""))))
                  for item in learned_rows if not item.get("source") and item.get("key_a") and item.get("key_b")}

    # Pair once from the durable stamps.  A canonical pair key prevents the
    # credit/debit stamps becoming two rows, and lets old single-leg evidence
    # remain visible without inventing its missing counterpart.
    seen: set[tuple] = set()
    for row in rows:
        marker = row.get("own_transfer_match") or {}
        if not marker:
            continue
        counterpart = by_id.get((row.get("_filed_source"), str(marker.get("counterpart_id") or "")))
        pair_ids = (row.get("_filed_source"), *(sorted((str(row.get("_id")), str(counterpart.get("_id")))) if counterpart else (str(row.get("_id")), "")))
        if pair_ids in seen:
            continue
        seen.add(pair_ids)
        debit = row if row.get("transaction_type") == "debit" else (counterpart if counterpart and counterpart.get("transaction_type") == "debit" else None)
        credit = row if row.get("transaction_type") == "credit" else (counterpart if counterpart and counterpart.get("transaction_type") == "credit" else None)
        actor = _actor(marker)
        plain_keys = tuple(sorted((canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or ""),
                                   canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or "")))) if credit and debit else ()
        # Backfill only a current, reciprocal resolved pair backed by the
        # exact durable user rule.  This is not a generic source=None guess.
        if credit and debit and plain_keys in user_rules and any((leg.get("own_transfer_match") or {}).get("source") != "user" for leg in (credit, debit)):
            if await _backfill_user_source(uid, credit, debit, original_by_id):
                actor = "user"
        if actor == "unknown":
            continue
        # The selected Spend period is an outgoing-money view: selecting a
        # pair follows the debit date and never includes the incoming leg.
        anchor = debit or row
        # Keep the amount-sensitive engine signature for its judgement reason,
        # but use the history signature for the row and whole-history Undo.
        engine_sig = series_signature(credit, debit) if credit and debit else f"legacy:{str(anchor.get('_id'))}"
        sig = history_series_signature(credit, debit) if credit and debit else f"legacy:{str(anchor.get('_id'))}"
        safe_undo = bool(credit and debit) and credit.get("_filed_source") == debit.get("_filed_source") == "transactions" and reversible_pair(
            original_by_id.get(("transactions", str(credit.get("_id")))),
            original_by_id.get(("transactions", str(debit.get("_id")))), accounts, movement_categories,
        )
        currency = str((debit or row).get("currency") or "").upper()
        group_id = f"{sig}:{actor}:{currency}"
        entry = groups.setdefault(group_id, {"series_key": f"{actor}:{sig}" if credit and debit else group_id, "actor": actor, "kind": "own_transfer",
            "debit": _account(debit, accounts) if debit else None, "credit": _account(credit, accounts) if credit else None,
            "description": (debit or credit or row).get("merchant_name") or (debit or credit or row).get("description") or "Transfer",
            "reason": reasons.get(engine_sig), "occurrences": [], "can_undo": safe_undo,
            "undo_unavailable_reason": None if safe_undo else "This filing cannot be safely undone from stored evidence.",
        })
        occurrence_date = _iso((debit or credit or row).get("date"))
        entry["occurrences"].append({"_filed_source": row.get("_filed_source"), "date": occurrence_date, "amount": _money(debit) if debit else 0.0,
            "currency": currency, "debit": _leg(debit, accounts), "credit": _leg(credit, accounts)})
        if debit:
            represented_debit_ids.add((debit.get("_filed_source"), str(debit.get("_id"))))
        entry["can_undo"] = bool(entry["can_undo"] and safe_undo and not invalid_evidence)
        if not entry["can_undo"]:
            entry["undo_unavailable_reason"] = "This filing cannot be safely undone from stored evidence."

    # Other authoritative MOVED debits are shown as individual, non-undoable
    # evidence.  The same loader/rules as Spend decide inclusion for a period.
    # Stored category movement rows not already represented by a durable stamp.
    # These are evidence-only, never candidates for destructive undo.
    for row in rows:
        row_key = (row.get("_filed_source"), str(row.get("_id")))
        if (row.get("transaction_type") != "debit" or (start is None and row.get("is_pending")) or row_key not in moved_ids
                or row_key in represented_debit_ids):
            continue
        category = row.get("custom_category") or row.get("category") or "Movement"
        merchant = " ".join(str(row.get("merchant_name") or row.get("description") or "Moved money").lower().split())
        key = f"other:{row.get('account_id')}:{row.get('currency')}:{category}:{merchant}"
        entry = groups.setdefault(key, {"series_key": key, "actor": "unknown", "kind": "other", "debit": _account(row, accounts), "credit": None,
            "description": row.get("merchant_name") or row.get("description") or "Moved money", "reason": category,
            "occurrences": [], "can_undo": False, "undo_unavailable_reason": "This filing has no reversible transfer decision."})
        entry["occurrences"].append({"_filed_source": row.get("_filed_source"), "date": _iso(row.get("date")), "amount": _money(row), "currency": str(row.get("currency") or "").upper(), "debit": _leg(row, accounts), "credit": None})

    items = []
    for entry in groups.values():
        all_occurrences = entry.pop("occurrences")
        occurrences = [occurrence for occurrence in all_occurrences if _date_in_scope({"date": occurrence["date"] and date.fromisoformat(occurrence["date"][:10])}, start, end)]
        if start is not None:
            occurrences = [occurrence for occurrence in occurrences if occurrence.get("debit") and (occurrence.get("_filed_source"), occurrence["debit"]["id"]) in moved_ids]
        if source != "all" and entry["actor"] != source:
            continue
        if not occurrences:
            continue
        occurrences.sort(key=lambda o: o["date"] or "", reverse=True)
        dates = [date.fromisoformat(o["date"][:10]) for o in occurrences if o.get("date")]
        currencies = {o["currency"] for o in occurrences if o.get("currency")}
        total = round(sum(o["amount"] for o in occurrences), 2)
        # Keep every durable occurrence in the store, but hand a bounded
        # receipt to the sheet.  The full provider-qualified membership is
        # deliberately private: the transactions hub resolves it server-side
        # and must never infer a series from names, accounts or dates.
        membership = []
        seen_members = set()
        for occurrence in all_occurrences:
            source_name = occurrence.get("_filed_source")
            for leg_name in ("debit", "credit"):
                leg = occurrence.get(leg_name)
                member_id = str((leg or {}).get("id") or "")
                member = (source_name, member_id)
                if source_name in {"transactions", "yapily"} and member_id and member not in seen_members:
                    seen_members.add(member)
                    membership.append({"source": source_name, "id": member_id})
        items.append({"series_key": entry["series_key"], "actor": entry["actor"], "kind": entry["kind"],
            "from_account": entry["debit"], "to_account": entry["credit"], "description": entry["description"],
            "total_amount": total, "currency": next(iter(currencies)) if len(currencies) == 1 else "",
            "count": len(occurrences), "first_date": min((o["date"] for o in occurrences if o["date"]), default=None),
            "last_date": max((o["date"] for o in occurrences if o["date"]), default=None), "cadence": _cadence(dates),
            "reason": entry["reason"], "amount_pattern": _amount_pattern(occurrences, next(iter(currencies)) if len(currencies) == 1 else ""),
            "occurrences": [{key: value for key, value in occurrence.items() if key != "_filed_source"} for occurrence in occurrences],
            "all_time_count": len(all_occurrences), "_series_membership": membership,
            "can_undo": entry["can_undo"],
            "undo_count": len(all_occurrences) if entry["can_undo"] else 0, "history_complete": bool(all_occurrences) and not invalid_evidence,
            "transactions_href": f"/transactions?filed_series={quote(entry['series_key'], safe='')}", "undo_unavailable_reason": entry["undo_unavailable_reason"]})
    items.sort(key=lambda item: (item["last_date"] or "", item["series_key"]), reverse=True)
    total = len(items)
    offset = (page - 1) * page_size
    return {"items": items[offset:offset + page_size], "total_series": total, "page": page, "page_size": page_size,
            "pages": ceil(total / page_size) if total else 0,
            "scope": {"start": start.isoformat(), "end": end.isoformat()} if start and end else None,
            "scope_total": scope_total, "scope_currency": "GBP" if scope_total is not None else None,
            "source": source,
            "updated_at": datetime.now(timezone.utc).isoformat(),  # naive-ok: aware UTC response instant, not user-calendar arithmetic
            "complete": not invalid_evidence,
            "status": "ready"}


_STORE_SHAPE = 2  # G452 adds private provider-qualified series membership.
_refreshing: set[str] = set()
_again: set[str] = set()


def _scope_key(start: date | None, end: date | None) -> str:
    return f"{start.isoformat() if start else 'all'}::{end.isoformat() if end else 'all'}"


def _store_id(uid: str, start: date | None, end: date | None) -> str:
    return f"{uid}::filed-transfers::{_scope_key(start, end)}"


async def refresh_filed_transfers(uid: str, *, start: date | None = None, end: date | None = None) -> None:
    """Build a scope after a bank/user change, never from the sheet GET."""
    key = _store_id(uid, start, end)
    try:
        # Create the epoch sentinel before reading bank rows, including the
        # first scope. Errors here also stay inside the background boundary.
        await filed_transfer_store_col.update_one({"_id": key}, {"$setOnInsert": {
            "user_id": uid, "scope_key": _scope_key(start, end), "shape": _STORE_SHAPE,
            "generation": 0, "stale": True,
        }}, upsert=True)
        before = await filed_transfer_store_col.find_one({"_id": key}, {"generation": 1})
        generation = int((before or {}).get("generation") or 0)
        # The builder is allowed to load and reconcile evidence.  Store every
        # row once; the reader below only filters/paginates this saved receipt.
        built = await _build_filed_transfers(uid, start=start, end=end, source="all", page=1, page_size=100000)
        # Do not let a sync/edit that landed while the build ran be overwritten
        # as fresh.  That update increments generation and its own queued build
        # will write the next snapshot.
        current = await filed_transfer_store_col.find_one({"_id": key}, {"generation": 1})
        if current is not None and int(current.get("generation") or 0) != generation:
            return
        await filed_transfer_store_col.update_one({"_id": key, "generation": generation}, {"$set": {
            "user_id": uid, "scope_key": _scope_key(start, end), "shape": _STORE_SHAPE,
            "state": built, "stale": False, "built_at": datetime.now(timezone.utc),  # naive-ok: aware UTC persisted snapshot-build audit stamp
        }})
    except Exception:
        # Background preparation is best effort.  The saved receipt stays
        # visible as stale and the next trigger/request may retry.
        logger.exception("filed transfer history refresh failed")


def refresh_filed_transfers_soon(uid: str, *, start: date | None = None, end: date | None = None) -> None:
    key = _store_id(uid, start, end)
    if not uid:
        return
    if key in _refreshing:
        _again.add(key)
        return
    try:
        _refreshing.add(key)
        async def loop():
            try:
                while True:
                    _again.discard(key)
                    await refresh_filed_transfers(uid, start=start, end=end)
                    if key not in _again:
                        break
            finally:
                _refreshing.discard(key)
        asyncio.get_running_loop().create_task(loop())
    except RuntimeError:
        _refreshing.discard(key)


async def mark_filed_transfers_stale(uid: str) -> None:
    """Transaction/account changes retain the last receipt but prohibit Undo."""
    if not uid:
        return
    await filed_transfer_store_col.update_many({"user_id": uid}, {"$set": {"stale": True}, "$inc": {"generation": 1}})
    scopes = await filed_transfer_store_col.find({"user_id": uid}, {"scope_key": 1}).to_list(None)
    # Every previously visible scope gets rebuilt, including the active pay
    # period.  Keep all-time warm for a user opening this sheet for the first
    # time as well.
    seen = {str(row.get("scope_key") or "") for row in scopes}
    seen.add(_scope_key(None, None))
    for scope in seen:
        left, right = scope.split("::", 1)
        refresh_filed_transfers_soon(uid, start=None if left == "all" else date.fromisoformat(left),
                                     end=None if right == "all" else date.fromisoformat(right))


async def refresh_all_filed_transfers() -> int:
    """Worker-start rebuild of every stored scope after a deploy."""
    try:
        docs = await filed_transfer_store_col.find({}, {"user_id": 1, "scope_key": 1}).to_list(None)
    except Exception:
        return 0
    for doc in docs:
        scope = str(doc.get("scope_key") or "all::all")
        left, right = scope.split("::", 1)
        await refresh_filed_transfers(str(doc["user_id"]), start=None if left == "all" else date.fromisoformat(left),
                                      end=None if right == "all" else date.fromisoformat(right))
    return len(docs)


async def list_filed_transfers(uid: str, *, start: date | None = None, end: date | None = None,
                               source: str = "all", page: int = 1, page_size: int = 20) -> dict:
    """Read one persisted history scope.  No matcher, model or money calc here."""
    saved = await filed_transfer_store_col.find_one({"_id": _store_id(uid, start, end)})
    if not saved or saved.get("shape") != _STORE_SHAPE or not isinstance(saved.get("state"), dict):
        refresh_filed_transfers_soon(uid, start=start, end=end)
        return {"items": [], "total_series": None, "page": page, "page_size": page_size, "pages": None,
                "scope": {"start": start.isoformat(), "end": end.isoformat()} if start and end else None,
                "scope_total": None, "scope_currency": "GBP" if start else None, "source": source,
                "updated_at": None, "complete": False, "status": "preparing"}
    state = saved["state"]
    items = [item for item in state.get("items", []) if source == "all" or item.get("actor") == source]
    total = len(items)
    offset = (page - 1) * page_size
    stale = bool(saved.get("stale"))
    if stale:
        refresh_filed_transfers_soon(uid, start=start, end=end)
    def public_item(item: dict) -> dict:
        # One opened series is a compact receipt, not its entire history.
        # Keep the stored full receipt and private membership for Undo and the
        # exact hub drill-in while returning no more than ten recent payments.
        public = {key: value for key, value in item.items() if key != "_series_membership"}
        public["occurrences"] = list(item.get("occurrences") or [])[:10]
        if stale:
            public["can_undo"] = False
        return public
    shown = [public_item(item) for item in items[offset:offset + page_size]]
    return {**state, "items": shown, "total_series": total, "page": page, "page_size": page_size,
            "pages": ceil(total / page_size) if total else 0, "source": source,
            "updated_at": _iso(saved.get("built_at")) or state.get("updated_at"),
            "status": "stale" if stale else "ready"}


async def filed_series_membership(uid: str, series_key: str) -> dict[str, list[str]]:
    """Return exact, saved all-time source membership for one series.

    This is intentionally a receipt lookup only.  It never asks a matcher to
    recreate a historical series, so a stale, deleted or malformed receipt
    cannot broaden a hub link into unrelated customer transactions.
    """
    if (not isinstance(series_key, str) or not series_key.strip() or len(series_key) > 500
            or any(ord(char) < 32 or ord(char) == 127 for char in series_key)):
        raise ValueError("filed_series is invalid")
    base_query = {"user_id": uid, "shape": _STORE_SHAPE,
                  "state.items.series_key": series_key}
    fresh_query = {**base_query, "stale": {"$ne": True}, "state.complete": True}
    # The all-time receipt is canonical when it is fresh and complete. A
    # fresh period receipt is equally safe when it is the only one available:
    # every scope saves complete, source-qualified all-time membership.
    #
    # A stale or incomplete receipt still has exact historic row IDs and is
    # safe for this read-only drill-in. It is only unsuitable for Undo. Fall
    # back to it after fresh evidence, never attempting to recreate a series.
    saved = await filed_transfer_store_col.find_one({
        **fresh_query, "_id": _store_id(uid, None, None),
    })
    if saved is None:
        saved = await filed_transfer_store_col.find(fresh_query).sort("built_at", -1).limit(1).to_list(1)
        saved = saved[0] if saved else None
    if saved is None:
        saved = await filed_transfer_store_col.find_one({
            **base_query, "_id": _store_id(uid, None, None),
        })
    if saved is None:
        saved = await filed_transfer_store_col.find(base_query).sort("built_at", -1).limit(1).to_list(1)
        saved = saved[0] if saved else None
    state = (saved or {}).get("state")
    if not isinstance(state, dict):
        raise LookupError("Filed transfer history is not ready")
    item = next((candidate for candidate in state.get("items", [])
                 if isinstance(candidate, dict) and candidate.get("series_key") == series_key), None)
    if not item:
        raise LookupError("Filed transfer series is unavailable")
    raw_members = item.get("_series_membership")
    if not isinstance(raw_members, list) or not raw_members:
        raise LookupError("Filed transfer series has no complete receipt")
    members: dict[str, list[str]] = {"transactions": [], "yapily": []}
    seen: set[tuple[str, str]] = set()
    for member in raw_members:
        if not isinstance(member, dict):
            raise LookupError("Filed transfer series has an invalid receipt")
        source_name, transaction_id = member.get("source"), member.get("id")
        if (source_name not in members or not isinstance(transaction_id, str) or not transaction_id
                or len(transaction_id) > 200 or any(ord(char) < 32 or ord(char) == 127 for char in transaction_id)):
            raise LookupError("Filed transfer series has an invalid receipt")
        key = (source_name, transaction_id)
        if key not in seen:
            seen.add(key)
            members[source_name].append(transaction_id)
    if not any(members.values()):
        raise LookupError("Filed transfer series has no complete receipt")
    return members
