"""E14: hand-made subscription changes, shared by the owner's People page
(app.routers.ops_people_subscription) and the bot-or-owner admin endpoints in
app.routers.subscription.

Everything here touches only the app-side `subscriptions_col` document. A live
Stripe, Apple or Google Play subscription is never edited: `live_provider`
reports it and the People page then points at Stripe or the store instead.

The "manual grant" is the document in the Stripe/none slot (the one shared with
self-selected and seeded plans) that carries `managed_by: "manual"`. It is
written with `source: "manual"`, which no billing code treats as a paid
subscription, and an optional `expires_at`. get_subscription already reads an
`expires_at` in the past as an ended document, and a document that is not
store- or Stripe-backed then lands on the default tier, so a lapsed grant falls
back with no job needed.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.core.subscription import TIER_BY_NAME
from app.db import collections as cols

LIVE_STATUSES = ("active", "trialing", "past_due")
STRIPE_SLOT = {"provider": {"$in": ["stripe", None]}}

# What a trial reset clears. Same fields and marker as the UAT reset (B47).
TRIAL_FIELDS = ("trial_used_at", "trial_ends_at")
RESET_MARKER = "trial_reset_at"


def _stripe_slot_filter(email: str) -> dict:
    return {"user_id": email, **STRIPE_SLOT}


def doc_provider(doc: dict) -> str:
    provider = doc.get("provider")
    return provider if provider in ("stripe", "apple", "google") else "stripe"


def doc_live_provider(doc: dict) -> str | None:
    """The provider that owns this document when it is a live paid
    subscription, else None."""
    if doc.get("status") not in LIVE_STATUSES:
        return None
    provider = doc_provider(doc)
    if provider == "stripe":
        backed = bool(doc.get("source") == "stripe" or doc.get("stripe_subscription_id"))
        return "stripe" if backed else None
    return provider if doc.get("source") == provider else None


async def user_docs(email: str) -> list[dict]:
    return [d async for d in cols.subscriptions_col.find({"user_id": email})]


def live_provider(docs: list[dict]) -> str | None:
    for doc in docs:
        found = doc_live_provider(doc)
        if found:
            return found
    return None


def manual_doc(docs: list[dict]) -> dict | None:
    for doc in docs:
        if doc_provider(doc) == "stripe" and doc.get("managed_by") == "manual":
            return doc
    return None


async def set_manual_tier(email: str, tier: str, expires_at: datetime | None = None) -> None:
    """Write the manual grant. The one write behind PATCH
    /subscription/admin/set-tier and POST /ops/people/{id}/subscription/set-tier.
    Callers validate the tier and decide about live providers."""
    if tier not in TIER_BY_NAME:
        raise ValueError("unknown tier")
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    update: dict = {
        "$set": {
            "user_id": email, "provider": "stripe", "tier": tier, "status": "active",
            "managed_by": "manual", "source": "manual", "updated_at": now,
            "expires_at": expires_at,
        },
        "$setOnInsert": {"started_at": now},
    }
    await cols.subscriptions_col.update_one(
        {"user_id": email, "provider": {"$in": ["stripe", None]}}, update, upsert=True,
    )


async def cancel_manual_grant(email: str) -> bool:
    """End the manual grant. The document is kept but marked ended and no longer
    manual, so the user lands on the default tier (or their live store plan),
    and any trial history on it is not lost. False when there is no grant."""
    doc = manual_doc(await user_docs(email))
    if doc is None:
        return False
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    await cols.subscriptions_col.update_one(
        _stripe_slot_filter(email),
        {"$set": {"status": "expired", "updated_at": now},
         "$unset": {"managed_by": "", "source": "", "expires_at": ""}},
    )
    return True


async def reset_trial(email: str) -> int:
    """Clear the introductory-trial markers on the user's non-live documents and
    stamp `trial_reset_at`, so billing._trial_reset_applies lets a trial
    Checkout through again. Touches nothing else: not the tier, status, billing
    period, or any Stripe field. Returns the number of documents changed."""
    changed = 0
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    for doc in await user_docs(email):
        if doc_live_provider(doc):
            continue
        res = await cols.subscriptions_col.update_one(
            {"_id": doc["_id"]},
            {"$unset": {f: "" for f in TRIAL_FIELDS}, "$set": {RESET_MARKER: now}},
        )
        changed += 1 if getattr(res, "matched_count", 1) else 0
    return changed


def has_trial_to_reset(docs: list[dict]) -> bool:
    return any(
        not doc_live_provider(d) and (
            d.get("trial_used_at") or d.get("trial_ends_at")
            or d.get("source") == "stripe" or d.get("stripe_subscription_id"))
        for d in docs
    )
