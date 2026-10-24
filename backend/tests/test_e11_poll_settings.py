"""E11: SYNC_POLL_HOURS and SYNC_WEBHOOK_SAFETY_NET_HOURS. Defaults keep
today's cadence; fakes and an injected clock, no database."""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.workers.sync_worker as sync_worker
from app.core.subscription import Tier
from app.services import finexer_webhooks as fxw
from app.services import runtime_settings as rs
from tests.test_reconcile_cadence import (
    FakeArq, FakeCol, NOW, _ctx, _make_subscription_lookup, _patch_common, _patch_now,
)

H = timedelta(hours=1)
TIER = timedelta(hours=3, minutes=30)


def _fx(*, synced_h, webhook_h=None, uid="u@example.com", cid="fx-1"):
    d = {"_id": cid, "user_id": uid, "status": "authorized",
         "last_synced": NOW - synced_h * H, "created_at": NOW - timedelta(days=3)}
    if webhook_h is not None:
        d["last_webhook_at"] = NOW - webhook_h * H
    return d


def _run(monkeypatch, docs, settings=None, tier=Tier.STANDARD):
    _patch_common(monkeypatch, finexer=FakeCol(docs))
    _patch_now(monkeypatch)
    monkeypatch.setattr(sync_worker, "get_subscription", _make_subscription_lookup({"u@example.com": tier}))

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr(sync_worker.runtime_settings, "ensure_fresh", _noop)
    monkeypatch.setattr(sync_worker, "bump_daily_counters", _noop)
    monkeypatch.setitem(rs._state, "values", dict(settings or {}))
    arq = FakeArq()
    result = asyncio.run(sync_worker.task_reconcile_truelayer(_ctx(arq)))
    return arq, result


def test_registry_defaults_and_bounds():
    assert rs.REGISTRY["SYNC_POLL_HOURS"].default == 4
    assert rs.REGISTRY["SYNC_WEBHOOK_SAFETY_NET_HOURS"].default == 0
    assert rs.validate("SYNC_POLL_HOURS", 1) == 1 and rs.validate("SYNC_POLL_HOURS", 24) == 24
    assert rs.validate("SYNC_WEBHOOK_SAFETY_NET_HOURS", 0) == 0
    assert rs.validate("SYNC_WEBHOOK_SAFETY_NET_HOURS", 48) == 48
    for key, bad in [("SYNC_POLL_HOURS", 0), ("SYNC_POLL_HOURS", 25),
                     ("SYNC_WEBHOOK_SAFETY_NET_HOURS", -1), ("SYNC_WEBHOOK_SAFETY_NET_HOURS", 49)]:
        with pytest.raises(rs.SettingError):
            rs.validate(key, bad)


def test_defaults_change_nothing_for_the_cron():
    assert fxw.effective_poll_window(TIER, 4) == TIER
    assert fxw.effective_poll_window(timedelta(hours=23, minutes=30), 4) == timedelta(hours=23, minutes=30)
    assert fxw.effective_poll_window(None, 4) is None
    now = NOW
    for fx, expected in [
        ({"last_synced": now - 5 * H}, True),
        ({"last_synced": now - 2 * H}, False),
        ({"last_synced": now - 5 * H, "last_webhook_at": now - H}, False),
        ({"last_synced": now - 24 * H, "last_webhook_at": now - H}, True),
    ]:
        assert fxw.finexer_poll_due(fx, now, TIER, poll_hours=24, stale_hours=24) is expected
        assert fxw.finexer_poll_due(fx, now, TIER, poll_hours=24, stale_hours=24, safety_net_hours=0) is expected


def test_cron_default_syncs_a_consent_five_hours_stale(monkeypatch):
    arq, result = _run(monkeypatch, [_fx(synced_h=5)])
    assert [c[0] for c in arq.calls] == ["task_sync_finexer"]


def test_poll_hours_12_widens_the_window(monkeypatch):
    arq, _ = _run(monkeypatch, [_fx(synced_h=5)], {"SYNC_POLL_HOURS": 12})
    assert arq.calls == []
    arq, _ = _run(monkeypatch, [_fx(synced_h=12)], {"SYNC_POLL_HOURS": 12})
    assert len(arq.calls) == 1


def test_poll_hours_never_polls_a_tier_more_often_than_its_window():
    daily = timedelta(hours=23, minutes=30)
    assert fxw.effective_poll_window(daily, 1) == daily  # 1 hour does not tighten a daily tier
    assert fxw.effective_poll_window(TIER, 1) == TIER


def test_safety_net_polls_only_silent_consents(monkeypatch):
    s = {"SYNC_WEBHOOK_SAFETY_NET_HOURS": 12}
    # Synced 5h ago, stale for the tier, but fresh inside 12h: not polled.
    arq, _ = _run(monkeypatch, [_fx(synced_h=5)], s)
    assert arq.calls == []
    # No webhook and no sync for 13h: polled.
    arq, _ = _run(monkeypatch, [_fx(synced_h=13)], s)
    assert len(arq.calls) == 1
    # Webhook 2h ago (no longer 'healthy' is irrelevant): a recent webhook also holds polling back.
    arq, _ = _run(monkeypatch, [_fx(synced_h=30, webhook_h=2)], {**s, "SYNC_POLL_HOURS": 4})
    assert arq.calls == []
    # Webhook 20h ago, sync 30h ago: silent for 20h, polled.
    arq, _ = _run(monkeypatch, [_fx(synced_h=30, webhook_h=20)], s)
    assert len(arq.calls) == 1


def test_safety_net_bounded_by_four_a_day(monkeypatch):
    """With 12 hours and a 4-hourly cron, a silent consent is polled at most
    twice a day, inside the four-unattended-accesses-a-day figure."""
    s = {"SYNC_WEBHOOK_SAFETY_NET_HOURS": 12}
    synced_h, polls = 13.0, 0
    for tick in range(6):  # six cron ticks across a day, 4 hours apart
        due = fxw.finexer_poll_due({"last_synced": NOW - timedelta(hours=synced_h)}, NOW, TIER, safety_net_hours=12)
        if due:
            polls += 1
            synced_h = 0.0
        synced_h += 4
    assert polls <= 2


def test_never_synced_is_still_always_due_with_safety_net(monkeypatch):
    assert fxw.finexer_poll_due({"last_synced": None}, NOW, TIER, safety_net_hours=12) is True
