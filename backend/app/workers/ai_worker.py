"""arq worker: AI categorisation tasks."""
import logging

from arq.connections import RedisSettings

from app.core.config import REDIS_URL
from app.db.collections import transactions_col
from app.services import data_version
from app.services.categorisation import apply_rules_bulk, categorise_others_bg
from app.routers.savings_insights import _refresh_savings_insights_for_user

logger = logging.getLogger(__name__)


async def task_auto_categorise(ctx, user_id: str):
    rules_fixed = await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    # Categorisation can change which categories/kinds transactions carry —
    # every cached response derived from them (Spend, Grow, Safe-to-Spend,
    # ...) must be exact-invalidated, not just left to the TTL.
    await data_version.bump(user_id)
    return {"rules_fixed": rules_fixed}


async def task_refresh_savings_insights(ctx, user_id: str):
    await _refresh_savings_insights_for_user(user_id)
    return {"ok": True}


async def task_categorise_all_users(ctx):
    user_ids = await transactions_col.distinct("user_id")
    for uid in user_ids:
        if uid:
            await apply_rules_bulk(uid, structural=True)
            await categorise_others_bg(uid)
            await data_version.bump(uid)
    return {"users": len(user_ids)}


class WorkerSettings:
    functions = [task_auto_categorise, task_refresh_savings_insights, task_categorise_all_users]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    max_jobs = 3
    job_timeout = 300
