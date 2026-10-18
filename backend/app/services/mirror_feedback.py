"""Read-only transaction evidence used by The Mirror feedback surface."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import math
import re

from app.core import timeutil
from app.db.collections import transactions_col
from app.services.behaviour import _RETURNED_KEYWORDS


_MAX_CANDIDATES_PER_DATE_TYPE = 50
_MAX_RECORDS = 6


def _keyword_regex() -> re.Pattern:
    """Keep the evidence vocabulary exactly aligned with the Mirror trait."""
    return re.compile("|".join(re.escape(word) for word in _RETURNED_KEYWORDS), re.IGNORECASE)


def _transaction_day(value) -> date | None:
    if isinstance(value, datetime):
        return timeutil.to_user_date(value)
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _evidence_text(doc: dict) -> str:
    """Description is authoritative; ``name`` is only legacy fall-through."""
    description = doc.get("description")
    if isinstance(description, str) and description.strip():
        return description
    name = doc.get("name")
    return name if isinstance(name, str) else ""


def _display_name(doc: dict) -> str:
    for field in ("merchant_name", "description", "name"):
        value = doc.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()[:160]
    return "Transaction"


def _signed_amount(doc: dict) -> float | None:
    raw = doc.get("amount")
    if isinstance(raw, bool) or not isinstance(raw, (int, float, Decimal)):
        return None
    try:
        amount = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(amount):
        return None

    transaction_type = doc.get("transaction_type")
    if transaction_type == "debit":
        return -abs(amount)
    if transaction_type == "credit":
        return abs(amount)
    # Legacy records without a direction may already be signed.  Do not make
    # up a direction for an explicitly present, unfamiliar transaction type.
    if transaction_type in (None, ""):
        return amount
    return None


async def latest_payment_records(uid: str) -> dict:
    """Return recent matching TrueLayer records, without writing any state.

    The two bounded queries retain support for the historic mixed ``date``
    storage types.  Final normalisation is deliberately local so malformed or
    future source rows cannot become user-visible evidence.
    """
    today = timeutil.user_today()
    window_start = today - timedelta(days=180)
    regex = _keyword_regex()
    text_clause = {
        "$or": [
            {"description": regex},
            {"$and": [
                {"$or": [
                    {"description": {"$exists": False}},
                    {"description": None},
                    {"description": ""},
                    {"description": {"$regex": r"^\s*$"}},
                ]},
                {"name": regex},
            ]},
        ]
    }
    projection = {
        "_id": 1, "date": 1, "amount": 1, "transaction_type": 1,
        "merchant_name": 1, "description": 1, "name": 1,
    }
    datetime_bounds = {
        "$gte": datetime.combine(window_start, time.min, tzinfo=timeutil.LONDON).astimezone(timezone.utc).replace(tzinfo=None),
        "$lt": datetime.combine(today + timedelta(days=1), time.min, tzinfo=timeutil.LONDON).astimezone(timezone.utc).replace(tzinfo=None),
    }
    string_bounds = {"$gte": window_start.isoformat(), "$lte": today.isoformat()}

    candidates: list[dict] = []
    for bounds in (datetime_bounds, string_bounds):
        query = {"user_id": uid, "date": bounds, **text_clause}
        cursor = transactions_col.find(query, projection).sort([("date", -1), ("_id", -1)]).limit(
            _MAX_CANDIDATES_PER_DATE_TYPE
        )
        candidates.extend(await cursor.to_list(_MAX_CANDIDATES_PER_DATE_TYPE))

    records = []
    for doc in candidates:
        record_date = _transaction_day(doc.get("date"))
        amount = _signed_amount(doc)
        if (
            record_date is None
            or not window_start <= record_date <= today
            or amount is None
            or not regex.search(_evidence_text(doc))
        ):
            continue
        records.append({
            "id": str(doc.get("_id", "")),
            "name": _display_name(doc),
            "date": record_date.isoformat(),
            "amount": amount,
            "_sort_id": str(doc.get("_id", "")),
        })

    records.sort(key=lambda record: (record["date"], record["_sort_id"]), reverse=True)
    for record in records:
        record.pop("_sort_id")
    return {
        "records": records[:_MAX_RECORDS],
        "window_start": window_start.isoformat(),
        "window_end": today.isoformat(),
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
