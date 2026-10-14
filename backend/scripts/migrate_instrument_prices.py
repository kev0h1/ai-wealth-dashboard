#!/usr/bin/env python3
"""G270: move existing holdings' current price into the shared
instrument_prices table and link each holding to its instrument.

Dry-run by default (reads only, prints counts). `--apply` writes. Idempotent:
a second run changes nothing. Scoped to investment_holdings and
instrument_prices; output is counts only, never user ids, names or ISINs.

For each holding without an `instrument_key`:
  - derive the key (ISIN, else ticker, else normalised name),
  - create the instrument if absent, seeding price/price_date from the
    holding's legacy `current_price` and `last_refreshed` when the instrument
    has no price or an older one (source "migrated", confidence "low"),
  - set `instrument_key` on the holding and unset its own current_price,
    current_value and last_refreshed.
No user id is ever written to instrument_prices.

Usage (from backend/):
    .venv/bin/python scripts/migrate_instrument_prices.py [--env-file .env]
    .venv/bin/python scripts/migrate_instrument_prices.py --apply
"""
import argparse
import asyncio
import sys
from datetime import timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def migrate(holdings_col, instruments_col, apply: bool) -> dict:
    from app.services.investment_prices import HISTORY_MAX, instrument_key

    counts = {"holdings": 0, "already_linked": 0, "no_key": 0, "linked": 0,
              "instruments_created": 0, "prices_seeded": 0}
    docs = await holdings_col.find({}).to_list(None)
    counts["holdings"] = len(docs)
    pending: dict[str, dict] = {}  # instruments seen this run, dry-run included
    for h in docs:
        if h.get("instrument_key"):
            counts["already_linked"] += 1
            continue
        key = instrument_key(h.get("isin"), h.get("ticker"), h.get("name"))
        if not key:
            counts["no_key"] += 1
            continue
        inst = pending.get(key) or await instruments_col.find_one({"_id": key})
        if inst is None:
            inst = {
                "_id": key, "isin": None if key.startswith(("TICKER:", "NAME:")) else key,
                "ticker": (h.get("ticker") or "").upper() or None, "name": h.get("name"),
                "currency": "GBP", "price": None, "price_date": None, "source": None,
                "confidence": None, "fetched_at": None, "last_attempt_at": None, "history": [],
            }
            counts["instruments_created"] += 1
        price, lr = h.get("current_price"), h.get("last_refreshed")
        if price and lr:
            lr_utc = lr.replace(tzinfo=timezone.utc) if lr.tzinfo is None else lr
            d = lr_utc.date().isoformat()
            if not inst.get("price_date") or d > inst["price_date"]:
                inst.update(price=price, price_date=d, source="migrated", confidence="low", fetched_at=lr_utc)
                inst["history"] = ([p for p in inst["history"] if p["price_date"] != d]
                                   + [{"price_date": d, "price": price, "source": "migrated"}])[-HISTORY_MAX:]
                counts["prices_seeded"] += 1
        pending[key] = inst
        counts["linked"] += 1
        if apply:
            body = {k: v for k, v in inst.items() if k != "_id"}
            await instruments_col.update_one({"_id": key}, {"$set": body}, upsert=True)
            await holdings_col.update_one(
                {"_id": h["_id"]},
                {"$set": {"instrument_key": key},
                 "$unset": {"current_price": "", "current_value": "", "last_refreshed": ""}},
            )
    return counts


async def _main(apply: bool) -> int:
    from app.db.collections import db, instrument_prices_col, investment_holdings_col
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await migrate(investment_holdings_col, instrument_prices_col, apply)
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
