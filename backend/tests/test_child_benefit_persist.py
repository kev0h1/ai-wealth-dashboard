"""G58: handleChildBenefitToggle in frontend/app/settings/SettingsPage.tsx
called api.updatePreferences({has_child_benefit: next}).catch(() => {}), so a
failed save left the switch showing a value the server never stored with
nothing told to the user, and the rawPrefs sync effect read
`if (rawPrefs.has_child_benefit)` -- a truthiness check that can never see a
genuine `false` from the server, so a refetch after a failed "turn it off"
save could never correct the display back to "on" (false is falsy) and,
symmetrically, a refetch could never confirm a genuine "off" either. The
frontend fix is entirely in SettingsPage.tsx (revert-and-surface on failure,
plus a key-presence check replacing the truthiness one, following the
G45/G52 shape) -- there is no frontend test harness in this repo, so per the
G45/G52 pattern this file instead locks down the backend half of the
contract PATCH /preferences and GET /preferences make with the frontend: a
PATCH carrying has_child_benefit actually persists, including the exact
"turn it back off" case that is the whole point of the bug (false must
never be dropped or omitted the way an `or False`/truthy-only path would),
and a subsequent GET reflects exactly what was persisted rather than
silently reporting the default.

`_FakeCol` is the mutating double used by test_notification_prefs_persist.py
and test_cover_plan_exclusions_persist.py (update_one applies `$set` onto
the stored doc, so find_one afterwards reflects the write). Copied rather
than imported so this file has no import-time coupling to another test
module's internals.
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


def test_patch_preferences_persists_has_child_benefit_true(monkeypatch):
    _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"has_child_benefit": True},
        {"email": UID},
    ))
    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["has_child_benefit"] is True


def test_patch_preferences_persists_has_child_benefit_back_to_false(monkeypatch):
    """The exact scenario the G58 bug report describes: turn it on, then
    turn it back off. A `false` write must land and be read back as `false`,
    not silently ignored or reported as the default because it is falsy."""
    _patch(monkeypatch, {"user_id": UID, "has_child_benefit": True})

    asyncio.run(preferences.update_preferences(
        {"has_child_benefit": False},
        {"email": UID},
    ))
    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["has_child_benefit"] is False


def test_get_preferences_returns_false_rather_than_omitting_the_key(monkeypatch):
    """A user who has never touched this toggle, or whose stored value is
    False, must get an explicit `false` back from GET, not a missing key --
    the frontend's sync effect keys off presence (`"has_child_benefit" in
    rawPrefs`), not truthiness, since G58, so an omitted key would be
    silently ignored just like a falsy one used to be."""
    _patch(monkeypatch, {"user_id": UID, "has_child_benefit": False})

    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert "has_child_benefit" in result
    assert result["has_child_benefit"] is False


def test_patching_has_child_benefit_does_not_clobber_unrelated_fields(monkeypatch):
    """A partial update to has_child_benefit must not touch a sibling field
    written earlier in the same document -- income/pension are set from
    separate handlers (handleIncomeBlur/handlePensionBlur) on the same
    Settings page."""
    fake_prefs = _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"income_value": 70000, "income_bracket": "under_100k"},
        {"email": UID},
    ))
    asyncio.run(preferences.update_preferences(
        {"has_child_benefit": True},
        {"email": UID},
    ))

    stored = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert stored["income_value"] == 70000
    assert stored["has_child_benefit"] is True


def test_child_benefit_patch_advances_the_shared_version_counter(monkeypatch):
    """has_child_benefit is written through the same PATCH /preferences
    endpoint as cover_plan_excluded_accounts and notification_prefs, so it
    must advance the same monotonic `version` counter G45 added -- that is
    what lets notePreferencesVersion()/PreferencesContext.tsx tell a stale
    GET apart from a genuinely newer one for THIS field too."""
    _patch(monkeypatch, {"user_id": UID})

    first = asyncio.run(preferences.update_preferences(
        {"has_child_benefit": True},
        {"email": UID},
    ))
    second = asyncio.run(preferences.update_preferences(
        {"has_child_benefit": False},
        {"email": UID},
    ))

    assert second["version"] > first["version"]
