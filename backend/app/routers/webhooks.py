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

import hmac
import json
import logging
from datetime import datetime, timedelta, timezone

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from app.core.config import (
    FINEXER_WEBHOOK_SECRET,
    FINEXER_WEBHOOK_SIGNING_SECRET,
    REDIS_URL,
    TRUELAYER_WEBHOOK_SECRET,
)
from app.core import config as _cfg
from app.db.collections import connections_col, finexer_consents_col, webhook_events_col
from app.services import finexer_webhooks as fxw

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# A67: the TrueLayer receiver lives on its OWN router so `app.main` can
# mount the Finexer one (production's only provider) without it. Splitting
# the module in two was the alternative and would have been worse: the two
# receivers share `_enqueue`, the `webhook_events_col` logging shape and
# this file's whole explanation of the secret-in-URL scheme, and keeping
# them side by side is what makes the deliberate difference between them
# (Finexer additionally verifies an HMAC signature; TrueLayer's Data API
# sends none) readable. See `app.core.config.TRUELAYER_ENABLED`.
truelayer_router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def _enqueue(task: str, **kwargs):
    pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
    await pool.enqueue_job(task, **kwargs)
    await pool.aclose()


@truelayer_router.post("/truelayer/{secret}", status_code=200)
async def truelayer_webhook(secret: str, request: Request):
    if not hmac.compare_digest(secret.encode("utf-8"), TRUELAYER_WEBHOOK_SECRET.encode("utf-8")):
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


def _verify_finexer_signature(raw_body: bytes, headers) -> bool:
    """Thin wrapper over app.services.finexer_webhooks.verify_signature with
    the configured signing secret (read from this module's global so tests can
    patch it). Fails closed when no secret is set."""
    return fxw.verify_signature(raw_body, headers, secret=FINEXER_WEBHOOK_SIGNING_SECRET)


async def _read_body_bounded(request: Request, limit: int) -> bytes:
    """Read the request body but refuse anything over `limit` bytes, without
    buffering an oversized body: Content-Length is checked first, then the
    stream is consumed chunk by chunk and abandoned the moment it overruns."""
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > limit:
                raise HTTPException(status_code=413, detail="Payload too large")
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad request")
    stream = getattr(request, "stream", None)
    if stream is None:
        body = await request.body()
        if len(body) > limit:
            raise HTTPException(status_code=413, detail="Payload too large")
        return body
    chunks: list[bytes] = []
    total = 0
    async for chunk in stream():
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=413, detail="Payload too large")
        chunks.append(chunk)
    return b"".join(chunks)


async def _claim_debounce(consent_id: str, window_seconds: int) -> bool:
    """True when this event is the first for the consent in the window (the
    caller should enqueue); False when it coalesces into an already-pending
    sync. Redis SET NX EX. Fails OPEN (True): task_sync_finexer is idempotent
    per consent, so an extra sync is cheap, a lost one is not."""
    try:
        pool = await create_pool(RedisSettings.from_dsn(REDIS_URL))
        try:
            return bool(await pool.set(f"fx_webhook_debounce:{consent_id}", "1", nx=True, ex=max(1, window_seconds)))
        finally:
            await pool.aclose()
    except Exception:
        logger.exception("Finexer webhook debounce unavailable; enqueueing without coalescing")
        return True


async def _enqueue_sync_debounced(consent_id: str, user_id: str) -> bool:
    """Coalesce a burst for one consent into a single task_sync_finexer,
    deferred by the debounce window so the sync runs after the burst (trailing
    edge) and sees all of it. Returns True when a job was enqueued."""
    window = _cfg.FINEXER_WEBHOOK_DEBOUNCE_SECONDS
    if window > 0 and not await _claim_debounce(consent_id, window):
        await fxw.bump_daily_counters(webhook_events_coalesced=1)
        return False
    if window > 0:
        await _enqueue("task_sync_finexer", consent_id=consent_id, user_id=user_id,
                       _defer_by=timedelta(seconds=window))
    else:
        await _enqueue("task_sync_finexer", consent_id=consent_id, user_id=user_id)
    await fxw.bump_daily_counters(webhook_syncs_enqueued=1)
    return True


@router.post("/finexer/{secret}", status_code=200)
async def finexer_webhook(secret: str, request: Request):
    """Finexer webhook receiver (A167 hardened).

    Gates, in order, all failing with a generic 4xx that says nothing about
    which check failed: (1) URL path secret, constant time; (2) body size
    bound, checked before the body is read; (3) when
    FINEXER_WEBHOOK_SIGNING_SECRET is set the signature is MANDATORY and fails
    closed (scheme, header and tolerance come from config, see
    app.services.finexer_webhooks); when it is unset the path secret is the
    only gate and startup logs that once. Replay protection is the signed
    timestamp tolerance plus idempotency on the event id (unique index,
    insert-if-absent).

    Dispatch is keyed on the event type through the config-driven action
    table (finexer_webhooks.DEFAULT_EVENT_ACTIONS plus
    FINEXER_WEBHOOK_EVENT_ACTIONS). Unknown types are recorded and ignored;
    only the type string is ever logged, never the payload. Syncs for one
    consent are debounced into one task_sync_finexer.

    Finexer is understood to retry quickly and pause the webhook after 10
    consecutive non-2xx responses (UNVERIFIED, see docs/ops/FINEXER_WEBHOOKS.md),
    so every authentic delivery gets a 200 except a genuine enqueue failure,
    which releases its event id (so the retry is processed) and returns 503.
    """
    if not hmac.compare_digest(secret.encode("utf-8"), FINEXER_WEBHOOK_SECRET.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid token")

    body = await _read_body_bounded(request, _cfg.FINEXER_WEBHOOK_MAX_BODY_BYTES)

    if FINEXER_WEBHOOK_SIGNING_SECRET:
        if not _verify_finexer_signature(body, request.headers):
            raise HTTPException(status_code=401, detail="Invalid token")

    try:
        event = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Invalid JSON")
    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = fxw.extract_event_type(event)
    event_id = fxw.extract_event_id(event)
    consent_ref = _resolve_finexer_consent_id(event)
    now = datetime.now(timezone.utc)  # naive-ok: stored as UTC, tz-aware on write

    log_doc = {
        "received_at": now,
        "event_type": event_type,
        "consent_id": consent_ref,
        "payload": event,
        "status": "pending",
        "provider": "finexer",
    }
    if event_id:
        log_doc["event_id"] = event_id
    try:
        result = await webhook_events_col.insert_one(log_doc)
    except DuplicateKeyError:
        # Same event id already recorded: a retry or a replay. Acknowledge so
        # Finexer stops retrying, do nothing else.
        logger.info("Finexer webhook duplicate event ignored (type %s)", fxw.safe_type_for_log(event_type))
        return {"ok": True}
    await fxw.bump_daily_counters(webhook_events=1)

    async def _set(fields: dict):
        await webhook_events_col.update_one({"_id": result.inserted_id}, {"$set": fields})

    if not consent_ref:
        await _set({"status": "skipped", "skip_reason": "no consent_id"})
        return {"ok": True}

    doc = await finexer_consents_col.find_one({"_id": consent_ref})
    if not doc:
        await _set({"status": "skipped", "skip_reason": "consent_not_found"})
        return {"ok": True}

    # Freshness signal for /ops/health and the polling fallback: any authentic
    # event for a known consent counts, whatever its type.
    await finexer_consents_col.update_one(
        {"_id": doc["_id"]},
        {"$set": {"last_webhook_at": datetime.utcnow()}},  # naive-ok: matches last_synced convention
    )

    action = fxw.resolve_action(event_type)
    await _set({"action": action})

    if action == fxw.ACTION_UNKNOWN:
        logger.info("Finexer webhook type not mapped, recorded and ignored: %s",
                    fxw.safe_type_for_log(event_type))
        await _set({"status": "ignored"})
        return {"ok": True}

    if action == fxw.ACTION_CONSENT_REVOKED:
        await finexer_consents_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"status": "revoked", "revoked_at": datetime.utcnow()}},  # naive-ok: matches last_synced convention
        )
        await _set({"status": "noted"})
        return {"ok": True}

    if action == fxw.ACTION_CONSENT_EXPIRING:
        await finexer_consents_col.update_one(
            {"_id": doc["_id"]},
            {"$set": {"webhook_expiring_at": datetime.utcnow()}},  # naive-ok: matches last_synced convention
        )
        await _set({"status": "noted"})
        return {"ok": True}

    # ACTION_SYNC_CONSENT / ACTION_CONSENT_AUTHORISED
    user_id = doc.get("user_id")
    if not user_id:
        await _set({"status": "skipped", "skip_reason": "no user_id"})
        return {"ok": True}

    try:
        enqueued = await _enqueue_sync_debounced(str(doc["_id"]), user_id)
    except Exception:
        logger.exception("Finexer webhook: enqueue failed (type %s)", fxw.safe_type_for_log(event_type))
        # Release the event id so Finexer's retry is processed, not deduped.
        await webhook_events_col.update_one(
            {"_id": result.inserted_id},
            {"$set": {"status": "failed"}, "$unset": {"event_id": ""}},
        )
        raise HTTPException(status_code=503, detail="Temporarily unavailable")

    if enqueued:
        await _set({"status": "queued", "user_id": user_id, "queued_at": now,
                    "resolved_consent_id": str(doc["_id"])})
        logger.info("Enqueued Finexer sync via webhook (type %s)", fxw.safe_type_for_log(event_type))
    else:
        await _set({"status": "coalesced", "user_id": user_id,
                    "resolved_consent_id": str(doc["_id"])})

    return {"ok": True}
