"""A179: refresh ONE connected bank account from its bank.

Finexer accounts: one POST /bank_accounts/{id}/sync (the stored 60-minute rule
decides whether it may run, a refusal is a plain answer and never a 429),
poll until idle within the existing bound, then fetch booked and pending rows
for that account only (`finexer_sync_pipeline(only_account_id=...)`).
TrueLayer accounts (UAT): the existing connection sync for the account's
connection. Both sit behind the E11 once-a-minute user throttle.

One refresh per account at a time: an atomic claim on `refresh_lock_until`
in the account doc (a stale claim expires, so a crashed run cannot wedge it).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from app.db.collections import accounts_col, connections_col, finexer_consents_col

logger = logging.getLogger(__name__)

LOCK_TTL = timedelta(minutes=3)
# How long the route waits for the refresh before answering in_progress.
INLINE_WAIT_S = 25.0

MSG_PAUSED = "Bank sync is paused on your plan."
MSG_RECONNECT = "Reconnect this bank to refresh it."
MSG_BUSY = "This account is already refreshing."
MSG_FAILED = "We could not refresh this account just now. Try again in a moment."


def _utcnow() -> datetime:
    return datetime.utcnow()  # naive-ok: Mongo UTC convention


def next_allowed_message(next_at: datetime) -> str:
    """Plain, hedged copy; the app shows its own time from `next_allowed_at`."""
    return "Your bank only lets us refresh an account once an hour."


def _iso(d) -> Optional[str]:
    if isinstance(d, datetime):
        return d.isoformat() + ("Z" if d.tzinfo is None else "")
    return d if isinstance(d, str) else None


def is_finexer_account(acc: dict) -> bool:
    return bool(acc.get("finexer")) or acc.get("source") == "finexer"


async def claim_refresh(account_id: str, now: Optional[datetime] = None) -> bool:
    """Atomic: True when this caller now holds the account's refresh lock."""
    now = now or _utcnow()
    res = await accounts_col.update_one(
        {"_id": account_id, "$or": [
            {"refresh_lock_until": {"$exists": False}},
            {"refresh_lock_until": {"$lt": now}},
        ]},
        {"$set": {"refresh_lock_until": now + LOCK_TTL}},
    )
    return bool(getattr(res, "modified_count", 0))


async def release_refresh(account_id: str) -> None:
    try:
        await accounts_col.update_one({"_id": account_id}, {"$unset": {"refresh_lock_until": ""}})
    except Exception:
        logger.exception("could not release the refresh lock for %s", account_id)


def _result(refreshed: bool, doc: Optional[dict], *, message: Optional[str] = None,
            next_at: Optional[datetime] = None, **extra) -> dict:
    out = {
        "refreshed": refreshed,
        "bank_synced_to": _iso((doc or {}).get("bank_synced_to")),
        "next_allowed_at": _iso(next_at),
    }
    if message:
        out["message"] = message
    out.update(extra)
    return out


async def precheck_finexer(uid: str, acc: dict) -> Optional[dict]:
    """The answers that need no lock and no Finexer call: the 60-minute rule
    and a consent that is not authorised. None means go ahead."""
    from app.services.finexer_sync import bank_sync_next_allowed
    consent = await finexer_consents_col.find_one(
        {"_id": acc.get("connection_id"), "user_id": uid, "status": "authorized"}, {"_id": 1},
    )
    if not consent:
        return _result(False, acc, message=MSG_RECONNECT, reconnect=True)
    nxt = bank_sync_next_allowed(acc)
    if nxt is not None:
        return _result(False, acc, message=next_allowed_message(nxt), next_at=nxt)
    return None


async def run_refresh(uid: str, acc: dict) -> dict:
    """Do the refresh. The caller holds the lock; this releases it."""
    account_id = acc["_id"]
    try:
        if is_finexer_account(acc):
            result = await _refresh_finexer(uid, acc)
        else:
            result = await _refresh_truelayer(uid, acc)
        if result.get("refreshed"):
            await _recompute(uid)
        return result
    except Exception:
        logger.exception("account refresh failed for %s", account_id)
        return _result(False, await _reload(account_id), message=MSG_FAILED)
    finally:
        await release_refresh(account_id)


async def _reload(account_id: str) -> dict:
    try:
        return await accounts_col.find_one({"_id": account_id}) or {}
    except Exception:
        return {}


async def _refresh_finexer(uid: str, acc: dict) -> dict:
    from app.services.finexer_sync import bank_sync_next_allowed, finexer_sync_pipeline
    account_id = acc["_id"]
    out = await finexer_sync_pipeline(
        acc["connection_id"], uid, trigger="user", recompute=False,
        request_bank_sync=True, only_account_id=account_id,
    )
    doc = await _reload(account_id)
    ok = bool(out.get("ok")) and int(out.get("accounts") or 0) > 0
    if not ok:
        return _result(False, doc, message=MSG_FAILED)
    nxt = bank_sync_next_allowed(doc)
    return _result(True, doc, next_at=nxt)


async def _refresh_truelayer(uid: str, acc: dict) -> dict:
    from app.services.truelayer_sync import sync_connection
    conn_id = acc.get("connection_id")
    conn = await connections_col.find_one({"_id": conn_id, "user_id": uid}, {"_id": 1})
    if not conn:
        return _result(False, acc, message=MSG_RECONNECT, reconnect=True)
    ids, _new = await sync_connection(conn_id, uid)
    doc = await _reload(acc["_id"])
    if acc["_id"] not in (ids or []):
        return _result(False, doc, message=MSG_FAILED)
    from app.services import sync_throttle
    return _result(True, doc, next_at=_utcnow() + timedelta(seconds=sync_throttle.WINDOW_SECONDS))


async def _recompute(uid: str) -> None:
    """The recompute the consent refresh runs (POST /accounts/sync's
    `_post_sync`): rules, derived caches, response cache."""
    from app.db.collections import cashflow_cache_col
    from app.services import response_cache
    from app.services.categorisation import apply_rules_bulk, categorise_others_bg
    from app.services.derived_caches import mark_stale, recompute_derived_caches
    from app.services.manual_account_rules import apply_rules as apply_mirror_rules
    try:
        await apply_rules_bulk(uid, structural=True)
        await categorise_others_bg(uid)
        await apply_mirror_rules(uid)
        await mark_stale(uid)
        await cashflow_cache_col.update_one(
            {"_id": uid}, {"$set": {"synced_at": _utcnow()}}, upsert=True,
        )
        await recompute_derived_caches(uid, new_count=0, trigger="user")
    except Exception:
        logger.exception("post-refresh recompute failed for %s", uid)
    finally:
        await response_cache.ainvalidate(uid)
