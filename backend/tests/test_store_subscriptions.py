"""C21/C24: the provider-neutral store seam (app.services.store_subscriptions)
and the store product catalogue. Exercised for both store providers so the
Google item inherits tested behaviour."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

import app.db.collections as collections_module
import app.services.billing_lifecycle as lifecycle
import app.services.store_subscriptions as seam
from app.core import store_catalogue
from app.core.subscription import (
    PENNY_TOPUP_PACKS, SUBSCRIPTION_TRIAL_DAYS, TIER_BILLING_PRICES_GBP, Tier, get_subscription,
)
from tests.fake_cols import FakeCol

UID = "seam@example.com"
NOW = datetime.now(timezone.utc)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def cols(monkeypatch):
    c = {
        "subscriptions_col": FakeCol(unique=(("user_id", "provider"),)),
        "billing_events_col": FakeCol(unique=(("event_id",),)),
        "penny_topups_col": FakeCol(unique=(("provider", "store_transaction_id"),)),
        "mcp_call_packs_col": FakeCol(unique=(("provider", "store_transaction_id"),)),
    }
    for name, col in c.items():
        monkeypatch.setattr(collections_module, name, col)
    pushes = []

    async def fake_notify(uid, title, body, url="/settings"):
        pushes.append((title, body))
        return True

    async def fake_landed(uid):
        return {"revoke": "off"}

    monkeypatch.setattr(lifecycle, "notify", fake_notify)
    monkeypatch.setattr(lifecycle, "on_landed_on_statements", fake_landed)
    c["pushes"] = pushes
    return c


# ── Catalogue ────────────────────────────────────────────────────────────────

def test_catalogue_is_nine_subscriptions_and_three_penny_packs_no_connect():
    cat = store_catalogue.build_catalogue()
    subs = [p for p in cat.values() if p.kind == "subscription"]
    packs = [p for p in cat.values() if p.kind == "pack"]
    assert len(subs) == 9 and len(packs) == 3
    assert {p.tier for p in subs} == {"lite", "standard", "max"}
    assert not any("connect" in p.product_id or "mcp" in p.product_id for p in cat.values())
    assert {p.billing_period for p in subs} == {"monthly", "six_months", "annual"}
    assert cat["sorted.lite.monthly"].tier == "lite"
    assert cat["sorted.max.annual"].billing_period == "annual"
    assert [p.product_id for p in packs] == [f"sorted.penny.{pk['messages']}" for pk in PENNY_TOPUP_PACKS]
    assert cat["sorted.penny.100"].pack_id == "medium"


def test_catalogue_overrides_replace_only_the_named_product():
    cat = store_catalogue.build_catalogue({"lite_annual": "custom.lite.year"})
    assert "custom.lite.year" in cat and "sorted.lite.annual" not in cat
    assert "sorted.lite.monthly" in cat
    assert store_catalogue.product_ids_by_key({"lite_annual": "custom.lite.year"})["lite_annual"] == "custom.lite.year"


def test_prices_are_web_prices_and_the_trial_is_14_days():
    # Kevin (C24, 2026-10-17): store prices match web exactly, so the one
    # price source is the web table. Nothing here may carry an iOS uplift.
    assert TIER_BILLING_PRICES_GBP["lite"]["monthly"] == 5.99
    assert TIER_BILLING_PRICES_GBP["standard"]["six_months"] == 53.99
    assert TIER_BILLING_PRICES_GBP["max"]["annual"] == 169.99
    assert [p["price_gbp"] for p in PENNY_TOPUP_PACKS] == [0.99, 2.99, 4.99]
    assert SUBSCRIPTION_TRIAL_DAYS == 14


# ── Subscription documents ───────────────────────────────────────────────────

@pytest.mark.parametrize("provider", ["apple", "google"])
def test_upsert_creates_a_provider_document_and_is_idempotent(cols, provider):
    kwargs = dict(tier="standard", billing_period="annual", status="active",
                  expires_at=NOW + timedelta(days=365), provider_subscription_id="orig-1",
                  signed_at=NOW)
    first = _run(seam.upsert_store_subscription(UID, provider, **kwargs))
    again = _run(seam.upsert_store_subscription(UID, provider, **kwargs))
    assert first["handled"] and again["handled"]
    docs = cols["subscriptions_col"].docs
    assert len(docs) == 1
    d = docs[0]
    assert d["provider"] == provider == d["source"] and d["tier"] == "standard"
    assert d["provider_subscription_id"] == "orig-1"
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.STANDARD and sub.provider == provider and sub.has_paid_subscription


def test_two_providers_coexist_and_the_higher_tier_wins(cols):
    _run(seam.upsert_store_subscription(UID, "apple", tier="lite", billing_period="monthly", status="active",
                                        expires_at=NOW + timedelta(days=20), provider_subscription_id="a1"))
    _run(seam.upsert_store_subscription(UID, "google", tier="max", billing_period="monthly", status="active",
                                        expires_at=NOW + timedelta(days=20), provider_subscription_id="g1"))
    assert len(cols["subscriptions_col"].docs) == 2
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.MAX and sub.provider == "google"


def test_trial_fields_are_recorded(cols):
    end = NOW + timedelta(days=14)
    _run(seam.upsert_store_subscription(UID, "apple", tier="lite", billing_period="monthly", status="trialing",
                                        expires_at=end, trial_ends_at=end, trial_started_at=NOW,
                                        provider_subscription_id="a1"))
    d = cols["subscriptions_col"].docs[0]
    assert d["status"] == "trialing" and d["trial_ends_at"] == end and d["trial_used_at"] == NOW


def test_stale_event_is_ignored(cols):
    newer = NOW
    older = NOW - timedelta(hours=1)
    _run(seam.upsert_store_subscription(UID, "apple", tier="lite", billing_period="monthly", status="active",
                                        expires_at=NOW + timedelta(days=30), provider_subscription_id="a1", signed_at=newer))
    res = _run(seam.set_store_subscription_status(UID, "apple", "a1", "expired", signed_at=older))
    assert res["handled"] is False and "older" in res["reason"]
    assert cols["subscriptions_col"].docs[0]["status"] == "active"


def test_expiry_for_a_superseded_subscription_does_not_touch_the_live_one(cols):
    _run(seam.upsert_store_subscription(UID, "apple", tier="lite", billing_period="monthly", status="active",
                                        expires_at=NOW + timedelta(days=30), provider_subscription_id="new"))
    res = _run(seam.set_store_subscription_status(UID, "apple", "old", "expired"))
    assert res["handled"] is False
    assert cols["subscriptions_col"].docs[0]["status"] == "active"


def test_expired_loses_entitlement_immediately_whatever_expires_at_says(cols):
    _run(seam.upsert_store_subscription(UID, "apple", tier="max", billing_period="annual", status="active",
                                        expires_at=NOW + timedelta(days=300), provider_subscription_id="a1"))
    _run(seam.set_store_subscription_status(UID, "apple", "a1", "expired"))
    sub = _run(get_subscription(UID))
    assert sub.tier == Tier.STATEMENTS and sub.status == "expired"


def test_past_due_keeps_tier_until_grace_ends_and_pushes_once(cols):
    _run(seam.upsert_store_subscription(UID, "apple", tier="standard", billing_period="monthly", status="active",
                                        expires_at=NOW - timedelta(hours=2), provider_subscription_id="a1"))
    grace = NOW + timedelta(days=5)
    _run(seam.set_store_subscription_status(UID, "apple", "a1", "past_due", grace_until=grace))
    assert _run(get_subscription(UID)).tier == Tier.STANDARD
    _run(seam.set_store_subscription_status(UID, "apple", "a1", "past_due", grace_until=grace))
    assert len(cols["pushes"]) == 1
    title, body = cols["pushes"][0]
    assert "—" not in body and "Apple ID" in body
    _run(seam.set_store_subscription_status(UID, "apple", "a1", "past_due", grace_until=NOW - timedelta(minutes=1)))
    assert _run(get_subscription(UID)).tier == Tier.STATEMENTS


def test_store_subscription_while_stripe_is_live_is_granted_and_flagged(cols):
    cols["subscriptions_col"].docs.append({
        "user_id": UID, "provider": "stripe", "source": "stripe", "stripe_subscription_id": "sub_1",
        "tier": "lite", "status": "active", "expires_at": NOW + timedelta(days=10),
    })
    with pytest.raises(seam.StorePurchaseRefused):
        _run(seam.validate_store_purchase(UID))
    res = _run(seam.upsert_store_subscription(UID, "apple", tier="max", billing_period="monthly", status="active",
                                              expires_at=NOW + timedelta(days=30), provider_subscription_id="a1"))
    assert res["handled"] and res["double_subscription"] is True
    apple = next(d for d in cols["subscriptions_col"].docs if d["provider"] == "apple")
    assert apple["double_subscription"] is True


def test_purchase_allowed_without_a_stripe_subscription(cols):
    _run(seam.validate_store_purchase(UID))
    cols["subscriptions_col"].docs.append({"user_id": UID, "provider": "stripe", "source": "stripe",
                                           "stripe_subscription_id": "s", "tier": "lite", "status": "expired"})
    _run(seam.validate_store_purchase(UID))


def test_cancel_at_period_end_changes_flag_not_entitlement(cols):
    _run(seam.upsert_store_subscription(UID, "apple", tier="lite", billing_period="monthly", status="active",
                                        expires_at=NOW + timedelta(days=9), provider_subscription_id="a1"))
    _run(seam.set_store_cancel_at_period_end(UID, "apple", "a1", True))
    sub = _run(get_subscription(UID))
    assert sub.cancel_at_period_end is True and sub.tier == Tier.LITE


# ── Ledger and consumables ───────────────────────────────────────────────────

def test_ledger_claim_is_atomic_and_replay_is_detected(cols):
    assert _run(seam.claim_event("apple", "uuid-1", "SUBSCRIBED"))[0] == "new"
    assert _run(seam.claim_event("apple", "uuid-1", "SUBSCRIBED"))[0] == "retry"  # claimed, never finished
    _run(seam.finish_event("apple", "uuid-1", {"handled": True}))
    state, doc = _run(seam.claim_event("apple", "uuid-1", "SUBSCRIBED"))
    assert state == "replay" and doc["result"] == {"handled": True}
    # The same id from the other store is a different event.
    assert _run(seam.claim_event("google", "uuid-1", "SUBSCRIBED"))[0] == "new"
    ids = {d["event_id"] for d in cols["billing_events_col"].docs}
    assert ids == {"apple:uuid-1", "google:uuid-1"}


def test_grant_pack_is_deduplicated_on_transaction_id(cols):
    first = _run(seam.grant_store_pack(UID, "apple", "penny", "medium", "tx-1"))
    second = _run(seam.grant_store_pack(UID, "apple", "penny", "medium", "tx-1"))
    assert first["duplicate"] is False and second["duplicate"] is True
    packs = cols["penny_topups_col"].docs
    assert len(packs) == 1 and packs[0]["messages"] == 100 and packs[0]["store_transaction_id"] == "tx-1"
    _run(seam.grant_store_pack(UID, "apple", "penny", "medium", "tx-2"))
    assert len(cols["penny_topups_col"].docs) == 2


def test_pack_refund_without_clawback_leaves_remaining_untouched(cols):
    _run(seam.grant_store_pack(UID, "apple", "penny", "large", "tx-1"))
    cols["penny_topups_col"].docs[0]["remaining"] = 37  # partly spent
    res = _run(seam.record_store_pack_refund("apple", "penny", "tx-1", clawback=False))
    assert res == {"pack_found": True, "clawback": False, "remaining_before": 37}
    pack = cols["penny_topups_col"].docs[0]
    assert pack["remaining"] == 37 and pack["refunded_at"] and "clawed_back_at" not in pack


def test_pack_refund_with_clawback_zeroes_remaining(cols):
    _run(seam.grant_store_pack(UID, "apple", "penny", "large", "tx-1"))
    cols["penny_topups_col"].docs[0]["remaining"] = 37
    res = _run(seam.record_store_pack_refund("apple", "penny", "tx-1", clawback=True))
    assert res["clawback"] is True
    pack = cols["penny_topups_col"].docs[0]
    assert pack["remaining"] == 0 and pack["clawed_back_at"] and pack["refunded_at"]


def test_non_store_provider_is_rejected(cols):
    with pytest.raises(ValueError):
        _run(seam.upsert_store_subscription(UID, "stripe", tier="lite", billing_period="monthly", status="active",
                                            expires_at=None, provider_subscription_id="x"))


def test_concurrent_grants_for_one_transaction_grant_exactly_once(cols):
    """S1: N parallel verify calls (or a verify racing a ONE_TIME_CHARGE) for
    one purchase. The fake collection simulates the unique partial index; the
    insert yields so the calls genuinely interleave."""
    col = cols["penny_topups_col"]
    real_insert = col.insert_one

    async def yielding_insert(doc):
        await asyncio.sleep(0)
        return await real_insert(doc)

    col.insert_one = yielding_insert

    async def go():
        return await asyncio.gather(*[
            seam.grant_store_pack(UID, "apple", "penny", "medium", "tx-race") for _ in range(12)
        ])

    results = _run(go())
    assert len(col.docs) == 1
    assert sum(1 for r in results if r["duplicate"] is False) == 1
    assert all(r["handled"] for r in results)
