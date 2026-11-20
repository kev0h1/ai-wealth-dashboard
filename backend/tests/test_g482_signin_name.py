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
        existing = self.docs.get(filt["_id"])
        if existing is not None and any(
            v == {"$exists": False} and k in existing for k, v in filt.items() if k != "_id"
        ):
            self.dup_attempts = getattr(self, "dup_attempts", 0) + 1
            raise RuntimeError("E11000 duplicate key")
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


def test_non_string_values_never_raise_or_store(monkeypatch):
    col = _patch(monkeypatch)
    for bad in (["Ada"], 7, {"a": "b"}):
        _run(capture_signin_name("b@example.com", bad, bad))
    assert "b@example.com" not in col.docs
    assert split_full_name(["Ada", "L"]) == ("", "")
    assert split_full_name({"a": 1}) == ("", "")
    assert split_full_name(5) == ("", "")
    # a good family name still stores when the given name is junk
    _run(capture_signin_name("b@example.com", 7, "Lovelace"))
    assert col.docs["b@example.com"]["signin_name"] == {"given": "", "family": "Lovelace"}


def test_names_are_capped_at_40_characters(monkeypatch):
    col = _patch(monkeypatch)
    _run(capture_signin_name("c@example.com", "A" * 90, "B" * 41))
    assert col.docs["c@example.com"]["signin_name"] == {"given": "A" * 40, "family": "B" * 40}


def test_never_overwrite_is_a_single_atomic_update(monkeypatch):
    calls = []

    class Spy(FakeProfilesCol):
        async def find_one(self, *a, **k):
            raise AssertionError("no read-then-write")

        async def update_one(self, filt, update, upsert=False):
            calls.append(filt)
            return await super().update_one(filt, update, upsert)

    col = Spy()
    monkeypatch.setattr(identity_module, "user_profiles_col", col)
    _run(capture_signin_name("d@example.com", "First", "One"))
    _run(capture_signin_name("d@example.com", "Second", "Two"))  # loses: filter misses, dup key swallowed
    assert col.docs["d@example.com"]["signin_name"] == {"given": "First", "family": "One"}
    assert all(f.get("signin_name") == {"$exists": False} for f in calls)
    assert col.dup_attempts == 1
