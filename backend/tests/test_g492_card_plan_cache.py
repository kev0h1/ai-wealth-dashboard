"""G492: cached commitments must retain the stored finish-estimate contract."""
import asyncio
from datetime import date

import pytest

import app.routers.commitments as commitments


UID = "g492-cache@example.com"
TODAY = date(2026, 11, 25)


def _finish_ready():
    return {"status": "ready", "month": "2027-02", "label": "Feb 2027", "basis": "before_offer_end"}


def _card(*, as_of=TODAY.isoformat(), finish=None):
    return {"id": "card-plan", "plan_kind": "card_repayment", "status": "active", "target_date": None,
            "card_plan": {"status": "ready", "as_of": as_of, "finish_estimate": _finish_ready() if finish is None else finish}}


class _Cursor:
    async def to_list(self, _limit):
        return []


class _Commitments:
    def find(self, *_args, **_kwargs):
        return _Cursor()


def _run(coro):
    return asyncio.run(coro)


@pytest.mark.parametrize("cached", [
    {"items": [{"id": "card-plan", "plan_kind": "card_repayment", "status": "active", "target_date": None,
                "card_plan": {"status": "ready", "as_of": TODAY.isoformat()}}]},
    {"items": [_card(as_of="2026-11-24")]},
    {"items": [_card(finish={"status": "ready", "month": "2027-02", "label": "Feb 2027"})]},
    {"items": [_card(finish={"status": "unavailable", "reason": []})]},
    {"items": [_card(finish={"status": "unavailable", "reason": {}})]},
])
def test_list_rebuilds_pre_shape_day_stale_or_malformed_card_cache(monkeypatch, cached):
    writes = []

    async def aget(*_args): return cached
    async def snapshot(*_args): return 3
    async def aput(*args, **kwargs): writes.append((args, kwargs))
    async def pay_cfg(*_args): return {"type": "calendar_month"}
    async def feasibility(*_args): return None
    async def serialise(*_args, **_kwargs): return []
    async def migrate(*_args): return None

    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(commitments.response_cache, "aget", aget)
    monkeypatch.setattr(commitments.response_cache, "snapshot", snapshot)
    monkeypatch.setattr(commitments.response_cache, "aput", aput)
    monkeypatch.setattr(commitments, "commitments_col", _Commitments())
    monkeypatch.setattr(commitments, "_pay_cfg", pay_cfg)
    monkeypatch.setattr(commitments, "_feasibility_ctx", feasibility)
    monkeypatch.setattr(commitments, "_serialise_all", serialise)
    monkeypatch.setattr(commitments, "_migrate_legacy", migrate)
    assert _run(commitments.list_commitments({"email": UID})) == {"items": []}
    assert writes and writes[0][0][:3] == ("commitments", UID, {"items": []})


def test_list_reuses_current_valid_card_cache_without_serialising(monkeypatch):
    cached = {"items": [_card()]}

    async def aget(*_args): return cached
    async def forbidden(*_args, **_kwargs): raise AssertionError("cached response must not serialise or calculate")

    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(commitments.response_cache, "aget", aget)
    monkeypatch.setattr(commitments, "_serialise_all", forbidden)
    assert _run(commitments.list_commitments({"email": UID})) == cached


def test_list_reuses_no_card_cache_without_finish_metadata(monkeypatch):
    cached = {"items": [{"id": "goal", "plan_kind": "goal", "status": "active"}]}

    async def aget(*_args): return cached
    async def forbidden(*_args, **_kwargs): raise AssertionError("no-card cache must remain reusable")

    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(commitments.response_cache, "aget", aget)
    monkeypatch.setattr(commitments, "_serialise_all", forbidden)
    assert _run(commitments.list_commitments({"email": UID})) == cached
