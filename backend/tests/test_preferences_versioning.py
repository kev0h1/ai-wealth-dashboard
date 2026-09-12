"""G45 v3 (second re-review): PATCH /preferences and GET /preferences now
carry a monotonic `version` on the preferences document, incremented on
every write. This is the freshness signal the frontend
(components/PreferencesContext.tsx, lib/preferencesVersion.ts) uses to tell
a stale GET snapshot apart from a genuinely newer one, INCLUDING one written
by a different caller (Penny's set_cover_plan_exclusions proposal replays
this same endpoint via app.routers.can_i._execute_update_preferences — see
that file's own docstring for why "newer" must never mean "written by the
same page").

`_FakeCol` here is a fuller collection double than the ones in
tests/test_safe_to_spend_hardening.py (`_PrefsCol`, whose update_one is a
call-recorder that never actually mutates the stored doc) and
tests/test_cover_plan_exclusions_persist.py (`_FakeCol`, which applies
`$set` but not `$inc`) — proving "the version advances on write" requires a
double that actually applies `$inc`, so this file has its own.
"""
import asyncio

import app.routers.preferences as preferences

UID = "user@example.com"


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

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
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            for field, amount in (update.get("$inc") or {}).items():
                new_doc[field] = new_doc.get(field, 0) + amount
            self.docs.append(new_doc)


class _CacheSpy:
    async def ainvalidate(self, uid):
        pass


def _patch(monkeypatch, doc=None):
    fake_prefs = _FakeCol([doc] if doc is not None else [])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return fake_prefs


def test_get_preferences_reports_version_zero_for_a_user_with_no_document(monkeypatch):
    _patch(monkeypatch, doc=None)

    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["version"] == 0


def test_first_patch_ever_returns_version_one(monkeypatch):
    _patch(monkeypatch, doc=None)

    result = asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1"]}, {"email": UID},
    ))

    assert result["version"] == 1


def test_version_advances_by_one_on_each_subsequent_write(monkeypatch):
    _patch(monkeypatch, {"user_id": UID, "version": 4})

    result = asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1"]}, {"email": UID},
    ))

    assert result["version"] == 5

    result2 = asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": []}, {"email": UID},
    ))

    assert result2["version"] == 6


def test_get_preferences_reflects_the_version_a_patch_just_wrote(monkeypatch):
    _patch(monkeypatch, {"user_id": UID, "version": 9})

    patch_result = asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1", "acc-2"]}, {"email": UID},
    ))
    get_result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert patch_result["version"] == 10
    assert get_result["version"] == 10
    assert get_result["cover_plan_excluded_accounts"] == ["acc-1", "acc-2"]


def test_version_advances_even_when_only_an_unrelated_field_changes(monkeypatch):
    # The version is a whole-document write counter, not a cover-plan
    # special case (G52 — the identical notification-preferences bug — is
    # expected to reuse the exact same field for its own writes).
    _patch(monkeypatch, {"user_id": UID, "version": 1})

    result = asyncio.run(preferences.update_preferences(
        {"notification_prefs": {"bill_alerts": False}}, {"email": UID},
    ))

    assert result["version"] == 2


def test_two_concurrent_callers_writing_the_same_field_both_advance_the_version(monkeypatch):
    """Simulates the exact scenario the review flagged: Penny (via
    can_i._execute_update_preferences) and Settings both PATCH
    cover_plan_excluded_accounts through this same endpoint. Whichever call
    lands second ends up with the higher version, regardless of which
    "page" it came from — the version has no notion of caller identity, only
    write order, which is exactly the "newer, no matter who wrote it" rule
    the frontend comparison needs.
    """
    _patch(monkeypatch, {"user_id": UID, "version": 0, "cover_plan_excluded_accounts": []})

    settings_write = asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1"]}, {"email": UID},
    ))
    penny_write = asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1", "acc-2"]}, {"email": UID},
    ))

    assert settings_write["version"] == 1
    assert penny_write["version"] == 2
    assert penny_write["version"] > settings_write["version"]

    final = asyncio.run(preferences.get_preferences({"email": UID}))
    assert final["cover_plan_excluded_accounts"] == ["acc-1", "acc-2"]
    assert final["version"] == 2
