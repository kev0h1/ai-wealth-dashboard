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


async def first_sync_state(uid: str, now: Optional[datetime] = None) -> dict:
    """G210: is `uid`'s first bank sync still running, stuck, or failed?

    A connection counts once it is authorised (Finexer status authorized /
    connected, TrueLayer tokens saved) but has never stamped `last_synced`.
    State precedence across connections: failed > stalled > syncing > idle.
    No connections at all is `idle` (the genuine fresh user).
    """
    now = as_utc(now) if now else datetime.now(timezone.utc)  # naive-ok: aware instant, compared to as_utc stamps
    rows: list[dict] = []

    async def _collect(col, provider: str, query: dict, bank_key: str):
        async for doc in col.find(query):
            if doc.get("last_synced"):
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
                "error": err,
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

    state = "idle"
    for sub in ("failed", "stalled", "syncing"):
        if any(r["_sub"] == sub for r in rows):
            state = sub
            break
    for r in rows:
        r.pop("_sub")
    return {"state": state, "connections": rows}
