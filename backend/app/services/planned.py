"""Auto-settlement of planned one-off expenses.

Matches a planned expense against real transactions using a ±4-day date window
and a ±10% / £2 minimum amount tolerance.  When a match is found the planned
doc is marked "settled"; if the window has closed with no match it is "expired".

Created-at floor: the lower bound of the date window is raised to the day the
planned doc was created (day granularity), so a debit that pre-dates the plan
creation is never used to settle it.  This prevents an existing unrelated
transaction from instantly settling a newly-created plan.
"""
from datetime import date, datetime, timedelta

from app.db.collections import (
    planned_expenses_col,
    transactions_col,
    yapily_transactions_col,
)
from app.services import response_cache


async def settle_planned_expenses(uid: str) -> bool:
    """Scan active planned expenses for `uid` and settle / expire them.

    Returns True if any document's status changed (so callers can decide
    whether to invalidate caches).
    """
    active_docs = await planned_expenses_col.find(
        {"user_id": uid, "status": "planned"}
    ).to_list(None)

    if not active_docs:
        return False

    # Collect already-claimed transaction IDs so we never double-assign.
    claimed_settled = await planned_expenses_col.distinct(
        "matched_txn_id",
        {"user_id": uid, "status": "settled", "matched_txn_id": {"$ne": None}},
    )
    claimed_this_run: set[str] = set()
    already_claimed: set[str] = {str(x) for x in claimed_settled if x}

    changed = False

    for doc in active_docs:
        doc_id = doc["_id"]
        pdate = doc["date"]
        if isinstance(pdate, datetime):
            pdate_d = pdate.date()
        else:
            pdate_d = pdate

        p_amount = float(doc["amount"])
        tolerance = max(2.0, 0.10 * p_amount)

        date_low = datetime(
            *(pdate_d - timedelta(days=4)).timetuple()[:3]
        )
        date_high = datetime(
            *(pdate_d + timedelta(days=5)).timetuple()[:3]
        )

        # Raise the lower bound to the plan's creation date so that debits
        # which pre-date the plan cannot settle it.
        created = doc.get("created_at")
        if created is not None:
            created_floor = datetime(created.year, created.month, created.day)
            date_low = max(date_low, created_floor)

        txn_query: dict = {
            "user_id":          uid,
            "transaction_type": "debit",
            "date":             {"$gte": date_low, "$lt": date_high},
        }
        if doc.get("account_id"):
            txn_query["account_id"] = doc["account_id"]

        # Search both transaction collections
        candidates = []
        for col in (transactions_col, yapily_transactions_col):
            txns = await col.find(
                txn_query,
                {"_id": 1, "amount": 1, "date": 1, "category": 1, "custom_category": 1},
            ).to_list(None)
            candidates.extend(txns)

        # A Transfer is the user's own money moving — it can never settle a planned expense.
        candidates = [
            t for t in candidates
            if (t.get("custom_category") or t.get("category")) != "Transfer"
        ]

        # Filter by amount tolerance and exclude already-claimed txns
        eligible = []
        for txn in candidates:
            txn_id_str = str(txn["_id"])
            if txn_id_str in already_claimed or txn_id_str in claimed_this_run:
                continue
            txn_amount = abs(float(txn.get("amount", 0)))
            if abs(txn_amount - p_amount) <= tolerance:
                eligible.append(txn)

        if eligible:
            # Pick best match: smallest date delta, then smallest amount delta
            def _sort_key(t):
                t_date = t["date"]
                if isinstance(t_date, datetime):
                    t_date = t_date.date()
                date_diff = abs((t_date - pdate_d).days)
                amt_diff  = abs(abs(float(t["amount"])) - p_amount)
                return (date_diff, amt_diff)

            best = sorted(eligible, key=_sort_key)[0]
            best_id_str = str(best["_id"])

            await planned_expenses_col.update_one(
                {"_id": doc_id},
                {"$set": {
                    "status":         "settled",
                    "matched_txn_id": best_id_str,
                    "settled_at":     datetime.now(),
                }},
            )
            claimed_this_run.add(best_id_str)
            changed = True

        elif date.today() > pdate_d + timedelta(days=4):
            # Window has closed with no match → expire
            await planned_expenses_col.update_one(
                {"_id": doc_id},
                {"$set": {
                    "status":     "expired",
                    "expired_at": datetime.now(),
                }},
            )
            changed = True

    if changed:
        response_cache.invalidate(uid)

    return changed
