"""Authoritative last-bank-sync timestamp across all providers.

Design notes
------------
* connections_col.last_synced  — written datetime.utcnow() (naive UTC) by TrueLayer sync
* finexer_consents_col.last_synced — written datetime.utcnow() (naive UTC) by Finexer sync

We do NOT use accounts_col.updated_at because:
  1. TrueLayer writes it as datetime.now() (naive local) but Finexer writes datetime.utcnow()
     → mixed-timezone, cannot be compared safely.
  2. It is bumped by non-sync events (manual_account_rules.py balance recalculations)
     → it is not a reliable sync signal.
"""
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.timeutil import as_utc
from app.db.collections import connections_col, finexer_consents_col

# A first sync that has been authorised this long with no result and no error
# is reported as stalled rather than left looking like it is still working.
FIRST_SYNC_STALL_AFTER = timedelta(minutes=10)
# Past this age an authorised-but-never-synced connection with no error is an
# abandoned leftover, not a first sync in progress, and no longer holds Home.
FIRST_SYNC_ABANDON_AFTER = timedelta(hours=24)


# G214: a sync task stamps `sync_in_progress_since` on its connection/consent
# doc while it runs, so Home and Accounts can show a background or manual
# re-sync of a bank that has synced before. A stamp older than this with no
# task alive is a crashed worker's leftover and is ignored.
SYNC_IN_PROGRESS_STALE_AFTER = timedelta(minutes=30)

_log = logging.getLogger(__name__)


@asynccontextmanager
async def sync_in_progress(col, doc_id):
    """Stamp `sync_in_progress_since` for the duration of a sync, clearing it
    on success or failure. Best-effort: a failed stamp never blocks the sync.
    The next task start overwrites a leftover stamp."""
    try:
        await col.update_one(
            {"_id": doc_id},
            {"$set": {"sync_in_progress_since": datetime.utcnow()}},  # naive-ok: matches last_synced convention
        )
    except Exception:
        _log.exception("could not stamp sync_in_progress_since for %s", doc_id)
    try:
        yield
    finally:
        try:
            await col.update_one({"_id": doc_id}, {"$unset": {"sync_in_progress_since": ""}})
        except Exception:
            _log.exception("could not clear sync_in_progress_since for %s", doc_id)


async def last_bank_sync(uid: str) -> Optional[datetime]:
    """Return the most recent bank sync time for `uid` as a timezone-aware UTC datetime.

    Returns None if no connection has ever been synced.
    """
    candidates: list[datetime] = []

    # TrueLayer — naive UTC stored in connections_col
    async for doc in connections_col.find(
        {"user_id": uid, "last_synced": {"$exists": True, "$ne": None}},
        {"last_synced": 1},
    ):
        ts = doc.get("last_synced")
        if isinstance(ts, datetime):
            # Attach UTC tzinfo to naive UTC value
            candidates.append(ts.replace(tzinfo=timezone.utc))

    # Finexer — naive UTC stored in finexer_consents_col
    async for doc in finexer_consents_col.find(
        {"user_id": uid, "last_synced": {"$exists": True, "$ne": None}},
        {"last_synced": 1},
    ):
        ts = doc.get("last_synced")
        if isinstance(ts, datetime):
            candidates.append(ts.replace(tzinfo=timezone.utc))

    return max(candidates) if candidates else None


SYNC_ERROR_CODES = ("sync_failed", "consent_revoked")


def sync_error_code(exc: BaseException) -> str:
    """Fixed, user-safe code for a failed sync; the raw text stays in logs."""
    status = getattr(getattr(exc, "response", None), "status_code", None)
    return "consent_revoked" if status in (401, 403) else "sync_failed"


async def first_sync_state(uid: str, now: Optional[datetime] = None) -> dict:
    """G210: is `uid`'s first bank sync still running, stuck, or failed?

    `first_sync` is True only when the user has NO connection that has ever
    synced. A user with one synced bank adding a second still gets per-
    connection progress in `connections`/`state`, but `first_sync` is False so
    callers never zero or hide an established verdict.

    A connection counts once it is authorised (Finexer status authorized /
    connected, TrueLayer tokens saved) but has never stamped `last_synced`.
    State precedence across connections: failed > stalled > syncing > idle.
    No connections at all is `idle` (the genuine fresh user).
    """
    now = as_utc(now) if now else datetime.now(timezone.utc)  # naive-ok: aware instant, compared to as_utc stamps
    rows: list[dict] = []
    nonlocal_has: list[bool] = []

    async def _collect(col, provider: str, query: dict, bank_key: str):
        async for doc in col.find(query):
            if doc.get("last_synced"):
                # G214: a bank that has synced before but is being re-synced
                # right now. Reported as syncing (stalled past 10 minutes on
                # the stamp); a stamp past 30 minutes is a crashed worker's.
                since = as_utc(doc.get("sync_in_progress_since"))
                if since is None or provider == "truelayer" and not doc.get("access_token"):
                    continue
                age = now - since
                if age > SYNC_IN_PROGRESS_STALE_AFTER:
                    continue
                rows.append({
                    "provider": provider,
                    "connection_id": doc.get("_id"),
                    "bank": doc.get(bank_key) or None,
                    "started_at": since.isoformat(),
                    "error": None,
                    "kind": "background",
                    "_sub": "stalled" if age > FIRST_SYNC_STALL_AFTER else "syncing",
                })
                continue
            started = as_utc(
                doc.get("authed_at") or doc.get("created_at") or doc.get("updated_at")
            )
            err = doc.get("last_sync_error") or None
            if provider == "truelayer" and not doc.get("access_token"):
                continue
            if err:
                # The failure retires 24h after the LAST error (the user may
                # have connected a different bank instead).
                err_at = as_utc(doc.get("last_sync_error_at")) or started
                if err_at is not None and now - err_at > FIRST_SYNC_ABANDON_AFTER:
                    continue
                sub = "failed"
            elif started is not None and now - started > FIRST_SYNC_ABANDON_AFTER:
                continue
            elif started is not None and now - started > FIRST_SYNC_STALL_AFTER:
                sub = "stalled"
            else:
                sub = "syncing"
            rows.append({
                "provider": provider,
                "connection_id": doc.get("_id"),
                "bank": doc.get(bank_key) or None,
                "started_at": started.isoformat() if started else None,
                "error": (err if err in SYNC_ERROR_CODES else "sync_failed") if err else None,
                "kind": "new-bank",
                "_sub": sub,
            })

    await _collect(
        finexer_consents_col, "finexer",
        {"user_id": uid, "status": {"$in": ["authorized", "connected"]}}, "provider",
    )
    await _collect(
        connections_col, "truelayer",
        {"user_id": uid, "pending": {"$ne": True}}, "provider_name",
    )

    # Has the user EVER synced anything (any status, e.g. an expired bank)?
    for col in (finexer_consents_col, connections_col):
        async for doc in col.find(
            {"user_id": uid, "last_synced": {"$exists": True, "$ne": None}},
            {"last_synced": 1},
        ):
            if doc.get("last_synced"):
                nonlocal_has.append(True)

    state = "idle"
    for sub in ("failed", "stalled", "syncing"):
        if any(r["_sub"] == sub for r in rows):
            state = sub
            break
    for r in rows:
        # G214: each connection's own phase, so Accounts rows and the hero can
        # say stalled/failed from the server rather than a client clock.
        r["state"] = r.pop("_sub")
    return {"state": state, "first_sync": not nonlocal_has, "connections": rows}
