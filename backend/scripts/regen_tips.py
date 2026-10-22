#!/usr/bin/env python3
"""G315: one-off tip regeneration after the factual-rules release. Ops only.

Stored tips below PROMPT_VERSION (savings_insights.MIN_SERVE_PROMPT_VERSION) are
hidden until the weekly pass rewrites them. This lets an operator trigger that
once instead of waiting for each user's next sync.

Dry-run by default: it only reads and prints COUNTS (users with at least one
hidden tip, hidden tips). `--apply` enqueues the existing `task_refresh_savings_insights`
job once per such user, with the weekly job id, so a user already queued this week
is not queued twice and the job's own 7-day guards and research caps still apply
(no extra search or model spend beyond what the weekly pass would do). Output is
counts only, never user ids, names or tip text.

Usage (from backend/):
    .venv/bin/python scripts/regen_tips.py [--env-file .env]
    .venv/bin/python scripts/regen_tips.py --apply
"""
import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def collect(insights_col) -> dict[str, int]:
    """user -> number of stored tips below the minimum served version (reads only)."""
    from app.routers.savings_insights import MIN_SERVE_PROMPT_VERSION
    per_user: dict[str, int] = {}
    docs = await insights_col.find(
        {"retired_at": {"$exists": False}}, {"user_id": 1, "prompt_version": 1},
    ).to_list(None)
    for d in docs:
        if int(d.get("prompt_version") or 0) < MIN_SERVE_PROMPT_VERSION and d.get("user_id"):
            per_user[d["user_id"]] = per_user.get(d["user_id"], 0) + 1
    return per_user


async def _main(apply: bool) -> int:
    from app.db.collections import db, savings_insights_col
    per_user = await collect(savings_insights_col)
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    print(f"  users with hidden tips: {len(per_user)}")
    print(f"  hidden tips: {sum(per_user.values())}")
    if not apply:
        print("dry-run: nothing enqueued. Re-run with --apply to enqueue one refresh per user.")
        return 0
    from arq import create_pool
    from arq.connections import RedisSettings
    from app.core.config import REDIS_URL
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    week = datetime.now(timezone.utc).strftime("%G-W%V")
    queued = skipped = failed = 0
    for uid in per_user:
        try:
            job = await pool.enqueue_job("task_refresh_savings_insights", user_id=uid, _job_id=f"insights:{uid}:{week}")
            queued, skipped = (queued + 1, skipped) if job else (queued, skipped + 1)
        except Exception:
            failed += 1
    print(f"  enqueued: {queued}  already queued this week: {skipped}  failed: {failed}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="enqueue the refresh jobs (default is dry-run)")
    ap.add_argument("--env-file", default=None, help="path to a .env to load first")
    args = ap.parse_args()
    if args.env_file:
        from dotenv import load_dotenv
        load_dotenv(args.env_file, override=False)
    return asyncio.run(_main(args.apply))


if __name__ == "__main__":
    sys.exit(main())
