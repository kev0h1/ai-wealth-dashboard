"""Bank-side PENDING transactions — provisional postings a bank has already
subtracted from its own displayed balance but that haven't yet reached our
settled `transactions_col` feed.

WHY THIS EXISTS (live bug, 2026-09-01): a bank's own "current"/"available"
balance already reflects this morning's direct debits/standing orders before
those transactions ever show up in a provider's normal settled-transactions
feed. Our per-account balance walks (analytics.at_risk_count,
companion.compute_today_items, spend_impact._bills_risk, the Planning page's
own walk) all seed from that ALREADY-REDUCED live balance and then debit the
same bill again from `upcoming_bills`, because `_match_observed` in
analytics.py only ever looks for a SETTLED debit — producing a phantom
shortfall on money that has, in fact, already left the account. Confirmed
live via TrueLayer's GET /data/v1/accounts/{id}/transactions/pending, and via
Finexer's `status` field on GET /bank_accounts/{id}/transactions (UK Open
Banking "Booked"/"Pending").

STORAGE — a SIBLING collection, never merged into `transactions_col`.
This is deliberate: every existing consumer of `transactions_col` (recurring
detection in `_detect_recurring`, the categorisation-cache learner, spend
history/category totals) is excluded from these rows BY CONSTRUCTION — they
simply never query this collection — rather than needing an `is_pending`
filter bolted onto N call sites. The ONLY consumer is the occurrence-matching
choke point in `app/routers/analytics.py::_build_cashflow_response`
(`_match_pending_observed`), which is itself the single place every
downstream sim (at_risk_count, companion, spend_impact, the payday plan, the
frontend walk) inherits from — see that function's docstring for how a
matched occurrence is excluded from `upcoming_bills` (the walk-facing list)
without any of those sims needing to know pending transactions exist at all.

SUPERSESSION (settled twin arrives) — implicit, not reconciled by amount/
date. `replace_pending_for_account` is called once per account per sync with
the provider's CURRENT answer to "what's pending right now", and wholesale-
replaces the stored set: any previously-stored pending row for that account
absent from the fresh fetch is deleted. Once a transaction settles, the
provider simply stops returning it as pending (regardless of whether the
settled transaction reuses the same id), so the stale pending copy is
deleted in the exact sync pass its settled twin lands via the pre-existing
settled-transaction path (`_upsert_transactions` / `_upsert_finexer_transactions`).
No amount/date matching between the two collections is needed or performed.

REVERT (pending vanishes without settling) — the same replace step. A
bounced/cancelled DD simply stops appearing in the next fetch, gets deleted,
and the occurrence falls back to being evaluated as an ordinary projected/
overdue bill by `_build_cashflow_response` — the existing give-up machinery
(PENDING_GIVE_UP_DAYS) picks up exactly where it would have without this
module existing, since no persisted "observed_pending" state is ever stored
on the occurrence itself; it's recomputed fresh on every call.

SWEEP — PENDING_TXN_MAX_AGE_DAYS is a BACKSTOP, not the primary mechanism.
The replace-on-sync step above only runs for an account that's still being
synced; a dead/expired connection would otherwise leave a stale pending row
forever. `replace_pending_for_account` also deletes anything past this age
on every call, and `_build_cashflow_response`'s matching query filters on it
independently, so the backstop holds even when a sync pass never happens
again for that account. Real banks expire pending authorisations/DDs around
this horizon.
"""
import logging
from datetime import datetime, timedelta

from app.db.collections import pending_transactions_col
from app.services.categorisation import canonical_merchant_key

logger = logging.getLogger(__name__)

PENDING_TXN_MAX_AGE_DAYS = 7  # banks expire pending authorisations/DDs around this horizon


async def replace_pending_for_account(
    rows: list[dict], account_id: str, user_id: str, provider: str,
) -> None:
    """Wholesale-replace the stored pending set for one account with `rows`
    -- the provider's current, authoritative answer to "what's pending right
    now". Each row is a normalised dict: {transaction_id, date (datetime),
    amount (signed or unsigned -- stored abs), description, merchant_name,
    transaction_type}.

    Rows previously stored for this account but absent from `rows` are
    deleted -- see the module docstring's SUPERSESSION/REVERT sections for
    why that single rule covers both "it settled" and "it vanished".
    """
    now = datetime.utcnow()
    keep_ids = []
    for row in rows:
        txn_id = row.get("transaction_id")
        if not txn_id:
            continue
        keep_ids.append(txn_id)
        description = row.get("description") or ""
        merchant_name = row.get("merchant_name") or ""
        doc = {
            "account_id":       account_id,
            "user_id":          user_id,
            "date":             row.get("date") or now,
            "amount":           abs(float(row.get("amount") or 0)),
            "description":      description,
            "merchant_name":    merchant_name or None,
            "transaction_type": row.get("transaction_type", "debit"),
            "provider":         provider,
            "is_pending":       True,
            "merchant_key":     canonical_merchant_key(merchant_name, description),
            "last_seen":        now,
        }
        await pending_transactions_col.update_one(
            {"_id": txn_id},
            {"$set": doc, "$setOnInsert": {"_id": txn_id, "first_seen": now}},
            upsert=True,
        )

    cutoff = now - timedelta(days=PENDING_TXN_MAX_AGE_DAYS)
    await pending_transactions_col.delete_many({
        "account_id": account_id,
        "$or": [
            {"_id": {"$nin": keep_ids}},
            {"first_seen": {"$lt": cutoff}},
        ],
    })
