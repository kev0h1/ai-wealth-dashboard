#!/usr/bin/env python3
"""H87: retire the data of the removed Yapily open-banking provider.

The Yapily integration (router, sync service, worker task, collection
bindings) was removed in H87. It left three collections that nothing under
app/ binds or reads any more:

  yapily_accounts      account documents
  yapily_consents      consent documents (credentials, encrypted at rest)
  yapily_transactions  transaction documents

Count mode (default) is read-only and prints document counts only, never ids
or user ids. With --apply --yes it deletes every document in each selected
collection and then drops the (now empty) collection through
app.db.guard.guarded_drop_collection. The guard is checked BEFORE any
deletion, so a non-test database needs ALLOW_DROP_PROD_DB=1 in the
environment and the run refuses up front otherwise (the A128 pattern); the
script passes the database name as the confirmation.

Take or confirm a backup first (the daily backup covers these collections)
and run production only with Kevin's go-ahead. erase_user keeps sweeping all
three names (app.db.collections.ERASE_ONLY_COLLECTIONS) until they are
dropped, so account deletion is safe before and after this runs.

Usage (from backend/):
    .venv/bin/python scripts/retire_yapily_accounts.py [--env-file .env] [--only yapily_accounts]
    ALLOW_DROP_PROD_DB=1 .venv/bin/python scripts/retire_yapily_accounts.py --apply --yes
"""
import argparse
import asyncio
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

COLLECTIONS = ("yapily_accounts", "yapily_consents", "yapily_transactions")


def _load_env(path: Path) -> None:
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))


async def run(apply: bool, only=None) -> int:
    from app.db import collections as cols
    from app.db.guard import assert_drop_allowed, guarded_drop_collection

    targets = [only] if only else list(COLLECTIONS)
    existing = set(await cols.db.list_collection_names())
    counts = {}
    for name in targets:
        counts[name] = await cols.db[name].count_documents({}) if name in existing else None
    for name, n in counts.items():
        print(f"{name}: {'absent' if n is None else str(n) + ' document(s)'}")

    if not apply:
        print("count mode: nothing changed (use --apply --yes to delete)")
        return 0

    # Check the drop guard BEFORE deleting anything so a run never half-completes.
    try:
        assert_drop_allowed(cols.db.name, cols.db.name)
    except Exception as exc:
        print(f"refusing before any change: {exc}", file=sys.stderr)
        return 3

    for name, n in counts.items():
        if n is None:
            continue
        if n:
            r = await cols.db[name].delete_many({})
            print(f"{name}: deleted {r.deleted_count}")
        await guarded_drop_collection(cols._mongo, cols.db.name, name, confirm_name=cols.db.name)
        print(f"{name}: dropped")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--env-file", default=None)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--only", choices=COLLECTIONS, default=None,
                    help="restrict to one collection")
    a = ap.parse_args(argv)
    if a.apply and not a.yes:
        print("refusing: --apply needs --yes", file=sys.stderr)
        return 2
    if a.env_file:
        _load_env(Path(a.env_file))
    return asyncio.run(run(a.apply, a.only))


if __name__ == "__main__":
    sys.exit(main())
