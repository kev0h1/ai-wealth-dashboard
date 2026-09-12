"""G45: Kevin unticked two accounts in the cover-plan sources control on
Settings, refreshed, and both were ticked again — the stored value was
verified empty in both the preferences collection and GET /preferences, so
the write never landed. The root cause turned out to be entirely in
frontend/app/settings/SettingsPage.tsx (an impure setExcludedIds updater
firing the network call, a swallowed .catch, and an effect that could
clobber an in-flight save with a stale rawPrefs snapshot) — there is no
frontend test harness in this repo (no jest/vitest/testing-library, no
existing *.test.tsx anywhere), so per the G45 instructions this file instead
locks down the backend half of the contract PATCH /preferences and
GET /preferences make with the frontend: a PATCH carrying
cover_plan_excluded_accounts actually persists, including the exact
Kevin scenario of shrinking the excluded set back down to empty, and a
subsequent GET reflects exactly what was persisted.

`_FakeCol` mirrors the mutating fake already used in
tests/test_penny_proposals_preferences.py (update_one applies `$set` onto
the stored doc, so find_one afterwards reflects the write) rather than
tests/test_safe_to_spend_hardening.py's `_PrefsCol`, whose update_one is a
call-recorder only and would not catch a persistence regression here.
`response_cache` is monkeypatched to a no-op spy so these tests don't need
a real Mongo `user_data_version_col` for the ainvalidate() version bump.
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
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
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


def test_patch_preferences_persists_cover_plan_excluded_accounts(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1", "acc-2"]},
        {"email": UID},
    ))

    stored = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert stored["cover_plan_excluded_accounts"] == ["acc-1", "acc-2"]


def test_get_preferences_returns_the_persisted_exclusions(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-1", "acc-2"]},
        {"email": UID},
    ))
    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["cover_plan_excluded_accounts"] == ["acc-1", "acc-2"]


def test_unticking_every_excluded_account_persists_the_empty_list(monkeypatch):
    """The exact Kevin repro: two accounts were excluded, he unticked both
    (the UI's next set is []), refreshed, and GET /preferences still showed
    both ticked — i.e. the PATCH to an empty list never landed. An empty
    list is still `"cover_plan_excluded_accounts" in body`, so the router
    must persist it rather than treating it as absent/no-op."""
    fake_prefs = _patch(monkeypatch, {
        "user_id": UID,
        "cover_plan_excluded_accounts": ["acc-1", "acc-2"],
    })

    asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": []},
        {"email": UID},
    ))
    result = asyncio.run(preferences.get_preferences({"email": UID}))

    assert result["cover_plan_excluded_accounts"] == []


def test_cover_plan_excluded_accounts_are_deduped_and_sorted(monkeypatch):
    fake_prefs = _patch(monkeypatch, {"user_id": UID})

    asyncio.run(preferences.update_preferences(
        {"cover_plan_excluded_accounts": ["acc-2", "acc-1", "acc-1", " "]},
        {"email": UID},
    ))

    stored = asyncio.run(fake_prefs.find_one({"user_id": UID}))
    assert stored["cover_plan_excluded_accounts"] == ["acc-1", "acc-2"]
