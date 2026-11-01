"""E13: allow accounts that signed up before invite-only mode.

Accounts created under open sign-up, or under the old ALLOWED_EMAILS
environment list, have a `user_profiles` document but no `allowed_signups`
row, so invite-only sign-in refuses them. This module finds them and gives
each an ordinary, revocable "invited" row with source "pre_list_backfill".

Shared by POST /ops/people/backfill (owner-only page) and
backend/scripts/backfill_allowlist.py, so both apply exactly one rule.

Guarantees: the owner is never touched; a person who already has any row
(including a revoked one) is never changed; a second run adds nothing.
Nothing here logs or returns an address, only counts.
"""
import re
from datetime import datetime, timezone

from app.core.config import PRIMARY_EMAIL, _gmail_key
from app.db import collections as cols

SOURCE = "pre_list_backfill"
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


async def pending_accounts() -> dict[str, str]:
    """{allow-list key: profile email} for signed-up accounts with no row."""
    owner = _gmail_key(PRIMARY_EMAIL)
    have = {d["key"] async for d in cols.allowed_signups_col.find({}, {"key": 1}) if d.get("key")}
    out: dict[str, str] = {}
    async for d in cols.user_profiles_col.find({}, {"_id": 1}):
        uid = d.get("_id")
        if not (isinstance(uid, str) and _EMAIL_RE.match(uid)):
            continue
        key = _gmail_key(uid.strip().lower())
        if key == owner or key in have:
            continue
        out.setdefault(key, uid.strip().lower())
    return out


async def preview_count() -> int:
    return len(await pending_accounts())


async def apply_backfill() -> int:
    """Create the missing rows; return how many were added."""
    pending = await pending_accounts()
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    for key, email in pending.items():
        # $setOnInsert only: a row created meanwhile is never overwritten.
        await cols.allowed_signups_col.update_one(
            {"key": key},
            {"$setOnInsert": {
                "key": key, "email": email, "status": "invited",
                "source": SOURCE, "invited_by": SOURCE, "note": None,
                "created_at": now, "updated_at": now,
            }},
            upsert=True,
        )
    return len(pending)
