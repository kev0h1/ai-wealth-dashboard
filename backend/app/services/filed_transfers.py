"""Stored-evidence history for the Transfers Sorted sheet (G449).

This is deliberately a reader, not another transfer matcher.  A history load
never asks a model or reconciles pairs: it only renders durable stamps already
written by sync/review and uses the Spend loader for a period's headline.
"""
from __future__ import annotations

from datetime import date, datetime
from math import ceil

from app.db.collections import accounts_col, own_transfer_judgements_col, transactions_col, yapily_transactions_col
from app.services.categories import MOVEMENT, get_category_kinds
from app.services.account_names import display_account_name
from app.services.own_account_transfers import resolve_transfer_evidence, series_signature
from app.services.spend_verdict import _load_period_txns, bucket_transactions
from app.services.spending import MOVED, classify_flow
from app.services.filed_transfer_undo import filing_actor, reversible_pair

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


async def _all_rows(uid: str) -> list[dict]:
    """Two bounded collection reads, rather than one read per series."""
    rows: list[dict] = []
    for collection, source in ((transactions_col, "transactions"), (yapily_transactions_col, "yapily")):
        found = await collection.find({"user_id": uid, "transaction_type": {"$in": ["debit", "credit"]}}, _PROJECTION).to_list(None)
        rows.extend({**row, "_filed_source": source} for row in found)
    return rows


async def list_filed_transfers(uid: str, *, start: date | None = None, end: date | None = None,
                               source: str = "all", page: int = 1, page_size: int = 20) -> dict:
    """Return paginated stored filing evidence and, when scoped, Spend's exact moved total."""
    rows = await _all_rows(uid)
    account_rows = await accounts_col.find({"user_id": uid}, {"name": 1, "display_name": 1, "provider": 1, "institution": 1, "currency": 1}).to_list(None)
    accounts = {str(row.get("_id")): row for row in account_rows}
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
    moved_ids: set[str] = set()
    evidence_start, evidence_end = start, end
    if evidence_start is None:
        all_dates = [row.get("date").date() if isinstance(row.get("date"), datetime) else row.get("date") for row in rows]
        all_dates = [value for value in all_dates if isinstance(value, date)]
        if all_dates:
            evidence_start, evidence_end = min(all_dates), max(all_dates)
    if evidence_start is not None and evidence_end is not None:
        period_txns = await _load_period_txns(uid, evidence_start, evidence_end)
        _, moved, _ = bucket_transactions(period_txns, kinds)
        moved_ids = {txn["id"] for txn in period_txns if txn.get("debit") and classify_flow(
            kinds, txn["category"], True, bool(txn.get("own_move")), bool(txn.get("card_repayment")),
        ).kind == MOVED}
        scope_total = round(sum(group["amount"] for group in moved.values()), 2) if start is not None else None
    else:
        scope_total = None
    if start is None:
        # Spend's headline is GBP-only. All-time history has no aggregate
        # headline and also includes stored movements in their native money.
        moved_ids.update(str(row["_id"]) for row in rows if row.get("transaction_type") == "debit" and classify_flow(
            kinds, row.get("custom_category") or row.get("category") or "Other", True, False, False,
        ).kind == MOVED)
    groups: dict[str, dict] = {}
    represented_debit_ids: set[str] = set()
    verdict_rows = await own_transfer_judgements_col.find(
        {"user_id": uid, "kind": "pair"}, {"series_sig": 1, "reason": 1}
    ).to_list(None)
    reasons = {row.get("series_sig"): row.get("reason") for row in verdict_rows if row.get("series_sig") and row.get("reason")}

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
        if actor == "unknown":
            continue
        # The selected Spend period is an outgoing-money view: selecting a
        # pair follows the debit date and never includes the incoming leg.
        anchor = debit or row
        sig = series_signature(credit, debit) if credit and debit else f"legacy:{str(anchor.get('_id'))}"
        safe_undo = bool(credit and debit) and credit.get("_filed_source") == debit.get("_filed_source") == "transactions" and reversible_pair(
            original_by_id.get(("transactions", str(credit.get("_id")))),
            original_by_id.get(("transactions", str(debit.get("_id")))), accounts, movement_categories,
        )
        currency = str((debit or row).get("currency") or "").upper()
        group_id = f"{sig}:{actor}:{currency}"
        entry = groups.setdefault(group_id, {"series_key": f"{actor}:{sig}" if credit and debit else group_id, "actor": actor, "kind": "own_transfer",
            "debit": _account(debit, accounts) if debit else None, "credit": _account(credit, accounts) if credit else None,
            "description": (debit or credit or row).get("merchant_name") or (debit or credit or row).get("description") or "Transfer",
            "reason": reasons.get(sig), "occurrences": [], "can_undo": safe_undo,
            "undo_unavailable_reason": None if safe_undo else "This filing cannot be safely undone from stored evidence.",
        })
        occurrence_date = _iso((debit or credit or row).get("date"))
        entry["occurrences"].append({"date": occurrence_date, "amount": _money(debit) if debit else 0.0,
            "currency": currency, "debit": _leg(debit, accounts), "credit": _leg(credit, accounts)})
        if debit:
            represented_debit_ids.add(str(debit.get("_id")))
        entry["can_undo"] = bool(entry["can_undo"] and safe_undo and not invalid_evidence)
        if not entry["can_undo"]:
            entry["undo_unavailable_reason"] = "This filing cannot be safely undone from stored evidence."

    # Other authoritative MOVED debits are shown as individual, non-undoable
    # evidence.  The same loader/rules as Spend decide inclusion for a period.
    # Stored category movement rows not already represented by a durable stamp.
    # These are evidence-only, never candidates for destructive undo.
    for row in rows:
        if (row.get("transaction_type") != "debit" or (start is None and row.get("is_pending")) or str(row.get("_id")) not in moved_ids
                or str(row.get("_id")) in represented_debit_ids):
            continue
        category = row.get("custom_category") or row.get("category") or "Movement"
        merchant = " ".join(str(row.get("merchant_name") or row.get("description") or "Moved money").lower().split())
        key = f"other:{row.get('account_id')}:{row.get('currency')}:{category}:{merchant}"
        entry = groups.setdefault(key, {"series_key": key, "actor": "unknown", "kind": "other", "debit": _account(row, accounts), "credit": None,
            "description": row.get("merchant_name") or row.get("description") or "Moved money", "reason": category,
            "occurrences": [], "can_undo": False, "undo_unavailable_reason": "This filing has no reversible transfer decision."})
        entry["occurrences"].append({"date": _iso(row.get("date")), "amount": _money(row), "currency": str(row.get("currency") or "").upper(), "debit": _leg(row, accounts), "credit": None})

    items = []
    for entry in groups.values():
        all_occurrences = entry.pop("occurrences")
        occurrences = [occurrence for occurrence in all_occurrences if _date_in_scope({"date": occurrence["date"] and date.fromisoformat(occurrence["date"][:10])}, start, end)]
        if start is not None:
            occurrences = [occurrence for occurrence in occurrences if occurrence.get("debit") and occurrence["debit"]["id"] in moved_ids]
        if source != "all" and entry["actor"] != source:
            continue
        if not occurrences:
            continue
        occurrences.sort(key=lambda o: o["date"] or "", reverse=True)
        dates = [date.fromisoformat(o["date"][:10]) for o in occurrences if o.get("date")]
        currencies = {o["currency"] for o in occurrences if o.get("currency")}
        total = round(sum(o["amount"] for o in occurrences), 2)
        items.append({"series_key": entry["series_key"], "actor": entry["actor"], "kind": entry["kind"],
            "from_account": entry["debit"], "to_account": entry["credit"], "description": entry["description"],
            "total_amount": total, "currency": next(iter(currencies)) if len(currencies) == 1 else "",
            "count": len(occurrences), "first_date": min((o["date"] for o in occurrences if o["date"]), default=None),
            "last_date": max((o["date"] for o in occurrences if o["date"]), default=None), "cadence": _cadence(dates),
            "reason": entry["reason"], "occurrences": occurrences, "can_undo": entry["can_undo"],
            "undo_count": len(all_occurrences) if entry["can_undo"] else 0, "history_complete": bool(all_occurrences) and not invalid_evidence,
            "transactions_href": "/transactions", "undo_unavailable_reason": entry["undo_unavailable_reason"]})
    items.sort(key=lambda item: (item["last_date"] or "", item["series_key"]), reverse=True)
    total = len(items)
    offset = (page - 1) * page_size
    return {"items": items[offset:offset + page_size], "total_series": total, "page": page, "page_size": page_size,
            "pages": ceil(total / page_size) if total else 0,
            "scope": {"start": start.isoformat(), "end": end.isoformat()} if start and end else None,
            "scope_total": scope_total, "scope_currency": "GBP" if scope_total is not None else None,
            "source": source, "updated_at": datetime.utcnow().isoformat(), "complete": not invalid_evidence}
