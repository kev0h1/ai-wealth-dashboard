"""G189: `show_tips` display preference (default true), the hide_net_worth
pattern. Pinned: default on, PATCH round-trip, whole-user cache invalidation
on PATCH, unknown fields still rejected, non-boolean rejected, and the
server side of "off": GET /savings-insights serves nothing and the weekly
pass spends no research calls for an opted-out user."""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.preferences as preferences
import app.routers.savings_insights as si

UID = "user@example.com"


class _Result:
    matched_count = 1


class _Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in (query or {}).items() if not isinstance(v, dict)):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if d.get("user_id") == filt.get("user_id"):
                d.update(update.get("$set") or {})
                for f, n in (update.get("$inc") or {}).items():
                    d[f] = d.get(f, 0) + n
                return _Result()
        if upsert:
            new = dict(filt)
            new.update(update.get("$set") or {})
            for f, n in (update.get("$inc") or {}).items():
                new[f] = new.get(f, 0) + n
            self.docs.append(new)
        return _Result()


class _CacheSpy:
    def __init__(self):
        self.invalidated: list = []

    async def ainvalidate(self, uid):
        self.invalidated.append(uid)


def _setup(monkeypatch, doc=None):
    col = _Col([doc] if doc else [])
    spy = _CacheSpy()
    monkeypatch.setattr(preferences, "preferences_col", col)
    monkeypatch.setattr(preferences, "response_cache", spy)
    monkeypatch.setattr(si, "preferences_col", col)
    return col, spy


def test_show_tips_defaults_to_true_with_and_without_a_document(monkeypatch):
    _setup(monkeypatch, None)
    assert asyncio.run(preferences.get_preferences({"email": UID}))["show_tips"] is True
    _setup(monkeypatch, {"user_id": UID, "version": 3})
    assert asyncio.run(preferences.get_preferences({"email": UID}))["show_tips"] is True


def test_patch_round_trips_and_invalidates_the_cache(monkeypatch):
    col, spy = _setup(monkeypatch, {"user_id": UID, "version": 1})
    out = asyncio.run(preferences.update_preferences({"show_tips": False}, {"email": UID}))
    assert out["show_tips"] is False
    assert spy.invalidated == [UID]
    assert asyncio.run(preferences.get_preferences({"email": UID}))["show_tips"] is False
    out = asyncio.run(preferences.update_preferences({"show_tips": True}, {"email": UID}))
    assert out["show_tips"] is True


def test_show_tips_is_allowlisted_and_unknown_fields_still_rejected(monkeypatch):
    _setup(monkeypatch, {"user_id": UID, "version": 1})
    assert "show_tips" in preferences.ALLOWED_PREFERENCE_FIELDS
    with pytest.raises(HTTPException) as e:
        asyncio.run(preferences.update_preferences({"show_tipz": False}, {"email": UID}))
    assert e.value.status_code == 422


def test_non_boolean_show_tips_is_rejected(monkeypatch):
    col, _ = _setup(monkeypatch, {"user_id": UID, "version": 1})
    with pytest.raises(HTTPException) as e:
        asyncio.run(preferences.update_preferences({"show_tips": "no"}, {"email": UID}))
    assert e.value.status_code == 422
    assert "show_tips" not in col.docs[0]


def test_opted_out_user_is_served_no_insights_and_no_spotlight(monkeypatch):
    _setup(monkeypatch, {"user_id": UID, "show_tips": False})
    assert asyncio.run(si.get_savings_insights({"email": UID})) == []
    assert asyncio.run(si.get_spotlight_insight({"email": UID})) is None
    assert asyncio.run(si.new_insight_count({"email": UID})) == {"count": 0}


def test_opted_out_user_costs_no_research(monkeypatch):
    _setup(monkeypatch, {"user_id": UID, "show_tips": False})

    async def boom(*a, **k):
        raise AssertionError("pass must not run for an opted-out user")

    monkeypatch.setattr(si, "_detect_insight_categories", boom)
    monkeypatch.setattr(si, "_generate_savings_insight_content", boom)
    asyncio.run(si._refresh_savings_insights_for_user(UID))
