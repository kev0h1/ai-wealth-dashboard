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

from app.db.collections import (
    connections_col, accounts_col, finexer_consents_col, user_profiles_col,
)
from app.services.account_cascade import cascade_account_deletion, purge_user_exclusions

logger = logging.getLogger(__name__)

# SECURITY.md section 6 periods.
_DORMANT_AFTER = timedelta(days=365)
_CONNECTION_GRACE = timedelta(days=30)

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
    summary = {**conn_result, **user_result}
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
