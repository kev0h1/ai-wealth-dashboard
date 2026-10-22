"""Sign-up allow list (D5, A174): the `allowed_signups` Mongo collection is
the ONLY allow list; no email list is read from the environment.

The account owner (`PRIMARY_EMAIL`) is always allowed in, checked first and
without touching Mongo, so an empty or unreachable allow list can never
lock the owner out. Everyone else needs an `allowed_signups` doc with
`status == "invited"`, matched dot-insensitively (same `_gmail_key`).

Every Mongo touch here is defensive (try/except, log-and-degrade, bounded
by `max_time_ms`) -- same doctrine as `app.services.response_cache`: a
Mongo hiccup must fail CLOSED (refuse the sign-in) rather than 500 or
hang. There is no caching beyond the single lookup: sign-ins are rare
enough that a live read every time is cheap, and a stale allow/revoke
decision is exactly the bug an admin adding or removing someone would
notice immediately.
"""
import logging

from app.core.config import _gmail_key, mask_email, resolve_owner_email
from app.db.collections import allowed_signups_col

logger = logging.getLogger(__name__)

_MAX_TIME_MS = 3000


async def resolve_allowed_signup(email: str) -> str | None:
    """Return the allow-list spelling for `email` if it's allowed to sign
    in: the owner first, then the in-app allow list (invited, not
    revoked). Returns None if neither allows it. Callers still need to
    check `is_signup_open()` themselves for the public-launch override,
    exactly as before.
    """
    if not email:
        return None
    owner = resolve_owner_email(email)
    if owner:
        return owner

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
