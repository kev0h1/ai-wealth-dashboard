#!/usr/bin/env python3
"""A174: one-off migration of the legacy ALLOWED_EMAILS env list into the
`allowed_signups` collection (the only sign-up allow list from A174 on).

Reads the OLD env var by name from the process environment (the app itself
no longer reads it), inserts each entry as `status: "invited"` (active) with
`source: "env_migration"`, skipping any address already present
(case-insensitive, Gmail dot-insensitive via the same key the app uses).
Entries are ordinary, revocable allow-list docs afterwards.

Dry-run by default (reads only). `--apply` writes. Idempotent: a second run
inserts nothing. Output is counts only, never an address.

Usage (from backend/, with the target environment's MONGO_* and the old
ALLOWED_EMAILS exported):
    .venv/bin/python scripts/migrate_allowed_emails.py
    .venv/bin/python scripts/migrate_allowed_emails.py --apply
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def parse_env_list(raw: str) -> list[str]:
    seen: list[str] = []
    for part in (raw or "").split(","):
        e = part.strip().lower()
        if e and "@" in e and e not in seen:
            seen.append(e)
    return seen


async def migrate(allowed_signups_col, emails: list[str], apply: bool) -> dict:
    from app.core.config import PRIMARY_EMAIL, _gmail_key

    counts = {"env_entries": len(emails), "already_present": 0, "inserted": 0, "owner_skipped": 0}
    done_keys: set[str] = set()
    for email in emails:
        key = _gmail_key(email)
        if key == _gmail_key(PRIMARY_EMAIL):
            counts["owner_skipped"] += 1
            continue
        if key in done_keys:
            counts["already_present"] += 1
            continue
        done_keys.add(key)
        if await allowed_signups_col.find_one({"key": key}):
            counts["already_present"] += 1
            continue
        counts["inserted"] += 1
        if apply:
            now = datetime.now(timezone.utc)
            # Upsert on the key so a concurrent insert is never duplicated
            # or overwritten ($setOnInsert only).
            await allowed_signups_col.update_one(
                {"key": key},
                {"$setOnInsert": {
                    "key": key, "email": email, "status": "invited",
                    "source": "env_migration", "invited_by": "env_migration",
                    "created_at": now, "updated_at": now,
                }},
                upsert=True,
            )
    return counts


async def _main(apply: bool) -> int:
    from app.db.collections import allowed_signups_col, db

    emails = parse_env_list(os.getenv("ALLOWED_EMAILS", ""))
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await migrate(allowed_signups_col, emails, apply)
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
    sys.exit(asyncio.run(_main(args.apply)))
