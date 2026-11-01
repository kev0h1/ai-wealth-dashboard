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

Revoke is access control, not erasure. DECISION (E12 review): it ends every way
a person can READ data through the API: sessions (app.core.auth.current_user and
POST /auth/session/validate), MCP OAuth access tokens (revoked_at is stamped on
that user's oauth_tokens rows at once, and resolve_mcp_principal and the refresh
grant also consult is_access_revoked). Their bank consents are deliberately LEFT
IN PLACE, so background sync and push notifications for a revoked user continue;
only Remove user (erase) revokes consents and deletes data.

The target of an action never appears in a URL or query string: rows carry an
opaque `id` (sha256 of the normalised allow-list key) and the server resolves it
from its own listing. Every id is of the canonical key (Gmail dots and
googlemail.com folded), so no spelling of the owner's address can slip past the
owner check; an id that resolves to nothing is a 404.

E13 access state. Every row carries `access`: "owner" | "allowed" | "no_access"
| "revoked", derived by app.core.allowlist.state_from_status, the same rule
sign-in (resolve_allowed_signup) and the live-session check (is_access_revoked)
use, so the page can never offer Revoke on someone sign-in already refuses.
  - POST /ops/people/{id}/allow   no_access -> allowed (an invited row, source
                                  "allowed_from_people"). Revoked people use Restore.
  - GET  /ops/people/backfill     preview: a COUNT of signed-up accounts with no
                                  allow-list row (never addresses).
  - POST /ops/people/backfill     body {"confirm": "ALLOW"}; creates invited rows
                                  (source "pre_list_backfill") for those accounts.
                                  Idempotent, never touches the owner or an existing
                                  row, one audit row with the count.
  - backend/scripts/backfill_allowlist.py does the same from a shell: dry run by
    default, --apply to write, refuses unless MONGO_DB is set explicitly, prints
    counts only. Both call app.services.allowlist_backfill.

Every action writes one `ops_audit` row. Logs and Sentry only ever see
mask_email(...); the page itself is the one place a full email is shown.
"""
import asyncio
import hashlib
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.allowlist import state_from_status
from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL, _gmail_key, is_signup_open, mask_email
from app.core.timeutil import as_utc
from app.db import collections as cols
from app.routers.admin_allowlist import _EMAIL_RE, invite_email
from app.routers.ops import _require_owner_session
from app.services import allowlist_backfill
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


class BackfillBody(BaseModel):
    confirm: str


def _key_of(uid: str) -> str:
    return _gmail_key((uid or "").strip().lower())


def _pid(key: str) -> str:
    """Opaque id for a person: sha256 of the normalised key. Safe in a URL."""
    return hashlib.sha256(_key_of(key).encode()).hexdigest()


async def _audit(actor: str, action: str, target: str, target_id: str, detail: str | None = None) -> None:
    await cols.ops_audit_col.insert_one(
        {"at": datetime.now(timezone.utc), "actor": actor, "action": action,  # naive-ok: persisted audit timestamp, aware UTC
         "target": target, "target_key": target_id, "detail": detail}
    )


async def _profile_ids_for_key(key: str) -> list[str]:
    """Every user_profiles _id that resolves to this allow-list key. Gmail
    ignores dots and googlemail.com, so one person can be stored under more
    than one spelling. Matching is case-insensitive, so it does not depend on
    every profile id having been lower-cased at creation."""
    local, _, domain = key.partition("@")
    if domain == "gmail.com":
        pattern = "^" + r"\.*".join(re.escape(c) for c in local) + r"\.*@(gmail|googlemail)\.com$"
    else:
        pattern = "^" + re.escape(key) + "$"
    query = {"_id": {"$regex": pattern, "$options": "i"}}
    return [d["_id"] async for d in cols.user_profiles_col.find(query, {"_id": 1})]


async def _resolve(pid: str) -> str:
    """Id -> canonical key, from the server's own listing. The owner check runs
    first, on the id of the canonical owner key. Unknown ids are 404."""
    if pid == _pid(_owner_key()):
        raise HTTPException(403, "This is the account owner. It can't be changed here.")
    keys = {d["key"] async for d in cols.allowed_signups_col.find({}, {"key": 1}) if d.get("key")}
    async for d in cols.user_profiles_col.find({}, {"_id": 1}):
        if isinstance(d.get("_id"), str) and _EMAIL_RE.match(d["_id"]):
            keys.add(_key_of(d["_id"]))
    for k in keys:
        if _pid(k) == pid:
            if _key_of(k) == _owner_key():
                raise HTTPException(403, "This is the account owner. It can't be changed here.")
            return k
    raise HTTPException(404, "Not found")


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
    """One page of people. `cursor` is opaque: the id of the last row of the
    previous page (never an email)."""
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
        positions = [i for i, k in enumerate(keys) if _pid(k) == cursor]
        if not positions:
            raise HTTPException(400, "Unknown page.")
        keys = keys[positions[0] + 1:]
    page = keys[:PAGE_SIZE]
    next_cursor = _pid(page[-1]) if len(keys) > PAGE_SIZE else None

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
        elif doc.get("source") == "pre_list_backfill":
            source = "backfill"
        else:
            source = "invite"
        row = {
            "id": _pid(key),
            "email": uid,
            "owner": owner,
            "allowlist_status": (doc or {}).get("status") or "none",
            "access": state_from_status(owner, (doc or {}).get("status")),
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
    try:
        from app.services import runtime_settings
        await runtime_settings.ensure_fresh()
    except Exception:
        logger.warning("ops_people: runtime settings refresh failed")
    return {
        "open_signup": bool(is_signup_open()),
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
    await _audit(actor, "invite", body.email, _pid(body.email))
    logger.info("ops_people: invited %s", mask_email(body.email))
    return {"ok": True}


@router.get("/backfill")
async def backfill_preview(user: dict = Depends(current_user)):
    _require_owner_session(user)
    return {"count": await allowlist_backfill.preview_count()}


@router.post("/backfill")
async def backfill_apply(body: BackfillBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    if (body.confirm or "").strip() != "ALLOW":
        raise HTTPException(400, "Type ALLOW to confirm.")
    added = await allowlist_backfill.apply_backfill()
    await _audit(actor, "backfill", "signed-up accounts", "backfill", f"{added} accounts allowed")
    logger.info("ops_people: backfill allowed %d accounts", added)
    return {"ok": True, "added": added}


@router.post("/{pid}/allow")
async def allow(pid: str, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    key = await _resolve(pid)
    doc = await cols.allowed_signups_col.find_one({"key": key})
    state = state_from_status(False, (doc or {}).get("status"))
    if state == "revoked":
        raise HTTPException(409, "This person's access was revoked. Use Restore instead.")
    if state == "allowed":
        return {"ok": True}
    ids = await _profile_ids_for_key(key)
    email = (ids[0] if ids else (doc or {}).get("email") or key).strip().lower()
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    await cols.allowed_signups_col.update_one(
        {"key": key},
        {"$set": {"email": email, "status": "invited", "invited_by": actor,
                  "source": "allowed_from_people", "updated_at": now},
         "$unset": {"revoked_at": ""},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    await _audit(actor, "allow", email, pid)
    logger.info("ops_people: allow %s", mask_email(key))
    return {"ok": True}


async def _revoke_oauth_tokens(variants: set[str]) -> None:
    """A live MCP access token must die at once, not at its own expiry."""
    now = datetime.now(timezone.utc)  # naive-ok: persisted revoke timestamp, aware UTC
    await cols.oauth_tokens_col.update_many(
        {"uid": {"$in": sorted(variants)}, "revoked_at": None}, {"$set": {"revoked_at": now}},
    )


@router.post("/{pid}/revoke")
async def revoke(pid: str, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    key = await _resolve(pid)
    ids = await _profile_ids_for_key(key)
    doc = await cols.allowed_signups_col.find_one({"key": key})
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    if doc is None:
        # An open sign-up account with no row yet: a revoked row is created so
        # the block has something to live on.
        await cols.allowed_signups_col.insert_one(
            {"key": key, "email": (ids[0] if ids else key).lower(), "status": "revoked",
             "invited_by": "open_signup", "source": "open_signup", "note": None,
             "created_at": now, "updated_at": now, "revoked_at": now})
    else:
        await cols.allowed_signups_col.update_one(
            {"key": key}, {"$set": {"status": "revoked", "revoked_at": now, "updated_at": now}})
    await _revoke_oauth_tokens({i.strip().lower() for i in ids} | {key, ((doc or {}).get("email") or key).lower()})
    await _audit(actor, "revoke", (doc or {}).get("email") or (ids[0] if ids else key), pid)
    logger.info("ops_people: revoke %s", mask_email(key))
    return {"ok": True}


@router.post("/{pid}/restore")
async def restore(pid: str, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    key = await _resolve(pid)
    doc = await cols.allowed_signups_col.find_one({"key": key})
    if not doc:
        raise HTTPException(404, "Not found")
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    await cols.allowed_signups_col.update_one(
        {"key": key}, {"$set": {"status": "invited", "updated_at": now}, "$unset": {"revoked_at": ""}})
    await _audit(actor, "restore", doc.get("email") or key, pid)
    logger.info("ops_people: restore %s", mask_email(key))
    return {"ok": True}


@router.post("/{pid}/erase")
async def erase(pid: str, body: EraseBody, user: dict = Depends(current_user)):
    actor = _require_owner_session(user)
    key = await _resolve(pid)
    doc = await cols.allowed_signups_col.find_one({"key": key})
    ids = await _profile_ids_for_key(key)
    target = ids[0] if ids else ((doc or {}).get("email") or key)
    if (body.confirm_email or "").strip().lower() != target.strip().lower():
        raise HTTPException(400, "The email you typed does not match.")
    masked = mask_email(target)
    # Same path as DELETE /account: revoke sessions, revoke consents, erase.
    removed: dict[str, int] = {}
    for uid in ids or [target]:
        for name, count in (await erase_account(uid)).items():
            removed[name] = removed.get(name, 0) + count
    now = datetime.now(timezone.utc)  # naive-ok: persisted timestamp, aware UTC
    # Suppression record: key and status only. Email field dropped; the
    # normalised key remains as the suppression key. Note and inviter dropped too.
    await cols.allowed_signups_col.update_one(
        {"key": key},
        {"$set": {"status": "revoked", "revoked_at": now, "updated_at": now},
         "$unset": {"email": "", "note": "", "invited_by": ""},
         "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    # No full email of an erased person may remain in the audit trail: rows are
    # matched on the hashed normalised key, whatever spelling they were written with.
    await cols.ops_audit_col.update_many({"target_key": pid}, {"$set": {"target": masked}})
    detail = f"{sum(removed.values())} records removed"
    if removed.get("connection_errors"):
        detail += f", {removed['connection_errors']} bank connections could not be revoked"
    await _audit(actor, "erase", masked, pid, detail)
    logger.info("ops_people: erased %s", masked)
    return {"ok": True, "removed": removed}
