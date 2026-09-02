"""TrueLayer + Finexer webhook receivers.

TrueLayer Data API webhooks are not signed (unlike their Payments API). Security
is provided by HTTPS and a secret token embedded in the webhook URL. The token is
generated once and persisted to .webhook_secret.

Flow: TrueLayer POST → verify secret token → log to webhook_events → enqueue arq job → 200.

Finexer follows the same secret-in-URL pattern (token persisted to
.finexer_webhook_secret), but see the finexer_webhook() docstring below for why
its dispatch logic is deliberately event-type-agnostic.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, HTTPException, Request

from app.core.config import (
    FINEXER_WEBHOOK_SECRET,
    FINEXER_WEBHOOK_SIGNING_SECRET,
    REDIS_URL,
    TRUELAYER_WEBHOOK_SECRET,
)
from app.db.collections import connections_col, finexer_consents_col, webhook_events_col

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
        "provider": "truelayer",
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


def _resolve_finexer_consent_id(event: dict) -> str | None:
    """Tolerantly pull a consent id out of a Finexer webhook payload.

    Finexer's real envelope is Stripe-like: {"type": ..., "data": {"object":
    {...}}}. For consent lifecycle events the object *is* the consent
    (data.object.object == "consent", id in data.object.id). For
    transaction/account events the consent is referenced via
    data.object.consent (a string id, or a dict with an "id"). Older/simpler
    payload shapes we'd guessed at before Finexer's docs landed are kept as
    fallbacks: top-level consent_id/fx_consent/consent/id, and the same keys
    nested one level under "data" (including "consent" as a dict there too).
    Non-string / empty candidates are treated as absent rather than raising,
    so an unexpected payload shape degrades to "no consent_id" instead of a
    500.
    """

    def _clean(v):
        return v if isinstance(v, str) and v else None

    data = event.get("data")
    data = data if isinstance(data, dict) else {}
    obj = data.get("object")
    obj = obj if isinstance(obj, dict) else {}

    # 1. data.object IS the consent (consent.* lifecycle events).
    if obj.get("object") == "consent":
        val = _clean(obj.get("id"))
        if val:
            return val

    # 2. data.object.consent references a consent (transaction/account events).
    obj_consent = obj.get("consent")
    val = _clean(obj_consent) if isinstance(obj_consent, str) else None
    if val:
        return val
    if isinstance(obj_consent, dict):
        val = _clean(obj_consent.get("id"))
        if val:
            return val

    # 3. Tolerant fallbacks for older/simpler payload shapes.
    candidates = [
        _clean(event.get("consent_id")),
        _clean(event.get("fx_consent")),
        _clean(event.get("consent")) if isinstance(event.get("consent"), str) else None,
        _clean(event.get("id")),
        _clean(data.get("consent_id")),
        _clean(data.get("fx_consent")),
        _clean(data.get("consent")) if isinstance(data.get("consent"), str) else None,
        _clean(data.get("id")),
    ]
    top_consent = event.get("consent")
    if isinstance(top_consent, dict):
        candidates.append(_clean(top_consent.get("id")))
    nested_consent = data.get("consent")
    if isinstance(nested_consent, dict):
        candidates.append(_clean(nested_consent.get("id")))

    for c in candidates:
        if c:
            return c
    return None


def _verify_finexer_signature(raw_body: bytes, header_value: str | None) -> bool:
    """Verify Finexer's 'fx-signature' header: 't=<ISO8601 UTC>;s=<hex>',
    where the hex is HMAC-SHA256 over "<timestamp>.<raw request body bytes>"
    keyed with the dashboard-issued signing secret. A 5 minute timestamp
    tolerance guards against replay of a captured, still-validly-signed
    request. Always verify against the exact raw body bytes — never
    re-serialized JSON, since re-serialization can silently change byte
    content (key order, spacing, unicode escaping) and break the HMAC.
    """
    if not header_value:
        return False

    parts: dict[str, str] = {}
    for chunk in header_value.split(";"):
        if "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        parts[k.strip()] = v.strip()

    ts, sig = parts.get("t"), parts.get("s")
    if not ts or not sig:
        return False

    try:
        ts_iso = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
        event_time = datetime.fromisoformat(ts_iso)
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
    except ValueError:
        return False

    if abs((datetime.now(timezone.utc) - event_time).total_seconds()) > 300:
        return False

    expected = hmac.new(
        FINEXER_WEBHOOK_SIGNING_SECRET.encode(),
        f"{ts}.".encode() + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, sig)


@router.post("/finexer/{secret}", status_code=200)
async def finexer_webhook(secret: str, request: Request):
    """Finexer webhook receiver.

    Finexer's event catalogue isn't pinned down yet (unlike TrueLayer's well
    documented transaction.created/data_status.updated/connection.disconnected
    set), and task_sync_finexer is idempotent per-consent, so this receiver is
    deliberately event-type-agnostic: any event referencing a known consent
    triggers a sync, rather than switching on specific event-type strings the
    way the TrueLayer route above does. The only event-type-based branching
    here is a substring sniff for revoked/declined/expired/cancel/disconnect
    wording, which marks the consent revoked instead of enqueueing a sync.

    Security: two independent checks. (1) The URL path secret
    (FINEXER_WEBHOOK_SECRET), same scheme as the TrueLayer route above. (2)
    Once Finexer's dashboard-issued signing secret has been configured
    (FINEXER_WEBHOOK_SIGNING_SECRET), the 'fx-signature' request header must
    verify against the raw body (see _verify_finexer_signature). Before that
    secret is configured — e.g. immediately after this route is deployed but
    before the webhook is registered in Finexer's dashboard — signature
    verification is skipped and a warning is logged, so a fresh deploy
    doesn't 401 every delivery attempt during that window.

    Finexer retries every 3s and pauses the webhook after 10 consecutive
    non-2xx responses, so this handler stays fast (enqueue-and-return) and
    never raises for unknown-but-authentic event shapes — those degrade to a
    logged "skipped"/"ignored" status and a 200, not a 5xx.
    """
    if secret != FINEXER_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid token")

    body = await request.body()

    if FINEXER_WEBHOOK_SIGNING_SECRET:
        if not _verify_finexer_signature(body, request.headers.get("fx-signature")):
            raise HTTPException(status_code=401, detail="Invalid signature")
    else:
        logger.warning(
            "Finexer webhook signing secret not configured; skipping signature verification"
        )

    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("type") or event.get("event") or "unknown"
    consent_ref = _resolve_finexer_consent_id(event)
    now = datetime.now(timezone.utc)

    log_doc = {
        "received_at": now,
        "event_type": event_type,
        "consent_id": consent_ref,
        "payload": event,
        "status": "pending",
        "provider": "finexer",
    }
    result = await webhook_events_col.insert_one(log_doc)

    if not consent_ref:
        await webhook_events_col.update_one(
            {"_id": result.inserted_id},
            {"$set": {"status": "skipped", "skip_reason": "no consent_id"}},
        )
        return {"ok": True}

    doc = await finexer_consents_col.find_one({"_id": consent_ref})
    if not doc:
        await webhook_events_col.update_one(
            {"_id": result.inserted_id},
            {"$set": {"status": "skipped", "skip_reason": "consent_not_found"}},
        )
        return {"ok": True}

    lowered = event_type.lower()
    if any(w in lowered for w in ("revoked", "declined", "expired", "cancel", "disconnect")):
        await finexer_consents_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "revoked", "revoked_at": datetime.utcnow()}},
        )
        await webhook_events_col.update_one(
            {"_id": result.inserted_id}, {"$set": {"status": "noted"}}
        )
        return {"ok": True}

    user_id = doc.get("user_id")
    if not user_id:
        await webhook_events_col.update_one(
            {"_id": result.inserted_id},
            {"$set": {"status": "skipped", "skip_reason": "no user_id"}},
        )
        return {"ok": True}

    await _enqueue("task_sync_finexer", consent_id=str(doc["_id"]), user_id=user_id)
    await webhook_events_col.update_one(
        {"_id": result.inserted_id},
        {"$set": {"status": "queued", "user_id": user_id, "queued_at": now,
                  "resolved_consent_id": str(doc["_id"])}},
    )
    logger.info("Enqueued sync for consent %s (user %s) via webhook %s",
                doc["_id"], user_id, event_type)

    return {"ok": True}
