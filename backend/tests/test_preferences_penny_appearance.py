"""G388: Penny's icon treatment is a validated, user-scoped preference."""
import asyncio
import pytest
from fastapi import HTTPException
import app.routers.preferences as preferences

UID = "user@example.com"

class _Result:
    def __init__(self, matched_count): self.matched_count = matched_count

class _Collection:
    def __init__(self, docs): self.docs, self.writes = docs, 0
    async def find_one(self, query=None, projection=None):
        return next((doc for doc in self.docs if all(doc.get(key) == value for key, value in (query or {}).items())), None)
    async def update_one(self, filt, update, upsert=False):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in filt.items()):
                self.writes += 1
                doc.update(update.get("$set") or {})
                for key, value in (update.get("$inc") or {}).items(): doc[key] = doc.get(key, 0) + value
                return _Result(1)
        return _Result(0)

class _Cache:
    async def ainvalidate(self, uid): return None

def _patch(monkeypatch, appearance=None):
    doc = {"user_id": UID, "version": 3}
    if appearance is not None: doc["penny_appearance"] = appearance
    col = _Collection([doc])
    monkeypatch.setattr(preferences, "preferences_col", col)
    monkeypatch.setattr(preferences, "response_cache", _Cache())
    return col

def test_missing_or_corrupt_appearance_reads_as_ink_without_rewrite(monkeypatch):
    # G398: Ink is the fallback for anyone who has never chosen.
    for value in (None, "chat", [], 9):
        col = _patch(monkeypatch, value)
        assert asyncio.run(preferences.get_preferences({"email": UID}))["penny_appearance"] == "ink"
        assert col.writes == 0


@pytest.mark.parametrize("stored", ("original", "outline", "ink"))
def test_stored_appearance_is_returned_unchanged_and_never_rewritten(monkeypatch, stored):
    col = _patch(monkeypatch, stored)
    assert asyncio.run(preferences.get_preferences({"email": UID}))["penny_appearance"] == stored
    assert col.writes == 0
    assert col.docs[0]["penny_appearance"] == stored

@pytest.mark.parametrize("appearance", ("original", "outline", "ink"))
def test_appearance_persists_and_returns_the_incremented_version(monkeypatch, appearance):
    col = _patch(monkeypatch)
    result = asyncio.run(preferences.update_preferences({"penny_appearance": appearance}, {"email": UID}))
    assert result["penny_appearance"] == appearance
    assert result["version"] == 4
    assert col.docs[0]["penny_appearance"] == appearance


def test_appearance_write_is_scoped_to_the_current_user(monkeypatch):
    col = _patch(monkeypatch)
    col.docs.append({"user_id": "other@example.com", "version": 7, "penny_appearance": "ink"})
    asyncio.run(preferences.update_preferences({"penny_appearance": "outline"}, {"email": UID}))
    assert col.docs[0]["penny_appearance"] == "outline"
    assert col.docs[1] == {"user_id": "other@example.com", "version": 7, "penny_appearance": "ink"}

@pytest.mark.parametrize("appearance", (None, True, "chat", "C1", []))
def test_invalid_appearance_is_rejected_before_a_write(monkeypatch, appearance):
    col = _patch(monkeypatch)
    with pytest.raises(HTTPException) as error:
        asyncio.run(preferences.update_preferences({"penny_appearance": appearance}, {"email": UID}))
    assert error.value.status_code == 422
    assert col.writes == 0
