"""Retention sweeps: user-erasure and connection-disconnect logic shared by
the profile/accounts routers AND the nightly arq cron
(`app.workers.sync_worker.task_retention_sweep`).

SECURITY.md section 6 / PRIVACY.md section 8 promise two automated sweeps:
  - a connection's data is deleted 30 days after its consent ends (expiry or
    withdrawal), if the user never pressed Disconnect;
  - a dormant account (no sign-in for 12 months) is erased entirely.

Both sweeps call the SAME routines the user-initiated endpoints call
(`erase_user` / `disconnect_connection`), moved out of
`routers/profile.py::delete_account` and `routers/accounts.py::delete_connection`
so behaviour is identical whether a human or the cron triggers it.

Fail-safe rule: a document with no usable timestamp is NEVER swept. Absence
of evidence someone actually is dormant/expired is not evidence they are.
"""
import logging
import re
from datetime import datetime, timedelta, timezone

from app.core.config import mask_email
# A106: reuses session_revocation's own uid-hashing scheme for the
# orphaned_revocations_col marker's `user_hash` field below, rather than
# replicating the sha256 logic a second time (first cross-module import of
# this private helper, per independent review). `user_hash` is stored as
# audit metadata ONLY, never queried on: every marker lookup below is by
# `_id == consent_id`, so a future change to `_key`'s own hashing scheme
# cannot break marker lookups, only the readability of this one field.
from app.core.session_revocation import revoke_sessions, _key as _hash_uid
from app.db.collections import (
    connections_col, accounts_col, finexer_consents_col, user_profiles_col,
    linked_identities_col, orphaned_revocations_col,
)
from app.services.account_cascade import cascade_account_deletion, purge_user_exclusions

logger = logging.getLogger(__name__)

# SECURITY.md section 6 periods.
_DORMANT_AFTER = timedelta(days=365)
_CONNECTION_GRACE = timedelta(days=30)

# A106: a marker that has failed this many attempts means the outage (or bad
# credential) has outlived a bad week: log a warning, but never drop the
# marker. Each nightly sweep retries at most _ORPHAN_BATCH markers, oldest first.
_ORPHAN_WARN_ATTEMPTS = 7
_ORPHAN_BATCH = 50

# Apple Hide My Email relay addresses always live on this domain (see
# app/core/identity.py). D3: the bar for "this looks like an orphaned relay
# placeholder account" starts with the uid actually being one of these.
_RELAY_DOMAIN = "@privaterelay.appleid.com"

# Every *_col-bound collection that counts as "this account has data" for
# erase_orphaned_relay_account's guard below: every provider's
# connection/consent doc, every provider's account doc, and every
# provider's transaction rows. Looked up fresh from app.db.collections by
# name (see account_has_data) rather than bound at import time, same
# reasoning as erase_user's own manifest-driven sweep. A101: the five
# collections with no live *_col binding (Mono/M-Pesa, unbound by A98) are
# NOT listed here — they are all connection/account/transaction data too,
# but account_has_data checks them separately via
# app.db.collections.ERASE_ONLY_COLLECTIONS, the same raw db[name] path
# erase_user uses for them, since there is no *_col attribute to getattr.
_ACCOUNT_DATA_COLLECTIONS = (
    "connections_col", "finexer_consents_col", "yapily_consents_col",
    "accounts_col", "statement_accounts_col", "manual_accounts_col",
    "yapily_accounts_col", "investment_accounts_col",
    "transactions_col", "statement_transactions_col",
    "yapily_transactions_col", "manual_transactions_col",
)

# Activity-stamp throttle: `current_user` (app.core.auth) calls stamp_activity
# on every authenticated request — this keeps it to at most one Mongo write
# per user per 6h per process, rather than one per request.
_ACTIVITY_STAMP_THROTTLE = timedelta(hours=6)
_last_stamped: dict[str, datetime] = {}


async def erase_user(uid: str) -> dict[str, int]:
    """Erase every trace of `uid`: every document in every collection named
    in app.db.collections.ERASURE_MANIFEST, matched by `user_id` field or
    uid-keyed `_id`, plus every collection in ERASE_ONLY_COLLECTIONS (A101 —
    collections with no live `*_col` binding but which can still hold user
    data, see that set's own comment). ERASURE_MANIFEST is an explicit list
    rather than a `dir()` walk of app.db.collections' `*_col` attributes
    (what this used to do): a runtime enumeration silently stopped sweeping
    five Kenya collections the moment A98 removed their bindings, with
    nothing to notice (A101). tests/test_collections_manifest.py guards the
    manifest against drifting from the live bindings again.

    Before any of that, revoke every live bank connection `uid` holds
    (TrueLayer `connections_col`, Finexer `finexer_consents_col`) via
    `disconnect_connection`. A local delete alone cannot cancel a Finexer
    consent: the consent lives at Finexer, so it must be revoked there
    (`disconnect_connection`'s Finexer branch does a best-effort remote
    `POST /consents/{id}/revoke`, A157) or it stays live after the user's account is
    gone (A82). Each revoke runs in its own try/except so one failing
    connection never blocks erasure of the rest, or of the user's other
    data; failures are logged and counted, not raised.

    This is the exact routine `routers/profile.py::delete_account` used to
    run inline (that endpoint now just checks the confirmation phrase and
    calls this); the dormant-user sweep below calls it too.
    """
    from app.db import collections as _cols
    removed: dict[str, int] = {}

    # Gathered via the same fresh `_cols` lookup as the delete loop below
    # (not this module's own top-level `connections_col`/`finexer_consents_col`
    # names) so a caller that only patches app.db.collections in tests still
    # gets full coverage, matching the dir()-based sweep's own safety net.
    revoked = 0
    revoke_errors = 0
    connection_ids = [d["_id"] async for d in _cols.connections_col.find({"user_id": uid}, {"_id": 1})]
    connection_ids += [d["_id"] async for d in _cols.finexer_consents_col.find({"user_id": uid}, {"_id": 1})]
    for connection_id in connection_ids:
        try:
            await disconnect_connection(uid, connection_id)
            revoked += 1
        except Exception:
            revoke_errors += 1
            logger.exception(
                "erase_user: failed to revoke connection %s for %s", connection_id, uid,
            )
    if revoked:
        removed["connections_revoked"] = revoked
    if revoke_errors:
        removed["connection_errors"] = revoke_errors

    for attr in _cols.ERASURE_MANIFEST:
        col = getattr(_cols, attr)
        r_field = await col.delete_many({"user_id": uid})
        r_keyed = await col.delete_many({"_id": uid})
        count = r_field.deleted_count + r_keyed.deleted_count
        if count:
            removed[attr.removesuffix("_col")] = count

    # A101: ERASE_ONLY_COLLECTIONS have no *_col binding (A98 deliberately
    # removed theirs), so there is nothing for the loop above to getattr —
    # swept via a raw db[name] handle instead. See collections.py's own
    # comment on that set for why a binding is not reinstated.
    for name in _cols.ERASE_ONLY_COLLECTIONS:
        col = _cols.db[name]
        r_field = await col.delete_many({"user_id": uid})
        r_keyed = await col.delete_many({"_id": uid})
        count = r_field.deleted_count + r_keyed.deleted_count
        if count:
            removed[name] = count
    return removed


async def account_has_data(uid: str) -> bool:
    """True if `uid` owns any connection, consent, account, or transaction
    row anywhere (TrueLayer, Finexer, Yapily, statement upload, manual,
    investment, or the unbound Mono/M-Pesa collections — A101) — the bar
    erase_orphaned_relay_account below refuses to cross ("never delete an
    account with data").

    Looked up fresh from app.db.collections by name each call (like
    erase_user's own manifest-driven sweep), so a test that patches a
    subset of collections there sees the same fakes rather than this
    module's own bound names."""
    from app.db import collections as _cols
    for name in _ACCOUNT_DATA_COLLECTIONS:
        col = getattr(_cols, name)
        if await col.count_documents({"user_id": uid}, limit=1):
            return True
    # A101: ERASE_ONLY_COLLECTIONS carry no *_col binding, so there is
    # nothing to getattr — checked via the same raw db[name] handle
    # erase_user uses for them.
    for name in _cols.ERASE_ONLY_COLLECTIONS:
        col = _cols.db[name]
        if await col.count_documents({"user_id": uid}, limit=1):
            return True
    return False


async def erase_orphaned_relay_account(relay_uid: str, *, claimed_by: str) -> dict | None:
    """Erase the empty placeholder account left behind at `relay_uid` once
    an explicit Apple-identity link re-points its automatic link to a
    different account, or once sweep_orphaned_relay_accounts finds one that
    was re-pointed some other way.

    `relay_uid` is an Apple Hide My Email relay address
    (`...@privaterelay.appleid.com`) that resolve_signin_email() (see
    app/core/identity.py) used as an account id on a relay sign-in's first
    Apple sign-in with OPEN_SIGNUP on — it owns an `email:<key>` alias doc
    and an `apple:<sub>` link doc marked `auto: True`. `link_apple_identity`
    (see routers/auth.py) is allowed to re-point an auto link to a
    different, already-authenticated account; once it does, the relay
    account itself is just an empty husk with nothing pointing at it.

    Refuses (returns None, logs at INFO) unless ALL of:
      - `relay_uid` actually ends with the Hide My Email domain — this
        routine must never be reachable for an ordinary account, no matter
        what caller passes in;
      - `relay_uid != claimed_by` — claiming your own placeholder is not an
        orphan;
      - no `apple:*` identity doc still has `user_id == relay_uid` — if one
        does, the placeholder is still claimed by something, orphaned or
        not;
      - account_has_data(relay_uid) is False — never delete an account with
        data, no matter how it got created.

    On success: delete every `email:*` alias doc keyed to `relay_uid`
    (resolve_signin_email's own alias record for it), call
    erase_user(relay_uid) for everything else, log at WARNING with masked
    emails, and return the removed-counts dict (erase_user's own dict, plus
    a `linked_identities` count for the alias doc(s) just removed). Returns
    None on any refusal above.
    """
    if not relay_uid.endswith(_RELAY_DOMAIN):
        logger.info(
            "erase_orphaned_relay_account: %s is not a relay address, skipping",
            mask_email(relay_uid),
        )
        return None
    if relay_uid == claimed_by:
        logger.info(
            "erase_orphaned_relay_account: %s claimed by itself, skipping",
            mask_email(relay_uid),
        )
        return None

    still_linked = await linked_identities_col.find_one({"provider": "apple", "user_id": relay_uid})
    if still_linked:
        logger.info(
            "erase_orphaned_relay_account: %s still has an apple identity link, skipping",
            mask_email(relay_uid),
        )
        return None

    if await account_has_data(relay_uid):
        logger.info(
            "erase_orphaned_relay_account: %s has account data, refusing to erase",
            mask_email(relay_uid),
        )
        return None

    identity_removed = await linked_identities_col.delete_many({"provider": "email", "user_id": relay_uid})
    removed = await erase_user(relay_uid)
    if identity_removed.deleted_count:
        removed["linked_identities"] = removed.get("linked_identities", 0) + identity_removed.deleted_count
    logger.warning(
        "erase_orphaned_relay_account: erased orphaned relay account %s (claimed by %s) removed=%s",
        mask_email(relay_uid), mask_email(claimed_by), removed,
    )
    return removed


async def sweep_orphaned_relay_accounts(now: datetime | None = None) -> dict:
    """Sweep for orphaned relay placeholders that already exist (leftovers
    from before link_apple_identity's own inline cleanup shipped, or any
    that slipped through it, e.g. because the cleanup's try/except only
    logs).

    For every `email:*` alias doc whose `user_id` is a relay address, if no
    `apple:*` doc still points at that `user_id` (it was re-pointed
    elsewhere) attempt erase_orphaned_relay_account (the `!= claimed_by`
    guard there still holds using a "sweep" sentinel, since a relay address
    can never legitimately equal that string). `now` is accepted for
    symmetry with the other sweeps in this file but unused — this sweep
    isn't time-gated, its guards are "still claimed" / "has data" rather
    than an age cutoff.
    """
    removed = 0
    skipped = 0
    docs = await linked_identities_col.find(
        {"provider": "email"}, {"_id": 1, "user_id": 1}
    ).to_list(None)
    for doc in docs:
        uid = doc.get("user_id")
        if not uid or not uid.endswith(_RELAY_DOMAIN):
            continue
        try:
            result = await erase_orphaned_relay_account(uid, claimed_by="sweep")
        except Exception:
            skipped += 1
            logger.exception("sweep_orphaned_relay_accounts: failed to erase %s", mask_email(uid))
            continue
        if result is not None:
            removed += 1
        else:
            skipped += 1
    return {"relay_orphans_removed": removed, "relay_orphans_skipped": skipped}


async def record_orphaned_revocation(uid: str, consent_id: str, error: str | None) -> None:
    """A106: the ONE place a failed remote Finexer consent revoke is recorded
    for retry. Called by `disconnect_connection` (user disconnect and account
    erasure), `routers/accounts.py` (last-account delete) and
    `billing_lifecycle.revoke_open_banking_consents` (REVOKE_CONSENT_ON_DOWNGRADE).

    Upserts `{_id: consent_id, consent_id, user_hash: sha256(uid), failed_at
    (aware UTC, first failure), attempts, last_attempt_at, last_error}`.
    `error` must be a short static code (HTTP status or exception class name),
    never a message. No email, no uid in clear, no tokens. Never raises: a
    Mongo hiccup here must not block the user's disconnect."""
    now = datetime.now(timezone.utc)  # naive-ok: persisted aware-UTC audit instant
    try:
        await orphaned_revocations_col.update_one(
            {"_id": consent_id},
            {
                "$set": {
                    "consent_id": consent_id,
                    "user_hash": _hash_uid(uid),
                    "last_attempt_at": now,
                    "last_error": error,
                },
                "$setOnInsert": {"failed_at": now},
                "$inc": {"attempts": 1},
            },
            upsert=True,
        )
    except Exception:
        logger.warning(
            "orphaned_revocations: failed to write marker for %s (non-fatal, proceeding)",
            consent_id, exc_info=True,
        )


async def clear_orphaned_revocation(consent_id: str) -> None:
    """Drop a stale marker once a revoke has succeeded. Never raises."""
    try:
        await orphaned_revocations_col.delete_one({"_id": consent_id})
    except Exception:
        logger.warning(
            "orphaned_revocations: failed to clear stale marker for %s (non-fatal)",
            consent_id, exc_info=True,
        )


_CONSENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{6,128}$")
_ORPHAN_MAX_AGE = timedelta(days=90)


def valid_consent_id(consent_id) -> bool:
    """A106: a Finexer consent id is interpolated into the revoke URL, so it is
    validated first; anything else is never requested."""
    return isinstance(consent_id, str) and bool(_CONSENT_ID_RE.match(consent_id))


# Finexer reports a revoked consent as status "canceled" (their spelling, per
# the API reference). "cancelled"/"revoked" are accepted defensively in case
# the spelling or a local mirror ever differs.
_REVOKED_STATUSES = frozenset({"canceled", "cancelled", "revoked"})


def _consent_is_revoked(body) -> bool:
    """True only when a Finexer consent object shows it is cancelled.
    Rule: when the body HAS a `status` field, success is only status in
    canceled/cancelled/revoked (a status of authorized is never success, even
    alongside a timestamp). The revoked_at/cancelled_at/canceled_at timestamp
    is consulted ONLY when the body carries no status field at all."""
    if not isinstance(body, dict):
        return False
    if "status" in body:
        status = body.get("status")
        return isinstance(status, str) and status.strip().lower() in _REVOKED_STATUSES
    return bool(body.get("revoked_at") or body.get("cancelled_at") or body.get("canceled_at"))


def _json_or_none(rv):
    try:
        return rv.json()
    except Exception:
        return None


async def revoke_finexer_consent_remote(consent_id: str) -> str | None:
    """A157: the ONE remote revoke call. `POST /consents/{id}/revoke` (Finexer's
    documented endpoint; `DELETE /consents/{id}` is not one, and treating its
    404 as success is how revocations silently never happened between A82 and
    A157). Returns None only when Finexer confirms the consent is cancelled:
    a 2xx whose JSON status is canceled. A 2xx still showing `authorized` is
    a failure ("not_canceled"). On 404 a follow-up `GET /consents/{id}` decides:
    404 or a canceled status means already gone (success), anything else fails.
    Otherwise returns a short static error code (HTTP status, exception class
    name). Never raises, never writes markers (callers do), no id validation
    (callers do). Logs consent id, HTTP status and resulting status only."""
    try:
        from app.services.finexer_sync import _client as _fx_client
        async with _fx_client() as fxc:
            rv = await fxc.post(f"/consents/{consent_id}/revoke")
            code = rv.status_code
            if 200 <= code < 300:
                body = _json_or_none(rv)
                status = body.get("status") if isinstance(body, dict) else None
                logger.info("Finexer revoke consent %s: HTTP %s, status=%s", consent_id, code, status)
                if _consent_is_revoked(body):
                    return None
                logger.warning("Finexer revoke consent %s returned HTTP %s but status is not canceled", consent_id, code)
                return "not_canceled"
            if code == 404:
                gv = await fxc.get(f"/consents/{consent_id}")
                gcode = gv.status_code
                gbody = _json_or_none(gv) if 200 <= gcode < 300 else None
                gstatus = gbody.get("status") if isinstance(gbody, dict) else None
                logger.info(
                    "Finexer revoke consent %s: HTTP 404, follow-up GET HTTP %s, status=%s",
                    consent_id, gcode, gstatus,
                )
                if gcode == 404 or _consent_is_revoked(gbody):
                    return None
                return "404_unconfirmed"
            logger.warning("Finexer revoke consent %s: HTTP %s", consent_id, code)
            return str(code)
    except Exception as exc:
        logger.warning("Finexer revoke failed for consent %s (non-fatal)", consent_id, exc_info=True)
        error_code = type(exc).__name__  # static class name only, never the message
        return error_code


async def _mark_local_consent_revoked(consent_id: str) -> None:
    """Best-effort: a still-present local consent doc follows the remote."""
    try:
        await finexer_consents_col.update_one(
            {"_id": consent_id},
            {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},  # naive-ok: persisted aware-UTC audit instant
        )
    except Exception:
        logger.warning("Finexer revoke: local status update failed for %s (non-fatal)", consent_id, exc_info=True)


async def revoke_finexer_consent(uid: str, consent_id: str) -> str | None:
    """Revoke one Finexer consent via `revoke_finexer_consent_remote`.
    Returns None on confirmed success, or a short static error code ("bad_id"
    when the id fails validation, in which case NO request is made). On
    failure a retry marker is recorded via record_orphaned_revocation (callers
    must call this BEFORE any local delete); on success the local consent doc,
    if still present, is set to status revoked. Never raises."""
    if not valid_consent_id(consent_id):
        logger.warning("Finexer revoke skipped: malformed consent id (not requested)")
        await record_orphaned_revocation(uid, consent_id, "bad_id")
        return "bad_id"
    error = await revoke_finexer_consent_remote(consent_id)
    if error is not None:
        await record_orphaned_revocation(uid, consent_id, error)
    else:
        await _mark_local_consent_revoked(consent_id)
    return error


async def disconnect_connection(uid: str, connection_id: str) -> dict | None:
    """Delete one bank connection/consent (TrueLayer or Finexer) plus every
    account/transaction/derived cache that hung off it.

    This is the exact routine `routers/accounts.py::delete_connection` used
    to run inline for both providers (that endpoint now just calls this and
    raises 404 on None); the expired-connection sweep below calls it too.

    Returns the same {"deleted": ..., "accounts_removed": ...} dict the
    router returns to the API, or None if no connection/consent matched
    (caller decides what a "not found" means for it — the router raises 404,
    the sweep just skips it).
    """
    # ── TrueLayer path ────────────────────────────────────────────────────
    conn = await connections_col.find_one({"_id": connection_id, "user_id": uid})
    if conn:
        account_ids = [d["_id"] async for d in accounts_col.find({"connection_id": connection_id}, {"_id": 1})]
        await cascade_account_deletion(uid, account_ids)
        # The connection is dying: its resurrection guards die with it.
        await purge_user_exclusions(
            uid, sorted(set(account_ids) | set(conn.get("excluded_accounts") or []))
        )
        await connections_col.delete_one({"_id": connection_id})
        return {"deleted": connection_id, "accounts_removed": len(account_ids)}

    # ── Finexer path ──────────────────────────────────────────────────────
    consent = await finexer_consents_col.find_one({"_id": connection_id, "user_id": uid})
    if consent:
        account_ids = [d["_id"] async for d in accounts_col.find({"connection_id": connection_id, "user_id": uid}, {"_id": 1})]
        await cascade_account_deletion(uid, account_ids)
        # The consent is dying: its resurrection guards die with it.
        await purge_user_exclusions(
            uid, sorted(set(account_ids) | set(consent.get("excluded_accounts") or []))
        )
        # Best-effort remote revoke (non-fatal to the local delete below).
        # A157: the helper POSTs /consents/{id}/revoke and only reports
        # success when Finexer confirms status "canceled" (or a 404 confirmed
        # gone by a follow-up GET). Any other outcome (non-2xx, timeout,
        # exception, 2xx still authorized) has already written the A106
        # retry marker by the time it returns, i.e. BEFORE the local delete.
        if await revoke_finexer_consent(uid, connection_id) is None:
            await clear_orphaned_revocation(connection_id)

        await finexer_consents_col.delete_one({"_id": connection_id})
        return {"deleted": connection_id, "accounts_removed": len(account_ids)}

    return None


def _older_than(value, cutoff: datetime) -> bool:
    """True only for a real datetime older than cutoff. Anything else
    (missing, wrong type) is treated as "no usable timestamp" -> not swept."""
    if not isinstance(value, datetime):
        return False
    # Mongo returns naive UTC; tolerate aware values on either side.
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    if cutoff.tzinfo is not None:
        cutoff = cutoff.astimezone(timezone.utc).replace(tzinfo=None)
    return value < cutoff


async def sweep_expired_connections(now: datetime | None = None) -> dict:
    """Delete every connection/consent whose consent ended more than 30 days
    ago and that the user never pressed Disconnect for.

    TrueLayer: delete when `consent_expires_at` exists and is older than the
    cutoff, OR `needs_reauth` is true and `needs_reauth_at` exists and is
    older than the cutoff.

    Finexer: delete when `status` is neither "authorized" nor "pending" and
    a timestamp for that change exists (`status_changed_at`, `canceled_at`,
    or `revoked_at` — sync/callback/webhook each write a different one of
    these) and is older than the cutoff, OR a consent expiry field
    (`expiry_date`) exists and is older than the cutoff.

    A doc with none of those timestamps is never removed (fail safe).
    """
    now = now or datetime.utcnow()
    cutoff = now - _CONNECTION_GRACE
    removed = 0
    errors = 0

    # ---- TrueLayer ----
    tl_conns = await connections_col.find(
        {"user_id": {"$exists": True, "$ne": None}},
        {"_id": 1, "user_id": 1, "consent_expires_at": 1, "needs_reauth": 1, "needs_reauth_at": 1},
    ).to_list(None)
    for conn in tl_conns:
        expired = _older_than(conn.get("consent_expires_at"), cutoff)
        dead = bool(conn.get("needs_reauth")) and _older_than(conn.get("needs_reauth_at"), cutoff)
        if not (expired or dead):
            continue
        try:
            result = await disconnect_connection(conn["user_id"], conn["_id"])
            if result:
                removed += 1
        except Exception:
            errors += 1
            logger.exception("sweep_expired_connections: failed to remove TrueLayer connection %s", conn["_id"])

    # ---- Finexer ----
    fx_consents = await finexer_consents_col.find(
        {"user_id": {"$exists": True, "$ne": None}},
        {"_id": 1, "user_id": 1, "status": 1, "status_changed_at": 1,
         "canceled_at": 1, "revoked_at": 1, "expiry_date": 1},
    ).to_list(None)
    for fx in fx_consents:
        if fx.get("status") in ("authorized", "pending"):
            continue
        changed_at = fx.get("status_changed_at") or fx.get("canceled_at") or fx.get("revoked_at")
        expired_by_status = _older_than(changed_at, cutoff)
        expired_by_expiry = _older_than(fx.get("expiry_date"), cutoff)
        if not (expired_by_status or expired_by_expiry):
            continue
        try:
            result = await disconnect_connection(fx["user_id"], fx["_id"])
            if result:
                removed += 1
        except Exception:
            errors += 1
            logger.exception("sweep_expired_connections: failed to remove Finexer consent %s", fx["_id"])

    return {"connections_removed": removed, "connection_errors": errors}


async def sweep_dormant_users(now: datetime | None = None) -> dict:
    """Erase every user whose `last_active_at` (see `stamp_activity` below)
    exists and is older than 12 months. A profile with no stamp at all is
    skipped (fail safe) — the stamp only started being written once this
    sweep shipped, so the clock for existing users starts from their first
    request after this deploy, not retroactively."""
    now = now or datetime.utcnow()
    cutoff = now - _DORMANT_AFTER
    erased = 0
    errors = 0

    docs = await user_profiles_col.find(
        {"last_active_at": {"$exists": True}}, {"_id": 1, "last_active_at": 1}
    ).to_list(None)
    for doc in docs:
        if not _older_than(doc.get("last_active_at"), cutoff):
            continue
        uid = doc["_id"]
        try:
            # A84: revoke before erasing (not inside erase_user itself,
            # which is shared with DELETE /account and out of scope for
            # this call site's edit), same ordering as the user-initiated
            # deletion path, so a dormant token can't keep authenticating
            # for the rest of its lifetime once the sweep decides it's
            # erasing this user.
            await revoke_sessions(uid, now=now)
            removed = await erase_user(uid)
            erased += 1
            logger.warning(
                "sweep_dormant_users: erased dormant user %s (last_active_at=%s) removed=%s",
                uid, doc.get("last_active_at"), removed,
            )
        except Exception:
            errors += 1
            logger.exception("sweep_dormant_users: failed to erase dormant user %s", uid)

    return {"users_erased": erased, "user_errors": errors}


async def retry_orphaned_revocations(now: datetime | None = None) -> dict:
    """Retry the Finexer remote revoke for every marker `disconnect_connection`
    left behind (A106) after a `POST /consents/{id}/revoke` that failed remotely,
    of either shape (a raised exception, or a non-success HTTP status).

    Follows `sweep_expired_connections`'s per-doc try/except shape: one
    marker's failure never blocks the rest. A marker is `_id == consent_id`
    (never one per attempt), so this walks every live marker unconditionally
    — no filter is needed, the marker's own existence IS the "still pending"
    signal.

    Finexer issues a fresh consent id on every new consent
    (`routers/finexer.py`), so a retried revoke of `/consents/{old_id}` here can
    never touch a reconnected user's new consent: the old id has nothing left
    to collide with once the user has a different, live consent id.

    On confirmed revoke (2xx with status canceled, or 404 confirmed gone by a
    follow-up GET; see `revoke_finexer_consent_remote`) the marker is deleted. On any other status, or a raised
    exception, the marker is updated IN PLACE (`attempts` incremented,
    `last_attempt_at`/`last_error` refreshed) — never re-inserted, since the
    marker already exists. A marker with `attempts` >= 7 gets a WARNING on
    every retry pass, so a prolonged outage isn't silent. Markers are taken
    oldest `last_attempt_at` first (never-attempted first), 50 per pass, so
    persistent failures cannot starve newer ones; a marker unrevoked 90 days
    after `failed_at` is deleted with an error-level log.

    Returns a summary dict: `orphaned_retried` (markers attempted this pass),
    `orphaned_cleared` (revoked successfully and removed), `orphaned_still_pending`
    (a non-success status, left in place), `orphaned_errors` (the retry
    attempt itself raised, OR a write recording its outcome raised, left in
    place either way).

    Independent review (post-merge-review round) caught a real bug here: the
    first cut of this function only wrapped the `fxc.delete(...)` call in
    try/except, leaving the success-path `delete_one`, the still-pending
    `update_one`, and the exception-path `update_one` all outside it — a
    single Mongo hiccup on any one marker's write would raise straight out of
    this `for` loop, abandoning every remaining marker AND propagating out of
    `run_retention_sweep`, failing the whole nightly sweep. Every marker's
    entire body (the network call and every write for that marker) is now
    inside ONE try/except, exactly `sweep_expired_connections`'s own per-doc
    shape: one marker's failure is counted, logged, and the loop moves on.
    """
    now = now or datetime.utcnow()  # naive-ok: persisted audit instant, background worker
    retried = 0
    cleared = 0
    still_pending = 0
    errors = 0
    expired = 0

    markers = await (
        orphaned_revocations_col.find({}, {}).sort("last_attempt_at", 1).limit(_ORPHAN_BATCH).to_list(_ORPHAN_BATCH)
    )
    for marker in markers:
        consent_id = marker["_id"]
        retried += 1

        if _older_than(marker.get("failed_at"), now - _ORPHAN_MAX_AGE):
            logger.error(
                "retry_orphaned_revocations: giving up on consent %s, unrevoked for over 90 days; marker deleted",
                consent_id,
            )
            try:
                await orphaned_revocations_col.delete_one({"_id": consent_id})
            except Exception:
                logger.warning("retry_orphaned_revocations: failed to delete expired marker %s", consent_id, exc_info=True)
            expired += 1
            continue

        if not valid_consent_id(consent_id):
            logger.warning("retry_orphaned_revocations: skipping malformed marker id (never requested)")
            try:
                await orphaned_revocations_col.update_one(
                    {"_id": consent_id},
                    {"$set": {"last_attempt_at": now, "last_error": "bad_id"}, "$inc": {"attempts": 1}},
                )
            except Exception:
                logger.warning("retry_orphaned_revocations: failed to flag bad_id marker", exc_info=True)
            errors += 1
            continue

        if (marker.get("attempts") or 0) >= _ORPHAN_WARN_ATTEMPTS:
            logger.warning(
                "retry_orphaned_revocations: consent %s still unrevoked after %s attempts (pending since %s)",
                consent_id, marker.get("attempts"), marker.get("failed_at"),
            )

        try:
            remote_error = await revoke_finexer_consent_remote(consent_id)

            if remote_error is None:
                await orphaned_revocations_col.delete_one({"_id": consent_id})
                # B45 downgrade path leaves the local doc authorised on a
                # failed revoke; reflect the now-successful remote revoke
                # (best-effort, never counted as a retry failure).
                try:
                    await finexer_consents_col.update_one(
                        {"_id": consent_id, "status": "authorized"},
                        {"$set": {"status": "revoked", "revoked_at": now}},
                    )
                except Exception:
                    logger.warning(
                        "retry_orphaned_revocations: local status update failed for %s (non-fatal)",
                        consent_id, exc_info=True,
                    )
                cleared += 1
            else:
                logger.warning(
                    "retry_orphaned_revocations: consent %s still not revoked (%s)",
                    consent_id, remote_error,
                )
                await orphaned_revocations_col.update_one(
                    {"_id": consent_id},
                    {"$set": {"last_attempt_at": now, "last_error": remote_error},
                     "$inc": {"attempts": 1}},
                )
                # A raised exception (not an HTTP/status outcome) is an "error".
                if remote_error.isdigit() or remote_error in ("not_canceled", "404_unconfirmed"):
                    still_pending += 1
                else:
                    errors += 1
        except Exception as exc:
            errors += 1
            logger.exception("retry_orphaned_revocations: failed to retry consent %s", consent_id)
            # Best-effort: record the failure on the marker too, but this
            # write can fail for the exact same reason (a Mongo outage
            # partway through this pass) that landed us here — a second
            # failure recording the first must never escape and abort the
            # rest of the markers either.
            try:
                await orphaned_revocations_col.update_one(
                    {"_id": consent_id},
                    {"$set": {"last_attempt_at": now, "last_error": type(exc).__name__},
                     "$inc": {"attempts": 1}},
                )
            except Exception:
                logger.warning(
                    "retry_orphaned_revocations: failed to record failure for consent %s (non-fatal)",
                    consent_id, exc_info=True,
                )

    return {
        "orphaned_retried": retried,
        "orphaned_cleared": cleared,
        "orphaned_still_pending": still_pending,
        "orphaned_errors": errors,
        "orphaned_expired": expired,
    }


async def run_retention_sweep(now: datetime | None = None) -> dict:
    """Run all four sweeps; called by the nightly arq cron
    (`app.workers.sync_worker.task_retention_sweep`, 03:30 UTC)."""
    now = now or datetime.utcnow()
    conn_result = await sweep_expired_connections(now)
    user_result = await sweep_dormant_users(now)
    relay_result = await sweep_orphaned_relay_accounts(now)
    orphan_result = await retry_orphaned_revocations(now)
    summary = {**conn_result, **user_result, **relay_result, **orphan_result}
    logger.info("run_retention_sweep: %s", summary)
    return summary


async def stamp_activity(uid: str, now: datetime | None = None) -> None:
    """Record that `uid` was just seen (backs the dormant-user sweep's 12
    month clock). Called from `app.core.auth.current_user` on every
    successfully authenticated request, throttled here to at most one write
    per user per 6h per process. Never raises: a DB hiccup here must never
    fail the request that triggered it."""
    if not uid:
        return
    now = now or datetime.utcnow()
    last = _last_stamped.get(uid)
    if last is not None and (now - last) < _ACTIVITY_STAMP_THROTTLE:
        return
    _last_stamped[uid] = now
    try:
        await user_profiles_col.update_one(
            {"_id": uid},
            {
                "$set": {"last_active_at": now},
                # D12: this upsert runs on the first authenticated request,
                # BEFORE GET /profile, so it creates a brand-new user's profile
                # document. Record onboarding as pending explicitly so the
                # document is never ambiguous with a legacy one.
                "$setOnInsert": {"onboarding_complete": False},
            },
            upsert=True,
        )
    except Exception:
        logger.warning("stamp_activity: failed to stamp %s", uid, exc_info=True)
