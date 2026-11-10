"""Explicit reversal of a recorded transfer series, without rediscovering pairs.

G449 extends the G442 user-override and G441 separate-review mechanisms to
complete automatic and confirmed stamps. A later custom choice always wins.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime

from app.db.collections import (
    accounts_col, confirmed_transfer_pairs_col, own_transfer_judgements_col,
    preferences_col, transactions_col,
)
from app.services.categories import MOVEMENT, get_category_kinds
from app.services.categorisation import canonical_merchant_key
from app.services.own_account_transfers import (
    OWN_TRANSFER_MATCH_VERSION, _pair_key, ai_pair_keys, pair_doc_id,
    resolve_transfer_evidence, series_signature, history_series_signature, transfer_source_signature,
)

logger = logging.getLogger(__name__)


def filing_actor(marker: dict) -> str:
    if marker.get("version") != OWN_TRANSFER_MATCH_VERSION:
        return "unknown"
    if marker.get("confirmed") is True:
        return "user"
    # A later occurrence matched only because of the user's saved pair rule.
    # It is not an automatic filing merely because it was applied at sync.
    if marker.get("source") == "user":
        return "user"
    return "sorted" if marker.get("source") in (None, "ai", "series", "rule") else "unknown"


def reversible_pair(credit: dict | None, debit: dict | None, accounts: dict, movement_categories: set[str]) -> bool:
    """Only reciprocal current evidence with recorded prior categories can reverse."""
    if not credit or not debit or credit.get("transaction_type") != "credit" or debit.get("transaction_type") != "debit":
        return False
    if credit.get("account_id") == debit.get("account_id") or _pair_key(credit) is None or _pair_key(credit) != _pair_key(debit):
        return False
    actors = {filing_actor((row.get("own_transfer_match") or {})) for row in (credit, debit)}
    if len(actors) != 1 or "unknown" in actors:
        return False
    for row, other in ((credit, debit), (debit, credit)):
        marker = row.get("own_transfer_match") or {}
        if (row.get("account_id") not in accounts or row.get("is_pending") or row.get("custom_category") is not None
                or marker.get("series_single") or "previous_category" not in marker
                or not isinstance(marker.get("matched_category"), str)
                or marker.get("matched_category") != row.get("category")
                or marker.get("counterpart_id") != str(other.get("_id"))
                or marker.get("counterpart_account_id") != other.get("account_id")
                or marker.get("source_signature") != transfer_source_signature(row)
                or marker.get("counterpart_signature") != transfer_source_signature(other)):
            return False
    resolved = resolve_transfer_evidence([credit, debit], movement_categories, owned_account_ids=set(accounts))
    return all(row.get("own_transfer_match") for row in resolved)


def _snapshot(row: dict) -> dict:
    return {"id": str(row["_id"]), **{key: row.get(key) for key in (
        "transaction_type", "account_id", "amount", "currency", "merchant_name", "description",
    )}, "date": row["date"].isoformat()}


def _write_guard(uid: str, row: dict) -> dict:
    # Both source facts and the exact marker participate in the write, so a
    # bank amendment or a newer category choice cannot be overwritten.
    return {"user_id": uid, "_id": row["_id"], **{key: row.get(key) for key in (
        "account_id", "transaction_type", "amount", "currency", "date", "merchant_name",
        "description", "custom_category", "category", "is_pending", "own_transfer_match",
    )}}


async def undo_filed_series(uid: str, series_key: str) -> dict:
    if not re.fullmatch(r"(?:sorted|user):[0-9a-f]{16}", series_key):
        raise ValueError("That transfer series is no longer available to undo")
    actor, signature = series_key.split(":", 1)
    rows = await transactions_col.find({"user_id": uid, "transaction_type": {"$in": ["credit", "debit"]}}).to_list(None)
    account_rows = await accounts_col.find({"user_id": uid}).to_list(None)
    accounts = {str(row["_id"]): row for row in account_rows}
    # Match the currency normalisation used when durable stamps were created.
    normalised = [{**row, "currency": str(row.get("currency") or accounts.get(row.get("account_id"), {}).get("currency") or "").upper()} for row in rows]
    by_id = {str(row["_id"]): row for row in normalised}
    originals = {str(row["_id"]): row for row in rows}
    kinds = await get_category_kinds(uid)
    movements = {name for name, kind in kinds.items() if kind == MOVEMENT}
    pairs = []
    for credit in normalised:
        if credit.get("transaction_type") != "credit":
            continue
        marker = credit.get("own_transfer_match") or {}
        debit = by_id.get(str(marker.get("counterpart_id")))
        if not debit or filing_actor(marker) != actor:
            continue
        # Continue to accept the amount-sensitive G449 keys that may still be
        # open in another browser tab.  Fresh G451 rows use the history key.
        if signature not in {history_series_signature(credit, debit), series_signature(credit, debit)}:
            continue
        if not reversible_pair(credit, debit, accounts, movements):
            raise ValueError("This series has changed. Reload its history before undoing it")
        pairs.append((credit, debit))
    if not pairs:
        raise ValueError("That transfer series is no longer available to undo")

    # Snapshot the precise rules before the first write. A later confirmation
    # revises updated_at; guarded deletion must preserve that newer answer.
    learned_candidates: dict[str, dict] = {}
    for credit, debit in pairs:
        ai_a, ai_b = ai_pair_keys(credit, debit)
        queries = [{"user_id": uid, "key_a": ai_a, "key_b": ai_b, "source": "ai"}]
        if actor == "user":
            keys = sorted((canonical_merchant_key(credit.get("merchant_name") or "", credit.get("description") or ""),
                           canonical_merchant_key(debit.get("merchant_name") or "", debit.get("description") or "")))
            queries.append({"user_id": uid, "key_a": keys[0], "key_b": keys[1], "source": None})
        for query in queries:
            for saved in await confirmed_transfer_pairs_col.find(query).to_list(None):
                learned_candidates[str(saved["_id"])] = saved

    # Persist the H145 dirty marker before writes, including a partially
    # interrupted request. Every subsequent close/revisit can drain it.
    from app.services.derived_caches import defer_transfer_review_recompute
    from app.services import response_cache, transfer_review_store
    await defer_transfer_review_recompute(uid)
    operation_id = uuid.uuid4().hex
    operation_key = f"{uid}::filing-undo::{operation_id}"
    snapshots = [{"pair_key": f"{c['_id']}:{d['_id']}", "g449_undo_id": operation_id,
                  "credit": _snapshot(c), "debit": _snapshot(d)} for c, d in pairs]
    # Tagged G441 snapshots protect the operation while restoring rows. A
    # crash leaves conservative review blockers and the H145 dirty marker.
    await preferences_col.update_one({"user_id": uid}, {
        "$set": {"user_id": uid},
        "$addToSet": {"separate_transfer_pair_reviews": {"$each": snapshots}},
    }, upsert=True)
    now = datetime.utcnow()  # naive-ok: Mongo audit stamps use naive UTC
    await own_transfer_judgements_col.update_one({"_id": operation_key}, {
        "$set": {"user_id": uid, "kind": "undo_attempt", "series_sig": signature,
                 "actor": actor, "at": now, "state": "pending", "ids": [str(r["_id"]) for p in pairs for r in p]},
    }, upsert=True)
    changed: list[str] = []
    audit_before: dict[str, dict | None] = {}
    learned_before: list[dict] = []
    try:
        for credit, debit in pairs:
            for row in (credit, debit):
                original = originals[str(row["_id"])]
                result = await transactions_col.update_one(_write_guard(uid, original), {
                    "$set": {"category": row["own_transfer_match"]["previous_category"]},
                    "$unset": {"own_transfer_match": ""},
                })
                if result.matched_count != 1:
                    raise ValueError("A payment changed while undoing")
                changed.append(str(row["_id"]))
        # Delay permanent overrides and unlearning until all guarded category
        # writes succeed. Retain the old audit state for compensation on this
        # standalone Mongo, which cannot promise a multi-document transaction.
        # The history key joins variable amounts.  The matcher still consumes
        # amount-sensitive signatures, so block every underlying signature or
        # a subsequent sync could learn just one amount again after Undo.
        engine_signatures = {series_signature(c, d) for c, d in pairs}
        audit_updates = [(f"{uid}::undo::{engine_signature}", {
            "user_id": uid, "kind": "undo", "series_sig": engine_signature, "history_series_sig": signature, "at": now,
        }) for engine_signature in engine_signatures] + [(pair_doc_id(uid, [c["_id"], d["_id"]]), {
            "user_id": uid, "kind": "pair", "ids": sorted((str(c["_id"]), str(d["_id"]))),
            "series_sig": series_signature(c, d), "history_series_sig": signature, "user_override": True,
        }) for c, d in pairs]
        for key, values in audit_updates:
            audit_before[key] = await own_transfer_judgements_col.find_one({"_id": key, "user_id": uid})
            await own_transfer_judgements_col.update_one({"_id": key, "user_id": uid}, {
                "$set": {**values, "g449_undo_id": operation_id},
            }, upsert=True)
        for saved in learned_candidates.values():
            guard = {**saved, "source": saved.get("source"), "updated_at": saved.get("updated_at")}
            deleted = await confirmed_transfer_pairs_col.delete_one(guard)
            if deleted.deleted_count != 1:
                raise ValueError("A newer transfer confirmation replaced this learned rule")
            learned_before.append(saved)
        # Other learned rules remain intact; only this series' exact keys
        # have been unlearned, and snapshots support guarded compensation.
        await own_transfer_judgements_col.update_one({"_id": operation_key}, {"$set": {"state": "complete"}})
    except Exception as exc:
        rollback_complete = True
        try:
            for saved in learned_before:
                await confirmed_transfer_pairs_col.update_one({"_id": saved["_id"]}, {"$setOnInsert": saved}, upsert=True)
            for key, previous in reversed(list(audit_before.items())):
                guard = {"_id": key, "user_id": uid, "g449_undo_id": operation_id}
                if previous is None:
                    await own_transfer_judgements_col.delete_one(guard)
                else:
                    await own_transfer_judgements_col.replace_one(guard, previous)
            for transaction_id in reversed(changed):
                original = originals[transaction_id]
                marker = original["own_transfer_match"]
                post_state = {**original, "category": marker["previous_category"], "own_transfer_match": None}
                result = await transactions_col.update_one(_write_guard(uid, post_state), {
                    "$set": {"category": original.get("category"), "own_transfer_match": marker},
                })
                if result.matched_count != 1:
                    # New bank facts or a user choice outrank a rollback too.
                    rollback_complete = False
            if rollback_complete:
                await preferences_col.update_one({"user_id": uid}, {
                    "$pull": {"separate_transfer_pair_reviews": {"g449_undo_id": operation_id}},
                })
            await own_transfer_judgements_col.update_one({"_id": operation_key}, {
                "$set": {"state": "rolled_back" if rollback_complete else "needs_review"},
            })
        except Exception:
            logger.exception("G449 undo compensation needs review for operation %s", operation_id)
        raise ValueError("Could not complete Undo. Reload history and check the transfer review before trying again") from exc
    finally:
        await transfer_review_store.mark_stale(uid)
        await response_cache.ainvalidate(uid)
        transfer_review_store.refresh_soon(uid)
    return {"undone": len(pairs), "transaction_ids": changed}
