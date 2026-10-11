#!/usr/bin/env python3
"""A128: retire the data of the removed Expo mobile app.

The Expo project was retired on 2026-09-08. It left two collections that
nothing under app/ binds or reads:

  expo_push_tokens  user_id-keyed push tokens for a dead app (dead data)
  savings_plans     empty

Count mode (default) is read-only. With --apply --yes it deletes every
document in expo_push_tokens and drops savings_plans (only if empty).
The collection drop goes through app.db.guard.guarded_drop_collection, so a
non-test database also needs ALLOW_DROP_PROD_DB=1 in the environment; the
script passes the database name as the confirmation. Output is counts only,
never user ids. The daily backup covers both collections, so no separate
export is taken first.

erase_user already sweeps both names (RETIRED_COLLECTIONS), so account
deletion is safe before and after this runs. Run it once per environment,
production only with Kevin's go-ahead.

Usage (from backend/):
    .venv/bin/python scripts/retire_expo_push_tokens.py [--env-file .env]
    ALLOW_DROP_PROD_DB=1 .venv/bin/python scripts/retire_expo_push_tokens.py --apply --yes
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

TOKENS = "expo_push_tokens"
PLANS = "savings_plans"


def _load_env(path: Path) -> None:
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))


async def run(apply: bool) -> int:
    from app.db import collections as cols
    from app.db.guard import guarded_drop_collection

    names = set(await cols.db.list_collection_names())
    out = {}
    for name in (TOKENS, PLANS):
        out[name] = await cols.db[name].count_documents({}) if name in names else None
    for name, n in out.items():
        print(f"{name}: {'absent' if n is None else str(n) + ' document(s)'}")

    if not apply:
        print("count mode: nothing changed (use --apply --yes to delete)")
        return 0

    if out[TOKENS]:
        r = await cols.db[TOKENS].delete_many({})
        print(f"{TOKENS}: deleted {r.deleted_count}")
    if out[PLANS] is not None:
        if out[PLANS]:
            print(f"{PLANS}: not empty, left alone")
        else:
            await guarded_drop_collection(
                cols._mongo, cols.db.name, PLANS, confirm_name=cols.db.name
            )
            print(f"{PLANS}: dropped")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args(argv)
    if a.apply and not a.yes:
        print("refusing: --apply needs --yes", file=sys.stderr)
        return 2
    if a.env_file:
        _load_env(Path(a.env_file))
    return asyncio.run(run(a.apply))


if __name__ == "__main__":
    sys.exit(main())
