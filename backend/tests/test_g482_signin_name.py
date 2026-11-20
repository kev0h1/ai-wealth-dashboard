"""G482: the sign-in name is captured for onboarding pre-fill, once, never over a saved name."""
import asyncio

import app.core.identity as identity_module
import app.routers.profile as profile_module
from app.core.identity import capture_signin_name, split_full_name


def _run(coro):
    return asyncio.run(coro)


class FakeProfilesCol:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, filt, projection=None):
        d = self.docs.get(filt["_id"])
        return dict(d) if d else None

    async def update_one(self, filt, update, upsert=False):
        created = filt["_id"] not in self.docs
        doc = self.docs.setdefault(filt["_id"], {"_id": filt["_id"]})
        if created:
            doc.update(update.get("$setOnInsert", {}))
        doc.update(update.get("$set", {}))


def _patch(monkeypatch, docs=None):
    col = FakeProfilesCol(docs)
    monkeypatch.setattr(identity_module, "user_profiles_col", col)
    monkeypatch.setattr(profile_module, "user_profiles_col", col)
    return col


def test_google_given_and_family_name_are_exposed(monkeypatch):
    col = _patch(monkeypatch)
    _run(capture_signin_name("a@example.com", "Ada", "Lovelace"))
    out = _run(profile_module.get_profile({"email": "a@example.com"}))
    assert out["given_name"] == "Ada" and out["family_name"] == "Lovelace"
    assert "full_name" in out and out["full_name"] == ""
    assert col.docs["a@example.com"]["onboarding_complete"] is False


def test_apple_first_signin_name_is_captured_and_never_overwritten(monkeypatch):
    col = _patch(monkeypatch)
    given, family = split_full_name("Grace Brewster Hopper")
    _run(capture_signin_name("g@example.com", given, family))
    _run(capture_signin_name("g@example.com", "Other", "Person"))
    _run(capture_signin_name("g@example.com", "", ""))
    assert col.docs["g@example.com"]["signin_name"] == {"given": "Grace", "family": "Brewster Hopper"}


def test_a_name_the_user_already_set_is_untouched(monkeypatch):
    col = _patch(monkeypatch, [{"_id": "u@example.com", "full_name": "Real Name", "onboarding_complete": True}])
    _run(capture_signin_name("u@example.com", "Provider", "Name"))
    assert col.docs["u@example.com"]["full_name"] == "Real Name"
    assert col.docs["u@example.com"]["onboarding_complete"] is True


def test_no_name_means_empty_fields_and_nothing_stored(monkeypatch):
    col = _patch(monkeypatch)
    _run(capture_signin_name("n@example.com", None, ""))
    assert "n@example.com" not in col.docs
    out = _run(profile_module.get_profile({"email": "n@example.com"}))
    assert out["given_name"] == "" and out["family_name"] == ""


def test_split_full_name():
    assert split_full_name("") == ("", "")
    assert split_full_name("Cher") == ("Cher", "")
