"""G279: pay-split reference is a validated, user-scoped preference."""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.preferences as preferences

UID = "user@example.com"
OTHER_UID = "other@example.com"


class _UpdateResult:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class _FakeCol:
    """Small async collection fake that honours user filters and writes."""
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.writes = 0

    @staticmethod
    def _matches(doc, query):
        for key, value in (query or {}).items():
            if isinstance(value, dict) and "$exists" in value:
                if (key in doc) != value["$exists"]:
                    return False
            elif doc.get(key) != value:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if self._matches(doc, query):
                return doc
        return None

    async def update_one(self, filt, update, upsert=False):
        for doc in self.docs:
            if self._matches(doc, filt):
                self.writes += 1
                doc.update(update.get("$set") or {})
                for field, amount in (update.get("$inc") or {}).items():
                    doc[field] = doc.get(field, 0) + amount
                return _UpdateResult(1)
        if upsert:
            self.writes += 1
            doc = dict(filt)
            doc.update(update.get("$set") or {})
            doc.update(update.get("$setOnInsert") or {})
            for field, amount in (update.get("$inc") or {}).items():
                doc[field] = doc.get(field, 0) + amount
            self.docs.append(doc)
        return _UpdateResult(0)


class _CacheSpy:
    async def ainvalidate(self, uid):
        pass


def _patch(monkeypatch, docs=None):
    col = _FakeCol(docs)
    monkeypatch.setattr(preferences, "preferences_col", col)
    monkeypatch.setattr(preferences, "response_cache", _CacheSpy())
    return col


def test_get_and_unrelated_patch_default_missing_or_corrupt_reference(monkeypatch):
    col = _patch(monkeypatch, [
        {"user_id": UID, "version": 4},
        {"user_id": OTHER_UID, "pay_split_reference": None},
    ])

    assert asyncio.run(preferences.get_preferences({"email": UID}))["pay_split_reference"] == "50-30-20"
    patched = asyncio.run(preferences.update_preferences({"dark_mode": True}, {"email": UID}))

    assert patched["pay_split_reference"] == "50-30-20"
    assert patched["version"] == 5
    assert "pay_split_reference" not in col.docs[0]
    assert asyncio.run(preferences.get_preferences({"email": OTHER_UID}))["pay_split_reference"] == "50-30-20"
    assert col.docs[1]["pay_split_reference"] is None


@pytest.mark.parametrize("bad", (None, [], {}, 42, True, "60-20-20"))
def test_corrupt_stored_reference_never_raises_or_rewrites(monkeypatch, bad):
    col = _patch(monkeypatch, [{"user_id": UID, "version": 2, "pay_split_reference": bad}])
    assert asyncio.run(preferences.get_preferences({"email": UID}))["pay_split_reference"] == "50-30-20"
    assert col.writes == 0


@pytest.mark.parametrize("reference", ("50-30-20", "conscious", "first"))
def test_patch_persists_each_valid_reference_and_returns_incremented_version(monkeypatch, reference):
    col = _patch(monkeypatch, [{"user_id": UID, "version": 8}])

    result = asyncio.run(preferences.update_preferences(
        {"pay_split_reference": reference}, {"email": UID},
    ))

    assert result == {
        "hide_net_worth": False,
        "show_tips": True,
        "dark_mode": False,
        "open_last_chat": False,
        "pay_split_reference": reference,
        "version": 9,
    }
    assert col.docs == [{"user_id": UID, "version": 9, "pay_split_reference": reference}]


@pytest.mark.parametrize("reference", (None, 0, True, "60-20-20", "unknown", ["50-30-20"]))
def test_invalid_reference_is_rejected_before_any_write(monkeypatch, reference):
    col = _patch(monkeypatch, [{"user_id": UID, "version": 3, "dark_mode": False}])

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(preferences.update_preferences(
            {"pay_split_reference": reference}, {"email": UID},
        ))

    assert exc_info.value.status_code == 422
    assert col.writes == 0
    assert col.docs == [{"user_id": UID, "version": 3, "dark_mode": False}]


def test_patch_is_user_scoped_and_get_returns_existing_reference(monkeypatch):
    col = _patch(monkeypatch, [
        {"user_id": UID, "version": 1, "pay_split_reference": "conscious"},
        {"user_id": OTHER_UID, "version": 6, "pay_split_reference": "first"},
    ])

    result = asyncio.run(preferences.update_preferences(
        {"pay_split_reference": "50-30-20"}, {"email": UID},
    ))

    assert result["pay_split_reference"] == "50-30-20"
    assert result["version"] == 2
    assert col.docs[0]["pay_split_reference"] == "50-30-20"
    assert col.docs[1] == {"user_id": OTHER_UID, "version": 6, "pay_split_reference": "first"}
    assert asyncio.run(preferences.get_preferences({"email": OTHER_UID}))["pay_split_reference"] == "first"
