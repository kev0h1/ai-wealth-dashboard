"""Tests for the new Statements/Lite/Standard/Connect/Max tier model
(app.core.subscription) — replaces the old free/pro/premium/family tiers.

Default tier (no doc, expired doc, or unrecognised stored name) is
configurable via DEFAULT_TIER and defaults to "max" so nobody is
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


def test_default_tier_is_max_when_no_subscription_doc(monkeypatch):
    monkeypatch.setattr(collections_module, "subscriptions_col", _FakeFindOneCollection(None))
    sub = asyncio.run(get_subscription("nobody@example.com"))
    assert sub.tier == Tier.MAX
    assert sub.tier_name == "max"


def test_default_tier_is_max_when_doc_expired(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "lite", "status": "expired"}),
    )
    sub = asyncio.run(get_subscription("expired@example.com"))
    assert sub.tier == Tier.MAX


def test_legacy_pro_maps_to_standard(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "pro", "status": "active"}),
    )
    sub = asyncio.run(get_subscription("legacy-pro@example.com"))
    assert sub.tier == Tier.STANDARD


def test_legacy_premium_and_family_map_to_max(monkeypatch):
    for legacy_name in ("premium", "family"):
        monkeypatch.setattr(
            collections_module, "subscriptions_col",
            _FakeFindOneCollection({"tier": legacy_name, "status": "active"}),
        )
        sub = asyncio.run(get_subscription(f"legacy-{legacy_name}@example.com"))
        assert sub.tier == Tier.MAX


def test_legacy_free_maps_to_default_tier(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "free", "status": "active"}),
    )
    sub = asyncio.run(get_subscription("legacy-free@example.com"))
    assert sub.tier == Tier.MAX


def test_unknown_tier_name_maps_to_default_tier(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "gold", "status": "active"}),
    )
    sub = asyncio.run(get_subscription("weird-tier@example.com"))
    assert sub.tier == Tier.MAX


def test_new_tier_names_pass_through_unchanged(monkeypatch):
    for name, expected in (
        ("statements", Tier.STATEMENTS),
        ("lite", Tier.LITE),
        ("standard", Tier.STANDARD),
        ("connect", Tier.CONNECT),
        ("max", Tier.MAX),
    ):
        monkeypatch.setattr(
            collections_module, "subscriptions_col",
            _FakeFindOneCollection({"tier": name, "status": "active"}),
        )
        sub = asyncio.run(get_subscription(f"{name}@example.com"))
        assert sub.tier == expected


def test_check_connection_limit_raises_402_for_lite_at_bank_cap(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "lite", "status": "active"}),
    )
    monkeypatch.setattr(collections_module, "connections_col", _FakeCountCollection(3))
    monkeypatch.setattr(collections_module, "finexer_consents_col", _FakeCountCollection(0))
    monkeypatch.setattr(collections_module, "yapily_consents_col", _FakeCountCollection(0))
    monkeypatch.setattr(collections_module, "accounts_col", _FakeCountCollection(0))

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check_connection_limit("lite-user@example.com"))

    assert exc_info.value.status_code == 402
    detail = exc_info.value.detail
    assert detail["code"] == "CONNECTION_LIMIT_REACHED"
    assert detail["kind"] == "banks"
    assert detail["current_tier"] == "lite"
    assert detail["limit"] == 3
    assert "Pro" not in detail["message"]
    assert "Premium" not in detail["message"]


def test_check_connection_limit_is_noop_for_max_tier(monkeypatch):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": "max", "status": "active"}),
    )
    monkeypatch.setattr(collections_module, "connections_col", _FakeCountCollection(999))
    monkeypatch.setattr(collections_module, "finexer_consents_col", _FakeCountCollection(999))
    monkeypatch.setattr(collections_module, "yapily_consents_col", _FakeCountCollection(999))
    monkeypatch.setattr(collections_module, "accounts_col", _FakeCountCollection(999))

    # Max tier has no bank or account cap — must not raise.
    asyncio.run(check_connection_limit("max-user@example.com"))
