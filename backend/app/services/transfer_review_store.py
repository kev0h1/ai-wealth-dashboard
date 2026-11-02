"""G390: per-user stored candidates for the "Review these transfers" sheet.

The sheet's three candidate shapes (suggested transfer pairs, rejected-pair
legs queued for separate answers, and flagged recurring series) used to be
recomputed from every account and every pay period on each cold read, and
every sync or cache wipe made the next open cold. Engine doctrine is to
decide at sync and serve from storage, so the result is kept in one document
per user (`transfer_review_store`, `_id` = uid) and the endpoints read it.

What is stored is the computed state: `pairs`, `separate_items` and `flagged`
(slim transaction rows, grouped at read time). The user's decisions
(dismissed rows, dismissed series, dismissed or split pairs and G382's
separate-leg snapshots, learned pairs) stay where they always lived, in
preferences and `confirmed_transfer_pairs`, keyed by stable transaction id,
series key and pair key. A recompute reads them again, so it can never drop a
decision; the store records a fingerprint of those decision inputs (plus the
category kinds, identity, account facts and transaction count) and is
rebuilt when it no longer matches.

Staleness has two parts. `epoch` is bumped by `mark_stale` whenever a sync
pipeline or a recategorise changes transactions; a save records the epoch it
was computed under (`built_epoch`), so a bump that lands mid-compute is never
overwritten. The fingerprint covers everything else. Neither is touched by a
generic response-cache wipe.

Every Mongo touch is defensive: a store failure degrades to an inline
recompute, never to a 500.
"""
import logging
from datetime import datetime, timedelta, timezone

from app.db.collections import transfer_review_store_col

logger = logging.getLogger(__name__)

# Safety bound only; correctness comes from epoch + fingerprint.
MAX_AGE = timedelta(hours=24)
# Bump when the stored shape changes.
STORE_SHAPE = 1


async def mark_stale(uid: str) -> None:
    """Transactions changed for uid (sync pipeline or recategorise)."""
    if not uid:
        return
    try:
        await transfer_review_store_col.update_one(
            {"_id": uid}, {"$inc": {"epoch": 1}, "$set": {"user_id": uid}}, upsert=True,
        )
    except Exception:
        logger.exception("transfer_review_store.mark_stale failed")


async def load(uid: str) -> dict | None:
    try:
        return await transfer_review_store_col.find_one({"_id": uid})
    except Exception:
        logger.exception("transfer_review_store.load failed")
        return None


def is_valid(doc: dict | None, fingerprint: str) -> bool:
    if not doc or doc.get("shape") != STORE_SHAPE:
        return False
    if doc.get("built_epoch") is None or doc.get("built_epoch") != doc.get("epoch", 0):
        return False
    if doc.get("fingerprint") != fingerprint:
        return False
    built = doc.get("built_at")
    if not isinstance(built, datetime):
        return False
    if built.tzinfo is None:
        built = built.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - built > MAX_AGE:  # naive-ok: tz-aware 24h safety bound on a cache document
        return False
    return isinstance(doc.get("state"), dict)


async def save(uid: str, state: dict, fingerprint: str, built_epoch: int) -> None:
    """Persist without touching `epoch`, so a concurrent mark_stale survives."""
    try:
        await transfer_review_store_col.update_one(
            {"_id": uid},
            {"$set": {
                "user_id": uid, "state": state, "fingerprint": fingerprint,
                "built_epoch": built_epoch, "shape": STORE_SHAPE,
                "built_at": datetime.now(timezone.utc),  # naive-ok: tz-aware persisted build stamp
            }},
            upsert=True,
        )
    except Exception:
        logger.exception("transfer_review_store.save failed")


async def refresh(uid: str) -> None:
    """Post-sync hook: rebuild the stored candidates now (no-op when the store
    is still valid) so the first open after a sync reads storage. Never
    raises into the pipeline that called it."""
    try:
        from app.routers.analytics import refresh_review_state
        await refresh_review_state(uid)
    except Exception:
        logger.exception("transfer_review_store.refresh failed")
