"""B51: the Connect plan is hidden and unpurchasable unless
CONNECT_TIER_ENABLED is on (production OFF, UAT ON). Existing subscribers
keep their entitlements; the webhook stays tolerant. No database: every
collection is a fake and MONGO_DB is never touched."""
import asyncio
import importlib.util
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest
from fastapi import HTTPException

import app.core.config as config_module
import app.core.subscription as subscription_module
import app.routers.billing as billing_router_module
import app.routers.subscription as subscription_router_module
import app.services.billing as billing_module
from tests.conftest import patch_billing_enabled as _patch_billing_enabled
from tests.test_billing import UID, _FULL_PRICE_IDS, _FakeCol, _make_fake_stripe, _patch_collections


def _run(coro):
    return asyncio.run(coro)


def _flag(monkeypatch, on: bool):
    monkeypatch.setattr(config_module, "CONNECT_TIER_ENABLED", on)


def _info(monkeypatch, tier: str):
    async def _fake_get_subscription(email):
        return subscription_module.Subscription(subscription_module.TIER_BY_NAME[tier])

    monkeypatch.setattr(subscription_router_module, "get_subscription", _fake_get_subscription)
    monkeypatch.setattr(subscription_router_module, "subscriptions_col", _FakeCol())
    _patch_billing_enabled(monkeypatch, False)
    return _run(subscription_router_module.get_subscription_info(user={"email": UID}))


# ── config ────────────────────────────────────────────────────────────────

def _config_in_subprocess(env_extra: dict, expr: str) -> str:
    """Evaluate `expr` against a freshly imported app.core.config in a child
    process with a controlled environment (no reload of the live module)."""
    import os
    import subprocess
    env = {k: v for k, v in os.environ.items()
           if k not in ("CONNECT_TIER_ENABLED", "CONNECT_SUBSCRIBER_POLICY", "STRIPE_SECRET_KEY", "STRIPE_PRICE_IDS")}
    env.update(env_extra)
    backend = str(Path(__file__).resolve().parents[1])
    out = subprocess.run(
        [sys.executable, "-c", f"import app.core.config as c; print(*({expr},))"],
        cwd=backend, env=env, capture_output=True, text=True, timeout=60,
    )
    assert out.returncode == 0, out.stderr[-500:]
    return out.stdout.strip().splitlines()[-1]


def test_flag_defaults_off_and_policy_defaults_keep():
    assert _config_in_subprocess({}, "c.CONNECT_TIER_ENABLED, c.CONNECT_SUBSCRIBER_POLICY") == "False keep_until_renewal"
    assert _config_in_subprocess({"CONNECT_SUBSCRIBER_POLICY": "nonsense"}, "c.CONNECT_SUBSCRIBER_POLICY") == "keep_until_renewal"
    assert _config_in_subprocess({"CONNECT_SUBSCRIBER_POLICY": "move_to_max"}, "c.CONNECT_SUBSCRIBER_POLICY") == "move_to_max"
    assert _config_in_subprocess({"CONNECT_TIER_ENABLED": "true"}, "c.CONNECT_TIER_ENABLED") == "True"


def test_billing_enabled_needs_connect_price_ids_only_when_flag_on():
    base = {k: v for k, v in _FULL_PRICE_IDS.items() if not k.startswith("connect")}
    env = {"STRIPE_SECRET_KEY": "sk_test_x", "STRIPE_PRICE_IDS": ",".join(f"{k}={v}" for k, v in base.items())}
    assert _config_in_subprocess(env, "c.BILLING_ENABLED") == "True"  # production: no Connect price needed
    assert _config_in_subprocess({**env, "CONNECT_TIER_ENABLED": "true"}, "c.BILLING_ENABLED") == "False"  # UAT needs it


# ── GET /subscription plan list ───────────────────────────────────────────

def test_production_config_hides_connect_from_plan_list(monkeypatch):
    _flag(monkeypatch, False)
    result = _info(monkeypatch, "standard")
    assert result["available_tiers"] == ["statements", "lite", "standard", "max"]
    assert "connect" not in result["prices_gbp"]
    assert "connect" not in result["billing_prices_gbp"]
    assert "connect" not in result["billing_periods"]


def test_uat_config_shows_connect(monkeypatch):
    _flag(monkeypatch, True)
    result = _info(monkeypatch, "standard")
    assert result["available_tiers"] == ["statements", "lite", "standard", "connect", "max"]
    assert result["prices_gbp"]["connect"] == 12.99
    assert "connect" in result["billing_periods"]


def test_existing_connect_subscriber_still_sees_their_own_plan_when_off(monkeypatch):
    _flag(monkeypatch, False)
    result = _info(monkeypatch, "connect")
    assert "connect" in result["available_tiers"]
    assert result["limits"]["mcp_tool_calls_per_month"] == 2000  # entitlements untouched
    assert result["tier"] == "connect"


# ── checkout ──────────────────────────────────────────────────────────────

def test_checkout_router_refuses_connect_with_static_4xx_when_off(monkeypatch):
    _flag(monkeypatch, False)
    monkeypatch.setattr(billing_module, "stripe", _make_fake_stripe())
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    # Connect price ids ARE configured: they must still be unreachable.
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    for period in ("monthly", "six_months", "annual"):
        with pytest.raises(HTTPException) as exc:
            _run(billing_router_module.create_checkout(
                {"kind": "subscription", "target": "Connect", "billing_period": period},
                user={"email": UID},
            ))
        assert exc.value.status_code == 400
        assert exc.value.detail == subscription_module.CONNECT_UNAVAILABLE_REASON


def test_checkout_refused_even_when_billing_not_live_and_at_service_layer(monkeypatch):
    _flag(monkeypatch, False)
    _patch_billing_enabled(monkeypatch, False)
    with pytest.raises(billing_module.BillingError):
        _run(billing_module.create_checkout_session(
            UID, kind="subscription", target="connect", success_url="u", cancel_url="c",
        ))


def test_checkout_allows_connect_when_on_and_other_tiers_when_off(monkeypatch):
    monkeypatch.setattr(billing_module, "stripe", _make_fake_stripe())
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    for flag, target in ((True, "connect"), (False, "max")):
        _flag(monkeypatch, flag)
        _patch_collections(monkeypatch, billing_customers_col=_FakeCol(), subscriptions_col=_FakeCol())
        result = _run(billing_router_module.create_checkout(
            {"kind": "subscription", "target": target}, user={"email": UID},
        ))
        assert result["url"].startswith("https://checkout.stripe.com/")


# ── webhook tolerance ─────────────────────────────────────────────────────

def _connect_event(event_id: str):
    return {
        "id": event_id, "type": "customer.subscription.updated",
        "data": {"object": {
            "id": "sub_b51", "customer": "cus_b51", "status": "active",
            "current_period_end": None, "metadata": {"uid": UID},
            "items": {"data": [{"price": {"id": "price_connect"}}]},
        }},
    }


def test_webhook_connect_event_for_new_user_is_recorded_and_ignored_when_off(monkeypatch, caplog):
    _flag(monkeypatch, False)
    events, subs = _FakeCol(), _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=events, subscriptions_col=subs)
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)
    with caplog.at_level("WARNING"):
        result = _run(billing_module.handle_event(_connect_event("evt_b51_new")))
    assert result["result"]["handled"] is False
    assert subs.docs == []                      # nothing granted
    assert len(events.docs) == 1                # event recorded
    assert any("B51" in r.getMessage() for r in caplog.records)  # and logged


def test_webhook_connect_event_for_existing_subscriber_still_processed_when_off(monkeypatch):
    _flag(monkeypatch, False)
    subs = _FakeCol([{"user_id": UID, "tier": "connect", "status": "active", "source": "stripe"}])
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=subs)
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)
    result = _run(billing_module.handle_event(_connect_event("evt_b51_existing")))
    assert result["result"]["handled"] is True
    assert subs.docs[0]["tier"] == "connect" and subs.docs[0]["status"] == "active"


def test_webhook_connect_event_granted_when_on(monkeypatch):
    _flag(monkeypatch, True)
    subs = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=subs)
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)
    result = _run(billing_module.handle_event(_connect_event("evt_b51_on")))
    assert result["result"]["handled"] is True and subs.docs[0]["tier"] == "connect"


# ── count script (counts only, dry) ───────────────────────────────────────

class _CountCol:
    def __init__(self, docs):
        self.docs = docs
        self.writes = 0

    def count_documents(self, q):
        def ok(d):
            for k, v in q.items():
                if isinstance(v, dict) and "$in" in v:
                    if d.get(k) not in v["$in"]:
                        return False
                elif d.get(k) != v:
                    return False
            return True
        return sum(1 for d in self.docs if ok(d))

    def __getattr__(self, name):  # any write attempt is a test failure
        raise AssertionError(f"count script must be read-only, touched {name}")


def _load_script():
    path = Path(__file__).resolve().parents[1] / "scripts" / "count_connect_subscribers.py"
    spec = importlib.util.spec_from_file_location("count_connect_subscribers", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_count_script_reports_counts_only_and_is_read_only(monkeypatch):
    script = _load_script()
    docs = [
        {"user_id": "secret-one@example.com", "tier": "connect", "status": "active", "source": "stripe"},
        {"user_id": "secret-two@example.com", "tier": "connect", "status": "expired", "managed_by": "manual"},
        {"user_id": "secret-three@example.com", "tier": "max", "status": "active"},
    ]

    class _Cfg:
        MONGO_DB = "wealth_test_fake"
        CONNECT_TIER_ENABLED = False
        CONNECT_SUBSCRIBER_POLICY = "keep_until_renewal"

    out = io.StringIO()
    with redirect_stdout(out):
        rc = script.main(["--dry-run-move"], collection=_CountCol(docs), config=_Cfg)
    text = out.getvalue()
    assert rc == 0
    assert "connect_total=2" in text and "connect_active=1" in text
    assert "connect_stripe_managed=1" in text and "connect_manual=1" in text
    assert "dry-run" in text and "nothing was written" in text
    assert "secret" not in text and "@" not in text


# ── admin set-tier break-glass ────────────────────────────────────────────

def _set_tier(monkeypatch, tier, **extra):
    col = _FakeCol()
    monkeypatch.setattr(subscription_router_module, "subscriptions_col", col)
    owner = {"email": subscription_router_module.PRIMARY_EMAIL}
    result = _run(subscription_router_module.admin_set_tier({"email": UID, "tier": tier, **extra}, user=owner))
    return result, col


def test_admin_set_tier_connect_needs_explicit_opt_in_when_off(monkeypatch, caplog):
    _flag(monkeypatch, False)
    with pytest.raises(HTTPException) as exc:
        _set_tier(monkeypatch, "connect")
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        _set_tier(monkeypatch, "connect", allow_disabled_tier="true")  # must be boolean true
    with caplog.at_level("WARNING"):
        result, col = _set_tier(monkeypatch, "connect", allow_disabled_tier=True)
    assert result["ok"] and col.docs[0]["tier"] == "connect"
    rec = [r for r in caplog.records if "B51" in r.getMessage()]
    assert rec and UID not in rec[0].getMessage()


def test_admin_set_tier_unaffected_for_other_tiers_and_when_on(monkeypatch):
    _flag(monkeypatch, False)
    assert _set_tier(monkeypatch, "max")[0]["ok"]
    _flag(monkeypatch, True)
    assert _set_tier(monkeypatch, "connect")[0]["ok"]
