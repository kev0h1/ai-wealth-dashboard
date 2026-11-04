"""G418: how many of one user's categories would show a real tip.

Read-only and counts only. It never prints an id, a merchant, a figure or any
tip text. It refuses to run unless MONGO_DB is set explicitly in the
environment, so it can never silently fall back to the default database.

    MONGO_DB=<database> backend/.venv/bin/python backend/scripts/tips_real_count.py <uid>

A tip is real when the one server predicate (tip_facts.carries_beyond_own_figure,
read by routers/savings_insights._derive_insight_state) says it carries a
regulator Typical line, a like-for-like Also listed line, a dated provider price
change or a contract-ending fact. This script reads the user's stored tips and
asks `_serialize_insight` what would be served today, the same call every
surface uses. It performs find() only, never a write.

Output: three counts.
  categories_with_a_stored_tip   stored tips not retired
  categories_with_a_real_tip     served as fresh or stale (would show and be counted)
  categories_own_figure_only     stored but hidden by the G418 rule
"""
from __future__ import annotations

import asyncio
import os
import sys


def main(argv: list[str]) -> int:
    if not os.environ.get("MONGO_DB", "").strip():
        print("refusing to run: set MONGO_DB explicitly (no default database is read)", file=sys.stderr)
        return 2
    if len(argv) != 2 or not argv[1].strip():
        print("usage: tips_real_count.py <uid>", file=sys.stderr)
        return 2
    uid = argv[1].strip()

    from app.db.collections import savings_insights_col
    from app.routers.savings_insights import _serialize_insight
    from app.services import tip_facts

    async def run() -> tuple[int, int, int]:
        docs = await savings_insights_col.find({"user_id": uid, "retired_at": {"$exists": False}}).to_list(None)
        stored = real = own_only = 0
        seen_real: set[str] = set()
        for d in docs:
            if not (d.get("title") or "").strip() or not (d.get("body") or "").strip():
                continue
            stored += 1
            served = _serialize_insight(d)
            if served.get("state") in ("fresh", "stale"):
                seen_real.add(str(served.get("app_category") or d.get("category")))
            elif not tip_facts.carries_beyond_own_figure(d.get("body")):
                own_only += 1
        real = len(seen_real)
        return stored, real, own_only

    stored, real, own_only = asyncio.run(run())
    print(f"categories_with_a_stored_tip={stored}")
    print(f"categories_with_a_real_tip={real}")
    print(f"categories_own_figure_only={own_only}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
