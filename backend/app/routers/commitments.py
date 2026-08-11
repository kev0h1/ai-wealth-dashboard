"""Commitments — named future big expenses funded a slice per pay period.

A commitment is a user-declared future big expense (holiday, car, fees) with a
target month. Each active commitment reserves a per-period slice out of
Safe-to-Spend (see analytics.compute_safe_to_spend) until the target date.

Storage shape (commitments_col) — v2:
    {_id: ObjectId, user_id, name (str<=40), amount (float total),
     target_date (ISO date str — first of the target month is fine),
     funding_pots (list — the pots whose balances fund this goal):
         [{account_id (str), kind ("connected"|"manual" — manual means an
           offline account in manual_accounts_col, updated by the user),
           baseline (float — pot balance captured at link time; 0.0 when
           count_existing so the whole balance counts),
           count_existing (bool — chosen per pot at link time)}],
     funding_account_id / baseline_balance (LEGACY v1 single-pot fields —
         still written as mirrors of the first pot for one release; v1 docs
         without funding_pots are migrated on read into one connected pot
         {account_id, kind "connected", baseline: baseline_balance,
         count_existing: false}),
     contributed (float, default 0 — manual contributions),
     source ("manual"|"can_i"), status ("active"|"done"|"cancelled"),
     created_at (UTC datetime)}

Derived (NEVER stored — always computed live):
    progress          clamp(Σ over pots of max(0, live_balance − baseline),
                      0, amount) + contributed, clamped at amount. Pots with
                      unreadable balances contribute 0 (never negative).
    remaining         amount − progress
    periods_left      pay-period starts from today through target_date
                      inclusive (>=1) — user pay config via preferences
    per_period_slice  ceil5(remaining / periods_left) when remaining>0 else 0
    on_track          progress >= amount * elapsed_fraction, where
                      elapsed_fraction = periods elapsed since creation /
                      total periods, clamped 0..1
    feasibility       ACTIVE commitments only — "surplus" (slice fits the
                      monthly spare rate), "savings" (slice exceeds it but
                      remaining is coverable from the savings pots), or
                      "stretch" (neither). null when status isn't active or
                      the underlying maths is unavailable.
    feasibility_note  hedged one-liner matching feasibility; omitted when
                      feasibility is null.
"""
import math
from datetime import date, datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import (
    accounts_col,
    commitments_col,
    manual_accounts_col,
    preferences_col,
    savings_goals_col,
    yapily_accounts_col,
)
from app.routers.savings import _cashflow, _current_savings
from app.services import response_cache
from app.services.pay_period import get_pay_period_for_date
from app.services.region import get_user_region

router = APIRouter(tags=["commitments"])

_STATUSES = {"active", "done", "cancelled"}
_SOURCES = {"manual", "can_i"}
_MAX_NAME = 40
_MAX_AMOUNT = 1_000_000
_MAX_POTS = 8


def _ceil5(amount: float) -> int:
    """Round up to nearest £5 (companion.py convention, replicated locally)."""
    return math.ceil(amount / 5) * 5


# ── Pay-period helpers ────────────────────────────────────────────────────────

async def _pay_cfg(uid: str) -> dict:
    """User pay config — preferences keyed by user_id (checkpoints convention)."""
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    return prefs.get("pay_period_config", {"type": "calendar_month"})


def _period_starts_between(start: date, end: date, cfg: dict) -> int:
    """Count pay-period start days in [start, end] inclusive. 0 when none."""
    if end < start:
        return 0
    count = 0
    cur, _e = get_pay_period_for_date(start, cfg)  # cur <= start
    guard = 0
    while guard < 600:  # weekly periods over ~11 years — never loops forever
        if cur >= start:
            if cur > end:
                break
            count += 1
        _s, period_end = get_pay_period_for_date(cur, cfg)
        cur = period_end + timedelta(days=1)
        guard += 1
    return count


# ── Funding-pot lookups (pattern from services/companion.py) ─────────────────

def _try_oid(v: str):
    try:
        return ObjectId(v)
    except (InvalidId, TypeError):
        return v


async def _live_balance(account_id: str) -> float | None:
    """Current balance for an account id across all account collections."""
    oid = _try_oid(account_id)
    for col in (accounts_col, yapily_accounts_col, manual_accounts_col):
        for _id in ({oid, account_id} if oid != account_id else {account_id}):
            doc = await col.find_one(
                {"_id": _id},
                {"balance": 1, "current_balance": 1, "available_balance": 1},
            )
            if doc:
                bal = (
                    doc.get("balance")
                    or doc.get("current_balance")
                    or doc.get("available_balance")
                    or 0.0
                )
                return float(bal)
    return None


async def _account_name(account_id: str) -> str | None:
    """Display name for an account id, whitespace-normalised, or None."""
    oid = _try_oid(account_id)
    for col in (accounts_col, yapily_accounts_col, manual_accounts_col):
        for _id in ({oid, account_id} if oid != account_id else {account_id}):
            doc = await col.find_one({"_id": _id}, {"name": 1})
            if doc:
                return " ".join(str(doc.get("name") or "").split()) or None
    return None


async def _pot_kind(account_id: str) -> str | None:
    """"connected" | "manual" (offline, manual_accounts_col) | None if unknown."""
    oid = _try_oid(account_id)
    ids = {oid, account_id} if oid != account_id else {account_id}
    for col, kind in (
        (accounts_col, "connected"),
        (yapily_accounts_col, "connected"),
        (manual_accounts_col, "manual"),
    ):
        for _id in ids:
            if await col.find_one({"_id": _id}, {"_id": 1}):
                return kind
    return None


def _doc_pots(doc: dict) -> list[dict]:
    """Normalised funding pots for a commitment doc — v2 shape, or the legacy
    single-pot fields migrated on read (one connected pot, count_existing
    false). An explicit empty funding_pots list means unlinked (no fallback)."""
    pots = doc.get("funding_pots")
    if isinstance(pots, list):
        return [p for p in pots if isinstance(p, dict) and p.get("account_id")]
    fid = doc.get("funding_account_id")
    if fid:
        return [{
            "account_id":     str(fid),
            "kind":           "connected",
            "baseline":       float(doc.get("baseline_balance") or 0.0),
            "count_existing": False,
        }]
    return []


async def _migrate_legacy(doc: dict) -> None:
    """Persist the read-migrated pot shape onto a legacy doc (write-once; new
    writes always carry funding_pots). Kept off the safe-to-spend hot path —
    only the list/detail read paths call this."""
    if isinstance(doc.get("funding_pots"), list):
        return
    pots = _doc_pots(doc)
    await commitments_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"funding_pots": pots}}
    )
    doc["funding_pots"] = pots


# ── Feasibility (owner's semantics: meet the expense without debt; dipping
#    into savings might be necessary) ───────────────────────────────────────────

async def _feasibility_ctx(uid: str) -> tuple[float, float] | None:
    """(monthly_surplus, available_savings) for feasibility, or None on failure.

    monthly_surplus reuses savings._cashflow (income − spending − debt, backed
    by the 6h cashflow cache) with the grow.py region/cutoff idiom.
    available_savings reuses savings._current_savings with the user's
    safety-net goal accounts — the same pot split Safe-to-Spend shows. Chosen
    over recomputing a bespoke split because it is a handful of indexed
    balance reads (no transaction scan) and already matches what the user
    sees as "savings" elsewhere.
    """
    try:
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        _income, _spending, surplus = await _cashflow(uid, region, cutoff)
        goal = await savings_goals_col.find_one({"_id": uid})
        savings_total = await _current_savings(uid, goal)
        return float(surplus), float(savings_total)
    except Exception:
        return None  # feasibility is decorative — never break the payload


def _classify_feasibility(
    per_period_slice: float, remaining: float, fctx: tuple[float, float] | None
) -> tuple[str | None, str | None]:
    """(feasibility, feasibility_note) — (None, None) when context missing."""
    if fctx is None:
        return None, None
    surplus, savings_total = fctx
    spare = max(0.0, surplus)
    if per_period_slice <= spare:
        return "surplus", "Likely coverable from your monthly spare rate."
    if remaining <= savings_total:
        gap = per_period_slice - spare
        return (
            "savings",
            f"More than your spare rate — likely needs ~£{gap:,.0f}/period from savings.",
        )
    return (
        "stretch",
        "At current pace this risks credit — a later target month would ease it.",
    )


# ── Serialisation (all derived fields computed here, never stored) ───────────

async def _serialise(
    doc: dict,
    cfg: dict,
    today: date | None = None,
    fctx: tuple[float, float] | None = None,
) -> dict:
    """Serialise one commitment. `fctx` is the (surplus, savings) feasibility
    context from _feasibility_ctx — pass None to skip feasibility (it comes
    back null), e.g. on the safe-to-spend hot path."""
    today = today or date.today()
    amount = float(doc.get("amount") or 0)
    contributed = float(doc.get("contributed") or 0)

    # v2: progress = clamp(Σ pot growth, 0, amount) + contributed, capped at
    # amount. count_existing pots have baseline 0, so their whole balance
    # counts; unreadable pots contribute 0 rather than failing the payload.
    pot_items: list[dict] = []
    pot_sum = 0.0
    for pot in _doc_pots(doc):
        aid = str(pot["account_id"])
        live = await _live_balance(aid)
        baseline = float(pot.get("baseline") or 0.0)
        contributing = max(0.0, live - baseline) if live is not None else 0.0
        pot_sum += contributing
        pot_items.append({
            "account_id":           aid,
            "name":                 await _account_name(aid),
            "kind":                 pot.get("kind") or "connected",
            "count_existing":       bool(pot.get("count_existing")),
            "contributing_balance": round(contributing, 2),
        })
    progress = round(min(amount, min(pot_sum, amount) + max(0.0, contributed)), 2)
    remaining = round(max(0.0, amount - progress), 2)

    # Legacy single-pot mirrors (kept one release for mid-deploy clients).
    fid = pot_items[0]["account_id"] if pot_items else None
    funding_name = pot_items[0]["name"] if pot_items else None

    target = date.fromisoformat(str(doc["target_date"])[:10])
    left_raw = _period_starts_between(today, target, cfg)
    periods_left = max(1, left_raw)
    per_period_slice = _ceil5(remaining / periods_left) if remaining > 0 else 0

    created = doc.get("created_at")
    created_d = created.date() if isinstance(created, datetime) else today
    total_raw = _period_starts_between(created_d, target, cfg)
    total = max(1, total_raw)
    elapsed = min(total, max(0, total_raw - left_raw))
    elapsed_fraction = min(1.0, max(0.0, elapsed / total))
    on_track = progress >= amount * elapsed_fraction

    feasibility, feasibility_note = None, None
    if doc.get("status", "active") == "active":
        try:
            feasibility, feasibility_note = _classify_feasibility(
                per_period_slice, remaining, fctx
            )
        except Exception:
            feasibility, feasibility_note = None, None

    out = {
        "id":                  str(doc["_id"]),
        "name":                doc.get("name"),
        "amount":              amount,
        "target_date":         doc.get("target_date"),
        "funding_pots":        pot_items,
        "funding_account_id":  fid,
        "funding_account_name": funding_name,
        "source":              doc.get("source", "manual"),
        "status":              doc.get("status", "active"),
        "progress":            progress,
        "remaining":           remaining,
        "periods_left":        periods_left,
        "per_period_slice":    per_period_slice,
        "on_track":            on_track,
        "feasibility":         feasibility,
    }
    if feasibility_note is not None:
        out["feasibility_note"] = feasibility_note
    return out


async def total_reserved_slices(uid: str) -> tuple[int, int]:
    """(sum of per_period_slice across ACTIVE commitments, count).

    Called by analytics.compute_safe_to_spend to reserve committed slices
    before the verdict is derived.
    """
    docs = await commitments_col.find(
        {"user_id": uid, "status": "active"}
    ).to_list(None)
    if not docs:
        return 0, 0
    cfg = await _pay_cfg(uid)
    today = date.today()
    total = 0
    for doc in docs:
        item = await _serialise(doc, cfg, today=today)
        total += item["per_period_slice"]
    return int(total), len(docs)


# ── Validation ───────────────────────────────────────────────────────────────

def _validate_name(raw) -> str:
    name = str(raw or "").strip()
    if not name or len(name) > _MAX_NAME:
        raise HTTPException(400, f"name must be 1-{_MAX_NAME} characters")
    return name


def _validate_amount(raw) -> float:
    try:
        amount = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount must be a number")
    if not (0 < amount <= _MAX_AMOUNT):
        raise HTTPException(400, f"amount must be between 0 and {_MAX_AMOUNT:,}")
    return round(amount, 2)


def _validate_target_date(raw) -> str:
    try:
        target = date.fromisoformat(str(raw or "")[:10])
    except ValueError:
        raise HTTPException(400, "target_date must be an ISO date (YYYY-MM-DD)")
    if target < date.today():
        raise HTTPException(400, "target_date must not be in the past")
    return target.isoformat()


async def _capture_baseline(fid: str) -> float:
    """Live pot balance at link time — the progress zero-point."""
    live = await _live_balance(fid)
    if live is None:
        raise HTTPException(400, "funding account not found")
    return round(float(live), 2)


async def _build_pots(raw) -> list[dict]:
    """Validate a funding_pots request payload ([{account_id, count_existing}])
    into the stored v2 shape, capturing baselines now. Duplicate account ids
    collapse to the first occurrence; unknown accounts are a 400."""
    if raw in (None, "", []):
        return []
    if not isinstance(raw, list):
        raise HTTPException(400, "funding_pots must be a list")
    if len(raw) > _MAX_POTS:
        raise HTTPException(400, f"funding_pots supports up to {_MAX_POTS} pots")
    pots: list[dict] = []
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict) or not str(entry.get("account_id") or "").strip():
            raise HTTPException(400, "each funding pot needs an account_id")
        aid = str(entry["account_id"]).strip()
        if aid in seen:
            continue
        seen.add(aid)
        kind = await _pot_kind(aid)
        if kind is None:
            raise HTTPException(400, "funding account not found")
        count_existing = bool(entry.get("count_existing"))
        # count_existing → baseline 0 (whole balance counts); otherwise the
        # balance right now is the zero-point.
        baseline = 0.0 if count_existing else await _capture_baseline(aid)
        pots.append({
            "account_id":     aid,
            "kind":           kind,
            "baseline":       baseline,
            "count_existing": count_existing,
        })
    return pots


def _pot_mirrors(pots: list[dict]) -> dict:
    """Legacy v1 single-pot fields mirrored from the first pot (one release —
    keeps mid-deploy readers of funding_account_id/baseline_balance working)."""
    first = pots[0] if pots else None
    return {
        "funding_account_id": first["account_id"] if first else None,
        "baseline_balance":   first["baseline"] if first else None,
    }


async def _get_owned(uid: str, commitment_id: str) -> dict:
    try:
        oid = ObjectId(commitment_id)
    except (InvalidId, TypeError):
        raise HTTPException(404, "Commitment not found")
    doc = await commitments_col.find_one({"_id": oid, "user_id": uid})
    if not doc:
        raise HTTPException(404, "Commitment not found")
    return doc


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/commitments")
async def list_commitments(user: dict = Depends(current_user)):
    uid = user["email"]
    docs = await commitments_col.find(
        {"user_id": uid, "status": {"$ne": "cancelled"}}
    ).to_list(None)
    cfg = await _pay_cfg(uid)
    fctx = await _feasibility_ctx(uid)
    today = date.today()
    for doc in docs:
        await _migrate_legacy(doc)  # write-once v1 → funding_pots
    items = [await _serialise(doc, cfg, today=today, fctx=fctx) for doc in docs]
    items.sort(key=lambda i: (0 if i["status"] == "active" else 1, i["target_date"] or ""))
    return {"items": items}


@router.post("/commitments")
async def create_commitment(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    name = _validate_name(body.get("name"))
    amount = _validate_amount(body.get("amount"))
    target_date = _validate_target_date(body.get("target_date"))

    source = body.get("source") or "manual"
    if source not in _SOURCES:
        raise HTTPException(400, "source must be 'manual' or 'can_i'")

    # v2 payload preferred; legacy single funding_account_id accepted for one
    # release and treated as a single connected/manual pot, count_existing off.
    if "funding_pots" in body:
        pots = await _build_pots(body.get("funding_pots"))
    else:
        fid = body.get("funding_account_id") or None
        pots = await _build_pots([{"account_id": fid}] if fid else [])

    doc = {
        "user_id":      uid,
        "name":         name,
        "amount":       amount,
        "target_date":  target_date,
        "funding_pots": pots,
        **_pot_mirrors(pots),
        "contributed":  0.0,
        "source":       source,
        "status":       "active",
        "created_at":   datetime.now(timezone.utc),
    }
    result = await commitments_col.insert_one(doc)
    doc["_id"] = result.inserted_id

    response_cache.invalidate(uid)  # safe-to-spend reserve changed
    cfg = await _pay_cfg(uid)
    return await _serialise(doc, cfg, fctx=await _feasibility_ctx(uid))


@router.post("/commitments/preview")
async def preview_commitment(body: dict, user: dict = Depends(current_user)):
    """Live feasibility verdict for the sheet — same maths as _serialise for a
    not-yet-saved commitment (nothing persisted). Optional funding_pots
    ([{account_id, count_existing}]) let count_existing pots contribute their
    whole current balance up front, shrinking remaining and the slice —
    lenient by design (unreadable pots just contribute 0)."""
    uid = user["email"]
    amount = _validate_amount(body.get("amount"))
    target_date = _validate_target_date(body.get("target_date"))

    starting = 0.0
    raw_pots = body.get("funding_pots")
    if isinstance(raw_pots, list):
        seen: set[str] = set()
        for entry in raw_pots[:_MAX_POTS]:
            if not isinstance(entry, dict) or not entry.get("count_existing"):
                continue
            aid = str(entry.get("account_id") or "").strip()
            if not aid or aid in seen:
                continue
            seen.add(aid)
            live = await _live_balance(aid)
            if live is not None:
                starting += max(0.0, float(live))
    starting = round(min(starting, amount), 2)
    remaining = max(0.0, amount - starting)

    cfg = await _pay_cfg(uid)
    today = date.today()
    target = date.fromisoformat(target_date)
    periods_left = max(1, _period_starts_between(today, target, cfg))
    per_period_slice = _ceil5(remaining / periods_left) if remaining > 0 else 0

    feasibility, feasibility_note = _classify_feasibility(
        per_period_slice, remaining, await _feasibility_ctx(uid)
    )
    out = {
        "per_period_slice":  per_period_slice,
        "periods_left":      periods_left,
        "starting_progress": starting,
        "feasibility":       feasibility,
    }
    if feasibility_note is not None:
        out["feasibility_note"] = feasibility_note
    return out


@router.patch("/commitments/{commitment_id}")
async def update_commitment(
    commitment_id: str, body: dict, user: dict = Depends(current_user)
):
    uid = user["email"]
    doc = await _get_owned(uid, commitment_id)

    updates: dict = {}
    if "name" in body:
        updates["name"] = _validate_name(body.get("name"))
    if "amount" in body:
        updates["amount"] = _validate_amount(body.get("amount"))
    if "target_date" in body:
        updates["target_date"] = _validate_target_date(body.get("target_date"))
    if "funding_pots" in body:
        # Baselines are balance-at-link-time: a pot already linked with the
        # same count_existing flag keeps its stored baseline (its link time
        # hasn't changed — re-capturing would wipe accrued growth). Fresh
        # baselines are captured only for new pots or a flipped flag.
        pots = await _build_pots(body.get("funding_pots"))
        prior = {
            (p["account_id"], bool(p.get("count_existing"))): p
            for p in _doc_pots(doc)
        }
        for pot in pots:
            kept = prior.get((pot["account_id"], pot["count_existing"]))
            if kept is not None:
                pot["baseline"] = float(kept.get("baseline") or 0.0)
        updates["funding_pots"] = pots
        updates.update(_pot_mirrors(pots))
    elif "funding_account_id" in body:
        # Legacy single-pot re-link (one release) — same capture semantics.
        fid = body.get("funding_account_id") or None
        pots = await _build_pots([{"account_id": fid}] if fid else [])
        updates["funding_pots"] = pots
        updates.update(_pot_mirrors(pots))
    if "status" in body:
        status = body.get("status")
        if status not in _STATUSES:
            raise HTTPException(400, "status must be active, done or cancelled")
        updates["status"] = status
    if "contribute_delta" in body:
        try:
            delta = float(body.get("contribute_delta"))
        except (TypeError, ValueError):
            raise HTTPException(400, "contribute_delta must be a number")
        if not (-_MAX_AMOUNT <= delta <= _MAX_AMOUNT):
            raise HTTPException(400, "contribute_delta out of range")
        contributed = float(doc.get("contributed") or 0)
        updates["contributed"] = round(max(0.0, contributed + delta), 2)

    if not updates:
        raise HTTPException(400, "no recognised fields to update")

    await commitments_col.update_one({"_id": doc["_id"]}, {"$set": updates})
    doc.update(updates)

    response_cache.invalidate(uid)
    cfg = await _pay_cfg(uid)
    return await _serialise(doc, cfg, fctx=await _feasibility_ctx(uid))


@router.delete("/commitments/{commitment_id}")
async def delete_commitment(commitment_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    doc = await _get_owned(uid, commitment_id)
    await commitments_col.update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "cancelled"}}
    )
    response_cache.invalidate(uid)
    return {"id": str(doc["_id"]), "status": "cancelled"}
