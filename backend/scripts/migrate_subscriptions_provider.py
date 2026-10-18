#!/usr/bin/env python3
"""C21: stamp `provider` on every pre-existing subscriptions_col document
(docs/pricing/store-billing-c13.md section 2.2).

Every document written before C21 was written by Stripe code, or by the
manual / self-selected plan paths that share its single per-user slot, so it
has no `provider` field. This sets provider "stripe" on each, and copies
`stripe_subscription_id` into `provider_subscription_id` where one exists.
`stripe_subscription_id` itself is kept (read-compatible alias), nothing is
dropped or renamed.

Additive and backwards compatible. Not required for correctness: the code
treats a missing provider as "stripe" and the startup index swap works with
or without it. It only normalises the data so later queries can match on
provider exactly.

Dry-run by default (reads only, prints counts). `--apply` writes. Idempotent:
a second run finds nothing to change. Output is counts only, never user ids.

Usage (from backend/):
    .venv/bin/python scripts/migrate_subscriptions_provider.py [--env-file .env]
    .venv/bin/python scripts/migrate_subscriptions_provider.py --apply
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def migrate(subscriptions_col, apply: bool) -> dict:
    counts = {"documents": 0, "already_migrated": 0, "provider_stamped": 0, "provider_subscription_id_copied": 0}
    docs = await subscriptions_col.find({}).to_list(None)
    counts["documents"] = len(docs)
    for doc in docs:
        if doc.get("provider"):
            counts["already_migrated"] += 1
            continue
        fields = {"provider": "stripe"}
        counts["provider_stamped"] += 1
        if doc.get("stripe_subscription_id") and not doc.get("provider_subscription_id"):
            fields["provider_subscription_id"] = doc["stripe_subscription_id"]
            counts["provider_subscription_id_copied"] += 1
        if apply:
            # Guard on the field still being absent so a concurrent write
            # that already stamped it is never overwritten.
            await subscriptions_col.update_one(
                {"_id": doc["_id"], "provider": {"$exists": False}}, {"$set": fields},
            )
    return counts


async def _main(apply: bool) -> int:
    from app.db.collections import db, subscriptions_col
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await migrate(subscriptions_col, apply)
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
