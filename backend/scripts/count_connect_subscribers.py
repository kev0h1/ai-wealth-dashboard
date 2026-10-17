#!/usr/bin/env python3
"""B51: READ-ONLY. Counts subscriptions that carry the Connect tier.

Counts only: no user id, email or Stripe id is ever printed. Uses only
count_documents(), so it cannot write. Reports per the environment's own
config (MONGO_DB from the .env this process loads, CONNECT_TIER_ENABLED,
CONNECT_SUBSCRIBER_POLICY). Never run it against production from the UAT
host; run it there with production's own environment if Kevin wants that
figure.

Usage (from backend/, with the .env the service uses):
    .venv/bin/python scripts/count_connect_subscribers.py
    .venv/bin/python scripts/count_connect_subscribers.py --dry-run-move

--dry-run-move prints what the move_to_max policy WOULD do (how many active
Connect subscriptions would become Max at the same price) and writes
nothing. There is no non-dry-run path: moving anyone waits on Kevin's
decision between the two policies (keep_until_renewal vs move_to_max).
Existing Connect subscribers keep their entitlements while active under
either policy.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ACTIVE_STATUSES = ("active", "trialing", "past_due")


def count_connect(subscriptions) -> dict:
    """`subscriptions` is anything with count_documents(filter) (a pymongo
    collection, or a fake in tests). Returns counts only."""
    base = {"tier": "connect"}
    out = {
        "connect_total": subscriptions.count_documents(base),
        "connect_active": subscriptions.count_documents({**base, "status": {"$in": list(ACTIVE_STATUSES)}}),
        "connect_stripe_managed": subscriptions.count_documents({**base, "source": "stripe"}),
        "connect_manual": subscriptions.count_documents({**base, "managed_by": "manual"}),
    }
    return out


def main(argv=None, collection=None, config=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run-move", action="store_true",
                    help="print what move_to_max would change; never writes")
    args = ap.parse_args(argv)

    if config is None:
        from app.core import config as cfg
        config = cfg
    if collection is None:
        from pymongo import MongoClient
        collection = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=8000)[config.MONGO_DB]["subscriptions"]

    counts = count_connect(collection)
    print(
        f"db={config.MONGO_DB} connect_tier_enabled={config.CONNECT_TIER_ENABLED} "
        f"policy={config.CONNECT_SUBSCRIBER_POLICY} "
        + " ".join(f"{k}={v}" for k, v in counts.items())
    )
    if args.dry_run_move:
        print(
            f"dry-run: move_to_max would change tier connect -> max for {counts['connect_active']} "
            "active subscription(s) at the same price; nothing was written."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
