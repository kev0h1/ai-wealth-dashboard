"""E14: the owner's view of one person's subscription, and hand-made changes
to it, under /ops/people/{id}/subscription.

Same rules as ops_people (E12): owner SESSION only (a bot credential or scoped
token is refused), targets travel as the opaque person id and never in a URL as
an email, every change writes one `ops_audit` row carrying `target_key` (so an
erase later masks it) and a reason, and logs and Sentry only ever see
mask_email. Unlike the other People actions, the owner's own row IS editable
here (the owner can comp or test their own plan).

Only the app-side document is ever changed (app.services.subscription_admin).
A live Stripe, Apple or Google Play subscription is refused with a 409 and the
page points at Stripe or the store instead. After every change the user's
response cache is wiped (response_cache.ainvalidate), so it applies on their
next request.

  GET  /ops/people/{id}/subscription
  POST /ops/people/{id}/subscription/set-tier      {tier, expires_at?, reason, confirm}
  POST /ops/people/{id}/subscription/topup         {pack_id, reason, confirm}
  POST /ops/people/{id}/subscription/reset-trial   {reason, confirm: "RESET"}
  POST /ops/people/{id}/subscription/cancel-grant  {reason}

reset-trial clears `trial_used_at` and `trial_ends_at` and stamps
`trial_reset_at` on the person's non-live Stripe-slot document only (the one
document Stripe Checkout reads), so the introductory trial can be taken again.
Apple and Google documents are left alone. Nothing else changes.
"""
import logging
import re
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL, mask_email
from app.core.subscription import (
    PENNY_TOPUP_PACKS, TIER_BY_NAME, canonical_tier_name, get_subscription_doc,
    mcp_allowance, penny_allowance, settle_topups,
)
from app.core.timeutil import as_utc
from app.db import collections as cols
from app.routers.ops import _require_owner_session
from app.routers.ops_people import _audit, _iso, _owner_key, _pid, _profile_ids_for_key, _resolve
from app.routers.subscription import _tier_source
from app.services import response_cache
from app.services import subscription_admin as sa

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ops/people", tags=["ops"])

MAX_GRANT_DAYS = 3650
_EMAILISH = re.compile(r"[^\s@]+@[^\s@]+")
LIVE_REFUSAL = sa.LIVE_REFUSAL
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _clean_reason(v: str) -> str:
    v = _EMAILISH.sub("[email]", (v or "").strip())
    if not v:
        raise ValueError("Add a reason.")
    if len(v) > 200:
        raise ValueError("Keep the reason under 200 characters.")
    return v


class _Reasoned(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        return _clean_reason(v)


class SetTierBody(_Reasoned):
    tier: str
    expires_at: str | None = None
    confirm: str = ""


class TopupBody(_Reasoned):
    pack_id: str
    confirm: str = ""


class ResetTrialBody(_Reasoned):
    confirm: str = ""


class CancelGrantBody(_Reasoned):
    pass


async def _target(pid: str) -> str:
    """Person id -> the subscription user id. The owner is allowed here."""
    if pid == _pid(_owner_key()):
        return PRIMARY_EMAIL.strip().lower()
    key = await _resolve(pid)
    ids = await _profile_ids_for_key(key)
    if ids:
        return ids[0].strip().lower()
    doc = await cols.allowed_signups_col.find_one({"key": key})
    return ((doc or {}).get("email") or key).strip().lower()


def _parse_expiry(raw: str | None) -> datetime | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        text = str(raw).strip()
        if not _ISO_DATE.fullmatch(text):
            raise ValueError(text)
        d = date.fromisoformat(text)
    except ValueError:
        raise HTTPException(400, "Enter the expiry as a date, like 2026-12-31.")
    end = datetime.combine(d, time(23, 59, 59), tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)  # naive-ok: aware comparison
    if end <= now:
        raise HTTPException(400, "The expiry must be a future date.")
    if end > now + timedelta(days=MAX_GRANT_DAYS):
        raise HTTPException(400, "The expiry is too far ahead.")
    return end


async def _detail(uid: str) -> dict:
    now = datetime.now(timezone.utc)  # naive-ok: aware comparison
    picked, sub = await get_subscription_doc(uid)
    docs = await sa.user_docs(uid)
    live = sa.live_provider(docs)
    source = _tier_source(picked, sub)
    manual = sa.manual_doc(docs)
    trial_ends = as_utc(sub.trial_ends_at) if sub.trial_ends_at else None
    if source == "default":
        status = "default"
    elif sub.status == "active" and trial_ends and trial_ends > now:
        status = "trialing"
    else:
        status = sub.status
    cancels = bool(sub.cancel_at_period_end)
    renews = _iso(sub.renews_at) if sub.renews_at else None

    penny = await penny_allowance(uid, persist=False)
    mcp = await mcp_allowance(uid, persist=False)
    packs = []
    for p in await settle_topups(uid, now, persist=False):
        exp = as_utc(p.get("expires_at")) if p.get("expires_at") else None
        if int(p.get("remaining") or 0) > 0 and (exp is None or exp > now):
            packs.append({"messages": int(p.get("messages") or 0), "remaining": int(p.get("remaining") or 0),
                          "source": p.get("source") or "purchase", "expires_at": _iso(exp)})
    tier_limit = None if penny["limit"] is None else penny["limit"] - int(penny["topup_messages"])
    return {
        "tier": sub.tier_name,
        "billing_period": sub.billing_period,
        "provider": source if source in ("stripe", "apple", "google") else "none",
        "provider_live": live is not None,
        "live_provider": live,
        "status": status,
        "trial_started_at": _iso(picked.get("trial_used_at")) if picked else None,
        "trial_ends_at": _iso(trial_ends),
        "renews_at": None if cancels else renews,
        "cancels_at": renews if cancels else None,
        "has_paid_subscription": bool(sub.has_paid_subscription),
        "tier_source": source,
        "manual_grant": ({
            "tier": canonical_tier_name(manual.get("tier")),
            "expires_at": _iso(manual.get("expires_at")),
            "lapsed": bool(manual.get("expires_at") and as_utc(manual["expires_at"]) < now),
        } if manual else None),
        "can_reset_trial": sa.has_trial_to_reset(docs) and live is None,
        "penny": {
            "monthly_allowance": tier_limit, "used": penny["used"], "remaining": penny["remaining"],
            "topup_messages": penny["topup_messages"], "packs": packs,
        },
        "mcp": {"allowance": mcp["limit"], "used": mcp["used"], "remaining": mcp["remaining"]},
        "pack_ids": [p["id"] for p in PENNY_TOPUP_PACKS],
    }


async def _finish(actor: str, uid: str, pid: str, action: str, detail: str, reason: str) -> None:
    await _audit(actor, action, mask_email(uid), pid, f"{detail}. Reason: {reason}")
    await response_cache.ainvalidate(uid)
    logger.info("ops_people: %s %s", action, mask_email(uid))


def _refuse_if_live(docs: list[dict]) -> None:
    live = sa.live_provider(docs)
    if live:
        raise HTTPException(409, LIVE_REFUSAL[live])


@router.get("/{pid}/subscription")
async def get_person_subscription(pid: str, user: dict = Depends(current_user)):
    _require_owner_session(user)
    return await _detail(await _target(pid))


@router.post("/{pid}/subscription/set-tier")
async def set_tier(pid: str, body: SetTierBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    uid = await _target(pid)
    tier = (body.tier or "").strip().lower()
    if tier not in TIER_BY_NAME:
        raise HTTPException(400, f"Tier must be one of: {', '.join(TIER_BY_NAME)}.")
    if (body.confirm or "").strip().lower() != tier:
        raise HTTPException(400, "Type the plan name to confirm.")
    expires = _parse_expiry(body.expires_at)
    try:
        await sa.set_manual_tier(uid, tier, expires)
    except sa.LiveProviderError:
        # Lost a race with a provider write: say which one is live now.
        raise HTTPException(409, LIVE_REFUSAL[sa.live_provider(await sa.user_docs(uid)) or "stripe"])
    until = f" until {expires.date().isoformat()}" if expires else " with no expiry"
    await _finish(actor, uid, pid, "set_tier", f"Set plan to {tier}{until}", body.reason)
    return {"ok": True}


@router.post("/{pid}/subscription/topup")
async def topup(pid: str, body: TopupBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    uid = await _target(pid)
    pack_id = (body.pack_id or "").strip().lower()
    if pack_id not in {p["id"] for p in PENNY_TOPUP_PACKS}:
        raise HTTPException(400, f"Pack must be one of: {', '.join(p['id'] for p in PENNY_TOPUP_PACKS)}.")
    if (body.confirm or "").strip().lower() != pack_id:
        raise HTTPException(400, "Type the pack name to confirm.")
    from app.core.subscription import grant_pack
    await grant_pack(uid, "penny", pack_id, source="admin")
    await _finish(actor, uid, pid, "grant_topup", f"Granted Penny pack {pack_id}", body.reason)
    return {"ok": True}


@router.post("/{pid}/subscription/reset-trial")
async def reset_trial(pid: str, body: ResetTrialBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    uid = await _target(pid)
    if (body.confirm or "").strip() != "RESET":
        raise HTTPException(400, "Type RESET to confirm.")
    docs = await sa.user_docs(uid)
    _refuse_if_live(docs)
    if not sa.has_trial_to_reset(docs):
        raise HTTPException(409, "Nothing to reset. This person has not used the trial.")
    changed = await sa.reset_trial(uid)
    await _finish(actor, uid, pid, "reset_trial", f"Trial reset on {changed} document(s)", body.reason)
    return {"ok": True}


@router.post("/{pid}/subscription/cancel-grant")
async def cancel_grant(pid: str, body: CancelGrantBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    uid = await _target(pid)
    for doc in await sa.user_docs(uid):
        live = sa.doc_live_provider(doc)
        if live and doc.get("managed_by") == "manual":
            raise HTTPException(409, LIVE_REFUSAL[live])
    if not await sa.cancel_manual_grant(uid):
        raise HTTPException(409, "There is no manual grant to cancel.")
    await _finish(actor, uid, pid, "cancel_grant", "Manual grant removed", body.reason)
    return {"ok": True}
