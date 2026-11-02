"""A185: the automatic-sync setter runs on any sync pass for an account with
neither bank_auto_sync_hours nor bank_auto_sync_refused_at, not only on a
consent's first sync. Finexer is mocked at the client level."""
import asyncio
import logging
from datetime import datetime, timedelta

import app.services.finexer_sync as fs
import tests.test_a176_bank_sync as t

CONSENT, UID, NOW, IDLE = t.CONSENT, t.UID, t.NOW, t.IDLE
Resp, Client, Col = t.Resp, t.Client, t.Col

_quiet = t._quiet  # autouse fixture: silence counters and reset the warn-once flag


def _later(monkeypatch, docs, post_responses):
    accts = Col(docs)
    consents = t._wire_sync(monkeypatch, accts)
    consents.docs[0]["last_synced"] = NOW  # not the first sync
    c = Client(post_responses=post_responses, booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    return accts, c


def _acc(accts):
    return next(d for d in accts.docs if d["_id"] == "acc1")


def _setter_posts(c):
    return [d for u, d in c.posts if d and "auto_sync_interval" in d]


def test_first_sync_sets_auto_sync_unchanged(monkeypatch):
    accts = Col([])
    t._wire_sync(monkeypatch, accts)
    c = Client(post_responses=[Resp(200, {"auto_sync_interval": 6})], booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert _setter_posts(c) == [{"auto_sync_interval": "6"}]
    assert _acc(accts)["bank_auto_sync_hours"] == 6


def test_later_sync_without_either_field_sets_it_once(monkeypatch):
    accts, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID, "finexer_id": "acc1"}],
                      [Resp(200, {"auto_sync_interval": 6})])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert _setter_posts(c) == [{"auto_sync_interval": "6"}]
    assert len(c.posts) == 1
    assert _acc(accts)["bank_auto_sync_hours"] == 6
    c.posts.clear()
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert c.posts == [], "hours now set: no second POST"


def test_later_sync_with_hours_set_does_not_post(monkeypatch):
    _, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID, "bank_auto_sync_hours": 6}], [Resp(200, IDLE)])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert c.posts == []


def test_refused_account_does_not_post(monkeypatch):
    _, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID,
                                 "bank_auto_sync_refused_at": NOW - timedelta(days=3)}], [Resp(200, IDLE)])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert c.posts == []


def test_sixty_minute_rule_skips_the_setter_without_a_post(monkeypatch):
    for field in ({"bank_sync_requested_at": datetime.utcnow() - timedelta(minutes=5)},  # naive-ok: test fixture
                  {"bank_sync_next_at": datetime.utcnow() + timedelta(minutes=30)}):  # naive-ok: test fixture
        _, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID, **field}], [Resp(200, IDLE)])
        asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
        assert c.posts == []


def test_sync_object_response_stamps_requested_at_and_skips_manual_trigger(monkeypatch):
    accts, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID}],
                      [Resp(200, {**IDLE, "auto_sync_interval": 6}), Resp(200, IDLE)])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert len(c.posts) == 1, "the setter already triggered a sync"
    d = _acc(accts)
    assert d["bank_sync_requested_at"] and d["bank_auto_sync_hours"] == 6
    assert d["bank_synced_to"] == datetime(2026, 10, 31, 11, 42, 0)


def test_bare_2xx_does_not_stamp_hours(monkeypatch):
    accts, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID}], [Resp(200, {})])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert len(c.posts) == 1
    assert "bank_auto_sync_hours" not in _acc(accts)


def test_429_stamps_next_at(monkeypatch):
    accts, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID}], [Resp(429, {})])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    d = _acc(accts)
    assert d["bank_sync_last_429_at"] and d["bank_sync_next_at"]
    assert len(c.posts) == 1, "the manual trigger honours the stored next_at: no second POST"


def test_refusal_stamps_and_warns_once_per_process(monkeypatch, caplog):
    docs = [{"_id": "acc1", "user_id": UID}]
    accts, c = _later(monkeypatch, docs, [Resp(400, {})])
    with caplog.at_level(logging.WARNING, logger="app.services.finexer_sync"):
        asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
        assert _acc(accts)["bank_auto_sync_refused_at"]
        assert len(c.posts) == 1
        # A second account doc without the stamp is refused too, but only warns once.
        _acc(accts).pop("bank_auto_sync_refused_at")
        asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert len(c.posts) == 2
    assert len([r for r in caplog.records if "auto_sync_interval" in r.getMessage()]) == 1


def test_cron_path_runs_the_setter_but_never_the_manual_trigger(monkeypatch):
    accts, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID}],
                      [Resp(200, {"auto_sync_interval": 6}), Resp(200, IDLE)])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=False))
    assert [d for u, d in c.posts] == [{"auto_sync_interval": "6"}]
    assert not [d for u, d in c.posts if d is None]


def test_one_setter_attempt_per_account_per_pass(monkeypatch):
    _, c = _later(monkeypatch, [{"_id": "acc1", "user_id": UID}], [Resp(200, {})])
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert len(_setter_posts(c)) == 1


def test_backfill_selection_equals_the_sync_selection(monkeypatch):
    import app.db.collections as colls
    import scripts.finexer_backfill_auto_sync as bf
    now = datetime.utcnow()  # naive-ok: test fixture
    docs = [
        {"_id": "none", "source": "finexer", "connection_id": "c1"},
        {"_id": "hours", "source": "finexer", "connection_id": "c1", "bank_auto_sync_hours": 6},
        {"_id": "refused", "source": "finexer", "connection_id": "c1", "bank_auto_sync_refused_at": now - timedelta(days=2)},
        {"_id": "none2", "source": "finexer", "connection_id": "c1", "bank_sync_requested_at": now - timedelta(days=1)},
        {"_id": "recent", "source": "finexer", "connection_id": "c1", "bank_sync_requested_at": now - timedelta(minutes=5)},
    ]
    monkeypatch.setattr(colls, "finexer_consents_col", Col([{"_id": "c1", "status": "authorized"}]))
    monkeypatch.setattr(colls, "accounts_col", Col(docs))
    sync_ids = {d["_id"] for d in docs
                if fs.account_needs_auto_sync(d) and fs.auto_sync_blocked_until(d, now) is None}
    seen: list = []

    async def _ensure(client, account_id, hours, *a, **k):
        seen.append(account_id)
        return {"ok": True}

    monkeypatch.setattr(fs, "ensure_auto_sync", _ensure)
    monkeypatch.setattr(fs, "_client", lambda: Client())

    async def _nosleep(s):
        return None
    monkeypatch.setattr(bf.asyncio, "sleep", _nosleep)
    summary = asyncio.run(bf.run(apply=True, hours=6))
    assert sync_ids == {"none", "none2"}
    assert set(seen) == sync_ids and summary["eligible"] == len(sync_ids)
    # And the Mongo-side query agrees with the Python predicate.
    assert {d["_id"] for d in docs if t._match(d, fs.AUTO_SYNC_MISSING_QUERY)} == {
        d["_id"] for d in docs if fs.account_needs_auto_sync(d)}
