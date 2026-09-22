"""A84: server-side revocation for an otherwise-stateless session token.

`app.core.config.serializer` mints session tokens as `itsdangerous`
timestamped signatures — self-contained and, by design, unrevocable by the
signature scheme alone. `DELETE /account` (app.routers.profile.delete_account)
and the dormant-account sweep (app.services.retention.sweep_dormant_users)
both permanently erase a user's data, but neither one previously stopped an
already-issued token from continuing to authenticate: the same bearer stayed
valid for up to SESSION_MAX_AGE (7 days) after the account it names, and
every document under it, were gone — live-observed re-creating data via
PUT /profile's upsert after the account was deleted and recreated. See A84
on the board for the full incident.

This module is a narrow tombstone: "no token for this email issued before
`not_before` is valid any more". It does not track individual tokens (there
is nothing to track — the signature carries no session id), it just marks a
cutoff. `app.core.auth.current_user` checks every session-branch request
against it.
"""
import hashlib
from datetime import datetime, timedelta, timezone

from app.core.config import SESSION_MAX_AGE
from app.core.timeutil import as_utc

# Tombstones outlive the longest-lived token they could possibly need to
# catch (SESSION_MAX_AGE) plus a small safety margin, then the TTL index on
# `expires_at` (app.main's index setup) reaps them — no token minted before
# a tombstone can still be unexpired once the tombstone itself expires.
_TOMBSTONE_MARGIN = timedelta(minutes=5)


def _key(email: str) -> str:
    """Hash the tombstone key rather than keying by the raw email, because
    `app.services.retention.erase_user` deletes every `*_col` document
    whose `_id` equals the raw email (its dir()-based sweep walks every
    collection on `app.db.collections` by that exact rule) — a tombstone
    keyed by the plain email would be erased by the very call it exists to
    outlive. Hashing sidesteps that without needing to special-case this
    collection in erase_user's sweep."""
    normalised = (email or "").strip().lower()
    return hashlib.sha256(normalised.encode()).hexdigest()


async def revoke_sessions(email: str, now: datetime | None = None) -> None:
    """Mark every session token for `email` issued before `now` as invalid,
    from now on. Idempotent and safe to call more than once: if a tombstone
    already exists, its `not_before` only ever moves later (via Mongo's
    `$max`), never earlier, so an earlier call can't un-revoke a session a
    later call already caught.

    Looks up `session_tombstones_col` fresh from `app.db.collections` on
    each call (like `app.services.retention.erase_user`'s own dir()-based
    sweep) rather than binding it at import time, so a test that broadly
    replaces every `*_col` collection on that module (retention.py's own
    test suite does this for `erase_user`) transparently covers this call
    too, instead of silently reaching the real Motor client."""
    from app.db import collections as _cols
    now = as_utc(now) if now is not None else datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=SESSION_MAX_AGE) + _TOMBSTONE_MARGIN
    await _cols.session_tombstones_col.update_one(
        {"_id": _key(email)},
        {"$max": {"not_before": now, "expires_at": expires_at}},
        upsert=True,
    )


async def is_revoked(email: str, issued_at: datetime) -> bool:
    """True if `email` has a tombstone and `issued_at` predates its
    `not_before`. `issued_at` is expected aware UTC, the shape
    `serializer.loads(..., return_timestamp=True)` returns; `not_before` as
    read back from Mongo may come back naive (Motor's client is not
    `tz_aware`), so it's normalised before comparing. Same fresh-lookup
    reasoning as `revoke_sessions` above."""
    from app.db import collections as _cols
    doc = await _cols.session_tombstones_col.find_one({"_id": _key(email)})
    if not doc:
        return False
    not_before = as_utc(doc.get("not_before"))
    if not_before is None:
        return False
    return as_utc(issued_at) < not_before
