#!/usr/bin/env python3
"""G316: one-off backfill of the vendor-directory ladder over existing transactions.

Dry run by default: reads only and prints COUNTS, never a user id, name, email,
merchant or amount. `--apply` writes.

What it does, per user who has custom categories (everyone else is skipped,
their categorisation is unchanged):

* Walks the user's open debit rows (no custom_category) and applies the same
  ladder as sync: stored decision, then the directory description, then a lookup
  if the directory has nothing fresh, then the cheap-model match to the user's
  categories.
* NEVER touches a row the user corrected (source user or custom_category set),
  a merchant the user has corrected anywhere, or a merchant a user rule covers.
  Person-to-person payments, the user's own name, account or sort-code digits
  and transfers are never sent anywhere (see `privacy_exclusion`).
* Dry run makes no lookups, no model calls and no writes. It reports how many
  merchants are already described, how many would need a lookup, and how many
  rows stored decisions would move.

It also reports duplicate user rules (same user, pattern and category, such as the
MIDLANDS GOLF Meriden rule stored twice). The dry run only counts them; `--apply`
keeps the oldest of each set and deletes the extras.

`--apply` uses the real caps (per sync, per day), so a large backlog needs the
script re-run until `deferred` reads zero.

Usage (from backend/):
    .venv/bin/python scripts/backfill_vendor_categories.py [--env-file .env]
    .venv/bin/python scripts/backfill_vendor_categories.py --apply
"""
import argparse
import asyncio
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


async def duplicate_rules(rules_col, apply: bool) -> dict:
    """Count (and with apply, remove) duplicate user rules, keeping the oldest."""
    groups: dict = defaultdict(list)
    for r in await rules_col.find({}).to_list(None):
        groups[(r.get("uid"), r.get("pattern"), r.get("category"))].append(r)
    sets = extras = removed = 0
    for docs in groups.values():
        if len(docs) < 2:
            continue
        sets += 1
        docs.sort(key=lambda d: (d.get("created_at") is None, d.get("created_at"), str(d["_id"])))
        extras += len(docs) - 1
        if apply:
            for d in docs[1:]:
                removed += (await rules_col.delete_one({"_id": d["_id"]})).deleted_count
    return {"duplicate_rule_sets": sets, "duplicate_rule_extras": extras, "duplicate_rules_removed": removed}


async def backfill(apply: bool, *, transactions=None, rules_col=None, ladder=None) -> dict:
    from app.db.collections import transactions_col, user_rules_col
    from app.services import vendor_directory as vd
    transactions = transactions if transactions is not None else transactions_col
    rules_col = rules_col if rules_col is not None else user_rules_col
    ladder = ladder or vd.run_vendor_ladder

    totals: Counter = Counter()
    private: Counter = Counter()
    deferred: Counter = Counter()
    uids = [u for u in await transactions.distinct("user_id") if u]
    totals["users"] = len(uids)
    for uid in uids:
        s = await ladder(uid, dry_run=not apply, allow_lookups=apply, allow_match=apply)
        if not s.get("ran"):
            totals["users_skipped_no_custom_categories"] += 1
            continue
        totals["users_with_custom_categories"] += 1
        for k in ("merchants", "rows", "corrected_skipped", "rule_skipped", "decided_cached", "decided_new",
                  "no_description", "needs_lookup", "needs_match", "lookups_started", "rows_updated",
                  "would_update_rows"):
            totals[k] += s.get(k, 0)
        private.update(s.get("private_skipped") or {})
        deferred.update(s.get("deferred") or {})
    out = dict(totals)
    out["private_skipped"] = dict(private)
    out["deferred"] = dict(deferred)
    out.update(await duplicate_rules(rules_col, apply))
    return out


async def _main(apply: bool) -> int:
    from app.core import config as cfg
    if apply and not cfg.VENDOR_LADDER_ENABLED:
        print("refusing --apply: VENDOR_LADDER_ENABLED is off. It ships dark; Kevin enables it after signing off "
              "a real vendor-directory report. Dry run is still allowed.")
        return 2
    from app.db.collections import db
    print(f"database: {db.name}  mode: {'APPLY' if apply else 'dry-run'}")
    counts = await backfill(apply)
    for k, v in counts.items():
        print(f"  {k}: {v}")
    if not apply:
        print("dry-run: nothing written, no lookups, no model calls. Re-run with --apply to write.")
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
