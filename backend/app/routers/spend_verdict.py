"""GET /spend/verdict — the reading, notables, majority, unresolved and
"money you moved" payload behind the redesigned Spend view.

All computation lives in `app.services.spend_verdict`; this router is a thin
HTTP wrapper with the same short-TTL per-user cache the sibling
`/spend/category-signals` endpoint uses (`response_cache`, 90s).
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import preferences_col
from app.services import response_cache
from app.services.checkpoints import delete_intent
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
    cached = response_cache.get(cache_name, uid)
    if cached is not None:
        return cached
    result = await compute_spend_verdict(uid, offset=off)
    response_cache.put(cache_name, uid, result)
    return result


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
