"""G296: Profile no longer holds a home location and Fuel needs point-of-use coordinates."""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.fuel as fuel_module
import app.routers.profile as profile_module


def _run(coro):
    return asyncio.run(coro)


class FakeProfilesCol:
    def __init__(self, docs=None):
        self.docs = {doc["_id"]: dict(doc) for doc in (docs or [])}

    async def find_one(self, filt):
        doc = self.docs.get(filt["_id"])
        return dict(doc) if doc else None

    async def update_one(self, filt, update, upsert=False):
        doc_id = filt["_id"]
        created = doc_id not in self.docs
        doc = self.docs.setdefault(doc_id, {"_id": doc_id})
        if created:
            doc.update(update.get("$setOnInsert", {}))
        doc.update(update.get("$set", {}))


def test_profile_ignores_legacy_postcode_input_without_storing_or_geocoding(monkeypatch):
    profiles = FakeProfilesCol()
    monkeypatch.setattr(profile_module, "user_profiles_col", profiles)

    saved = _run(profile_module.update_profile(
        {"full_name": "Kevin Maingi", "postcode": "not a postcode"},
        {"email": "kevin@example.com"},
    ))

    assert saved["full_name"] == "Kevin Maingi"
    assert "postcode" not in saved
    assert "lat" not in saved
    assert "lng" not in saved
    assert not {"postcode", "lat", "lng"}.intersection(profiles.docs["kevin@example.com"])
    assert not hasattr(profile_module, "geocode_postcode")


def test_profile_hides_legacy_home_location_without_erasing_it(monkeypatch):
    email = "legacy@example.com"
    profiles = FakeProfilesCol([{
        "_id": email,
        "full_name": "Old User",
        "postcode": "SW1A 1AA",
        "lat": 51.501,
        "lng": -0.141,
    }])
    monkeypatch.setattr(profile_module, "user_profiles_col", profiles)

    response = _run(profile_module.get_profile({"email": email}))

    assert not {"postcode", "lat", "lng"}.intersection(response)
    assert profiles.docs[email]["postcode"] == "SW1A 1AA"
    assert profiles.docs[email]["lat"] == 51.501
    assert profiles.docs[email]["lng"] == -0.141


def test_fuel_uses_explicit_point_of_use_coordinates(monkeypatch):
    monkeypatch.setattr(fuel_module, "load_snapshot", lambda: {
        "fetched_at": "2026-10-20T10:00:00Z",
        "stations": [{
            "node_id": "station-1",
            "brand_name": "Station brand",
            "trading_name": "Station name",
            "postcode": "SW1A 1AA",
            "city": "London",
            "lat": 51.501,
            "lng": -0.141,
            "prices": {"E10": 140.9},
            "updated": {"E10": "2026-10-20T09:00:00Z"},
        }],
    })

    response = _run(fuel_module.fuel_nearby(
        user={"email": "kevin@example.com"}, grade="E10", lat=51.501, lng=-0.141,
        radius_km=8.0, paid=None, limit=8,
    ))

    assert response["anchor"] == {"lat": 51.501, "lng": -0.141}
    assert response["stations"][0]["lat"] == 51.501
    assert response["stations"][0]["lng"] == -0.141


def test_fuel_missing_coordinates_is_actionable_and_never_reads_profile():
    assert not hasattr(fuel_module, "user_profiles_col")

    with pytest.raises(HTTPException) as exc_info:
        _run(fuel_module.fuel_nearby(
            user={"email": "kevin@example.com"}, grade="E10", lat=None, lng=None,
            radius_km=8.0, paid=None, limit=8,
        ))

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail == "Share your current location to see nearby fuel prices."
