"""E12: the owner-only People page backend (app/routers/ops_people.py).

Handlers are awaited directly (no HTTP client), against in-memory stand-ins
for the collections, same convention as test_a174_allowlist_db_only.py.
"""
import asyncio
import re
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import app.core.allowlist as allowlist_module
import app.core.auth as auth_module
import app.db.collections as db_collections
import app.routers.admin_allowlist as admin_allowlist
import app.routers.ops_people as people
from app.core.config import PRIMARY_EMAIL, serializer

OWNER = {"email": PRIMARY_EMAIL, "name": "Owner"}
OTHER = {"email": "someone.else@example.com", "name": "Other"}
BOT = {"name": "Bot", "email": None, "bot_name": "ci", "scopes": ["admin:allowlist"]}
SCOPED_OWNER = {"email": PRIMARY_EMAIL, "name": "Owner", "scopes": ["mcp:read"]}
ALICE = "alice@example.com"
BOB = "bob@example.com"


def _run(coro):
    return asyncio.run(coro)


def _match(doc, query):
    for k, v in query.items():
        if isinstance(v, dict) and "$regex" in v:
            flags = re.I if "i" in v.get("$options", "") else 0
            if not re.search(v["$regex"], str(doc.get(k, "")), flags):
                return False
        elif doc.get(k) != v:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction=1):
        self.docs = sorted(self.docs, key=lambda d: d.get(key) or datetime.min, reverse=direction < 0)
        return self

    async def to_list(self, n):
        return list(self.docs if n is None else self.docs[:n])

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None, **kw):
        return _Cursor([dict(d) for d in self.docs if _match(d, query or {})])

    async def find_one(self, query, projection=None, **kw):
        for d in self.docs:
            if _match(d, query):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def count_documents(self, query):
        return sum(1 for d in self.docs if _match(d, query))

    async def update_one(self, query, update, upsert=False):
        for d in self.docs:
            if _match(d, query):
                d.update(update.get("$set", {}))
                for k in update.get("$unset", {}):
                    d.pop(k, None)
                return
        if upsert:
            d = dict(query)
            d.update(update.get("$setOnInsert", {}))
            d.update(update.get("$set", {}))
            self.docs.append(d)

    async def update_many(self, query, update):
        for d in self.docs:
            if _match(d, query):
                d.update(update.get("$set", {}))


@pytest.fixture()
def env(monkeypatch):
    c = type("Env", (), {})()
    c.allow = Col()
    c.profiles = Col()
    c.audit = Col()
    c.linked = Col()
    c.consents = Col()
    c.conns = Col()
    c.accounts = Col()
    for name, col in (("allowed_signups_col", c.allow), ("user_profiles_col", c.profiles),
                      ("ops_audit_col", c.audit), ("linked_identities_col", c.linked),
                      ("finexer_consents_col", c.consents), ("connections_col", c.conns),
                      ("accounts_col", c.accounts), ("session_tombstones_col", Col())):
        monkeypatch.setattr(db_collections, name, col)
    monkeypatch.setattr(allowlist_module, "allowed_signups_col", c.allow)
    monkeypatch.setattr(admin_allowlist, "allowed_signups_col", c.allow)

    async def fake_enrich(uid, now):
        return {"plan": "Plus", "plan_status": "active", "trial_ends_at": None, "on_trial": False,
                "banks_connected": 1, "accounts": 2, "last_sync": None, "penny_messages_this_month": 3}

    monkeypatch.setattr(people, "_enrich", fake_enrich)
    c.erased = []

    async def fake_erase(uid):
        c.erased.append(uid)
        return {"transactions": 4}

    monkeypatch.setattr(people, "erase_account", fake_erase)
    return c


def _key(email):
    return people._key_of(email)


# ── auth ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("who", [OTHER, BOT, SCOPED_OWNER])
def test_every_route_refuses_everyone_but_the_owner_session(env, who):
    calls = [
        people.list_people(user=who),
        people.invite(people.InviteBody(email=ALICE), user=who),
        people.revoke(_key(ALICE), user=who),
        people.restore(_key(ALICE), user=who),
        people.erase(_key(ALICE), people.EraseBody(confirm_email=ALICE), user=who),
    ]
    for call in calls:
        with pytest.raises(HTTPException) as exc:
            _run(call)
        assert exc.value.status_code == 403
    assert env.audit.docs == [] and env.erased == []


def test_bot_scopes_do_not_include_people_routes():
    from app.core.bot_credentials import ROUTE_SCOPES
    assert not any("ops/people" in p.pattern for _, p, _ in ROUTE_SCOPES)


# ── list ─────────────────────────────────────────────────────────────────

def test_list_joins_allowlist_with_profiles_and_flags_owner(env):
    env.allow.docs += [
        {"key": _key(ALICE), "email": ALICE, "status": "invited", "invited_by": PRIMARY_EMAIL,
         "created_at": datetime(2026, 10, 1)},
        {"key": _key(BOB), "email": BOB, "status": "revoked", "invited_by": "env_migration",
         "created_at": datetime(2026, 9, 1)},
    ]
    env.profiles.docs += [{"_id": ALICE, "last_active_at": datetime(2026, 10, 30, 8, 0)},
                          {"_id": "walkin@example.com"}]
    res = _run(people.list_people(user=OWNER))
    rows = {r["email"]: r for r in res["people"]}
    assert rows[PRIMARY_EMAIL]["owner"] is True
    assert rows[ALICE]["signed_up"] is True and rows[ALICE]["allowlist_status"] == "invited"
    assert rows[ALICE]["last_active_at"].startswith("2026-10-30T08:00")
    assert rows[ALICE]["signed_up_at"] is None  # not recorded anywhere
    assert rows[BOB]["signed_up"] is False and rows[BOB]["allowlist_status"] == "revoked"
    assert rows[BOB]["source"] == "migrated" and rows[BOB]["plan"] is None
    assert rows["walkin@example.com"]["allowlist_status"] == "none"
    assert rows["walkin@example.com"]["source"] == "open_signup"
    assert res["next_cursor"] is None


def test_list_never_includes_bot_or_non_email_profile_rows(env):
    env.profiles.docs += [{"_id": "Bot"}, {"_id": "unknown"}, {"_id": None}]
    res = _run(people.list_people(user=OWNER))
    assert [r["email"] for r in res["people"]] == [PRIMARY_EMAIL]


def test_list_paginates_with_a_cursor(env, monkeypatch):
    monkeypatch.setattr(people, "PAGE_SIZE", 2)
    for n in range(5):
        env.allow.docs.append({"key": f"u{n}@example.com", "email": f"u{n}@example.com", "status": "invited"})
    first = _run(people.list_people(user=OWNER))
    assert len(first["people"]) == 2 and first["next_cursor"]
    seen = [r["key"] for r in first["people"]]
    cursor = first["next_cursor"]
    while cursor:
        page = _run(people.list_people(cursor=cursor, user=OWNER))
        seen += [r["key"] for r in page["people"]]
        cursor = page["next_cursor"]
    assert len(seen) == len(set(seen)) == 6


# ── invite ───────────────────────────────────────────────────────────────

def test_invite_validates_lowercases_and_audits(env):
    with pytest.raises(ValidationError):
        people.InviteBody(email="not an email")
    body = people.InviteBody(email="  Alice@Example.COM ")
    assert body.email == ALICE
    _run(people.invite(body, user=OWNER))
    doc = env.allow.docs[0]
    assert doc["email"] == ALICE and doc["status"] == "invited"
    assert env.audit.docs[0]["action"] == "invite" and env.audit.docs[0]["actor"] == PRIMARY_EMAIL


def test_reinviting_a_revoked_email_restores_it_without_a_duplicate(env):
    _run(people.invite(people.InviteBody(email=ALICE), user=OWNER))
    _run(people.revoke(_key(ALICE), user=OWNER))
    assert env.allow.docs[0]["status"] == "revoked"
    _run(people.invite(people.InviteBody(email=ALICE), user=OWNER))
    assert len(env.allow.docs) == 1
    assert env.allow.docs[0]["status"] == "invited" and "revoked_at" not in env.allow.docs[0]


def test_inviting_the_owner_is_refused_and_writes_nothing(env):
    with pytest.raises(HTTPException) as exc:
        _run(people.invite(people.InviteBody(email=PRIMARY_EMAIL.upper()), user=OWNER))
    assert exc.value.status_code == 400
    assert env.allow.docs == [] and env.audit.docs == []


# ── revoke / restore ─────────────────────────────────────────────────────

def _token(email):
    return serializer.dumps({"name": "T", "email": email})


class _Req:
    def __init__(self, token):
        self.headers = {"Authorization": f"Bearer {token}"}
        self.method = "GET"

        class _U:
            path = "/profile"
        self.url = _U()


def test_owner_row_is_never_revocable_or_erasable(env):
    owner_key = _key(PRIMARY_EMAIL)
    for call in (people.revoke(owner_key, user=OWNER), people.restore(owner_key, user=OWNER),
                 people.erase(owner_key, people.EraseBody(confirm_email=PRIMARY_EMAIL), user=OWNER)):
        with pytest.raises(HTTPException) as exc:
            _run(call)
        assert exc.value.status_code == 403
    assert env.allow.docs == [] and env.erased == [] and env.audit.docs == []


def test_revoked_person_is_signed_out_at_their_next_request_and_restore_reverses_it(env, monkeypatch):
    async def no_stamp(uid, now=None):
        return None
    import app.services.retention as retention
    monkeypatch.setattr(retention, "stamp_activity", no_stamp)

    _run(people.invite(people.InviteBody(email=ALICE), user=OWNER))
    token = _token(ALICE)
    assert _run(auth_module.current_user(_Req(token)))["email"] == ALICE

    _run(people.revoke(_key(ALICE), user=OWNER))
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.current_user(_Req(token)))
    assert exc.value.status_code == 401

    _run(people.restore(_key(ALICE), user=OWNER))
    assert _run(auth_module.current_user(_Req(token)))["email"] == ALICE
    assert [a["action"] for a in env.audit.docs] == ["invite", "revoke", "restore"]


def test_revoking_an_open_signup_account_with_no_row_creates_the_block(env):
    env.profiles.docs.append({"_id": "walkin@example.com"})
    _run(people.revoke(_key("walkin@example.com"), user=OWNER))
    assert env.allow.docs[0]["status"] == "revoked"
    assert _run(allowlist_module.is_access_revoked("walkin@example.com")) is True


def test_revoke_unknown_key_is_404(env):
    with pytest.raises(HTTPException) as exc:
        _run(people.revoke("nobody@example.com", user=OWNER))
    assert exc.value.status_code == 404


def test_owner_is_never_reported_revoked(env):
    env.allow.docs.append({"key": _key(PRIMARY_EMAIL), "status": "revoked"})
    assert _run(allowlist_module.is_access_revoked(PRIMARY_EMAIL)) is False


# ── erase ────────────────────────────────────────────────────────────────

def test_erase_refuses_a_mismatched_confirmation_and_touches_nothing(env):
    env.profiles.docs.append({"_id": ALICE})
    env.allow.docs.append({"key": _key(ALICE), "email": ALICE, "status": "invited"})
    with pytest.raises(HTTPException) as exc:
        _run(people.erase(_key(ALICE), people.EraseBody(confirm_email=BOB), user=OWNER))
    assert exc.value.status_code == 400
    assert env.erased == [] and env.audit.docs == []
    assert env.allow.docs[0]["status"] == "invited"


def test_erase_calls_the_shared_path_revokes_the_row_and_masks_the_audit(env):
    env.profiles.docs.append({"_id": ALICE})
    _run(people.invite(people.InviteBody(email=ALICE), user=OWNER))
    out = _run(people.erase(_key(ALICE), people.EraseBody(confirm_email=" Alice@Example.com "), user=OWNER))
    assert env.erased == [ALICE]
    assert out["removed"] == {"transactions": 4}
    assert env.allow.docs[0]["status"] == "revoked"
    targets = [a["target"] for a in env.audit.docs]
    assert targets == ["al***@example.com", "al***@example.com"]
    assert [a["action"] for a in env.audit.docs] == ["invite", "erase"]
    assert all(ALICE not in str(a) for a in env.audit.docs)


def test_profile_delete_and_people_erase_share_one_function():
    import app.routers.profile as profile_router
    import app.services.account_erasure as shared
    assert profile_router.erase_account is shared.erase_account
    assert people.erase_account is shared.erase_account


def test_erase_is_wired_to_revoke_sessions_then_erase_user(monkeypatch):
    import app.services.account_erasure as shared
    calls = []

    async def rev(uid):
        calls.append(("revoke", uid))

    async def era(uid):
        calls.append(("erase", uid))
        return {}

    monkeypatch.setattr(shared, "revoke_sessions", rev)
    monkeypatch.setattr(shared, "erase_user", era)
    _run(shared.erase_account(ALICE))
    assert calls == [("revoke", ALICE), ("erase", ALICE)]


def test_audit_list_is_newest_first_and_capped(env, monkeypatch):
    for n in range(3):
        env.audit.docs.append({"at": datetime(2026, 10, 1 + n), "actor": PRIMARY_EMAIL,
                               "action": "invite", "target": f"u{n}@example.com", "detail": None})
    res = _run(people.list_people(user=OWNER))
    assert [a["target"] for a in res["audit"]] == ["u2@example.com", "u1@example.com", "u0@example.com"]


def test_no_email_reaches_a_log_line(env, caplog):
    import logging
    caplog.set_level(logging.INFO)
    _run(people.invite(people.InviteBody(email=ALICE), user=OWNER))
    _run(people.revoke(_key(ALICE), user=OWNER))
    assert ALICE not in caplog.text


def test_gmail_dot_variants_resolve_to_one_profile(env):
    env.profiles.docs += [{"_id": "a.b.c@gmail.com"}, {"_id": "abd@gmail.com"}, {"_id": "abc@googlemail.com"}]
    ids = _run(people._profile_ids_for_key(people._key_of("abc@gmail.com")))
    assert sorted(ids) == ["a.b.c@gmail.com", "abc@googlemail.com"]
