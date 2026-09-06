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
from datetime import datetime, timedelta

from app.core.config import mask_email
from app.db.collections import (
    connections_col, accounts_col, finexer_consents_col, user_profiles_col,
    linked_identities_col,
)
from app.services.account_cascade import cascade_account_deletion, purge_user_exclusions

logger = logging.getLogger(__name__)

# SECURITY.md section 6 periods.
_DORMANT_AFTER = timedelta(days=365)
_CONNECTION_GRACE = timedelta(days=30)

# Apple Hide My Email relay addresses always live on this domain (see
# app/core/identity.py). D3: the bar for "this looks like an orphaned relay
# placeholder account" starts with the uid actually being one of these.
_RELAY_DOMAIN = "@privaterelay.appleid.com"

# Every collection that counts as "this account has data" for
# erase_orphaned_relay_account's guard below: every provider's
# connection/consent doc, every provider's account doc, and every
# provider's transaction rows. Looked up fresh from app.db.collections by
# name (see account_has_data) rather than bound at import time, same
# reasoning as erase_user's own dir()-based sweep.
_ACCOUNT_DATA_COLLECTIONS = (
    "connections_col", "finexer_consents_col", "yapily_consents_col", "mono_connections_col",
    "accounts_col", "statement_accounts_col", "mpesa_accounts_col", "manual_accounts_col",
    "mono_accounts_col", "yapily_accounts_col", "investment_accounts_col",
    "transactions_col", "statement_transactions_col", "mpesa_transactions_col",
    "mono_transactions_col", "yapily_transactions_col", "manual_transactions_col",
)

# Activity-stamp throttle: `current_user` (app.core.auth) calls stamp_activity
# on every authenticated request — this keeps it to at most one Mongo write
# per user per 6h per process, rather than one per request.
_ACTIVITY_STAMP_THROTTLE = timedelta(hours=6)
_last_stamped: dict[str, datetime] = {}


async def erase_user(uid: str) -> dict[str, int]:
    """Erase every trace of `uid`: every document in every `*_col` collection
    in app.db.collections matched by `user_id` field or uid-keyed `_id`.

    This is the exact routine `routers/profile.py::delete_account` used to
    run inline (that endpoint now just checks the confirmation phrase and
    calls this); the dormant-user sweep below calls it too.
    """
    from app.db import collections as _cols
    removed: dict[str, int] = {}
    for attr in dir(_cols):
        if not attr.endswith("_col"):
            continue
        col = getattr(_cols, attr)
        r_field = await col.delete_many({"user_id": uid})
        r_keyed = await col.delete_many({"_id": uid})
        count = r_field.deleted_count + r_keyed.deleted_count
        if count:
            removed[attr.removesuffix("_col")] = count
    return removed


async def account_has_data(uid: str) -> bool:
    """True if `uid` owns any connection, consent, account, or transaction
    row anywhere (TrueLayer, Finexer, Yapily, Mono, M-Pesa, statement
    upload, manual, or investment) — the bar erase_orphaned_relay_account
    below refuses to cross ("never delete an account with data").

    Looked up fresh from app.db.collections by name each call (like
    erase_user's own dir()-based sweep), so a test that patches a subset of
    collections there sees the same fakes rather than this module's own
    bound names."""
    from app.db import collections as _cols
    for name in _ACCOUNT_DATA_COLLECTIONS:
        col = getattr(_cols, name)
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
        # Best-effort remote revoke (non-fatal)
        try:
            from app.services.finexer_sync import _client as _fx_client
            async with _fx_client() as fxc:
                rv = await fxc.delete(f"/consents/{connection_id}")
                if rv.status_code not in (200, 204, 404):
                    logger.warning("Finexer revoke %s returned HTTP %s", connection_id, rv.status_code)
        except Exception:
            logger.warning("Finexer revoke failed for consent %s (non-fatal)", connection_id, exc_info=True)
        await finexer_consents_col.delete_one({"_id": connection_id})
        return {"deleted": connection_id, "accounts_removed": len(account_ids)}

    return None


def _older_than(value, cutoff: datetime) -> bool:
    """True only for a real datetime older than cutoff. Anything else
    (missing, wrong type) is treated as "no usable timestamp" -> not swept."""
    return isinstance(value, datetime) and value < cutoff


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


async def run_retention_sweep(now: datetime | None = None) -> dict:
    """Run both sweeps; called by the nightly arq cron
    (`app.workers.sync_worker.task_retention_sweep`, 03:30 UTC)."""
    now = now or datetime.utcnow()
    conn_result = await sweep_expired_connections(now)
    user_result = await sweep_dormant_users(now)
    relay_result = await sweep_orphaned_relay_accounts(now)
    summary = {**conn_result, **user_result, **relay_result}
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
            {"_id": uid}, {"$set": {"last_active_at": now}}, upsert=True,
        )
    except Exception:
        logger.warning("stamp_activity: failed to stamp %s", uid, exc_info=True)
