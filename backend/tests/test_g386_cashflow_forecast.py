"""G386: GET /cashflow?include=forecast carries the Safe to Spend verdict.

Upcoming's hero used to fetch the verdict in a second request, so the status
chip and colour painted a round trip after the figure. The verdict now rides in
the cashflow response, from the SAME cached read-through GET /safe-to-spend uses.
"""
import asyncio

import app.routers.analytics as analytics
import app.services.pace as pace_service
from app.services import response_cache
from tests.test_cashflow_live_balance_overlay import UID, _fixture


def _in_memory_cache(monkeypatch):
    store = {}

    async def aget(name, uid):
        return store.get((name, uid))

    async def aput(name, uid, payload, version=None):
        store[(name, uid)] = payload

    async def adrop(name, uid):
        store.pop((name, uid), None)

    async def snapshot(uid):
        return 1

    monkeypatch.setattr(response_cache, "aget", aget)
    monkeypatch.setattr(response_cache, "aput", aput)
    monkeypatch.setattr(response_cache, "adrop", adrop)
    monkeypatch.setattr(response_cache, "snapshot", snapshot)

    async def fake_pace(uid, include_series=False, sts=None):
        return {"spent": 1}

    monkeypatch.setattr(pace_service, "compute_pace", fake_pace)
    return store


def _count_computes(monkeypatch):
    calls = {"n": 0}
    real = analytics.compute_safe_to_spend

    async def counted(uid):
        calls["n"] += 1
        return await real(uid)

    monkeypatch.setattr(analytics, "compute_safe_to_spend", counted)
    return calls


def test_forecast_is_absent_unless_requested(monkeypatch):
    _fixture(monkeypatch)
    _in_memory_cache(monkeypatch)
    calls = _count_computes(monkeypatch)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}))
    assert "forecast" not in resp
    assert calls["n"] == 0  # other /cashflow callers pay nothing


def test_forecast_matches_safe_to_spend_and_drops_pace(monkeypatch):
    _fixture(monkeypatch)
    _in_memory_cache(monkeypatch)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}, include="forecast"))
    direct = asyncio.run(analytics.compute_safe_to_spend(UID))
    fc = resp["forecast"]
    assert "pace" not in fc
    for key in ("state", "safe_to_spend", "safe_to_spend_cash", "calculation_status", "short_reason",
                "lowest_projected_balance", "next_payday", "buffer", "allocations_reserved",
                "commitments_reserved", "bills_total", "income_before_payday", "spendable_now",
                "pooled_transfers_excluded", "unavailable_components"):
        assert fc[key] == direct[key], key
    # The Upcoming hero's own inputs are untouched by the extra key.
    assert resp["spendable_balance"] == 1747.51
    assert resp["plans_available"] is True


def test_cache_respected_one_pooled_computation_per_warm_request(monkeypatch):
    _fixture(monkeypatch)
    store = _in_memory_cache(monkeypatch)
    calls = _count_computes(monkeypatch)
    first = asyncio.run(analytics.get_cashflow({"email": UID}, include="forecast"))
    assert calls["n"] == 1
    assert ("safe_to_spend", UID) in store  # filled for Home / GET /safe-to-spend too
    second = asyncio.run(analytics.get_cashflow({"email": UID}, include="forecast"))
    assert calls["n"] == 1  # warm: no extra pooled computation
    assert second["forecast"] == first["forecast"]
    # And GET /safe-to-spend reads the entry the cashflow request filled.
    asyncio.run(analytics.get_safe_to_spend("", {"email": UID}))
    assert calls["n"] == 1


def test_forecast_failure_omits_the_key_so_the_client_falls_back(monkeypatch):
    _fixture(monkeypatch)
    _in_memory_cache(monkeypatch)

    async def boom(uid):
        raise RuntimeError("walk failed")

    monkeypatch.setattr(analytics, "compute_safe_to_spend", boom)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}, include="forecast"))
    assert "forecast" not in resp
    assert resp["spendable_balance"] == 1747.51
