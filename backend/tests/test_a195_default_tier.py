"""A195: the code default tier is Statements, the env override still works,
users with a real subscription / trial / store purchase / manual grant are
unaffected, and the /ops/people default-tier report lists exactly the users
who are on their plan only because of the default. All names are invented."""
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import app.db.collections as db_collections
import app.routers.ops_people as people
from app.core import config as config_module
from app.core.config import PRIMARY_EMAIL
from app.core.subscription import (
    Tier, _default_tier, default_tier_exposure, pick_subscription_doc,
)
from test_e12_people_http import _bearer, world  # noqa: F401  (fixture)

BACKEND = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)
FUTURE = NOW + timedelta(days=20)
PAST = NOW - timedelta(days=5)


def _config_default(env_value):
    env = {k: v for k, v in os.environ.items() if k != "DEFAULT_TIER"}
    env["MONGO_DB"] = "wealth_test_a195"
    env["FORBID_LIVE_QUEUE"] = "1"
    if env_value is not None:
        env["DEFAULT_TIER"] = env_value
    out = subprocess.run(
        [sys.executable, "-c",
         "import app.core.config as c, app.core.subscription as s;"
         "print(c.DEFAULT_TIER, s._default_tier().name)"],
        cwd=BACKEND, env=env, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-800:]
    return out.stdout.split()[-2:]


def test_code_default_is_statements_when_env_unset():
    assert _config_default(None) == ["statements", "STATEMENTS"]


def test_env_override_plus_still_works():
    assert _config_default("plus") == ["plus", "PLUS"]


def test_unrecognised_configured_default_falls_back_to_code_default(monkeypatch):
    monkeypatch.setattr(config_module, "DEFAULT_TIER", "nonsense")
    assert _default_tier() == Tier.STATEMENTS


# Documents that must resolve identically whatever the default is.
STRIPE_LIVE = {"provider": "stripe", "source": "stripe", "stripe_subscription_id": "sub_1",
               "status": "active", "tier": "plus", "expires_at": FUTURE}
STRIPE_TRIAL = {"provider": "stripe", "source": "stripe", "stripe_subscription_id": "sub_2",
                "status": "active", "tier": "standard", "trial_ends_at": FUTURE, "expires_at": FUTURE}
APPLE = {"provider": "apple", "source": "apple", "status": "active", "tier": "standard", "expires_at": FUTURE}
GOOGLE = {"provider": "google", "source": "google", "status": "trialing", "tier": "lite", "expires_at": FUTURE}
MANUAL = {"provider": "stripe", "managed_by": "manual", "source": "manual", "status": "active",
          "tier": "plus", "expires_at": None}
MANUAL_DATED = {**MANUAL, "tier": "standard", "expires_at": FUTURE}
SELF_STATEMENTS = {"provider": "stripe", "managed_by": "self", "status": "active", "tier": "statements"}
STORE_ENDED = {"provider": "apple", "source": "apple", "status": "expired", "tier": "standard"}
STRIPE_ENDED = {"provider": "stripe", "source": "stripe", "stripe_subscription_id": "sub_3",
                "status": "expired", "tier": "plus"}

PROTECTED = {
    "stripe_live": (STRIPE_LIVE, "plus"),
    "stripe_trial": (STRIPE_TRIAL, "standard"),
    "apple_purchase": (APPLE, "standard"),
    "google_purchase": (GOOGLE, "lite"),
    "manual_grant": (MANUAL, "plus"),
    "manual_grant_dated": (MANUAL_DATED, "standard"),
    "self_selected_statements": (SELF_STATEMENTS, "statements"),
    "store_ended_lands_on_statements": (STORE_ENDED, "statements"),
    "stripe_ended_lands_on_statements": (STRIPE_ENDED, "statements"),
}


@pytest.mark.parametrize("name", sorted(PROTECTED))
def test_protected_cases_resolve_the_same_under_either_default(name):
    doc, expected = PROTECTED[name]
    for default in (Tier.STATEMENTS, Tier.PLUS):
        _, sub = pick_subscription_doc([doc], default)
        assert sub.tier_name == expected, (name, default)
        assert sub.via_default is False, (name, default)
    result = default_tier_exposure([doc], Tier.PLUS, Tier.STATEMENTS)
    assert result["via_default"] is False and result["changes"] is False


DEFAULT_ONLY = {
    "no_document": [],
    "free_tier_doc": [{"provider": "stripe", "status": "active", "tier": "free"}],
    "unknown_tier_doc": [{"provider": "stripe", "status": "active", "tier": "mystery"}],
    "lapsed_manual_grant": [{**MANUAL, "expires_at": PAST}],
    "cancelled_manual_grant": [{**MANUAL, "managed_by": "none", "status": "expired"}],
}


@pytest.mark.parametrize("name", sorted(DEFAULT_ONLY))
def test_default_only_cases_follow_the_default(name):
    result = default_tier_exposure(DEFAULT_ONLY[name], Tier.PLUS, Tier.STATEMENTS)
    assert result == {"via_default": True, "tier_today": "plus", "tier_after": "statements", "changes": True}
    # When the environment already sets statements nothing changes.
    same = default_tier_exposure(DEFAULT_ONLY[name], Tier.STATEMENTS, Tier.STATEMENTS)
    assert same["via_default"] is True and same["changes"] is False


def test_real_subscription_outranks_an_ended_default_document():
    _, sub = pick_subscription_doc([STORE_ENDED, STRIPE_LIVE], Tier.STATEMENTS)
    assert sub.tier_name == "plus" and sub.via_default is False


# ── the report over HTTP ────────────────────────────────────────────────

NAMES = {
    "nodoc@example.com": ("Nora Nodoc", []),
    "free@example.com": ("Fred Free", DEFAULT_ONLY["free_tier_doc"]),
    "lapsed@example.com": ("Lena Lapsed", DEFAULT_ONLY["lapsed_manual_grant"]),
    "stripe@example.com": ("Sam Stripe", [STRIPE_LIVE]),
    "trial@example.com": ("Tia Trial", [STRIPE_TRIAL]),
    "apple@example.com": ("Abe Apple", [APPLE]),
    "google@example.com": ("Gus Google", [GOOGLE]),
    "grant@example.com": ("Gail Grant", [MANUAL]),
    "ended@example.com": ("Eli Ended", [STORE_ENDED]),
}
EXPECTED_DEFAULT_ONLY = {"nodoc@example.com", "free@example.com", "lapsed@example.com"}


class _SubsCol:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None, **kw):
        from test_e12_people import _Cursor, _match
        return _Cursor([dict(d) for d in self.docs if _match(d, query or {})])


@pytest.fixture()
def report(world, monkeypatch):  # noqa: F811
    docs = []
    for email, (name, subs) in NAMES.items():
        world.profiles.docs.append({"_id": email, "full_name": name})
        docs += [{**d, "user_id": email} for d in subs]
    world.profiles.docs.append({"_id": PRIMARY_EMAIL, "full_name": "Owner"})
    world.allow.docs.append({"key": "nodoc@example.com", "email": "nodoc@example.com",
                             "status": "invited", "created_at": NOW})
    monkeypatch.setattr(db_collections, "subscriptions_col", _SubsCol(docs))
    monkeypatch.setattr(config_module, "DEFAULT_TIER", "plus")  # today's production setting
    world.owner = _bearer(PRIMARY_EMAIL)
    return world


def test_report_lists_exactly_the_default_only_users(report):
    r = report.client.get("/ops/people/default-tier", headers=report.owner)
    assert r.status_code == 200
    body = r.json()
    assert {p["email"] for p in body["people"]} == EXPECTED_DEFAULT_ONLY
    assert body["default_only_count"] == 3 and body["would_change_count"] == 3
    assert body["signed_up_total"] == len(NAMES)  # owner excluded
    assert body["configured_default"] == "plus" and body["code_default"] == "statements"
    for p in body["people"]:
        assert p["tier_today"] == "plus" and p["tier_after"] == "statements" and p["changes"] is True
        assert p["display_name"] and len(p["id"]) == 64
    by_email = {p["email"]: p for p in body["people"]}
    assert by_email["nodoc@example.com"]["has_subscription_doc"] is False
    assert by_email["free@example.com"]["has_subscription_doc"] is True
    assert by_email["nodoc@example.com"]["invited_at"] is not None


def test_report_is_empty_once_the_environment_default_is_statements(report, monkeypatch):
    monkeypatch.setattr(config_module, "DEFAULT_TIER", "statements")
    body = report.client.get("/ops/people/default-tier", headers=report.owner).json()
    assert body["default_only_count"] == 3 and body["would_change_count"] == 0


def test_report_is_read_only(report):
    before = [dict(d) for d in report.profiles.docs], list(report.audit.docs)
    report.client.get("/ops/people/default-tier", headers=report.owner)
    assert ([dict(d) for d in report.profiles.docs], list(report.audit.docs)) == before


def test_report_is_owner_only(report):
    path = "/ops/people/default-tier"
    assert report.client.get(path).status_code == 401
    assert report.client.get(path, headers=_bearer("nodoc@example.com")).status_code == 403
    r = report.client.get(path, headers={"Authorization": "Bearer sorted_bot_x"})
    assert r.status_code in (401, 403)
    r = report.client.get(path, headers={"Authorization": "Bearer sorted_at_abc"})
    assert r.status_code in (401, 403)
    denied = report.client.get(path, headers=_bearer("nodoc@example.com"))
    assert denied.status_code == 403 and "people" not in denied.json()
