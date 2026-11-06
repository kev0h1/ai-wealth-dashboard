"""E15: PATCH /preferences wipes the per-user response cache only when a field
that feeds money figures genuinely changed.

Uses the REAL response_cache module (memory layer plus the real ainvalidate)
with data_version.bump replaced by a counter, so "cache intact" means the
seeded entry is still there and the data version was not bumped.
"""
import asyncio
import logging

import pytest

import app.routers.preferences as preferences
from app.services import data_version, response_cache
from tests.test_preferences_versioning import _FakeCol

UID = "user@example.com"
USER = {"email": UID}


@pytest.fixture
def env(monkeypatch):
    bumps = []

    async def fake_bump(uid):
        bumps.append(uid)
        return len(bumps)

    monkeypatch.setattr(data_version, "bump", fake_bump)
    monkeypatch.setattr(response_cache, "_caches", {"today": {UID: {"payload": {"x": 1}}}})

    def make(doc=None):
        col = _FakeCol([doc] if doc is not None else [])
        monkeypatch.setattr(preferences, "preferences_col", col)
        return col

    class Env:
        pass

    e = Env()
    e.bumps = bumps
    e.make = make
    e.cached = lambda: UID in response_cache._caches["today"]
    e.patch = lambda body: asyncio.run(preferences.update_preferences(dict(body), USER))
    return e


def test_cosmetic_patch_leaves_cache_and_data_version_intact(env):
    env.make({"user_id": UID, "version": 3, "dark_mode": False})
    result = env.patch({"dark_mode": True, "show_tips": False, "hide_net_worth": True})
    assert env.bumps == []
    assert env.cached()
    assert result["dark_mode"] is True


@pytest.mark.parametrize("body", [
    {"pay_period_config": {"type": "last_friday"}},
    {"income_value": 60000},
    {"pension_annual": 5000},
    {"has_child_benefit": True},
    {"recurring_categories": ["Rent"]},
    {"home_pinned_accounts": ["a1"]},
    {"debt_target_months": 6},
    {"debt_tracking_start": "2026-01-01"},
    {"cover_plan_excluded_accounts": ["a1"]},
    {"cover_plan_exclude_add": ["a1"]},
])
def test_money_patch_bumps_and_wipes(env, body):
    env.make({"user_id": UID, "version": 3})
    env.patch(body)
    assert env.bumps == [UID]
    assert not env.cached()


def test_cover_plan_remove_of_a_stored_id_is_money(env):
    env.make({"user_id": UID, "version": 3, "cover_plan_excluded_accounts": ["a1", "a2"]})
    env.patch({"cover_plan_exclude_remove": ["a1"]})
    assert env.bumps == [UID]


def test_unchanged_money_patch_is_a_noop_for_the_cache(env):
    env.make({
        "user_id": UID, "version": 3,
        "pay_period_config": {"type": "last_friday"}, "income_value": 60000,
        "income_bracket": "under_100k", "cover_plan_excluded_accounts": ["a1", "a2"],
    })
    env.patch({"pay_period_config": {"type": "last_friday"}})
    env.patch({"income_value": "60,000"})
    env.patch({"cover_plan_excluded_accounts": ["a2", "a1"]})
    env.patch({"cover_plan_exclude_add": ["a1"]})
    env.patch({"cover_plan_exclude_remove": ["zzz"]})
    assert env.bumps == []
    assert env.cached()


def test_unchanged_patch_still_returns_the_document_and_advances_its_version(env):
    col = env.make({"user_id": UID, "version": 3, "income_value": 60000, "income_bracket": "under_100k"})
    result = env.patch({"income_value": 60000})
    assert result["version"] == 4
    assert col.docs[0]["version"] == 4
    assert env.bumps == []


def test_a_field_with_a_cached_reader_invalidates(env):
    # home_pinned_accounts is read by companion.py when it builds the cached
    # /today brief, so it must wipe even though it looks like a layout setting.
    env.make({"user_id": UID, "version": 1, "home_pinned_accounts": []})
    env.patch({"home_pinned_accounts": ["a1"]})
    assert env.bumps == [UID]
    assert not env.cached()


def test_unclassified_field_is_treated_as_money(env, monkeypatch):
    monkeypatch.setattr(
        preferences, "ALLOWED_PREFERENCE_FIELDS",
        preferences.ALLOWED_PREFERENCE_FIELDS | {"brand_new_field"},
    )
    env.make({"user_id": UID, "version": 1})
    env.patch({"brand_new_field": 1})
    assert env.bumps == [UID]
    assert not env.cached()


def test_every_allowed_field_is_classified():
    unclassified = preferences.ALLOWED_PREFERENCE_FIELDS - set(preferences.PREFERENCE_CACHE_IMPACT)
    assert unclassified == set()
    assert set(preferences.PREFERENCE_CACHE_IMPACT.values()) == {"money", "cosmetic"}


def test_expected_version_concurrency_is_unchanged(env):
    from fastapi import HTTPException

    env.make({"user_id": UID, "version": 5})
    with pytest.raises(HTTPException) as exc:
        env.patch({"dark_mode": True, "expected_version": 4})
    assert exc.value.status_code == 409
    assert exc.value.detail["current_version"] == 5
    result = env.patch({"dark_mode": True, "expected_version": 5})
    assert result["version"] == 6
    assert env.bumps == []


def test_patch_logs_field_names_only(env, caplog):
    env.make({"user_id": UID, "version": 1})
    with caplog.at_level(logging.WARNING, logger="app.routers.preferences"):
        env.patch({"income_value": 123456, "dark_mode": True})
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "income_value" in text and "dark_mode" in text
    assert "123456" not in text and UID not in text
