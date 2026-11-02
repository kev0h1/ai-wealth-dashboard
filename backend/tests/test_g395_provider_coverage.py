"""G395: provider coverage metadata is explicit and survives the route cache."""
import asyncio

import app.routers.finexer as finexer_router


def test_provider_coverage_known_unknown_and_cached(monkeypatch):
    calls = {"count": 0}

    async def fake_list_providers():
        calls["count"] += 1
        return [
            {"id": "monzo", "name": "Monzo", "logo": "", "bg_colors": []},
            {"id": "not_listed", "name": "Unknown Bank", "logo": "", "bg_colors": []},
        ]

    async def no_live_health():
        return {}

    monkeypatch.setattr(finexer_router, "list_providers", fake_list_providers)
    monkeypatch.setattr(finexer_router, "provider_health_map", no_live_health)
    monkeypatch.setattr(finexer_router, "_providers_cache", [])
    monkeypatch.setattr(finexer_router, "_providers_cache_at", 0.0)

    first = asyncio.run(finexer_router.finexer_providers(user={"email": "t@example.com"}))
    second = asyncio.run(finexer_router.finexer_providers(user={"email": "t@example.com"}))

    by_id = {provider["id"]: provider for provider in first}
    assert by_id["monzo"]["supported_kinds"] == ["current"]
    assert by_id["monzo"]["coverage_captured_on"] == "2026-11-02"
    assert by_id["not_listed"]["supported_kinds"] == []
    assert by_id["not_listed"]["coverage_captured_on"] is None
    assert second == first
    assert calls["count"] == 1
