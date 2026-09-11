"""B20: admin-composed offer broadcasts.

Two families of route:

- `/admin/broadcast*` — bot-or-owner only (same admin-or-owner pairing as
  app.routers.admin_usage._require_admin / app.routers.ops._require_owner,
  merged into one gate since this is read by both a future cron/bot AND
  Kevin's own /ops page, which can only ever carry his own session token,
  never BOT_SECRET — that never reaches a browser). Compose (resolve +
  freeze an audience, never sends), then send (confirm step, idempotent).
- `/offers*` — any authenticated user, scoped to themselves. The in-app
  card half of a sent broadcast: unread offers, and dismissing one.

See app/services/broadcast.py for the actual audience-resolution/send
logic and its docstrings for the idempotency guarantees.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL
from app.services import broadcast

router = APIRouter(tags=["broadcast"])


def _require_admin(user: dict) -> None:
    """Bot (BOT_SECRET bearer, `current_user` resolves it to
    `{"name": "Bot", ...}`) or the account owner's own session — see this
    module's docstring for why a strict bot-only gate (routers/admin.py's
    `admin_sync_all`, which checks the raw Authorization header itself)
    can't work here: BOT_SECRET is a server secret and never reaches the
    /ops page's browser. An unauthenticated request never even reaches
    this function (`current_user` already 401s it); an ordinary signed-in
    user who is neither the bot nor the owner is rejected here."""
    if user.get("name") == "Bot":
        return
    if (user.get("email") or "").strip().lower() == PRIMARY_EMAIL:
        return
    raise HTTPException(403, "Admin only")


def _mask(email: str) -> str:
    from app.core.config import mask_email
    return mask_email(email or "")


def _public_broadcast(doc: dict) -> dict:
    """Strip the raw recipient email list before it ever reaches a
    response — the operator gets a count plus a masked sample to spot-
    check, never the full list of real addresses over HTTP."""
    if doc is None:
        return doc
    recipients = doc.get("recipient_ids") or []
    out = {k: v for k, v in doc.items() if k not in ("recipient_ids",)}
    out["id"] = out.pop("_id", None)
    out["recipient_sample"] = [_mask(e) for e in recipients[:10]]
    return out


class AudienceSpec(BaseModel):
    type: str
    tier: str | None = None
    state: str | None = None


class ComposeRequest(BaseModel):
    title: str
    body: str
    url: str | None = "/"
    audience: AudienceSpec


class SendRequest(BaseModel):
    dry_run: bool = False


@router.post("/admin/broadcast/preview")
async def broadcast_preview(body: ComposeRequest, user: dict = Depends(current_user)):
    """Compose step. Resolves the audience right now and freezes it onto a
    new draft broadcast — this is never a send, it exists purely so the
    operator can see the recipient count (and the audience definition)
    before anything goes out."""
    _require_admin(user)
    try:
        doc = await broadcast.create_broadcast(
            title=body.title, body=body.body, url=body.url,
            audience=body.audience.model_dump(exclude_none=True),
            created_by=user.get("email") or "unknown",
        )
    except broadcast.BroadcastError as e:
        raise HTTPException(400, str(e))
    return _public_broadcast(doc)


@router.post("/admin/broadcast/{broadcast_id}/send")
async def broadcast_send(broadcast_id: str, body: SendRequest, user: dict = Depends(current_user)):
    """Confirm step. Sends to exactly the recipient list frozen at preview
    time. Idempotent — see app.services.broadcast.send_broadcast's
    docstring; calling this twice for the same broadcast_id never sends
    twice."""
    _require_admin(user)
    try:
        doc = await broadcast.send_broadcast(broadcast_id, dry_run=body.dry_run)
    except broadcast.BroadcastError as e:
        raise HTTPException(404, str(e))
    return _public_broadcast(doc)


@router.get("/admin/broadcast")
async def broadcast_list(user: dict = Depends(current_user)):
    _require_admin(user)
    docs = await broadcast.list_broadcasts()
    return {"broadcasts": [_public_broadcast(d) for d in docs]}


@router.get("/admin/broadcast/{broadcast_id}")
async def broadcast_detail(broadcast_id: str, user: dict = Depends(current_user)):
    _require_admin(user)
    doc = await broadcast.get_broadcast(broadcast_id)
    if doc is None:
        raise HTTPException(404, "Not found")
    return _public_broadcast(doc)


@router.get("/offers")
async def list_offers(user: dict = Depends(current_user)):
    """The in-app-card half of a sent broadcast — unread offers addressed
    to the calling user, most recent first."""
    uid = user["email"]
    offers = await broadcast.list_offers_for_user(uid)
    return {
        "offers": [
            {
                "id": o["_id"],
                "title": o["title"],
                "body": o["body"],
                "url": o.get("url") or "/",
                "sent_at": o.get("sent_at"),
            }
            for o in offers
        ]
    }


@router.post("/offers/{receipt_id}/dismiss")
async def dismiss_offer(receipt_id: str, user: dict = Depends(current_user)):
    uid = user["email"]
    ok = await broadcast.dismiss_offer(uid, receipt_id)
    if not ok:
        raise HTTPException(404, "Not found")
    return {"ok": True}
