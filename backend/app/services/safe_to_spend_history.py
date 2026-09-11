"""B18: daily Safe-to-Spend history snapshot.

Nothing in this codebase records the Safe-to-Spend figure's own components
over time — G35's investigation into a £64->£276 jump (Kevin, 2026-09-10)
could not reconstruct which of the figure's inputs actually moved that day
because no point-in-time record of them survives; only the LATEST value of
each input (the current cashflow cache, the current recurring-series
verdicts) is ever stored. This module is the fix: one daily snapshot per
user of the exact components `compute_safe_to_spend` composes the headline
figure from, so a future "what changed and why" read (a diff service, a
Penny/MCP tool, a Home-card line — deliberately NOT built here, see B18's
backlog note for what that follow-up needs) has real history to work from.

Storage: `safe_to_spend_history_col`, NOT `needle_history_col` — see that
collection's own docstring in app/db/collections.py for why (an
incompatible existing schema/cadence/purpose, with real non-zero data
already depending on it).

Deterministic only: every field here is copied straight from
`compute_safe_to_spend`'s own response, never re-derived or estimated by
this module.
"""
import logging
from datetime import date as _date, datetime, timezone

from app.db.collections import cashflow_cache_col, safe_to_spend_history_col

logger = logging.getLogger(__name__)


def build_snapshot_doc(uid: str, day: _date, computed_at: datetime, result: dict) -> dict:
    """Pure: turn one `compute_safe_to_spend` response into a storable
    snapshot doc. Pulled out of `run_safe_to_spend_snapshot` so the shape
    is unit-testable without touching Mongo.

    `result` must be a `status == "ok"` response — callers filter out
    `insufficient_data` (no cashflow cache yet) before calling this, since
    there is nothing meaningful to snapshot for those.
    """
    bills = [
        {
            "name": b.get("name"),
            "amount": b.get("amount"),
            "days_away": b.get("days_away"),
        }
        for b in (result.get("window_bills") or [])
    ]
    return {
        "_id": f"{uid}:{day.isoformat()}",
        "user_id": uid,
        "date": day.isoformat(),
        "computed_at": computed_at,
        "next_payday": result.get("next_payday"),
        "days_until_payday": result.get("days_until_payday"),
        "safe_to_spend": result.get("safe_to_spend"),
        "safe_to_spend_cash": result.get("safe_to_spend_cash"),
        "state": result.get("state"),
        "spendable_now": result.get("spendable_now"),
        "bills_total": result.get("bills_total"),
        "income_before_payday": result.get("income_before_payday"),
        "lowest_projected_balance": result.get("lowest_projected_balance"),
        "buffer": result.get("buffer"),
        "commitments_reserved": result.get("commitments_reserved"),
        "allocations_reserved": result.get("allocations_reserved"),
        "card_growth_total": result.get("card_growth_total"),
        "card_growth_reserved": result.get("card_growth_reserved"),
        # Bill-list IDENTITY, not full transaction detail — enough for a
        # future diff to name which bill appeared/disappeared between two
        # snapshots, not just that bills_total moved.
        "bills": bills,
    }


async def run_safe_to_spend_snapshot() -> dict:
    """Fan out over every user with a cashflow cache (the same gate
    `compute_safe_to_spend` itself uses to decide it has anything to say —
    a user with no cache yet would only ever get `insufficient_data`, not
    worth a snapshot row) and upsert today's snapshot for each.

    One doc per user per calendar day: upserts on `_id`, so a worker retry
    or a second run the same day overwrites rather than duplicates. Every
    user is independent and failure-isolated — one user's snapshot failing
    never blocks another's, matching the fan-out pattern in
    `app.services.retention.run_retention_sweep` and
    `app.workers.ai_worker.task_categorise_all_users`.
    """
    from app.routers.analytics import compute_safe_to_spend

    uids = await cashflow_cache_col.distinct("_id")
    today = _date.today()
    now = datetime.now(timezone.utc)

    written = 0
    skipped = 0
    failed = 0
    for uid in uids:
        if not uid:
            continue
        try:
            result = await compute_safe_to_spend(uid)
            if result.get("status") != "ok":
                skipped += 1
                continue
            doc = build_snapshot_doc(uid, today, now, result)
            await safe_to_spend_history_col.update_one(
                {"_id": doc["_id"]}, {"$set": doc}, upsert=True,
            )
            written += 1
        except Exception:
            logger.exception("safe-to-spend snapshot failed for %s", uid)
            failed += 1

    summary = {"users": len(uids), "written": written, "skipped": skipped, "failed": failed}
    logger.info("safe-to-spend snapshot: %s", summary)
    return summary
