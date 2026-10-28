"""C37: per-channel billing availability, tier_source and select-free."""
import asyncio

import pytest
from fastapi import HTTPException

import app.core.config as config_module
import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.subscription as subscription_router_module
import app.services.billing_channels as channels_module
from app.services import play_billing, runtime_settings
from tests.conftest import patch_billing_enabled as _patch_billing_enabled
from tests.test_billing import _FakeCol

UID = "c37@example.com"


def _run(coro):
    return asyncio.run(coro)


def _set(monkeypatch, *, stripe=False, apple=False, google=False):
    async def _fresh():
        return None

    monkeypatch.setattr(runtime_settings, "ensure_fresh", _fresh)
    _patch_billing_enabled(monkeypatch, stripe)
    monkeypatch.setattr(config_module, "BILLING_ENABLED", stripe)
    monkeypatch.setattr(config_module, "APPLE_IAP_ENABLED", apple)
    monkeypatch.setattr(play_billing, "play_enabled", lambda: google)
    monkeypatch.setattr(subscription_module, "_default_tier", lambda: subscription_module.TIER_BY_NAME["plus"])


def _subs(monkeypatch, docs=None):
    fake = _FakeCol(docs)
    monkeypatch.setattr(db_collections_module, "subscriptions_col", fake)
    monkeypatch.setattr(subscription_router_module, "subscriptions_col", fake)
    return fake


@pytest.mark.parametrize("flags,expected", [
    ({}, {"stripe_web": False, "apple": False, "google": False, "any_live": False}),
    ({"stripe": True}, {"stripe_web": True, "apple": False, "google": False, "any_live": True}),
    ({"google": True}, {"stripe_web": False, "apple": False, "google": True, "any_live": True}),
    ({"apple": True}, {"stripe_web": False, "apple": True, "google": False, "any_live": True}),
])
def test_channels_per_flag_combination(monkeypatch, flags, expected):
    _set(monkeypatch, **flags)
    assert _run(channels_module.billing_channels(flags.get("stripe", False))) == expected


def _info(monkeypatch):
    return _run(subscription_router_module.get_subscription_info(user={"email": UID}))


def test_get_subscription_reports_channels_and_any_live(monkeypatch):
    _set(monkeypatch, google=True)
    _subs(monkeypatch)
    info = _info(monkeypatch)
    assert info["billing_live"] is False
    assert info["billing_channels"] == {"stripe_web": False, "apple": False, "google": True}
    assert info["billing_live_any"] is True


def test_get_subscription_none_live(monkeypatch):
    _set(monkeypatch)
    _subs(monkeypatch)
    info = _info(monkeypatch)
    assert info["billing_live_any"] is False


def test_tier_source_no_doc_is_default(monkeypatch):
    _set(monkeypatch)
    _subs(monkeypatch)
    info = _info(monkeypatch)
    assert info["tier_source"] == "default"
    assert info["is_default_tier"] is True
    assert info["tier"] == "plus"


@pytest.mark.parametrize("doc,expected", [
    ({"provider": "stripe", "tier": "plus", "status": "active", "managed_by": "manual"}, "manual"),
    ({"provider": "stripe", "tier": "statements", "status": "active", "managed_by": "self"}, "free_selected"),
    ({"provider": "stripe", "tier": "plus", "status": "active", "source": "stripe",
      "stripe_subscription_id": "sub_1"}, "stripe"),
    ({"provider": "apple", "tier": "plus", "status": "active", "source": "apple"}, "apple"),
    ({"provider": "google", "tier": "plus", "status": "active", "source": "google"}, "google"),
])
def test_tier_source_from_doc(monkeypatch, doc, expected):
    _set(monkeypatch)
    _subs(monkeypatch, [{"user_id": UID, **doc}])
    info = _info(monkeypatch)
    assert info["tier_source"] == expected
    assert info["is_default_tier"] is False


def test_select_free_allowed_with_only_google_live(monkeypatch):
    _set(monkeypatch, google=True)
    fake = _subs(monkeypatch)
    assert _run(subscription_router_module.select_free_tier(user={"email": UID})) == {"ok": True, "tier": "statements"}
    assert fake.docs[0]["tier"] == "statements"


def test_select_free_refused_with_no_channel_live(monkeypatch):
    _set(monkeypatch)
    fake = _subs(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(subscription_router_module.select_free_tier(user={"email": UID}))
    assert exc.value.status_code == 409
    assert fake.docs == []


def test_select_free_refused_with_live_google_subscription(monkeypatch):
    _set(monkeypatch, google=True)
    fake = _subs(monkeypatch, [{"user_id": UID, "provider": "google", "tier": "plus",
                                "status": "active", "source": "google"}])
    with pytest.raises(HTTPException) as exc:
        _run(subscription_router_module.select_free_tier(user={"email": UID}))
    assert exc.value.status_code == 409
    assert "Google Play" in exc.value.detail
    assert len(fake.docs) == 1
