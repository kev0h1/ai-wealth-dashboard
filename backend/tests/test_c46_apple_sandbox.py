"""C46: Apple Sandbox purchases (TestFlight, App Review) are accepted in
production as marked test purchases.

Fake signed payloads only (the test CA from test_apple_billing); Apple is
never called. Covers: a sandbox purchase is recorded as a test with Apple's own
(short) expiry; Production behaves as before; a test purchase can never
replace or outrank a real paid subscription or a manual grant; test purchases
are never counted as paying; notifications work in both environments; and
every other check (signature chain, bundle id, appAccountToken) still applies
to Sandbox transactions.
"""
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import app.core.config as config
import app.services.apple_billing as apple_billing
import app.services.apple_jws as apple_jws
import app.services.subscription_admin as sa
from app.core.subscription import Tier, get_subscription, get_subscription_doc
from tests.test_apple_billing import (  # noqa: F401  (fixtures are used by name)
    BUNDLE, NOW, OTHER, UID, Pki, _doc, _ms, _notification, _run, _send, _signed_tx, _token, _tx, _verify, env, pki,
)

# Apple's sandbox renews on a compressed clock. The app judges these expiries against the real
# clock, so they are rebuilt per test (autouse fixture) rather than frozen at import (H161).
SANDBOX_EXPIRY = NOW + timedelta(minutes=5)


def _fresh_now():
    return datetime.now(timezone.utc)


@pytest.fixture(autouse=True)
def _fresh_sandbox_expiry(monkeypatch):
    monkeypatch.setattr(sys.modules[__name__], "SANDBOX_EXPIRY", _fresh_now() + timedelta(minutes=5))


def _sandbox_verify(env_, **kw):
    kw.setdefault("environment", "Sandbox")
    kw.setdefault("expires", SANDBOX_EXPIRY)
    return _verify(env_, _signed_tx(env_, **kw))


def _stripe_doc(env_, tier="lite", days=20):
    env_["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "stripe", "stripe_subscription_id": "s",
        "tier": tier, "status": "active", "expires_at": NOW + timedelta(days=days),
    })


# ── Recorded as a test purchase with Apple's expiry ──────────────────────────

def test_sandbox_purchase_is_recorded_as_a_test_with_apples_expiry(env):
    res = _sandbox_verify(env, product="sorted.standard.monthly")
    assert res["handled"] and res["status"] == "active"
    d = _doc(env)
    assert d["is_test"] is True and d["apple_environment"] == "Sandbox"
    assert d["tier"] == "standard"
    assert d["expires_at"].replace(microsecond=0) == SANDBOX_EXPIRY.replace(microsecond=0)
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.STANDARD and sub.is_test_purchase is True  # access follows the sandbox period


def test_a_sandbox_entitlement_expires_on_its_own(env):
    _sandbox_verify(env, expires=_fresh_now() + timedelta(minutes=5))
    d = _doc(env)
    d["expires_at"] = _fresh_now() - timedelta(minutes=1)  # the sandbox period has run out
    sub = _run(get_subscription(UID))
    assert sub.status == "expired" and sub.tier == Tier.STATEMENTS


def test_sandbox_restore_and_purchase_of_the_same_transaction_is_idempotent(env):
    signed = _signed_tx(env, environment="Sandbox", expires=SANDBOX_EXPIRY, txid="t-1")
    _verify(env, signed)
    _verify(env, signed)
    assert len([x for x in env["subscriptions_col"].docs if x["provider"] == "apple"]) == 1


def test_production_purchase_is_unchanged_and_not_marked(env):
    res = _verify(env, _signed_tx(env, product="sorted.plus.monthly"))
    assert res["handled"]
    d = _doc(env)
    assert d["is_test"] is False and d["apple_environment"] == "Production"
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.PLUS and sub.is_test_purchase is False and sub.has_paid_subscription is True


def test_a_sandbox_free_trial_does_not_burn_trial_history_or_flag_a_double(env):
    _stripe_doc(env, tier="lite")
    end = _fresh_now() + timedelta(minutes=3)
    _sandbox_verify(env, product="sorted.standard.annual", expires=end, offer=1, discount="FREE_TRIAL", price=0)
    d = _doc(env)
    assert d["is_test"] is True and d["double_subscription"] is False
    assert not d.get("trial_used_at")


# ── Precedence: a test purchase never beats or replaces a real entitlement ───

def test_sandbox_never_replaces_a_live_real_apple_subscription(env):
    _verify(env, _signed_tx(env, product="sorted.lite.monthly", original="real-1", expires=NOW + timedelta(days=30)))
    before = dict(_doc(env))
    # Ends later than the real one: only the seam's own guard can refuse it.
    res = _sandbox_verify(env, product="sorted.plus.monthly", original="sbx-1", expires=NOW + timedelta(days=60))
    # Handled and unchanged (not a refusal), so the client finishes it and shows no error.
    assert res["handled"] is True and res["unchanged"] is True and "real purchase" in res["reason"]
    # Ends sooner: the restore guard answers "not newer" (applied, so the client finishes it).
    res = _sandbox_verify(env, product="sorted.plus.monthly", original="sbx-2", expires=SANDBOX_EXPIRY)
    assert res["handled"] is True and res.get("unchanged") is True
    after = _doc(env)
    assert after["provider_subscription_id"] == "real-1" and after["tier"] == "lite" and after["is_test"] is False
    assert after["expires_at"] == before["expires_at"]


def test_sandbox_notification_never_replaces_a_live_real_apple_subscription(env):
    _verify(env, _signed_tx(env, original="real-1", expires=NOW + timedelta(days=30)))
    res = _send(env, "SUBSCRIBED", tx=_tx(env, product="sorted.plus.monthly", original="sbx-1", environment="Sandbox",
                                            expires=SANDBOX_EXPIRY), environment="Sandbox")
    assert res["result"]["handled"] is True and res["result"]["unchanged"] is True
    assert _doc(env)["provider_subscription_id"] == "real-1"


def test_sandbox_expiry_or_refund_never_touches_a_real_document_even_with_the_same_id(env):
    _verify(env, _signed_tx(env, original="same-id", expires=NOW + timedelta(days=30)))
    t = NOW + timedelta(seconds=5)
    for ntype in ("EXPIRED", "REFUND", "DID_FAIL_TO_RENEW"):
        res = _send(env, ntype, tx=_tx(env, original="same-id", environment="Sandbox", signed=t), environment="Sandbox", signed=t)
        assert res["result"]["handled"] is False
    assert _doc(env)["status"] == "active"


def test_a_sandbox_purchase_does_not_outrank_a_live_stripe_subscription(env):
    _stripe_doc(env, tier="lite", days=20)
    _sandbox_verify(env, product="sorted.plus.annual")
    assert _doc(env)["is_test"] is True
    picked, sub = _run(get_subscription_doc(UID))
    assert picked["provider"] == "stripe" and sub.tier == Tier.LITE and sub.is_test_purchase is False


def test_a_sandbox_purchase_does_not_outrank_a_manual_grant(env):
    env["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "manual", "managed_by": "manual",
        "tier": "standard", "status": "active", "expires_at": None,
    })
    _sandbox_verify(env, product="sorted.plus.annual", expires=NOW + timedelta(days=400))
    picked, sub = _run(get_subscription_doc(UID))
    assert picked["source"] == "manual" and sub.tier == Tier.STANDARD


def test_a_sandbox_purchase_does_lift_a_user_on_the_free_selected_plan(env):
    env["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "self", "managed_by": "self",
        "tier": "statements", "status": "active", "expires_at": None,
    })
    _sandbox_verify(env, product="sorted.lite.monthly")
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.LITE and sub.is_test_purchase is True


def test_a_real_purchase_replaces_a_test_one_whatever_the_expiries(env):
    _sandbox_verify(env, product="sorted.plus.annual", original="sbx-1", expires=NOW + timedelta(days=100))
    res = _verify(env, _signed_tx(env, product="sorted.lite.monthly", original="real-1", expires=NOW + timedelta(days=30)))
    assert res["handled"] and not res.get("unchanged")
    d = _doc(env)
    assert d["is_test"] is False and d["provider_subscription_id"] == "real-1" and d["apple_environment"] == "Production"


def test_a_sandbox_purchase_may_replace_a_lapsed_real_document(env):
    _verify(env, _signed_tx(env, original="real-1", expires=NOW - timedelta(days=1)))
    assert _doc(env)["status"] == "expired"
    res = _sandbox_verify(env, original="sbx-1")
    assert res["handled"] and _doc(env)["is_test"] is True


def test_a_test_purchase_does_not_block_a_manual_grant_or_count_as_live(env):
    _sandbox_verify(env)
    assert sa.doc_live_provider(_doc(env)) is None
    assert sa.live_provider(env["subscriptions_col"].docs) is None


# ── Excluded from metrics and paying-user figures ────────────────────────────

def test_ops_detail_reports_a_test_purchase_and_not_a_paying_customer(env, monkeypatch):
    import app.routers.ops_people_subscription as ops_sub

    async def fake_allowance(*a, **k):
        return {"limit": 10, "used": 0, "remaining": 10, "topup_messages": 0}

    async def fake_topups(*a, **k):
        return []

    monkeypatch.setattr(ops_sub, "penny_allowance", fake_allowance)
    monkeypatch.setattr(ops_sub, "mcp_allowance", fake_allowance)
    monkeypatch.setattr(ops_sub, "settle_topups", fake_topups)
    _sandbox_verify(env)
    detail = _run(ops_sub._detail(UID))
    assert detail["is_test_purchase"] is True and detail["has_paid_subscription"] is False
    assert detail["provider_live"] is False and detail["live_provider"] is None

    env["subscriptions_col"].docs.clear()
    _verify(env, _signed_tx(env))
    real = _run(ops_sub._detail(UID))
    assert real["is_test_purchase"] is False and real["has_paid_subscription"] is True and real["live_provider"] == "apple"


def test_ops_people_row_marks_a_test_plan(env, monkeypatch):
    import app.routers.ops_people as ops_people

    async def none(*a, **k):
        raise RuntimeError("not needed")

    monkeypatch.setattr(ops_people.cols, "finexer_consents_col", None, raising=False)  # bank lookup fails on its own
    _sandbox_verify(env)
    row = _run(ops_people._enrich(UID, NOW))
    assert row["plan_is_test"] is True and row["on_trial"] is False
    env["subscriptions_col"].docs.clear()
    _verify(env, _signed_tx(env))
    assert _run(ops_people._enrich(UID, NOW))["plan_is_test"] is False


def test_the_client_subscription_endpoint_flags_a_test_purchase(env):
    sub = _run(get_subscription(UID))
    assert sub.is_test_purchase is False  # no document at all
    _sandbox_verify(env)
    assert _run(get_subscription(UID)).is_test_purchase is True


# ── Notifications, both environments ─────────────────────────────────────────

def test_notifications_are_processed_for_both_environments(env):
    prod = _send(env, "SUBSCRIBED", tx=_tx(env, uid=UID, original="p-1"), environment="Production")
    assert prod["result"]["handled"] and _doc(env)["is_test"] is False
    env["subscriptions_col"].docs.clear()
    sbx = _send(env, "SUBSCRIBED", tx=_tx(env, original="s-1", environment="Sandbox", expires=SANDBOX_EXPIRY), environment="Sandbox")
    assert sbx["result"]["handled"]
    d = _doc(env)
    assert d["is_test"] is True and d["apple_environment"] == "Sandbox" and d["provider_subscription_id"] == "s-1"


def test_sandbox_renewal_expiry_and_refund_follow_the_test_document(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, original="s-1", environment="Sandbox", expires=SANDBOX_EXPIRY), environment="Sandbox")
    t1 = NOW + timedelta(seconds=5)
    renew_to = _fresh_now() + timedelta(minutes=10)
    _send(env, "DID_RENEW", tx=_tx(env, original="s-1", environment="Sandbox", expires=renew_to, signed=t1), environment="Sandbox", signed=t1)
    d = _doc(env)
    assert d["is_test"] is True and d["expires_at"].replace(microsecond=0) == renew_to.replace(microsecond=0)
    t2 = NOW + timedelta(seconds=10)
    res = _send(env, "EXPIRED", tx=_tx(env, original="s-1", environment="Sandbox", signed=t2), environment="Sandbox", signed=t2)
    assert res["result"]["handled"] and _doc(env)["status"] == "expired"


def test_a_production_notification_never_touches_a_test_document(env):
    _send(env, "SUBSCRIBED", tx=_tx(env, original="s-1", environment="Sandbox", expires=SANDBOX_EXPIRY), environment="Sandbox")
    t = NOW + timedelta(seconds=5)
    res = _send(env, "EXPIRED", tx=_tx(env, original="s-1", environment="Production", signed=t), environment="Production", signed=t)
    assert res["result"]["handled"] is False
    assert _doc(env)["status"] == "active"


def test_a_sandbox_deployment_that_excludes_sandbox_still_rejects_it(env, monkeypatch):
    monkeypatch.setattr(config, "APPLE_ALLOWED_ENVIRONMENTS", frozenset({"Production"}))
    with pytest.raises(apple_jws.AppleVerificationError, match="environment"):
        _send(env, "SUBSCRIBED", tx=_tx(env, environment="Sandbox"), environment="Sandbox")
    with pytest.raises(apple_jws.AppleVerificationError, match="environment"):
        _verify(env, _signed_tx(env, environment="Sandbox"))
    assert env["subscriptions_col"].docs == []


def test_the_production_default_allows_both_environments_and_uat_stays_sandbox_only():
    code = (
        "import app.core.config as c; print(sorted(c.APPLE_ALLOWED_ENVIRONMENTS))"
    )
    root = Path(__file__).resolve().parents[1]

    def run(app_url):
        import os
        e = {**os.environ, "APP_URL": app_url}
        e.pop("APPLE_ALLOWED_ENVIRONMENTS", None)
        return subprocess.run([sys.executable, "-c", code], cwd=root, env=e, capture_output=True, text=True, timeout=120).stdout.strip()

    assert run("https://wealth.auriqltd.co.uk") == "['Production', 'Sandbox']"
    assert run("https://uat.wealth.auriqltd.co.uk") == "['Sandbox']"


# ── Every other check still applies to Sandbox ───────────────────────────────

def test_sandbox_with_a_bad_signature_is_rejected(env):
    attacker = Pki("Attacker")
    forged = attacker.sign(_tx(env, environment="Sandbox"))
    with pytest.raises(apple_jws.AppleVerificationError):
        _verify(env, forged)
    with pytest.raises(apple_jws.AppleVerificationError):
        _run(apple_billing.handle_notification(_notification(env, "SUBSCRIBED", tx=_tx(env, environment="Sandbox"),
                                                             environment="Sandbox", pki=attacker)))
    wrong_key_leaf = env["pki"].sign(_tx(env, environment="Sandbox"), key=Pki("Other").leaf_key)
    with pytest.raises(apple_jws.AppleVerificationError, match="signature"):
        _verify(env, wrong_key_leaf)
    assert env["subscriptions_col"].docs == []


def test_sandbox_with_the_wrong_bundle_is_rejected(env):
    with pytest.raises(apple_jws.AppleVerificationError, match="bundle"):
        _verify(env, _signed_tx(env, environment="Sandbox", bundle="com.someone.else"))
    with pytest.raises(apple_jws.AppleVerificationError, match="bundle"):
        _send(env, "SUBSCRIBED", tx=_tx(env, environment="Sandbox", bundle="com.someone.else"), environment="Sandbox")
    assert env["subscriptions_col"].docs == []


def test_sandbox_with_an_unknown_product_grants_nothing(env):
    res = _verify(env, _signed_tx(env, environment="Sandbox", product="not.a.product"))
    assert res["handled"] is False and env["subscriptions_col"].docs == []


def test_sandbox_with_a_mismatched_account_token_is_refused(env):
    _token(env, OTHER)
    mine = _token(env, UID)
    theirs = _token(env, OTHER)
    assert mine != theirs
    with pytest.raises(apple_billing.AppleAccountMismatch):
        _verify(env, _signed_tx(env, environment="Sandbox", token=theirs))  # someone else's token
    with pytest.raises(apple_billing.AppleAccountMismatch):
        _verify(env, _signed_tx(env, environment="Sandbox", token=None, original="not-held"))  # no token, not held
    assert env["subscriptions_col"].docs == []


def test_sandbox_revocation_and_lapse_are_still_honoured(env):
    res = _verify(env, _signed_tx(env, environment="Sandbox", expires=SANDBOX_EXPIRY, revocation=NOW - timedelta(minutes=1)))
    assert res["handled"] and _doc(env)["status"] == "expired"
    assert _run(get_subscription(UID)).status == "expired"
    env["subscriptions_col"].docs.clear()
    _verify(env, _signed_tx(env, environment="Sandbox", expires=NOW - timedelta(minutes=1)))
    assert _doc(env)["status"] == "expired"


# ── Select free plan, sandbox packs, declined-sandbox finish ─────────────────

def _select_free(env_, monkeypatch):
    import app.routers.subscription as router
    import app.services.billing_channels as channels

    async def live(_enabled):
        return {"any_live": True}

    monkeypatch.setattr(channels, "billing_channels", live)
    monkeypatch.setattr(router, "subscriptions_col", env_["subscriptions_col"])
    return _run(router.select_free_tier(user={"email": UID}))


def test_select_free_plan_is_not_blocked_by_a_test_purchase(env, monkeypatch):
    _sandbox_verify(env, expires=_fresh_now() + timedelta(minutes=5))
    assert _select_free(env, monkeypatch) == {"ok": True, "tier": "statements"}


def test_select_free_plan_is_not_blocked_by_a_lapsed_apple_document(env, monkeypatch):
    _verify(env, _signed_tx(env, expires=NOW + timedelta(days=1)))
    _doc(env)["expires_at"] = _fresh_now() - timedelta(minutes=1)  # still marked active, period passed
    assert _select_free(env, monkeypatch)["ok"] is True


def test_select_free_plan_is_still_blocked_by_a_live_real_apple_subscription(env, monkeypatch):
    from fastapi import HTTPException

    _verify(env, _signed_tx(env, expires=NOW + timedelta(days=30)))
    with pytest.raises(HTTPException) as exc:
        _select_free(env, monkeypatch)
    assert exc.value.status_code == 409


def test_a_sandbox_pack_credits_messages_tagged_as_a_test(env):
    res = _verify(env, _signed_tx(env, environment="Sandbox", product="sorted.penny.100", original="sp-1", txid="sp-1"))
    assert res["handled"] is True
    packs = env["penny_topups_col"].docs
    assert len(packs) == 1 and packs[0]["messages"] == 100 and packs[0]["remaining"] == 100
    assert packs[0]["is_test"] is True and packs[0]["apple_environment"] == "Sandbox"


def test_a_production_pack_is_not_tagged_as_a_test(env):
    _verify(env, _signed_tx(env, product="sorted.penny.100", original="pp-1", txid="pp-1"))
    pack = env["penny_topups_col"].docs[0]
    assert pack["is_test"] is False and pack["apple_environment"] == "Production"


def test_a_sandbox_pack_notification_is_tagged_and_granted_once(env):
    tx = _tx(env, environment="Sandbox", product="sorted.penny.100", original="sp-2", txid="sp-2")
    _send(env, "ONE_TIME_CHARGE", tx=tx, environment="Sandbox")
    _verify(env, env["pki"].sign(tx))  # the client posting the same transaction grants nothing more
    packs = env["penny_topups_col"].docs
    assert len(packs) == 1 and packs[0]["is_test"] is True


def test_ops_detail_shows_a_sandbox_pack_as_a_test(env, monkeypatch):
    import app.routers.ops_people_subscription as ops_sub

    async def allowance(*a, **k):
        return {"limit": 10, "used": 0, "remaining": 10, "topup_messages": 100}

    async def topups(*a, **k):
        return list(env["penny_topups_col"].docs)

    monkeypatch.setattr(ops_sub, "penny_allowance", allowance)
    monkeypatch.setattr(ops_sub, "mcp_allowance", allowance)
    monkeypatch.setattr(ops_sub, "settle_topups", topups)
    _verify(env, _signed_tx(env, environment="Sandbox", product="sorted.penny.100", original="sp-3", txid="sp-3"))
    env["penny_topups_col"].docs[0]["expires_at"] = None
    packs = _run(ops_sub._detail(UID))["penny"]["packs"]
    assert packs and packs[0]["is_test"] is True
