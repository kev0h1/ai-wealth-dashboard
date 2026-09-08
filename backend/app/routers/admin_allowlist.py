"""D5: in-app sign-up allow list — day-to-day invites without an
`ALLOWED_EMAILS` env var edit and a Railway redeploy.

`ALLOWED_EMAILS` (app.core.config) stays the seed list, checked first by
every sign-in (see app.core.allowlist.resolve_allowed_signup); this router
manages the second, day-to-day layer on top of it, from the /ops/go-live
page's Allowlist section. Bot-or-owner gate, same pairing as
app.routers.admin_usage._require_admin / app.routers.ops._require_owner —
duplicated locally rather than imported, matching this codebase's existing
convention of each admin router owning its own small gate function.

Revoking never deletes a doc (status flips to "revoked"), and neither the
account owner nor anything in ALLOWED_EMAILS can be revoked here — that
list is only ever changed by editing the env var and redeploying, exactly
as before this router existed.
"""
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.auth import current_user
from app.core.config import ALLOWED_EMAILS, PRIMARY_EMAIL, _gmail_key
from app.db.collections import allowed_signups_col

router = APIRouter(prefix="/admin/allowlist", tags=["admin"])

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _require_admin(user: dict) -> None:
    if user.get("name") == "Bot":
        return
    if (user.get("email") or "").strip().lower() == PRIMARY_EMAIL:
        return
    raise HTTPException(403, "Admin only")


class InviteRequest(BaseModel):
    email: str
    note: str | None = None

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address.")
        return v

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v or None


def _env_keys() -> set[str]:
    return {_gmail_key(e) for e in ALLOWED_EMAILS}


def _serialize(doc: dict) -> dict:
    return {
        "email": doc.get("email"),
        "key": doc.get("key"),
        "invited_by": doc.get("invited_by"),
        "created_at": doc.get("created_at"),
        "status": doc.get("status"),
        "note": doc.get("note"),
    }


async def _payload() -> dict:
    docs = await allowed_signups_col.find({"status": "invited"}).sort("created_at", -1).to_list(None)
    return {
        "invited": [_serialize(d) for d in docs],
        # Read-only reference — the ops page shows these with a "from env"
        # pill; they are never editable from here (see module docstring).
        "env_seeded": sorted(ALLOWED_EMAILS),
    }


@router.get("")
async def list_allowlist(user: dict = Depends(current_user)):
    _require_admin(user)
    return await _payload()


@router.post("")
async def add_allowlist(body: InviteRequest, user: dict = Depends(current_user)):
    _require_admin(user)
    key = _gmail_key(body.email)
    now = datetime.now(timezone.utc)
    # Idempotent: inviting an address that's already invited is a no-op
    # (besides refreshing note/invited_by); inviting a REVOKED address
    # flips it straight back to "invited" rather than erroring or creating
    # a duplicate doc, and $setOnInsert keeps the original created_at on a
    # true re-invite so "invited" date reflects first invitation, not last.
    await allowed_signups_col.update_one(
        {"key": key},
        {
            "$set": {
                "email": body.email,
                "status": "invited",
                "invited_by": (user.get("email") or "").strip().lower(),
                "note": body.note,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return await _payload()


@router.delete("/{key}")
async def revoke_allowlist(key: str, user: dict = Depends(current_user)):
    _require_admin(user)
    if key == _gmail_key(PRIMARY_EMAIL) or key in _env_keys():
        raise HTTPException(400, "This address is on the env allow list; it can't be revoked here.")
    doc = await allowed_signups_col.find_one({"key": key})
    if not doc:
        raise HTTPException(404, "Not found")
    await allowed_signups_col.update_one(
        {"key": key},
        {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},
    )
    return await _payload()
