"""D5: sign-up allow list, phase 3 — an in-app `allowed_signups` collection
so day-to-day invites don't need an `ALLOWED_EMAILS` env var edit and a
Railway redeploy (see /ops/go-live's Allowlist section,
app/routers/admin_allowlist.py).

`app.core.config.resolve_allowed_email` (the `ALLOWED_EMAILS` env var)
stays the seed list — it is checked FIRST and this collection never
overrides it, so the owner's own account (and anything else hardcoded at
deploy time) keeps working even if Mongo is unreachable. This collection
is the second, optional check: an invited address with `status ==
"invited"` resolves the same way an env-var address does, dot-insensitive
the same way (same `_gmail_key`).

Every Mongo touch here is defensive (try/except, log-and-degrade, bounded
by `max_time_ms`) — same doctrine as `app.services.response_cache`: a
Mongo hiccup must fail CLOSED (refuse the sign-in) rather than 500 or
hang. There is no caching beyond the single lookup: sign-ins are rare
enough that a live read every time is cheap, and a stale allow/revoke
decision is exactly the bug an admin adding or removing someone would
notice immediately.
"""
import logging

from app.core.config import _gmail_key, mask_email, resolve_allowed_email
from app.db.collections import allowed_signups_col

logger = logging.getLogger(__name__)

_MAX_TIME_MS = 3000


async def resolve_allowed_signup(email: str) -> str | None:
    """Return the allow-list spelling for `email` if it's allowed to sign
    in: the env-var seed list first, then the in-app allow list (invited,
    not revoked). Returns None if neither allows it. Callers still need to
    check `is_signup_open()` themselves for the public-launch override,
    exactly as they did with `resolve_allowed_email` before this existed.
    """
    if not email:
        return None
    seeded = resolve_allowed_email(email)
    if seeded:
        return seeded

    key = _gmail_key(email.strip().lower())
    try:
        doc = await allowed_signups_col.find_one(
            {"key": key, "status": "invited"}, max_time_ms=_MAX_TIME_MS
        )
    except Exception:
        logger.exception("resolve_allowed_signup(%s): Mongo read failed", mask_email(email))
        return None
    if not doc:
        return None
    return (doc.get("email") or email).strip().lower()
