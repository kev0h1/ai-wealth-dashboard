"""The Settings cover-plan route must be an exact, read-only engine view."""

import asyncio
import inspect

import app.routers.companion as companion_router
from app.core.auth import current_user


def test_cover_plan_route_requires_authentication():
    """`GET /today/cover-plan` must stay behind the same session dependency
    as every other companion route -- this pins the FastAPI wiring itself
    (not just that the handler happens to take a `user` dict), following
    the convention `test_money_shape.py` established for asserting router
    signatures without spinning up TestClient/a real DB."""
    sig = inspect.signature(companion_router.get_cover_plan)
    user_param = sig.parameters["user"]
    assert user_param.default.dependency is current_user


def test_cover_plan_route_uses_read_only_engine_mode_and_filters_items(monkeypatch):
    calls = []

    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        calls.append({
            "uid": uid,
            "payday_preview": payday_preview,
            "persist": persist,
        })
        if account_eligibility_out is not None:
            account_eligibility_out["acc-1"] = {"short": True, "headroom": -2.5}
            account_eligibility_out["acc-2"] = {"short": False, "headroom": 40.0}
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
        "account_eligibility": {
            "acc-1": {"short": True, "headroom": -2.5},
            "acc-2": {"short": False, "headroom": 40.0},
        },
    }


def test_cover_plan_route_never_persists_even_when_engine_would(monkeypatch):
    """Read-only guarantee audited at G46 merge: this route must ALWAYS call
    the engine with persist=False, no matter what the caller passes (there
    is no way to pass anything else — `get_cover_plan` takes no body — but
    this pins the contract so a future edit can't accidentally thread a
    persist=True path through)."""
    calls = []

    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        calls.append(persist)
        assert persist is False, "cover-plan route must never persist"
        if account_eligibility_out is not None:
            pass  # engine fills this in memory only; nothing written here
        return []

    monkeypatch.setattr(companion_router, "compute_today_items", compute)

    asyncio.run(companion_router.get_cover_plan({"email": "kevin"}))

    assert calls == [False]
