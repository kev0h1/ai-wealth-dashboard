"""E14: the owner's per-person subscription view and overrides, exercised
through the real ASGI app (TestClient, auth middleware, current_user), with
in-memory collections. Same stand-ins as test_e12_people_http."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import app.db.collections as db_collections
import app.routers.ops_people_subscription as sub_routes
import app.routers.subscription as sub_router
import app.services.response_cache as response_cache
import app.services.subscription_admin as sa
from app.core.config import PRIMARY_EMAIL
from app.core.subscription import get_subscription
from test_e12_people import Col
from test_e12_people_http import ALICE, _bearer, world  # noqa: F401  (fixture)
import app.routers.ops_people as people

PID = people._pid(ALICE)
OWNER_PID = people._pid(PRIMARY_EMAIL)
BASE = f"/ops/people/{PID}/subscription"
NOW = datetime.now(timezone.utc)
LIVE_STRIPE = {"provider": "stripe", "source": "stripe", "stripe_subscription_id": "sub_1",
               "status": "active", "tier": "plus"}
LIVE_APPLE = {"provider": "apple", "source": "apple", "status": "active", "tier": "standard"}
LIVE_GOOGLE = {"provider": "google", "source": "google", "status": "trialing", "tier": "lite"}


class SubCol(Col):
    """Col that hands out _ids like Mongo does."""
    n = 0

    async def insert_one(self, doc):
        SubCol.n += 1
        doc.setdefault("_id", SubCol.n)
        await super().insert_one(doc)

    async def update_one(self, query, update, upsert=False):
        before = len(self.docs)
        await super().update_one(query, update, upsert=upsert)
        if len(self.docs) > before:
            SubCol.n += 1
            self.docs[-1]["_id"] = SubCol.n
        return type("R", (), {"matched_count": 1})()


@pytest.fixture()
def env(world, monkeypatch):  # noqa: F811
    world.profiles.docs.append({"_id": ALICE})
    world.subs = SubCol()
    world.packs = SubCol()
    world.wiped = []
    monkeypatch.setattr(db_collections, "subscriptions_col", world.subs)
    monkeypatch.setattr(sub_router, "subscriptions_col", world.subs)
    monkeypatch.setattr(db_collections, "penny_topups_col", world.packs)

    async def wipe(uid):
        world.wiped.append(uid)

    monkeypatch.setattr(response_cache, "ainvalidate", wipe)

    async def penny(uid, persist=True):
        return {"limit": 300, "used": 7, "remaining": 293, "topup_messages": 0}

    async def mcp(uid, persist=True):
        return {"limit": 5000, "used": 3, "remaining": 4997}

    async def packs(uid, now, persist=True):
        return list(world.packs.docs)

    monkeypatch.setattr(sub_routes, "penny_allowance", penny)
    monkeypatch.setattr(sub_routes, "mcp_allowance", mcp)
    monkeypatch.setattr(sub_routes, "settle_topups", packs)
    world.owner = _bearer(PRIMARY_EMAIL)
    return world


def _post(env, path, body, headers=None, pid=PID):
    return env.client.post(f"/ops/people/{pid}/subscription/{path}", json=body, headers=headers or env.owner)


def _tomorrow(days=30):
    return (NOW + timedelta(days=days)).date().isoformat()


SET = {"tier": "lite", "confirm": "lite", "reason": "Comped for testing"}


# access ---------------------------------------------------------------

ROUTES = [
    ("GET", "", None),
    ("POST", "/set-tier", SET),
    ("POST", "/topup", {"pack_id": "small", "confirm": "small", "reason": "x"}),
    ("POST", "/reset-trial", {"confirm": "RESET", "reason": "x"}),
    ("POST", "/cancel-grant", {"reason": "x"}),
]


@pytest.mark.parametrize("method,suffix,body", ROUTES)
def test_non_owner_bot_and_scoped_are_refused(env, method, suffix, body):
    for headers in (_bearer("someone@example.com"), {"Authorization": "Bearer sorted_bot_x"},
                    {"Authorization": "Bearer sorted_at_abc"}, {}):
        r = env.client.request(method, BASE + suffix, json=body, headers=headers)
        assert r.status_code in (401, 403)
    assert env.audit.docs == [] and env.subs.docs == [] and env.wiped == []


# read -----------------------------------------------------------------

def test_get_shows_default_tier_and_allowance(env):
    r = env.client.get(BASE, headers=env.owner)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "default" and d["tier_source"] == "default" and d["provider"] == "none"
    assert d["provider_live"] is False and d["manual_grant"] is None
    assert d["penny"]["monthly_allowance"] == 300 and d["penny"]["used"] == 7
    assert d["mcp"] == {"allowance": 5000, "used": 3, "remaining": 4997}
    assert "@" not in r.text


@pytest.mark.parametrize("doc,provider", [(LIVE_STRIPE, "stripe"), (LIVE_APPLE, "apple"), (LIVE_GOOGLE, "google")])
def test_get_reports_live_provider(env, doc, provider):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **doc})
    d = env.client.get(BASE, headers=env.owner).json()
    assert d["provider"] == provider and d["provider_live"] is True and d["live_provider"] == provider


def test_owner_row_is_viewable_and_editable(env):
    r = env.client.post(f"/ops/people/{OWNER_PID}/subscription/set-tier",
                        json={**SET, "tier": "standard", "confirm": "standard"}, headers=env.owner)
    assert r.status_code == 200
    assert env.subs.docs[0]["user_id"] == PRIMARY_EMAIL and env.subs.docs[0]["tier"] == "standard"


def test_unknown_person_is_404(env):
    assert env.client.get("/ops/people/" + "0" * 64 + "/subscription", headers=env.owner).status_code == 404


# set-tier -------------------------------------------------------------

def test_set_tier_writes_manual_document_with_expiry_and_audit(env):
    r = _post(env, "set-tier", {**SET, "expires_at": _tomorrow()})
    assert r.status_code == 200
    doc = env.subs.docs[0]
    assert doc["user_id"] == ALICE and doc["tier"] == "lite" and doc["managed_by"] == "manual"
    assert doc["source"] == "manual" and doc["expires_at"].date().isoformat() == _tomorrow()
    assert env.wiped == [ALICE]
    a = env.audit.docs[-1]
    assert a["action"] == "set_tier" and a["target_key"] == PID and "Comped for testing" in a["detail"]
    assert "lite" in a["detail"] and ALICE not in str(a)
    d = env.client.get(BASE, headers=env.owner).json()
    assert d["tier"] == "lite" and d["tier_source"] == "manual" and d["manual_grant"]["tier"] == "lite"


def test_set_tier_needs_typed_confirmation_valid_tier_and_reason(env):
    assert _post(env, "set-tier", {**SET, "confirm": "plus"}).status_code == 400
    assert _post(env, "set-tier", {**SET, "tier": "gold", "confirm": "gold"}).status_code == 400
    assert _post(env, "set-tier", {**SET, "reason": "  "}).status_code == 422
    assert _post(env, "set-tier", {**SET, "expires_at": "2001-01-01"}).status_code == 400
    assert _post(env, "set-tier", {**SET, "expires_at": "soon"}).status_code == 400
    assert env.subs.docs == [] and env.audit.docs == []


def test_reason_emails_are_scrubbed_from_audit(env):
    _post(env, "set-tier", {**SET, "reason": "asked by bob@example.com"})
    assert "bob@example.com" not in str(env.audit.docs)


@pytest.mark.parametrize("doc", [LIVE_STRIPE, LIVE_APPLE, LIVE_GOOGLE])
def test_set_tier_is_refused_for_every_live_provider(env, doc):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **doc})
    before = dict(env.subs.docs[0])
    r = _post(env, "set-tier", SET)
    assert r.status_code == 409
    assert "Manage it in" in r.json()["detail"]
    assert env.subs.docs == [before] and env.audit.docs == [] and env.wiped == []


def test_set_tier_over_an_ended_stripe_subscription_is_allowed(env):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **LIVE_STRIPE, "status": "expired"})
    assert _post(env, "set-tier", SET).status_code == 200
    assert env.subs.docs[0]["source"] == "manual"


def test_admin_endpoint_shares_the_write(env):
    asyncio.run(sa.set_manual_tier(ALICE, "plus"))
    d = env.subs.docs[0]
    assert d["tier"] == "plus" and d["managed_by"] == "manual" and d["source"] == "manual" and d["expires_at"] is None


# expiry ---------------------------------------------------------------

def test_lapsed_grant_falls_back_to_default_everywhere(env, monkeypatch):
    monkeypatch.setattr("app.core.config.DEFAULT_TIER", "standard")
    env.subs.docs.append({"_id": 1, "user_id": ALICE, "provider": "stripe", "tier": "lite", "status": "active",
                          "managed_by": "manual", "source": "manual", "expires_at": NOW - timedelta(days=1)})
    sub = asyncio.run(get_subscription(ALICE))
    assert sub.tier_name == "standard" and sub.status == "expired"
    info = asyncio.run(sub_router.get_subscription_info({"email": ALICE}))
    assert info["tier"] == "standard" and info["tier_source"] == "default" and info["is_default_tier"] is True
    d = env.client.get(BASE, headers=env.owner).json()
    assert d["tier"] == "standard" and d["status"] == "default" and d["manual_grant"]["lapsed"] is True


def test_live_grant_agrees_between_get_subscription_and_endpoint(env):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, "provider": "stripe", "tier": "lite", "status": "active",
                          "managed_by": "manual", "source": "manual", "expires_at": NOW + timedelta(days=5)})
    info = asyncio.run(sub_router.get_subscription_info({"email": ALICE}))
    assert info["tier"] == "lite" and info["tier_source"] == "manual"
    assert info["tier_expires_at"] is not None


# cancel-grant ---------------------------------------------------------

def test_cancel_grant_restores_default_and_audits(env):
    _post(env, "set-tier", SET)
    env.wiped.clear()
    r = _post(env, "cancel-grant", {"reason": "Tester finished"})
    assert r.status_code == 200 and env.wiped == [ALICE]
    assert env.audit.docs[-1]["action"] == "cancel_grant"
    d = env.client.get(BASE, headers=env.owner).json()
    assert d["manual_grant"] is None and d["tier_source"] == "default"
    sub = asyncio.run(get_subscription(ALICE))
    assert sub.status == "expired"


def test_cancel_grant_refused_without_a_grant(env):
    assert _post(env, "cancel-grant", {"reason": "x"}).status_code == 409
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **LIVE_APPLE})
    assert _post(env, "cancel-grant", {"reason": "x"}).status_code == 409
    assert env.audit.docs == [] and env.wiped == []


def test_cancel_grant_keeps_a_live_store_plan(env):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **LIVE_APPLE})
    env.subs.docs.append({"_id": 2, "user_id": ALICE, "provider": "stripe", "tier": "plus", "status": "active",
                          "managed_by": "manual", "source": "manual"})
    assert _post(env, "cancel-grant", {"reason": "x"}).status_code == 200
    assert asyncio.run(get_subscription(ALICE)).tier_name == "standard"


# top-up ---------------------------------------------------------------

def test_topup_grants_an_admin_pack(env):
    r = _post(env, "topup", {"pack_id": "medium", "confirm": "medium", "reason": "Goodwill"})
    assert r.status_code == 200
    p = env.packs.docs[0]
    assert p["pack_id"] == "admin" and p["source"] == "admin" and p["messages"] == 100 and p["user_id"] == ALICE
    assert env.audit.docs[-1]["action"] == "grant_topup" and "medium" in env.audit.docs[-1]["detail"]
    assert env.wiped == [ALICE]


def test_topup_validates_pack_and_confirmation(env):
    assert _post(env, "topup", {"pack_id": "huge", "confirm": "huge", "reason": "x"}).status_code == 400
    assert _post(env, "topup", {"pack_id": "small", "confirm": "large", "reason": "x"}).status_code == 400
    assert env.packs.docs == [] and env.audit.docs == []


def test_topup_is_allowed_with_a_live_provider(env):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **LIVE_STRIPE})
    assert _post(env, "topup", {"pack_id": "small", "confirm": "small", "reason": "x"}).status_code == 200


# reset-trial ----------------------------------------------------------

def test_reset_trial_clears_only_trial_fields(env):
    used = NOW - timedelta(days=60)
    env.subs.docs.append({"_id": 1, "user_id": ALICE, "provider": "stripe", "source": "stripe",
                          "stripe_subscription_id": "sub_old", "status": "expired", "tier": "plus",
                          "trial_used_at": used, "trial_ends_at": used + timedelta(days=14)})
    r = _post(env, "reset-trial", {"confirm": "RESET", "reason": "Support request"})
    assert r.status_code == 200
    d = env.subs.docs[0]
    assert "trial_used_at" not in d and "trial_ends_at" not in d and "trial_reset_at" in d
    assert d["tier"] == "plus" and d["stripe_subscription_id"] == "sub_old" and d["status"] == "expired"
    from app.services.billing import _trial_reset_applies
    assert _trial_reset_applies(d) is True
    assert env.audit.docs[-1]["action"] == "reset_trial" and env.wiped == [ALICE]


def test_reset_trial_needs_typed_reset_and_something_to_reset(env):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, "provider": "stripe", "source": "stripe",
                          "stripe_subscription_id": "s", "status": "expired", "trial_used_at": NOW})
    assert _post(env, "reset-trial", {"confirm": "reset", "reason": "x"}).status_code == 400
    assert "trial_used_at" in env.subs.docs[0]
    env.subs.docs.clear()
    assert _post(env, "reset-trial", {"confirm": "RESET", "reason": "x"}).status_code == 409


@pytest.mark.parametrize("doc", [LIVE_STRIPE, LIVE_APPLE, LIVE_GOOGLE])
def test_reset_trial_refused_for_live_provider(env, doc):
    env.subs.docs.append({"_id": 1, "user_id": ALICE, **doc, "trial_used_at": NOW})
    r = _post(env, "reset-trial", {"confirm": "RESET", "reason": "x"})
    assert r.status_code == 409
    assert "trial_used_at" in env.subs.docs[0] and env.audit.docs == []


# audit and logs -------------------------------------------------------

def test_audit_rows_carry_no_email_and_are_masked_on_erase(env):
    _post(env, "set-tier", SET)
    row = env.audit.docs[-1]
    assert row["target_key"] == PID and ALICE not in str(row)
    listing = env.client.get("/ops/people", headers=env.owner).json()
    assert any(a["action"] == "set_tier" for a in listing["audit"])


def test_logs_are_masked(env, caplog):
    import logging
    with caplog.at_level(logging.INFO):
        _post(env, "set-tier", SET)
    assert ALICE not in caplog.text
