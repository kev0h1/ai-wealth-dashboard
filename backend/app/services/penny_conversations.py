"""G248: Penny chat history. The last PENNY_MAX_CONVERSATIONS conversations
per user, each capped at PENNY_MAX_TURNS turns.

Storage shape (collection `penny_conversations`, one document per chat):
  {_id: conversation_id (uuid4 str), user_id, title, created_at, updated_at,
   turns: [{role: "user"|"assistant", text, ts, proposal_id?, table?, chart?, move_plan?}]}
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
from app.services import penny_chart, penny_focus, penny_move_plan, penny_table

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
    """G254, generalised by B59: the entity focus of an answer (ids, short
    labels, the tool and the few short arguments that produced it). Ids and
    labels only, no payloads. See penny_focus."""
    return penny_focus.clean_focus(raw)


PROPOSAL_STATUSES = ("pending", "executed", "cancelled", "expired")


def _short(value, limit: int) -> str | None:
    text = re.sub(r"\s+", " ", str(value if value is not None else "")).strip()
    return text[:limit] if text else None


def clean_proposal(raw) -> dict | None:
    """B59: the compact proposal block kept on an assistant turn so a restored
    chat still shows the card. Only safe scheduled-goal display fields accompany text."""
    if not isinstance(raw, dict):
        return None
    proposal_id = _short(raw.get("proposal_id"), 64)
    summary = _short(raw.get("summary"), 300)
    consequence = _short(raw.get("consequence"), 300)
    if not proposal_id or not summary or not consequence:
        return None
    status = raw.get("status")
    out = {
        "proposal_id": proposal_id, "kind": _short(raw.get("kind"), 60) or "",
        "summary": summary, "consequence": consequence,
        "before": _short(raw.get("before"), 80), "after": _short(raw.get("after"), 80),
        "entity": _short(raw.get("entity"), 80),
        "destructive": bool(raw.get("destructive")),
        "status": status if status in PROPOSAL_STATUSES else "pending",
    }
    display = _scheduled_display_params(raw)
    if display:
        out["params"] = display
    return out


def _scheduled_display_params(row: dict) -> dict | None:
    """Only display metadata required to restore a scheduled-goal card.

    Proposal params normally remain executor-private. This allow-list is kept
    deliberately narrow so a restored chat cannot turn into a generic raw
    mutation-parameter API.
    """
    if row.get("kind") != "create_commitment":
        return None
    params = row.get("params")
    if not isinstance(params, dict) or not isinstance(params.get("schedule_preview"), dict):
        return None
    keys = ("schedule_preview", "schedule", "name", "source_account_id", "source_account_name",
            "destination_names", "funding_pots", "deactivate_allocation_id", "deactivate_allocation_name")
    return {key: params[key] for key in keys if key in params}


def clean_turn(role, text, proposal_id=None, table=None, chart=None, last_result=None, move_plan=None, proposal=None) -> dict | None:
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
    if move_plan is not None and role == "assistant":
        block = penny_move_plan.validate_or_none(move_plan)
        if block:
            turn["move_plan"] = block
    if proposal is not None and role == "assistant":
        block = clean_proposal(proposal)
        if block:
            turn["proposal"] = block
    if last_result is not None and role == "assistant":
        cleaned = clean_last_result(last_result)
        if cleaned:
            turn["last_result"] = cleaned
    return turn


async def latest_focus(uid: str, cid: str) -> dict | None:
    """B59: the most recent assistant turn that carries a focus, looking back
    up to FOCUS_LOOKBACK_TURNS turns, for the user's own chat, or None. Never
    raises: memory is a convenience, not a dependency."""
    try:
        doc = await penny_conversations_col.find_one({"_id": cid, "user_id": uid}, {"turns": 1})
    except Exception:
        logger.exception("penny_conversations: focus lookup failed")
        return None
    turns = ((doc or {}).get("turns") or [])[-penny_focus.FOCUS_LOOKBACK_TURNS:]
    for t in reversed(turns):
        if t.get("role") == "assistant":
            focus = clean_last_result(t.get("last_result"))
            if focus:
                return focus
    return None


latest_last_result = latest_focus  # the G254 name, kept for existing callers


async def list_conversations(uid: str) -> list[dict]:
    cur = penny_conversations_col.find({"user_id": uid}).sort("updated_at", -1).limit(PENNY_MAX_CONVERSATIONS)
    return [_summary(d) async for d in cur]


async def _live_proposal_statuses(uid: str, doc: dict) -> None:
    """B59: a stored proposal block says "pending" until someone updates it, so
    the proposal's own row is the truth on read: executed, cancelled, or past
    its expiry. Best effort: a failed lookup leaves the stored status."""
    pending = {t["proposal"]["proposal_id"]: t["proposal"] for t in doc.get("turns") or []
               if isinstance(t.get("proposal"), dict) and t["proposal"].get("status") == "pending"}
    if not pending:
        return
    try:
        rows = {r["_id"]: r async for r in penny_proposals_col.find({"user_id": uid, "_id": {"$in": list(pending)}})}
    except Exception:
        logger.exception("penny_conversations: proposal status lookup failed")
        return
    now = datetime.now()  # naive-ok: proposals store naive local expiry timestamps
    for pid, block in pending.items():
        row = rows.get(pid)
        if row is None:
            block["status"] = "expired"
        elif row.get("cancelled_at") and row.get("superseded_by"):
            replacement = await penny_proposals_col.find_one({"_id": row["superseded_by"], "user_id": uid})
            if replacement and not replacement.get("cancelled_at") and not replacement.get("executed_at") and not replacement.get("execution_claim") and not (replacement.get("expires_at") and now > replacement["expires_at"]):
                block.update(clean_proposal({"proposal_id": replacement["_id"], **replacement, "status": "pending"}) or {})
                block["status"] = "pending"
            else:
                block["status"] = "cancelled"
        elif row.get("executed_at"):
            block["status"] = "executed"
        elif row.get("cancelled_at"):
            block["status"] = "cancelled"
        elif row.get("expires_at") and now > row["expires_at"]:
            block["status"] = "expired"
        else:
            display = _scheduled_display_params(row)
            if display:
                block["params"] = display


async def get_conversation(uid: str, cid: str) -> dict:
    doc = await penny_conversations_col.find_one({"_id": cid, "user_id": uid})
    if not doc:
        raise ConversationNotFound(cid)
    await _live_proposal_statuses(uid, doc)
    return _full(doc)


async def set_proposal_status(uid: str, proposal_id: str, status: str) -> None:
    """Keep the stored turn's proposal status in step with the proposal row
    (confirm, cancel). Best effort and user-scoped: the row stays the truth."""
    if status not in PROPOSAL_STATUSES:
        return
    try:
        await penny_conversations_col.update_one(
            {"user_id": uid, "turns.proposal.proposal_id": proposal_id},
            {"$set": {"turns.$.proposal.status": status}},
        )
    except Exception:
        logger.exception("penny_conversations: could not update the stored proposal status")


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


async def replace_pending_proposal(uid: str, old_id: str, fresh: dict) -> None:
    """Move a stored confirm card onto its immutable replacement proposal.

    This is deliberately best effort: the proposal row remains authoritative,
    and a chat may have been deleted or trimmed between the two operations.
    """
    try:
        block = clean_proposal(fresh)
        if not block:
            return
        await penny_conversations_col.update_one(
            {"user_id": uid, "turns.proposal.proposal_id": old_id},
            {"$set": {"turns.$.proposal": block, "turns.$.proposal_id": fresh["proposal_id"], "updated_at": _now()}},
        )
    except Exception:
        logger.exception("penny_conversations: could not replace stored proposal")


async def export_conversations(uid: str) -> list[dict]:
    """Everything stored for the user, for the data export."""
    cur = penny_conversations_col.find({"user_id": uid}).sort("updated_at", -1)
    return [_full(d, internal=True) async for d in cur]
