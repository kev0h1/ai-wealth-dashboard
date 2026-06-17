"""arq worker: bank sync tasks."""
from arq import ArqRedis
from arq.connections import RedisSettings

from app.core.config import REDIS_URL
from app.db.collections import connections_col, yapily_consents_col, mono_connections_col
from app.services.truelayer_sync import sync_connection
from app.services.yapily_sync import sync_yapily_consent
from app.services.mono_sync import sync_mono_connection
from app.services.categorisation import apply_rules_bulk, categorise_others_bg


async def task_sync_truelayer(ctx, connection_id: str, user_id: str):
    ids = await sync_connection(connection_id, user_id)
    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    return {"synced": len(ids)}


async def task_sync_yapily(ctx, consent_token: str, user_id: str):
    await sync_yapily_consent(consent_token, user_id)
    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    return {"ok": True}


async def task_sync_mono(ctx, connection_id: str, user_id: str):
    ids = await sync_mono_connection(connection_id, user_id)
    return {"synced": len(ids)}


async def task_sync_all_users(ctx):
    all_conns = await connections_col.find({}).to_list(None)
    for conn in all_conns:
        uid = conn.get("user_id")
        if uid:
            await sync_connection(conn["_id"], uid)
            await apply_rules_bulk(uid, structural=True)
            await categorise_others_bg(uid)

    yapily_conns = await yapily_consents_col.find({"status": "AUTHORIZED"}).to_list(None)
    for yc in yapily_conns:
        await sync_yapily_consent(yc["_id"], yc["user_id"])

    mono_conns = await mono_connections_col.find({}).to_list(None)
    for mc in mono_conns:
        await sync_mono_connection(mc["_id"], mc["user_id"])

    return {"connections": len(all_conns)}


class WorkerSettings:
    functions = [task_sync_truelayer, task_sync_yapily, task_sync_mono, task_sync_all_users]
    redis_settings = RedisSettings.from_dsn(REDIS_URL)
    max_jobs = 5
    job_timeout = 600
