"""Authoritative last-bank-sync timestamp across all providers.

Design notes
------------
* connections_col.last_synced  — written datetime.utcnow() (naive UTC) by TrueLayer sync
* finexer_consents_col.last_synced — written datetime.utcnow() (naive UTC) by Finexer sync
* mono_connections_col.last_synced — written datetime.now() (naive LOCAL) by Mono sync

We do NOT use accounts_col.updated_at because:
  1. TrueLayer writes it as datetime.now() (naive local) but Finexer writes datetime.utcnow()
     → mixed-timezone, cannot be compared safely.
  2. It is bumped by non-sync events (manual_account_rules.py balance recalculations)
     → it is not a reliable sync signal.
"""
from datetime import datetime, timezone
from typing import Optional

from app.db.collections import connections_col, finexer_consents_col, mono_connections_col


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

    # Mono — naive LOCAL stored in mono_connections_col
    # .astimezone(timezone.utc) on a naive datetime treats it as local time (correct here)
    async for doc in mono_connections_col.find(
        {"user_id": uid, "last_synced": {"$exists": True, "$ne": None}},
        {"last_synced": 1},
    ):
        ts = doc.get("last_synced")
        if isinstance(ts, datetime):
            # naive local → aware UTC
            candidates.append(ts.astimezone(timezone.utc))

    return max(candidates) if candidates else None
