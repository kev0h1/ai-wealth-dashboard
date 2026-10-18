"""Tests for the new Statements/Lite/Standard/Connect/Max tier model
(app.core.subscription) — replaces the old free/pro/premium/family tiers.

Default tier (no doc, expired doc, or unrecognised stored name) is
configurable via DEFAULT_TIER and defaults to "plus" so nobody is
restricted before launch. Legacy stored tier names still map somewhere
sensible for anyone who already has a subscription doc."""
import asyncio

import pytest
from fastapi import HTTPException

import app.db.collections as collections_module
from app.core.subscription import Tier, check_connection_limit, get_subscription


class _FakeFindOneCollection:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, query):
        return self.doc


class _FakeCountCollection:
    def __init__(self, count=0):
        self.count = count

    async def count_documents(self, query):
        return self.count


def test_default_tier_is_plus_when_no_subscription_doc(monkeypatch):
    monkeypatch.setattr(collections_module, "subscriptions_col", _FakeFindOneCollection(None))
    sub = asyncio.run(get_subscription("nobody@example.com"))
    assert sub.tier == Tier.PLUS
    assert sub.tier_name == "plus"


def test_default_tier_is_plus_when_doc_expired(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "lite", "status": "expired"}),
    )
    sub = asyncio.run(get_subscription("expired@example.com"))
    assert sub.tier == Tier.PLUS


def test_legacy_pro_maps_to_standard(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "pro", "status": "active"}),
    )
    sub = asyncio.run(get_subscription("legacy-pro@example.com"))
    assert sub.tier == Tier.STANDARD


def test_legacy_premium_and_family_map_to_plus(monkeypatch):
    for legacy_name in ("premium", "family"):
        monkeypatch.setattr(
            collections_module, "subscriptions_col",
            _FakeFindOneCollection({"tier": legacy_name, "status": "active"}),
        )
        sub = asyncio.run(get_subscription(f"legacy-{legacy_name}@example.com"))
        assert sub.tier == Tier.PLUS


def test_legacy_free_maps_to_default_tier(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "free", "status": "active"}),
    )
    sub = asyncio.run(get_subscription("legacy-free@example.com"))
    assert sub.tier == Tier.PLUS


def test_unknown_tier_name_maps_to_default_tier(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "gold", "status": "active"}),
    )
    sub = asyncio.run(get_subscription("weird-tier@example.com"))
    assert sub.tier == Tier.PLUS


def test_new_tier_names_pass_through_unchanged(monkeypatch):
    for name, expected in (
        ("statements", Tier.STATEMENTS),
        ("lite", Tier.LITE),
        ("standard", Tier.STANDARD),
        ("plus", Tier.PLUS),
    ):
        monkeypatch.setattr(
            collections_module, "subscriptions_col",
            _FakeFindOneCollection({"tier": name, "status": "active"}),
        )
        sub = asyncio.run(get_subscription(f"{name}@example.com"))
        assert sub.tier == expected


def _patch_counts(monkeypatch, tier, *, accounts=0, banks=0):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": tier, "status": "active"}),
    )
    monkeypatch.setattr(collections_module, "connections_col", _FakeCountCollection(banks))
    monkeypatch.setattr(collections_module, "finexer_consents_col", _FakeCountCollection(0))
    monkeypatch.setattr(collections_module, "yapily_consents_col", _FakeCountCollection(0))
    monkeypatch.setattr(collections_module, "accounts_col", _FakeCountCollection(accounts))


def test_check_connection_limit_raises_402_for_lite_at_ten_accounts(monkeypatch):
    _patch_counts(monkeypatch, "lite", accounts=10, banks=3)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check_connection_limit("lite-user@example.com"))

    assert exc_info.value.status_code == 402
    detail = exc_info.value.detail
    assert detail["code"] == "CONNECTION_LIMIT_REACHED"
    assert detail["kind"] == "accounts"
    assert detail["current_tier"] == "lite"
    assert detail["limit"] == 10
    assert detail["message"] == "Your Lite plan allows up to 10 connected accounts."
    assert "Pro" not in detail["message"]
    assert "Premium" not in detail["message"]


def test_lite_allows_up_to_nine_accounts_and_more_than_three_banks(monkeypatch):
    _patch_counts(monkeypatch, "lite", accounts=9, banks=5)
    asyncio.run(check_connection_limit("lite-user@example.com"))


def test_lite_limits_are_ten_accounts_and_forty_penny():
    from app.core.subscription import TIER_LIMITS
    assert TIER_LIMITS[Tier.LITE]["max_accounts"] == 10
    assert TIER_LIMITS[Tier.LITE]["max_banks"] is None
    assert TIER_LIMITS[Tier.LITE]["penny_messages_per_month"] == 40


def test_standard_cap_is_25_accounts(monkeypatch):
    from app.core.subscription import TIER_LIMITS
    assert TIER_LIMITS[Tier.STANDARD]["max_accounts"] == 25
    assert TIER_LIMITS[Tier.PLUS]["max_accounts"] is None
    _patch_counts(monkeypatch, "standard", accounts=24)
    asyncio.run(check_connection_limit("std@example.com"))
    _patch_counts(monkeypatch, "standard", accounts=25)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(check_connection_limit("std@example.com"))
    assert exc.value.detail["limit"] == 25


def test_check_connection_limit_is_noop_for_plus_tier(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "plus", "status": "active"}),
    )
    monkeypatch.setattr(collections_module, "connections_col", _FakeCountCollection(999))
    monkeypatch.setattr(collections_module, "finexer_consents_col", _FakeCountCollection(999))
    monkeypatch.setattr(collections_module, "yapily_consents_col", _FakeCountCollection(999))
    monkeypatch.setattr(collections_module, "accounts_col", _FakeCountCollection(999))

    # Plus tier has no bank or account cap — must not raise.
    asyncio.run(check_connection_limit("plus-user@example.com"))


# ── B53: Plus replaces Connect and Max ────────────────────────────────────

def test_b53_tier_table_accounts_penny_prices():
    from app.core.subscription import TIER_BILLING_PRICES_GBP, TIER_LIMITS, TIER_BY_NAME
    assert list(TIER_BY_NAME) == ["statements", "lite", "standard", "plus"]
    assert "max" not in TIER_BY_NAME and "connect" not in TIER_BY_NAME
    assert [TIER_LIMITS[t]["max_accounts"] for t in (Tier.LITE, Tier.STANDARD, Tier.PLUS)] == [10, 25, None]
    assert [TIER_LIMITS[t]["max_banks"] for t in (Tier.LITE, Tier.STANDARD, Tier.PLUS)] == [None, None, None]
    assert [TIER_LIMITS[t]["penny_messages_per_month"] for t in (Tier.LITE, Tier.STANDARD, Tier.PLUS)] == [40, 150, 300]
    assert TIER_BILLING_PRICES_GBP["plus"] == {"monthly": 12.99, "three_months": 36.99, "six_months": 69.99, "annual": 129.99}
    assert TIER_BILLING_PRICES_GBP["lite"]["six_months"] == 31.99 and TIER_BILLING_PRICES_GBP["lite"]["annual"] == 59.99
    assert TIER_BILLING_PRICES_GBP["standard"]["six_months"] == 53.99 and TIER_BILLING_PRICES_GBP["standard"]["annual"] == 99.99


def test_b53_legacy_max_connect_premium_family_map_to_plus(monkeypatch):
    for legacy_name in ("max", "connect", "premium", "family"):
        monkeypatch.setattr(
            collections_module, "subscriptions_col",
            _FakeFindOneCollection({"tier": legacy_name, "status": "active"}),
        )
        sub = asyncio.run(get_subscription(f"legacy-{legacy_name}@example.com"))
        assert sub.tier == Tier.PLUS
        assert sub.tier_name == "plus"
        assert sub.limit("penny_messages_per_month") == 300
        assert sub.limit("max_accounts") is None


def test_b53_default_tier_config_is_plus_and_legacy_env_values_still_resolve(monkeypatch):
    from app.core import config as config_module
    from app.core.subscription import _default_tier
    assert config_module.DEFAULT_TIER == "plus"
    for env_value in ("max", "connect", "plus", " Plus "):
        monkeypatch.setattr(config_module, "DEFAULT_TIER", env_value)
        assert _default_tier() == Tier.PLUS
    monkeypatch.setattr(config_module, "DEFAULT_TIER", "lite")
    assert _default_tier() == Tier.LITE


def test_b53_admin_cannot_set_retired_tier():
    import asyncio as _a
    from app.routers import subscription as router
    for name in ("max", "connect"):
        with pytest.raises(HTTPException) as exc:
            _a.run(router.admin_set_tier({"email": "x@example.com", "tier": name}, user={"name": "Bot", "email": "b@example.com"}))
        assert exc.value.status_code == 400
