#!/usr/bin/env python3
"""A178: find cached Finexer customers that no longer exist at Finexer.

Deleting customers in the Finexer dashboard leaves our finexer_customers cache
pointing at ids Finexer now rejects, so POST /consents answers 400. The app
recovers on the next connect by itself (drop, recreate, retry once); this script
cleans up in bulk and flags the consents that died with their customer.

For every cached customer_id it makes one GET /customers/{id} (through the
rate-limited, counted finexer_sync._get helper). A 404, or a 400 whose error
envelope names the customer, means missing. Any other answer (5xx, 429 after
retries, network error) is counted as "errors" and never treated as missing.

DRY RUN BY DEFAULT: reads only. With --apply it
  1. deletes the cached finexer_customers record of each missing customer, so
     the next connect creates a fresh one, and
  2. for every consent under a missing customer, sets its accounts to status
     "expired" (the existing "needs reconnecting" banner) and stamps the
     consent's last_sync_error "consent_revoked". The consent's own status is
     left alone; the next sync's GET /consents/{id} settles it.

Refuses to run unless MONGO_DB is set explicitly in the environment.
Prints counts only: no emails, customer ids, consent ids or keys.

Usage (from backend/):
    MONGO_DB=<db> .venv/bin/python scripts/finexer_reconcile_customers.py
    MONGO_DB=<db> .venv/bin/python scripts/finexer_reconcile_customers.py --apply
"""
import argparse
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))


async def customer_status(client, customer_id: str, counter: dict) -> str:
    """"ok", "missing" or "error" for one cached customer id."""
    from app.services.finexer_sync import _get, _is_unknown_customer
    try:
        resp = await _get(client, f"/customers/{customer_id}", counter=counter)
    except Exception:
        return "error"
    if resp.status_code == 200:
        return "ok"
    if resp.status_code == 404 or _is_unknown_customer(resp):
        return "missing"
    return "error"


async def reconcile(client, customers_col, consents_col, accounts_col, *, apply: bool) -> dict:
    counts = {"checked": 0, "ok": 0, "missing": 0, "errors": 0, "cleared": 0,
              "consents_flagged": 0, "accounts_expired": 0}
    counter: dict = {"requests": 0, "429s": 0}
    missing: list = []
    from app.core.demo import is_demo_user  # C43: the demo identity never talks to Finexer
    async for doc in customers_col.find({}):
        cid = doc.get("customer_id")
        if not cid or is_demo_user(doc.get("_id")):
            continue
        counts["checked"] += 1
        status = await customer_status(client, cid, counter)
        if status == "ok":
            counts["ok"] += 1
        elif status == "missing":
            counts["missing"] += 1
            missing.append((doc["_id"], cid))
        else:
            counts["errors"] += 1

    for uid, cid in missing:
        consent_ids = [d["_id"] async for d in consents_col.find({"customer_id": cid})]
        counts["consents_flagged"] += len(consent_ids)
        if not apply:
            continue
        for consent_id in consent_ids:
            res = await accounts_col.update_many({"connection_id": consent_id}, {"$set": {"status": "expired"}})
            counts["accounts_expired"] += getattr(res, "modified_count", 0) or 0
            await consents_col.update_one(
                {"_id": consent_id},
                {"$set": {"last_sync_error": "consent_revoked",
                          "last_sync_error_at": datetime.utcnow()}},  # naive-ok: matches last_synced convention
            )
        await customers_col.delete_one({"_id": uid})
        counts["cleared"] += 1
    counts["requests"] = counter["requests"]
    return counts


async def amain(apply: bool) -> int:
    from app.core.config import FINEXER_API_KEY
    from app.db.collections import accounts_col, finexer_consents_col, finexer_customers_col
    from app.services.finexer_sync import _client
    if not FINEXER_API_KEY:
        print("FINEXER_API_KEY not configured", file=sys.stderr)
        return 2
    print(f"mode: {'APPLY' if apply else 'DRY RUN'}")
    async with _client() as client:
        counts = await reconcile(client, finexer_customers_col, finexer_consents_col, accounts_col, apply=apply)
    for k, v in counts.items():
        print(f"  {k}: {v}")
    if not apply and counts["missing"]:
        print("dry run: nothing written; re-run with --apply to clear and flag")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="clear missing customers and flag their consents")
    args = ap.parse_args(argv)
    if not os.environ.get("MONGO_DB"):
        print("refusing to run: set MONGO_DB explicitly (nothing done)", file=sys.stderr)
        return 2
    return asyncio.run(amain(args.apply))


if __name__ == "__main__":
    sys.exit(main())
