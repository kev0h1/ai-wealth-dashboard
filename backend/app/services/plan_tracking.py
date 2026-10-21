"""G291 category activity, not a second reservation or progress engine.

The chosen category is persisted on a plan. This read-only evidence sums the
current pay period using the canonical spending definition. A goal or a
receiving-account set-aside shows corroborated source-to-sink transfers only.
It never credits pot progress or releases a reserve independently. Existing
payment fulfilment and the shared pot ledger remain the money authorities.
"""
from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException

from app.core import timeutil
from app.db.collections import (
    allocations_col, commitments_col, preferences_col, transactions_col,
    yapily_transactions_col,
)
from app.services.account_plan_sources import owned_account_map, validate_source_account
from app.services.categories import get_category_kinds, normalise_name
from app.services.categorisation import user_identity
from app.services.description_match import matches_contains, matches_equals
from app.services.pay_period import get_pay_period_for_date
from app.services.spending import (
    MOVED, REFUND, SPEND, SpendingContext, card_accounts_from_docs, txn_flow,
)

MAX_ROWS = 20000


async def validate_tracking(raw, uid: str, *, account_map: dict | None = None) -> dict | None:
    if raw is None:
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("category"), str):
        raise HTTPException(400, "Choose a category to track.")
    kinds = await get_category_kinds(uid)
    name = next((n for n in kinds if normalise_name(n) == normalise_name(raw["category"])), None)
    if name is None:
        raise HTTPException(400, "Category not found. Refresh the categories and try again.")
    ids = raw.get("destination_account_ids", [])
    if not isinstance(ids, list) or len(ids) > 8 or any(not isinstance(a, str) or not a.strip() for a in ids):
        raise HTTPException(400, "Choose valid receiving accounts.")
    ids = list(dict.fromkeys(a.strip() for a in ids))
    if ids:
        accounts = account_map if account_map is not None else await owned_account_map(uid)
        if any(a not in accounts for a in ids):
            raise HTTPException(404, "Account not found")
        if any(str(accounts[a].get("currency") or ("GBP" if accounts[a].get("_account_plan_manual") else "")).upper() != "GBP" for a in ids):
            raise HTTPException(422, "Choose a GBP receiving account for this plan.")
    return {"category": name, **({"destination_account_ids": ids} if ids else {})}


def _day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            pass
    return None


def _id(row: dict) -> str:
    return str(row.get("id") or row.get("_id") or "")


def _pence(row: dict) -> int:
    try:
        value = abs(float(row.get("amount") or 0))
        return round(value * 100) if math.isfinite(value) else 0
    except (TypeError, ValueError):
        return 0


def _category(row: dict) -> str:
    return normalise_name(row.get("custom_category") or row.get("category") or "Other")


def _destinations(record: dict) -> set[str]:
    if record.get("_kind") == "goal":
        pots = record.get("funding_pots")
        if isinstance(pots, list):
            return {str(p["account_id"]) for p in pots if p.get("account_id")}
        return {str(record["funding_account_id"])} if record.get("funding_account_id") else set()
    if record.get("destination_account_id"):
        return {str(record["destination_account_id"])}
    return set((record.get("category_tracking") or {}).get("destination_account_ids") or [])


def _rank(record: dict) -> tuple:
    created = record.get("created_at")
    if not isinstance(created, datetime):
        oid = record.get("_id")
        created = oid.generation_time if isinstance(oid, ObjectId) else datetime.max.replace(tzinfo=timezone.utc)
    return created.replace(tzinfo=None), str(record.get("_id") or "draft")


def _in_window(record: dict, day: date) -> bool:
    effective = _day(record.get("effective_from"))
    if effective and day < effective:
        return False
    if record.get("recurrence") == "once":
        start, end = _day(record.get("created_period_start")), _day(record.get("created_period_end"))
        return bool(start and end and start <= day <= end)
    return True


def _payment_matches(record: dict, row: dict, partner: dict | None) -> bool:
    if record.get("_kind") == "goal":
        rule = record.get("fill_rule") or {}
        target = row if record.get("source_account_id") == row.get("account_id") and row.get("transaction_type") == "debit" else None
    else:
        rule = record
        target = partner if partner and record.get("fill_account_id") == partner.get("account_id") else row
        if target.get("transaction_type") != "credit" or record.get("fill_account_id") != target.get("account_id"):
            target = None
    if not target or not _in_window(record, _day(target.get("date")) or date.min):
        return False
    match_type, value = rule.get("match_type"), rule.get("match_value")
    if match_type == "description_equals":
        return matches_equals(target.get("description"), value)
    return match_type == "description_contains" and matches_contains(value, target.get("description"), target.get("merchant_name"))


def _category_claims(record: dict, row: dict, partner: dict | None) -> bool:
    rule = record.get("category_tracking") or {}
    if not rule or record.get("source_account_id") != row.get("account_id") or _category(row) != normalise_name(rule.get("category") or ""):
        return False
    if not _in_window(record, _day(row.get("date")) or date.min):
        return False
    destinations = _destinations(record)
    return bool(partner and partner.get("account_id") in destinations) if destinations or record.get("_kind") == "goal" else partner is None


def summarise_activity(
    rows: list[dict], current: dict, rivals: list[dict], start: date, end: date,
    context: SpendingContext,
) -> dict:
    """Pure evidence reducer. Stable IDs deduplicate feeds; oldest category
    claimant wins, while an existing payment claim takes precedence. The
    current record keeps its own evidence when viewed or edited.
    """
    unique: dict[tuple, dict] = {}
    for row in rows:
        if _id(row) and _day(row.get("date")) and _pence(row):
            unique.setdefault((str(row.get("account_id")), _id(row)), row)
    records = list(unique.values())
    source = current.get("source_account_id")
    destinations = _destinations(current)
    transfers = bool(destinations) or current.get("_kind") == "goal"
    chosen = normalise_name(current["category_tracking"]["category"])
    hits: list[tuple[dict, int]] = []
    used_credits: set[tuple] = set()
    for row in sorted(records, key=lambda r: (_day(r["date"]), _id(r))):
        day = _day(row["date"])
        if row.get("account_id") != source or not (start <= day <= end) or _category(row) != chosen or not _in_window(current, day):
            continue
        linked = row.get("linked_goal_id")
        if linked and str(linked) != str(current.get("_id")):
            continue
        partner = None
        if transfers:
            if row.get("transaction_type") != "debit" or txn_flow(row, context).kind != MOVED:
                continue
            partner = next((c for c in records if
                c.get("account_id") in destinations and c.get("transaction_type") == "credit"
                and (str(c.get("account_id")), _id(c)) not in used_credits
                and _pence(c) == _pence(row) and abs((_day(c["date"]) - day).days) <= 1
                and start <= _day(c["date"]) <= end and txn_flow(c, context).kind == MOVED
            ), None)
            if partner is None:
                continue
            signed = _pence(row)
        else:
            flow = txn_flow(row, context)
            if flow.kind not in (SPEND, REFUND):
                continue
            signed = _pence(row) * (-1 if flow.kind == REFUND else 1)
        if any(_payment_matches(r, row, partner) for r in rivals):
            continue
        contenders = [current, *(r for r in rivals if _category_claims(r, row, partner))]
        if min(contenders, key=_rank) is not current:
            continue
        if partner:
            used_credits.add((str(partner.get("account_id")), _id(partner)))
        hits.append((row, signed))
    gross = sum(max(0, amount) for _, amount in hits)
    refunds = sum(max(0, -amount) for _, amount in hits)
    return {
        "category": current["category_tracking"]["category"],
        "mode": "transfers" if transfers else "spending",
        "period_start": start.isoformat(), "period_end": end.isoformat(),
        "count": len(hits), "gross": gross / 100, "refunds": refunds / 100,
        "amount": (gross - refunds) / 100,
        "items": [{"id": _id(row), "date": _day(row["date"]).isoformat(),
                   "label": str(row.get("merchant_name") or row.get("description") or "Payment"),
                   "amount": amount / 100} for row, amount in hits[:50]],
    }


async def category_activity(body: dict, uid: str) -> dict:
    kind = body.get("kind")
    if kind not in ("goal", "set-aside"):
        raise HTTPException(400, "Choose a goal or a set-aside.")
    accounts = await owned_account_map(uid)
    cid = body.get("commitment_id") if kind == "goal" else body.get("allocation_id")
    current = None
    if cid:
        try:
            oid = ObjectId(str(cid))
        except (InvalidId, TypeError):
            raise HTTPException(404, "Plan not found")
        col = commitments_col if kind == "goal" else allocations_col
        current = await col.find_one({"_id": oid, "user_id": uid})
        if current is None:
            raise HTTPException(404, "Plan not found")
        # Record views are bound to saved metadata. An editor explicitly asks
        # for a draft preview so route/category edits can be checked before
        # saving, retaining only the owned record's claim rank/once window.
        if body.get("preview") is not True:
            body = {
                "source_account_id": current.get("source_account_id"),
                "category": (current.get("category_tracking") or {}).get("category"),
                "destination_account_ids": list(_destinations({**current, "_kind": kind})),
            }
    tracking = await validate_tracking({"category": body.get("category"), "destination_account_ids": body.get("destination_account_ids", [])}, uid, account_map=accounts)
    destinations = set(tracking.get("destination_account_ids") or [])
    if kind == "set-aside" and len(destinations) > 1:
        raise HTTPException(400, "Choose one receiving account.")
    source = validate_source_account(body.get("source_account_id"), accounts, destinations)
    if source is None:
        raise HTTPException(400, "Choose a paying account first.")
    current = {**(current or {}), "_kind": kind, "source_account_id": source, "category_tracking": tracking}
    if kind == "set-aside":
        current["destination_account_id"] = next(iter(destinations), None)
    if kind == "goal":
        current["funding_pots"] = [{"account_id": aid} for aid in destinations]
    if body.get("effective_from") is not None:
        effective = _day(body["effective_from"])
        if effective is None:
            raise HTTPException(400, "Choose a valid start date.")
        current["effective_from"] = effective
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    start, end = get_pay_period_for_date(timeutil.user_today(), prefs.get("pay_period_config", {"type": "calendar_month"}))
    # A once-only allocation keeps its original window, not the latest config.
    if current.get("recurrence") == "once":
        start = _day(current.get("created_period_start")) or start
        end = _day(current.get("created_period_end")) or end
    period_end = end
    end = min(end, timeutil.user_today())
    lo = datetime.combine(start - timedelta(days=5), time.min)
    hi = datetime.combine(end + timedelta(days=5), time.max)
    query = {"user_id": uid, "date": {"$gte": lo, "$lte": hi}, "account_id": {"$in": list(accounts)}}
    projection = {key: 1 for key in ("amount", "date", "category", "custom_category", "transaction_type", "description", "merchant_name", "account_id", "linked_offline_account_id", "linked_goal_id", "currency")}
    rows = []
    for col in (transactions_col, yapily_transactions_col):
        part = await col.find(query, projection).to_list(MAX_ROWS + 1)
        rows.extend(part)
        if len(rows) > MAX_ROWS:
            raise HTTPException(422, "There is too much activity to check at once.")
    kinds = await get_category_kinds(uid)
    context = SpendingContext.from_docs(rows, kinds, await user_identity(uid), card_accounts_from_docs(list(accounts.values())))
    rivals = []
    for col, rival_kind, query in (
        (commitments_col, "goal", {"user_id": uid, "status": "active"}),
        (allocations_col, "set-aside", {"user_id": uid, "active": True}),
    ):
        for record in await col.find(query).to_list(None):
            if rival_kind == kind and record.get("_id") == current.get("_id"):
                continue
            rivals.append({**record, "_kind": rival_kind})
    result = summarise_activity(rows, current, rivals, start, end, context)
    result["period_end"] = period_end.isoformat()
    return result
