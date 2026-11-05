"""G419: owned, settled payment history and authoritative rule evidence.

Read only. The six-month count is never a repayment or a money instruction;
card_statements remains the one engine that attributes and replaces bills.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException

from app.core import timeutil
from app.services.account_kinds import is_credit_card_account, is_current_account, is_debt_account, is_savings_account
from app.services.counted_accounts import is_excluded
from app.services.card_statements import _day, _month_day, _money, mask_long_digits, normalise_match_rule, row_matches_rule, is_settled_row, is_settled_payment, UNSETTLED_STATUSES


def _row_order(row: dict) -> tuple[float, str]:
    value = row.get("date")
    when = (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value) if isinstance(value, datetime) else datetime.combine(_day(value) or date.min, time.min, tzinfo=timezone.utc)
    return when.timestamp(), str(row.get("_id") or "")


def six_month_window(today: date) -> tuple[date, date]:
    return _month_day(today, -6, today.day), today


def eligible_payment_account(account: dict) -> bool:
    return bool(is_current_account(account) and not is_credit_card_account(account)
                and not is_savings_account(account) and not is_debt_account(account)
                and not is_excluded(account) and not account.get("manual")
                and str(account.get("source") or "").lower() not in ("manual", "offline", "statement", "statement_upload")
                and str(account.get("currency") or "GBP").upper() == "GBP"
                and str(account.get("status") or "").lower() not in ("expired", "revoked", "disconnected")
                and str(account.get("connection_status") or "").lower() not in ("expired", "revoked", "disconnected"))


def _id_keys(value: str) -> list:
    from bson import ObjectId
    return [value, ObjectId(value)] if ObjectId.is_valid(value) else [value]


async def owned_payment_account(uid: str, payer_id: str) -> dict:
    from app.db.collections import accounts_col
    payer_id = str(payer_id or "").strip()
    account = await accounts_col.find_one({"user_id": uid, "_id": {"$in": _id_keys(payer_id)}})
    if not account or not eligible_payment_account(account):
        raise HTTPException(422, "Choose one of your connected, counted GBP current accounts")
    return account


async def payment_accounts(uid: str) -> list[dict]:
    from app.db.collections import accounts_col
    rows = await accounts_col.find({"user_id": uid}).to_list(None)
    return [{"id": str(row["_id"]), "name": row.get("nickname") or row.get("name") or "Current account",
             "provider": row.get("provider") or "Bank"} for row in rows if eligible_payment_account(row)]


async def load_payment_history(uid: str, payer: dict, today: date | None = None) -> tuple[list[dict], dict]:
    from app.db.collections import transactions_col
    today = today or timeutil.user_today()
    start, end = six_month_window(today)
    lower = datetime.combine(start, time.min, tzinfo=timeutil.LONDON).astimezone(timezone.utc)
    upper = datetime.combine(end + timedelta(days=1), time.min, tzinfo=timeutil.LONDON).astimezone(timezone.utc)
    account_ids = _id_keys(str(payer["_id"]))
    base = {"user_id": uid, "account_id": {"$in": account_ids}}
    projection = {"description": 1, "merchant_name": 1, "amount": 1, "date": 1, "transaction_type": 1,
                  "is_pending": 1, "status": 1, "currency": 1, "own_transfer_match": 1, "account_id": 1}
    rows = await transactions_col.find({**base, "date": {"$gte": lower, "$lt": upper}}, projection).to_list(None)
    # Earliest actual settled history supports a qualifier, not a claim that
    # a blank six-month search proves no payment was made.
    oldest = await transactions_col.find_one(
        {**base, "date": {"$lt": upper}, "is_pending": {"$ne": True},
         "status": {"$nin": [v for status in UNSETTLED_STATUSES for v in (status, status.upper(), status.title())]}, "transaction_type": {"$in": ["debit", "credit"]},
         "amount": {"$type": "number", "$gte": -1e308, "$lte": 1e308}}, {"date": 1, "amount": 1, "status": 1, "is_pending": 1}, sort=[("date", 1)])
    history_from = _day(oldest.get("date")) if oldest and is_settled_row(oldest) else min((_day(row.get("date")) for row in rows if is_settled_row(row)), default=None)
    meta = {"from": start.isoformat(), "through": end.isoformat(),
            "history_from": max(start, history_from).isoformat() if history_from else None,
            "history_complete": history_from is not None and history_from <= start}
    debits = [row for row in rows if row.get("transaction_type") == "debit" and is_settled_payment(row) and start <= (_day(row.get("date")) or date.min) <= end
              and str(row.get("currency") or "GBP").upper() == "GBP"]
    debits.sort(key=_row_order, reverse=True)
    return debits, meta


def _description(row: dict) -> str:
    return " ".join(str(row.get("description") or row.get("merchant_name") or "").split())


def debit_choice(row: dict) -> dict:
    raw = _description(row)
    masked = mask_long_digits(raw)
    # The whole masked narrative is not a literal substring of the bank's
    # original number. Use its visible reference ending for Contains this.
    import re
    tails = re.findall(r"…(\d{5})", masked)
    contains = tails[-1] if tails else raw if len(raw) <= 240 else ""
    exact = normalise_match_rule({"kind": "exact", "text": raw})
    return {"id": str(row["_id"]), "description": masked[:240] or "Payment description unavailable", "amount": -_money(abs(float(row["amount"]))),
            "date": _day(row["date"]).isoformat(), "contains_text": contains, "exact_match": exact}


def debit_choices(rows: list[dict], query: str, offset: int, meta: dict) -> dict:
    search = " ".join(str(query or "").split()).casefold()
    selected = [row for row in rows if not search or search in mask_long_digits(_description(row)).casefold()
                or search in str(row.get("merchant_name") or "").casefold()]
    page = selected[offset:offset + 50]
    return {"status": "ok", "payments": [debit_choice(row) for row in page],
            "next_offset": offset + 50 if offset + 50 < len(selected) else None, **meta}


def matching_evidence(rows: list[dict], rule: dict | None, meta: dict, *, rival_rules: list[dict] = ()) -> dict:
    from app.services.own_account_transfers import series_key
    rule = normalise_match_rule(rule)
    matches = [row for row in rows if row_matches_rule(row, rule)] if rule else []
    ambiguous = len({series_key(row) for row in matches}) > 1 or any(
        row_matches_rule(row, rival) for row in matches for rival in rival_rules)
    latest = max(matches, key=_row_order, default=None)
    return {"status": "ok", "rule": rule, "match_count": len(matches), **meta,
            "latest": {"date": _day(latest["date"]).isoformat(), "amount": -_money(abs(float(latest["amount"]))),
                       "description": mask_long_digits(_description(latest))[:240]} if latest else None,
            "ambiguous": ambiguous,
            "reason": "More than one payment series or card matches. Narrow the description for this card." if ambiguous
            else "No settled transaction history is available for this account." if meta.get("history_from") is None
            else "Only the available account history was checked." if not meta.get("history_complete") else None}
