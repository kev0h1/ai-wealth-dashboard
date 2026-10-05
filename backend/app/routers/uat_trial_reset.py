"""B47: UAT-only admin endpoint to reset the introductory trial.

Guards, all independent:
  1. Mounted only when `app.core.config.UAT_ADMIN_ENABLED` (derived from
     APP_URL exactly like TRUELAYER_ENABLED, never a separate env flag), so
     the route is absent from production's route table.
  2. Refuses at call time when APP_URL is not a non-production host, even
     if registered by mistake.
  3. Owner-only (Kevin's own session). Deliberately NOT bot-or-owner and
     not in bot_credentials.ROUTE_SCOPES: no bot credential can reach it.
  4. A frozen allow-list of SHA-256 hashes of the UAT user ids captured on
     2026-10-05 (app/data/uat_trial_reset_allowlist.json). Any id not on it
     is refused with 403, so users created later can never be reset.
  5. The write `$unset`s TRIAL_FIELDS only, never tier, status, Stripe ids
     or anything else, and leaves Stripe-backed active/trialing/past_due
     subscriptions untouched.
"""
import hashlib
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.core import config
from app.core.auth import current_user
from app.db import collections

router = APIRouter(tags=["subscription"])
_log = logging.getLogger("app.uat_trial_reset")

ALLOWLIST_PATH = Path(__file__).resolve().parent.parent / "data" / "uat_trial_reset_allowlist.json"

# The only fields billing._validate_subscription_checkout reads that mean
# "trial already used" and that this endpoint may clear. `source`,
# `stripe_subscription_id` and `status` are also read there, and are never
# touched.
TRIAL_FIELDS = ("trial_used_at", "trial_ends_at")
_LIVE_STRIPE_STATUSES = {"active", "trialing", "past_due"}


def hash_id(value: str) -> str:
    return hashlib.sha256((value or "").strip().lower().encode()).hexdigest()


def load_allowlist() -> frozenset[str]:
    data = json.loads(ALLOWLIST_PATH.read_text())
    return frozenset(data["user_id_hashes"])


def _require_owner(user: dict) -> None:
    if (user.get("email") or "").strip().lower() != config.PRIMARY_EMAIL:
        raise HTTPException(403, "Admin only")


def _is_stripe_live(doc: dict) -> bool:
    stripe_backed = bool(doc.get("source") == "stripe" or doc.get("stripe_subscription_id"))
    return stripe_backed and doc.get("status") in _LIVE_STRIPE_STATUSES


@router.post("/subscription/admin/uat-trial-reset")
async def uat_trial_reset(body: dict, user: dict = Depends(current_user)):
    _require_owner(user)
    if not config._is_non_production(config.APP_URL):
        raise HTTPException(403, "Not available in this environment")

    allow = load_allowlist()
    reset_all = body.get("all") is True
    user_id = body.get("user_id")
    if reset_all == bool(user_id):
        raise HTTPException(400, 'send exactly one of {"user_id": "<email>"} or {"all": true}')
    if not reset_all:
        if not isinstance(user_id, str) or hash_id(user_id) not in allow:
            raise HTTPException(403, "Not on the UAT reset list")
        wanted = {hash_id(user_id)}
    else:
        wanted = set(allow)

    admin_hash = hash_id(user.get("email") or "")
    modified = 0
    skipped_live_stripe = 0
    async for doc in collections.subscriptions_col.find({}, {
        "user_id": 1, "status": 1, "source": 1, "stripe_subscription_id": 1,
    }):
        h = hash_id(doc.get("user_id") or "")
        if h not in wanted:
            continue
        if _is_stripe_live(doc):
            skipped_live_stripe += 1
            continue
        res = await collections.subscriptions_col.update_one(
            {"_id": doc["_id"]}, {"$unset": {f: "" for f in TRIAL_FIELDS}},
        )
        if res.modified_count:
            modified += 1
            _log.info("uat trial reset user=%s admin=%s", h[:16], admin_hash[:16])
    return {"ok": True, "modified": modified, "skipped_live_stripe": skipped_live_stripe}
