"""C21 section 2: subscriptions_col is one document per (user, provider),
get_subscription applies the highest-live-tier-wins precedence rule, Stripe
handlers never read or overwrite an Apple document, and the data migration
is idempotent with a dry-run default."""
import asyncio
import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import app.db.collections as collections_module
import app.services.billing as billing_module
from app.core.subscription import Tier, get_subscription, get_subscription_doc, pick_subscription_doc
from tests.fake_cols import FakeCol

UID = "precedence@example.com"
NOW = datetime.now(timezone.utc)


def _run(coro):
    return asyncio.run(coro)


def _doc(provider, tier, *, status="active", days=10, updated_days_ago=0, **extra):
    base = {
        "user_id": UID, "provider": provider, "tier": tier, "status": status,
        "expires_at": NOW + timedelta(days=days),
        "updated_at": NOW - timedelta(days=updated_days_ago),
        "source": provider,
    }
    if provider == "stripe":
        base["stripe_subscription_id"] = "sub_1"
    base.update(extra)
    return base


def test_higher_live_tier_wins_across_providers():
    doc, sub = pick_subscription_doc([_doc("stripe", "lite"), _doc("apple", "plus")])
    assert doc["provider"] == "apple" and sub.tier == Tier.PLUS and sub.provider == "apple"
    doc, sub = pick_subscription_doc([_doc("stripe", "plus"), _doc("apple", "lite")])
    assert doc["provider"] == "stripe" and sub.tier == Tier.PLUS


def test_expired_provider_never_outranks_a_live_one():
    expired_apple = _doc("apple", "plus", status="expired")
    doc, sub = pick_subscription_doc([expired_apple, _doc("stripe", "lite")])
    assert doc["provider"] == "stripe" and sub.tier == Tier.LITE
    lapsed_apple = _doc("apple", "plus", days=-1)
    doc, sub = pick_subscription_doc([lapsed_apple, _doc("stripe", "standard")])
    assert doc["provider"] == "stripe" and sub.tier == Tier.STANDARD


def test_same_tier_breaks_to_later_expiry_then_to_stripe():
    doc, _ = pick_subscription_doc([_doc("stripe", "lite", days=5), _doc("apple", "lite", days=30)])
    assert doc["provider"] == "apple"
    doc, _ = pick_subscription_doc([_doc("stripe", "lite", days=30), _doc("apple", "lite", days=5)])
    assert doc["provider"] == "stripe"
    same = NOW + timedelta(days=9)
    doc, _ = pick_subscription_doc([
        _doc("apple", "lite", expires_at=same), _doc("stripe", "lite", expires_at=same),
    ])
    assert doc["provider"] == "stripe"


def test_nothing_live_lands_a_store_backed_user_on_statements():
    doc, sub = pick_subscription_doc([
        _doc("apple", "plus", status="expired", updated_days_ago=1),
        _doc("stripe", "lite", status="expired", updated_days_ago=9),
    ])
    assert sub.tier == Tier.STATEMENTS and sub.status == "expired" and sub.has_paid_subscription
    assert doc["provider"] == "apple"  # most recently updated, deterministic


def test_no_documents_is_the_default_tier():
    doc, sub = pick_subscription_doc([])
    assert doc is None and sub.status == "active"


def test_apple_past_due_keeps_tier_until_grace_ends():
    grace = NOW + timedelta(days=3)
    _, sub = pick_subscription_doc([_doc("apple", "standard", status="past_due", days=-2, grace_until=grace)])
    assert sub.tier == Tier.STANDARD and sub.status == "past_due"
    _, sub = pick_subscription_doc([_doc("apple", "standard", status="past_due", days=-2, grace_until=NOW - timedelta(hours=1))])
    assert sub.tier == Tier.STATEMENTS and sub.status == "expired"


def test_get_subscription_reads_every_provider(monkeypatch):
    col = FakeCol([_doc("stripe", "lite"), _doc("apple", "plus")])
    monkeypatch.setattr(collections_module, "subscriptions_col", col)
    assert _run(get_subscription(UID)).tier == Tier.PLUS
    doc, _ = _run(get_subscription_doc(UID))
    assert doc["provider"] == "apple"


def test_legacy_document_without_provider_counts_as_stripe():
    legacy = {"user_id": UID, "tier": "lite", "status": "active", "source": "stripe",
              "stripe_subscription_id": "sub_old", "expires_at": NOW + timedelta(days=4)}
    _, sub = pick_subscription_doc([legacy])
    assert sub.provider == "stripe" and sub.has_paid_subscription


def _stripe_sub(sub_id="sub_new", status="active", price="price_lite"):
    return {
        "id": sub_id, "status": status, "metadata": {"uid": UID}, "created": 1_800_000_000,
        "items": {"data": [{"price": {"id": price}, "current_period_end": int((NOW + timedelta(days=30)).timestamp())}]},
    }


def test_stripe_event_never_overwrites_an_apple_document(monkeypatch):
    apple = _doc("apple", "plus", provider_subscription_id="orig_1")
    col = FakeCol([apple], unique=(("user_id", "provider"),))
    monkeypatch.setattr(collections_module, "subscriptions_col", col)
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", {"lite": "price_lite"})
    result = _run(billing_module._handle_subscription_upsert(_stripe_sub()))
    assert result["handled"] is True
    providers = sorted(d["provider"] for d in col.docs)
    assert providers == ["apple", "stripe"]
    apple_after = next(d for d in col.docs if d["provider"] == "apple")
    assert apple_after["tier"] == "plus" and apple_after["provider_subscription_id"] == "orig_1"
    stripe_after = next(d for d in col.docs if d["provider"] == "stripe")
    assert stripe_after["provider_subscription_id"] == "sub_new" == stripe_after["stripe_subscription_id"]
    # A Stripe cancellation expires only the Stripe document.
    _run(billing_module._handle_subscription_deleted({"id": "sub_new", "metadata": {"uid": UID}}))
    assert next(d for d in col.docs if d["provider"] == "apple")["status"] == "active"
    assert next(d for d in col.docs if d["provider"] == "stripe")["status"] == "expired"


def test_stripe_checkout_guard_ignores_apple_document(monkeypatch):
    col = FakeCol([_doc("apple", "plus")])
    monkeypatch.setattr(collections_module, "subscriptions_col", col)
    # No Stripe document: Stripe's own duplicate guard has nothing to refuse.
    _run(billing_module._validate_subscription_checkout(UID, True))


def _load_migration():
    path = Path(__file__).resolve().parent.parent / "scripts" / "migrate_subscriptions_provider.py"
    spec = importlib.util.spec_from_file_location("migrate_subscriptions_provider", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_migration_is_dry_run_by_default_and_idempotent():
    mig = _load_migration()
    docs = [
        {"_id": 1, "user_id": "a", "stripe_subscription_id": "sub_a", "source": "stripe"},
        {"_id": 2, "user_id": "b", "tier": "plus", "managed_by": "manual"},
        {"_id": 3, "user_id": "c", "provider": "apple", "source": "apple"},
    ]
    col = FakeCol(docs)
    dry = _run(mig.migrate(col, apply=False))
    assert dry == {"documents": 3, "already_migrated": 1, "provider_stamped": 2, "provider_subscription_id_copied": 1}
    assert all(d.get("provider") != "stripe" for d in col.docs)  # nothing written
    applied = _run(mig.migrate(col, apply=True))
    assert applied["provider_stamped"] == 2
    assert col.docs[0]["provider"] == "stripe" and col.docs[0]["provider_subscription_id"] == "sub_a"
    assert col.docs[0]["stripe_subscription_id"] == "sub_a"  # alias kept
    assert col.docs[1]["provider"] == "stripe" and "provider_subscription_id" not in col.docs[1]
    assert col.docs[2]["provider"] == "apple"
    again = _run(mig.migrate(col, apply=True))
    assert again["provider_stamped"] == 0 and again["already_migrated"] == 3


def test_google_is_a_provider_and_ranks_after_apple_and_stripe_on_a_tie():
    same = NOW + timedelta(days=9)
    docs = [_doc("google", "lite", expires_at=same), _doc("apple", "lite", expires_at=same)]
    doc, sub = pick_subscription_doc(docs)
    assert doc["provider"] == "apple" and sub.has_paid_subscription
    doc, _ = pick_subscription_doc(docs + [_doc("stripe", "lite", expires_at=same)])
    assert doc["provider"] == "stripe"
    doc, sub = pick_subscription_doc([_doc("google", "plus"), _doc("stripe", "lite")])
    assert doc["provider"] == "google" and sub.provider == "google" and sub.tier == Tier.PLUS
