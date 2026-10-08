"""Live, read-only Mongo helpers shared by dataset.py / run_jev.py /
run_haiku.py. Every function here is a plain read against the real
database; nothing in this module writes anything.

Import this only AFTER `common.load_real_env()` has run (each script's
entrypoint calls it first) -- `app.db.collections` opens its Motor client
at import time, reading `MONGO_URI` from `app.core.config`, which itself
tries to load `backend/.env` relative to ITS OWN location (this worktree's
backend/.env, which does not exist); `load_real_env()` populates
`os.environ` from the shared tree's real `.env` first so that no-op load
doesn't leave `MONGO_URI` empty.
"""
from __future__ import annotations

from app.db.collections import (
    accounts_col, cashflow_cache_col, transactions_col, statement_transactions_col,
)
from app.services.categorisation import canonical_merchant_key

from scripts.jev_eval.common import uid_hash


async def build_uid_hash_lookup() -> dict[str, str]:
    """hash(uid) -> uid for every real uid seen in `transactions`. Built in
    memory at run time and never written to disk -- this is what lets
    `dataset.jsonl` carry only `uid_hash` while the live scripts can still
    recover the real uid to query `get_category_kinds(uid)` / that user's
    own custom categories."""
    uids = await transactions_col.distinct("user_id")
    return {uid_hash(u): u for u in uids if u}


async def fetch_account_subtypes() -> dict[str, str | None]:
    """account_id -> subtype, for every account across every user. Reading
    across all users is fine here (subtype is not personal data -- "isa",
    "current", "credit_card", ...); the dataset only ever attaches one
    account's subtype to that account's OWN transaction line."""
    out: dict[str, str | None] = {}
    async for a in accounts_col.find({}, {"subtype": 1}):
        out[a["_id"]] = a.get("subtype")
    return out


async def fetch_veto_index() -> dict[str, dict[str, dict]]:
    """uid -> {canonical_merchant_key(veto entry's raw key): veto entry}.

    `cashflow_cache` stores `engine_vetoed_recurring` as a list of
    `{key, category, reason, confidence, vetoed_at}` dicts per user, where
    `key` is the raw recurrence-series text (`series_key`'s output, NOT
    `canonical_merchant_key`'s). Re-running it through
    `canonical_merchant_key` here is what lets a veto join against a
    transaction's stored `merchant_key`, which IS `canonical_merchant_key`'s
    output at sync time -- `series_key` and `canonical_merchant_key` agree
    on the common case (merchant_name when present) but diverge on
    description-derived keys, so this join is best-effort: it will miss a
    veto whose series key came from a differently-cleaned description, and
    that is stated as a limitation in README.md rather than silently assumed
    complete.
    """
    index: dict[str, dict[str, dict]] = {}
    cursor = cashflow_cache_col.find({}, {"engine_vetoed_recurring": 1})
    async for doc in cursor:
        uid = doc["_id"]
        entries = doc.get("engine_vetoed_recurring") or []
        if not entries:
            continue
        bucket = index.setdefault(uid, {})
        for entry in entries:
            raw_key = entry.get("key") or ""
            canon = canonical_merchant_key("", raw_key)
            if canon:
                bucket[canon] = entry
    return index


async def fetch_user_examples(uid: str, *, per_category: int = 3) -> dict[str, list[str]]:
    """That ONE user's own real correction description snippets, grouped by
    the category they filed them under -- `custom_category` set means the
    user corrected it themselves (the same field `PATCH /transactions/{id}`
    writes). Scoped to `user_id: uid` in the query itself, never filtered
    in Python after a wider read (the Firewall Rule's "scope every query by
    user_id" applied literally).

    Reads `transactions_col` only (not `statement_transactions_col`) -- the
    primary data source, matching `llm_name_check`'s own prefilter comment
    ("transactions_col only (primary data source)").
    """
    out: dict[str, list[str]] = {}
    cursor = transactions_col.find(
        {"user_id": uid, "custom_category": {"$ne": None}},
        {"custom_category": 1, "merchant_name": 1, "description": 1},
    )
    async for t in cursor:
        cat = t.get("custom_category")
        if not cat:
            continue
        bucket = out.setdefault(cat, [])
        if len(bucket) >= per_category:
            continue
        desc = ((t.get("merchant_name") or "") + " " + (t.get("description") or "")).strip()
        if desc:
            bucket.append(desc[:120])
    return out
