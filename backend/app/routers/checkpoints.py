"""Checkpoints router — the Door's HTTP surface.

Mirrors backend/app/routers/planned.py in style:
  router = APIRouter(tags=["checkpoints"])
  user: dict = Depends(current_user)
  from app.services import response_cache
"""
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.services import response_cache
from app.services.checkpoints import (
    DuplicateCheckpoint,
    cancel_checkpoint,
    create_checkpoint,
    list_active,
    record_intent,
)

router = APIRouter(tags=["checkpoints"])


@router.post("/checkpoints")
async def post_checkpoint(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    ref = (body.get("ref") or "").strip()
    aim_amount = body.get("aim_amount")

    try:
        doc = await create_checkpoint(uid, ref, aim_amount=aim_amount)
    except DuplicateCheckpoint as e:
        raise HTTPException(409, "An aim already exists for this category this period")
    except ValueError as e:
        raise HTTPException(400, str(e))

    response_cache.invalidate(uid)
    return doc


@router.get("/checkpoints")
async def get_checkpoints(user: dict = Depends(current_user)):
    uid = user["email"]
    checkpoints = await list_active(uid)
    return {"checkpoints": checkpoints}


@router.delete("/checkpoints/{checkpoint_id}")
async def delete_checkpoint(checkpoint_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    try:
        ObjectId(checkpoint_id)
    except InvalidId:
        raise HTTPException(400, "Invalid checkpoint_id")

    cancelled = await cancel_checkpoint(uid, checkpoint_id)
    if not cancelled:
        raise HTTPException(404, "Checkpoint not found or already resolved")

    response_cache.invalidate(uid)
    return {"ok": True}


@router.post("/trends/intent")
async def post_intent(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    category = (body.get("category") or "").strip()
    answer   = (body.get("answer") or "").strip()

    try:
        result = await record_intent(uid, category, answer)
    except ValueError as e:
        raise HTTPException(400, str(e))

    response_cache.invalidate(uid)
    return {"ok": True, "category": result["category"], "answer": result["answer"]}
