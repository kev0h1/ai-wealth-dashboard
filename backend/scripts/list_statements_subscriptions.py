#!/usr/bin/env python3
"""D12: READ-ONLY. Lists users holding a self-managed Statements subscription.

Before D12, onboarding (PlanPicker, billing off) called POST
/subscription/select-free, which wrote {tier: "statements", managed_by:
"self", no Stripe source} over the DEFAULT_TIER fallback (max). Every such
document written while billing was off is a probable accidental downgrade;
this lists them for Kevin to decide. It never writes: only find() is used.

Usage (from backend/, with the .env the service uses):
    .venv/bin/python scripts/list_statements_subscriptions.py [--list]

Counts only by default; --list adds one hashed line per user.

User ids are shown as a short SHA-256 prefix, never the email.
"""
import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pymongo import MongoClient  # noqa: E402

from app.core.config import BILLING_ENABLED, MONGO_DB, MONGO_URI  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="also print one hashed line per user")
    args = ap.parse_args()

    db = MongoClient(MONGO_URI, serverSelectionTimeoutMS=8000)[MONGO_DB]
    query = {"tier": "statements", "managed_by": "self", "source": {"$exists": False}}
    docs = list(db["subscriptions"].find(query, {"user_id": 1, "started_at": 1, "updated_at": 1}))
    total = db["subscriptions"].count_documents({})
    print(f"db={MONGO_DB} billing_enabled={BILLING_ENABLED} subscriptions={total} "
          f"self_managed_statements={len(docs)}")
    if args.list:
        for d in sorted(docs, key=lambda x: str(x.get("started_at"))):
            uid = hashlib.sha256(str(d.get("user_id", "")).encode()).hexdigest()[:12]
            print(f"{uid}  started_at={d.get('started_at')}  updated_at={d.get('updated_at')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
