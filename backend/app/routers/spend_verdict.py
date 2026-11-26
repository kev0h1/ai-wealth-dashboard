"""GET /spend/verdict — the reading, notables, majority, unresolved and
"money you moved" payload behind the redesigned Spend view.

All computation lives in `app.services.spend_verdict`; this router is a thin
HTTP wrapper with the same Mongo-backed per-user cache the sibling
`/spend/category-signals` endpoint uses (`app.services.response_cache`).
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import preferences_col
from app.services import response_cache
from app.services.checkpoints import delete_intent
from app.services.overspending import delete_one_off, record_one_off
from app.services.overspending_moments import claim_home_heads_up, read_overspending_moment
from app.services.spend_impact import compute_intent_preview
from app.services.spend_verdict import compute_spend_verdict

router = APIRouter(tags=["spend-verdict"])


@router.get("/spend/verdict")
async def get_spend_verdict(offset: int = 0, user: dict = Depends(current_user)):
    """The Spend page's reading + notable cards + majority rows + unresolved
    (Other) + money-you-moved, for one pay period.

    offset: 0 = current period (default), negative = closed prior periods.
    Clamped to [-60, 0], matching `/spend/category-signals`.
    """
    uid = user["email"]
    off = max(-60, min(0, int(offset)))
    cache_name = f"spend_verdict:{off}"
    cached = await response_cache.aget(cache_name, uid)
    if cached is not None:
        return await _with_overspending(cached, uid, off)
    v = await response_cache.snapshot(uid)
    result = await compute_spend_verdict(uid, offset=off)
    await response_cache.aput(cache_name, uid, result, version=v)
    return await _with_overspending(result, uid, off)


async def _with_overspending(payload: dict, uid: str, offset: int) -> dict:
    """G493: the stored overspending result, current period only. Read from the
    stored doc and never computed here (H145); null when none is stored. Added
    to a copy, outside the response cache, so an acknowledgement shows at once
    and the cached entry is never mutated."""
    if offset != 0:
        return payload
    return {**payload, "overspending": await read_overspending_moment(uid)}


@router.post("/spend/overspend/heads-up")
async def post_overspend_heads_up(body: dict, user: dict = Depends(current_user)):
    """Grant one Home display per period; a view is never a one-off answer."""
    period_end = _parse_period_end(body.get("period_end"))
    if period_end is None:
        raise HTTPException(400, "Provide period_end")
    pe = period_end.isoformat()
    return {"shown": await claim_home_heads_up(user["email"], pe), "period_end": pe}


@router.post("/spend/overspend/one-off")
async def post_overspend_one_off(body: dict | None = None, user: dict = Depends(current_user)):
    """The user's answer that this period's overspending is a one-off (asked,
    never inferred). Silences the period; changes no number. `period_end`
    (YYYY-MM-DD) is optional and defaults to the current period's end."""
    uid = user["email"]
    period_end = _parse_period_end((body or {}).get("period_end"))
    try:
        pe = await record_one_off(uid, period_end)
    except ValueError:
        raise HTTPException(400, "period_end must be the end of the current or an earlier pay period")
    response_cache.invalidate(uid)
    return {"ok": True, "period_end": pe, "acknowledged": True}


@router.delete("/spend/overspend/one-off")
async def delete_overspend_one_off(period_end: str | None = None, user: dict = Depends(current_user)):
    """Undo the one-off answer. Idempotent."""
    uid = user["email"]
    pe = await delete_one_off(uid, _parse_period_end(period_end))
    response_cache.invalidate(uid)
    return {"ok": True, "period_end": pe, "acknowledged": False}


def _parse_period_end(raw) -> date | None:
    if raw in (None, ""):
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        raise HTTPException(400, "period_end must be YYYY-MM-DD")


@router.post("/spend/verdict/dismiss-unresolved")
async def dismiss_unresolved_ask(body: dict, user: dict = Depends(current_user)):
    """Dismiss the unresolved-merchant ask card ("Not now") for one
    transaction — persists, so the same ask does not return on every visit
    (ENGINE.md Ask Budget Rule: "never a nag"). Mirrors the miscategorised
    guardrail's per-row dismiss (`dismiss_miscategorised`, analytics.py):
    permanent, keyed on the transaction id, does not change the transaction
    itself. The quiet unresolved whisper keeps showing — only the ask is
    suppressed.
    """
    uid = user["email"]
    txn_id = body.get("txn_id")
    if not txn_id:
        raise HTTPException(400, "Provide 'txn_id'")
    await preferences_col.update_one(
        {"user_id": uid},
        {"$addToSet": {"dismissed_unresolved_asks": txn_id}, "$set": {"user_id": uid}},
        upsert=True,
    )
    response_cache.invalidate(uid)
    return {"ok": True}


@router.post("/spend/intent-preview")
async def post_intent_preview(body: dict, user: dict = Depends(current_user)):
    """Server-composed price lines for the "file as new normal" consent
    sheet — shown BEFORE the user answers, so the sheet can price the
    consequence up front instead of asking them to answer blind. Reuses the
    same impact engine `GET /spend/verdict` uses, with the category's
    current excess treated as if it recurs every period.
    """
    uid = user["email"]
    category = (body.get("category") or "").strip()
    if not category:
        raise HTTPException(400, "Provide 'category'")

    try:
        preview = await compute_intent_preview(uid, category)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return preview


@router.delete("/spend/intent/{category}")
async def delete_intent_answer(category: str, user: dict = Depends(current_user)):
    """Undo — the 5s undo toast's real reversal for a just-recorded
    one_off/new_normal answer this period (`POST /trends/intent`).
    Idempotent: undoing twice, or undoing an answer that was never
    recorded, is a no-op, not an error, so the toast's undo button can
    never surface a confusing failure.
    """
    uid = user["email"]
    try:
        await delete_intent(uid, category)
    except ValueError as e:
        raise HTTPException(400, str(e))

    response_cache.invalidate(uid)
    return {"ok": True, "category": category}
