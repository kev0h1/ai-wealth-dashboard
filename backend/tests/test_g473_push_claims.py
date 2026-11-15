"""G473: each notification is sent once even when syncs overlap, one native push
registration per app install, and move pushes/cards name the bank account, not
the account holder. All names here are invented."""
import asyncio
from types import SimpleNamespace

import pytest

import app.db.collections as collections
import app.routers.push as push_router
import app.services.companion as companion
import app.services.notifications as notifications
import app.services.spend_verdict as spend_verdict

from tests import test_g359_steady_salary as g359
from tests.test_notifications import (
    FakeStateCol, _notable, _patch_classification, _patch_common, _txn, _verdict, _move_item, _bill,
)

UID = "tester@example.test"


def _patch_send(monkeypatch, *, result=None, raises=None):
    """Replace the push sender with a recorder that yields to the loop first, so
    two gathered runs genuinely interleave around the send."""
    sent = []

    async def fake_send(user_id, title, body, url="/"):
        await asyncio.sleep(0)
        if raises:
            raise raises
        sent.append({"user_id": user_id, "title": title, "body": body, "url": url})
        return result if result is not None else {"fcm": {"attempted": 1, "delivered": 1}}

    monkeypatch.setattr(notifications, "send_push_to_user", fake_send)
    return sent


class _YieldingState(FakeStateCol):
    """Yields between a read and the caller's later write, as real Mongo IO does."""

    async def find_one(self, query, *args, **kwargs):
        doc = await super().find_one(query, *args, **kwargs)
        snapshot = None if doc is None else {k: (dict(v) if isinstance(v, dict) else v) for k, v in doc.items()}
        await asyncio.sleep(0)
        return snapshot


def _two(coro_fn):
    async def both():
        return await asyncio.gather(coro_fn(), coro_fn())
    return asyncio.run(both())


# ── 1. atomic claims ────────────────────────────────────────────────────────

def test_claim_push_is_exclusive_and_releasable(monkeypatch):
    monkeypatch.setattr(notifications, "notification_state_col", FakeStateCol({}))

    async def go():
        assert await notifications.claim_push("u", "a.b:c") is True
        assert await notifications.claim_push("u", "a.b:c") is False
        assert await notifications.claim_push("u", "other") is True
        await notifications.release_push_claim("u", "a.b:c")
        assert await notifications.claim_push("u", "a.b:c") is True

    asyncio.run(go())


def test_category_pace_concurrent_runs_send_once(monkeypatch):
    state, _ = _patch_common(monkeypatch, state_docs={})
    sent = _patch_send(monkeypatch)

    async def verdict(uid):
        await asyncio.sleep(0)
        return _verdict([_notable("Dining", multiple=2.0, excess=80.0)])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", verdict)
    _two(lambda: notifications._maybe_category_pace("u"))
    assert len(sent) == 1
    assert sent[0]["title"] == "Dining is running hot"
    assert state.docs["u"]["category_pace"]["2026-08-01"] == ["Dining"]


def test_category_pace_failed_send_releases_claim_and_retries(monkeypatch):
    state, _ = _patch_common(monkeypatch, state_docs={})
    sent = _patch_send(monkeypatch, raises=RuntimeError("fcm down"))

    async def verdict(uid):
        return _verdict([_notable("Dining")])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", verdict)
    asyncio.run(notifications._maybe_category_pace("u"))
    assert sent == []
    assert "category_pace" not in state.docs.get("u", {})
    # Next run (send healthy again) goes out: the claim was given back.
    sent2 = _patch_send(monkeypatch)
    asyncio.run(notifications._maybe_category_pace("u"))
    assert len(sent2) == 1


def test_all_devices_failing_releases_claim(monkeypatch):
    state, _ = _patch_common(monkeypatch, state_docs={})
    failing = {"fcm": {"attempted": 2, "delivered": 0, "failed": 2}, "apns": {"attempted": 0, "delivered": 0}}
    sent = _patch_send(monkeypatch, result=failing)

    async def verdict(uid):
        return _verdict([_notable("Dining")])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", verdict)
    asyncio.run(notifications._maybe_category_pace("u"))
    assert len(sent) == 1  # attempted once, then the claim is released
    sent2 = _patch_send(monkeypatch)
    asyncio.run(notifications._maybe_category_pace("u"))
    assert len(sent2) == 1


def test_no_devices_keeps_the_claim(monkeypatch):
    _patch_common(monkeypatch, state_docs={})
    empty = {"fcm": {"attempted": 0, "delivered": 0}}
    sent = _patch_send(monkeypatch, result=empty)

    async def verdict(uid):
        return _verdict([_notable("Dining")])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", verdict)
    asyncio.run(notifications._maybe_category_pace("u"))
    asyncio.run(notifications._maybe_category_pace("u"))
    assert len(sent) == 1


def test_money_movement_bill_move_and_plan_concurrent_runs_send_once(monkeypatch):
    state, _ = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(notifications, "notification_state_col", _YieldingState({}))
    sent = _patch_send(monkeypatch)
    import app.routers.analytics as analytics

    monkeypatch.setattr(collections, "cashflow_cache_col", SimpleNamespace(find_one=_async_value({"_id": "u"})))

    async def fake_resp(cached):
        return {"upcoming_bills": [_bill("Water", 2, 40.0, 10.0, "acc-1")]}

    async def fake_items(uid, persist=True, account_eligibility_out=None, **kw):
        await asyncio.sleep(0)
        if account_eligibility_out is not None:
            account_eligibility_out.update({"acc-2": {
                "after_payments": 40.0, "plans_reserved": 127.0, "after_payments_and_plans": -86.0,
                "low_point": 40.0, "uncertain": False, "estimated": False}})
        return [_move_item("plan:fp9", account_id="acc-3", name="Everyday")]

    async def label(account_id):
        return "Everyday", "NatWest"

    async def tokens(uid):
        return []

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)
    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(notifications, "_plan_shortfall_label", label)
    monkeypatch.setattr(notifications, "_user_name_tokens", tokens)

    _two(lambda: notifications._maybe_money_movement("u"))
    # one bill push (merged with the move), one plan push; nothing twice
    assert len(sent) == len({(s["title"], s["body"]) for s in sent})
    assert len([s for s in sent if s["title"] == "Short for plans"]) == 1
    assert len([s for s in sent if s["title"] == "Bill may not clear"]) == 1


def _async_value(value):
    async def f(*a, **k):
        return value
    return f


def test_classification_concurrent_runs_send_once(monkeypatch):
    state, _sent, txn_col, _ = _patch_classification(
        monkeypatch, txns=[_txn("t1", category="Other")], state_docs={"kevin": {"classification_seen": ["t0"]}},
    )
    sent = _patch_send(monkeypatch)
    _two(lambda: notifications._maybe_classification_attention("kevin"))
    assert len(sent) == 1


def test_goal_funded_concurrent_runs_send_once(monkeypatch):
    state, _ = _patch_common(monkeypatch, state_docs={})
    sent = _patch_send(monkeypatch)
    import app.routers.savings as savings

    monkeypatch.setattr(notifications, "savings_goals_col", SimpleNamespace(find_one=_async_value({"_id": "u"})))

    async def cashflow(uid, cutoff):
        return 0, 1000.0, 0

    async def current(uid, goal):
        return 5000.0

    monkeypatch.setattr(savings, "_cashflow", cashflow)
    monkeypatch.setattr(savings, "_target_amount", lambda goal, spend: 3000.0)
    monkeypatch.setattr(savings, "_current_savings", current)
    _two(lambda: notifications._maybe_goal_funded("u"))
    assert len(sent) == 1 and sent[0]["title"] == "Savings goal reached"


def test_new_transactions_concurrent_same_batch_send_once(monkeypatch):
    _patch_common(monkeypatch, state_docs={})
    calls = []

    async def fake_notify(user_id, txns):
        await asyncio.sleep(0)
        calls.append(len(txns))
        return {"fcm": {"attempted": 1, "delivered": 1}}

    monkeypatch.setattr(notifications, "notify_new_transactions", fake_notify)
    batch = [{"_id": "t1", "amount": 3}, {"_id": "t2", "amount": 4}]
    _two(lambda: notifications._maybe_transactions("u", batch))
    assert calls == [2]


def test_period_digest_concurrent_runs_send_once(monkeypatch):
    from datetime import date as _d
    import app.routers.goals as goals_module

    state, _ = _patch_common(monkeypatch, state_docs={})
    sent = _patch_send(monkeypatch)
    today = _d(2026, 11, 1)
    monkeypatch.setattr(notifications.timeutil, "user_today", lambda: today)
    monkeypatch.setattr(notifications, "get_pay_period_for_date", lambda d, cfg: (today, today))

    async def goals(uid):
        await asyncio.sleep(0)
        return [{"label": "Cushion", "detail": "£500 to go"}]

    monkeypatch.setattr(goals_module, "goals_summary", goals)
    monkeypatch.setattr(
        collections, "needle_history_col", SimpleNamespace(find_one=_async_value({"pushed": True})),
    )
    _two(lambda: notifications.send_period_digest("u"))
    assert [s["title"] for s in sent] == ["New pay period: fresh start"]


# ── 2. one registration per install ─────────────────────────────────────────

class FakeTokenCol:
    def __init__(self):
        self.docs = {}

    async def update_one(self, filt, update, upsert=False):
        _id = filt["_id"]
        created = _id not in self.docs
        if created:
            if not upsert:
                return
            self.docs[_id] = {**(update.get("$setOnInsert") or {})}
        self.docs[_id].update(update.get("$set") or {})

    @staticmethod
    def _match(_id, d, filt):
        for k, v in filt.items():
            if k == "_id":
                if isinstance(v, dict) and "$ne" in v and _id == v["$ne"]:
                    return False
            elif isinstance(v, dict):
                if "$lt" in v and not (d.get(k) is not None and d[k] < v["$lt"]):
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def delete_many(self, filt):
        gone = [_id for _id, d in self.docs.items() if self._match(_id, d, filt)]
        for _id in gone:
            del self.docs[_id]
        return SimpleNamespace(deleted_count=len(gone))


def _register(col, token, install_id=None, user="u@x", platform="android"):
    asyncio.run(push_router._register_native_token(col, user, token, platform, install_id))


def test_reregister_same_install_replaces_old_token(monkeypatch):
    import time
    col = FakeTokenCol()
    _register(col, "tok-old-aaaaaaaa", "install-1234abcd")
    time.sleep(0.002)
    _register(col, "tok-new-bbbbbbbb", "install-1234abcd")
    assert list(col.docs) == ["tok-new-bbbbbbbb"]
    assert col.docs["tok-new-bbbbbbbb"]["install_id"] == "install-1234abcd"


def test_two_installs_keep_two_tokens(monkeypatch):
    col = FakeTokenCol()
    _register(col, "tok-phone-aaaaaaa", "install-phone111")
    _register(col, "tok-tablet-bbbbbb", "install-tablet22")
    assert len(col.docs) == 2


def test_other_user_or_platform_never_replaced():
    col = FakeTokenCol()
    _register(col, "tok-a-aaaaaaaaaa", "install-1234abcd", user="a@x")
    _register(col, "tok-b-bbbbbbbbbb", "install-1234abcd", user="b@x")
    _register(col, "tok-c-cccccccccc", "install-1234abcd", user="a@x", platform="ios")
    assert len(col.docs) == 3


def test_old_client_without_install_id_registers_and_dedupes_identical_tokens():
    col = FakeTokenCol()
    _register(col, "tok-legacy-aaaaaa")
    _register(col, "tok-legacy-aaaaaa")
    assert list(col.docs) == ["tok-legacy-aaaaaa"]
    assert "install_id" not in col.docs["tok-legacy-aaaaaa"]
    # a different token from an old client is added, never pruned
    _register(col, "tok-legacy-bbbbbb")
    assert len(col.docs) == 2


@pytest.mark.parametrize("bad", ["", "short", "has spaces in it!!", "x" * 80, None])
def test_malformed_install_id_is_treated_as_absent(bad):
    col = FakeTokenCol()
    _register(col, "tok-one-aaaaaaaaa", bad)
    _register(col, "tok-two-bbbbbbbbb", bad)
    assert len(col.docs) == 2


def test_register_bodies_accept_install_id_and_old_bodies_still_parse():
    assert push_router.FCMRegisterBody(token="t", install_id="abc12345").install_id == "abc12345"
    assert push_router.FCMRegisterBody(token="t").install_id is None
    assert push_router.APNsRegisterBody(token="t").install_id is None


# ── 3. holder-named accounts are labelled by bank and type ──────────────────

TOKENS = ["anya", "testworth"]


def _acc(name, **kw):
    return {"_id": "a1", "name": name, "provider": "ob-barclays", "subtype": "TRANSACTION", "type": "BANK", **kw}


def test_holder_safe_name_rules():
    from app.services.account_names import holder_safe_name

    assert holder_safe_name(_acc("MRS ANYA TESTWORTH"), TOKENS) == "Barclays current account"
    assert holder_safe_name(_acc("Anya Testworth"), TOKENS) == "Barclays current account"
    assert holder_safe_name(_acc("Dr A Testworth"), TOKENS) == "Barclays current account"
    assert holder_safe_name(_acc("MRS ANYA TESTWORTH", nickname="Everyday"), TOKENS) == "Everyday"
    # a nickname that is itself the holder's name is ignored
    assert holder_safe_name(_acc("MRS ANYA TESTWORTH", nickname="Anya Testworth"), TOKENS) == "Barclays current account"
    # ordinary product names are left alone
    assert holder_safe_name(_acc("Premier Current Account"), TOKENS) is None
    assert holder_safe_name(_acc("Rainy Day Saver"), TOKENS) is None


def _holder_accounts(nickname=None):
    extra = {"nickname": nickname} if nickname else {}
    return [
        g359._account(g359.BC, 350.0, provider="barclays", name="MRS ANYA TESTWORTH", **{}) | extra,
        g359._account(g359.BP, 10.0, provider="barclays", name="MRS ANYA TESTWORTH", subtype="SAVINGS", atype="SAVINGS"),
        g359._account(g359.ST, 9000.0, provider="starling", name="Starling Personal"),
        g359._account(g359.MZ, 30.0, provider="monzo", name="Monzo Personal Account"),
    ]


def _card(monkeypatch, nickname=None):
    monkeypatch.setattr(companion, "user_profiles_col", g359.FakeCol([{"_id": g359.UID, "name_tokens": TOKENS}]))
    items = g359._run(
        monkeypatch, g359._bills(extra=[g359._bill("Rent", 6000.0, 1)]), [g359._salary()],
        accounts=_holder_accounts(nickname),
    )
    cards = g359._moves(items)
    assert cards
    return cards[0]


def test_move_card_names_the_bank_account_not_the_holder(monkeypatch):
    card = _card(monkeypatch)
    text = " ".join([card["headline"], card["body"], card["plan_dest"]["name"], card["brief_lead"]["companion"]])
    assert "Testworth" not in text and "Anya" not in text
    assert card["plan_dest"]["name"] == "Barclays current account"
    assert card["headline"].endswith("to Barclays current account")


def test_move_card_uses_the_nickname_when_set(monkeypatch):
    card = _card(monkeypatch, nickname="Everyday")
    assert card["plan_dest"]["name"] == "Everyday"
    assert card["headline"].endswith("to Everyday")
    assert card["plan_dest"]["display_label"] == "Everyday"


def test_move_push_names_the_bank_account_not_the_holder(monkeypatch):
    card = _card(monkeypatch)
    state, _ = _patch_common(monkeypatch, state_docs={})
    sent = _patch_send(monkeypatch)

    async def items(uid, **kw):
        return [card]

    async def none(*a, **k):
        return []

    monkeypatch.setattr(companion, "compute_today_items", items)
    monkeypatch.setattr(notifications, "_maybe_bill_shortfall", none)
    monkeypatch.setattr(notifications, "_maybe_plan_shortfall", none)
    asyncio.run(notifications._maybe_money_movement(g359.UID))
    assert len(sent) == 1
    assert sent[0]["title"].endswith("to Barclays current account")
    assert "Testworth" not in sent[0]["title"] + sent[0]["body"]
    assert "—" not in sent[0]["title"] + sent[0]["body"] and "!" not in sent[0]["title"] + sent[0]["body"]


# ── sync_worker pushes: stamp-before-send ───────────────────────────────────

def test_trial_reminder_concurrent_runs_send_once(monkeypatch):
    from datetime import datetime, timedelta

    import app.workers.sync_worker as sync_worker
    from tests.test_trial_reminder import FakeCol

    subs = FakeCol([{
        "user_id": "t@example.test", "tier": "max", "status": "trialing",
        "billing_period": "annual", "trial_ends_at": datetime.utcnow() + timedelta(days=2),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", subs)
    calls = []

    async def fake_push(user_id, title, body, url="/"):
        await asyncio.sleep(0)
        calls.append(title)
        return {}

    monkeypatch.setattr(sync_worker, "send_push_to_user", fake_push)
    _two(lambda: sync_worker.task_trial_reminder({}))
    assert len(calls) == 1


def test_trial_reminder_failed_send_clears_the_stamp(monkeypatch):
    from datetime import datetime, timedelta

    import app.workers.sync_worker as sync_worker
    from tests.test_trial_reminder import FakeCol

    subs = FakeCol([{
        "user_id": "t@example.test", "tier": "max", "status": "trialing",
        "billing_period": "annual", "trial_ends_at": datetime.utcnow() + timedelta(days=2),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", subs)

    async def boom(user_id, title, body, url="/"):
        raise RuntimeError("down")

    monkeypatch.setattr(sync_worker, "send_push_to_user", boom)
    asyncio.run(sync_worker.task_trial_reminder({}))
    assert subs.docs[0].get("trial_reminder_sent_at") is None
