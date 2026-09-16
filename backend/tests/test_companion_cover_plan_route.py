"""The Settings cover-plan route must be an exact, read-only engine view.

Also covers G110 (2026-09-16): plain `GET /today` (the one Home already
fetches every load) now returns the SAME `account_eligibility` snapshot
`/today/cover-plan` exposes to Settings, so Home's "spend from" line
(lib/spendFromAccount.ts) needs no second request and no new backend
computation — just one more key on a response already being built.
"""

import asyncio
import inspect

import app.routers.companion as companion_router
import app.services.response_cache as response_cache
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


# ── GET /today: same account_eligibility snapshot, no extra computation ────

class _CacheSpy:
    """No-op stand-in for app.services.response_cache — GET /today's own
    caching behaviour is not what these tests are about, so this just
    records calls and always reports a cold cache (aget -> None), matching
    _CacheSpy's role in test_cover_plan_exclusions_persist.py et al."""

    def __init__(self):
        self.aget_calls = []
        self.aput_calls = []

    async def aget(self, name, uid):
        self.aget_calls.append((name, uid))
        return None

    async def snapshot(self, uid):
        return 7

    async def aput(self, name, uid, payload, *, version):
        self.aput_calls.append((name, uid, payload, version))


def test_today_route_now_returns_the_same_account_eligibility_snapshot(monkeypatch):
    """G110: Home's 'spend from' line reads this off plain GET /today —
    the same {account_id: {short, headroom}} shape /today/cover-plan
    already returns, straight from compute_today_items's own out-param."""
    calls = []

    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        calls.append({"uid": uid, "payday_preview": payday_preview, "persist": persist})
        if account_eligibility_out is not None:
            account_eligibility_out["acc-1"] = {"short": True, "headroom": -2.5}
            account_eligibility_out["acc-2"] = {"short": False, "headroom": 40.0}
        return [{"id": "move-1", "type": "move", "headline": "Move £20"}]

    monkeypatch.setattr(companion_router, "compute_today_items", compute)
    spy = _CacheSpy()
    monkeypatch.setattr(companion_router, "response_cache", spy)

    result = asyncio.run(companion_router.get_today(payday_preview=0, user={"email": "kevin"}))

    # persist stays at its default (True) — G110 only adds the out-param,
    # it must not touch the existing persist/caching contract.
    assert calls == [{"uid": "kevin", "payday_preview": False, "persist": True}]
    assert result == {
        "status": "ok",
        "items": [{"id": "move-1", "type": "move", "headline": "Move £20"}],
        "account_eligibility": {
            "acc-1": {"short": True, "headroom": -2.5},
            "acc-2": {"short": False, "headroom": 40.0},
        },
    }
    # The enriched payload is what actually gets cached, not a stripped copy.
    assert spy.aput_calls == [("today", "kevin", result, 7)]


def test_today_route_payday_preview_still_skips_the_response_cache(monkeypatch):
    """Preview requests are a one-off design/QA look, never read from or
    written to the cache — G110 must not change that, only add a key to
    the payload both branches already build."""
    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        if account_eligibility_out is not None:
            account_eligibility_out["acc-1"] = {"short": False, "headroom": 12.0}
        return []

    monkeypatch.setattr(companion_router, "compute_today_items", compute)
    spy = _CacheSpy()
    monkeypatch.setattr(companion_router, "response_cache", spy)

    result = asyncio.run(companion_router.get_today(payday_preview=1, user={"email": "kevin"}))

    assert spy.aget_calls == []
    assert spy.aput_calls == []
    assert result == {
        "status": "ok",
        "items": [],
        "account_eligibility": {"acc-1": {"short": False, "headroom": 12.0}},
    }


def test_today_route_returns_cached_payload_unchanged_when_warm(monkeypatch):
    """A warm cache entry (already carrying account_eligibility from a
    prior call, or an old entry from before G110 that simply lacks the
    key) is returned as-is -- GET /today must not recompute just to backfill
    a field on a cache hit."""
    async def compute(*args, **kwargs):
        raise AssertionError("must not recompute on a warm cache hit")

    monkeypatch.setattr(companion_router, "compute_today_items", compute)
    spy = _CacheSpy()
    cached_payload = {"status": "ok", "items": [{"id": "old"}]}

    async def warm_aget(name, uid):
        return cached_payload

    spy.aget = warm_aget
    monkeypatch.setattr(companion_router, "response_cache", spy)

    result = asyncio.run(companion_router.get_today(payday_preview=0, user={"email": "kevin"}))

    assert result is cached_payload
