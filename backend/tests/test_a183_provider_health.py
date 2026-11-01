"""A183 part 4: the provider cache keeps health_status, roles, logo_url and
bg_colors; providers without ais stay hidden; the providers API exposes
health_status (and nothing remote) for the picker notice."""
import asyncio

import app.routers.finexer as finexer_router
import app.services.finexer_sync as fs
from tests.test_finexer_provider_cache import FakeResp, ProvidersClient


def _list(monkeypatch, items):
    class Col:
        async def find_one(self, *a, **k):
            return None

        async def replace_one(self, *a, **k):
            return None

    monkeypatch.setattr(fs, "finexer_providers_col", Col())
    monkeypatch.setattr(fs, "_providers_memo", None)
    monkeypatch.setattr(fs, "_client", lambda: ProvidersClient([FakeResp(200, {"data": items, "paging": {}})]))
    return asyncio.run(fs.list_providers())


def test_cache_keeps_health_roles_logo_and_colours_and_hides_non_ais(monkeypatch):
    out = _list(monkeypatch, [
        {"id": "a", "name": "A", "roles": ["ais", "pis"], "logo_url": "https://x/a.png", "bg_colors": ["#fff"], "health_status": "degraded"},
        {"id": "b", "name": "B", "roles": ["pis"], "logo_url": "", "bg_colors": []},
        {"id": "c", "name": "C", "roles": ["ais"], "health_status": "DOWN"},
        {"id": "d", "name": "D", "roles": ["ais"]},
    ])
    assert [p["id"] for p in out] == ["a", "c", "d"]
    a = out[0]
    assert a["health_status"] == "degraded" and a["roles"] == ["ais", "pis"]
    assert a["logo_url"] == "https://x/a.png" and a["bg_colors"] == ["#fff"]
    assert out[1]["health_status"] == "down"
    assert out[2]["health_status"] == "operational"


def test_provider_health_normalises_unknown_values_to_operational():
    assert fs.provider_health(None) == "operational"
    assert fs.provider_health("weird") == "operational"
    assert fs.provider_health("Degraded") == "degraded"


def test_api_exposes_health_status_and_not_remote_logo_or_roles(monkeypatch):
    async def _providers():
        return [{"id": "a", "name": "Alpha", "logo": "", "logo_url": "https://x/a.png", "roles": ["ais"],
                 "bg_colors": [], "health_status": "down"}]

    async def _no_health():
        return {}

    monkeypatch.setattr(finexer_router, "provider_health_map", _no_health)
    monkeypatch.setattr(finexer_router, "list_providers", _providers)
    monkeypatch.setattr(finexer_router, "_providers_cache", [])
    out = asyncio.run(finexer_router.finexer_providers(user={"email": "t@example.com"}))
    assert out == [{"id": "a", "name": "Alpha", "logo": "", "bg_colors": [], "health_status": "down"}]


def test_api_defaults_a_cached_provider_without_health_to_operational(monkeypatch):
    async def _providers():
        return [{"id": "a", "name": "Alpha", "logo": "", "bg_colors": []}]

    async def _no_health():
        return {}

    monkeypatch.setattr(finexer_router, "provider_health_map", _no_health)
    monkeypatch.setattr(finexer_router, "list_providers", _providers)
    monkeypatch.setattr(finexer_router, "_providers_cache", [])
    out = asyncio.run(finexer_router.finexer_providers(user={"email": "t@example.com"}))
    assert out[0]["health_status"] == "operational"


def test_health_flip_shows_within_the_short_ttl_while_the_list_stays_cached(monkeypatch):
    clock = {"t": 1000.0}
    monkeypatch.setattr(fs.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(fs, "_health_memo", None)
    status = {"v": "down"}
    calls = {"n": 0}

    def make_client():
        calls["n"] += 1
        return ProvidersClient([FakeResp(200, {"data": [{"id": "a", "health_status": status["v"]}], "paging": {}})])

    monkeypatch.setattr(fs, "_client", make_client)
    assert asyncio.run(fs.provider_health_map()) == {"a": "down"}
    status["v"] = "operational"
    clock["t"] += 300
    assert asyncio.run(fs.provider_health_map()) == {"a": "down"}      # inside 10 minutes: no re-read
    assert calls["n"] == 1
    clock["t"] += 400
    assert asyncio.run(fs.provider_health_map()) == {"a": "operational"}
    assert calls["n"] == 2


def test_failed_health_read_serves_the_last_map(monkeypatch):
    clock = {"t": 5000.0}
    monkeypatch.setattr(fs.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(fs, "_health_memo", {"map": {"a": "down"}, "at": 0.0})
    monkeypatch.setattr(fs, "_client", lambda: ProvidersClient([FakeResp(500, {})]))
    assert asyncio.run(fs.provider_health_map()) == {"a": "down"}


def test_api_overlays_live_health_on_the_cached_list(monkeypatch):
    async def _providers():
        return [{"id": "a", "name": "Alpha", "logo": "", "bg_colors": [], "health_status": "down"}]

    async def _live():
        return {"a": "operational"}

    monkeypatch.setattr(finexer_router, "provider_health_map", _live)
    monkeypatch.setattr(finexer_router, "list_providers", _providers)
    monkeypatch.setattr(finexer_router, "_providers_cache", [])
    out = asyncio.run(finexer_router.finexer_providers(user={"email": "t@example.com"}))
    assert out[0]["health_status"] == "operational"
