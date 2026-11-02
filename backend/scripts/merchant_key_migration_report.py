#!/usr/bin/env python3
"""G404: read-only count of one user's 'user' merchant-cache docs that
canonical_merchant_key would no longer produce.

canonical_merchant_key now strips card numbers and similar references, so a
correction cached under an older key (for example a card name followed by a
number) is never looked up again. This prints COUNTS ONLY, never a key,
category, uid or email, and never writes. It refuses to run unless MONGO_DB is
set explicitly, so it can never fall back to a default database.

Usage (from backend/):
    MONGO_DB=<database> .venv/bin/python scripts/merchant_key_migration_report.py <uid>

The repayment link (G403) is expected to make the card-number keys redundant.
Whether to migrate them is Kevin's decision; nothing here migrates anything.
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def count_stale_user_keys(col, uid: str) -> dict:
    """Count the user's source-user docs, and how many have a key that
    canonical_merchant_key would not produce from that same key."""
    from app.services.categorisation import canonical_merchant_key

    prefix = f"{uid}::"
    total = 0
    stale = 0
    async for doc in col.find({"uid": uid, "source": "user"}, {"_id": 1}):
        total += 1
        raw = str(doc["_id"])
        key = raw[len(prefix):] if raw.startswith(prefix) else raw
        if canonical_merchant_key("", key) != key:
            stale += 1
    return {"user_docs": total, "would_not_resolve": stale}


async def main(argv: list[str]) -> int:
    if not os.environ.get("MONGO_DB"):
        print("Refusing to run: set MONGO_DB explicitly.", file=sys.stderr)
        return 2
    if len(argv) != 2:
        print("Usage: merchant_key_migration_report.py <uid>", file=sys.stderr)
        return 2
    from app.db.collections import merchant_categories_col

    counts = await count_stale_user_keys(merchant_categories_col, argv[1])
    print(f"user-source cache docs: {counts['user_docs']}")
    print(f"keys canonical_merchant_key would no longer produce: {counts['would_not_resolve']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv)))
