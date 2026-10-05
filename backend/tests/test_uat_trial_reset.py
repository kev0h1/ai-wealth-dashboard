"""B47: UAT-only trial reset. Fake collections only; no database."""
import asyncio

import pytest
from fastapi import HTTPException

import app.core.config as config
import app.main as main_module
import app.routers.uat_trial_reset as mod

UAT = "https://uat.wealth.auriqltd.co.uk"
PROD = "https://wealth.auriqltd.co.uk"
PATH = "/subscription/admin/uat-trial-reset"
OWNER = "owner@example.com"
LISTED = "listed@example.com"
LISTED2 = "listed2@example.com"
UNLISTED = "newcomer@example.com"


class _Res:
    def __init__(self, n):
        self.modified_count = n


class FakeCol:
    def __init__(self, docs):
        self.docs = docs
        self.updates = []

    def find(self, q, proj=None):
        docs = list(self.docs)

        async def gen():
            for d in docs:
                yield dict(d)
        return gen()

    async def update_one(self, filt, upd):
        self.updates.append((filt, upd))
        for d in self.docs:
            if d["_id"] == filt["_id"]:
                changed = False
                for k, v in upd.get("$set", {}).items():
                    d[k] = v
                for k in upd["$unset"]:
                    if k in d:
                        del d[k]
                        changed = True
                return _Res(int(changed))
        return _Res(0)


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(config, "APP_URL", UAT)
    monkeypatch.setattr(config, "PRIMARY_EMAIL", OWNER)
    monkeypatch.setattr(mod, "load_allowlist",
                        lambda: frozenset({mod.hash_id(LISTED), mod.hash_id(LISTED2)}))
    col = FakeCol([
        {"_id": 1, "user_id": LISTED, "tier": "plus", "status": "active",
         "trial_used_at": "x", "trial_ends_at": "y"},
        {"_id": 2, "user_id": LISTED2, "tier": "free", "status": "expired",
         "trial_used_at": "x"},
        {"_id": 3, "user_id": UNLISTED, "tier": "free", "trial_used_at": "x"},
        {"_id": 4, "user_id": "Listed@Example.com", "source": "stripe",
         "stripe_subscription_id": "sub_1", "status": "trialing", "trial_ends_at": "y"},
    ])
    monkeypatch.setattr(mod.collections, "subscriptions_col", col)
    return col


def call(body, email=OWNER):
    return asyncio.run(mod.uat_trial_reset(body, user={"email": email}))


def _paths(app):
    return {r.path for r in app.routes}


def test_route_absent_in_production_present_in_uat():
    assert PATH not in _paths(main_module.build_app(False, uat_admin_enabled=False))
    assert PATH in _paths(main_module.build_app(False, uat_admin_enabled=True))


def test_default_flag_derives_from_app_url():
    assert config._is_non_production(PROD) is False
    assert config._is_non_production(UAT) is True


def test_refuses_at_call_time_in_production(env, monkeypatch):
    monkeypatch.setattr(config, "APP_URL", PROD)
    with pytest.raises(HTTPException) as e:
        call({"user_id": LISTED})
    assert e.value.status_code == 403
    assert env.updates == []


def test_non_admin_forbidden(env):
    with pytest.raises(HTTPException) as e:
        call({"user_id": LISTED}, email=LISTED)
    assert e.value.status_code == 403
    assert env.updates == []


def test_unlisted_user_refused(env):
    with pytest.raises(HTTPException) as e:
        call({"user_id": UNLISTED})
    assert e.value.status_code == 403
    assert env.updates == []


def test_single_user_reset_touches_trial_fields_only(env):
    out = call({"user_id": "  Listed@example.com "})
    assert out["modified"] == 1  # doc 4 is the live Stripe one, skipped; doc 1 reset
    assert out["skipped_live_stripe"] == 1
    for _, upd in env.updates:
        assert set(upd) == {"$unset", "$set"}
        assert set(upd["$unset"]) == {"trial_used_at", "trial_ends_at"}
        assert set(upd["$set"]) == {"trial_reset_at"}
        assert upd["$set"]["trial_reset_at"].tzinfo is not None
    d1 = env.docs[0]
    assert "trial_used_at" not in d1 and "trial_ends_at" not in d1
    assert d1["tier"] == "plus" and d1["status"] == "active"
    assert env.docs[2]["trial_used_at"] == "x"  # unlisted untouched
    assert env.docs[3]["trial_ends_at"] == "y"  # live stripe untouched


def test_all_mode_only_allowlisted_and_no_ids_echoed(env):
    out = call({"all": True})
    assert out == {"ok": True, "modified": 2, "skipped_live_stripe": 1}
    assert env.docs[2]["trial_used_at"] == "x"
    assert all(email not in str(out) for email in (LISTED, LISTED2, UNLISTED))


def test_body_must_pick_exactly_one_mode(env):
    for body in ({}, {"all": True, "user_id": LISTED}):
        with pytest.raises(HTTPException) as e:
            call(body)
        assert e.value.status_code == 400


def test_audit_log_is_hashed(env, caplog):
    caplog.set_level("INFO", logger="app.uat_trial_reset")
    call({"user_id": LISTED2})
    text = caplog.text
    assert "uat trial reset" in text
    assert LISTED2 not in text and OWNER not in text


def test_committed_allowlist_shape():
    data = mod.json.loads(mod.ALLOWLIST_PATH.read_text())
    assert data["count"] == len(data["user_id_hashes"]) > 0
    assert data["captured_at"]
    assert all(len(h) == 64 for h in data["user_id_hashes"])


def test_production_app_has_no_code_path_writing_marker():
    # The only writer of trial_reset_at is this route; absent in production.
    app = main_module.build_app(False, uat_admin_enabled=config._is_non_production(PROD))
    assert PATH not in _paths(app)
