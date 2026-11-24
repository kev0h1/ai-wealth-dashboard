"""Stored-data readiness, honest copy and atomic per-period Home delivery."""
import asyncio
import copy
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core import timeutil
from app.routers import companion as today_router
from app.routers import spend_verdict as spend_router
from app.services import notifications, overspending, overspending_moments as moments
from app.services.pay_period import get_pay_period_for_date, prev_pay_period
from tests.test_notifications import FakeStateCol

UID = "g494-fictional@example.test"
USER = {"email": UID}


class ReadCollection:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, query, *args, **kwargs):
        return copy.deepcopy(self.doc)


def snapshot():
    now = datetime.now(timezone.utc)
    start, end = get_pay_period_for_date(timeutil.user_today(), {"type": "calendar_month"})
    previous_start, previous_end = prev_pay_period(start, {"type": "calendar_month"})
    return {
        "_id": UID, "data_version": 7, "schema_version": overspending.SCHEMA_VERSION,
        "computed_at": now,
        "period": {"start": start.isoformat(), "end": end.isoformat(), "days_elapsed": max(1, (timeutil.user_today() - start).days), "length_days": (end - start).days + 1},
        "out": 500, "in": 1000, "gap": 0, "crossed": False,
        "funded_by": {"savings": 0, "cards": 0, "current_account": 0},
        "on_course": {"available": True, "on_course_to_cross": True, "predicted_income": 0,
                      "projected_out": 1500, "projected_in": 1000, "projected_gap": 500, "drivers": []},
        "acknowledged": False,
        "trend": {"periods": [{"start": previous_start.isoformat(), "end": previous_end.isoformat(),
                               "out": 7390, "in": 5940, "gap": 1450,
                               "funded_by": {"savings": 550, "cards": 900, "current_account": 0}}]},
    }


@pytest.fixture
def stored(monkeypatch):
    cache, ack, prefs = ReadCollection(snapshot()), ReadCollection(), ReadCollection()
    state = FakeStateCol({})
    monkeypatch.setattr(overspending, "overspending_cache_col", cache)
    monkeypatch.setattr(overspending, "overspending_ack_col", ack)
    monkeypatch.setattr(moments, "preferences_col", prefs)
    monkeypatch.setattr(overspending, "preferences_col", prefs)
    monkeypatch.setattr(moments, "notification_state_col", state)
    monkeypatch.setattr(notifications, "notification_state_col", state)

    async def version(uid, **kwargs):
        return 7

    async def ready(uid):
        return {"first_sync": False, "state": "ready"}

    async def no_compute(*args, **kwargs):
        raise AssertionError("A read or display must never calculate financial data")

    monkeypatch.setattr(moments.data_version, "current_strict", version)
    monkeypatch.setattr(moments, "first_sync_state", ready)
    monkeypatch.setattr(overspending, "compute_overspending", no_compute)
    monkeypatch.setattr(overspending, "compute_and_cache_overspending", no_compute)
    return cache, ack, state, prefs


def read():
    return asyncio.run(moments.read_overspending_moment(UID))


def test_ready_read_is_a_copy_and_never_computes_or_writes(stored):
    cache, _, state, _ = stored
    before = copy.deepcopy(cache.doc)
    doc = read()
    assert doc["display_ready"] is True and doc["current_period"] is True
    assert doc["heads_up_seen"] is False and doc["acknowledged"] is False
    assert "_id" not in doc and "data_version" not in doc
    assert moments.early_heads_up_eligible(doc)
    assert cache.doc == before and state.docs == {}


@pytest.mark.parametrize("change", [
    {"computed_at": None},
    {"computed_at": "invalid"},
    {"computed_at": datetime.now(timezone.utc) - timedelta(days=2)},
    {"computed_at": datetime.now(timezone.utc) + timedelta(minutes=10)},
    {"data_version": 6},
    {"gap": 1},
    {"out": float("nan")},
    {"in": float("inf")},
    {"crossed": True},
    {"funded_by": {"cards": -1, "savings": 1, "current_account": 0}},
])
def test_stale_or_inconsistent_readings_are_not_presentable(stored, change):
    stored[0].doc.update(change)
    doc = read()
    assert doc is None or doc["display_ready"] is False
    assert not moments.early_heads_up_eligible(doc)


def test_old_period_is_unavailable_even_with_today_stamp(stored):
    stored[0].doc["period"]["end"] = "2020-01-31"
    doc = read()
    assert doc["current_period"] is False and doc["display_ready"] is False


@pytest.mark.parametrize("state", ["syncing", "stalled", "failed"])
def test_first_sync_partial_figures_are_unavailable(stored, monkeypatch, state):
    async def syncing(uid):
        return {"first_sync": True, "state": state}
    monkeypatch.setattr(moments, "first_sync_state", syncing)
    assert read()["display_ready"] is False


def test_unverified_version_never_makes_financial_snapshot_available(stored, monkeypatch):
    async def unavailable(uid):
        return None
    monkeypatch.setattr(moments.data_version, "current_strict", unavailable)
    assert read()["display_ready"] is False


def test_strict_version_distinguishes_absent_counter_from_store_failure(monkeypatch):
    from app.services import data_version
    counter = ReadCollection()
    monkeypatch.setattr(data_version, "user_data_version_col", counter)
    assert asyncio.run(data_version.current_strict(UID)) == 0
    counter.doc = {"version": 7}
    assert asyncio.run(data_version.current_strict(UID)) == 7
    for bad in (None, True, "7", -1):
        counter.doc = {"version": bad}
        assert asyncio.run(data_version.current_strict(UID)) is None
    class Broken(ReadCollection):
        async def find_one(self, *args, **kwargs):
            raise RuntimeError("version store unavailable")
    monkeypatch.setattr(data_version, "user_data_version_col", Broken())
    monkeypatch.setitem(data_version._memo, UID, (0, 7))
    assert asyncio.run(data_version.current_strict(UID)) is None


def test_live_acknowledgement_wins_over_stale_cache(stored):
    stored[0].doc["data_version"] = 6
    stored[1].doc = {"answer": "one_off"}
    doc = read()
    assert doc["acknowledged"] is True and doc["display_ready"] is False
    assert not moments.early_heads_up_eligible(doc)


def test_deleted_acknowledgement_wins_over_cached_answer(stored):
    stored[0].doc["acknowledged"] = True
    assert read()["acknowledged"] is False


def test_authoritative_answer_survives_absent_financial_cache(stored):
    stored[0].doc = None
    stored[1].doc = {"answer": "one_off"}
    assert read() is None
    assert asyncio.run(moments.current_period_acknowledged(UID)) is True
    stored[1].doc = None
    assert asyncio.run(moments.current_period_acknowledged(UID)) is False


def test_readiness_uses_london_calendar_day_across_bst(stored, monkeypatch):
    monkeypatch.setattr(timeutil, "user_today", lambda: date(2026, 6, 24))
    stored[0].doc["period"].update(start="2026-06-01", end="2026-06-30", days_elapsed=23, length_days=30)
    # 23:30 UTC on the previous UTC day is already today's UK calendar day.
    stored[0].doc["computed_at"] = datetime(2026, 6, 23, 23, 30, tzinfo=timezone.utc)
    assert read()["display_ready"] is True
    stored[0].doc["computed_at"] = datetime(2026, 6, 24, 23, 30, tzinfo=timezone.utc)
    assert read()["display_ready"] is False


def test_computation_spanning_midnight_cannot_reuse_previous_day_pace(stored):
    stored[0].doc["period"]["days_elapsed"] += 1
    assert read()["display_ready"] is False


@pytest.mark.parametrize("change", [
    {"predicted_income": None}, {"projected_gap": None}, {"available": False},
    {"projected_gap": 0}, {"on_course_to_cross": False}, {"projected_out": 1000},
])
def test_unknown_income_or_unreconciled_forecast_is_not_a_heads_up(stored, change):
    stored[0].doc["on_course"].update(change)
    assert not moments.early_heads_up_eligible(read())


def test_home_claim_is_atomic_and_persistent_without_answering_one_off(stored):
    pe = stored[0].doc["period"]["end"]
    async def together():
        return await asyncio.gather(*(moments.claim_home_heads_up(UID, pe) for _ in range(4)))
    assert sorted(asyncio.run(together())) == [False, False, False, True]
    assert read()["heads_up_seen"] is True
    assert read()["acknowledged"] is False and stored[1].doc is None
    assert asyncio.run(moments.claim_home_heads_up(UID, pe)) is False
    # Replacing the financial cache cannot make the same Home moment reappear.
    stored[0].doc = snapshot()
    assert asyncio.run(moments.claim_home_heads_up(UID, pe)) is False


def test_claim_rejects_another_period_or_user_acknowledgement(stored):
    assert asyncio.run(moments.claim_home_heads_up(UID, "2020-01-31")) is False
    stored[1].doc = {"answer": "one_off"}
    assert asyncio.run(moments.claim_home_heads_up(UID, stored[0].doc["period"]["end"])) is False
    assert stored[2].docs == {}


def test_home_and_push_delivery_claims_are_independent(stored):
    pe = stored[0].doc["period"]["end"]
    assert asyncio.run(notifications.claim_push(UID, f"overspend:{pe}"))
    assert asyncio.run(moments.claim_home_heads_up(UID, pe))


def test_endpoint_requires_valid_explicit_period_and_uses_authenticated_user(stored):
    for body in ({}, {"period_end": "31/10/2026"}):
        with pytest.raises(HTTPException) as error:
            asyncio.run(spend_router.post_overspend_heads_up(body, USER))
        assert error.value.status_code == 400
    pe = stored[0].doc["period"]["end"]
    out = asyncio.run(spend_router.post_overspend_heads_up({"period_end": pe, "user_id": "someone-else"}, USER))
    assert out == {"shown": True, "period_end": pe}
    assert set(stored[2].docs) == {UID}


def test_closed_needle_uses_exact_completed_period_and_does_not_mutate_payload(stored):
    pe = stored[0].doc["trend"]["periods"][0]["end"]
    payload = {"items": [{"id": f"needle:{pe}", "type": "needle", "headline": "Your month closed.", "body": ""}]}
    out = asyncio.run(today_router._with_overspending(payload, UID))
    assert out["items"][0]["body"] == "Out passed in by £1,450. About £900 went onto cards."
    assert payload["items"][0]["body"] == ""
    assert moments.closed_period_observation(out["overspending"], "2020-01-31") is None
    stored[0].doc["data_version"] = 6
    assert asyncio.run(today_router._with_overspending(payload, UID))["items"][0]["body"] == ""


def test_unreconciled_closed_history_never_generates_a_claim(stored):
    stored[0].doc["trend"]["periods"][0]["funded_by"]["cards"] = 1000
    doc = read()
    pe = doc["trend"]["periods"][0]["end"]
    assert moments.closed_period_observation(doc, pe) is None
