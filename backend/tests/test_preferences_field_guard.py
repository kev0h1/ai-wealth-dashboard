"""A85 (pentest A51-2026-09-20, API-08): PATCH /preferences used to have two
live-confirmed defects. (1) Mass assignment -- it accepted and stored ANY
top-level body key with no schema check, so an unadvertised field wrote
straight into the document. (2) No optimistic-concurrency check on the
ordinary write path -- a stale full-snapshot PATCH could silently clobber a
field a different, more recent write had just changed, with no conflict
signal at all.

Fix: `ALLOWED_PREFERENCE_FIELDS` (app/routers/preferences.py) is an explicit
allowlist of every top-level key this endpoint has ever legitimately been
asked to write, built from frontend/lib/api.ts's updatePreferences() call
sites and every Penny propose-tool that replays through this same endpoint
(see that set's own docstring for the full enumeration). A body key outside
it is rejected with 422 before any write. Separately, an optional
`expected_version` in the body -- the same JSON-body convention the
existing `version` counter already uses, not a header -- is checked against
the currently stored version before any write; a mismatch returns 409 with
the current version and makes no change, while an omitted `expected_version`
preserves today's last-write-wins behaviour for every existing caller.

`_FakeCol` is the fuller mutating double from tests/test_preferences_versioning.py
(applies $set/$inc/$addToSet/$pull and reports `.matched_count`, needed
because this file proves both "accepted and actually written" and "rejected
and NOT written") -- copied rather than imported, per that file's own stated
convention of no import-time coupling between test modules.
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.preferences as preferences
from app.routers.preferences import ALLOWED_PREFERENCE_FIELDS
from app.services.notifications import NOTIF_DEFAULTS

UID = "user@example.com"


class _UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict) and "$exists" in v:
                if (k in d) != v["$exists"]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                for field, amount in (update.get("$inc") or {}).items():
                    d[field] = d.get(field, 0) + amount
                for field, spec in (update.get("$addToSet") or {}).items():
                    each = spec.get("$each", [spec]) if isinstance(spec, dict) else [spec]
                    existing = d.get(field) or []
                    d[field] = existing + [v for v in each if v not in existing]
                for field, spec in (update.get("$pull") or {}).items():
                    cond = spec.get("$in", []) if isinstance(spec, dict) else [spec]
                    existing = d.get(field) or []
                    d[field] = [v for v in existing if v not in cond]
                return _UpdateResult(1)
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            new_doc.update(update.get("$setOnInsert") or {})
            for field, amount in (update.get("$inc") or {}).items():
                new_doc[field] = new_doc.get(field, 0) + amount
            for field, spec in (update.get("$addToSet") or {}).items():
                each = spec.get("$each", [spec]) if isinstance(spec, dict) else [spec]
                new_doc[field] = list(dict.fromkeys(each))
            self.docs.append(new_doc)
            return _UpdateResult(0)
        return _UpdateResult(0)


class _CacheSpy:
    async def ainvalidate(self, uid):
        pass


def _patch(monkeypatch, doc=None):
    fake_prefs = _FakeCol([doc] if doc is not None else [])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return fake_prefs


# ---------------------------------------------------------------------------
# Mass assignment (1)
# ---------------------------------------------------------------------------

def test_unknown_top_level_field_is_rejected_422(monkeypatch):
    fake_prefs = _patch(monkeypatch, doc=None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"a51_wp4_mass_assignment_canary": "hacker-controlled"}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422
    assert "a51_wp4_mass_assignment_canary" in str(exc_info.value.detail)
    # Rejected before any write reaches the collection -- no document was
    # created for a user who previously had none.
    assert fake_prefs.docs == []


def test_unknown_field_alongside_legitimate_fields_rejects_the_whole_request(monkeypatch):
    """A mixed body (one real field, one unadvertised one) must not silently
    drop the bad key and write the good one -- the whole PATCH is invalid,
    matching the live-confirmed A51 case where the canary key rode along
    with a genuine debt_target_months change and both were accepted."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 3, "dark_mode": False})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"dark_mode": True, "is_admin": True}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422
    # The pre-existing document is untouched: dark_mode did NOT flip and
    # version did NOT advance.
    assert fake_prefs.docs == [{"user_id": UID, "version": 3, "dark_mode": False}]


def test_every_allowlisted_field_is_accepted_and_written(monkeypatch):
    """One representative valid value per field in ALLOWED_PREFERENCE_FIELDS,
    each PATCHed alone against a fresh document-less user. None should raise,
    and each should produce exactly one version bump -- proving the allowlist
    itself, built from every real caller, does not accidentally exclude a
    field the app actually uses."""
    sample_values = {
        "hide_net_worth": True,
        "dark_mode": True,
        "pay_period_config": {"type": "calendar_month"},
        "income_value": 50000,
        "income_bracket": "under_100k",
        "pension_annual": 4000,
        "has_child_benefit": True,
        "home_pinned_accounts": ["acc-1"],
        "home_pinned_cards": ["card-1"],
        "recurring_categories": ["Bills"],
        "spend_widgets": ["debt_burndown"],
        "home_pinned_widget": "period_compare",
        "debt_burndown_overrides": {"card-1": {"apr": 0}},
        "cover_plan_excluded_accounts": ["acc-1"],
        "cover_plan_exclude_add": ["acc-1"],
        "cover_plan_exclude_remove": ["acc-1"],
        "debt_target_months": 24,
        "debt_tracking_start": "2026-01-01",
        "notification_prefs": {**NOTIF_DEFAULTS, "transactions": True},
    }

    # Every field this test knows a sample value for must be exactly the
    # allowlist -- if either side gains/loses a field without the other
    # being updated, fail loudly here rather than silently skipping it.
    assert set(sample_values.keys()) == ALLOWED_PREFERENCE_FIELDS

    for field, value in sample_values.items():
        _patch(monkeypatch, doc=None)
        result = asyncio.run(preferences.update_preferences({field: value}, {"email": UID}))
        assert result["version"] == 1, f"{field} did not write (version did not advance)"


# ---------------------------------------------------------------------------
# Optimistic concurrency (2)
# ---------------------------------------------------------------------------

def test_stale_expected_version_returns_409_and_makes_no_change(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"dark_mode": True, "expected_version": 4}, {"email": UID},
        ))

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["current_version"] == 5
    # No write happened: dark_mode still false, version still 5.
    assert fake_prefs.docs == [{"user_id": UID, "version": 5, "dark_mode": False}]


def test_matching_expected_version_writes_and_increments(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 5}, {"email": UID},
    ))

    assert result["version"] == 6
    assert fake_prefs.docs[0]["dark_mode"] is True
    assert fake_prefs.docs[0]["version"] == 6


def test_no_expected_version_supplied_still_writes_last_write_wins(monkeypatch):
    """Every existing client today never sends expected_version at all --
    this is the exact behaviour they must keep getting: last write wins,
    no 409, matching the endpoint's behaviour before this fix."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True}, {"email": UID},
    ))

    assert result["version"] == 6
    assert fake_prefs.docs[0]["dark_mode"] is True


def test_expected_version_zero_matches_a_document_with_no_version_field_yet(monkeypatch):
    """A legacy document that has never been $inc'd (no `version` key at
    all) reports version 0 via GET /preferences (doc.get("version", 0)) --
    expected_version=0 against that same document must be treated as a
    match, not a spurious 409."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "dark_mode": False})

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 0}, {"email": UID},
    ))

    assert result["version"] == 1
    assert fake_prefs.docs[0]["dark_mode"] is True


def test_expected_version_against_a_user_with_no_document_at_all_matches_zero(monkeypatch):
    fake_prefs = _patch(monkeypatch, doc=None)

    result = asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 0}, {"email": UID},
    ))

    assert result["version"] == 1
    assert fake_prefs.docs[0]["dark_mode"] is True


def test_non_integer_expected_version_is_rejected_422(monkeypatch):
    _patch(monkeypatch, {"user_id": UID, "version": 5})

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"dark_mode": True, "expected_version": "five"}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422


def test_expected_version_is_never_written_into_the_document(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID, "version": 5, "dark_mode": False})

    asyncio.run(preferences.update_preferences(
        {"dark_mode": True, "expected_version": 5}, {"email": UID},
    ))

    assert "expected_version" not in fake_prefs.docs[0]
