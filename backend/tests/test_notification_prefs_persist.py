"""G52: notification preference toggles could fail silently, the same triple
defect G45 fixed for cover-plan exclusions -- toggleNotifPref in
frontend/app/settings/SettingsPage.tsx called api.updatePreferences from
inside the setNotifPrefs state updater (impure, could fire the PATCH twice
or not at all), ended in .catch(() => {}) so a failed save was invisible,
and the rawPrefs sync effect reapplied notification_prefs on every refetch
with no guard, so a refetch landing mid-save could silently revert the
choice. The frontend fix is entirely in SettingsPage.tsx (reusing G45's own
serial queue and version facilities, see that file's block comment above
runNotifToggle) -- there is no frontend test harness in this repo, so per
the G45/G52 pattern this file instead locks down the backend half of the
contract PATCH /preferences and GET /preferences make with the frontend: a
PATCH carrying notification_prefs actually persists, a subsequent GET
reflects exactly what was persisted (merged against NOTIF_DEFAULTS the same
way GET already does for every other key), and a partial update to ONE side
(notification_prefs vs. an unrelated field) never clobbers the other.

`_FakeCol` is the fuller mutating double from
tests/test_preferences_versioning.py (applies both `$set` and `$inc`, unlike
tests/test_cover_plan_exclusions_persist.py's own `_FakeCol` which only
applies `$set`) -- needed here too since one of the tests below checks that
a notification_prefs write advances the same monotonic version counter.
Copied rather than imported so this file has no import-time coupling to
another test module's internals.
"""
import asyncio

import app.routers.preferences as preferences
from app.services.notifications import NOTIF_DEFAULTS

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
    def __init__(self):
        self.calls = []

    def invalidate(self, *args):
        self.calls.append(("invalidate", args))

    async def ainvalidate(self, uid):
        self.calls.append(("ainvalidate", (uid,)))


def _patch(monkeypatch, doc=None):
    fake_prefs = _FakeCol([doc] if doc is not None else [])
    monkeypatch.setattr(preferences, "preferences_col", fake_prefs)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return fake_prefs


def test_patch_preferences_persists_notification_prefs(monkeypatch):
    _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"notification_prefs": {**{k: True for k in NOTIF_DEFAULTS}, "transactions": True}},
        {"email": UID},
    ))
    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["notification_prefs"]["transactions"] is True


def test_get_preferences_returns_the_persisted_notification_prefs(monkeypatch):
    _patch(monkeypatch, {"user_id": UID})

    # Turn one normally-on default off -- the exact "toggle off, expect it
    # to stay off" scenario the G52 bug report describes.
    disabled = {k: (False if k == "bill_alerts" else v) for k, v in NOTIF_DEFAULTS.items()}
    asyncio.run(preferences.update_preferences(
        {"notification_prefs": disabled},
        {"email": UID},
    ))
    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["notification_prefs"]["bill_alerts"] is False
    # Every other key still reflects what was sent, not silently reset to
    # NOTIF_DEFAULTS -- the merge in _notif_prefs must read the SAVED value.
    for key, default in NOTIF_DEFAULTS.items():
        if key == "bill_alerts":
            continue
        assert result["notification_prefs"][key] == default


def test_patching_notification_prefs_does_not_clobber_unrelated_fields(monkeypatch):
    """A partial update to notification_prefs must not touch a sibling field
    written earlier in the same document -- $set only ever touches the keys
    present in the PATCH body, but this pins that contract down explicitly
    since the frontend relies on it (income/pension fields are set from a
    completely separate handler on the same Settings page)."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"income_value": 55000, "income_bracket": "under_100k"},
        {"email": UID},
    ))
    asyncio.run(preferences.update_preferences(
        {"notification_prefs": {**NOTIF_DEFAULTS, "insights": False}},
        {"email": UID},
    ))

    stored = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert stored["income_value"] == 55000
    assert stored["notification_prefs"]["insights"] is False


def test_patching_an_unrelated_field_does_not_clobber_notification_prefs(monkeypatch):
    """The reverse direction of the same guarantee: once notification_prefs
    has been saved, a later PATCH to an unrelated field (e.g. the financial
    profile's pension_annual, saved via handlePensionBlur on the same page)
    must not reset or drop it."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"notification_prefs": {**NOTIF_DEFAULTS, "goal_milestones": False}},
        {"email": UID},
    ))
    asyncio.run(preferences.update_preferences(
        {"pension_annual": 4000},
        {"email": UID},
    ))

    result = asyncio.run(preferences.get_preferences({"email": UID}))
    assert result["pension_annual"] == 4000
    assert result["notification_prefs"]["goal_milestones"] is False


def test_notification_prefs_patch_advances_the_shared_version_counter(monkeypatch):
    """notification_prefs is written through the same PATCH /preferences
    endpoint as cover_plan_excluded_accounts, so it must advance the same
    monotonic `version` counter G45 added -- that is what lets
    PreferencesContext.tsx tell a stale GET apart from a genuinely newer one
    for THIS field too, not just the cover-plan one."""
    _patch(monkeypatch, {"user_id": UID})

    first = asyncio.run(preferences.update_preferences(
        {"notification_prefs": {**NOTIF_DEFAULTS, "transactions": True}},
        {"email": UID},
    ))
    second = asyncio.run(preferences.update_preferences(
        {"notification_prefs": {**NOTIF_DEFAULTS, "transactions": False}},
        {"email": UID},
    ))

    assert second["version"] > first["version"]
