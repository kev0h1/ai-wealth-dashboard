"""User profile endpoints: full name and onboarding state."""
import re

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.session_revocation import revoke_sessions
from app.db.collections import user_profiles_col
from app.services.retention import erase_user

router = APIRouter(tags=["profile"])


def tokenise_name(full_name: str) -> list[str]:
    """Split a full name into lowercase tokens of length >= 2."""
    parts = re.split(r"[^a-zA-Z]+", (full_name or "").lower())
    return [p for p in parts if len(p) >= 2]


def _onboarding_complete(doc: dict) -> bool:
    """D12. An explicit flag always wins (False = onboarding needed). A document
    that lacks the flag is ambiguous: stamp_activity's upsert (run on the first
    authenticated request, before GET /profile) used to create bare
    `{_id, last_active_at}` documents for brand-new users, while profiles that
    predate the field (2026-07-04) belong to users who onboarded long ago and
    carry a saved name. So absent flag + a saved full_name = legacy, complete;
    absent flag and no name = onboarding needed. New documents now always set
    the flag explicitly (stamp_activity, update_profile), so absent only occurs
    for those legacy documents."""
    flag = doc.get("onboarding_complete")
    if flag is not None:
        return bool(flag)
    return bool((doc.get("full_name") or "").strip())


def _serialize(doc: dict | None) -> dict:
    if not doc:
        return {"full_name": "", "name_tokens": [], "onboarding_complete": False}
    return {
        "full_name": doc.get("full_name", ""),
        "name_tokens": doc.get("name_tokens", []),
        "onboarding_complete": _onboarding_complete(doc),
    }


@router.get("/profile")
async def get_profile(user: dict = Depends(current_user)):
    doc = await user_profiles_col.find_one({"_id": user["email"]})
    return _serialize(doc)


@router.delete("/account")
async def delete_account(body: dict, user: dict = Depends(current_user)):
    """Erase every trace of the user: all documents in every collection,
    matched by user_id field or uid-keyed _id. Requires typed confirmation.

    The erasure itself lives in app.services.retention.erase_user so the
    nightly dormant-account sweep (SECURITY.md section 6) runs the exact
    same routine."""
    if body.get("confirm") != "DELETE":
        raise HTTPException(400, "Confirmation required")
    uid = user["email"]
    # A84: revoke this user's session tokens BEFORE erasing, not inside
    # erase_user itself (that function is shared with the dormant sweep,
    # and is out of scope for this call site's edit), so a concurrent
    # request racing the deletion, using the same still-valid token, is
    # already locked out from the moment erasure starts.
    await revoke_sessions(uid)
    removed = await erase_user(uid)
    return {"deleted": True, "removed": removed}


@router.put("/profile")
async def update_profile(body: dict, user: dict = Depends(current_user)):
    full_name = (body.get("full_name") or "").strip()
    if not full_name:
        raise HTTPException(400, "Full name is required")
    tokens = tokenise_name(full_name)
    if len(tokens) < 2:
        raise HTTPException(400, "Please enter your first and last name")

    updates: dict = {
        "full_name": full_name,
        "name_tokens": tokens,
    }
    # Only mark onboarding complete when the caller explicitly asks
    # (pass complete=false from mid-flow saves so steps 3/4 still show on refresh).
    if body.get("complete", True):
        updates["onboarding_complete"] = True

    update: dict = {"$set": updates}
    if "onboarding_complete" not in updates:
        # Mid-flow save (complete=false) that creates the profile: record the
        # flag explicitly so a missing field can only mean a legacy document.
        update["$setOnInsert"] = {"onboarding_complete": False}
    await user_profiles_col.update_one({"_id": user["email"]}, update, upsert=True)
    doc = await user_profiles_col.find_one({"_id": user["email"]})
    return _serialize(doc)
