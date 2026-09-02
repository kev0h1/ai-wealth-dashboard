"""Allocations — simple per-pay-period envelopes.

Owner decision, 2026-08-29 (verbatim): "it's merely an allocation, we don't
need to compute anything, just create an allocation, it deducts from what's
available and have specific transaction fill it, it should be a per period
concept." Deliberately simple — no detection, no projection, no cleverness.

Owner correction, 2026-08-29 (verbatim): "this is very specific, I was
thinking we could do it off the transaction because there could be a lot of
transactions coming into that account." v1 filled from ANY credit landing in
the chosen account; a busy account's unrelated credits would pollute the
envelope. v2 filled from a specific TRANSACTION SERIES instead.

Owner correction, 2026-08-29 (verbatim, second round): "an allocation isn't
necessarily every month, it can be just once." v3 added `recurrence`:
"every_period" behaves as above, forever. "once" applies ONLY to the pay
period in which it was created — `created_period_start`/`created_period_end`
are persisted at creation time (the boundary is FIXED, never re-derived from
today's date or a since-changed pay-period config). While today falls inside
that fixed window a "once" allocation fills and reserves exactly like
"every_period"; once today is past `created_period_end` it is `completed` —
it reserves NOTHING (never blocks safe-to-spend again) and is EXCLUDED from
the one-active-allocation rule (a completed once-off does not block a new
allocation reusing its rule), but the record is kept, never deleted, so
history stays honest and the card can show "done".

Owner decision, 2026-08-29 (verbatim, on matching): "the same rule we have
for the offline account is what we should reuse here, can be exact match or
contains, and the effective date can be selected or choose the start of the
payment period." v4 replaces series-key fill matching (matching a
transaction's whole recurrence series via `series_key()`) with the SAME
description-rule mechanism `manual_account_rules.py` uses for offline
accounts: `match_type` ("description_equals" | "description_contains") +
`match_value`. Category-type rules are deliberately NOT offered here — an
envelope fills from a specific payment, not a whole spend category. The
equals/contains comparison itself is extracted into
`app/services/description_match.py` and imported by both this module and
manual_account_rules.py, so the two rule systems cannot drift apart.

`effective_from` (v4): the date from which fill-matching starts counting,
defaulting to the CURRENT pay period's start at creation (i.e. by default,
behaviour is unchanged — every credit in the period counts). Setting it to a
later date mid-period excludes earlier credits in that same period. Setting
it to a future date is allowed — the allocation is then `pending` until the
period containing `effective_from` arrives: `remaining` is 0 and nothing is
reserved (exactly like a `completed` once-off reserves nothing, but for the
opposite reason — this one hasn't started yet, not finished). For "once"
allocations the fixed fill window becomes
`[max(created_period_start, effective_from), created_period_end]`.

An Allocation is a user-declared envelope: {name, amount per period, fill
account, fill rule}. Each pay period it starts empty; CREDIT transactions
landing in `fill_account_id` during the CURRENT pay period, on/after
`effective_from`, matching the rule (`match_type`/`match_value`), fill it.
Only the UNFILLED REMAINDER (max(0, amount_per_period - filled_this_period))
ever reduces "what's available" anywhere. Filled money has already left the
balance pool (it is sitting, spent, in the fill account) — subtracting the
full amount on top of an already-reduced balance would double-count it. This
is the double-count guard and it is the reason `remaining`, never
`amount_per_period`, is what every integration point below subtracts.

Storage (allocations_col): {_id, user_id, name (str<=40), amount_per_period
(float, >0), fill_account_id (str — one of the user's own accounts),
match_type ("description_equals" | "description_contains"), match_value
(str<=120), fill_display_name (str — cleaned label for the UI, e.g. "Saving
Challenge (2026)", defaults to match_value when not separately given),
effective_from (UTC datetime, date-only precision — the fixed date fills
start counting from), recurrence ("every_period" | "once"),
created_period_start / created_period_end (UTC datetime, ONLY set when
recurrence == "once" — the fixed boundary of the one period this allocation
ever applies to), active (bool), created_at (UTC datetime)}.

The allocations collection was emptied ahead of the v4 change (schema
changed freely, no migration needed).

Real first use: the owner drips daily into a Monzo savings pot ("Saving
Challenge (2026)", ~£9/day, one clean transaction description).
"""
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import current_user
from app.db.collections import (
    accounts_col,
    allocations_col,
    manual_accounts_col,
    preferences_col,
    transactions_col,
    yapily_accounts_col,
    yapily_transactions_col,
)
from app.services import response_cache
from app.services.categories import clean_name
from app.services.categorisation import series_key
from app.services.description_match import matches_contains, matches_equals
from app.services.pay_period import get_pay_period_for_date

logger = logging.getLogger(__name__)

router = APIRouter(tags=["allocations"])

_MAX_NAME = 40
_MAX_AMOUNT = 1_000_000
_MAX_DISPLAY_NAME = 60
_MAX_MATCH_VALUE = 120
_FILL_CANDIDATES_WINDOW_DAYS = 90
_MATCH_TYPES = {"description_equals", "description_contains"}


# ── Helpers ────────────────────────────────────────────────────────────────

def _try_oid(v: str):
    try:
        return ObjectId(v)
    except (InvalidId, TypeError):
        return v


async def _account_owned(uid: str, account_id: str) -> bool:
    """True if `account_id` is one of `uid`'s own accounts (connected via
    TrueLayer/Finexer/Yapily, or a manual offline account) — same account
    universe commitments.py's funding pots draw from (see
    commitments._pot_kind), plus an explicit user_id ownership check."""
    oid = _try_oid(account_id)
    ids = {oid, account_id} if oid != account_id else {account_id}
    for col in (accounts_col, yapily_accounts_col, manual_accounts_col):
        for _id in ids:
            if await col.find_one({"_id": _id, "user_id": uid}, {"_id": 1}):
                return True
    return False


async def _pay_cfg(uid: str) -> dict:
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    return prefs.get("pay_period_config", {"type": "calendar_month"})


def _validate_name(raw) -> str:
    name = str(raw or "").strip()
    if not name or len(name) > _MAX_NAME:
        raise HTTPException(400, f"name must be 1-{_MAX_NAME} characters")
    return name


def _validate_amount(raw) -> float:
    try:
        amount = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount_per_period must be a number")
    if not (0 < amount <= _MAX_AMOUNT):
        raise HTTPException(400, f"amount_per_period must be between 0 and {_MAX_AMOUNT}")
    return round(amount, 2)


def _validate_match_type(raw) -> str:
    val = str(raw or "").strip()
    if val not in _MATCH_TYPES:
        raise HTTPException(400, "match_type must be 'description_equals' or 'description_contains'")
    return val


def _validate_match_value(raw) -> str:
    val = str(raw or "").strip()
    if not val:
        raise HTTPException(400, "match_value required")
    return val[:_MAX_MATCH_VALUE]


def _validate_display_name(raw, fallback: str) -> str:
    """`fill_display_name` = the cleaned match_value unless a display name is
    separately given (owner spec: "fill_display_name = match_value (cleaned)
    unless separately provided")."""
    source = str(raw or "").strip() or fallback
    name = clean_name(source)
    if not name:
        raise HTTPException(400, "fill_display_name required")
    return name[:_MAX_DISPLAY_NAME]


def _validate_effective_from(raw, default: date) -> date:
    """A plain date. Absent/empty defaults to `default` (the current pay
    period's start at creation — see module docstring). Future dates are
    allowed (the allocation becomes `pending` until its period arrives)."""
    if raw is None or str(raw).strip() == "":
        return default
    s = str(raw).strip()
    try:
        if len(s) > 10:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, "Invalid effective_from")


_RECURRENCES = {"every_period", "once"}


def _validate_recurrence(raw) -> str:
    val = str(raw or "").strip().lower()
    if val not in _RECURRENCES:
        raise HTTPException(400, "recurrence must be 'every_period' or 'once'")
    return val


def _is_completed(doc: dict) -> bool:
    """A "once" allocation is completed once today is past the fixed
    `created_period_end` boundary set at creation — it then reserves
    nothing and no longer counts as a claimant of its rule. "every_period"
    allocations are never completed."""
    if doc.get("recurrence", "every_period") != "once":
        return False
    end = doc.get("created_period_end")
    if end is None:
        return False
    if isinstance(end, datetime):
        end = end.date()
    return date.today() > end


def _as_date(value, default: date) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return default


def _txn_display_name(t: dict) -> str:
    """Human label for a transaction — merchant_name when present, else the
    raw description, whitespace-cleaned only (no aggressive stripping: the
    owner's real payment label is already clean and should survive
    unchanged)."""
    return clean_name((t.get("merchant_name") or "").strip() or (t.get("description") or ""))


def _rule_matches(match_type: str, match_value: str, txn: dict) -> bool:
    """Reuses the SAME equals/contains semantics as the offline-account
    mirror rules (manual_account_rules.py), via app/services/description_match
    — the shared helper both modules import so the two rule systems cannot
    drift apart. Category rules are not offered here (see module docstring)."""
    if match_type == "description_equals":
        return matches_equals(txn.get("description"), match_value)
    if match_type == "description_contains":
        return matches_contains(match_value, txn.get("description"), txn.get("merchant_name"))
    return False


async def matching_fills_this_period(
    uid: str, account_id: str, match_type: str, match_value: str, start: date, end: date
) -> list[dict]:
    """The individual credit transactions landing on `account_id` within
    [start, end] inclusive AND matching the (match_type, match_value) rule
    (the same description-rule mechanism the offline accounts use), across
    both txn collections, user-scoped — the raw docs `filled_this_period`
    sums. Split out so a second consumer (companion.py's direct fill-leg
    pairing fallback, part of the envelope-source-reservation fix,
    2026-08-31) can pair against the ACTUAL transactions rather than just
    their total, without re-deriving this query or the rule-matching logic.

    An inverted window (start > end — e.g. a `pending` allocation whose
    effective_from falls after the period being evaluated) has no valid
    dates and always returns []; short-circuited here rather than relying
    on an empty Mongo range to do the right thing.
    """
    if start > end:
        return []
    start_dt = datetime(start.year, start.month, start.day)
    end_dt = datetime(end.year, end.month, end.day, 23, 59, 59)
    q = {
        "user_id": uid,
        "account_id": account_id,
        "transaction_type": "credit",
        "date": {"$gte": start_dt, "$lte": end_dt},
    }
    proj = {"amount": 1, "merchant_name": 1, "description": 1, "date": 1}
    out: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        for t in await col.find(q, proj).to_list(None):
            if not _rule_matches(match_type, match_value, t):
                continue
            out.append(t)
    return out


async def filled_this_period(
    uid: str, account_id: str, match_type: str, match_value: str, start: date, end: date
) -> float:
    """Sum of credit transactions landing on `account_id` within
    [start, end] inclusive AND matching the (match_type, match_value) rule
    — see `matching_fills_this_period`, which this now just sums."""
    fills = await matching_fills_this_period(uid, account_id, match_type, match_value, start, end)
    return round(sum(abs(float(t.get("amount", 0) or 0)) for t in fills), 2)


async def _serialise(doc: dict, start: date, end: date) -> dict:
    amount = float(doc.get("amount_per_period") or 0)
    recurrence = doc.get("recurrence", "every_period")

    # "once" allocations use their OWN fixed boundary (persisted at create
    # time), never the caller's current-period start/end — that's the whole
    # point of the fixed boundary (see module docstring). "every_period"
    # allocations use whatever period the caller is asking about (today's,
    # normally).
    if recurrence == "once":
        c_start = doc.get("created_period_start")
        c_end = doc.get("created_period_end")
        eff_start = c_start.date() if isinstance(c_start, datetime) else (c_start or start)
        eff_end = c_end.date() if isinstance(c_end, datetime) else (c_end or end)
    else:
        eff_start, eff_end = start, end

    completed = _is_completed(doc)

    # effective_from is a FIXED date chosen at creation (defaults to that
    # period's start — see module docstring), independent of which period
    # is being evaluated. Docs written before this field existed (defensive
    # default) behave exactly as if effective_from == eff_start, i.e. the
    # pre-effective_from behaviour, unchanged.
    effective_from = _as_date(doc.get("effective_from"), eff_start)
    window_start = max(eff_start, effective_from)
    window_end = eff_end

    # Pending: the period being evaluated ends before effective_from even
    # begins — the reserve hasn't started yet. Completed takes priority (a
    # finished once-off is never "pending", it's just done).
    pending = (not completed) and effective_from > eff_end

    # `filled_this_period` is always computed truthfully, completed or not —
    # only `remaining` is forced to 0 for completed/pending allocations (the
    # double-count guard: see module docstring).
    filled = await filled_this_period(
        doc["user_id"], doc["fill_account_id"],
        doc.get("match_type"), doc.get("match_value", ""),
        window_start, window_end,
    )
    remaining = 0.0 if (completed or pending) else round(max(0.0, amount - filled), 2)
    return {
        "id":                  str(doc["_id"]),
        "name":                doc.get("name"),
        "amount_per_period":   amount,
        "fill_account_id":     doc.get("fill_account_id"),
        "match_type":          doc.get("match_type"),
        "match_value":         doc.get("match_value"),
        "fill_display_name":   doc.get("fill_display_name"),
        "effective_from":      effective_from.isoformat(),
        "recurrence":          recurrence,
        "completed":           completed,
        "pending":             pending,
        "active":              bool(doc.get("active", True)),
        "filled_this_period":  filled,
        "remaining":           remaining,
        "period_start":        eff_start.isoformat(),
        "period_end":          eff_end.isoformat(),
        # Penny Agent Mode v1 origin badge (owner decision, 2026-08-30):
        # "penny" when this allocation was created via a Penny proposal
        # (app.routers.can_i's execute_proposal stamps it right after
        # POST /allocations returns), absent/None for an ordinary
        # AllocationSheet save.
        "created_via":         doc.get("created_via"),
    }


async def _list_enriched(uid: str, *, active_only: bool) -> list[dict]:
    q = {"user_id": uid, "active": True} if active_only else {"user_id": uid}
    docs = await allocations_col.find(q).to_list(None)
    if not docs:
        return []
    cfg = await _pay_cfg(uid)
    start, end = get_pay_period_for_date(date.today(), cfg)
    return [await _serialise(doc, start, end) for doc in docs]


async def list_active_allocations(uid: str) -> list[dict]:
    """Enriched active allocations — attached live to GET /cashflow (see
    analytics.get_cashflow) so a mid-period fill or a newly created
    allocation is reflected on the next request without a cache rebuild."""
    return await _list_enriched(uid, active_only=True)


async def total_reserved_remaining(uid: str) -> tuple[float, int]:
    """(sum of `remaining` across ACTIVE allocations this pay period, count).

    Called by analytics.compute_safe_to_spend to reserve unfilled envelope
    money before the verdict is derived — see the double-count guard note
    in this module's docstring for why `remaining`, not `amount_per_period`,
    is what gets subtracted.
    """
    items = await list_active_allocations(uid)
    if not items:
        return 0.0, 0
    return round(sum(i["remaining"] for i in items), 2), len(items)


async def _get_owned(uid: str, allocation_id: str) -> dict:
    try:
        oid = ObjectId(allocation_id)
    except (InvalidId, TypeError):
        raise HTTPException(404, "Allocation not found")
    doc = await allocations_col.find_one({"_id": oid, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Allocation not found")
    return doc


async def _conflicts(uid: str, fill_account_id: str, match_type: str, match_value: str, *, exclude_id=None) -> bool:
    """True if an ACTIVE, NOT-YET-COMPLETED allocation already claims this
    (account, match_type, match_value) rule. One envelope per rule keeps the
    maths legible (owner decision) — two envelopes fed by different rules on
    the same busy account are legitimate. A COMPLETED "once" allocation is
    retired and does NOT block a new allocation reusing its rule — fetch
    full docs (not just an existence check) so completion can be evaluated
    per-candidate."""
    q: dict = {
        "user_id": uid,
        "fill_account_id": fill_account_id,
        "match_type": match_type,
        "match_value": match_value,
        "active": True,
    }
    if exclude_id is not None:
        q["_id"] = {"$ne": exclude_id}
    candidates = await allocations_col.find(q).to_list(None)
    return any(not _is_completed(d) for d in candidates)


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/allocations")
async def list_allocations(user: dict = Depends(current_user)):
    uid = user["email"]
    items = await _list_enriched(uid, active_only=False)
    items.sort(key=lambda i: (0 if i["active"] else 1, (i["name"] or "").lower()))
    return {"items": items}


@router.get("/allocations/fill-candidates")
async def fill_candidates(account_id: str = Query(...), user: dict = Depends(current_user)):
    """Recent (90d) CREDIT transaction series on `account_id`, grouped by
    `series_key()`, most-recent-first — powers the "which payment fills it?"
    picker step in AllocationSheet. The frontend turns a picked candidate
    into a `description_contains` rule (its `display_name`, cleaned, becomes
    `match_value`). User-scoped, own accounts only."""
    uid = user["email"]
    account_id = str(account_id or "").strip()
    if not account_id:
        raise HTTPException(400, "account_id required")
    if not await _account_owned(uid, account_id):
        raise HTTPException(400, "account not found")

    cutoff = datetime.now() - timedelta(days=_FILL_CANDIDATES_WINDOW_DAYS)
    q = {
        "user_id": uid,
        "account_id": account_id,
        "transaction_type": "credit",
        "date": {"$gte": cutoff},
    }
    proj = {"amount": 1, "merchant_name": 1, "description": 1, "date": 1}
    txns = []
    for col in (transactions_col, yapily_transactions_col):
        txns += await col.find(q, proj).to_list(None)

    groups: dict[str, list[dict]] = defaultdict(list)
    for t in txns:
        groups[series_key(t)].append(t)

    candidates = []
    for key, members in groups.items():
        members.sort(key=lambda t: t["date"], reverse=True)
        latest = members[0]
        candidates.append({
            "series_key":        key,
            "display_name":      _txn_display_name(latest) or key,
            "last_amount":       round(abs(float(latest.get("amount", 0) or 0)), 2),
            "last_date":         (latest["date"].date() if isinstance(latest["date"], datetime) else latest["date"]).isoformat(),
            "occurrences_90d":   len(members),
        })
    candidates.sort(key=lambda c: c["last_date"], reverse=True)
    return {"items": candidates}


@router.post("/allocations")
async def create_allocation(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    name = _validate_name(body.get("name"))
    amount = _validate_amount(body.get("amount_per_period"))
    fill_account_id = str(body.get("fill_account_id") or "").strip()
    if not fill_account_id:
        raise HTTPException(400, "fill_account_id required")
    match_type = _validate_match_type(body.get("match_type"))
    match_value = _validate_match_value(body.get("match_value"))
    fill_display_name = _validate_display_name(body.get("fill_display_name"), match_value)
    recurrence = _validate_recurrence(body.get("recurrence"))
    if not await _account_owned(uid, fill_account_id):
        raise HTTPException(400, "fill account not found")
    if await _conflicts(uid, fill_account_id, match_type, match_value):
        raise HTTPException(400, "an active allocation already fills from this payment")

    cfg = await _pay_cfg(uid)
    start, end = get_pay_period_for_date(date.today(), cfg)
    effective_from = _validate_effective_from(body.get("effective_from"), start)

    doc = {
        "user_id":            uid,
        "name":               name,
        "amount_per_period":  amount,
        "fill_account_id":    fill_account_id,
        "match_type":         match_type,
        "match_value":        match_value,
        "fill_display_name":  fill_display_name,
        "effective_from":     datetime(effective_from.year, effective_from.month, effective_from.day),
        "recurrence":         recurrence,
        "active":             True,
        "created_at":         datetime.now(timezone.utc),
    }
    if recurrence == "once":
        # The fixed boundary — see module docstring. Persisted once, at
        # creation, and never re-derived.
        doc["created_period_start"] = datetime(start.year, start.month, start.day)
        doc["created_period_end"]   = datetime(end.year, end.month, end.day, 23, 59, 59)

    result = await allocations_col.insert_one(doc)
    doc["_id"] = result.inserted_id

    response_cache.invalidate(uid)  # safe-to-spend reserve changed
    return await _serialise(doc, start, end)


@router.patch("/allocations/{allocation_id}")
async def update_allocation(
    allocation_id: str, body: dict, user: dict = Depends(current_user)
):
    uid = user["email"]
    doc = await _get_owned(uid, allocation_id)

    updates: dict = {}
    if "name" in body:
        updates["name"] = _validate_name(body.get("name"))
    if "amount_per_period" in body:
        updates["amount_per_period"] = _validate_amount(body.get("amount_per_period"))
    if "fill_account_id" in body:
        fid = str(body.get("fill_account_id") or "").strip()
        if not fid:
            raise HTTPException(400, "fill_account_id required")
        if not await _account_owned(uid, fid):
            raise HTTPException(400, "fill account not found")
        updates["fill_account_id"] = fid
    if "match_type" in body:
        updates["match_type"] = _validate_match_type(body.get("match_type"))
    if "match_value" in body:
        updates["match_value"] = _validate_match_value(body.get("match_value"))
    if "fill_display_name" in body:
        fallback = updates.get("match_value", doc.get("match_value", ""))
        updates["fill_display_name"] = _validate_display_name(body.get("fill_display_name"), fallback)
    if "effective_from" in body:
        cfg = await _pay_cfg(uid)
        cur_start, _cur_end = get_pay_period_for_date(date.today(), cfg)
        ef = _validate_effective_from(body.get("effective_from"), cur_start)
        updates["effective_from"] = datetime(ef.year, ef.month, ef.day)
    if "active" in body:
        updates["active"] = bool(body.get("active"))
    if "recurrence" in body:
        new_recurrence = _validate_recurrence(body.get("recurrence"))
        updates["recurrence"] = new_recurrence
        prev_recurrence = doc.get("recurrence", "every_period")
        # Switching every_period -> once (allowed): fix the boundary to the
        # CURRENT pay period, exactly as create_allocation would. Switching
        # once -> every_period (also allowed, e.g. reviving a completed
        # once-off into a recurring one) needs no boundary — every_period
        # ignores created_period_start/end entirely (see _serialise).
        if new_recurrence == "once" and prev_recurrence != "once":
            cfg = await _pay_cfg(uid)
            start, end = get_pay_period_for_date(date.today(), cfg)
            updates["created_period_start"] = datetime(start.year, start.month, start.day)
            updates["created_period_end"]   = datetime(end.year, end.month, end.day, 23, 59, 59)

    if not updates:
        raise HTTPException(400, "no recognised fields to update")

    # Re-check the one-active-allocation-per-rule rule whenever the
    # effective (fill_account_id, match_type, match_value, active,
    # recurrence) tuple changes — covers re-linking to a rule another active
    # allocation already claims, reactivating onto one that gained a
    # claimant meanwhile, and reviving a completed once-off into a
    # perpetual every_period allocation that could now collide with a
    # sibling on the same rule.
    eff_fill        = updates.get("fill_account_id", doc.get("fill_account_id"))
    eff_match_type  = updates.get("match_type", doc.get("match_type"))
    eff_match_value = updates.get("match_value", doc.get("match_value"))
    eff_active      = updates.get("active", doc.get("active", True))
    if eff_active and (
        "fill_account_id" in updates or "match_type" in updates or "match_value" in updates
        or "active" in updates or "recurrence" in updates
    ):
        if await _conflicts(uid, eff_fill, eff_match_type, eff_match_value, exclude_id=doc["_id"]):
            raise HTTPException(400, "an active allocation already fills from this payment")

    await allocations_col.update_one({"_id": doc["_id"]}, {"$set": updates})
    doc.update(updates)

    response_cache.invalidate(uid)
    cfg = await _pay_cfg(uid)
    start, end = get_pay_period_for_date(date.today(), cfg)
    return await _serialise(doc, start, end)


@router.delete("/allocations/{allocation_id}")
async def delete_allocation(allocation_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    doc = await _get_owned(uid, allocation_id)
    await allocations_col.delete_one({"_id": doc["_id"]})
    response_cache.invalidate(uid)
    return {"id": str(doc["_id"]), "deleted": True}
