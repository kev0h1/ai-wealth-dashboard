"""Transaction read/write + auto-categorise endpoints."""
import asyncio
import re
import json
import uuid as uuid_lib
from datetime import datetime, timedelta
from typing import List, Optional
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
import httpx

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS, TAVILY_API_KEY
from app.core.models import Transaction
from app.db.collections import (
    transactions_col, accounts_col, yapily_accounts_col, yapily_transactions_col,
    mono_transactions_col, mpesa_transactions_col, statement_transactions_col,
    commitments_col, manual_accounts_col, teaching_events_col,
)
from app.services.categorisation import (
    RAW_TRUELAYER_CATEGORIES, VALID_CATEGORIES,
    apply_rules_bulk, rule_categorise, tavily_lookup_merchants,
    canonical_merchant_key, cache_merchant, user_allowed_categories,
    strip_date_fragments, LEADING_DATE_RE, build_rule_pattern,
)
from app.services.categories import get_category_kinds, is_non_spend
from app.services import response_cache

router = APIRouter(tags=["transactions"])


def _description_stem(desc: str) -> str:
    # Dates anywhere in the description change every cycle — never part of identity
    s = strip_date_fragments(desc.strip())
    s = re.sub(r'\s+[A-Z]{2,4}\s*$', '', s).strip()
    s = re.sub(r'\s+\d{6,}\s*$', '', s).strip()
    return s or strip_date_fragments(desc) or desc


def _doc_to_tx(d) -> Transaction:
    eff = d.get("custom_category") or d.get("category") or "Other"
    return Transaction(
        id=str(d["_id"]), category=eff, custom_category=d.get("custom_category"),
        **{k: v for k, v in d.items() if k not in ("_id", "category", "custom_category")},
    )


@router.get("/transactions/oldest")
async def oldest_transaction(user: dict = Depends(current_user)):
    """Date of the user's earliest transaction — lets the UI stop period
    navigation before it pages into empty pre-history."""
    uid = user["email"]
    oldest = None
    for col in (transactions_col, yapily_transactions_col,
                mono_transactions_col, statement_transactions_col):
        doc = await col.find_one({"user_id": uid}, {"date": 1}, sort=[("date", 1)])
        if doc and doc.get("date") and (oldest is None or doc["date"] < oldest):
            oldest = doc["date"]
    return {"date": oldest.strftime("%Y-%m-%d") if oldest else None}


async def _txn_source(account_id: str, uid: str):
    """Which collection holds this account's transactions."""
    if account_id.startswith("mono-"):
        return mono_transactions_col
    if account_id.startswith("mpesa-"):
        return mpesa_transactions_col
    if account_id.startswith("statement-"):
        return statement_transactions_col
    if await yapily_accounts_col.find_one({"_id": account_id, "user_id": uid}, {"_id": 1}):
        return yapily_transactions_col
    return transactions_col


def _category_clause(cat: str) -> dict:
    """Match on the effective category (custom_category overrides category)."""
    no_custom = {"custom_category": {"$in": [None, ""]}}
    if cat == "Other":
        return {"$or": [
            {"custom_category": "Other"},
            {**no_custom, "category": {"$in": [None, "", "Other"]}},
        ]}
    return {"$or": [{"custom_category": cat}, {**no_custom, "category": cat}]}


@router.get("/accounts/{account_id}/transactions")
async def get_transactions(
    account_id: str,
    page: int = 1,
    page_size: int = 20,
    q: Optional[str] = None,
    category: Optional[str] = None,
    days: Optional[int] = None,
    txn_type: Optional[str] = None,
    user: dict = Depends(current_user),
):
    """Paginated, searchable transaction list for one account.

    Pagination, search and category filtering are server-side so the payload
    stays constant no matter how much history accumulates."""
    uid       = user["email"]
    col       = await _txn_source(account_id, uid)
    page      = max(1, page)
    page_size = max(1, min(page_size, 100))

    base: dict = {"account_id": account_id, "user_id": uid}
    if days:
        base["date"] = {"$gte": datetime.now() - timedelta(days=days)}
    if txn_type in ("debit", "credit"):
        base["transaction_type"] = txn_type
    clauses = [base]
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        clauses.append({"$or": [
            {"description": rx}, {"merchant_name": rx},
            {"category": rx}, {"custom_category": rx},
        ]})
    if category:
        clauses.append(_category_clause(category))
    query = clauses[0] if len(clauses) == 1 else {"$and": clauses}

    total = await col.count_documents(query)
    docs  = await (
        col.find(query).sort("date", -1)
        .skip((page - 1) * page_size).limit(page_size)
        .to_list(page_size)
    )
    return {
        "items": [_doc_to_tx(d) for d in docs],
        "total": total,
        "page":  page,
        "pages": max(1, -(-total // page_size)),
    }


@router.get("/accounts/{account_id}/categories")
async def get_account_categories(
    account_id: str, days: int = 90, txn_type: str = "debit", user: dict = Depends(current_user),
):
    """Category rollup for one account, aggregated in Mongo so the client
    never needs the full transaction set. Defaults to debits (spend) so
    every existing caller is unchanged; pass txn_type=credit for the
    "money in" side (refunds, card payments, incoming transfers, etc.)."""
    if txn_type not in ("debit", "credit"):
        raise HTTPException(status_code=400, detail="txn_type must be 'debit' or 'credit'")
    uid    = user["email"]
    col    = await _txn_source(account_id, uid)
    cutoff = datetime.now() - timedelta(days=days)
    effective = {"$switch": {"branches": [
        {"case": {"$gt": ["$custom_category", ""]}, "then": "$custom_category"},
        {"case": {"$gt": ["$category", ""]}, "then": "$category"},
    ], "default": "Other"}}
    rows = await col.aggregate([
        {"$match": {"account_id": account_id, "user_id": uid,
                    "transaction_type": txn_type, "date": {"$gte": cutoff}}},
        {"$group": {"_id": effective,
                    "total": {"$sum": {"$abs": "$amount"}},
                    "count": {"$sum": 1}}},
        {"$sort": {"total": -1}},
    ]).to_list(None)
    total_spend = sum(r["total"] for r in rows)
    return [
        {"name": r["_id"], "total": round(r["total"], 2), "count": r["count"],
         "pct": (r["total"] / total_spend * 100) if total_spend > 0 else 0.0}
        for r in rows
    ]


@router.get("/transactions", response_model=List[Transaction])
async def all_transactions(days: int = 365, user: dict = Depends(current_user)):
    """Every transaction across all sources in one round-trip.

    Replaces the N+1 pattern where pages fetched per-account (23 calls for a
    23-account user) and filtered client-side."""
    uid    = user["email"]
    cutoff = datetime.now() - timedelta(days=min(days, 730))
    cols = (transactions_col, yapily_transactions_col,
            statement_transactions_col, mono_transactions_col, mpesa_transactions_col)
    results = await asyncio.gather(
        *(c.find({"user_id": uid, "date": {"$gte": cutoff}}).to_list(None) for c in cols)
    )
    docs: list = []
    for r in results:
        docs += r
    docs.sort(key=lambda d: d.get("date") or datetime.min, reverse=True)
    return [_doc_to_tx(d) for d in docs]


def _parse_date_bound(value: Optional[str], end_of_day: bool = False) -> Optional[datetime]:
    """Parse an ISO date (YYYY-MM-DD) or datetime string from a query param.
    Invalid/blank input is treated as absent rather than raising — an
    unparsable bound should widen to all history, not 500."""
    if not value or not value.strip():
        return None
    raw = value.strip()
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if end_of_day and len(raw) <= 10:  # date-only string — include the whole day
        dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
    return dt


def _search_query(
    uid: str, q: Optional[str], category: Optional[str], days: Optional[int],
    merchants: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    txn_type: Optional[str] = None,
    categories: Optional[List[str]] = None,
) -> dict:
    """Filter shared by every collection in the global search's gather —
    generalises the account-scoped `q` clause in `get_transactions` above
    to also match `merchant_key`, and drops the `account_id` scope.

    `merchants` is a comma-separated list of display names from an insight
    card's deep link (`_merchant_scoped_route`, savings_insights.py) — an
    OR across every name, each matched against description/merchant_name/
    merchant_key, so "see the payments behind this insight" lands on the
    exact evidence regardless of how the name is capitalised or formatted
    on the row.

    `date_from`/`date_to` are explicit ISO date bounds (the frontend already
    computes periodStart/periodEnd for the user's pay period, so the period
    maths stays client-side — this endpoint just accepts a plain range). They
    take priority over `days` when present, and still resolve to a `date`
    range on the same (user_id, date) compound index every other path here
    uses — no new index, no collection scan. Absent both, the query is
    unscoped by date (all history).

    `txn_type` is "debit" or "credit" — adds a straight equality clause on
    `transaction_type`, same as the account-scoped `get_transactions` route.
    Any other value (including absent) is ignored, so today's callers are
    unaffected. Applied query-side (not a post-filter) so pagination/counts
    stay correct.

    `categories` is a repeated-query-param list of exact category names (e.g.
    a "money you moved" deep link spanning Savings, Transfer, and any custom
    movement category — including one whose name legally contains a comma,
    which a delimited string could never represent unambiguously). When
    present and non-empty it wins outright and `category` is ignored; each
    name gets its own `_category_clause` and the results flatten into one
    `$or`. Otherwise `category` behaves exactly as it always has (a single
    exact name, no delimiter splitting)."""
    base: dict = {"user_id": uid}
    from_dt = _parse_date_bound(date_from)
    to_dt   = _parse_date_bound(date_to, end_of_day=True)
    if from_dt or to_dt:
        rng: dict = {}
        if from_dt:
            rng["$gte"] = from_dt
        if to_dt:
            rng["$lte"] = to_dt
        base["date"] = rng
    elif days:
        base["date"] = {"$gte": datetime.now() - timedelta(days=days)}
    if txn_type in ("debit", "credit"):
        base["transaction_type"] = txn_type
    clauses = [base]
    if q and q.strip():
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        clauses.append({"$or": [
            {"description": rx}, {"merchant_name": rx}, {"merchant_key": rx},
            {"category": rx}, {"custom_category": rx},
        ]})
    names = [c for c in (categories or []) if c]
    if names:
        clauses.append({"$or": [_category_clause(name) for name in names]})
    elif category:
        clauses.append(_category_clause(category))
    if merchants:
        names = [n.strip() for n in merchants.split(",") if n.strip()]
        if names:
            merchant_or: list[dict] = []
            for name in names:
                rx = {"$regex": re.escape(name), "$options": "i"}
                merchant_or += [{"description": rx}, {"merchant_name": rx}, {"merchant_key": rx}]
            clauses.append({"$or": merchant_or})
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _merge_paginate(per_collection: List[list], page: int, page_size: int) -> list:
    """Merge already date-desc-sorted, over-fetched legs from every source
    collection into one globally-ordered list and slice out the requested
    page.

    Per-collection skip/limit is wrong for a cross-collection feed: a 'skip
    40, limit 20' window on one collection has no relationship to the
    global date order across five. Instead each collection is over-fetched
    up to the same cutoff (page * page_size docs, already sorted desc) —
    the global top-K page can never draw more than K items from any single
    collection, so that cutoff is always sufficient — and the merge sorts
    and slices in Python."""
    merged: list = []
    for docs in per_collection:
        merged += docs
    merged.sort(key=lambda d: d.get("date") or datetime.min, reverse=True)
    start = (page - 1) * page_size
    return merged[start:start + page_size]


@router.get("/transactions/search")
async def search_transactions(
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    category: Optional[str] = None,
    categories: Optional[List[str]] = Query(None),
    merchants: Optional[str] = None,
    days: Optional[int] = None,
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    txn_type: Optional[str] = None,
    user: dict = Depends(current_user),
):
    """Global, paginated, searchable transaction list spanning every source
    a user has connected — the account-scoped search in `get_transactions`
    generalised for deep links and cross-account lookups ('every Playtomic
    payment', not just one account's').

    `from`/`to` (ISO dates, e.g. `2026-07-31`) scope the list to a pay
    period — the frontend computes periodStart/periodEnd and passes them
    straight through rather than this endpoint owning period maths. Optional;
    absent means all history, matching today's behaviour exactly.

    `categories` is the repeated-query-param form (`?categories=Savings&
    categories=Transfer`) for a multi-category deep link like "To your pots"
    (spans Savings, Transfer, and any custom movement category). Unlike a
    delimited string, this cannot be ambiguous when a custom category name
    legally contains a comma. When present and non-empty it wins outright and
    `category` is ignored; otherwise `category` is a single exact name,
    unchanged from its original behaviour (no delimiter splitting — see
    `_category_clause`). `txn_type` ("debit" or "credit") narrows to one
    direction, e.g. pairing with `categories` to show only the debits behind
    a "money you moved" bucket.

    Read-only: no writes, no categorisation side effects."""
    uid       = user["email"]
    page      = max(1, page)
    page_size = max(1, min(page_size, 100))
    fetch_n   = page * page_size

    query = _search_query(uid, q, category, days, merchants, date_from, date_to, txn_type, categories)
    cols  = (transactions_col, yapily_transactions_col,
             statement_transactions_col, mono_transactions_col, mpesa_transactions_col)

    counts, per_collection = await asyncio.gather(
        asyncio.gather(*(c.count_documents(query) for c in cols)),
        asyncio.gather(*(
            c.find(query).sort("date", -1).limit(fetch_n).to_list(fetch_n) for c in cols
        )),
    )
    total = sum(counts)
    items = _merge_paginate(list(per_collection), page, page_size)

    return {
        "items": [_doc_to_tx(d) for d in items],
        "total": total,
        "page":  page,
        "pages": max(1, -(-total // page_size)),
    }


@router.get("/transactions/{transaction_id}/similar", response_model=List[Transaction])
async def similar_transactions(transaction_id: str, scope: str = "all", user: dict = Depends(current_user)):
    ref = await transactions_col.find_one({"_id": transaction_id, "user_id": user["email"]})
    if not ref:
        raise HTTPException(404, "Transaction not found")

    merchant     = ref.get("merchant_name")
    description  = ref.get("description", "")
    txn_type     = ref.get("transaction_type", "debit")
    merchant_key = ref.get("merchant_key")

    match: dict = {
        "_id": {"$ne": transaction_id},
        "user_id": user["email"],
        "transaction_type": txn_type,
    }
    if merchant_key:
        # Indexed equality lookup on the stored identity field — this is the
        # ENGINE.md "Identity" fix: one merchant_key per merchant, computed at
        # sync time by canonical_merchant_key, so five differently-formatted
        # statement lines (dates, channel codes, reference tokens stripped)
        # all resolve to the same row here.
        #
        # The one-time backfill (scripts_merchant_key_backfill.py) has not
        # been run against real users yet, so plenty of historical rows for
        # this same merchant have no merchant_key field at all — an
        # equality-only match would silently drop all of them (fewer/zero
        # results than the old merchant_name path gave). Recompute the key
        # live for this user's rows that are missing it and fold in any that
        # match, so a post-deploy row still finds its pre-deploy history.
        # Bounded (not O(all-txns)): most-recent-first cap keeps this a fixed
        # amount of work per tap regardless of history size, pre-backfill.
        # This scan vanishes entirely once scripts_merchant_key_backfill.py
        # has run against real users.
        legacy_candidates = await transactions_col.find(
            {"_id": {"$ne": transaction_id}, "user_id": user["email"],
             "transaction_type": txn_type,
             "merchant_key": {"$in": [None, ""]}},
            {"merchant_name": 1, "description": 1},
        ).sort("date", -1).to_list(500)
        legacy_ids = [
            d["_id"] for d in legacy_candidates
            if canonical_merchant_key(d.get("merchant_name") or "", d.get("description") or "") == merchant_key
        ]
        match["$or"] = [{"merchant_key": merchant_key}, {"_id": {"$in": legacy_ids}}]
    elif merchant:
        # Fallback for rows that predate the merchant_key backfill.
        match["merchant_name"] = merchant
    else:
        stem = _description_stem(description)
        # "Similar to nothing" is an empty set, not everything — a blank stem
        # would otherwise regex-match every transaction the user has
        if len(stem.strip()) < 3:
            return []
        # Stored rows may carry a leading date fragment ('29MAY A/C …') —
        # allow it so the same bill matches across months
        match["description"] = re.compile(r'^\s*' + LEADING_DATE_RE + re.escape(stem), re.IGNORECASE)
    if scope == "future":
        match["date"] = {"$gte": ref["date"]}

    docs = await transactions_col.find(match).sort("date", -1).to_list(200)
    return [_doc_to_tx(d) for d in docs]


@router.patch("/transactions/{transaction_id}")
async def update_transaction(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    if "category" not in body:
        raise HTTPException(400, "Provide 'category' in body")
    category       = body["category"]
    additional_ids = body.get("additional_ids", [])

    await transactions_col.update_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"$set": {"custom_category": category}},
    )
    bulk_count = 0
    if additional_ids:
        result = await transactions_col.update_many(
            {"_id": {"$in": additional_ids}, "user_id": user["email"]},
            {"$set": {"custom_category": category}},
        )
        bulk_count = result.modified_count

    # Persist the correction to the learned merchant cache so it sticks across
    # syncs and generalises to the same merchant on future transactions.
    # A user's own custom category (Padel, Golf, ...) is accepted here too —
    # not just VALID_CATEGORIES — so the Two Inputs Rule holds for exactly the
    # categories the user cared enough to create. Custom-category writes are
    # always scoped to this user (uid=...); a VALID_CATEGORIES write MAY go
    # global, unchanged from today's behaviour, but only after cache_merchant's
    # own KIND and PERSON/REFERENCE gates both pass (the Firewall Rule: a
    # custom name is one user's private vocabulary and must never leak into
    # another user's global cache; the 2026-08-17 MAINGI KM incident: a
    # built-in category is not, by itself, proof the text is safe to share).
    is_valid = category in VALID_CATEGORIES
    is_custom = False
    if not is_valid:
        user_vocab = await user_allowed_categories(user["email"])
        is_custom = category in user_vocab
    if is_valid or is_custom:
        touched = await transactions_col.find(
            {"_id": {"$in": [transaction_id, *additional_ids]}, "user_id": user["email"]},
            {"merchant_name": 1, "description": 1},
        ).to_list(None)
        for d in touched:
            key = canonical_merchant_key(d.get("merchant_name") or "", d.get("description") or "")
            if len(key) >= 3:  # a blank key would "learn" a match-anything entry
                await cache_merchant(key, category, "user", uid=user["email"], prefer_global=is_valid)

    # ENGINE.md "Input Contract" — the propagation payload. Read the stored
    # sync-time identity field (stream 1's merchant_key; verified merged and
    # backfilled opportunistically below for legacy rows) so the caller can
    # show "matches N past payments" and propose a word-boundary-safe rule
    # without a second round-trip.
    primary_doc = await transactions_col.find_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"merchant_name": 1, "description": 1, "merchant_key": 1},
    )
    merchant_key    = ""
    matches_past    = 0
    rule_suggestion = None
    if primary_doc:
        merchant_key = primary_doc.get("merchant_key") or canonical_merchant_key(
            primary_doc.get("merchant_name") or "", primary_doc.get("description") or "",
        )
        if merchant_key and not primary_doc.get("merchant_key"):
            # Opportunistic backfill for a legacy row synced before the
            # merchant_key migration — cheap since we already touched this row.
            await transactions_col.update_one(
                {"_id": transaction_id, "user_id": user["email"]},
                {"$set": {"merchant_key": merchant_key}},
            )
        if merchant_key:
            matches_past = await transactions_col.count_documents({
                "user_id": user["email"], "merchant_key": merchant_key,
                "_id": {"$ne": transaction_id},
            })
            if is_valid or is_custom:
                pattern = build_rule_pattern(merchant_key)
                if pattern:
                    rule_suggestion = {"pattern": pattern, "category": category}

    # Category changes move money in/out of the Transfer exclusion and the
    # trusted recurring categories — refresh the upcoming-payments cache in the
    # background (same in-process fire-and-forget pattern the manual sync uses)
    from app.routers.analytics import compute_and_cache_cashflow
    import asyncio as _asyncio
    _asyncio.create_task(compute_and_cache_cashflow(user["email"], clear_ai_cache=False))

    # Category changes can flip a row in/out of the miscategorised-transfers
    # guardrail (auto vs. manual override into/out of a spend category) —
    # invalidate so the flag/sheet reflects the change immediately.
    # ainvalidate already wipes the WHOLE memory layer (not just these three
    # names) and awaits the version bump, so the three named drops that used
    # to precede it were redundant — removed.
    await response_cache.ainvalidate(user["email"])

    # ENGINE.md "The One Stream Rule" — every teaching write appends to the
    # same uniform event feed, user-scoped (Firewall Rule).
    await teaching_events_col.insert_one({
        "user_id": user["email"], "type": "correction",
        "transaction_id": transaction_id, "merchant_key": merchant_key or None,
        "payload": {"category": category, "additional_ids": additional_ids,
                    "bulk_count": bulk_count},
        "created_at": datetime.utcnow(),
    })

    return {
        "updated": transaction_id, "custom_category": category, "bulk_count": bulk_count,
        "merchant_key": merchant_key, "matches_past": matches_past,
        "rule_suggestion": rule_suggestion,
    }


def _try_oid(v: str):
    try:
        return ObjectId(v)
    except (InvalidId, TypeError):
        return v


# Generic movement-kind category applied by every "mine-*" resolution. Per
# ENGINE.md's Destination Rule, movement never gets a bespoke category name —
# it resolves to a destination (a goal or an offline pot) in the pot ledger,
# and the category here only exists so the arithmetic knows "not spend".
_MOVEMENT_CATEGORY = "Transfer"
_MOVEMENT_RESOLUTIONS = {"mine-here", "mine-goal", "mine-offline", "someone-else", "spending"}


async def _log_teaching_event(
    uid: str, event_type: str, *, transaction_id: Optional[str] = None,
    merchant_key: Optional[str] = None, payload: Optional[dict] = None,
) -> None:
    await teaching_events_col.insert_one({
        "user_id": uid, "type": event_type,
        "transaction_id": transaction_id, "merchant_key": merchant_key or None,
        "payload": payload or {}, "created_at": datetime.utcnow(),
    })


@router.post("/transactions/{transaction_id}/resolve-movement")
async def resolve_movement(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    """The movement fork of the teaching sheet (ENGINE.md Destination Rule) —
    "is this account yours?" for a payment that looks like it left for
    somewhere the engine can't see.

    resolution:
      mine-here     — another account of the user's THAT THE ENGINE ALREADY
                      SEES (both legs are connected accounts). The transfer
                      matcher already ran at sync and failed to pair this row
                      with its counterpart (descriptions differ between legs),
                      so this resolution doesn't search for one either — it
                      just files the row as movement. No linking (no goal, no
                      offline pot), unlike mine-goal/mine-offline.
      mine-goal     — funds an existing commitment/goal. Recategorised as
                      movement AND linked, but only when that goal actually
                      exists for this user; otherwise 404 (no half-linked state).
      mine-offline  — an account of the user's the engine can't see. Creates
                      (or reuses, by case-insensitive name) an offline pot via
                      the existing goals-v2 machinery (manual_accounts_col) and
                      links the transaction to it. Full linking IS shipped
                      here — manual_accounts_col already supports exactly this
                      "account of mine elsewhere, no goal attached" case.
      someone-else  — money left the household for someone else's account
                      (the WISE-remittance case). Keeps whatever spend-kind
                      category the row already carries — never forced into
                      movement (no destination of the user's exists) and never
                      forced into ordinary consumption category semantics
                      either. The only write is a user-scoped fact on the
                      teaching-event stream (Firewall Rule: never global).
                      UI no longer offers this (owner decision 2026-08-23,
                      it duplicated "no, this was spending" confusingly);
                      endpoint kept for API compatibility.
      spending      — normal correction path. An optional `category` behaves
                      exactly like PATCH /transactions/{id}; omitted, it just
                      undoes a previous movement mis-resolution so the row
                      falls back to the ordinary category picker.
    """
    uid = user["email"]
    resolution = body.get("resolution")
    if resolution not in _MOVEMENT_RESOLUTIONS:
        raise HTTPException(400, f"resolution must be one of: {', '.join(sorted(_MOVEMENT_RESOLUTIONS))}")

    doc = await transactions_col.find_one({"_id": transaction_id, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Transaction not found")

    if resolution in ("mine-here", "mine-goal", "mine-offline") and doc.get("transaction_type") != "debit":
        # A movement resolution files the row under the movement-kind
        # _MOVEMENT_CATEGORY (Transfer), which the arithmetic then excludes
        # from both spend and income totals. That's only correct for money
        # leaving the account (a debit) — forcing an inflow into it would
        # silently drop real income from Safe-to-Spend / income totals.
        raise HTTPException(400, "Movement resolution only applies to outgoing payments")

    merchant_key = doc.get("merchant_key") or canonical_merchant_key(
        doc.get("merchant_name") or "", doc.get("description") or "",
    )

    result: dict = {"updated": transaction_id, "resolution": resolution}
    category_changed = False

    if resolution == "mine-here":
        # No counterpart search, no linking — the transfer matcher already
        # ran at sync and failed to pair this row (descriptions differ
        # between legs), so this resolution doesn't try again. It just files
        # the row as plain movement, same $unset hygiene as the other
        # mine-* branches so a prior goal/offline link doesn't linger.
        await transactions_col.update_one(
            {"_id": transaction_id, "user_id": uid},
            {"$set": {"custom_category": _MOVEMENT_CATEGORY},
             "$unset": {"linked_goal_id": "", "linked_offline_account_id": ""}},
        )
        category_changed = True
        result["custom_category"] = _MOVEMENT_CATEGORY
        await _log_teaching_event(
            uid, "movement_mine_here", transaction_id=transaction_id, merchant_key=merchant_key,
        )

    elif resolution == "mine-goal":
        goal_id = body.get("goal_id")
        if not goal_id:
            raise HTTPException(400, "goal_id is required for resolution=mine-goal")
        goal = await commitments_col.find_one(
            {"_id": _try_oid(goal_id), "user_id": uid}, {"name": 1},
        )
        if not goal:
            raise HTTPException(404, "Goal not found")
        await transactions_col.update_one(
            {"_id": transaction_id, "user_id": uid},
            {"$set": {"custom_category": _MOVEMENT_CATEGORY, "linked_goal_id": str(goal["_id"])}},
        )
        category_changed = True
        result["custom_category"] = _MOVEMENT_CATEGORY
        result["linked_goal_id"]  = str(goal["_id"])
        await _log_teaching_event(
            uid, "movement_mine_goal", transaction_id=transaction_id, merchant_key=merchant_key,
            payload={"goal_id": str(goal["_id"]), "goal_name": goal.get("name")},
        )

    elif resolution == "mine-offline":
        pot_name = (body.get("offline_pot_name") or "").strip()[:60] or "An account of mine elsewhere"
        existing = await manual_accounts_col.find_one({
            "user_id": uid,
            "name": {"$regex": f"^{re.escape(pot_name)}$", "$options": "i"},
        })
        if existing:
            account_id = existing["_id"]
        else:
            account_id = str(uuid_lib.uuid4())[:8]
            await manual_accounts_col.insert_one({
                "_id": account_id, "user_id": uid,
                "name": pot_name, "balance": 0.0, "account_type": "savings",
                "created_at": datetime.now(), "updated_at": datetime.now(),
            })
        await transactions_col.update_one(
            {"_id": transaction_id, "user_id": uid},
            {"$set": {"custom_category": _MOVEMENT_CATEGORY, "linked_offline_account_id": account_id}},
        )
        category_changed = True
        result["custom_category"]            = _MOVEMENT_CATEGORY
        result["linked_offline_account_id"]  = account_id
        result["offline_pot_name"]           = pot_name
        await _log_teaching_event(
            uid, "movement_mine_offline", transaction_id=transaction_id, merchant_key=merchant_key,
            payload={"offline_account_id": account_id, "offline_pot_name": pot_name},
        )

    elif resolution == "someone-else":
        # UI no longer offers this (owner decision 2026-08-23); kept for API
        # compatibility.
        note = (body.get("note") or "").strip()[:50]
        await _log_teaching_event(
            uid, "movement_someone_else", transaction_id=transaction_id, merchant_key=merchant_key,
            payload={"note": note} if note else {},
        )

    else:  # resolution == "spending"
        category = body.get("category")
        if category:
            is_valid = category in VALID_CATEGORIES
            is_custom = False
            if not is_valid:
                is_custom = category in await user_allowed_categories(uid)
            if not (is_valid or is_custom):
                raise HTTPException(400, "Invalid category")
            await transactions_col.update_one(
                {"_id": transaction_id, "user_id": uid},
                {"$set": {"custom_category": category},
                 "$unset": {"linked_goal_id": "", "linked_offline_account_id": ""}},
            )
            if len(merchant_key) >= 3:
                # A built-in category MAY go global, but only after
                # cache_merchant's KIND and PERSON/REFERENCE gates both pass.
                await cache_merchant(merchant_key, category, "user", uid=uid, prefer_global=is_valid)
            category_changed = True
            result["custom_category"] = category
        else:
            # No category given — undo a previous movement mis-resolution so
            # the row falls back to the ordinary categorisation pipeline (the
            # "No — this was spending / opens the category picker" UI step).
            kinds   = await get_category_kinds(uid)
            current = doc.get("custom_category") or doc.get("category")
            if current and is_non_spend(kinds, current):
                await transactions_col.update_one(
                    {"_id": transaction_id, "user_id": uid},
                    {"$set": {"custom_category": None},
                     "$unset": {"linked_goal_id": "", "linked_offline_account_id": ""}},
                )
                category_changed = True
                result["custom_category"] = None
        await _log_teaching_event(
            uid, "movement_spending", transaction_id=transaction_id, merchant_key=merchant_key,
            payload={"category": category} if category else {},
        )

    if category_changed:
        from app.routers.analytics import compute_and_cache_cashflow
        import asyncio as _asyncio
        _asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))
        response_cache.invalidate(uid, "miscategorised_count")
        response_cache.invalidate(uid, "miscategorised_list")
        response_cache.invalidate(uid, "transfer_pair_suggestions")

    return result


@router.patch("/transactions/{transaction_id}/planned")
async def set_transaction_planned(transaction_id: str, body: dict, user: dict = Depends(current_user)):
    planned = bool(body.get("planned", True))
    result  = await transactions_col.update_one(
        {"_id": transaction_id, "user_id": user["email"]},
        {"$set": {"planned": planned}},
    )
    if result.matched_count == 0:
        await yapily_transactions_col.update_one(
            {"_id": transaction_id, "user_id": user["email"]},
            {"$set": {"planned": planned}},
        )
    return {"updated": transaction_id, "planned": planned}


@router.post("/transactions/auto-categorise")
async def auto_categorise(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    user: dict = Depends(current_user),
):
    uid = user["email"]
    await transactions_col.update_many(
        {"user_id": uid, "category": "Other", "custom_category": None, "ai_attempted": True},
        {"$unset": {"ai_attempted": ""}},
    )
    rules_fixed = await apply_rules_bulk(uid, structural=True)

    try:
        start_dt = datetime.fromisoformat(from_date) if from_date else None
        end_dt   = datetime.fromisoformat(to_date)   if to_date   else None
    except ValueError as e:
        raise HTTPException(400, f"Invalid date format: {e}")

    date_filter: dict = {}
    if start_dt:
        date_filter["$gte"] = start_dt
    if end_dt:
        date_filter["$lte"] = end_dt

    query: dict = {
        "user_id": uid, "custom_category": None,
        "$or": [
            {"category": None}, {"category": "Other"},
            {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}},
        ],
    }
    if date_filter:
        query["date"] = date_filter

    uncategorised = await transactions_col.find(query).to_list(1000)
    if not uncategorised:
        # apply_rules_bulk above may already have changed categories even
        # though nothing further needs AI — invalidate before every exit,
        # not just the final one.
        await response_cache.ainvalidate(uid)
        return {"rules_fixed": rules_fixed, "ai_categorised": 0}

    historical = await transactions_col.find(
        {"user_id": uid,
         "$or": [{"custom_category": {"$ne": None}},
                 {"category": {"$nin": list(RAW_TRUELAYER_CATEGORIES) + [None]}}]},
        {"merchant_name": 1, "description": 1, "category": 1, "custom_category": 1, "transaction_type": 1},
    ).to_list(None)

    merchant_map: dict[tuple[str, str], str] = {}
    for h in historical:
        cat = h.get("custom_category") or h.get("category")
        if not cat or cat in RAW_TRUELAYER_CATEGORIES:
            continue
        txn_type = h.get("transaction_type", "")
        for key in [h.get("merchant_name"), h.get("description")]:
            if key:
                norm    = re.sub(r'\s+', ' ', key.strip().lower())
                map_key = (norm, txn_type)
                if norm and map_key not in merchant_map:
                    merchant_map[map_key] = cat

    needs_ai: list = []
    history_matched = 0
    for t in uncategorised:
        txn_type = t.get("transaction_type", "")
        matched  = None
        for key in [t.get("merchant_name"), t.get("description")]:
            if key:
                norm = re.sub(r'\s+', ' ', key.strip().lower())
                if (norm, txn_type) in merchant_map:
                    matched = merchant_map[(norm, txn_type)]
                    break
        if matched:
            await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": matched}})
            history_matched += 1
        else:
            needs_ai.append(t)

    if not needs_ai or not OPENROUTER_API_KEY:
        await response_cache.ainvalidate(uid)
        return {"rules_fixed": rules_fixed, "history_matched": history_matched, "ai_categorised": 0}

    manual = await transactions_col.find(
        {"user_id": uid, "custom_category": {"$ne": None}},
        {"merchant_name": 1, "description": 1, "custom_category": 1},
    ).limit(50).to_list(50)
    example_block = ""
    if manual:
        lines_ex = "\n".join(
            f'  "{(e.get("merchant_name") or e.get("description", ""))[:50]}" → {e["custom_category"]}'
            for e in manual
        )
        example_block = f"User-confirmed examples (follow these patterns):\n{lines_ex}\n\n"

    unknown_merchants = list({
        name for t in needs_ai
        if (name := (t.get("merchant_name") or "").strip()) and 2 < len(name) < 50
        and not re.search(r'\d{6,}', name)
    })
    tavily_info = await tavily_lookup_merchants(unknown_merchants) if TAVILY_API_KEY else {}

    ai_total = 0
    for i in range(0, len(needs_ai), 30):
        batch = needs_ai[i:i + 30]
        lines = "\n".join(
            f'{j}: merchant="{t.get("merchant_name") or ""}" '
            f'desc="{t.get("description", "")[:80]}" '
            f'amount=£{t["amount"]:.2f} type={t.get("transaction_type", "debit")}'
            + (f' [web: {tavily_info[t.get("merchant_name") or t.get("description", "")][:120]}]'
               if (t.get("merchant_name") or t.get("description", "")) in tavily_info else "")
            for j, t in enumerate(batch)
        )
        prompt = (
            f"You are an expert UK personal finance categoriser. "
            f"Assign each transaction to exactly one category from this list: {', '.join(VALID_CATEGORIES)}.\n\n"
            f"Rules:\n"
            f"- Use the merchant name and description to determine WHAT the business/service is.\n"
            f"- Ignore payment method words (direct debit, standing order, purchase, faster payment, BACS).\n"
            f"- '[web: ...]' entries contain a web search result about the merchant.\n"
            f"- 'Other' is a last resort.\n"
            f"- Credits to a current account are usually 'Income' or 'Transfer'.\n"
            f"- UK-specific: Monzo pots, Starling spaces, Marcus savings = 'Savings'; Amex/Barclaycard payments = 'Debt'.\n\n"
            f"Reply with ONLY a JSON object mapping index to category, e.g. {{\"0\": \"Groceries\", \"1\": \"Transport\"}}.\n\n"
            f"{example_block}Transactions:\n{lines}"
        )
        try:
            async with httpx.AsyncClient(timeout=45) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                             "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
                    json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 600,
                          "messages": [{"role": "user", "content": prompt}],
                          "provider": OPENROUTER_PROVIDER_PREFS},
                )
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                m = re.search(r"\{.*\}", content, re.DOTALL)
                if m:
                    mapping = json.loads(m.group())
                    for k, cat in mapping.items():
                        if k.isdigit() and int(k) < len(batch):
                            final_cat = cat if cat in VALID_CATEGORIES else "Other"
                            await transactions_col.update_one(
                                {"_id": batch[int(k)]["_id"]}, {"$set": {"category": final_cat}}
                            )
                            ai_total += 1
            for t in batch:
                doc = await transactions_col.find_one(
                    {"_id": t["_id"], "$or": [{"category": None},
                     {"category": {"$in": list(RAW_TRUELAYER_CATEGORIES)}}]}, {"_id": 1}
                )
                if doc:
                    await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": "Other"}})
        except Exception:
            for t in batch:
                await transactions_col.update_one({"_id": t["_id"]}, {"$set": {"category": "Other"}})

    await response_cache.ainvalidate(uid)
    return {"rules_fixed": rules_fixed, "history_matched": history_matched, "ai_categorised": ai_total}
