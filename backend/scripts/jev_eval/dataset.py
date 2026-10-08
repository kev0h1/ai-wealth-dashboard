"""G178 deliverable 1: build the eval set from Mongo, read-only.

Every `merchant_categories` document becomes one dataset row (258 as of
2026-09-27: 173 `source: llm` -- silver, 85 `source: user` -- gold), joined
to up to three real transaction lines for that merchant key (description,
amount, direction, account subtype where available), plus a flag for
whether the recurring judge (`app.services.recurring_judge`) has ever vetoed
that merchant key for the relevant user (best-effort join, see
`mongo_helpers.fetch_veto_index`'s own docstring for the one known miss
case).

Read-only: this script only ever calls `.find()` / `.find_one()` /
`.distinct()` / `.count_documents()`. It writes exactly one thing, and it is
a local file: `out/dataset.jsonl` (gitignored).

Usage:
    cd backend && .venv/bin/python -m scripts.jev_eval.dataset
"""
from __future__ import annotations

import asyncio
import statistics
import sys

from scripts.jev_eval.common import ensure_out_dir, uid_hash, DATASET_PATH, write_jsonl


def _scope_and_key(doc_id: str, doc: dict) -> tuple[str, str, str]:
    """(scope, merchant_key, uid) from a `merchant_categories` document.

    Per-user documents are stored as `_id = f"{uid}::{key}"` with a
    matching `uid` field (`cache_merchant`, `categorisation.py`); every
    other document is global. Splitting on the FIRST "::" only, and only
    when the `uid` field agrees with the prefix, guards against a merchant
    key that itself happens to contain "::" being misread as a scope
    marker (none do today, but the check is cheap and makes the parse
    self-verifying rather than assumed).
    """
    uid = doc.get("uid")
    if uid and doc_id.startswith(f"{uid}::"):
        return "user", doc_id[len(uid) + 2:], uid
    return "global", doc_id, ""


async def _build_rows() -> list[dict]:
    from app.db.collections import merchant_categories_col, transactions_col
    from scripts.jev_eval.mongo_helpers import fetch_account_subtypes, fetch_veto_index

    subtypes = await fetch_account_subtypes()
    veto_index = await fetch_veto_index()

    rows: list[dict] = []
    cursor = merchant_categories_col.find({})
    async for doc in cursor:
        scope, key, uid = _scope_and_key(doc["_id"], doc)
        label = doc.get("category")
        label_source = doc.get("source")
        if not label or label_source not in ("llm", "user"):
            # Defensive: every real document has both fields (checked live,
            # 258/258), but a malformed row must not crash the whole build.
            continue

        txn_filter: dict = {"merchant_key": key}
        if scope == "user":
            txn_filter["user_id"] = uid
        txn_cursor = transactions_col.find(
            txn_filter,
            {"merchant_name": 1, "description": 1, "amount": 1,
             "transaction_type": 1, "account_id": 1, "user_id": 1},
        ).limit(3)

        examples: list[dict] = []
        vetoed = False
        veto_reasons: list[str] = []
        async for t in txn_cursor:
            desc = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()
            direction = "credit" if t.get("transaction_type") == "credit" else "debit"
            example_uid = t.get("user_id") or uid
            examples.append({
                "description": desc,
                "amount": t.get("amount"),
                "direction": direction,
                "subtype": subtypes.get(t.get("account_id")),
                "uid_hash": uid_hash(example_uid) if example_uid else "",
            })
            veto_entry = (veto_index.get(example_uid) or {}).get(key)
            if veto_entry:
                vetoed = True
                reason = veto_entry.get("reason")
                if reason and reason not in veto_reasons:
                    veto_reasons.append(reason)

        rows.append({
            "merchant_key": key,
            "scope": scope,
            "uid_hash": uid_hash(uid) if scope == "user" else "",
            "label": label,
            "label_source": label_source,
            "examples": examples,
            "engine_vetoed_recurring": vetoed,
            "veto_reasons": veto_reasons,
        })
    return rows


def _summarise(rows: list[dict]) -> None:
    gold = [r for r in rows if r["label_source"] == "user"]
    silver = [r for r in rows if r["label_source"] == "llm"]
    vetoed = [r for r in rows if r["engine_vetoed_recurring"]]
    counts = [len(r["examples"]) for r in rows]
    dist = {n: counts.count(n) for n in sorted(set(counts))}

    print(f"rows total:        {len(rows)}")
    print(f"gold (source=user): {len(gold)}")
    print(f"silver (source=llm): {len(silver)}")
    print(f"engine-vetoed rows: {len(vetoed)}")
    print(f"examples-per-row distribution (n_examples -> n_rows): {dist}")
    if counts:
        print(f"median examples/row: {statistics.median(counts)}")
    zero_example_rows = dist.get(0, 0)
    if zero_example_rows:
        print(
            f"WARNING: {zero_example_rows} rows have zero matching transaction "
            "lines (merchant_key present in merchant_categories but no longer "
            "in transactions) -- these still ship in the dataset (label is "
            "still real) but a judge has nothing to look at for them; "
            "report.py should be read with this in mind."
        )


async def _main_async() -> None:
    rows = await _build_rows()
    ensure_out_dir()
    write_jsonl(DATASET_PATH, rows)
    print(f"wrote {len(rows)} rows to {DATASET_PATH}")
    _summarise(rows)


def main() -> None:
    from scripts.jev_eval.common import load_real_env
    load_real_env()
    asyncio.run(_main_async())


if __name__ == "__main__":
    main()
