"""Provider-neutral store-subscription seam (C21 Apple, shared with C24 Google).

This is the one place app-store billing writes subscriptions_col and the pack
collections. Apple's receiver (app.services.apple_billing) and Google's
(C24) do their own verification and payload parsing, then call these
functions, which know nothing about either store's wire format. It is the
store-side twin of the Stripe handlers in app.services.billing and follows
the same doctrine:

  * one subscriptions_col document per (user, provider), provider in
    app.core.subscription.SUBSCRIPTION_PROVIDERS; this module only ever reads
    or writes the document for the provider it is given, so a store event can
    never touch a Stripe document or the other store's (section 2);
  * entitlement is derived, never trusted from a client: only a verified
    notification or a verified signed transaction reaches here;
  * fail closed: an unknown product, an unresolvable user or an out-of-order
    event changes nothing and reports why;
  * idempotent: replaying any call leaves the same state, and consumable
    grants are deduplicated on the store transaction id;
  * no user data in logs: log lines carry ids of events and products, never
    an email or a user id. Results returned to callers (and stored in the
    billing_events_col ledger) may carry the uid, because section 8 needs
    "how many refunds has this user made" to be a ledger query.

Event ordering: stores do not deliver in order. Every state-changing call
takes `signed_at`, the store's own signing instant for the event, and is
ignored as stale when older than the newest event already applied to that
document (`last_signed_at`).
"""
import logging
from datetime import datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

from app.core.subscription import STORE_SUBSCRIPTION_PROVIDERS, grant_pack

logger = logging.getLogger(__name__)

LIVE_STATUSES = ("active", "trialing", "past_due")


class StorePurchaseRefused(Exception):
    """A store purchase must not start for this user (an active web
    subscription already covers them). Carries a user-facing sentence."""


def _check_provider(provider: str) -> None:
    if provider not in STORE_SUBSCRIPTION_PROVIDERS:
        raise ValueError(f"not a store provider: {provider!r}")


def store_doc_filter(uid: str, provider: str) -> dict:
    return {"user_id": uid, "provider": provider}


def _now() -> datetime:
    return datetime.now(timezone.utc)  # naive-ok: aware persisted audit instant


# ── Event ledger (replay protection) ─────────────────────────────────────────

async def claim_event(provider: str, event_id: str, event_type: str, *, extra: dict | None = None) -> tuple[str, dict | None]:
    """Claim a store notification for processing in billing_events_col, the
    same ledger Stripe uses, keyed "<provider>:<event_id>" so a store id can
    never collide with a Stripe event id. The insert is atomic against the
    unique index on event_id, so two concurrent deliveries cannot both be
    "new".

    Returns ("new", None) when this caller owns processing, ("replay", doc)
    when it was already processed (answer with the stored result, do
    nothing), or ("retry", doc) when an earlier attempt claimed it but never
    finished (the handlers are idempotent, so processing again is safe)."""
    from app.db.collections import billing_events_col

    ledger_id = f"{provider}:{event_id}"
    doc = {
        "event_id": ledger_id, "provider": provider, "type": event_type,
        "received_at": _now(), "processed_at": None, "result": None, **(extra or {}),
    }
    try:
        await billing_events_col.insert_one(doc)
        return "new", None
    except DuplicateKeyError:
        existing = await billing_events_col.find_one({"event_id": ledger_id})
        if existing and existing.get("processed_at"):
            return "replay", existing
        return "retry", existing


async def finish_event(provider: str, event_id: str, result: dict) -> None:
    from app.db.collections import billing_events_col

    await billing_events_col.update_one(
        {"event_id": f"{provider}:{event_id}"},
        {"$set": {"processed_at": _now(), "result": result}},
    )


# ── Purchase gate ────────────────────────────────────────────────────────────

async def validate_store_purchase(uid: str) -> None:
    """Mirror image of billing._validate_subscription_checkout (C13 section
    2.3): refuse to start an in-app purchase while an active Stripe
    subscription exists, so nobody pays twice for one entitlement. The client
    asks before showing a buy button. It cannot stop a purchase the store has
    already taken (the system purchase sheet runs before this app hears of
    it), so a completed purchase is still granted and flagged, see
    upsert_store_subscription."""
    from app.db.collections import subscriptions_col

    doc = await subscriptions_col.find_one({"user_id": uid, "provider": {"$in": ["stripe", None]}})
    stripe_backed = bool(doc and (doc.get("source") == "stripe" or doc.get("stripe_subscription_id")))
    if stripe_backed and doc.get("status") in LIVE_STATUSES:
        raise StorePurchaseRefused("Manage your existing subscription in Settings, Your plan.")


# ── Subscription documents ───────────────────────────────────────────────────

def _stale(existing: dict, signed_at: datetime | None) -> str | None:
    last = existing.get("last_signed_at")
    if last is None or signed_at is None:
        return None
    from app.core.timeutil import as_utc

    if signed_at < as_utc(last):
        return "event is older than the state already applied"
    return None


async def _after(uid: str, provider: str, *, newly_past_due: bool, landed_on_statements: bool) -> dict:
    from app.services import billing_lifecycle

    out: dict = {}
    if newly_past_due:
        title, body = store_payment_failed_copy(provider)
        await billing_lifecycle.notify(uid, title, body)
        out["notified"] = "payment_failed"
    if landed_on_statements:
        out["landed_on_statements"] = await billing_lifecycle.on_landed_on_statements(uid)
    return out


def store_payment_failed_copy(provider: str) -> tuple[str, str]:
    """(title, body) of the failed-renewal push. Names where the payment
    method lives for this store, never the web app's own settings."""
    where = {"apple": "your Apple ID settings", "google": "Google Play"}.get(provider, "your store account")
    return (
        "Payment didn't go through",
        f"The store couldn't take your latest payment. Update your payment method in {where} to keep your plan.",
    )


async def upsert_store_subscription(
    uid: str, provider: str, *,
    tier: str, billing_period: str, status: str, expires_at: datetime | None,
    provider_subscription_id: str,
    trial_ends_at: datetime | None = None, trial_started_at: datetime | None = None,
    cancel_at_period_end: bool | None = None, signed_at: datetime | None = None,
    extra: dict | None = None,
) -> dict:
    """Write the user's `provider` subscription document from a verified
    store event (SUBSCRIBED, DID_RENEW, a verified signed transaction, ...).
    `status` is "active", "trialing" or "expired" (a store event for a
    subscription that has already lapsed or been revoked)."""
    from app.db.collections import subscriptions_col

    _check_provider(provider)
    if status not in ("active", "trialing", "expired"):
        raise ValueError(f"unsupported status {status!r}")
    now = _now()
    flt = store_doc_filter(uid, provider)
    existing = dict(await subscriptions_col.find_one(flt) or {})
    stale = _stale(existing, signed_at)
    if stale:
        return {"handled": False, "reason": stale}

    fields = {
        "user_id": uid, "provider": provider, "source": provider,
        "tier": tier, "status": status, "billing_period": billing_period,
        "expires_at": expires_at, "trial_ends_at": trial_ends_at,
        "provider_subscription_id": provider_subscription_id,
        "updated_at": now,
        **(extra or {}),
    }
    if cancel_at_period_end is not None:
        fields["cancel_at_period_end"] = bool(cancel_at_period_end)
    if signed_at is not None:
        fields["last_signed_at"] = signed_at
    if trial_started_at is not None:
        fields["trial_used_at"] = trial_started_at

    update: dict = {"$set": fields, "$setOnInsert": {"started_at": now}}
    double = False
    if status in ("active", "trialing"):
        update["$unset"] = {"past_due_since": "", "grace_until": "", "ended_at": ""}
        # C13 section 2.3: a store purchase that completed while a Stripe
        # subscription is live is still granted (the store already took the
        # money), but flagged so a human can refund one of them.
        stripe_doc = await subscriptions_col.find_one({"user_id": uid, "provider": {"$in": ["stripe", None]}})
        double = bool(stripe_doc and stripe_doc.get("status") in LIVE_STATUSES
                      and (stripe_doc.get("source") == "stripe" or stripe_doc.get("stripe_subscription_id")))
        fields["double_subscription"] = double
        if double and not existing.get("double_subscription"):
            logger.warning("store billing: %s subscription granted while a Stripe subscription is live (flagged)", provider)
    else:
        fields["ended_at"] = now
        update["$unset"] = {"past_due_since": "", "grace_until": ""}
    await subscriptions_col.update_one(flt, update, upsert=True)

    landed = status == "expired" and existing.get("status") != "expired"
    effects = await _after(uid, provider, newly_past_due=False, landed_on_statements=landed)
    return {
        "handled": True, "action": "subscription_upsert", "uid": uid, "provider": provider,
        "tier": tier, "status": status, "billing_period": billing_period,
        "double_subscription": double, **effects,
    }


async def _current_doc(uid: str, provider: str, provider_subscription_id: str, signed_at: datetime | None):
    """(existing, None) when the document exists, belongs to this store
    subscription and the event is not stale, else (None, reason)."""
    from app.db.collections import subscriptions_col

    existing = await subscriptions_col.find_one(store_doc_filter(uid, provider))
    if not existing:
        return None, "no subscription on file"
    if existing.get("provider_subscription_id") != provider_subscription_id:
        # A superseded subscription ending (the user resubscribed under a new
        # original transaction) must not touch the live one.
        return None, "event is not for the current subscription"
    stale = _stale(existing, signed_at)
    if stale:
        return None, stale
    return existing, None


async def set_store_subscription_status(
    uid: str, provider: str, provider_subscription_id: str, status: str, *,
    signed_at: datetime | None = None, grace_until: datetime | None = None,
    extra: dict | None = None,
) -> dict:
    """Move an existing store subscription to "expired" (EXPIRED,
    GRACE_PERIOD_EXPIRED, REFUND, REVOKE) or "past_due" (DID_FAIL_TO_RENEW).
    A past_due document keeps its tier until `grace_until` (derived in
    get_subscription exactly like Stripe's grace), then lapses. An expired one
    loses entitlement at once, whatever its expires_at says."""
    from app.db.collections import subscriptions_col

    _check_provider(provider)
    if status not in ("expired", "past_due"):
        raise ValueError(f"unsupported status {status!r}")
    existing, reason = await _current_doc(uid, provider, provider_subscription_id, signed_at)
    if existing is None:
        return {"handled": False, "reason": reason}
    now = _now()
    fields = {"status": status, "updated_at": now, **(extra or {})}
    if signed_at is not None:
        fields["last_signed_at"] = signed_at
    update: dict = {"$set": fields}
    newly_past_due = False
    if status == "past_due":
        newly_past_due = existing.get("status") != "past_due"
        fields["past_due_since"] = existing.get("past_due_since") if existing.get("status") == "past_due" and existing.get("past_due_since") else now
        fields["grace_until"] = grace_until or now
    else:
        fields["ended_at"] = now
        update["$unset"] = {"past_due_since": "", "grace_until": ""}
    await subscriptions_col.update_one(store_doc_filter(uid, provider), update)
    landed = status == "expired" and existing.get("status") != "expired"
    effects = await _after(uid, provider, newly_past_due=newly_past_due, landed_on_statements=landed)
    return {"handled": True, "action": f"subscription_{status}", "uid": uid, "provider": provider, "status": status, **effects}


async def set_store_cancel_at_period_end(
    uid: str, provider: str, provider_subscription_id: str, cancel: bool, *, signed_at: datetime | None = None,
) -> dict:
    """Auto-renew switched off or on (DID_CHANGE_RENEWAL_STATUS). Entitlement
    is unchanged either way: it runs to expires_at."""
    from app.db.collections import subscriptions_col

    _check_provider(provider)
    existing, reason = await _current_doc(uid, provider, provider_subscription_id, signed_at)
    if existing is None:
        return {"handled": False, "reason": reason}
    fields = {"cancel_at_period_end": bool(cancel), "updated_at": _now()}
    if signed_at is not None:
        fields["last_signed_at"] = signed_at
    await subscriptions_col.update_one(store_doc_filter(uid, provider), {"$set": fields})
    return {"handled": True, "action": "cancel_at_period_end", "uid": uid, "provider": provider, "cancel_at_period_end": bool(cancel)}


# ── Consumable packs ─────────────────────────────────────────────────────────

def _pack_collection(pack_kind: str):
    from app.db.collections import mcp_call_packs_col, penny_topups_col

    return mcp_call_packs_col if pack_kind == "mcp" else penny_topups_col


async def grant_store_pack(uid: str, provider: str, pack_kind: str, pack_id: str, transaction_id: str) -> dict:
    """Grant a consumable pack once per store transaction id (a replayed
    notification or a restore re-submitting the same transaction grants
    nothing the second time)."""
    _check_provider(provider)
    col = _pack_collection(pack_kind)
    existing = await col.find_one({"provider": provider, "store_transaction_id": transaction_id})
    if existing:
        return {"handled": True, "action": "grant_pack", "duplicate": True, "uid": uid,
                "pack_kind": pack_kind, "pack_id": pack_id}
    try:
        await grant_pack(
            uid, pack_kind, pack_id, source="purchase",
            extra={"provider": provider, "store_transaction_id": transaction_id},
        )
    except ValueError as exc:
        logger.error("store billing: grant_pack refused (%s)", exc)
        return {"handled": False, "reason": str(exc)}
    return {"handled": True, "action": "grant_pack", "duplicate": False, "uid": uid,
            "pack_kind": pack_kind, "pack_id": pack_id}


async def record_store_pack_refund(
    provider: str, pack_kind: str, transaction_id: str, *, clawback: bool,
) -> dict:
    """A refunded consumable (C13 section 8). Always recorded on the pack
    document (`refunded_at`) and, by the caller, in the ledger. Spent
    messages are reclaimed only when `clawback` is true (the
    IAP_REFUND_CLAWBACK flag, Kevin's open decision): then the pack's
    remaining balance is set to zero. With it false `remaining` is left
    exactly as it is."""
    _check_provider(provider)
    col = _pack_collection(pack_kind)
    pack = await col.find_one({"provider": provider, "store_transaction_id": transaction_id})
    if not pack:
        return {"pack_found": False, "clawback": False}
    now = _now()
    fields: dict = {"refunded_at": now}
    if clawback:
        fields.update({"remaining": 0, "clawed_back_at": now})
    await col.update_one({"_id": pack["_id"]}, {"$set": fields})
    return {"pack_found": True, "clawback": bool(clawback), "remaining_before": pack.get("remaining")}
