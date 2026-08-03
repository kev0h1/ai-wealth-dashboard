"""Cascade helper: clean up all derived state when one or more accounts are deleted.

Called by both delete_account and delete_connection endpoints, and by the
one-off cleanup script for the reported UAT user.
"""
import asyncio
import logging
import re
from datetime import datetime

from app.db.collections import (
    accounts_col as _default_acc_col,
    transactions_col as _default_txn_col,
    cashflow_cache_col,
    behaviour_portrait_col,
    cycle_story_col,
    needle_history_col,
    companion_items_col,
    upcoming_overrides_col,
    preferences_col,
)
from app.services import response_cache

logger = logging.getLogger(__name__)


async def cascade_account_deletion(
    uid: str,
    account_ids: list[str],
    *,
    acc_col=None,
    txn_col=None,
    recompute: bool = True,
) -> dict:
    """Delete accounts + transactions and clean ALL derived state for those accounts.

    Args:
        uid:         User's email (used as _id in most caches).
        account_ids: List of account _id strings to delete.
        acc_col:     Collection to delete account docs from (default: accounts_col).
        txn_col:     Collection to delete transaction docs from (default: transactions_col).
        recompute:   If True, schedule a background recompute of the cashflow cache.
                     Pass False when the caller (e.g. a cleanup script) wants to
                     await compute_and_cache_cashflow itself.

    Returns a dict of {collection_name: deleted/modified_count}.
    """
    if not account_ids:
        return {}

    acc_col = acc_col or _default_acc_col
    txn_col = txn_col or _default_txn_col
    counts: dict[str, int] = {}

    # ── Step 1: compute "orphan bill keys" BEFORE deleting transactions ──────
    # Keys that appear ONLY on the accounts being deleted — once those txns are
    # gone the cashflow-cache overrides referencing those keys are dead weight.
    orphan_keys: set[str] = set()
    try:
        proj = {"merchant_name": 1, "description": 1, "account_id": 1}
        # Keys on the accounts being deleted
        deleting_keys: set[str] = set()
        async for t in txn_col.find(
            {"user_id": uid, "account_id": {"$in": account_ids}}, proj
        ):
            k = (t.get("merchant_name") or (t.get("description") or "")[:35]).strip()
            if k:
                deleting_keys.add(k)
        # Keys also present on other accounts (survivors).
        # Fetch ALL survivor-account transactions and filter in-process so that
        # description-derived keys (no merchant_name) are not excluded.
        surviving_keys: set[str] = set()
        if deleting_keys:
            async for t in txn_col.find(
                {
                    "user_id": uid,
                    "account_id": {"$nin": account_ids},
                },
                proj,
            ):
                k = (t.get("merchant_name") or (t.get("description") or "")[:35]).strip()
                if k in deleting_keys:
                    surviving_keys.add(k)
        orphan_keys = deleting_keys - surviving_keys
    except Exception:
        logger.exception("cascade_account_deletion: orphan-key computation failed for %s", uid)
        orphan_keys = set()

    # ── Step 2: Delete transactions ──────────────────────────────────────────
    r = await txn_col.delete_many({"user_id": uid, "account_id": {"$in": account_ids}})
    counts["transactions"] = r.deleted_count

    # ── Step 3: Delete account docs ─────────────────────────────────────────
    r = await acc_col.delete_many({"user_id": uid, "_id": {"$in": account_ids}})
    counts["accounts"] = r.deleted_count

    # ── Step 4: Delete companion move/plan docs ──────────────────────────────
    r = await companion_items_col.delete_many({
        "uid": uid,
        "type": "move",
        "$or": [
            {"_dest_acct": {"$in": account_ids}},
            {"move_map.from.account_id": {"$in": account_ids}},
        ],
    })
    counts["companion_items"] = r.deleted_count

    # ── Step 5: Delete orphan-key upcoming overrides ─────────────────────────
    counts["upcoming_overrides"] = 0
    if orphan_keys:
        r = await upcoming_overrides_col.delete_many({
            "uid": uid,
            "key": {"$in": sorted(orphan_keys)},
        })
        counts["upcoming_overrides"] = r.deleted_count

    # ── Step 6: Pull deleted account ids from cover_plan_excluded_accounts ───
    r = await preferences_col.update_one(
        {"user_id": uid},
        {"$pull": {"cover_plan_excluded_accounts": {"$in": account_ids}}},
    )
    counts["preferences_modified"] = r.modified_count

    # ── Step 7: Delete derived per-user caches ───────────────────────────────

    # Cashflow cache (serves stale bills/income/safe-to-spend)
    r = await cashflow_cache_col.delete_one({"_id": uid})
    counts["cashflow_cache"] = r.deleted_count

    # Behaviour portrait
    r = await behaviour_portrait_col.delete_one({"_id": uid})
    counts["behaviour_portrait"] = r.deleted_count

    # Cycle stories: keys are "{uid}:{period_end}:{live|final|preview}" — delete
    # all docs whose _id starts with uid + ":"
    r = await cycle_story_col.delete_many(
        {"_id": {"$regex": f"^{re.escape(uid)}:"}}
    )
    counts["cycle_stories"] = r.deleted_count

    # Needle history: delete ONLY if no transactions remain (full teardown).
    # If the user still has active accounts, closed-period history stays valid.
    remaining_txn_count = await txn_col.count_documents({"user_id": uid})
    if remaining_txn_count == 0:
        r = await needle_history_col.delete_many(
            {"_id": {"$regex": f"^{re.escape(uid)}:"}}
        )
        counts["needle_history"] = r.deleted_count
    else:
        counts["needle_history"] = 0

    # ── Step 8: Invalidate in-process caches ────────────────────────────────
    response_cache.invalidate(uid)

    # Pop the in-process AI recurring cache (lazy import to avoid cycles)
    try:
        from app.routers.analytics import _ai_recurring_cache
        _ai_recurring_cache.pop(uid, None)
    except Exception:
        logger.warning("cascade_account_deletion: could not pop _ai_recurring_cache for %s", uid)

    # ── Step 9: Background recompute ────────────────────────────────────────
    # Deleting cashflow_cache_col prevents stale serving immediately.
    # GET /cashflow computes live when cache is absent.
    # We fire a background recompute so the next load is fast.
    if recompute:
        try:
            from app.routers.analytics import compute_and_cache_cashflow
            asyncio.create_task(compute_and_cache_cashflow(uid))
        except Exception:
            logger.warning("cascade_account_deletion: could not schedule recompute for %s", uid)

    logger.info(
        "cascade_account_deletion: uid=%s accounts=%s counts=%s",
        uid, account_ids, counts,
    )
    return counts
