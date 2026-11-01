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
filter bolted onto N call sites. The financial consumer is the occurrence-matching
choke point in `app/routers/analytics.py::_build_cashflow_response`
(`_match_pending_observed`), which is itself the single place every
downstream sim (at_risk_count, companion, spend_impact, the payday plan, the
frontend walk) inherits from — see that function's docstring for how a
matched occurrence is excluded from `upcoming_bills` (the walk-facing list)
without any of those sims needing to know pending transactions exist at all.
G373 also exposes these rows separately in paginated activity responses; they
remain excluded from booked totals and charts.

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
import hashlib
import json
import logging
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from app.db.collections import pending_transactions_col
from app.services.categorisation import canonical_merchant_key

logger = logging.getLogger(__name__)

PENDING_TXN_MAX_AGE_DAYS = 7  # banks expire pending authorisations/DDs around this horizon

# A183 handover window: the booked twin carries the same date as the pending
# row or a later one (settlement), never a materially earlier one. One day of
# slack before covers a pending date stamped by the bank's cut-off.
HANDOVER_DAYS_BEFORE = 1
HANDOVER_DAYS_AFTER = 5


def _pennies(value):
    try:
        amount = Decimal(str(value)).copy_abs().quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return None
    return amount if amount.is_finite() else None


def _identity(row: dict):
    """Counterparty account first, else the merchant key; None when neither."""
    from app.services.own_account_transfers import counterparty_key
    party = counterparty_key(row.get("party_sort_code"), row.get("party_number"))
    key = row.get("merchant_key")
    if not key and (row.get("merchant_name") or row.get("description")):
        key = canonical_merchant_key(row.get("merchant_name") or "", row.get("description") or "")
    return party, key or None


def booked_replaces_pending(pending: dict, booked: dict) -> bool:
    """A183: whether a newly booked row is the settled version of a pending
    row. Never by id (the two ids differ): same direction, same amount to the
    penny, a settlement date from a day before to a few days after, and the
    same counterparty account (or, where neither side has one, the same
    merchant key). With no identity on either side there is no match, so a
    coincidental equal amount is never swallowed."""
    if pending.get("transaction_type", "debit") != booked.get("transaction_type", "debit"):
        return False
    p_amount, b_amount = _pennies(pending.get("amount")), _pennies(booked.get("amount"))
    if p_amount is None or p_amount != b_amount:
        return False
    p_date, b_date = pending.get("date"), booked.get("date")
    if not isinstance(p_date, datetime) or not isinstance(b_date, datetime):
        return False
    delta = (b_date.date() - p_date.date()).days
    if delta < -HANDOVER_DAYS_BEFORE or delta > HANDOVER_DAYS_AFTER:
        return False
    p_party, p_key = _identity(pending)
    b_party, b_key = _identity(booked)
    if p_party and b_party:
        return p_party == b_party
    return bool(p_key) and p_key == b_key


def drop_handed_over(pending_rows: list[dict], booked_rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split `pending_rows` into (still pending, handed over). Each booked row
    settles at most one pending row, so two identical pending payments are
    not both swallowed by one booked twin."""
    remaining = list(booked_rows)
    kept: list[dict] = []
    handed: list[dict] = []
    for pending in pending_rows:
        match = next((b for b in remaining if booked_replaces_pending(pending, b)), None)
        if match is None:
            kept.append(pending)
        else:
            remaining.remove(match)
            handed.append(pending)
    return kept, handed


async def remove_handed_over_pending(
    booked_rows: list[dict], account_id: str, user_id: str, provider: str,
) -> int:
    """Delete stored pending rows for this account that a newly booked row has
    replaced. For the sync where the booked walk succeeded but the pending walk
    failed, so the wholesale replace did not run. Returns the number removed."""
    if not booked_rows:
        return 0
    stored = await pending_transactions_col.find(
        {"account_id": account_id, "user_id": user_id, "provider": provider},
    ).to_list(None)
    _, handed = drop_handed_over(stored, booked_rows)
    ids = [row["_id"] for row in handed]
    if ids:
        await pending_transactions_col.delete_many({
            "_id": {"$in": ids}, "account_id": account_id, "user_id": user_id, "provider": provider,
        })
    return len(ids)


async def replace_pending_for_account(
    rows: list[dict], account_id: str, user_id: str, provider: str,
    account_currency: str | None = None,
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
        # Provider transaction IDs are scoped to their owner/account/provider.
        # Preserve the raw ID separately for exact booked handover matching.
        storage_id = "pending:" + hashlib.sha256(json.dumps(
            [user_id, account_id, provider, str(txn_id)], separators=(",", ":")
        ).encode()).hexdigest()
        keep_ids.append(storage_id)
        legacy = await pending_transactions_col.find_one({
            "_id": txn_id, "user_id": user_id, "account_id": account_id,
            "provider": provider,
        }, {"first_seen": 1})
        first_seen = (legacy or {}).get("first_seen") or now
        description = row.get("description") or ""
        merchant_name = row.get("merchant_name") or ""
        doc = {
            "source_transaction_id": txn_id,
            "account_id":       account_id,
            "user_id":          user_id,
            "date":             row.get("date") or now,
            "amount":           abs(float(row.get("amount") or 0)),
            # Some pending feeds omit currency.  The account is authoritative
            # in that case; GBP is only the legacy final fallback.
            "currency":         (row.get("currency") or account_currency or "GBP").upper(),
            "description":      description,
            "merchant_name":    merchant_name or None,
            "transaction_type": row.get("transaction_type", "debit"),
            "provider":         provider,
            "is_pending":       True,
            "merchant_key":     canonical_merchant_key(merchant_name, description),
            "last_seen":        now,
        }
        for key in ("party_name", "party_sort_code", "party_number"):
            if row.get(key):
                doc[key] = row[key]
        await pending_transactions_col.update_one(
            {"_id": storage_id, "user_id": user_id, "account_id": account_id, "provider": provider},
            {"$set": doc, "$setOnInsert": {"first_seen": first_seen}},
            upsert=True,
        )

    cutoff = now - timedelta(days=PENDING_TXN_MAX_AGE_DAYS)
    await pending_transactions_col.delete_many({
        "account_id": account_id, "user_id": user_id, "provider": provider,
        "$or": [
            {"_id": {"$nin": keep_ids}},
            {"first_seen": {"$lt": cutoff}},
        ],
    })
