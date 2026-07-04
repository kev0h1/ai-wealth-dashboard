"""User profile endpoints: full name, home location, onboarding state."""
import re
import urllib.parse
import urllib.request
import json as _json

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import user_profiles_col

router = APIRouter(tags=["profile"])

_POSTCODE_RE = re.compile(r"^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$", re.I)


def tokenise_name(full_name: str) -> list[str]:
    """Split a full name into lowercase tokens of length >= 2."""
    parts = re.split(r"[^a-zA-Z]+", (full_name or "").lower())
    return [p for p in parts if len(p) >= 2]


def geocode_postcode(postcode: str) -> dict | None:
    """Resolve a UK postcode to {postcode, lat, lng} via postcodes.io. None if invalid/unreachable."""
    pc = (postcode or "").strip()
    if not pc or not _POSTCODE_RE.match(pc):
        return None
    url = f"https://api.postcodes.io/postcodes/{urllib.parse.quote(pc)}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            result = _json.loads(resp.read()).get("result") or {}
        lat, lng = result.get("latitude"), result.get("longitude")
        if lat is None or lng is None:
            return None
        return {"postcode": result.get("postcode", pc.upper()), "lat": lat, "lng": lng}
    except Exception:
        return None


def _serialize(doc: dict | None) -> dict:
    if not doc:
        return {"full_name": "", "name_tokens": [], "onboarding_complete": False,
                "postcode": None, "lat": None, "lng": None}
    return {
        "full_name": doc.get("full_name", ""),
        "name_tokens": doc.get("name_tokens", []),
        "onboarding_complete": bool(doc.get("onboarding_complete")),
        "postcode": doc.get("postcode"),
        "lat": doc.get("lat"),
        "lng": doc.get("lng"),
    }


@router.get("/profile")
async def get_profile(user: dict = Depends(current_user)):
    doc = await user_profiles_col.find_one({"_id": user["email"]})
    return _serialize(doc)


@router.delete("/account")
async def delete_account(body: dict, user: dict = Depends(current_user)):
    """Erase every trace of the user: all documents in every collection,
    matched by user_id field or uid-keyed _id. Requires typed confirmation."""
    if body.get("confirm") != "DELETE":
        raise HTTPException(400, "Confirmation required")
    uid = user["email"]

    from app.db import collections as _cols
    removed: dict[str, int] = {}
    for attr in dir(_cols):
        if not attr.endswith("_col"):
            continue
        col = getattr(_cols, attr)
        r_field = await col.delete_many({"user_id": uid})
        r_keyed = await col.delete_many({"_id": uid})
        count = r_field.deleted_count + r_keyed.deleted_count
        if count:
            removed[attr.removesuffix("_col")] = count

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

    # Postcode is optional. If present, validate + geocode; reject only an
    # explicitly-bad postcode (so a blank field never blocks onboarding).
    if "postcode" in body:
        raw = (body.get("postcode") or "").strip()
        if raw:
            geo = geocode_postcode(raw)
            if not geo:
                raise HTTPException(400, "That doesn't look like a valid UK postcode")
            updates.update(geo)
        else:
            updates.update({"postcode": None, "lat": None, "lng": None})

    await user_profiles_col.update_one(
        {"_id": user["email"]}, {"$set": updates}, upsert=True,
    )
    doc = await user_profiles_col.find_one({"_id": user["email"]})
    return _serialize(doc)
