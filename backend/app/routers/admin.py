"""Admin-only endpoints (bot sync + one-time migrations)."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL
from app.db.collections import connections_col, accounts_col, transactions_col
from app.services.truelayer_sync import sync_connection
from app.services.categorisation import apply_rules_bulk, categorise_others_bg
from app.services import data_version
import asyncio

router = APIRouter(tags=["admin"])

# Retained references for this router's fire-and-forget post-sync tasks —
# same rationale as app.routers.accounts._background_tasks: a bare
# `asyncio.create_task(...)` with nothing holding the result can be
# garbage-collected mid-flight.
_background_tasks: set = set()


def _fire_and_forget(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


@router.post("/admin/sync-all")
async def admin_sync_all(user: dict = Depends(current_user)):
    """A28: bot credential with `admin:sync` scope (app.core.bot_credentials),
    or Kevin's own session as a break-glass path — same bot-or-owner pairing
    as app.routers.admin_usage._require_admin, so this bulk, all-users
    resync is never permanently locked away from its only human operator
    even if every bot credential were revoked or the credential store were
    unreachable. Never any OTHER signed-in user: this iterates every
    connection for every account, not the caller's own."""
    is_bot = user.get("name") == "Bot"
    is_owner = (user.get("email") or "").strip().lower() == PRIMARY_EMAIL
    if not (is_bot or is_owner):
        raise HTTPException(403, "Forbidden")
    all_conns      = await connections_col.find({}).to_list(None)
    total_accounts = 0
    user_ids: set  = set()
    for conn in all_conns:
        uid = conn.get("user_id")
        if not uid:
            continue
        ids, _new = await sync_connection(conn["_id"], uid)
        total_accounts += len(ids)
        user_ids.add(uid)

    async def _post_sync(u: str):
        await apply_rules_bulk(u, structural=True)
        await categorise_others_bg(u)
        # admin_sync_all calls sync_connection directly (inline) rather than
        # enqueuing task_sync_truelayer, so it doesn't get that task's own
        # warm_user()-driven bump for free — bump explicitly here instead.
        await data_version.bump(u)

    for uid in user_ids:
        _fire_and_forget(_post_sync(uid))
    return {"connections": len(all_conns), "total_accounts": total_accounts, "users": len(user_ids)}


@router.post("/admin/fix-card-transactions")
async def fix_card_transactions(user: dict = Depends(current_user)):
    uid    = user["email"]
    cc_ids = [d["_id"] async for d in accounts_col.find({"user_id": uid, "type": "credit_card"}, {"_id": 1})]
    if not cc_ids:
        return {"message": "No credit card accounts found", "fixed": 0}
    await transactions_col.update_many(
        {"account_id": {"$in": cc_ids}, "transaction_type": "credit"},
        {"$set": {"transaction_type": "_fixing", "category": None}},
    )
    await transactions_col.update_many(
        {"account_id": {"$in": cc_ids}, "transaction_type": "debit"},
        {"$set": {"transaction_type": "credit", "category": None}},
    )
    result = await transactions_col.update_many(
        {"account_id": {"$in": cc_ids}, "transaction_type": "_fixing"},
        {"$set": {"transaction_type": "debit"}},
    )
    return {"message": "Card transactions fixed, run auto-categorise next", "fixed": result.modified_count}
