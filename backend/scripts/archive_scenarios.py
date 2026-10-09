#!/usr/bin/env python3
"""G246: count (and, user by user, delete) anything the removed life simulator
left behind in MongoDB.

Finding at authoring time (2026-10-09): the simulator never had a collection of
its own. `app/services/scenario.py` and `app/routers/scenario.py` only read
(`savings_goals_col`, the shared cashflow and debt-plan caches) and returned a
payload; nothing was written. The only possible traces are therefore:

  1. a collection whose name contains "scenario" (none is bound in
     app/db/collections.py, listed here in case one was created by hand);
  2. `response_cache` documents whose `name` mentions "scenario";
  3. `llm_usage` metering rows with pipeline == "scenario" (the headline and
     slot-extraction LLM calls). These are cost/audit records, NOT scenario
     content, so they are counted but only deleted with --include-usage-rows.

COUNT MODE IS THE DEFAULT and is strictly read-only: count_documents,
list_collection_names and one distinct(). No writes, no drops.

--apply is user-scoped: it needs --user <email> and --yes, deletes only that
user's documents (user_id == email, or _id == email for a per-user collection),
through the app's guarded Mongo client (app.db.collections), and never drops a
collection or a database. It must only ever be run after review, by Kevin's
go-ahead, one user at a time. This script was WRITTEN under G246, not applied.

Usage (from backend/):
    .venv/bin/python scripts/archive_scenarios.py [--env-file PATH]
    .venv/bin/python scripts/archive_scenarios.py --apply --yes --user a@b.c [--include-usage-rows]

Output never contains emails or keys: users appear as short sha256 prefixes.
"""
import argparse
import asyncio
import hashlib
import os
import re
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

PIPELINE = "scenario"
_NAME_RE = re.compile("scenario", re.IGNORECASE)


def _hash(uid: str) -> str:
    return hashlib.sha256(uid.encode()).hexdigest()[:10]


def _load_env(path: str | None) -> None:
    """Only MONGO_URI and MONGO_DB are taken from the env file, and they are
    never printed."""
    if not path:
        return
    from dotenv import dotenv_values
    values = dotenv_values(path)
    for key in ("MONGO_URI", "MONGO_DB"):
        if values.get(key):
            os.environ[key] = values[key]


async def count(db, collections) -> dict:
    out = {"scenario_named_collections": {}, "response_cache": 0, "llm_usage_rows": 0, "llm_usage_users": 0}
    for name in await db.list_collection_names():
        if _NAME_RE.search(name):
            out["scenario_named_collections"][name] = await db[name].count_documents({})
    out["response_cache"] = await collections.response_cache_col.count_documents(
        {"name": {"$regex": "scenario", "$options": "i"}})
    out["llm_usage_rows"] = await collections.llm_usage_col.count_documents({"pipeline": PIPELINE})
    users = await collections.llm_usage_col.distinct("user_id", {"pipeline": PIPELINE})
    out["llm_usage_users"] = len(users)
    return out


async def apply_for_user(db, collections, user: str, include_usage: bool) -> dict:
    """Delete one user's leftovers. Every filter carries the user id."""
    deleted = {"scenario_named_collections": {}, "response_cache": 0, "llm_usage_rows": 0}
    for name in await db.list_collection_names():
        if _NAME_RE.search(name):
            res = await db[name].delete_many({"$or": [{"user_id": user}, {"_id": user}]})
            deleted["scenario_named_collections"][name] = res.deleted_count
    res = await collections.response_cache_col.delete_many(
        {"user_id": user, "name": {"$regex": "scenario", "$options": "i"}})
    deleted["response_cache"] = res.deleted_count
    if include_usage:
        res = await collections.llm_usage_col.delete_many({"user_id": user, "pipeline": PIPELINE})
        deleted["llm_usage_rows"] = res.deleted_count
    return deleted


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--env-file", default=None, help="env file to read MONGO_URI / MONGO_DB from")
    ap.add_argument("--apply", action="store_true", help="delete (user-scoped; needs --user and --yes)")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--user", default=None, help="the one user whose leftovers are deleted")
    ap.add_argument("--include-usage-rows", action="store_true",
                    help="also delete that user's llm_usage rows with pipeline=scenario")
    args = ap.parse_args()
    if args.apply and not (args.user and args.yes):
        print("refusing: --apply needs both --user <email> and --yes (user-scoped, never global)")
        return 2
    _load_env(args.env_file)
    from app.db import collections  # imported after the env is set
    db = collections.db

    print("mode:", "APPLY" if args.apply else "COUNT (read-only)")
    summary = await count(db, collections)
    print("counts:", summary)
    if not args.apply:
        return 0
    print("user:", _hash(args.user))
    print("deleted:", await apply_for_user(db, collections, args.user, args.include_usage_rows))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
