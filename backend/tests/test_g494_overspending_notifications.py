"""G494's one early overspending heads-up, layered over category pace.

The checks only exercise notification orchestration. The financial result is
provided by the stored-moment service, so this suite cannot accidentally turn
notification delivery into another place that computes a forecast.
"""
import asyncio

import app.services.notifications as notifications
import app.services.overspending_moments as moments
from tests.test_notifications import FakeStateCol


UID = "alex@example.test"


def _moment(*, eligible=True, acknowledged=False, crossed=False, end="2026-11-27"):
    return {
        "display_ready": True,
        "heads_up_seen": False,
        "acknowledged": acknowledged,
        "crossed": crossed,
        "period": {"end": end},
        "on_course": {"available": eligible, "on_course_to_cross": eligible, "projected_gap": 120},
    }


def _install_moment(monkeypatch, moment, *, eligible=None, current_acknowledged=False):
    async def read(uid):
        assert uid == UID
        return moment

    monkeypatch.setattr(moments, "read_overspending_moment", read)
    monkeypatch.setattr(
        moments,
        "early_heads_up_eligible",
        eligible or (lambda doc: bool(doc and doc.get("display_ready") and doc["on_course"].get("on_course_to_cross"))),
    )

    async def acknowledged(uid):
        assert uid == UID
        if isinstance(current_acknowledged, Exception):
            raise current_acknowledged
        return current_acknowledged

    monkeypatch.setattr(moments, "current_period_acknowledged", acknowledged)


def _patch_common(monkeypatch, moment, *, pref=True, first=None, send_result=None, current_acknowledged=False, eligible=None):
    state = FakeStateCol({})
    sent = []
    categories = []
    monkeypatch.setattr(notifications, "notification_state_col", state)

    async def preference(uid, key):
        assert key == "category_pace"
        return pref

    async def sync_state(uid):
        return first or {"first_sync": False, "state": "idle"}

    async def category(uid):
        categories.append(uid)

    async def send(uid, title, body, url):
        sent.append((uid, title, body, url))
        return send_result if send_result is not None else {"fcm": {"attempted": 1, "delivered": 1}}

    monkeypatch.setattr(notifications, "notif_pref", preference)
    monkeypatch.setattr(notifications, "first_sync_state", sync_state)
    monkeypatch.setattr(notifications, "_maybe_category_pace", category)
    monkeypatch.setattr(notifications, "send_push_to_user", send)
    _install_moment(monkeypatch, moment, current_acknowledged=current_acknowledged, eligible=eligible)
    return state, sent, categories


def test_preference_off_does_not_read_or_send(monkeypatch):
    state = FakeStateCol({})
    monkeypatch.setattr(notifications, "notification_state_col", state)

    async def preference(uid, key):
        return False

    async def boom(uid):
        raise AssertionError("stored moment must not be read with preference off")

    monkeypatch.setattr(moments, "read_overspending_moment", boom)
    monkeypatch.setattr(notifications, "notif_pref", preference)
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert state.docs == {}


def test_raw_sync_can_skip_only_spending_pace(monkeypatch):
    calls = []

    async def mark(name):
        calls.append(name)

    async def transaction(uid, rows):
        await mark("transactions")

    monkeypatch.setattr(notifications, "_maybe_money_movement", lambda uid: mark("money"))
    monkeypatch.setattr(notifications, "_maybe_settle_planned", lambda uid: mark("settle"))
    monkeypatch.setattr(notifications, "_maybe_transactions", transaction)
    monkeypatch.setattr(notifications, "_maybe_goal_funded", lambda uid: mark("goals"))
    monkeypatch.setattr(notifications, "_maybe_new_insights", lambda uid: mark("insights"))
    monkeypatch.setattr(notifications, "_maybe_classification_attention", lambda uid: mark("classification"))
    monkeypatch.setattr(notifications, "_maybe_spending_pace", lambda uid: mark("pace"))

    asyncio.run(notifications.notify_after_sync(UID, [], include_spending_pace=False))
    assert set(calls) == {"money", "settle", "transactions", "goals", "insights", "classification"}


def test_eligible_moment_sends_one_overall_push_and_no_category_push(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, _moment())
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == [(UID, "Spending may pass income", "At this pace, spending may pass income before the end of this pay period. Open Spend to see what is contributing.", "/spend?overspending=1")]
    assert categories == []


def test_acknowledgement_suppresses_every_spending_pace_notice(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, _moment(acknowledged=True))
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_missing_cache_without_one_off_stays_quiet_until_warm(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, None)
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_missing_cache_with_current_one_off_suppresses_category_fallback(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, None, current_acknowledged=True)
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_missing_cache_acknowledgement_read_failure_fails_closed(monkeypatch):
    _state, sent, categories = _patch_common(
        monkeypatch, None, current_acknowledged=RuntimeError("ack store unavailable"),
    )
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_not_ready_stored_moment_stays_quiet_without_computing(monkeypatch):
    stale = _moment()
    stale["display_ready"] = False
    _state, sent, categories = _patch_common(monkeypatch, stale, eligible=lambda doc: False)
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_first_sync_holds_spending_pace_notifications(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, _moment(), first={"first_sync": True, "state": "syncing"})
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_failed_first_sync_holds_spending_pace_notifications(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, _moment(), first={"first_sync": True, "state": "failed"})
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_idle_first_sync_holds_spending_pace_notifications(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, _moment(), first={"first_sync": True, "state": "idle"})
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []


def test_concurrent_runs_claim_one_overall_push(monkeypatch):
    _state, sent, categories = _patch_common(monkeypatch, _moment())

    async def both():
        await asyncio.gather(notifications._maybe_spending_pace(UID), notifications._maybe_spending_pace(UID))

    asyncio.run(both())
    assert len(sent) == 1
    assert categories == []


def test_hard_delivery_failure_releases_claim_for_retry(monkeypatch):
    state, sent, categories = _patch_common(
        monkeypatch, _moment(), send_result={"fcm": {"attempted": 1, "delivered": 0, "failed": 1}},
    )
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert len(sent) == 1
    assert categories == []
    assert state.docs[UID].get("claims") == {}

    async def healthy(uid, title, body, url):
        sent.append((uid, title, body, url))
        return {"fcm": {"attempted": 1, "delivered": 1}}

    monkeypatch.setattr(notifications, "send_push_to_user", healthy)
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert len(sent) == 2


def test_period_rollover_has_a_new_one_push_claim(monkeypatch):
    state, sent, _ = _patch_common(monkeypatch, _moment(end="2026-11-27"))
    asyncio.run(notifications._maybe_spending_pace(UID))
    _install_moment(monkeypatch, _moment(end="2026-12-25"))
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert len(sent) == 2
    assert len(state.docs[UID]["claims"]) == 2


def test_crossed_period_with_existing_overall_claim_does_not_restart_category_notices(monkeypatch):
    state, sent, categories = _patch_common(monkeypatch, _moment(eligible=False, crossed=True))
    asyncio.run(notifications.claim_push(UID, "overspend:2026-11-27"))
    asyncio.run(notifications._maybe_spending_pace(UID))
    assert sent == []
    assert categories == []
    assert state.docs[UID]["claims"]
