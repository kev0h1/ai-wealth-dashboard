#!/usr/bin/env python3
"""A176: switch on Finexer's automatic sync for existing bank accounts.

New consents get auto_sync_interval at their first sync; this one-off covers
accounts connected before that. DRY RUN BY DEFAULT: it only counts the
accounts that would be changed. --apply sends one request per account.

ASSUMPTION: the request itself (POST /bank_accounts/{id}/sync with the form
field auto_sync_interval) is not confirmed against Finexer's dashboard
reference; see app.services.finexer_sync.ensure_auto_sync. Run a dry run, then
--apply against ONE account first (--limit 1) and check the response.

REFUSES to run unless MONGO_DB is set explicitly by the caller, so it can never
fall back to a default database name by accident.

Usage (from backend/, Kevin runs it):
    MONGO_DB=<name> .venv/bin/python scripts/finexer_backfill_auto_sync.py
    MONGO_DB=<name> .venv/bin/python scripts/finexer_backfill_auto_sync.py --apply [--limit N] [--hours H]

Prints counts only: no ids, emails or keys.
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

REQUEST_GAP_S = 0.5


def check_env(env=None) -> None:
    """Raise SystemExit unless MONGO_DB is explicitly set and non-empty."""
    env = os.environ if env is None else env
    if not (env.get("MONGO_DB") or "").strip():
        raise SystemExit("Refusing to run: set MONGO_DB explicitly for this run (no default is used).")


async def run(apply: bool = False, limit: int | None = None, hours: int | None = None) -> dict:
    from app.db.collections import accounts_col, finexer_consents_col
    from app.services import runtime_settings
    from app.services.finexer_sync import _client, ensure_auto_sync

    if hours is None:
        hours = int(await runtime_settings.asetting("FINEXER_AUTO_SYNC_HOURS"))
    consent_ids = [d["_id"] async for d in finexer_consents_col.find({"status": "authorized"}, {"_id": 1})]
    todo = [
        a["_id"] async for a in accounts_col.find(
            {"source": "finexer", "connection_id": {"$in": consent_ids},
             "bank_auto_sync_hours": {"$exists": False}},
            {"_id": 1},
        )
    ]
    summary = {"hours": hours, "apply": apply, "eligible": len(todo), "attempted": 0, "accepted": 0, "refused": 0}
    if not apply or not hours:
        if apply and not hours:
            summary["note"] = "FINEXER_AUTO_SYNC_HOURS is 0 (off): nothing sent"
        return summary
    batch = todo[:limit] if limit else todo
    async with _client() as client:
        for account_id in batch:
            summary["attempted"] += 1
            if await ensure_auto_sync(client, account_id, hours):
                summary["accepted"] += 1
            else:
                summary["refused"] += 1
            await asyncio.sleep(REQUEST_GAP_S)
    return summary


def main(argv=None, env=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="send the requests (default is a dry run)")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--hours", type=int, default=None)
    args = parser.parse_args(argv)
    check_env(env)
    summary = asyncio.run(run(apply=args.apply, limit=args.limit, hours=args.hours))
    print(" ".join(f"{k}={v}" for k, v in summary.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
