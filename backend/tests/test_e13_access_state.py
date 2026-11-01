"""E13: one access-state rule for sign-in and the People page, the allow action,
and the pre-list backfill (service, routes through the real ASGI app, script).
"""
import asyncio
import subprocess
import sys
from pathlib import Path

import pytest

import app.core.allowlist as al
import app.routers.ops_people as people
from app.core.config import PRIMARY_EMAIL
from test_e12_people import Col, OTHER, BOT, SCOPED_OWNER, OWNER, env  # noqa: F401
from test_e12_people_http import _bearer, world  # noqa: F401

ALICE = "alice@example.com"
GM = "al.ice.smith@gmail.com"


def _run(coro):
    return asyncio.run(coro)


def _key(e):
    return people._key_of(e)


def _owner_spellings():
    local, _, domain = PRIMARY_EMAIL.partition("@")
    return [PRIMARY_EMAIL, PRIMARY_EMAIL.upper(), f"{local[:3]}.{local[3:]}@{domain}",
            f"{local}@googlemail.com", f" {PRIMARY_EMAIL} "]


def _seed(env):
    env.allow.docs += [
        {"key": _key(ALICE), "email": ALICE, "status": "invited"},
        {"key": _key("bob@example.com"), "email": "bob@example.com", "status": "revoked"},
        {"key": _key(GM), "email": GM, "status": "invited"},
    ]


CASES = [
    (ALICE, "allowed"),
    ("ALICE@example.com", "allowed"),
    ("bob@example.com", "revoked"),
    ("nobody@example.com", "no_access"),
    (GM, "allowed"),
    ("alicesmith@googlemail.com", "allowed"),
    ("", "no_access"),
] + [(s, "owner") for s in _owner_spellings()]


@pytest.mark.parametrize("email,expected", CASES)
def test_access_state_and_the_sign_in_paths_agree(env, email, expected):
    _seed(env)
    assert _run(al.access_state(email)) == expected
    can_sign_in = _run(al.resolve_allowed_signup(email)) is not None
    assert can_sign_in == (expected in ("owner", "allowed"))
    assert _run(al.is_access_revoked(email)) == (expected == "revoked")


def test_state_from_status_is_the_single_rule():
    assert al.state_from_status(True, "revoked") == "owner"
    assert al.state_from_status(False, "invited") == "allowed"
    assert al.state_from_status(False, "revoked") == "revoked"
    assert al.state_from_status(False, None) == "no_access"
    assert al.state_from_status(False, "weird") == "no_access"


def test_mongo_failure_fails_closed(env, monkeypatch):
    class Boom:
        async def find_one(self, *a, **k):
            raise RuntimeError("down")
    monkeypatch.setattr(al, "allowed_signups_col", Boom())
    assert _run(al.resolve_allowed_signup(ALICE)) is None
    with pytest.raises(RuntimeError):
        _run(al.is_access_revoked(ALICE))
    with pytest.raises(RuntimeError):
        _run(al.access_state(ALICE))
    assert _run(al.access_state(PRIMARY_EMAIL)) == "owner"


def test_listing_rows_carry_the_state_the_sign_in_applies(env):
    _seed(env)
    env.profiles.docs += [{"_id": "walkin@example.com"}, {"_id": ALICE}]
    rows = {r["email"]: r for r in _run(people.list_people(user=OWNER))["people"]}
    assert rows[PRIMARY_EMAIL]["access"] == "owner"
    assert rows[ALICE]["access"] == "allowed"
    assert rows["bob@example.com"]["access"] == "revoked"
    assert rows["walkin@example.com"]["access"] == "no_access"
    for email, row in rows.items():
        assert _run(al.access_state(email)) == row["access"]


def test_allow_creates_the_row_and_the_person_can_sign_in(env):
    env.profiles.docs.append({"_id": "walkin@example.com"})
    assert _run(al.resolve_allowed_signup("walkin@example.com")) is None
    pid = people._pid("walkin@example.com")
    assert _run(people.allow(pid, user=OWNER)) == {"ok": True}
    row = env.allow.docs[0]
    assert row["status"] == "invited" and row["source"] == "allowed_from_people"
    assert _run(al.resolve_allowed_signup("walkin@example.com")) == "walkin@example.com"
    assert [a["action"] for a in env.audit.docs] == ["allow"]
    # Idempotent: allowing again adds nothing.
    _run(people.allow(pid, user=OWNER))
    assert len(env.allow.docs) == 1 and len(env.audit.docs) == 1


def test_allow_on_a_revoked_person_points_at_restore(env):
    _seed(env)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        _run(people.allow(people._pid("bob@example.com"), user=OWNER))
    assert exc.value.status_code == 409
    assert next(d for d in env.allow.docs if d["key"] == _key("bob@example.com"))["status"] == "revoked"


# ── backfill ─────────────────────────────────────────────────────────────

def _profiles(env):
    env.profiles.docs += [{"_id": "p1@example.com"}, {"_id": "P2@example.com"}, {"_id": "dup.l@gmail.com"},
                          {"_id": "dupl@gmail.com"}, {"_id": PRIMARY_EMAIL}, {"_id": ALICE}, {"_id": "Bot"}]
    env.allow.docs += [{"key": _key(ALICE), "email": ALICE, "status": "revoked"}]


def test_preview_counts_only_signed_up_accounts_with_no_row_and_not_owner(env):
    _profiles(env)
    res = _run(people.backfill_preview(user=OWNER))
    assert res == {"count": 3}  # p1, p2, one gmail person; owner, revoked Alice and "Bot" excluded
    assert env.allow.docs[0]["status"] == "revoked" and len(env.allow.docs) == 1  # preview wrote nothing


def test_apply_is_confirmed_idempotent_and_leaves_owner_and_existing_rows_alone(env):
    from fastapi import HTTPException
    _profiles(env)
    with pytest.raises(HTTPException) as exc:
        _run(people.backfill_apply(people.BackfillBody(confirm="allow"), user=OWNER))
    assert exc.value.status_code == 400 and len(env.allow.docs) == 1 and env.audit.docs == []
    assert _run(people.backfill_apply(people.BackfillBody(confirm="ALLOW"), user=OWNER)) == {"ok": True, "added": 3}
    added = [d for d in env.allow.docs if d.get("source") == "pre_list_backfill"]
    assert len(added) == 3 and all(d["status"] == "invited" for d in added)
    assert not any(d["key"] == _key(PRIMARY_EMAIL) for d in env.allow.docs)
    assert next(d for d in env.allow.docs if d["key"] == _key(ALICE))["status"] == "revoked"
    assert len(env.audit.docs) == 1 and env.audit.docs[0]["action"] == "backfill"
    assert env.audit.docs[0]["detail"] == "3 accounts allowed"
    assert "@" not in env.audit.docs[0]["target"] + env.audit.docs[0]["detail"]
    before = len(env.allow.docs)
    assert _run(people.backfill_apply(people.BackfillBody(confirm="ALLOW"), user=OWNER))["added"] == 0
    assert len(env.allow.docs) == before
    assert _run(people.backfill_preview(user=OWNER)) == {"count": 0}
    # The backfilled people can now sign in.
    assert _run(al.resolve_allowed_signup("p1@example.com")) is not None


@pytest.mark.parametrize("who", [OTHER, BOT, SCOPED_OWNER])
def test_new_routes_refuse_everyone_but_the_owner_session(env, who):
    for call in (people.allow(people._pid(ALICE), user=who), people.backfill_preview(user=who),
                 people.backfill_apply(people.BackfillBody(confirm="ALLOW"), user=who)):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            _run(call)
        assert exc.value.status_code == 403
    assert env.allow.docs == [] and env.audit.docs == []


NEW_ROUTES = [
    ("POST", f"/ops/people/{people._pid(ALICE)}/allow", None),
    ("GET", "/ops/people/backfill", None),
    ("POST", "/ops/people/backfill", {"confirm": "ALLOW"}),
]


@pytest.mark.parametrize("method,path,body", NEW_ROUTES)
def test_new_routes_over_http_bot_scoped_and_non_owner(world, method, path, body):
    world.profiles.docs.append({"_id": ALICE})
    assert world.client.request(method, path, json=body).status_code == 401
    r = world.client.request(method, path, json=body, headers={"Authorization": "Bearer sorted_bot_x"})
    assert r.status_code in (401, 403)
    r = world.client.request(method, path, json=body, headers={"Authorization": "Bearer sorted_at_abc"})
    assert r.status_code in (401, 403)
    assert world.client.request(method, path, json=body, headers=_bearer("someone@example.com")).status_code == 403
    assert world.allow.docs == [] and world.audit.docs == []


def test_owner_over_http_previews_then_applies(world):
    world.profiles.docs.append({"_id": ALICE})
    h = _bearer(PRIMARY_EMAIL)
    assert world.client.get("/ops/people/backfill", headers=h).json() == {"count": 1}
    assert world.client.post("/ops/people/backfill", json={"confirm": "no"}, headers=h).status_code == 400
    assert world.client.post("/ops/people/backfill", json={"confirm": "ALLOW"}, headers=h).json()["added"] == 1
    rows = world.client.get("/ops/people", headers=h).json()["people"]
    assert {r["email"]: r["access"] for r in rows}[ALICE] == "allowed"


# ── script ───────────────────────────────────────────────────────────────

def test_script_dry_run_writes_nothing_and_apply_adds(env):
    from scripts import backfill_allowlist as script
    _profiles(env)
    before = [dict(d) for d in env.allow.docs]
    assert _run(script.run(False)) == {"without_access_row": 3, "added": 0}
    assert env.allow.docs == before and env.audit.docs == []
    assert _run(script.run(True)) == {"without_access_row": 3, "added": 3}
    assert _run(script.run(True))["added"] == 0


def test_script_refuses_without_mongo_db_set():
    backend = Path(__file__).resolve().parent.parent
    import os
    env = {k: v for k, v in os.environ.items() if k != "MONGO_DB"}
    out = subprocess.run([sys.executable, str(backend / "scripts" / "backfill_allowlist.py")],
                         env=env, capture_output=True, text=True, cwd=backend, timeout=60)
    assert out.returncode == 2 and "MONGO_DB" in out.stderr
