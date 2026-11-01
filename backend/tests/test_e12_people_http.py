"""E12 review round: the People page and the revoke rules, exercised through the
real ASGI app (TestClient, auth_middleware, ROUTE_SCOPES, current_user), not by
calling handlers directly.

Collections are in-memory stand-ins (the Motor client is bound to one event
loop and TestClient runs each request in its own), patched where each module
looks them up.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from starlette.testclient import TestClient

import app.core.allowlist as allowlist_module
import app.core.auth as auth_mod
import app.core.bot_credentials as bot_credentials
import app.db.collections as db_collections
import app.main as main_module
import app.routers.admin_allowlist as admin_allowlist
import app.routers.mcp as mcp
import app.routers.oauth as oauth
import app.routers.ops_people as people
import app.services.retention as retention
from app.core.config import PRIMARY_EMAIL, serializer
from test_e12_people import Col

ALICE = "alice@example.com"


def _bearer(email: str) -> dict:
    return {"Authorization": "Bearer " + serializer.dumps({"name": "T", "email": email})}


@pytest.fixture()
def world(monkeypatch):
    w = type("World", (), {})()
    w.allow, w.profiles, w.audit, w.tokens = Col(), Col(), Col(), Col()
    w.erased = []
    for name, col in (("allowed_signups_col", w.allow), ("user_profiles_col", w.profiles),
                      ("ops_audit_col", w.audit), ("oauth_tokens_col", w.tokens),
                      ("linked_identities_col", Col()), ("finexer_consents_col", Col()),
                      ("connections_col", Col()), ("accounts_col", Col()),
                      ("session_tombstones_col", Col())):
        monkeypatch.setattr(db_collections, name, col)
    monkeypatch.setattr(allowlist_module, "allowed_signups_col", w.allow)
    monkeypatch.setattr(admin_allowlist, "allowed_signups_col", w.allow)
    monkeypatch.setattr(mcp, "oauth_tokens_col", w.tokens)
    monkeypatch.setattr(oauth, "oauth_tokens_col", w.tokens)

    async def none(*a, **k):
        return None

    for fn in ("check_catch_all_ip_limit", "check_catch_all_user_limit"):
        monkeypatch.setattr(auth_mod.ratelimit, fn, none)
    monkeypatch.setattr(auth_mod, "check_rate_limit", none)
    monkeypatch.setattr(retention, "stamp_activity", none)
    monkeypatch.setattr(bot_credentials, "record_use", none)
    monkeypatch.setattr(bot_credentials, "record_unknown_attempt", none)

    async def bot(token):
        return {"bot_name": "ci", "scopes": sorted(bot_credentials.SCOPES)} if token.startswith("sorted_bot_") else None

    monkeypatch.setattr(bot_credentials, "resolve_bot_credential", bot)

    async def enrich(uid, now):
        return {"plan": "Plus", "plan_status": "active", "trial_ends_at": None, "on_trial": False,
                "banks_connected": 0, "accounts": 0, "last_sync": None, "penny_messages_this_month": 0}

    monkeypatch.setattr(people, "_enrich", enrich)

    async def erase(uid):
        w.erased.append(uid)
        return {"transactions": 1, "connection_errors": 2}

    monkeypatch.setattr(people, "erase_account", erase)
    monkeypatch.setattr(auth_mod, "MCP_CONNECTOR_ENABLED", True)
    w.client = TestClient(main_module.build_app(True))
    return w


PID = people._pid(ALICE)
ROUTES = [
    ("GET", "/ops/people", None),
    ("POST", "/ops/people/invite", {"email": ALICE}),
    ("POST", f"/ops/people/{PID}/revoke", None),
    ("POST", f"/ops/people/{PID}/restore", None),
    ("POST", f"/ops/people/{PID}/erase", {"confirm_email": ALICE}),
]


# ── item 4: every route, through the middleware ──────────────────────────

@pytest.mark.parametrize("method,path,body", ROUTES)
def test_no_credential_is_401(world, method, path, body):
    assert world.client.request(method, path, json=body).status_code == 401


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_bot_bearer_is_refused_even_with_every_scope(world, method, path, body):
    r = world.client.request(method, path, json=body, headers={"Authorization": "Bearer sorted_bot_x"})
    assert r.status_code in (401, 403)
    assert world.audit.docs == [] and world.erased == []


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_oauth_access_token_is_refused_off_the_mcp_path(world, method, path, body):
    r = world.client.request(method, path, json=body, headers={"Authorization": "Bearer sorted_at_abc"})
    assert r.status_code in (401, 403)


@pytest.mark.parametrize("method,path,body", ROUTES)
def test_non_owner_session_is_403(world, method, path, body):
    r = world.client.request(method, path, json=body, headers=_bearer("someone@example.com"))
    assert r.status_code == 403
    assert world.audit.docs == [] and world.erased == []


def test_owner_session_lists_people_over_http(world):
    world.profiles.docs.append({"_id": ALICE})
    r = world.client.get("/ops/people", headers=_bearer(PRIMARY_EMAIL))
    assert r.status_code == 200
    rows = r.json()["people"]
    assert {p["email"] for p in rows} == {PRIMARY_EMAIL, ALICE}
    assert all("key" not in p and len(p["id"]) == 64 for p in rows)


# ── item 2: the owner guard on every spelling ────────────────────────────

def _owner_spellings():
    local, _, domain = PRIMARY_EMAIL.partition("@")
    return [PRIMARY_EMAIL.upper(), f"{local[:3]}.{local[3:]}@{domain}", f"{local}@googlemail.com",
            f" {PRIMARY_EMAIL} "]


@pytest.mark.parametrize("spelling", _owner_spellings())
def test_owner_is_403_on_revoke_restore_erase_for_any_spelling(world, spelling):
    pid = people._pid(spelling)
    assert pid == people._pid(PRIMARY_EMAIL)  # one canonical id
    h = _bearer(PRIMARY_EMAIL)
    assert world.client.post(f"/ops/people/{pid}/revoke", headers=h).status_code == 403
    assert world.client.post(f"/ops/people/{pid}/restore", headers=h).status_code == 403
    r = world.client.post(f"/ops/people/{pid}/erase", json={"confirm_email": spelling.strip()}, headers=h)
    assert r.status_code == 403
    assert world.erased == [] and world.audit.docs == [] and world.allow.docs == []


def test_a_raw_hash_of_a_non_canonical_spelling_resolves_to_nothing(world):
    raw = hashlib.sha256(PRIMARY_EMAIL.upper().encode()).hexdigest()
    h = _bearer(PRIMARY_EMAIL)
    for action, body in (("revoke", None), ("restore", None), ("erase", {"confirm_email": PRIMARY_EMAIL})):
        assert world.client.post(f"/ops/people/{raw}/{action}", json=body, headers=h).status_code == 404
    assert world.erased == [] and world.allow.docs == []


def test_dotted_non_owner_revoke_blocks_the_canonical_key(world):
    world.profiles.docs.append({"_id": "al.ice.smith@gmail.com"})
    pid = people._pid("alicesmith@gmail.com")
    assert world.client.post(f"/ops/people/{pid}/revoke", headers=_bearer(PRIMARY_EMAIL)).status_code == 200
    assert [d["key"] for d in world.allow.docs] == ["alicesmith@gmail.com"]
    assert world.allow.docs[0]["status"] == "revoked"
    # Their next request, under any spelling of the address, is signed out.
    for spelling in ("al.ice.smith@gmail.com", "alicesmith@googlemail.com", "ALICESMITH@gmail.com"):
        r = world.client.post("/auth/session/validate", headers=_bearer(spelling))
        assert r.status_code == 401


# ── item 3: opaque ids and cursors ───────────────────────────────────────

def test_no_email_in_any_row_id_or_cursor(world, monkeypatch):
    monkeypatch.setattr(people, "PAGE_SIZE", 2)
    for n in range(5):
        world.allow.docs.append({"key": f"u{n}@example.com", "email": f"u{n}@example.com", "status": "invited"})
    h = _bearer(PRIMARY_EMAIL)
    first = world.client.get("/ops/people", headers=h).json()
    assert first["next_cursor"] and "@" not in first["next_cursor"]
    second = world.client.get("/ops/people", params={"cursor": first["next_cursor"]}, headers=h).json()
    assert {p["id"] for p in first["people"]}.isdisjoint({p["id"] for p in second["people"]})
    assert all("@" not in p["id"] for p in first["people"] + second["people"])
    assert world.client.get("/ops/people", params={"cursor": "nope"}, headers=h).status_code == 400


# ── item 1: MCP and the refresh grant ────────────────────────────────────

def _access_token(w, uid, *, revoked=None):
    raw = "sorted_at_" + secrets.token_urlsafe(16)
    h = hashlib.sha256(raw.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    w.tokens.docs.append({"_id": h, "kind": "access", "client_id": "c1", "client_name": "Claude", "uid": uid,
                          "scopes": ["accounts:read"], "created_at": now, "expires_at": now + timedelta(hours=1),
                          "last_used_at": None, "revoked_at": revoked, "pair_id": "p", "origin_code_hash": "o"})
    return raw


def _mcp_call(w, raw):
    return w.client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
                         headers={"Authorization": f"Bearer {raw}"})


def test_mcp_access_token_works_until_the_owner_revokes_the_person(world):
    world.allow.docs.append({"key": ALICE, "email": ALICE, "status": "invited"})
    world.profiles.docs.append({"_id": ALICE})
    raw = _access_token(world, ALICE)
    assert _mcp_call(world, raw).status_code == 200
    assert world.client.post(f"/ops/people/{PID}/revoke", headers=_bearer(PRIMARY_EMAIL)).status_code == 200
    # revoke stamped the token itself ...
    assert world.tokens.docs[0]["revoked_at"] is not None
    assert _mcp_call(world, raw).status_code == 401


def test_mcp_refuses_a_revoked_allowlist_row_even_if_the_token_row_is_live(world):
    world.allow.docs.append({"key": ALICE, "email": ALICE, "status": "revoked"})
    assert _mcp_call(world, _access_token(world, ALICE)).status_code == 401


def test_mcp_fails_closed_with_503_when_the_allowlist_lookup_errors(world, monkeypatch):
    async def boom(email):
        raise RuntimeError("down")
    monkeypatch.setattr(mcp, "is_access_revoked", boom)
    assert _mcp_call(world, _access_token(world, ALICE)).status_code == 503


def _refresh_token(w, uid):
    raw = "sorted_rt_" + secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    w.tokens.docs.append({"_id": hashlib.sha256(raw.encode()).hexdigest(), "kind": "refresh", "client_id": "c1",
                          "uid": uid, "scopes": ["accounts:read"], "created_at": now,
                          "expires_at": now + timedelta(days=30), "revoked_at": None,
                          "pair_id": "p", "origin_code_hash": "o"})
    return raw


def _refresh(w, raw):
    return w.client.post("/auth/oauth/token", data={"grant_type": "refresh_token", "refresh_token": raw,
                                                    "client_id": "c1"})


def test_refresh_grant_is_invalid_grant_for_a_revoked_person_and_mints_nothing(world):
    world.allow.docs.append({"key": ALICE, "email": ALICE, "status": "revoked"})
    before = len(world.tokens.docs)
    raw = _refresh_token(world, ALICE)
    r = _refresh(world, raw)
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"
    assert len(world.tokens.docs) == before + 1  # only the seeded refresh row


def test_refresh_grant_fails_closed_with_503_when_the_allowlist_lookup_errors(world, monkeypatch):
    async def boom(email):
        raise RuntimeError("down")
    monkeypatch.setattr(oauth, "is_access_revoked", boom)
    assert _refresh(world, _refresh_token(world, ALICE)).status_code == 503


# ── item 5 and 6: erase ──────────────────────────────────────────────────

def test_erase_keeps_only_a_minimal_block_row_and_masks_audit_by_hashed_key(world):
    world.profiles.docs.append({"_id": "A.lice@gmail.com"})
    h = _bearer(PRIMARY_EMAIL)
    pid = people._pid("alice@gmail.com")
    world.allow.docs.append({"key": "alice@gmail.com", "email": "alice@gmail.com", "note": "friend",
                             "invited_by": PRIMARY_EMAIL, "status": "invited"})
    # earlier audit rows written under two different spellings of the address
    world.audit.docs += [
        {"at": datetime(2026, 10, 1), "actor": PRIMARY_EMAIL, "action": "invite",
         "target": "alice@gmail.com", "target_key": pid},
        {"at": datetime(2026, 10, 2), "actor": PRIMARY_EMAIL, "action": "revoke",
         "target": "a.lice@googlemail.com", "target_key": pid},
    ]
    r = world.client.post(f"/ops/people/{pid}/erase", json={"confirm_email": "a.lice@gmail.com"}, headers=h)
    assert r.status_code == 200, r.text
    assert world.erased == ["A.lice@gmail.com"]
    row = world.allow.docs[0]
    assert row["key"] == "alice@gmail.com" and row["status"] == "revoked"
    assert not {"email", "note", "invited_by"} & set(row)
    assert all("lice@" not in str(a.get("target")) or "***" in a["target"] for a in world.audit.docs)
    assert "alice@gmail.com" not in str([a["target"] for a in world.audit.docs])
    assert "bank connections could not be revoked" in world.audit.docs[-1]["detail"]


def test_non_gmail_profile_lookup_is_case_insensitive(world):
    world.profiles.docs.append({"_id": "Bob.Smith@Example.COM"})
    ids = people.asyncio.run(people._profile_ids_for_key("bob.smith@example.com"))
    assert ids == ["Bob.Smith@Example.COM"]
