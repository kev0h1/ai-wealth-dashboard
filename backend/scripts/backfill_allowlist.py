#!/usr/bin/env python3
"""E13: give every account that signed up before invite-only mode an
ordinary, revocable allow-list row (status invited, source pre_list_backfill),
so nobody who already uses Sorted is refused at sign-in.

Same rule as POST /ops/people/backfill (app.services.allowlist_backfill).
The owner is never touched, an existing row (even a revoked one) is never
changed, and a second run adds nothing.

Dry run by default (reads only); --apply writes. MONGO_DB must be set
explicitly in the environment, or the script refuses to run. Output is
counts only, never an address.

Usage (from backend/, with the target environment's MONGO_URI and MONGO_DB):
    MONGO_DB=<name> .venv/bin/python scripts/backfill_allowlist.py
    MONGO_DB=<name> .venv/bin/python scripts/backfill_allowlist.py --apply
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def run(apply: bool) -> dict:
    from app.services.allowlist_backfill import apply_backfill, preview_count

    would_add = await preview_count()
    added = await apply_backfill() if apply else 0
    return {"without_access_row": would_add, "added": added}


async def _main(apply: bool) -> int:
    from app.db.collections import db

    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await run(apply)
    for k, v in counts.items():
        print(f"  {k}: {v}")
    if not apply:
        print("dry-run: nothing written; re-run with --apply to write")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    ap.add_argument("--env-file", default=None, help="optional dotenv file to load first")
    args = ap.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file)
    if not os.environ.get("MONGO_DB"):
        print("Refusing to run: set MONGO_DB explicitly in the environment.", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(_main(args.apply)))
