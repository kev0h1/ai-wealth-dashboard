"""B43: Mongo returns naive datetimes (Motor is not tz_aware), so every
comparison of a stored `expires_at` against an aware `now` must normalise
first. Covers get_subscription, _pack_covers_month and penny_allowance."""
import asyncio
from datetime import datetime, timedelta, timezone

import app.core.subscription as subscription_module
import app.db.collections as collections_module
from tests.test_penny_topup_packs import UID, _pack, _patch

from app.core.subscription import Tier, get_subscription


class _Col:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, query):
        return self.doc


def _naive(delta):
    return (datetime.now(timezone.utc) + delta).replace(tzinfo=None)


def _sub(monkeypatch, expires_at):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _Col({"tier": "lite", "status": "active", "expires_at": expires_at}),
    )
    return asyncio.run(get_subscription("naive@example.com"))


def test_naive_past_expires_at_is_expired(monkeypatch):
    sub = _sub(monkeypatch, _naive(timedelta(days=-2)))
    assert sub.status == "expired"
    assert sub.tier == Tier.MAX  # default tier, not the stored lite


def test_naive_future_expires_at_is_active(monkeypatch):
    sub = _sub(monkeypatch, _naive(timedelta(days=5)))
    assert sub.tier == Tier.LITE
    assert sub.status == "active"
    assert sub.renews_at.tzinfo is not None


def test_aware_expires_at_still_works(monkeypatch):
    sub = _sub(monkeypatch, datetime.now(timezone.utc) + timedelta(days=5))
    assert sub.tier == Tier.LITE


def test_pack_covers_month_naive_expires_at():
    pack = {"year_month": "2026-01", "expires_at": datetime(2026, 3, 10)}
    assert subscription_module._pack_covers_month(pack, "2026-03") is True
    assert subscription_module._pack_covers_month(pack, "2026-04") is False


def test_penny_allowance_with_naive_pack_expiry(monkeypatch):
    now = datetime.now(timezone.utc)
    live = _pack(UID, pack_id="live", remaining=80, purchased_at=now,
                 expires_at=_naive(timedelta(days=30)))
    dead = _pack(UID, pack_id="dead", remaining=50, purchased_at=now - timedelta(days=100),
                 expires_at=_naive(timedelta(days=-10)))
    _patch(monkeypatch, used_this_month=0, packs=[live, dead])
    allowance = asyncio.run(subscription_module.penny_allowance(UID))
    assert allowance["topup_messages"] == 80
    assert allowance["topup_expires_soonest"] is not None


def test_mcp_allowance_with_naive_pack_expiry(monkeypatch):
    class _Sub:
        tier_name = "max"

        def limit(self, key):
            return 100

    now = datetime.now(timezone.utc)
    live = {"remaining": 40, "year_month": now.strftime("%Y-%m"),
            "expires_at": _naive(timedelta(days=30))}
    dead = {"remaining": 25, "year_month": "2025-01",
            "expires_at": _naive(timedelta(days=-10))}

    async def fake_sub(email):
        return _Sub()

    async def fake_settle(email, now, *, persist=True):
        return [live, dead]

    async def fake_count(email, ym):
        return 0

    monkeypatch.setattr(subscription_module, "get_subscription", fake_sub)
    monkeypatch.setattr(subscription_module, "settle_mcp_packs", fake_settle)
    monkeypatch.setattr(subscription_module, "_mcp_call_count", fake_count)
    allowance = asyncio.run(subscription_module.mcp_allowance(UID))
    assert allowance["pack_calls"] == 40
    assert allowance["limit"] == 140
    assert allowance["pack_expires_soonest"] is not None
