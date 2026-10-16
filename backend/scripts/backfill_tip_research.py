#!/usr/bin/env python3
"""B48: pre-create empty shared tip_research keys from existing per-user tips.

Dry-run by default (reads only, prints counts). `--apply` writes. Idempotent.
Output is counts only, never user ids, names, amounts or tip text.

What it does and does not do. It copies NOTHING from any tip: a stored tip is
a personalised sentence mixing market facts with the user's own figures, and no
filter can be trusted to separate the two. For each tip still in date it
derives the shared key (category, curated provider, coarse price band or
behaviour profile) in memory and, if that key has no document yet, creates an
EMPTY pending stub (key fields only: no findings, no timestamps) so the first
weekly pass fetches it. The shared layer therefore fills from fresh fetches
during the first week after release. It is optional: without it the first pass
creates the same keys itself.

Usage (from backend/):
    .venv/bin/python scripts/backfill_tip_research.py [--env-file .env]
    .venv/bin/python scripts/backfill_tip_research.py --apply
"""
import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def backfill(insights_col, apply: bool, now: datetime | None = None) -> dict:
    from app.routers import savings_insights as si
    from app.services import tip_research

    now = now or datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: stored values are naive UTC
    counts = {"tips": 0, "not_in_date": 0, "resolved_or_retired": 0, "no_key": 0,
              "keys_created": 0, "keys_already_present": 0}
    docs = await insights_col.find({}).to_list(None)
    counts["tips"] = len(docs)
    for d in docs:
        valid_until = d.get("content_valid_until")
        if d.get("category") not in si.INSIGHT_CATEGORIES or not valid_until or valid_until <= now:
            counts["not_in_date"] += 1
            continue
        if d.get("retired_at") or d.get("verified_at") or d.get("substituted_at"):
            counts["resolved_or_retired"] += 1
            continue
        try:
            key = await si._tip_key_for(d.get("user_id") or "", d["category"], d.get("triggered_by"))
        except Exception:
            counts["no_key"] += 1
            continue
        created = await tip_research.precreate_pending(key, dry_run=not apply)
        counts["keys_created" if created else "keys_already_present"] += 1
    return counts


async def _main(apply: bool) -> int:
    from app.db.collections import db, savings_insights_col
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await backfill(savings_insights_col, apply)
    for k, v in counts.items():
        print(f"  {k}: {v}")
    if not apply:
        print("dry-run: nothing written. Re-run with --apply to write.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write changes (default is dry-run)")
    ap.add_argument("--env-file", default=None, help="path to a .env to load first")
    args = ap.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    return asyncio.run(_main(args.apply))


if __name__ == "__main__":
    sys.exit(main())
