"""G248: Penny chat history. The last PENNY_MAX_CONVERSATIONS conversations
per user, each capped at PENNY_MAX_TURNS turns.

Storage shape (collection `penny_conversations`, one document per chat):
  {_id: conversation_id (uuid4 str), user_id, title, created_at, updated_at,
   turns: [{role: "user"|"assistant", text, ts, proposal_id?, table?, chart?}]}
(G254: an assistant turn may carry `last_result` {tool, args, ids}: the ids of the
transactions its answer listed, so "these" resolves later. Ids only, never sent
to the client, included in the data export.)
(G252: `chart` is the validated chart spec, see penny_chart.)
(G251: `table` is an assistant turn's validated table block, see penny_table.)

A "turn" is one message, so 30 turns is 15 question and answer pairs. Only the
user's own text and Penny's reply text are stored: never tool payloads, never
secrets, never the screen `view` grounding. The model context is NOT this
list: routers/can_i.py still sends only the most recent MODEL_HISTORY_TURNS
(6) turns to the model, so the cap is about readability and storage, not
tokens.

Every query is scoped by user_id, including the eviction of the 11th oldest
chat. Retention matches PRIVACY.md's chat-session row: a TTL index on
updated_at (app/main.py), see PENNY_CONVERSATION_RETENTION_SECONDS.
"""
import logging
import re
import uuid
from datetime import datetime, timezone

from app.db.collections import penny_conversations_col, penny_proposals_col
from app.services import penny_chart, penny_table

logger = logging.getLogger(__name__)

PENNY_MAX_CONVERSATIONS = 10
PENNY_MAX_TURNS = 30
PENNY_TITLE_MAX = 60
PENNY_PREVIEW_MAX = 90
PENNY_TURN_TEXT_MAX = 2000
# Matches the "Chat sessions | 7 days" row of PRIVACY.md Section 9 until Kevin
# approves a different period for stored conversations.
PENNY_CONVERSATION_RETENTION_SECONDS = 7 * 24 * 3600


class ConversationNotFound(Exception):
    pass


class ConversationFull(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)  # naive-ok: tz-aware UTC instant for sort and TTL, not a user-facing day


def _one_line(text: str, limit: int) -> str:
    flat = re.sub(r"\s+", " ", text or "").strip()
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _iso(dt) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _summary(doc: dict) -> dict:
    turns = doc.get("turns") or []
    last_reply = next((t["text"] for t in reversed(turns) if t.get("role") == "assistant"), "")
    return {
        "id": doc["_id"],
        "title": doc.get("title") or "New chat",
        "created_at": _iso(doc.get("created_at")),
        "updated_at": _iso(doc.get("updated_at")),
        "preview": _one_line(last_reply, PENNY_PREVIEW_MAX),
        "turn_count": len(turns),
        "at_cap": len(turns) >= PENNY_MAX_TURNS,
    }


def _full(doc: dict, internal: bool = False) -> dict:
    out = _summary(doc)
    out["turns"] = [
        {k: (_iso(v) if k == "ts" else v) for k, v in t.items() if internal or k != "last_result"}
        for t in (doc.get("turns") or [])
    ]
    return out


def clean_last_result(raw) -> dict | None:
    """G254: the transaction ids of the answer's result set, plus the tool and
    the few short arguments that produced it. Ids only, no payloads."""
    if not isinstance(raw, dict) or raw.get("tool") != "search_transactions":
        return None
    ids = [str(i)[:64] for i in (raw.get("ids") or []) if isinstance(i, (str, int)) and str(i).strip()]
    if not ids:
        return None
    args = {}
    for k, v in (raw.get("args") or {}).items() if isinstance(raw.get("args"), dict) else []:
        if isinstance(k, str) and len(k) <= 20 and isinstance(v, (str, int, float)) and not isinstance(v, bool):
            args[k] = str(v)[:40]
    return {"tool": "search_transactions", "args": args, "ids": ids[:200]}


def clean_turn(role, text, proposal_id=None, table=None, chart=None, last_result=None) -> dict | None:
    """One stored turn, or None when it is not storable (bad role, empty
    text). Text only; nothing else from the request is kept, except G251's
    optional validated `table` block on an assistant turn: the same values the
    user saw on screen, never a tool payload."""
    if role not in ("user", "assistant") or not isinstance(text, str):
        return None
    text = text.strip()[:PENNY_TURN_TEXT_MAX]
    if not text:
        return None
    turn = {"role": role, "text": text, "ts": _now()}
    if isinstance(proposal_id, str) and proposal_id:
        turn["proposal_id"] = proposal_id[:64]
    if table is not None and role == "assistant":
        block = penny_table.validate_or_none(table)
        if block:
            turn["table"] = block
    if chart is not None and role == "assistant":
        spec = penny_chart.validate_or_none(chart)
        if spec:
            turn["chart"] = spec
    if last_result is not None and role == "assistant":
        cleaned = clean_last_result(last_result)
        if cleaned:
            turn["last_result"] = cleaned
    return turn


async def latest_last_result(uid: str, cid: str) -> dict | None:
    """The newest assistant turn's last_result for the user's own chat, or
    None. Never raises: memory is a convenience, not a dependency."""
    try:
        doc = await penny_conversations_col.find_one({"_id": cid, "user_id": uid}, {"turns": 1})
    except Exception:
        logger.exception("penny_conversations: last_result lookup failed")
        return None
    for t in reversed((doc or {}).get("turns") or []):
        if t.get("role") == "assistant":
            return clean_last_result(t.get("last_result"))
    return None


async def list_conversations(uid: str) -> list[dict]:
    cur = penny_conversations_col.find({"user_id": uid}).sort("updated_at", -1).limit(PENNY_MAX_CONVERSATIONS)
    return [_summary(d) async for d in cur]


async def get_conversation(uid: str, cid: str) -> dict:
    doc = await penny_conversations_col.find_one({"_id": cid, "user_id": uid})
    if not doc:
        raise ConversationNotFound(cid)
    return _full(doc)


async def create_conversation(uid: str) -> dict:
    """Insert an empty chat, then delete this user's chats beyond the newest
    PENNY_MAX_CONVERSATIONS (the 11th oldest goes). User-scoped both ways."""
    now = _now()
    doc = {"_id": str(uuid.uuid4()), "user_id": uid, "title": None,
           "created_at": now, "updated_at": now, "turns": []}
    await penny_conversations_col.insert_one(doc)
    stale = [d["_id"] async for d in penny_conversations_col.find({"user_id": uid}, {"_id": 1})
             .sort([("updated_at", -1), ("created_at", -1)]).skip(PENNY_MAX_CONVERSATIONS)]
    if stale:
        await penny_conversations_col.delete_many({"user_id": uid, "_id": {"$in": stale}})
    return _full(doc)


async def append_turns(uid: str, cid: str, turns: list[dict]) -> dict:
    """Append already-cleaned turns. The cap is enforced in the update filter
    itself (the array must have room), so two racing appends cannot overshoot.
    Raises ConversationNotFound or ConversationFull; returns the new count and
    whether the chat is now at the cap."""
    turns = [t for t in turns if t]
    if not turns:
        raise ValueError("no storable turns")
    room_index = f"turns.{PENNY_MAX_TURNS - len(turns)}"
    res = await penny_conversations_col.update_one(
        {"_id": cid, "user_id": uid, room_index: {"$exists": False}},
        {"$push": {"turns": {"$each": turns}}, "$set": {"updated_at": _now()}},
    )
    if not res.matched_count:
        if not await penny_conversations_col.find_one({"_id": cid, "user_id": uid}, {"_id": 1}):
            raise ConversationNotFound(cid)
        raise ConversationFull(cid)
    first_q = next((t["text"] for t in turns if t["role"] == "user"), None)
    if first_q:
        await penny_conversations_col.update_one(
            {"_id": cid, "user_id": uid, "title": None},
            {"$set": {"title": _one_line(first_q, PENNY_TITLE_MAX)}},
        )
    doc = await penny_conversations_col.find_one({"_id": cid, "user_id": uid}, {"turns": 1})
    count = len((doc or {}).get("turns") or [])
    return {"turn_count": count, "at_cap": count >= PENNY_MAX_TURNS}


async def conversation_state(uid: str, cid: str) -> dict | None:
    """{turn_count, at_cap} for the user's own chat, or None if absent."""
    doc = await penny_conversations_col.find_one({"_id": cid, "user_id": uid}, {"turns": 1})
    if not doc:
        return None
    count = len(doc.get("turns") or [])
    return {"turn_count": count, "at_cap": count >= PENNY_MAX_TURNS}


async def delete_conversation(uid: str, cid: str) -> bool:
    res = await penny_conversations_col.delete_one({"_id": cid, "user_id": uid})
    return bool(res.deleted_count)


async def link_proposal(uid: str, cid: str, proposal_id: str) -> None:
    """Tag a proposal row with the chat it came from (user-scoped)."""
    await penny_proposals_col.update_one(
        {"_id": proposal_id, "user_id": uid}, {"$set": {"conversation_id": cid}},
    )


async def export_conversations(uid: str) -> list[dict]:
    """Everything stored for the user, for the data export."""
    cur = penny_conversations_col.find({"user_id": uid}).sort("updated_at", -1)
    return [_full(d, internal=True) async for d in cur]
