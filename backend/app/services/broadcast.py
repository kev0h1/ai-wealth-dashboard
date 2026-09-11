"""B20: admin-composed offer broadcasts.

Kevin needed a way to tell a slice of users about an offer (through the
existing push path plus a matching in-app card) without touching a
database by hand. This module is the whole send path: resolve an
audience, freeze it into a broadcast doc, and send to exactly that frozen
list once, respecting notification preferences.

Two-step flow, matching the ticket's safety requirement that composing and
sending are separate actions:

  1. `create_broadcast()` resolves the audience NOW and stores the
     resolved recipient list + count on the broadcast doc (`status:
     "draft"`). This is what the operator previews before confirming — a
     mis-specified filter is visible as a recipient count, not discovered
     after the fact.
  2. `send_broadcast()` sends to exactly that frozen list. It never
     re-resolves the audience, so what the operator saw in preview is
     exactly what goes out, even if the underlying filter (e.g. "everyone
     on Lite") would resolve differently a minute later.

Idempotency (see `send_broadcast`'s own docstring for the two mechanisms):
a compare-and-swap on the broadcast's own `status` field, plus a unique-key
insert per (broadcast, recipient) receipt. Both must hold for a double
submit to be safe — the CAS handles concurrent double-clicks, the
per-recipient insert handles a retried/crashed send loop being re-run.

Every send is recorded in `broadcast_receipts_col` (who, when, the exact
copy, dry_run or not, the push transport result) — see
app/db/collections.py for the retention bound (TTL'd a year out,
app/main.py's _create_indexes).
"""
import re
import uuid
from datetime import datetime, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.config import BILLING_ENABLED
from app.core.push import send_push_to_user
from app.core.subscription import TIER_BY_NAME, get_subscription, penny_allowance
from app.db.collections import (
    broadcasts_col, broadcast_receipts_col,
    preferences_col, subscriptions_col, user_profiles_col,
)
from app.services.notifications import notif_pref

AUDIENCE_TYPES = ("everyone", "tier", "state")

# The first (only, today) "at risk of X" state a broadcast can target. A
# small dict of predicates rather than a single hardcoded check, so a
# second state (e.g. "trial_ending") is one more entry, not a new code
# path. Ticket's own example: "at the Penny cap".
STATE_KEYS = ("penny_cap",)


class BroadcastError(ValueError):
    """A bad audience/copy definition. Routers turn this into a 400."""


_PRICE_RE = re.compile(r"(£|\$|GBP|USD)\s?\d")


def _contains_price(text: str) -> bool:
    return bool(_PRICE_RE.search(text or ""))


def check_price_guard(title: str, body: str) -> None:
    """B20 ticket: sending an offer never depends on Stripe, but any
    DISCOUNTED PRICE in an offer needs a real Stripe promotion code behind
    it, which only exists once BILLING_ENABLED is true. Rather than trust
    every future caller to remember that, composing an offer whose copy
    looks like it names a price is refused outright while billing isn't
    live. This is a best-effort regex (£/$/GBP/USD followed by a digit),
    not a proof of absence — it catches the obvious cases, not a price
    spelled out in words ("nine ninety nine")."""
    if BILLING_ENABLED:
        return
    if _contains_price(title) or _contains_price(body):
        raise BroadcastError(
            "Offer copy cannot mention a price until billing is live. "
            "Describe the offer without a discount amount."
        )


async def _all_user_ids() -> list[str]:
    """Every known user id (email). There is no single canonical "users"
    collection in this codebase — identity is implicit via email, spread
    across whichever per-user collection a given feature first touches
    (see app.services.retention.account_has_data's own multi-collection
    union for the same shape of problem). This unions the three
    collections a signed-up user is virtually guaranteed to have touched:
    user_profiles_col (stamped on every authenticated request),
    preferences_col (written during income/onboarding setup), and
    subscriptions_col (written the first time a tier is read or set).
    A user who has done none of those has never really used the app, so
    "everyone" not including them is the right answer, not a bug."""
    ids: set[str] = set()
    async for doc in user_profiles_col.find({}, {"_id": 1}):
        if doc.get("_id"):
            ids.add(doc["_id"])
    async for doc in preferences_col.find({}, {"user_id": 1}):
        if doc.get("user_id"):
            ids.add(doc["user_id"])
    async for doc in subscriptions_col.find({}, {"user_id": 1}):
        if doc.get("user_id"):
            ids.add(doc["user_id"])
    return sorted(ids)


async def _matches_state(uid: str, state: str) -> bool:
    if state == "penny_cap":
        allowance = await penny_allowance(uid)
        remaining = allowance.get("remaining")
        # None means the tier is unlimited — can never be "at the cap".
        return remaining is not None and remaining <= 0
    raise BroadcastError(f"Unknown state {state!r}, must be one of {STATE_KEYS}")


async def resolve_audience(audience: dict) -> list[str]:
    """Return the sorted list of user ids `audience` selects, with any
    "offers"-preference opt-out already excluded (see
    app.services.notifications.NOTIF_DEFAULTS — a user who turned offers
    off is never a recipient, no matter how they were targeted).

    `audience` shape: {"type": "everyone"} | {"type": "tier", "tier": one
    of app.core.subscription.TIER_BY_NAME} | {"type": "state", "state":
    one of STATE_KEYS}.
    """
    kind = (audience or {}).get("type")
    if kind not in AUDIENCE_TYPES:
        raise BroadcastError(f"audience.type must be one of {AUDIENCE_TYPES}")

    candidates = await _all_user_ids()

    if kind == "tier":
        tier_name = (audience.get("tier") or "").strip().lower()
        if tier_name not in TIER_BY_NAME:
            raise BroadcastError(f"audience.tier must be one of {list(TIER_BY_NAME)}")
        matched = []
        for uid in candidates:
            sub = await get_subscription(uid)
            if sub.tier_name == tier_name:
                matched.append(uid)
        candidates = matched
    elif kind == "state":
        state = audience.get("state")
        if state not in STATE_KEYS:
            raise BroadcastError(f"audience.state must be one of {STATE_KEYS}")
        matched = []
        for uid in candidates:
            if await _matches_state(uid, state):
                matched.append(uid)
        candidates = matched
    # kind == "everyone": candidates unchanged, every known user.

    opted_in = [uid for uid in candidates if await notif_pref(uid, "offers")]
    return sorted(opted_in)


async def create_broadcast(*, title: str, body: str, url: str | None, audience: dict, created_by: str) -> dict:
    """Compose step: validate copy, resolve the audience NOW, and freeze
    the result into a new "draft" broadcast doc. Returns the stored doc,
    which carries `recipient_ids`/`recipient_count` — what the /ops page
    shows the operator before they confirm."""
    title = (title or "").strip()
    body = (body or "").strip()
    url = (url or "/").strip() or "/"
    if not title:
        raise BroadcastError("title is required")
    if not body:
        raise BroadcastError("body is required")
    check_price_guard(title, body)

    recipient_ids = await resolve_audience(audience)

    broadcast_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    doc = {
        "_id": broadcast_id,
        "title": title,
        "body": body,
        "url": url,
        "audience": audience,
        "status": "draft",
        "recipient_ids": recipient_ids,
        "recipient_count": len(recipient_ids),
        "created_at": now,
        "created_by": created_by,
        "sent_at": None,
        "dry_run": None,
        "results": None,
    }
    await broadcasts_col.insert_one(doc)
    return doc


async def get_broadcast(broadcast_id: str) -> dict | None:
    return await broadcasts_col.find_one({"_id": broadcast_id})


async def list_broadcasts(limit: int = 50) -> list[dict]:
    return await broadcasts_col.find({}).sort("created_at", -1).to_list(limit)


async def send_broadcast(broadcast_id: str, *, dry_run: bool = False) -> dict:
    """Send step. Idempotent two ways:

    1. Compare-and-swap on `status`: the update filter requires
       `status: "draft"`, so only the FIRST call for a given broadcast_id
       ever transitions it to "sending". A concurrent or retried second
       call finds no matching document, and returns whatever is already
       stored (mid-flight "sending" or finished "sent") instead of
       sending a second time.
    2. Per-recipient: `broadcast_receipts_col._id` is
       "{broadcast_id}:{user_id}", INSERTED (not upserted) before that
       recipient's push goes out. A duplicate insert — this function
       re-run after a crash partway through its loop — raises
       DuplicateKeyError and that recipient is skipped, since a receipt
       already existing means they were already sent to.

    `dry_run=True` runs the exact same resolution, receipt-write and
    per-recipient bookkeeping, but never calls `send_push_to_user` — no
    network call to FCM/APNs/web-push happens at all. This is the ONLY
    way to prove the send path end to end without reaching a real device;
    it must never be used against a broadcast meant to actually go out."""
    claimed = await broadcasts_col.find_one_and_update(
        {"_id": broadcast_id, "status": "draft"},
        {"$set": {"status": "sending", "dry_run": bool(dry_run)}},
    )
    if claimed is None:
        existing = await broadcasts_col.find_one({"_id": broadcast_id})
        if existing is None:
            raise BroadcastError(f"No broadcast {broadcast_id!r}")
        return existing  # already sending or sent — no second send.

    recipients = claimed.get("recipient_ids") or []
    title = claimed["title"]
    body = claimed["body"]
    url = claimed.get("url") or "/"

    delivered = 0
    skipped_optout = 0
    skipped_already_sent = 0
    now = datetime.now(timezone.utc)

    for uid in recipients:
        # Re-check the opt-out at send time too — resolve_audience already
        # filtered these out at preview time (the primary gate); this is a
        # defensive second look in case a preference changed in the gap
        # between preview and confirm.
        if not await notif_pref(uid, "offers"):
            skipped_optout += 1
            continue

        receipt_id = f"{broadcast_id}:{uid}"
        try:
            await broadcast_receipts_col.insert_one({
                "_id": receipt_id,
                "broadcast_id": broadcast_id,
                "user_id": uid,
                "title": title,
                "body": body,
                "url": url,
                "sent_at": now,
                "dry_run": bool(dry_run),
                "push": None,
                "read_at": None,
            })
        except DuplicateKeyError:
            skipped_already_sent += 1
            continue

        if dry_run:
            delivered += 1
            continue

        push_result = await send_push_to_user(uid, title, body, url)
        await broadcast_receipts_col.update_one(
            {"_id": receipt_id}, {"$set": {"push": push_result}},
        )
        delivered += 1

    results = {
        "recipient_count": len(recipients),
        "delivered": delivered,
        "skipped_optout": skipped_optout,
        "skipped_already_sent": skipped_already_sent,
    }
    final = await broadcasts_col.find_one_and_update(
        {"_id": broadcast_id},
        {"$set": {"status": "sent", "sent_at": now, "results": results}},
        return_document=ReturnDocument.AFTER,
    )
    return final


async def list_offers_for_user(user_id: str) -> list[dict]:
    """Unread in-app cards for `user_id` — the "matching in-app card" half
    of the ticket. A dry run's receipts are stamped `dry_run: true` and
    excluded here on purpose: a dry run must never surface to any real
    user's inbox, on top of never calling send_push_to_user."""
    cursor = broadcast_receipts_col.find(
        {"user_id": user_id, "read_at": None, "dry_run": {"$ne": True}},
    ).sort("sent_at", -1)
    return await cursor.to_list(20)


async def dismiss_offer(user_id: str, receipt_id: str) -> bool:
    """Mark one in-app offer card read. Scoped to `user_id` so one user can
    never dismiss another's card by guessing an id. Returns whether a
    document was actually matched."""
    result = await broadcast_receipts_col.update_one(
        {"_id": receipt_id, "user_id": user_id},
        {"$set": {"read_at": datetime.now(timezone.utc)}},
    )
    return result.matched_count > 0
