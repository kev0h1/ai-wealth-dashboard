"""E17: GET /today/cover-plan is cached under `cover_plan` with the same
version-pinned aget/aput contract as GET /today."""
import asyncio

import app.routers.companion as companion_router
import app.services.data_version as data_version
import app.services.response_cache as response_cache
import app.services.warmup as warmup
from tests.test_response_cache_v2 import UID, _patch_cols, _patch_day

USER = {"email": UID}


def _stub_compute(monkeypatch):
    calls = []

    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        calls.append({"uid": uid, "persist": persist})
        if account_eligibility_out is not None:
            account_eligibility_out["acc-1"] = {"short": False, "headroom": 10.0}
        return [{"id": "m1", "type": "move"}, {"id": "a1", "type": "ask"}]

    monkeypatch.setattr(companion_router, "compute_today_items", compute)
    return calls


def test_second_call_within_version_hits_cache(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    calls = _stub_compute(monkeypatch)

    async def go():
        first = await companion_router.get_cover_plan(USER)
        second = await companion_router.get_cover_plan(USER)
        assert first == second
        assert first["items"] == [{"id": "m1", "type": "move"}]

    asyncio.run(go())
    assert calls == [{"uid": UID, "persist": False}]


def test_dismiss_and_version_bump_clear_it(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    calls = _stub_compute(monkeypatch)

    async def noop(uid, item_id):
        return None

    monkeypatch.setattr(companion_router, "dismiss_item", noop)

    async def go():
        await companion_router.get_cover_plan(USER)
        await data_version.bump(UID)
        assert await response_cache.aget("cover_plan", UID) is None
        await companion_router.get_cover_plan(USER)
        assert len(calls) == 2
        await companion_router.dismiss_today_item({"item_id": "x"}, USER)
        await asyncio.sleep(0.05)  # bump_soon is fire-and-forget
        assert await response_cache.aget("cover_plan", UID) is None
        await companion_router.get_cover_plan(USER)
        assert len(calls) == 3

    asyncio.run(go())


def test_warm_user_populates_cover_plan(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    calls = _stub_compute(monkeypatch)

    async def ok(uid):
        return {"status": "ok"}

    for n in ("_compute_today", "_compute_safe_to_spend", "_compute_spend_verdict",
              "_compute_miscategorised_count", "_compute_miscategorised_list",
              "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, ok)

    async def go():
        result = await warmup.warm_user(UID)
        assert "cover_plan" in result["warmed"]
        assert await response_cache.aget("cover_plan", UID) is not None
        before = len(calls)
        await companion_router.get_cover_plan(USER)
        assert len(calls) == before  # warm hit, no recompute

    asyncio.run(go())


def _stub_other_steps(monkeypatch):
    async def ok(uid):
        return {"status": "ok"}

    for n in ("_compute_today", "_compute_safe_to_spend", "_compute_spend_verdict",
              "_compute_miscategorised_count", "_compute_miscategorised_list",
              "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, ok)


def test_warm_without_cover_plan_does_not_compute_it_but_worker_warm_does(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    calls = _stub_compute(monkeypatch)
    _stub_other_steps(monkeypatch)

    async def go():
        result = await warmup.warm_user(UID, include_cover_plan=False)
        assert "cover_plan" not in result["warmed"]
        assert calls == []
        result = await warmup.warm_user(UID)
        assert "cover_plan" in result["warmed"]
        assert len(calls) == 1

    asyncio.run(go())


def test_worker_warm_does_not_join_an_inflight_warm_without_cover_plan(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)
    calls = _stub_compute(monkeypatch)
    _stub_other_steps(monkeypatch)
    gate = asyncio.Event()

    async def slow_today(uid):
        await gate.wait()
        return {"status": "ok"}

    monkeypatch.setattr(warmup, "_compute_today", slow_today)

    async def go():
        first = asyncio.ensure_future(warmup.warm_user(UID, include_cover_plan=False))
        await asyncio.sleep(0.01)
        second = asyncio.ensure_future(warmup.warm_user(UID))
        await asyncio.sleep(0.01)
        gate.set()
        r1, r2 = await asyncio.gather(first, second)
        assert "cover_plan" not in r1["warmed"]
        assert "cover_plan" in r2["warmed"]
        assert len(calls) == 1

    asyncio.run(go())


def test_version_bump_during_compute_is_not_cached_under_new_version(monkeypatch):
    _patch_cols(monkeypatch)
    _patch_day(monkeypatch)

    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        await data_version.bump(uid)  # a write lands mid-compute
        return [{"id": "m1", "type": "move"}]

    monkeypatch.setattr(companion_router, "compute_today_items", compute)

    async def go():
        out = await companion_router.get_cover_plan(USER)
        assert out["items"]  # the caller still gets the result
        assert await response_cache.aget("cover_plan", UID) is None

    asyncio.run(go())
