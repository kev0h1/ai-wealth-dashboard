"""H146: the worker's money shape refresh must not log a traceback when the
user's data version moves mid-refresh (several consents syncing for one user
each bump it). No DB: data_version, the compute and the cache collection are
monkeypatched."""
import asyncio
import logging

import app.services.data_version as data_version
import app.services.derived_caches as derived_caches
import app.services.money_shape as money_shape
import app.services.response_cache as response_cache

UID = "h146-user@example.com"


class _Col:
    def __init__(self):
        self.writes = []

    async def update_one(self, filt, update, upsert=False):
        self.writes.append(update["$set"])


def _install(monkeypatch, bump_on_computes):
    """Version counter that moves during the computes listed (1-based)."""
    state = {"version": 1, "computes": 0}
    col = _Col()

    async def current(uid, fresh=False):
        return state["version"]

    async def compute(uid):
        state["computes"] += 1
        if state["computes"] in bump_on_computes:
            state["version"] += 1
        return {"x": 1}

    async def no_sleep(_):
        return None

    monkeypatch.setattr(data_version, "current", current)
    monkeypatch.setattr(money_shape, "compute_money_shape", compute)
    monkeypatch.setattr(money_shape, "money_shape_cache_col", col)
    monkeypatch.setattr(money_shape.asyncio, "sleep", no_sleep)
    return state, col


def test_background_succeeds_on_second_attempt(monkeypatch):
    state, col = _install(monkeypatch, {1})
    out = asyncio.run(money_shape.compute_and_cache_money_shape(UID, background=True))
    assert out is not None and out["data_version"] == 2
    assert state["computes"] == 2
    assert len(col.writes) == 1


def test_background_skips_quietly_after_three_attempts(monkeypatch, caplog):
    state, col = _install(monkeypatch, {1, 2, 3})
    with caplog.at_level(logging.INFO, logger=money_shape.logger.name):
        out = asyncio.run(money_shape.compute_and_cache_money_shape(UID, background=True))
    assert out is None
    assert state["computes"] == 3
    assert col.writes == []
    skips = [r for r in caplog.records if "money shape refresh skipped" in r.getMessage()]
    assert len(skips) == 1 and skips[0].levelno == logging.INFO
    assert "next read rebuilds it" in skips[0].getMessage()


def test_request_path_still_raises_after_two_attempts(monkeypatch):
    import pytest
    state, _ = _install(monkeypatch, {1, 2, 3})
    with pytest.raises(RuntimeError):
        asyncio.run(money_shape.compute_and_cache_money_shape(UID))
    assert state["computes"] == 2


def test_recompute_derived_caches_does_not_log_exception(monkeypatch, caplog):
    state, _ = _install(monkeypatch, {1, 2, 3})
    import app.routers.analytics as analytics

    async def needs(uid, **kw):
        return True, "dirty"

    async def cashflow(uid, *a, **kw):
        return True

    monkeypatch.setattr(derived_caches, "cache_needs_recompute", needs)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", cashflow)
    with caplog.at_level(logging.INFO):
        res = asyncio.run(derived_caches.recompute_derived_caches(UID, new_count=1, trigger="auto"))
    assert res == {"recomputed": True, "reason": "dirty"}
    assert not [r for r in caplog.records if r.exc_info]
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_cashflow_bump_is_awaited(monkeypatch):
    import app.routers.analytics as analytics
    import app.services.cashflow as cashflow_mod

    state = {"version": 1}

    async def bump(uid):
        await asyncio.sleep(0)
        state["version"] += 1
        return state["version"]

    async def current(uid, fresh=False):
        return state["version"]

    def bump_soon(uid):
        raise AssertionError("fire-and-forget bump must not be used here")

    class Col:
        async def update_one(self, *a, **kw):
            return None

    async def patterns(uid):
        return {}

    async def monthly(uid, since):
        return {}

    async def clear(uid, started_at):
        return None

    monkeypatch.setattr(data_version, "bump", bump)
    monkeypatch.setattr(data_version, "current", current)
    monkeypatch.setattr(data_version, "bump_soon", bump_soon)
    monkeypatch.setattr(analytics, "cashflow_cache_col", Col())
    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns)
    monkeypatch.setattr(cashflow_mod, "monthly_cashflow", monthly)
    monkeypatch.setattr(derived_caches, "clear_dirty", clear)

    async def run():
        ok = await analytics.compute_and_cache_cashflow(UID)
        return ok, await data_version.current(UID, fresh=True)

    ok, version = asyncio.run(run())
    assert ok is True
    assert version == 2
