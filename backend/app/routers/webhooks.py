"""TrueLayer webhook receiver.

TrueLayer Data API webhooks are not signed (unlike their Payments API). Security
is provided by HTTPS and a secret token embedded in the webhook URL. The token is
generated once and persisted to .webhook_secret.

Flow: TrueLayer POST → verify secret token → log to webhook_events → enqueue arq job → 200.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, HTTPException, Request

from app.core.config import REDIS_URL, TRUELAYER_WEBHOOK_SECRET
from app.db.collections import connections_col, webhook_events_col

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def _enqueue(task: str, **kwargs):
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    await pool.enqueue_job(task, **kwargs)
    await pool.aclose()


@router.post("/truelayer/{secret}", status_code=200)
async def truelayer_webhook(secret: str, request: Request):
    if secret != TRUELAYER_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")

    body = await request.body()

    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("type", "unknown")
    # TrueLayer identifies connections by their credentials_id; older/other
    # payload shapes use connection_id. Accept either.
    connection_ref = (
        event.get("credentials_id")
        or event.get("connection_id")
        or (event.get("results") or [{}])[0].get("credentials_id")
        or (event.get("results") or [{}])[0].get("connection_id")
    )
    now = datetime.now(timezone.utc)

    log_doc = {
        "received_at": now,
        "event_type": event_type,
        "connection_id": connection_ref,
        "payload": event,
        "status": "pending",
    }
    result = await webhook_events_col.insert_one(log_doc)

    if event_type in ("transaction.created", "transaction.updated", "data_status.updated"):
        if not connection_ref:
            await webhook_events_col.update_one(
                {"_id": result.inserted_id},
                {"$set": {"status": "skipped", "skip_reason": "no connection_id"}},
            )
            return {"ok": True}

        conn = await connections_col.find_one(
            {"$or": [{"_id": connection_ref}, {"credentials_id": connection_ref}]},
            {"user_id": 1},
        )
        if not conn:
            await webhook_events_col.update_one(
                {"_id": result.inserted_id},
                {"$set": {"status": "skipped", "skip_reason": "connection_not_found"}},
            )
            return {"ok": True}

        user_id = conn["user_id"]
        await _enqueue("task_sync_truelayer", connection_id=str(conn["_id"]), user_id=user_id)
        await webhook_events_col.update_one(
            {"_id": result.inserted_id},
            {"$set": {"status": "queued", "user_id": user_id, "queued_at": now,
                      "resolved_connection_id": str(conn["_id"])}},
        )
        logger.info("Enqueued sync for connection %s (user %s) via webhook %s",
                    conn["_id"], user_id, event_type)

    elif event_type == "connection.disconnected":
        await webhook_events_col.update_one(
            {"_id": result.inserted_id}, {"$set": {"status": "noted"}}
        )

    else:
        logger.warning("Unhandled webhook type: %s payload: %s", event_type, event)
        await webhook_events_col.update_one(
            {"_id": result.inserted_id}, {"$set": {"status": "ignored"}}
        )

    return {"ok": True}
