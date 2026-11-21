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
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.timeutil import as_utc
from app.db.collections import connections_col, finexer_consents_col
from app.services import response_cache

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
    The next task start overwrites a leftover stamp. Each run also writes its
    own `sync_in_progress_run` id and clears only a stamp carrying that id, so
    two overlapping syncs of one connection (a webhook and the worker) do not
    clear each other's stamp early; the later start owns the stamp."""
    run = uuid.uuid4().hex
    try:
        await col.update_one(
            {"_id": doc_id},
            {"$set": {
                "sync_in_progress_since": datetime.utcnow(),  # naive-ok: matches last_synced convention
                "sync_in_progress_run": run,
            }},
        )
    except Exception:
        _log.exception("could not stamp sync_in_progress_since for %s", doc_id)
    try:
        yield
    finally:
        try:
            await col.update_one(
                {"_id": doc_id, "sync_in_progress_run": run},
                {"$unset": {"sync_in_progress_since": "", "sync_in_progress_run": ""}},
            )
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

    `first_sync` is True until the first connection's figures have completed
    their mandatory post-pull calculation.  `last_synced` deliberately keeps
    its narrower meaning of bank freshness, so it cannot be used as that
    readiness boundary.  Legacy connections that predate this marker and have
    a `last_synced` timestamp remain established.

    A connection counts once it is authorised (Finexer status authorized /
    connected, TrueLayer tokens saved) but has never stamped `last_synced`.
    State precedence across connections: failed > stalled > syncing > idle.
    No connections at all is `idle` (the genuine fresh user).
    """
    now = as_utc(now) if now else datetime.now(timezone.utc)  # naive-ok: aware instant, compared to as_utc stamps
    rows: list[dict] = []
    has_completed_connection = False
    has_connections = False

    async def _collect(col, provider: str, query: dict, bank_key: str):
        nonlocal has_completed_connection, has_connections
        async for doc in col.find(query):
            eligible = not (provider == "truelayer" and not doc.get("access_token") and not doc.get("last_synced"))
            if eligible:
                has_connections = True
            pending_run = doc.get("first_sync_pending_run")
            if pending_run:
                # This marker is deliberately never aged out.  A failed first
                # calculation must stay truthful until a retry replaces its
                # run token; rendering it as idle would expose a £0 verdict.
                started = as_utc(doc.get("first_sync_pending_since")) or as_utc(
                    doc.get("authed_at") or doc.get("created_at") or doc.get("updated_at")
                )
                # `last_sync_error` belongs to a raw attempt, not the token
                # that currently owns readiness.  A retry replaces the token
                # before its pull starts, so an old raw error must not make
                # token B look failed while it is fetching.
                err = doc.get("first_sync_error")
                if err:
                    sub = "failed"
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
                    "phase": doc.get("first_sync_phase") if doc.get("first_sync_phase") in ("fetching", "computing") else "fetching",
                    "_sub": sub,
                })
                continue
            if doc.get("last_synced"):
                # A marker-free timestamp is either an established legacy
                # connection or a first connection whose calculation was
                # explicitly completed below.
                has_completed_connection = True
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
                    "last_synced": as_utc(doc.get("last_synced")).isoformat() if as_utc(doc.get("last_synced")) else None,
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
                "phase": "fetching",
                "_sub": sub,
            })

    await _collect(
        finexer_consents_col, "finexer",
        # Retain a marker-bearing revoked consent as an explicit failed first
        # sync.  Hiding it as an idle fresh user would turn a real failure
        # into a £0-looking empty state.
        {"user_id": uid, "$or": [
            {"status": {"$in": ["authorized", "connected"]}},
            {"first_sync_pending_run": {"$exists": True}},
        ]}, "provider",
    )
    await _collect(
        connections_col, "truelayer",
        {"user_id": uid, "pending": {"$ne": True}}, "provider_name",
    )

    # The active-row queries above intentionally omit revoked/expired
    # connections.  They can still be the user's completed historical first
    # connection, however, so include their marker-free bank freshness when
    # deciding whether a later bank is a genuine first sync.
    for col in (finexer_consents_col, connections_col):
        async for doc in col.find(
            {"user_id": uid}, {"last_synced": 1, "first_sync_pending_run": 1},
        ):
            if doc.get("last_synced"):
                has_connections = True
                if not doc.get("first_sync_pending_run"):
                    has_completed_connection = True

    state = "idle"
    for sub in ("failed", "stalled", "syncing"):
        if any(r["_sub"] == sub for r in rows):
            state = sub
            break
    for r in rows:
        # G214: each connection's own phase, so Accounts rows and the hero can
        # say stalled/failed from the server rather than a client clock.
        r["state"] = r.pop("_sub")
    return {
        "state": state,
        "first_sync": not has_completed_connection,
        "has_connections": has_connections,
        "connections": rows,
    }


async def _has_completed_connection(uid: str) -> bool:
    """Whether a user already has figures from one established connection.

    Marker-free historical `last_synced` records are intentionally accepted as
    complete so this rollout never puts existing customers back into a first
    sync state.  An active marker wins over `last_synced`: its raw pull may
    have finished while the first figures still need computing.
    """
    for col in (finexer_consents_col, connections_col):
        async for doc in col.find({"user_id": uid}, {"last_synced": 1, "first_sync_pending_run": 1}):
            if doc.get("last_synced") and not doc.get("first_sync_pending_run"):
                return True
    return False


async def begin_first_sync(col, doc_id, uid: str) -> str | None:
    """Claim a token-fenced first-figures lifecycle before its raw bank pull.

    The marker is per connection, while the established decision is per user:
    a second bank for someone who already has completed figures never turns the
    whole product back into a first-sync loading state.  Replacing a pending
    token is intentional for retries; older runs then cannot complete it.
    """
    doc = await col.find_one({"_id": doc_id}, {"last_synced": 1, "first_sync_pending_run": 1}) or {}
    if doc.get("last_synced") and not doc.get("first_sync_pending_run"):
        return None
    if await _has_completed_connection(uid):
        return None
    run = uuid.uuid4().hex
    await col.update_one(
        {"_id": doc_id},
        {"$set": {
            "first_sync_pending_run": run,
            "first_sync_pending_since": datetime.utcnow(),
            "first_sync_phase": "fetching",
        }, "$unset": {
            "first_sync_error": "", "first_sync_error_at": "",
            "last_sync_error": "", "last_sync_error_at": "",
        }},
    )
    return run


async def mark_first_sync_computing(col, doc_id, run: str | None) -> None:
    if not run:
        return
    await col.update_one(
        {"_id": doc_id, "first_sync_pending_run": run},
        {"$set": {"first_sync_phase": "computing"}},
    )


async def fail_first_sync(col, doc_id, run: str | None, error: str = "sync_failed") -> None:
    """Keep a first-sync failure visible until the token-fenced retry starts."""
    if not run:
        return
    await col.update_one(
        {"_id": doc_id, "first_sync_pending_run": run},
        {"$set": {
            "first_sync_error": error if error in SYNC_ERROR_CODES else "sync_failed",
            "first_sync_error_at": datetime.utcnow(),
        }},
    )


async def complete_first_sync(col, doc_id, run: str | None) -> bool:
    """Finish only a token-owning run that actually reached bank freshness.

    Some providers can return an empty/skipped helper result without writing
    `last_synced` (for example a revoked consent or missing TrueLayer token).
    Those are not successful first pulls and must remain a safe failed state,
    never clear the marker merely because a later calculation returned.
    """
    if not run:
        return False
    doc = await col.find_one(
        {"_id": doc_id, "first_sync_pending_run": run}, {"last_synced": 1, "user_id": 1},
    )
    if not doc or not doc.get("last_synced"):
        await fail_first_sync(col, doc_id, run)
        return False
    result = await col.update_one(
        {"_id": doc_id, "first_sync_pending_run": run},
        {"$set": {"first_sync_completed_at": datetime.utcnow()}, "$unset": {
            "first_sync_pending_run": "", "first_sync_pending_since": "",
            "first_sync_phase": "", "first_sync_error": "", "first_sync_error_at": "",
        }},
    )
    # A token change between the read above and this write means a newer
    # retry owns readiness.  Motor exposes that fence via matched_count;
    # lightweight test doubles without it have already been protected by the
    # token-bearing read above.
    if result is not None and getattr(result, "matched_count", 0) != 1:
        return False
    # Cashflow computation invalidates before it sees the marker clear.  A
    # concurrent warm/read can therefore have cached a syncing response under
    # the new version.  Fence this second invalidation to the successful
    # completion so an old run can neither release nor disturb a retry.
    uid = doc.get("user_id")
    if uid:
        await response_cache.ainvalidate(uid)
    return True
