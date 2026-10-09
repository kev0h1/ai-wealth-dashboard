"""G248: Penny chat history endpoints. See app.services.penny_conversations
for the storage shape, the 10-chat and 30-turn caps and the privacy limits."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.services import penny_conversations as svc

router = APIRouter(tags=["penny"])

_FULL = "This chat is full. Start a new chat to carry on."


@router.get("/penny/conversations")
async def list_conversations(user: dict = Depends(current_user)):
    return {"conversations": await svc.list_conversations(user["email"]),
            "max_conversations": svc.PENNY_MAX_CONVERSATIONS, "max_turns": svc.PENNY_MAX_TURNS}


@router.post("/penny/conversations")
async def create_conversation(user: dict = Depends(current_user)):
    return await svc.create_conversation(user["email"])


@router.get("/penny/conversations/export")
async def export_conversations(user: dict = Depends(current_user)):
    return {"conversations": await svc.export_conversations(user["email"])}


@router.get("/penny/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, user: dict = Depends(current_user)):
    try:
        return await svc.get_conversation(user["email"], conversation_id)
    except svc.ConversationNotFound:
        raise HTTPException(404, "Conversation not found")


@router.post("/penny/conversations/{conversation_id}/turns")
async def append_turns(conversation_id: str, body: dict, user: dict = Depends(current_user)):
    raw = body.get("turns")
    if not isinstance(raw, list) or not raw or len(raw) > 4:
        raise HTTPException(400, "turns must be a list of 1 to 4 turns")
    turns = [svc.clean_turn(t.get("role"), t.get("text"), t.get("proposal_id"))
             for t in raw if isinstance(t, dict)]
    if not turns or any(t is None for t in turns):
        raise HTTPException(400, "each turn needs a role and some text")
    try:
        return await svc.append_turns(user["email"], conversation_id, turns)
    except svc.ConversationNotFound:
        raise HTTPException(404, "Conversation not found")
    except svc.ConversationFull:
        raise HTTPException(409, detail={"code": "PENNY_CONVERSATION_FULL", "message": _FULL, "at_cap": True})


@router.delete("/penny/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user: dict = Depends(current_user)):
    if not await svc.delete_conversation(user["email"], conversation_id):
        raise HTTPException(404, "Conversation not found")
    return {"deleted": True}
