"""G501: new sign-ups get category_pie pinned to Home; everyone else is unchanged.

Fake collections, the convention in test_open_signup.py (no mongomock here).
"""
import asyncio

import app.core.identity as identity_module
import app.routers.preferences as prefs_module
from app.core.identity import resolve_signin_email


def _run(coro):
    return asyncio.run(coro)


class FakeCol:
    """Minimal collection keyed by whichever of _id / user_id the filter names."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    def _match(self, d, filt):
        return all(d.get(k) == v for k, v in filt.items())

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if self._match(d, filt):
                return dict(d)
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set", {}))
                return
        if upsert:
            doc = dict(filt)
            doc.update(update.get("$setOnInsert", {}))
            doc.update(update.get("$set", {}))
            self.docs.append(doc)


def _setup(monkeypatch, prefs=None, profiles=None, accounts=None):
    cols = {
        "linked_identities_col": FakeCol(),
        "preferences_col": FakeCol(prefs),
        "user_profiles_col": FakeCol(profiles),
        "connections_col": FakeCol(),
        "accounts_col": FakeCol(accounts),
        "manual_accounts_col": FakeCol(),
        "statement_accounts_col": FakeCol(),
    }
    for name, col in cols.items():
        monkeypatch.setattr(identity_module, name, col)
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: True)

    async def _no_allow(_c):
        return None

    monkeypatch.setattr(identity_module, "resolve_allowed_signup", _no_allow)
    monkeypatch.setattr(prefs_module, "preferences_col", cols["preferences_col"])
    return cols


def _pinned(cols, uid):
    for d in cols["preferences_col"].docs:
        if d["user_id"] == uid:
            return d.get("home_pinned_widget", "<unset>")
    return "<no doc>"


def test_new_google_signup_gets_category_pie(monkeypatch):
    cols = _setup(monkeypatch)
    for provider in ("google-native", "google-mobile", "google-web"):
        email = f"{provider}@example.com"
        assert _run(resolve_signin_email(provider, email)) == email
        assert _pinned(cols, email) == "category_pie"


def test_new_apple_signup_gets_category_pie(monkeypatch):
    cols = _setup(monkeypatch)
    out = _run(resolve_signin_email("apple-native", "relay@privaterelay.appleid.com", subject="s1", relay=True))
    assert _pinned(cols, out) == "category_pie"


def test_second_signin_does_not_reseed_after_user_unpins(monkeypatch):
    cols = _setup(monkeypatch)
    _run(resolve_signin_email("google-native", "u@example.com"))
    cols["preferences_col"].docs[0]["home_pinned_widget"] = None  # user chose to unpin
    _run(resolve_signin_email("google-native", "u@example.com"))
    assert _pinned(cols, "u@example.com") is None


def test_existing_user_without_saved_value_keeps_period_compare(monkeypatch):
    # Pre-alias existing user: has a preferences doc but no home_pinned_widget.
    cols = _setup(monkeypatch, prefs=[{"user_id": "old@example.com", "dark_mode": True}])
    _run(resolve_signin_email("google-native", "old@example.com"))
    assert _pinned(cols, "old@example.com") == "<unset>"
    out = _run(prefs_module.get_preferences({"email": "old@example.com"}))
    assert out["home_pinned_widget"] == "period_compare"


def test_existing_user_with_only_accounts_or_profile_is_not_seeded(monkeypatch):
    cols = _setup(
        monkeypatch,
        profiles=[{"_id": "p@example.com"}],
        accounts=[{"user_id": "a@example.com"}],
    )
    for email in ("p@example.com", "a@example.com"):
        _run(resolve_signin_email("google-native", email))
        assert _pinned(cols, email) == "<no doc>"


def test_saved_choice_is_untouched(monkeypatch):
    cols = _setup(monkeypatch, prefs=[{"user_id": "c@example.com", "home_pinned_widget": "pace_curve"}])
    _run(resolve_signin_email("google-native", "c@example.com"))
    assert _pinned(cols, "c@example.com") == "pace_curve"


def test_unset_fallback_constant_is_still_period_compare():
    assert prefs_module.DEFAULT_HOME_PINNED_WIDGET == "period_compare"
