"""The Mirror — behavioural identity router."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.auth import current_user
from app.db.collections import behaviour_portrait_col
from app.services.behaviour import compute_portrait

router = APIRouter(tags=["behaviour"])


class ChoiceBody(BaseModel):
    trait_id: str
    choice: str  # "keep" | "change"


@router.get("/mirror")
async def get_mirror(
    refresh: bool = Query(False),
    user: dict = Depends(current_user),
):
    uid = user["email"]

    # Check cache
    if not refresh:
        cached = await behaviour_portrait_col.find_one({"_id": uid})
        if cached:
            cached.pop("_id", None)
            computed_at = cached.get("computed_at")
            if computed_at:
                try:
                    ca = datetime.fromisoformat(computed_at.replace("Z", "+00:00"))
                    if datetime.now(timezone.utc) - ca < timedelta(days=7):
                        return cached
                except Exception:
                    pass

    # Compute fresh portrait
    portrait = await compute_portrait(uid)

    if portrait.get("status") == "ok":
        # Restore any persisted choices from the cached doc
        old = await behaviour_portrait_col.find_one({"_id": uid})
        if old:
            old_choices = {t["id"]: t.get("choice") for t in old.get("traits", [])}
            for trait in portrait["traits"]:
                if trait["id"] in old_choices and old_choices[trait["id"]]:
                    trait["choice"] = old_choices[trait["id"]]

        await behaviour_portrait_col.replace_one(
            {"_id": uid},
            {"_id": uid, **portrait},
            upsert=True,
        )

    return portrait


@router.post("/mirror/choice")
async def set_mirror_choice(
    body: ChoiceBody,
    user: dict = Depends(current_user),
):
    uid = user["email"]
    if body.choice not in ("keep", "change"):
        from fastapi import HTTPException
        raise HTTPException(400, "choice must be 'keep' or 'change'")

    # Update the choice in the cached portrait
    await behaviour_portrait_col.update_one(
        {"_id": uid, "traits.id": body.trait_id},
        {"$set": {"traits.$.choice": body.choice}},
    )
    return {"ok": True, "trait_id": body.trait_id, "choice": body.choice}
