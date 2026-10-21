"""E9: the owner-only "recent webhooks" read model behind GET /ops/webhooks/recent.

Merges the last 50 events across the two stores that hold inbound provider
notifications and counts the last 24 hours per provider and outcome:

  webhook_events_col  Finexer and TrueLayer (30-day TTL), sorted on received_at
                      using the existing `webhook_ttl` index (received_at_1).
  billing_events_col  Stripe, Apple and Google Play ledger. Its only index is
                      the unique event_id, so received_at is sorted in memory
                      (top 50 of a small ledger, no index is created for this).

Outcome mapping (every row carries exactly one of queued, coalesced, noted,
ignored, skipped, failed, processed):

  webhook_events.status  queued, coalesced, noted, ignored, skipped, failed
                         pass through; "pending" (received, not yet resolved)
                         is shown as queued; any other value is shown as noted.
  billing_events         processed_at unset and received over 15 minutes ago
                         (a claim that never finished) -> failed ("unfinished");
                         processed_at unset and newer -> queued;
                         processed_at set, result.handled false -> ignored
                         (acknowledged, nothing to do);
                         processed_at set otherwise -> processed.

`reason` is only set for skipped and failed and only ever one of the short
codes in REASON_CODES, never stored free text (billing results carry free-text
reasons and are never read for this).

Privacy: both reads use a Mongo projection that lists only the fields used
below. payload, consent_id, connection ids, user ids, account ids, emails,
amounts, URLs and order ids are never requested from Mongo, so they cannot be
returned. Event types come from a per-provider catalogue; anything else is
reported as "other" so a type string can never carry an identifier out.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.core.timeutil import as_utc

RECENT_LIMIT = 50
COUNT_SCAN_CAP = 5000
STUCK_AFTER = timedelta(minutes=15)

OUTCOMES = ("queued", "coalesced", "noted", "ignored", "skipped", "failed", "processed")
WEBHOOK_PROVIDERS = ("finexer", "truelayer")
BILLING_PROVIDERS = ("stripe", "apple", "google")

# The only fields requested from Mongo. Nothing else is ever read.
WEBHOOK_PROJECTION = {"_id": 0, "received_at": 1, "provider": 1, "event_type": 1, "status": 1, "skip_reason": 1}
BILLING_PROJECTION = {"_id": 0, "received_at": 1, "provider": 1, "type": 1, "processed_at": 1, "result.handled": 1}

# Stored skip_reason value -> short display code. Anything else becomes "other".
REASON_CODES = {
    "unresolved": "unresolved",
    "consent_not_found": "consent_not_found",
    "no user_id": "no_user",
    "no connection_id": "no_connection",
    "connection_not_found": "connection_not_found",
}

EVENT_TYPES: dict[str, frozenset[str]] = {
    "finexer": frozenset({
        "bank_account.created", "bank_account.updated", "bank_account.synced", "bank_account.deleted",
        "consent.authorized", "consent.canceled", "consent.expired", "consent.created",
    }),
    "truelayer": frozenset({
        "transaction.created", "transaction.updated", "data_status.updated", "connection.disconnected",
    }),
    "stripe": frozenset({
        "checkout.session.completed", "checkout.session.expired", "customer.subscription.created",
        "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused",
        "customer.subscription.resumed", "customer.subscription.trial_will_end", "invoice.paid",
        "invoice.payment_succeeded", "invoice.payment_failed", "charge.refunded",
        "payment_intent.succeeded", "payment_intent.payment_failed",
    }),
    "apple": frozenset({
        "SUBSCRIBED", "DID_RENEW", "DID_FAIL_TO_RENEW", "DID_CHANGE_RENEWAL_STATUS", "DID_CHANGE_RENEWAL_PREF",
        "EXPIRED", "GRACE_PERIOD_EXPIRED", "OFFER_REDEEMED", "PRICE_INCREASE", "REFUND", "REFUND_DECLINED",
        "REFUND_REVERSED", "RENEWAL_EXTENDED", "RENEWAL_EXTENSION", "REVOKE", "ONE_TIME_CHARGE", "TEST",
        "CONSUMPTION_REQUEST",
    }),
    "google": frozenset({
        "subscriptionNotification", "oneTimeProductNotification", "voidedPurchaseNotification",
        "testNotification",
    }),
}


def _event_type(provider: str, raw: Any) -> str:
    if isinstance(raw, str):
        key = raw.strip().lower() if provider in ("finexer", "truelayer") else raw.strip()
        if key in EVENT_TYPES[provider]:
            return key
    return "other"


def _iso(dt: Optional[datetime]) -> Optional[str]:
    u = as_utc(dt) if isinstance(dt, datetime) else None
    return u.isoformat() if u else None


def _webhook_outcome(doc: dict) -> tuple[str, Optional[str]]:
    status = doc.get("status")
    if status == "pending":
        return "queued", None
    if status in ("queued", "coalesced", "noted", "ignored", "processed"):
        return status, None
    if status == "skipped":
        return "skipped", REASON_CODES.get(doc.get("skip_reason"), "other")
    if status == "failed":
        return "failed", "enqueue_failed"
    return "noted", None


def _billing_outcome(doc: dict, now: datetime) -> tuple[str, Optional[str]]:
    if not doc.get("processed_at"):
        received = as_utc(doc.get("received_at")) if isinstance(doc.get("received_at"), datetime) else None
        if received is not None and now - received > STUCK_AFTER:
            return "failed", "unfinished"
        return "queued", None
    handled = (doc.get("result") or {}).get("handled") if isinstance(doc.get("result"), dict) else None
    if handled is False:
        return "ignored", None
    return "processed", None


def _row(doc: dict, source: str, now: datetime) -> Optional[dict]:
    received = doc.get("received_at")
    iso = _iso(received)
    if iso is None:
        return None
    if source == "webhook":
        provider = doc.get("provider") or "truelayer"
        if provider not in WEBHOOK_PROVIDERS:
            return None
        outcome, reason = _webhook_outcome(doc)
        etype = _event_type(provider, doc.get("event_type"))
    else:
        provider = doc.get("provider") or "stripe"
        if provider not in BILLING_PROVIDERS:
            return None
        outcome, reason = _billing_outcome(doc, now)
        etype = _event_type(provider, doc.get("type"))
    row = {"received_at": iso, "provider": provider, "event_type": etype, "outcome": outcome}
    if reason and outcome in ("skipped", "failed"):
        row["reason"] = reason
    return row


async def _read(col, query: dict, projection: dict, limit: int, sort: bool) -> list[dict]:
    cursor = col.find(query, projection)
    if sort:
        cursor = cursor.sort("received_at", -1)
    return [d async for d in cursor.limit(limit)]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)  # naive-ok: aware instant, 24 h lookback window and stuck-claim age


async def recent_webhooks(now: Optional[datetime] = None) -> dict:
    from app.db.collections import billing_events_col, webhook_events_col

    now = as_utc(now) if now else _utcnow()
    cutoff = now - timedelta(hours=24)
    # Mongo returns naive UTC datetimes; compare like with like.
    cutoff_naive = cutoff.replace(tzinfo=None)

    rows: list[dict] = []
    for col, projection, source, sort_limit in (
        (webhook_events_col, WEBHOOK_PROJECTION, "webhook", RECENT_LIMIT),
        (billing_events_col, BILLING_PROJECTION, "billing", RECENT_LIMIT),
    ):
        for d in await _read(col, {}, projection, sort_limit, sort=True):
            r = _row(d, source, now)
            if r:
                rows.append(r)
    rows.sort(key=lambda r: r["received_at"], reverse=True)
    recent = rows[:RECENT_LIMIT]

    counts: dict[str, dict[str, int]] = {}
    truncated = False
    for col, projection, source in (
        (webhook_events_col, WEBHOOK_PROJECTION, "webhook"),
        (billing_events_col, BILLING_PROJECTION, "billing"),
    ):
        docs = await _read(col, {"received_at": {"$gte": cutoff_naive}}, projection, COUNT_SCAN_CAP, sort=False)
        truncated = truncated or len(docs) >= COUNT_SCAN_CAP
        for d in docs:
            r = _row(d, source, now)
            if r:
                bucket = counts.setdefault(r["provider"], {})
                bucket[r["outcome"]] = bucket.get(r["outcome"], 0) + 1
    return {"recent_webhooks": recent, "webhook_counts_24h": counts, "counts_truncated": truncated}
