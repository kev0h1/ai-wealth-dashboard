"""E12: the owner's People page (/ops/people). One screen that joins the
sign-up allow list (`allowed_signups`) with who has actually signed up
(`user_profiles`) and what they hold, and lets the owner invite, revoke,
restore and remove people.

Auth: owner SESSION only. Same shape as ops._require_owner_session: a bot
credential or a scoped token is refused outright (the paths are also absent
from app.core.bot_credentials.ROUTE_SCOPES, so the middleware refuses a bot
before it gets here). The owner row is never revocable and never erasable.

What is stored and what is not (nothing here adds tracking):
  - signed up      -> a `user_profiles` document exists.
  - signed-up date -> NOT recorded (profiles carry no created_at); reported null.
  - last active    -> `last_active_at`, stamped by retention.stamp_activity on an
                      authenticated request, at most once per 6 hours. It is the
                      closest stored thing to a last sign-in; there is no exact one.
  - sign-in method -> only Apple is knowable (a `linked_identities` row); otherwise null.
  - plan / trial   -> get_subscription. Banks / accounts / last sync -> consents
                      and accounts. Penny messages -> penny_allowance.

Every action writes one `ops_audit` row. Logs and Sentry only ever see
mask_email(...); the page itself is the one place a full email is shown.
"""
import asyncio
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL, _gmail_key, mask_email
from app.core.timeutil import as_utc
from app.db import collections as cols
from app.routers.admin_allowlist import _EMAIL_RE, invite_email
from app.routers.ops import _require_owner_session
from app.services.account_erasure import erase_account

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ops/people", tags=["ops"])

PAGE_SIZE = 500
AUDIT_LIMIT = 100
_ENRICH_CONCURRENCY = 8


def _owner_key() -> str:
    return _gmail_key(PRIMARY_EMAIL)


def _iso(dt: datetime | None) -> str | None:
    dt = as_utc(dt) if isinstance(dt, datetime) else None
    return dt.isoformat() if dt else None


class InviteBody(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Enter a valid email address.")
        return v


class EraseBody(BaseModel):
    confirm_email: str


async def _audit(actor: str, action: str, target: str, detail: str | None = None) -> None:
    await cols.ops_audit_col.insert_one(
        {"at": datetime.now(timezone.utc), "actor": actor, "action": action,  # naive-ok: persisted audit timestamp, aware UTC
         "target": target, "detail": detail}
    )


def _key_of(uid: str) -> str:
    return _gmail_key((uid or "").strip().lower())


async def _profile_ids_for_key(key: str) -> list[str]:
    """Every user_profiles _id that resolves to this allow-list key. Gmail
    ignores dots and googlemail.com, so one person can be stored under more
    than one spelling."""
    local, _, domain = key.partition("@")
    if domain == "gmail.com":
        pattern = "^" + r"\.*".join(re.escape(c) for c in local) + r"\.*@(gmail|googlemail)\.com$"
        query = {"_id": {"$regex": pattern, "$options": "i"}}
    else:
        query = {"_id": key}
    return [d["_id"] async for d in cols.user_profiles_col.find(query, {"_id": 1})]


async def _enrich(uid: str, now: datetime) -> dict:
    """Plan, trial, banks, accounts, last sync and Penny usage for one person.
    Each piece fails on its own to null so one bad lookup never blanks the page."""
    out: dict = {
        "plan": None, "plan_status": None, "trial_ends_at": None, "on_trial": False,
        "banks_connected": None, "accounts": None, "last_sync": None,
        "penny_messages_this_month": None,
    }
    try:
        from app.core.subscription import get_subscription
        sub = await get_subscription(uid)
        trial_end = as_utc(sub.trial_ends_at) if sub.trial_ends_at else None
        out["plan"] = sub.tier_name
        out["plan_status"] = sub.status
        out["trial_ends_at"] = _iso(trial_end)
        out["on_trial"] = bool(trial_end and trial_end > now)
    except Exception:
        logger.warning("ops_people: plan lookup failed for %s", mask_email(uid))
    try:
        consents = [c async for c in cols.finexer_consents_col.find(
            {"user_id": uid, "status": "authorized"}, {"last_synced": 1})]
        connections = [c async for c in cols.connections_col.find(
            {"user_id": uid}, {"last_synced": 1})]
        out["banks_connected"] = len(consents) + len(connections)
        stamps = [as_utc(d["last_synced"]) for d in consents + connections
                  if isinstance(d.get("last_synced"), datetime)]
        out["last_sync"] = _iso(max(stamps)) if stamps else None
        out["accounts"] = await cols.accounts_col.count_documents({"user_id": uid})
    except Exception:
        logger.warning("ops_people: bank lookup failed for %s", mask_email(uid))
    try:
        from app.core.subscription import penny_allowance
        out["penny_messages_this_month"] = int((await penny_allowance(uid, persist=False)).get("used") or 0)
    except Exception:
        logger.warning("ops_people: penny usage lookup failed for %s", mask_email(uid))
    return out


async def _rows(cursor: str | None) -> tuple[list[dict], str | None]:
    allow = {d["key"]: d async for d in cols.allowed_signups_col.find({}) if d.get("key")}
    profiles: dict[str, dict] = {}
    async for d in cols.user_profiles_col.find({}, {"last_active_at": 1}):
        uid = d.get("_id")
        # Only real people: a profile id that is an email address.
        if isinstance(uid, str) and _EMAIL_RE.match(uid):
            profiles.setdefault(_key_of(uid), {"uid": uid, "last_active_at": None})
            prev = profiles[_key_of(uid)]["last_active_at"]
            la = d.get("last_active_at")
            if isinstance(la, datetime) and (prev is None or as_utc(la) > as_utc(prev)):
                profiles[_key_of(uid)]["last_active_at"] = la
    apple_ids = {_key_of(d["user_id"]) async for d in cols.linked_identities_col.find(
        {"provider": "apple"}, {"user_id": 1}) if d.get("user_id")}

    keys = sorted(set(allow) | set(profiles) | {_owner_key()})
    if cursor:
        keys = [k for k in keys if k > cursor]
    page = keys[:PAGE_SIZE]
    next_cursor = page[-1] if len(keys) > PAGE_SIZE else None

    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp or comparison, aware UTC
    sem = asyncio.Semaphore(_ENRICH_CONCURRENCY)

    async def build(key: str) -> dict:
        doc = allow.get(key)
        prof = profiles.get(key)
        owner = key == _owner_key()
        uid = prof["uid"] if prof else (doc or {}).get("email") or (PRIMARY_EMAIL if owner else key)
        invited_by = (doc or {}).get("invited_by")
        if doc is None:
            source = "open_signup"
        elif (doc.get("source") or invited_by) == "env_migration":
            source = "migrated"
        else:
            source = "invite"
        row = {
            "key": key,
            "email": uid,
            "owner": owner,
            "allowlist_status": (doc or {}).get("status") or "none",
            "source": "owner" if owner else source,
            "invited_at": _iso((doc or {}).get("created_at")),
            "signed_up": bool(prof) or owner,
            # Not stored anywhere: profiles carry no created_at.
            "signed_up_at": None,
            # Closest stored fact to a last sign-in (see module docstring).
            "last_active_at": _iso(prof["last_active_at"]) if prof else None,
            "sign_in_method": "Apple" if key in apple_ids else None,
        }
        if row["signed_up"]:
            async with sem:
                row.update(await _enrich(uid, now))
        else:
            row.update({"plan": None, "plan_status": None, "trial_ends_at": None, "on_trial": False,
                        "banks_connected": None, "accounts": None, "last_sync": None,
                        "penny_messages_this_month": None})
        return row

    return list(await asyncio.gather(*(build(k) for k in page))), next_cursor


async def _audit_list() -> list[dict]:
    docs = await cols.ops_audit_col.find({}).sort("at", -1).to_list(AUDIT_LIMIT)
    return [{"at": _iso(d.get("at")), "actor": d.get("actor"), "action": d.get("action"),
             "target": d.get("target"), "detail": d.get("detail")} for d in docs]


@router.get("")
async def list_people(cursor: str | None = None, user: dict = Depends(current_user)):
    _require_owner_session(user)
    rows, next_cursor = await _rows(cursor)
    return {
        "people": rows,
        "next_cursor": next_cursor,
        "audit": await _audit_list(),
        "not_recorded": ["signed_up_at", "sign_in_method"],
    }


@router.post("/invite")
async def invite(body: InviteBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    if _key_of(body.email) == _owner_key():
        raise HTTPException(400, "That is your own account. It always has access.")
    await invite_email(body.email, actor)
    await _audit(actor, "invite", body.email)
    logger.info("ops_people: invited %s", mask_email(body.email))
    return {"ok": True}


async def _set_status(key: str, status: str, actor: str, action: str) -> dict:
    if key == _owner_key():
        raise HTTPException(403, "This is the account owner. It can't be changed here.")
    doc = await cols.allowed_signups_col.find_one({"key": key})
    if not doc:
        raise HTTPException(404, "Not found")
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp or comparison, aware UTC
    if status == "revoked":
        update = {"$set": {"status": "revoked", "revoked_at": now, "updated_at": now}}
    else:
        update = {"$set": {"status": "invited", "updated_at": now}, "$unset": {"revoked_at": ""}}
    await cols.allowed_signups_col.update_one({"key": key}, update)
    await _audit(actor, action, doc.get("email") or key)
    logger.info("ops_people: %s %s", action, mask_email(doc.get("email") or key))
    return {"ok": True}


@router.post("/{key}/revoke")
async def revoke(key: str, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    # No row yet (an open sign-up account): a revoked row is created so the
    # block has something to live on.
    if key != _owner_key() and not await cols.allowed_signups_col.find_one({"key": key}):
        ids = await _profile_ids_for_key(key)
        if not ids:
            raise HTTPException(404, "Not found")
        now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp or comparison, aware UTC
        await cols.allowed_signups_col.insert_one(
            {"key": key, "email": ids[0].lower(), "status": "invited", "invited_by": "open_signup",
             "source": "open_signup", "note": None, "created_at": now, "updated_at": now})
    return await _set_status(key, "revoked", actor, "revoke")


@router.post("/{key}/restore")
async def restore(key: str, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    return await _set_status(key, "invited", actor, "restore")


@router.post("/{key}/erase")
async def erase(key: str, body: EraseBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    if key == _owner_key():
        raise HTTPException(403, "This is the account owner. It can't be removed.")
    doc = await cols.allowed_signups_col.find_one({"key": key})
    ids = await _profile_ids_for_key(key)
    if not doc and not ids:
        raise HTTPException(404, "Not found")
    target = ids[0] if ids else (doc.get("email") or key)
    if (body.confirm_email or "").strip().lower() != target.strip().lower():
        raise HTTPException(400, "The email you typed does not match.")
    masked = mask_email(target)
    # Same path as DELETE /account: revoke sessions, revoke consents, erase.
    removed: dict[str, int] = {}
    for uid in ids or [target]:
        for name, count in (await erase_account(uid)).items():
            removed[name] = removed.get(name, 0) + count
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp or comparison, aware UTC
    await cols.allowed_signups_col.update_one(
        {"key": key},
        {"$set": {"email": target.lower(), "status": "revoked", "revoked_at": now, "updated_at": now},
         "$setOnInsert": {"created_at": now, "invited_by": actor}},
        upsert=True,
    )
    # No full email of an erased person may remain in the audit trail.
    for variant in {target, target.lower(), (doc or {}).get("email")} - {None}:
        await cols.ops_audit_col.update_many({"target": variant}, {"$set": {"target": masked}})
    await _audit(actor, "erase", masked, f"{sum(removed.values())} records removed")
    logger.info("ops_people: erased %s", masked)
    return {"ok": True, "removed": removed}
