"""The Door — consent-gated change layer (BEHAVIOURS.md Layer 4).

This module is the only place where spending aims exist. Nothing here is ever
proposed uninvited; a checkpoint exists only because the user explicitly asked
for one. Resolution is measured from transaction data (the Verified Checkpoint
Rule) — the user never ticks anything.

Storage shape (checkpoints_col):
    {_id: ObjectId, user_id, kind: "category", ref: <category>,
     aim_amount: float, basis: "usual"|"custom",
     period_start: "YYYY-MM-DD", period_end: "YYYY-MM-DD",
     created_at: datetime(utc), status: "active"|"met"|"missed"|"cancelled",
     result_amount: float|None, resolved_at: str|None}

period_start/period_end are stored as ISO date strings.
created_at is a UTC datetime; resolved_at is a UTC ISO string.

category_intent_col shape:
    {_id, user_id, category, period_end: "YYYY-MM-DD",
     answer: "one_off"|"new_normal", created_at}
"""
import logging
from datetime import date, datetime, timezone

from bson import ObjectId

from app.db.collections import (
    cashflow_cache_col,
    category_intent_col,
    checkpoints_col,
    preferences_col,
    transactions_col,
    yapily_transactions_col,
)
from app.services.pace import _NON_SPEND, _classify, _discretionary_baseline, _norm
from app.services.pay_period import get_pay_period_for_date

logger = logging.getLogger(__name__)

_AIM_ROUND = 5.0


class DuplicateCheckpoint(Exception):
    """Raised when an active checkpoint already exists for (user, ref, period_end)."""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def derive_aim(usual_rate_per_day: float, period_days: int) -> float:
    """Round to nearest £5, floored at £5.

    This is the exact number POST /checkpoints would derive, so the UI can
    never show a suggested aim different from the one the service creates.
    """
    raw = usual_rate_per_day * period_days
    rounded = round(raw / _AIM_ROUND) * _AIM_ROUND
    return max(_AIM_ROUND, float(rounded))


def _serialise(doc: dict, progress: dict | None = None) -> dict:
    """Return a JSON-safe representation of a checkpoint document."""
    out = {
        "id":           str(doc["_id"]),
        "ref":          doc["ref"],
        "aim_amount":   doc["aim_amount"],
        "basis":        doc["basis"],
        "period_start": doc["period_start"],
        "period_end":   doc["period_end"],
        "status":       doc["status"],
        "result_amount": doc.get("result_amount"),
        "resolved_at":  doc.get("resolved_at"),
    }
    if progress:
        out.update(progress)
    return out


# ── Period helpers ────────────────────────────────────────────────────────────

async def _pay_cfg(uid: str) -> dict:
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    return prefs.get("pay_period_config", {"type": "calendar_month"})


async def current_period(uid: str) -> tuple[date, date]:
    cfg = await _pay_cfg(uid)
    return get_pay_period_for_date(date.today(), cfg)


# ── Discretionary spend for a category in a window ───────────────────────────

_PROJ = {
    "merchant_name": 1, "description": 1, "amount": 1, "date": 1,
    "category": 1, "custom_category": 1, "account_id": 1, "planned": 1,
}


async def category_discretionary(
    uid: str,
    category: str,
    period_start: date,
    period_end: date,
) -> float:
    """Compute that category's DISCRETIONARY spend in the window on exactly the
    same basis as pace.py — reusing pace.py's own helpers."""
    today = date.today()

    start_dt = datetime(period_start.year, period_start.month, period_start.day)
    end_dt   = datetime(period_end.year, period_end.month, period_end.day, 23, 59, 59)

    raw_docs: list[dict] = []
    for col in (transactions_col, yapily_transactions_col):
        try:
            async for doc in col.find(
                {
                    "user_id":          uid,
                    "transaction_type": "debit",
                    "date":             {"$gte": start_dt, "$lte": end_dt},
                },
                _PROJ,
            ):
                raw_docs.append(doc)
        except Exception:
            logger.exception("checkpoints: failed fetching from %s for %s", col.name, uid)

    txns = [_norm(d) for d in raw_docs]

    cached   = (await cashflow_cache_col.find_one({"_id": uid}) or {})
    patterns = cached.get("recurring_spend", [])

    # Mirror pace.py's days_elapsed logic exactly:
    if period_end >= today:
        window_days = max(1, (today - period_start).days)
    else:
        window_days = (period_end - period_start).days + 1

    disc, _, _, _ = _classify(txns, patterns, window_days=window_days)
    total = sum(t["amount"] for t in disc if t["category"] == category)
    return round(total, 2)


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def create_checkpoint(
    uid: str,
    ref: str,
    aim_amount: float | None = None,
) -> dict:
    """Create a consent-gated spending aim for a discretionary category.

    Raises
    ------
    ValueError
        ref is empty, ref is in _NON_SPEND, aim_amount is invalid, or there
        is no baseline to derive an aim from.
    DuplicateCheckpoint
        An active checkpoint already exists for (uid, ref, period_end).
    """
    if not ref or not ref.strip():
        raise ValueError("ref must be a non-empty category name")
    ref = ref.strip()
    if ref in _NON_SPEND:
        raise ValueError(
            f"'{ref}' is not a discretionary category — the Door is for "
            "discretionary spend only (not Transfer, Savings, Debt, or Income)"
        )

    period_start, period_end = await current_period(uid)

    # Reject duplicate active checkpoint for this category+period
    existing = await checkpoints_col.find_one({
        "user_id":    uid,
        "ref":        ref,
        "period_end": period_end.isoformat(),
        "status":     "active",
    })
    if existing:
        raise DuplicateCheckpoint(
            f"An active checkpoint already exists for '{ref}' in this period"
        )

    if aim_amount is None:
        # Derive from the user's own history — never invent a number.
        # Load 90 days before period_start, same window as _discretionary_baseline.
        from datetime import timedelta
        from app.services.pace import _BASELINE_DAYS
        db_cutoff = period_start - timedelta(days=_BASELINE_DAYS)
        db_cutoff_dt = datetime(db_cutoff.year, db_cutoff.month, db_cutoff.day)

        raw_docs: list[dict] = []
        for col in (transactions_col, yapily_transactions_col):
            try:
                async for doc in col.find(
                    {
                        "user_id":          uid,
                        "transaction_type": "debit",
                        "date":             {"$gte": db_cutoff_dt},
                    },
                    _PROJ,
                ):
                    raw_docs.append(doc)
            except Exception:
                logger.exception(
                    "checkpoints: baseline fetch failed from %s for %s", col.name, uid
                )

        all_txns = [_norm(d) for d in raw_docs]
        cached   = (await cashflow_cache_col.find_one({"_id": uid}) or {})
        patterns = cached.get("recurring_spend", [])

        baseline, _ = _discretionary_baseline(all_txns, patterns, period_start)
        usual_30d = baseline.get(ref)
        if not usual_30d:
            raise ValueError(
                f"No spending history for '{ref}' — cannot derive an aim. "
                "Please provide an aim_amount instead."
            )

        usual_rate_per_day = usual_30d / 30
        period_days = (period_end - period_start).days + 1
        aim = derive_aim(usual_rate_per_day, period_days)
        basis = "usual"
    else:
        try:
            aim_amount = float(aim_amount)
        except (TypeError, ValueError):
            raise ValueError("aim_amount must be a number")
        if aim_amount <= 0 or aim_amount > 1_000_000:
            raise ValueError("aim_amount must be between 0 and 1,000,000")
        aim = round(aim_amount, 2)
        basis = "custom"

    doc = {
        "user_id":      uid,
        "kind":         "category",
        "ref":          ref,
        "aim_amount":   aim,
        "basis":        basis,
        "period_start": period_start.isoformat(),
        "period_end":   period_end.isoformat(),
        "created_at":   datetime.now(timezone.utc),
        "status":       "active",
        "result_amount": None,
        "resolved_at":  None,
    }
    result = await checkpoints_col.insert_one(doc)
    doc["_id"] = result.inserted_id

    # Attach live progress
    spent = await category_discretionary(uid, ref, period_start, period_end)
    today = date.today()
    total_days   = (period_end - period_start).days + 1
    days_elapsed = max(1, min(total_days, (today - period_start).days))
    days_left    = max(0, (period_end - today).days + 1)
    on_track = spent <= aim * (days_elapsed / total_days)

    progress = {
        "spent_so_far": spent,
        "days_left":    days_left,
        "on_track":     on_track,
    }
    return _serialise(doc, progress)


async def list_active(uid: str) -> list[dict]:
    """Return active checkpoints for the current period, with live progress."""
    await resolve_due(uid)

    _, period_end = await current_period(uid)
    today = date.today()
    cursor = checkpoints_col.find({
        "user_id":    uid,
        "status":     "active",
        "period_end": period_end.isoformat(),
    })
    docs = await cursor.to_list(None)

    out = []
    for doc in docs:
        period_start = date.fromisoformat(doc["period_start"])
        period_end_d = date.fromisoformat(doc["period_end"])
        spent        = await category_discretionary(uid, doc["ref"], period_start, period_end_d)
        total_days   = (period_end_d - period_start).days + 1
        days_elapsed = max(1, min(total_days, (today - period_start).days))
        days_left    = max(0, (period_end_d - today).days + 1)
        on_track     = spent <= doc["aim_amount"] * (days_elapsed / total_days)
        progress = {"spent_so_far": spent, "days_left": days_left, "on_track": on_track}
        out.append(_serialise(doc, progress))
    return out


async def cancel_checkpoint(uid: str, checkpoint_id: str) -> bool:
    """Cancel an active checkpoint. No shame, no friction."""
    result = await checkpoints_col.update_one(
        {"_id": ObjectId(checkpoint_id), "user_id": uid, "status": "active"},
        {"$set": {"status": "cancelled", "resolved_at": _utcnow_iso()}},
    )
    return result.modified_count > 0


async def record_intent(uid: str, category: str, answer: str) -> dict:
    """Record whether an overspend in a category is one-off or new-normal."""
    if answer not in ("one_off", "new_normal"):
        raise ValueError("answer must be 'one_off' or 'new_normal'")
    category = (category or "").strip()
    if not category:
        raise ValueError("category must be a non-empty string")

    _, period_end = await current_period(uid)
    now = datetime.now(timezone.utc)
    await category_intent_col.update_one(
        {"user_id": uid, "category": category, "period_end": period_end.isoformat()},
        {"$set": {"answer": answer, "created_at": now}},
        upsert=True,
    )
    return {
        "user_id":    uid,
        "category":   category,
        "period_end": period_end.isoformat(),
        "answer":     answer,
        "created_at": now.isoformat(),
    }


async def resolve_due(uid: str) -> list[dict]:
    """The Verified Checkpoint Rule: resolve any active checkpoints whose period has closed.

    Resolution is entirely automatic from transaction data — the user never
    reports anything. Called lazily on list_active and at period close.
    """
    today = date.today()
    cursor = checkpoints_col.find({
        "user_id":    uid,
        "status":     "active",
        "period_end": {"$lt": today.isoformat()},
    })
    due = await cursor.to_list(None)

    resolved = []
    for doc in due:
        try:
            period_start = date.fromisoformat(doc["period_start"])
            period_end   = date.fromisoformat(doc["period_end"])
            result_amount = await category_discretionary(
                uid, doc["ref"], period_start, period_end
            )
            status = "met" if result_amount <= doc["aim_amount"] else "missed"
            resolved_at = _utcnow_iso()
            await checkpoints_col.update_one(
                {"_id": doc["_id"]},
                {"$set": {
                    "status":        status,
                    "result_amount": result_amount,
                    "resolved_at":   resolved_at,
                }},
            )
            doc.update({
                "status":        status,
                "result_amount": result_amount,
                "resolved_at":   resolved_at,
            })
            resolved.append(doc)
        except Exception:
            logger.exception(
                "checkpoints.resolve_due: failed for %s checkpoint %s", uid, doc["_id"]
            )
    return resolved


async def checkpoint_map_for_period(
    uid: str,
    period_start: date,
    period_end: date,
    days_left: int | None = None,
    cat_spent: dict[str, float] | None = None,
) -> dict[str, dict]:
    """Return {category: {id, aim_amount, spent_so_far, days_left, on_track}}
    for ACTIVE checkpoints in the given period.

    days_left: when passed (from pace), used verbatim so Trends never
               contradicts its own header.
    cat_spent: when passed, read spent from it (no DB recompute). This is the
               same discretionary map already computed by the caller.
    """
    today = date.today()
    cursor = checkpoints_col.find({
        "user_id":    uid,
        "status":     "active",
        "period_end": period_end.isoformat(),
    })
    docs = await cursor.to_list(None)

    total_days = (period_end - period_start).days + 1

    if days_left is None:
        days_left_computed = max(0, (period_end - today).days + 1)
    else:
        days_left_computed = days_left

    days_elapsed = max(1, min(total_days, total_days - days_left_computed))

    out: dict[str, dict] = {}
    for doc in docs:
        cat = doc["ref"]
        aim = doc["aim_amount"]

        if cat_spent is not None:
            spent = cat_spent.get(cat, 0.0)
        else:
            spent = await category_discretionary(uid, cat, period_start, period_end)

        on_track = spent <= aim * (days_elapsed / total_days)

        out[cat] = {
            "id":           str(doc["_id"]),
            "aim_amount":   aim,
            "spent_so_far": spent,
            "days_left":    days_left_computed,
            "on_track":     on_track,
        }
    return out


async def intent_map_for_period(uid: str, period_end: date) -> dict[str, str]:
    """Return {category: answer} for all intents recorded in this period."""
    cursor = category_intent_col.find({
        "user_id":    uid,
        "period_end": period_end.isoformat(),
    })
    docs = await cursor.to_list(None)
    return {d["category"]: d["answer"] for d in docs}


async def engaged_categories(uid: str, period_end: date) -> set[str]:
    """Categories with an intent OR any checkpoint (any status incl. cancelled)
    for this period. This is the Consent Rule in code: stops the app
    re-asking someone who already answered or already cancelled an aim."""
    cp_cursor = checkpoints_col.find(
        {"user_id": uid, "period_end": period_end.isoformat()},
        {"ref": 1},
    )
    cp_docs = await cp_cursor.to_list(None)
    cats = {d["ref"] for d in cp_docs}

    intent_cursor = category_intent_col.find(
        {"user_id": uid, "period_end": period_end.isoformat()},
        {"category": 1},
    )
    intent_docs = await intent_cursor.to_list(None)
    cats |= {d["category"] for d in intent_docs}

    return cats
