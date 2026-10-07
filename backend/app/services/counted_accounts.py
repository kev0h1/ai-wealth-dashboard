"""G231: accounts a user has chosen not to count towards Safe to Spend.

One flag, `include_in_safe_to_spend`, lives on the account document (live
bank accounts, Yapily accounts and offline accounts alike). Absent means
counted, so every existing account keeps counting. Only spendability
changes: balances still show on Accounts and in net worth.

Every pooled or per-account calculation reads exclusions through this
module so the surfaces cannot disagree about which accounts count.
"""
from __future__ import annotations

import logging

from bson import ObjectId

from app.core.config import mask_email
from fastapi import HTTPException

from app.db.collections import (
    accounts_col, yapily_accounts_col, manual_accounts_col,
    allocations_col, commitments_col,
)

logger = logging.getLogger(__name__)

FLAG = "include_in_safe_to_spend"

_COLLECTIONS = (accounts_col, yapily_accounts_col, manual_accounts_col)


def is_excluded(doc: dict | None) -> bool:
    """True only when the flag is explicitly False (absent counts)."""
    return bool(doc) and doc.get(FLAG) is False


async def excluded_account_docs(uid: str) -> list[dict]:
    """Excluded account documents (id and name only), across all providers."""
    out: list[dict] = []
    seen: set[str] = set()
    for col in _COLLECTIONS:
        async for doc in col.find({"user_id": uid, FLAG: False}, {"name": 1}):
            sid = str(doc["_id"])
            if sid in seen:
                continue
            seen.add(sid)
            out.append({"id": sid, "name": doc.get("name") or "Account"})
    return out


async def excluded_account_ids(uid: str) -> set[str]:
    """Ids of excluded accounts. A failed read RAISES: callers decide how to
    fail closed (the cashflow builder flags `exclusions_unverified`, Safe to
    Spend re-derives the set from the account rows it already loaded)."""
    return {a["id"] for a in await excluded_account_docs(uid)}


def drop_excluded_items(resp: dict, excluded: set[str]) -> None:
    """Remove cashflow items that belong to an excluded account, in place.

    Bills and income paid from or into an excluded account are not part of
    the user's spendable picture. A movement whose destination is excluded
    stays a real outflow, so its destination is marked not spendable (the
    cached flag may pre-date the exclusion). Mirrored inbound legs credited
    to an excluded account are dropped.
    """
    if not excluded:
        return
    for key in ("upcoming_bills", "upcoming_income", "observed_pending_bills"):
        items = resp.get(key)
        if items:
            resp[key] = [i for i in items if str(i.get("account_id") or "") not in excluded]
    for bill in resp.get("upcoming_bills") or []:
        if str(bill.get("dest_account_id") or "") in excluded:
            bill["dest_account_spendable"] = False
    inflows = resp.get("internal_inflows")
    if inflows:
        resp["internal_inflows"] = [
            i for i in inflows if str(i.get("account_id") or "") not in excluded
        ]


def _try_oid(value: str):
    try:
        return ObjectId(value)
    except Exception:
        return value


async def find_account(uid: str, account_id: str):
    """(collection, doc) for an owned account, or (None, None)."""
    for col in _COLLECTIONS:
        for key in {account_id, _try_oid(account_id)}:
            doc = await col.find_one({"_id": key, "user_id": uid})
            if doc:
                return col, doc
    return None, None


async def items_paid_from(uid: str, account_id: str) -> int:
    """Upcoming items this pay period that this account pays: forecast bills
    and one-offs, plus active allocations and commitments whose source it is.
    """
    from app.core import timeutil
    from app.db.collections import cashflow_cache_col, preferences_col
    from app.services.income import get_confirmed_payday
    from app.services.pay_period import _next_payday

    count = 0
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if not cached:
        # Fail closed: with no forecast we cannot say what this account pays.
        raise HTTPException(422, "We cannot check this account's payments yet")
    if cached:
        from app.routers.analytics import _build_cashflow_response
        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        today = timeutil.user_today()
        confirmed = get_confirmed_payday(prefs, today)
        cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
        payday = confirmed[0] if confirmed else _next_payday(today, cfg)
        days_until = (payday - today).days
        resp = await _build_cashflow_response(cached, uid=uid, prefs=prefs)
        # Counted from the live upcoming list the walks use. A bill with no
        # account_id belongs to no account here, so it never blocks anyone.
        count += sum(
            1 for b in resp.get("upcoming_bills", [])
            if str(b.get("account_id") or "") == account_id
            and 0 <= int(b.get("days_away", 0)) < max(days_until, 1)
        )
    count += await allocations_col.count_documents(
        {"user_id": uid, "active": True, "source_account_id": account_id}
    )
    count += await commitments_col.count_documents(
        {"user_id": uid, "status": "active", "source_account_id": account_id}
    )
    return count


async def set_included(uid: str, account_id: str, include: bool) -> dict:
    """Set the flag on an owned account, refusing when excluding an account
    that pays something this pay period. Returns the new state."""
    col, doc = await find_account(uid, account_id)
    if doc is None:
        raise HTTPException(404, "Account not found")
    if not include:
        from app.services.account_kinds import is_credit_card_account
        if is_credit_card_account(doc) or doc.get("account_type") == "credit_card":
            raise HTTPException(422, "Cards do not count towards Safe to Spend.")
        n = await items_paid_from(uid, account_id)
        if n:
            noun = "item" if n == 1 else "items"
            raise HTTPException(
                422,
                f"This account pays {n} upcoming {noun} this period, so it has to count",
            )
    await col.update_one({"_id": doc["_id"], "user_id": uid}, {"$set": {FLAG: include}})
    return {"id": account_id, FLAG: include}
