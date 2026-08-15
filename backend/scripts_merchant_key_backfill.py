"""ENGINE "Identity" stage — one-time backfill of merchant_key onto existing
transaction rows, plus a purge of dead ("poisoned") learned-cache entries.

WHAT THIS DOES
---------------
1. For every transaction collection (transactions_col, yapily_transactions_col,
   mono_transactions_col, statement_transactions_col, mpesa_transactions_col),
   finds rows with no `merchant_key` field and sets it to
   `canonical_merchant_key(merchant_name, description)` via a bulk write.
   Sync-time writers (truelayer/yapily/finexer/mono_sync.py) already set this
   field for every row going forward — this script only catches history.

2. Purges merchant_categories_col entries that are dead on arrival under the
   new scheme: an entry whose bare key (the "uid::" prefix stripped, if any)
   is NOT a fixed point of canonical_merchant_key — i.e.
   canonical_merchant_key("", bare) != bare — can never be matched again,
   because every future lookup compares against a freshly-computed
   canonical_merchant_key() output, which is always already in canonical
   form. This is the general form of "keys that embed dates/references":
   verified against the live cache (2026-08-13) it purges ~29% of entries,
   matching ENGINE.md's "roughly a third poisoned" estimate. Legitimate
   stable-numeric identities (e.g. 'a c 76526682', where the number IS the
   identity) are untouched — canonical_merchant_key's own alpha-remainder
   guard already refuses to shorten those, so they're already fixed points.

SCOPE / SAFETY
--------------
Pass `user_id=` to restrict to one user (used for fixture-user testing).
Called with no argument, it touches every user's rows — this is a real
production migration and should be run deliberately, not casually. It never
touches `category`, `custom_category`, `amount`, or any other field; the ONLY
writes are (a) setting the new `merchant_key` field where absent, and
(b) deleting merchant_categories_col docs that are already permanently dead
under the new scheme.
"""
import asyncio
import sys

from app.db.collections import (
    transactions_col, yapily_transactions_col, mono_transactions_col,
    statement_transactions_col, mpesa_transactions_col, merchant_categories_col,
)
from app.services.categorisation import canonical_merchant_key

COLLECTIONS = [
    transactions_col, yapily_transactions_col, mono_transactions_col,
    statement_transactions_col, mpesa_transactions_col,
]


async def backfill_merchant_key(user_id: str | None = None) -> dict:
    """Set merchant_key on every row missing it. Returns per-collection counts."""
    from pymongo import UpdateOne

    counts: dict[str, int] = {}
    for col in COLLECTIONS:
        query: dict = {"merchant_key": {"$exists": False}}
        if user_id:
            query["user_id"] = user_id
        docs = await col.find(query, {"merchant_name": 1, "description": 1}).to_list(None)
        if not docs:
            counts[col.name] = 0
            continue
        ops = [
            UpdateOne(
                {"_id": d["_id"]},
                {"$set": {"merchant_key": canonical_merchant_key(
                    d.get("merchant_name") or "", d.get("description") or ""
                )}},
            )
            for d in docs
        ]
        result = await col.bulk_write(ops, ordered=False)
        counts[col.name] = result.modified_count
    return counts


async def purge_poisoned_cache(user_id: str | None = None) -> dict:
    """Delete merchant_categories_col entries whose bare key is not a fixed
    point of canonical_merchant_key — dead under the new scheme regardless of
    when they were written. See module docstring for why this is correct.
    """
    query: dict = {}
    if user_id:
        query["uid"] = user_id
    to_delete: list[str] = []
    inspected = 0
    async for d in merchant_categories_col.find(query, {"category": 1}):
        inspected += 1
        raw_id: str = d["_id"]
        bare = raw_id.split("::", 1)[1] if "::" in raw_id else raw_id
        if canonical_merchant_key("", bare) != bare:
            to_delete.append(raw_id)
    if to_delete:
        result = await merchant_categories_col.delete_many({"_id": {"$in": to_delete}})
        deleted = result.deleted_count
    else:
        deleted = 0
    return {"inspected": inspected, "deleted": deleted}


async def main():
    user_id = sys.argv[1] if len(sys.argv) > 1 else None
    if user_id:
        print(f"Scoped to user_id={user_id}")
    else:
        print("UNSCOPED — touching every user's rows. This is a real production migration.")

    counts = await backfill_merchant_key(user_id)
    print("merchant_key backfill (rows updated per collection):")
    for name, n in counts.items():
        print(f"  {name:28} {n}")
    print(f"  TOTAL: {sum(counts.values())}")

    purge = await purge_poisoned_cache(user_id)
    print(f"\nlearned-cache purge: inspected={purge['inspected']} deleted={purge['deleted']}")


if __name__ == "__main__":
    asyncio.run(main())
