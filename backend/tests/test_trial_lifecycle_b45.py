"""B45: trial on every plan, webhook lifecycle, failed-payment grace,
landing on Statements with sync paused, and the consent-revoke flag.

Builds on tests/test_billing.py's fakes. No network, no real Stripe."""
from datetime import datetime, timedelta, timezone

import pytest

import app.core.config as config_module
import app.core.push as push_module
import app.core.subscription as sub_module
import app.db.collections as db_collections_module
import app.services.billing as billing_module
import app.services.billing_lifecycle as lifecycle_module
import app.workers.sync_worker as sync_worker
from tests.test_billing import (
    UID, _FULL_PRICE_IDS, _FakeCol, _make_fake_stripe, _patch_billing_enabled,
    _patch_collections, _run,
)

NOW = datetime.now(timezone.utc)


def _ts(days):
    return int((NOW + timedelta(days=days)).timestamp())


def _sub_event(eid, status, *, days_to_end=30, price="price_standard", sub_id="sub_1", **extra):
    obj = {
        "id": sub_id, "customer": "cus_1", "status": status, "metadata": {"uid": UID},
        "items": {"data": [{"price": {"id": price}, "current_period_end": _ts(days_to_end)}]},
    }
    obj.update(extra)
    return {"id": eid, "type": "customer.subscription.updated", "data": {"object": obj}}


def _invoice_event(eid, etype, *, amount_paid=0, days_to_end=30, sub_id="sub_1"):
    return {"id": eid, "type": etype, "data": {"object": {
        "customer": "cus_1", "metadata": {"uid": UID}, "amount_paid": amount_paid,
        "parent": {"subscription_details": {"subscription": sub_id}},
        "lines": {"data": [{"period": {"end": _ts(days_to_end)}}]},
    }}}


@pytest.fixture
def env(monkeypatch):
    subs = _FakeCol()
    _patch_collections(monkeypatch, billing_events_col=_FakeCol(), subscriptions_col=subs,
                       billing_customers_col=_FakeCol([{"user_id": UID, "stripe_customer_id": "cus_1"}]),
                       finexer_consents_col=_FakeCol())
    monkeypatch.setattr(billing_module, "STRIPE_PRICE_IDS", _FULL_PRICE_IDS)
    monkeypatch.setattr(config_module, "DEFAULT_TIER", "max")
    pushes = []

    async def _push(user_id, title, body, url="/"):
        pushes.append({"user_id": user_id, "title": title, "body": body, "url": url})
        return {}

    monkeypatch.setattr(push_module, "send_push_to_user", _push)
    return subs, pushes


def _feed(event):
    return _run(billing_module.handle_event(event))["result"]


# ── a. trial on every plan and period ─────────────────────────────────────

def test_trial_periods_cover_every_offered_period():
    assert tuple(sub_module.SUBSCRIPTION_TRIAL_PERIODS) == tuple(sub_module.SUBSCRIPTION_PERIODS_ENABLED)
    assert {"monthly", "six_months", "annual"} <= set(sub_module.SUBSCRIPTION_TRIAL_PERIODS)


@pytest.mark.parametrize("tier", ["lite", "standard", "connect", "max"])
@pytest.mark.parametrize("period", ["monthly", "six_months", "annual"])
def test_checkout_trial_requires_card_for_every_tier_and_period(monkeypatch, tier, period):
    fake = _make_fake_stripe()
    monkeypatch.setattr(billing_module, "stripe", fake)
    monkeypatch.setattr(billing_module, "STRIPE_SECRET_KEY", "sk_test_x")
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, billing_customers_col=_FakeCol(), subscriptions_col=_FakeCol())
    _run(billing_module.create_checkout_session(
        UID, kind="subscription", target=tier, billing_period=period, trial=True,
        success_url="https://app/s", cancel_url="https://app/c",
    ))
    call = fake.checkout_calls[0]
    assert call["payment_method_collection"] == "always"
    assert call["subscription_data"]["trial_period_days"] == 14
    assert call["subscription_data"]["trial_settings"] == {"end_behavior": {"missing_payment_method": "cancel"}}


def test_trial_still_one_per_person(monkeypatch):
    _patch_billing_enabled(monkeypatch, True, price_ids=_FULL_PRICE_IDS)
    _patch_collections(monkeypatch, subscriptions_col=_FakeCol([{
        "user_id": UID, "status": "expired", "trial_used_at": NOW - timedelta(days=60),
    }]))
    with pytest.raises(billing_module.BillingError, match="already been used"):
        _run(billing_module.create_checkout_session(
            UID, kind="subscription", target="lite", billing_period="monthly", trial=True,
            success_url="https://app/s", cancel_url="https://app/c",
        ))


def _trial_checkout_allowed(subs_doc):
    return _run(billing_module.trial_eligible(UID))


def test_b47_reset_marker_makes_ended_doc_eligible_and_new_trial_ends_it(env):
    """Real B47 rule (merged into this branch): a reset marker makes a
    non-live document eligible again, and a trial used after the reset makes
    it ineligible again. The webhook preserves the marker and re-stamps
    trial_used_at."""
    subs, _ = env
    reset_at = NOW - timedelta(hours=1)
    subs.docs.append({"user_id": UID, "tier": "standard", "status": "expired", "source": "stripe",
                      "stripe_subscription_id": "sub_old", "trial_used_at": NOW - timedelta(days=60),
                      "trial_reset_at": reset_at})
    assert _run(billing_module.trial_eligible(UID)) is True
    _feed(_sub_event("e_new_trial", "trialing", days_to_end=14, trial_start=int(NOW.timestamp()),
                     trial_end=_ts(14), sub_id="sub_new", created=int(NOW.timestamp())))
    doc = subs.docs[0]
    assert doc["trial_reset_at"] == reset_at
    assert doc["trial_used_at"] > reset_at
    assert doc["status"] == "trialing" and doc["stripe_subscription_id"] == "sub_new"
    # the new trial ends; the marker no longer helps
    _feed({"id": "e_del", "type": "customer.subscription.deleted",
           "data": {"object": {"id": "sub_new", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert _run(billing_module.trial_eligible(UID)) is False


# ── b. webhook lifecycle ──────────────────────────────────────────────────

def test_trial_start_then_conversion_then_renewal(env):
    subs, _ = env
    _feed(_sub_event("e1", "trialing", days_to_end=14, trial_start=int(NOW.timestamp()), trial_end=_ts(14)))
    assert subs.docs[0]["status"] == "trialing"
    # the trial's zero-amount opening invoice must not convert it
    assert _feed(_invoice_event("e2", "invoice.paid", amount_paid=0))["handled"] is False
    assert subs.docs[0]["status"] == "trialing"
    # first real charge: conversion
    res = _feed(_invoice_event("e3", "invoice.paid", amount_paid=999, days_to_end=30))
    assert res["handled"] is True
    assert subs.docs[0]["status"] == "active"
    first_end = subs.docs[0]["expires_at"]
    # renewal extends the period
    _feed(_invoice_event("e4", "invoice.paid", amount_paid=999, days_to_end=60))
    assert subs.docs[0]["expires_at"] > first_end


def test_invoice_paid_for_other_subscription_is_ignored(env):
    subs, _ = env
    _feed(_sub_event("e1", "active"))
    res = _feed(_invoice_event("e2", "invoice.paid", amount_paid=500, sub_id="sub_other", days_to_end=90))
    assert res["handled"] is False


def test_payment_failed_grace_notice_once_and_access_kept(env):
    subs, pushes = env
    _feed(_sub_event("e1", "active", days_to_end=-1))  # period just ended, renewal unpaid
    res = _feed(_invoice_event("e2", "invoice.payment_failed"))
    assert res["notified"] == "payment_failed"
    doc = subs.docs[0]
    assert doc["status"] == "past_due"
    assert doc["grace_until"] > NOW
    # access kept through grace even though expires_at has passed
    sub = _run(sub_module.get_subscription(UID))
    assert sub.status == "past_due" and sub.tier == sub_module.Tier.STANDARD
    assert sub.grace_until is not None
    # a Stripe retry failing again, and the matching subscription.updated, must not re-notify
    _feed(_invoice_event("e3", "invoice.payment_failed"))
    _feed(_sub_event("e4", "past_due", days_to_end=-1))
    assert len(pushes) == 1
    assert pushes[0]["title"] == "Payment didn't go through"
    assert "!" not in pushes[0]["body"] and "—" not in pushes[0]["body"]


def test_subscription_updated_to_past_due_also_starts_grace(env):
    subs, pushes = env
    _feed(_sub_event("e1", "past_due", days_to_end=-1))
    assert subs.docs[0]["grace_until"] is not None
    assert len(pushes) == 1


def test_grace_ends_and_user_lands_on_statements(env):
    subs, _ = env
    _feed(_sub_event("e1", "past_due", days_to_end=-1))
    subs.docs[0]["grace_until"] = NOW - timedelta(minutes=1)
    sub = _run(sub_module.get_subscription(UID))
    assert sub.status == "expired" and sub.tier == sub_module.Tier.STATEMENTS


def test_payment_recovered_clears_grace(env):
    subs, _ = env
    _feed(_sub_event("e1", "past_due", days_to_end=-1))
    _feed(_invoice_event("e2", "invoice.paid", amount_paid=999, days_to_end=30))
    assert subs.docs[0]["status"] == "active"
    assert "grace_until" not in subs.docs[0] and "past_due_since" not in subs.docs[0]


@pytest.mark.parametrize("stripe_status", ["canceled", "unpaid"])
def test_ended_statuses_land_on_statements_not_default_tier(env, stripe_status):
    subs, _ = env
    _feed(_sub_event("e1", stripe_status))
    assert subs.docs[0]["status"] == "expired"
    sub = _run(sub_module.get_subscription(UID))
    assert sub.tier == sub_module.Tier.STATEMENTS  # DEFAULT_TIER is "max" here


def test_subscription_deleted_lands_on_statements_and_keeps_data(env):
    subs, _ = env
    _feed(_sub_event("e1", "active"))
    res = _feed({"id": "e2", "type": "customer.subscription.deleted",
                 "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert res["handled"] is True
    assert subs.docs[0]["status"] == "expired"
    assert res["landed_on_statements"] == {"revoke": "off"}
    assert _run(sub_module.open_banking_paused(UID)) is True


def test_deleted_event_for_superseded_subscription_is_ignored(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_new"))
    res = _feed({"id": "e2", "type": "customer.subscription.deleted",
                 "data": {"object": {"id": "sub_old", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert res["handled"] is False
    assert subs.docs[0]["status"] == "active"


def test_cancel_at_period_end_keeps_access_and_records_flag(env):
    subs, _ = env
    _feed(_sub_event("e1", "trialing", days_to_end=14, cancel_at_period_end=True, trial_end=_ts(14)))
    doc = subs.docs[0]
    assert doc["cancel_at_period_end"] is True and doc["status"] == "trialing"
    sub = _run(sub_module.get_subscription(UID))
    assert sub.cancel_at_period_end is True and sub.tier == sub_module.Tier.STANDARD
    assert _run(sub_module.open_banking_paused(UID)) is False


def test_cancel_at_timestamp_counts_as_ending(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", cancel_at=_ts(10)))
    assert subs.docs[0]["cancel_at_period_end"] is True


def test_trial_will_end_reminds_once_through_either_path(env):
    subs, pushes = env
    _feed(_sub_event("e1", "trialing", days_to_end=3, billing_period="monthly", trial_end=_ts(3)))
    ev = {"id": "e2", "type": "customer.subscription.trial_will_end",
          "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}}
    res = _feed(ev)
    assert res["notified"] is True and len(pushes) == 1
    assert pushes[0]["title"] == "Your free trial ends soon"
    assert "!" not in pushes[0]["body"] and "—" not in pushes[0]["body"]
    assert subs.docs[0]["trial_reminder_sent_at"] is not None
    # a second delivery (new event id) and the daily cron both stay quiet
    _feed({**ev, "id": "e3"})
    assert len(pushes) == 1


def test_trial_will_end_ignored_when_not_trialing(env):
    _feed(_sub_event("e1", "active"))
    res = _feed({"id": "e2", "type": "customer.subscription.trial_will_end",
                 "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert res["handled"] is False


def test_webhook_events_are_idempotent_by_event_id(env):
    subs, pushes = env
    ev = _sub_event("e_dup", "past_due", days_to_end=-1)
    _feed(ev)
    first = dict(subs.docs[0])
    again = _run(billing_module.handle_event(ev))
    assert again["idempotent"] is True
    assert len(pushes) == 1 and subs.docs[0]["grace_until"] == first["grace_until"]


def test_resubscribe_reenables_open_banking(env):
    subs, _ = env
    _feed(_sub_event("e1", "canceled", sub_id="sub_old"))
    assert _run(sub_module.open_banking_paused(UID)) is True
    _feed(_sub_event("e2", "trialing", days_to_end=14, sub_id="sub_new", trial_end=_ts(14)))
    assert _run(sub_module.open_banking_paused(UID)) is False
    assert _run(sub_module.get_subscription(UID)).tier == sub_module.Tier.STANDARD


# ── c. sync pause and consent revoke ──────────────────────────────────────

def test_open_banking_paused_by_tier(env):
    subs, _ = env
    subs.docs.append({"user_id": UID, "tier": "statements", "status": "active"})
    assert _run(sub_module.open_banking_paused(UID)) is True
    subs.docs[0]["tier"] = "lite"
    assert _run(sub_module.open_banking_paused(UID)) is False


def test_open_banking_paused_fails_open(monkeypatch):
    async def boom(_):
        raise RuntimeError("db down")
    monkeypatch.setattr(sub_module, "get_subscription", boom)
    assert _run(sub_module.open_banking_paused(UID)) is False


def test_worker_sync_tasks_skip_paused_users(env, monkeypatch):
    subs, _ = env
    subs.docs.append({"user_id": UID, "tier": "statements", "status": "active"})
    called = []

    async def _never(*a, **k):
        called.append(a)
        return {}

    monkeypatch.setattr(sync_worker, "finexer_sync_pipeline", _never)
    monkeypatch.setattr(sync_worker, "sync_connection", _never)
    monkeypatch.setattr(sync_worker, "sync_yapily_consent", _never)
    for coro in (
        sync_worker.task_sync_finexer({}, "c1", UID),
        sync_worker.task_sync_truelayer({}, "c1", UID),
        sync_worker.task_sync_yapily({}, "t1", UID),
    ):
        assert _run(coro) == {"skipped": "open_banking_paused"}
    assert called == []


def test_worker_sync_runs_for_a_paid_user(env, monkeypatch):
    subs, _ = env
    subs.docs.append({"user_id": UID, "tier": "lite", "status": "active"})
    called = []

    async def _fx(consent_id, user_id, **k):
        called.append(consent_id)
        return {"new_transactions": 0}

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(sync_worker, "finexer_sync_pipeline", _fx)
    monkeypatch.setattr(sync_worker, "_enqueue_weekly_insight_refresh", _noop)
    monkeypatch.setattr(sync_worker, "_warm_after_sync", _noop)
    _run(sync_worker.task_sync_finexer({}, "c1", UID))
    assert called == ["c1"]


def test_manual_sync_is_a_noop_when_paused(env):
    import app.routers.accounts as accounts_router
    subs, _ = env
    subs.docs.append({"user_id": UID, "tier": "statements", "status": "active"})
    res = _run(accounts_router.sync_all({"email": UID}))
    assert res["paused"] is True and res["connections"] == 0


class _Consents(_FakeCol):
    def find(self, filt=None, proj=None):
        outer = self

        class _C:
            async def to_list(self, n):
                return [d for d in outer.docs if all(d.get(k) == v for k, v in (filt or {}).items())]
        return _C()


def _fake_finexer_client(deleted):
    class _Resp:
        status_code = 200

        def json(self):
            return {"status": "canceled"}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, path):
            assert path.endswith("/revoke"), path
            deleted.append(path[: -len("/revoke")])
            return _Resp()
    return lambda: _Client()


def test_revoke_flag_default_is_off():
    assert config_module.REVOKE_CONSENT_ON_DOWNGRADE is False


def test_revoke_flag_off_leaves_consent_authorised(env, monkeypatch):
    consents = _Consents([{"_id": "fx1-consent", "user_id": UID, "status": "authorized"}])
    _patch_collections(monkeypatch, finexer_consents_col=consents)
    deleted = []
    import app.services.finexer_sync as fx
    monkeypatch.setattr(fx, "_client", _fake_finexer_client(deleted))
    monkeypatch.setattr(config_module, "REVOKE_CONSENT_ON_DOWNGRADE", False)
    _feed(_sub_event("e1", "active"))
    _feed({"id": "e2", "type": "customer.subscription.deleted",
           "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert deleted == [] and consents.docs[0]["status"] == "authorized"


def test_revoke_flag_on_revokes_consent_at_downgrade(env, monkeypatch):
    consents = _Consents([{"_id": "fx1-consent", "user_id": UID, "status": "authorized"},
                          {"_id": "fx2-consent", "user_id": "someone@else", "status": "authorized"}])
    _patch_collections(monkeypatch, finexer_consents_col=consents)
    deleted = []
    import app.services.finexer_sync as fx
    monkeypatch.setattr(fx, "_client", _fake_finexer_client(deleted))
    monkeypatch.setattr(config_module, "REVOKE_CONSENT_ON_DOWNGRADE", True)
    _feed(_sub_event("e1", "active"))
    res = _feed({"id": "e2", "type": "customer.subscription.deleted",
                 "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert deleted == ["/consents/fx1-consent"]
    assert consents.docs[0]["status"] == "revoked" and consents.docs[1]["status"] == "authorized"
    assert res["landed_on_statements"]["revoked"] == 1


def test_trial_reminder_copy_rules():
    doc = {"tier": "standard", "billing_period": "monthly", "trial_ends_at": NOW + timedelta(days=2)}
    title, body = lifecycle_module.trial_reminder_copy(doc)
    assert "£" in body and "!" not in body and "—" not in body
    assert lifecycle_module.trial_reminder_copy({"tier": "standard"}) is None


def test_trial_will_end_skips_reminder_when_already_cancelled(env):
    subs, pushes = env
    _feed(_sub_event("e1", "trialing", days_to_end=3, billing_period="monthly", trial_end=_ts(3),
                     cancel_at_period_end=True))
    res = _feed({"id": "e2", "type": "customer.subscription.trial_will_end",
                 "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert res["notified"] is False and pushes == []


def test_trial_eligible_true_for_new_user_false_after_trial(env):
    subs, _ = env
    assert _run(billing_module.trial_eligible(UID)) is True
    _feed(_sub_event("e1", "trialing", days_to_end=14, trial_end=_ts(14), trial_start=int(NOW.timestamp())))
    _feed({"id": "e2", "type": "customer.subscription.deleted",
           "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    assert _run(billing_module.trial_eligible(UID)) is False


# ── review round: ordering hardening ──────────────────────────────────────

def _failed(eid, sub_id="sub_1"):
    ev = _invoice_event(eid, "invoice.payment_failed", sub_id=sub_id)
    return ev


def test_late_payment_failed_cannot_revive_an_expired_doc(env):
    subs, pushes = env
    _feed(_sub_event("e1", "active"))
    _feed({"id": "e2", "type": "customer.subscription.deleted",
           "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    res = _feed(_failed("e3"))
    assert res["handled"] is False
    assert subs.docs[0]["status"] == "expired" and "grace_until" not in subs.docs[0]
    assert _run(sub_module.get_subscription(UID)).tier == sub_module.Tier.STATEMENTS
    assert pushes == []


def test_payment_failed_for_superseded_subscription_is_ignored(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_new"))
    res = _feed(_failed("e2", sub_id="sub_old"))
    assert res["handled"] is False and subs.docs[0]["status"] == "active"


def test_payment_failed_for_one_off_invoice_is_ignored(env):
    subs, _ = env
    _feed(_sub_event("e1", "active"))
    ev = {"id": "e2", "type": "invoice.payment_failed", "data": {"object": {
        "customer": "cus_1", "metadata": {"uid": UID}, "lines": {"data": []}}}}
    assert _feed(ev)["handled"] is False and subs.docs[0]["status"] == "active"


def test_late_subscription_updated_cannot_reactivate_a_cancelled_doc(env):
    subs, _ = env
    _feed(_sub_event("e1", "active"))
    _feed({"id": "e2", "type": "customer.subscription.deleted",
           "data": {"object": {"id": "sub_1", "customer": "cus_1", "metadata": {"uid": UID}}}})
    res = _feed(_sub_event("e3", "active"))
    assert res["handled"] is False and subs.docs[0]["status"] == "expired"


def test_incomplete_then_active_same_subscription_still_activates(env):
    subs, _ = env
    _feed(_sub_event("e1", "incomplete"))
    assert subs.docs[0]["status"] == "expired"
    _feed(_sub_event("e2", "active"))
    assert subs.docs[0]["status"] == "active"


def test_older_subscription_update_cannot_overwrite_newer_one(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_new", created=2000))
    res = _feed(_sub_event("e2", "canceled", sub_id="sub_old", created=1000))
    assert res["handled"] is False and subs.docs[0]["status"] == "active"
    assert subs.docs[0]["stripe_subscription_id"] == "sub_new"


def test_newer_subscription_replaces_live_one(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_a", created=1000))
    _feed(_sub_event("e2", "active", sub_id="sub_b", created=2000))
    assert subs.docs[0]["stripe_subscription_id"] == "sub_b"


def test_unresolvable_uid_logs_a_warning(env, caplog):
    import logging
    with caplog.at_level(logging.WARNING, logger="app.services.billing"):
        res = _feed({"id": "e1", "type": "invoice.paid",
                     "data": {"object": {"customer": "cus_unknown", "metadata": {}}}})
    assert res["handled"] is False
    assert any("resolved no uid" in r.message for r in caplog.records)


def test_payment_failed_body_states_grace_days_from_config(monkeypatch):
    monkeypatch.setattr(config_module, "BILLING_PAST_DUE_GRACE_DAYS", 5)
    assert "next 5 days" in lifecycle_module.payment_failed_body()


# ── review round: more sync guards and fail-closed ────────────────────────

def test_sync_history_and_yapily_sync_are_noops_when_paused(env):
    import app.routers.accounts as accounts_router
    import app.routers.yapily as yapily_router
    subs, _ = env
    subs.docs.append({"user_id": UID, "tier": "statements", "status": "active"})
    assert _run(accounts_router.sync_history({"email": UID}))["paused"] is True
    assert _run(yapily_router.yapily_sync_all({"email": UID}))["paused"] is True


def test_fail_closed_flag_both_ways(monkeypatch):
    async def boom(_):
        raise RuntimeError("db down")
    monkeypatch.setattr(sub_module, "get_subscription", boom)
    assert _run(sub_module.open_banking_paused(UID)) is False
    assert _run(sub_module.open_banking_paused(UID, fail_closed=True)) is True


def test_worker_tasks_fail_closed_on_lookup_error(monkeypatch):
    async def boom(_):
        raise RuntimeError("db down")
    monkeypatch.setattr(sub_module, "get_subscription", boom)
    called = []

    async def _never(*a, **k):
        called.append(1)
        return {}

    monkeypatch.setattr(sync_worker, "finexer_sync_pipeline", _never)
    assert _run(sync_worker.task_sync_finexer({}, "c1", UID)) == {"skipped": "open_banking_paused"}
    assert called == []


def test_daily_trial_reminder_skips_cancelled_trials(monkeypatch):
    from tests.test_trial_reminder import FakeCol as ReminderCol
    naive_now = datetime.utcnow()  # naive-ok: test fixture, Mongo-style naive UTC
    docs = [
        {"user_id": "a@x.com", "tier": "standard", "status": "trialing", "billing_period": "monthly",
         "trial_ends_at": naive_now + timedelta(days=2), "cancel_at_period_end": True},
        {"user_id": "b@x.com", "tier": "standard", "status": "trialing", "billing_period": "monthly",
         "trial_ends_at": naive_now + timedelta(days=2)},
    ]
    monkeypatch.setattr(sync_worker, "subscriptions_col", ReminderCol(docs))
    sent = []

    async def _push(uid, title, body, url="/"):
        sent.append(uid)
        return {}

    monkeypatch.setattr(sync_worker, "send_push_to_user", _push)
    assert _run(sync_worker.task_trial_reminder({}))["sent"] == 1
    assert sent == ["b@x.com"]


# ── re-review: ended_subscription_id ──────────────────────────────────────

def _deleted(eid, sub_id):
    return {"id": eid, "type": "customer.subscription.deleted",
            "data": {"object": {"id": sub_id, "customer": "cus_1", "metadata": {"uid": UID}}}}


def test_resubscribe_arriving_as_incomplete_then_active_activates(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_old", created=1000))
    _feed(_deleted("e2", "sub_old"))
    _feed(_sub_event("e3", "incomplete", sub_id="sub_new", created=2000))
    assert subs.docs[0]["stripe_subscription_id"] == "sub_new"
    _feed(_sub_event("e4", "active", sub_id="sub_new", created=2000))
    assert subs.docs[0]["status"] == "active"
    assert "ended_at" not in subs.docs[0]
    assert _run(sub_module.open_banking_paused(UID)) is False


def test_late_active_update_for_old_ended_id_is_ignored_even_after_new_incomplete(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_old", created=1000))
    _feed(_deleted("e2", "sub_old"))
    assert _feed(_sub_event("e3", "active", sub_id="sub_old", created=1000))["handled"] is False
    _feed(_sub_event("e4", "incomplete", sub_id="sub_new", created=2000))
    assert _feed(_sub_event("e5", "active", sub_id="sub_old"))["handled"] is False  # no created at all
    assert subs.docs[0]["stripe_subscription_id"] == "sub_new" and subs.docs[0]["status"] == "expired"


def test_late_deleted_for_old_id_does_not_touch_new_incomplete_doc(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_old", created=1000))
    _feed(_sub_event("e2", "incomplete", sub_id="sub_new", created=2000))
    before = dict(subs.docs[0])
    assert _feed(_deleted("e3", "sub_old"))["handled"] is False
    assert subs.docs[0]["stripe_subscription_id"] == "sub_new"
    assert subs.docs[0].get("ended_subscription_id") == before.get("ended_subscription_id")
    _feed(_sub_event("e4", "active", sub_id="sub_new", created=2000))
    assert subs.docs[0]["status"] == "active"


def test_invoice_paid_activates_incomplete_new_subscription_after_old_ended(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_old", created=1000))
    _feed(_deleted("e2", "sub_old"))
    _feed(_sub_event("e3", "incomplete", sub_id="sub_new", created=2000))
    res = _feed(_invoice_event("e4", "invoice.paid", amount_paid=999, sub_id="sub_new", days_to_end=30))
    assert res["handled"] is True and subs.docs[0]["status"] == "active"
    assert "ended_at" not in subs.docs[0]
    assert _run(sub_module.open_banking_paused(UID)) is False


# ── final check: ended-id list ────────────────────────────────────────────

def test_late_invoice_paid_for_ended_subscription_stays_expired(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_old", created=1000))
    _feed(_deleted("e2", "sub_old"))
    res = _feed(_invoice_event("e3", "invoice.paid", amount_paid=999, sub_id="sub_old", days_to_end=30))
    assert res["handled"] is False and subs.docs[0]["status"] == "expired"
    assert _run(sub_module.open_banking_paused(UID)) is True


def test_deleted_new_before_created_new_then_active_new_stays_expired(env):
    subs, _ = env
    _feed(_sub_event("e1", "active", sub_id="sub_old", created=1000))
    _feed(_deleted("e2", "sub_old"))
    # the NEW subscription's deleted arrives first, while the stored doc is still the old id
    assert _feed(_deleted("e3", "sub_new"))["handled"] is False
    assert "sub_new" in subs.docs[0]["ended_subscription_ids"]
    _feed(_sub_event("e4", "active", sub_id="sub_new", created=2000))
    assert subs.docs[0]["status"] == "expired"
    assert _run(sub_module.open_banking_paused(UID)) is True


def test_ended_ids_list_is_capped_and_keeps_legacy_single_field():
    from app.services.billing import _ended_ids, _with_ended
    ids = _with_ended({"ended_subscription_ids": [f"s{i}" for i in range(20)]}, "s_new")
    assert len(ids) == 20 and ids[-1] == "s_new" and "s0" not in ids
    assert _ended_ids({"ended_subscription_id": "legacy"}) == ["legacy"]
