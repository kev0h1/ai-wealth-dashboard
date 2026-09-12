"""The Settings cover-plan route must be an exact, read-only engine view."""

import asyncio

import app.routers.companion as companion_router


def test_cover_plan_route_uses_read_only_engine_mode_and_filters_items(monkeypatch):
    calls = []

    async def compute(uid, payday_preview=False, persist=True):
        calls.append({
            "uid": uid,
            "payday_preview": payday_preview,
            "persist": persist,
        })
        return [
            {"id": "move-1", "type": "move", "headline": "Move £20"},
            {"id": "ask-1", "type": "ask", "headline": "Confirm payday"},
        ]

    monkeypatch.setattr(companion_router, "compute_today_items", compute)

    result = asyncio.run(companion_router.get_cover_plan({"email": "kevin"}))

    assert calls == [{
        "uid": "kevin",
        "payday_preview": False,
        "persist": False,
    }]
    assert result == {
        "status": "ok",
        "items": [{"id": "move-1", "type": "move", "headline": "Move £20"}],
    }
