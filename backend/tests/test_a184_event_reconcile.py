"""A184: List events reconcile. Finexer is mocked with paged /events responses;
the dispatch is the real webhook one with in-memory collections."""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.webhooks as wh
import app.services.finexer_event_reconcile as rec
import app.services.finexer_sync as fs
from tests.test_a176_bank_sync import Resp
from tests.test_finexer_webhook_a167 import _Col


class Col(_Col):
    def find(self, q=None, projection=None):
        rows = []
        for d in self.docs:
            ok = True
            for k, v in (q or {}).items():
                if isinstance(v, dict) and "$in" in v:
                    ok = ok and d.get(k) in v["$in"]
                else:
                    ok = ok and d.get(k) == v
            if ok:
                rows.append(d)

        class _It:
            def __aiter__(s):
                s.i = 0
                return s

            async def __anext__(s):
                if s.i >= len(rows):
                    raise StopAsyncIteration
                s.i += 1
                return rows[s.i - 1]
        return _It()


class EventsClient:
    """Serves /events pages from a list of (status, body) tuples."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.gets: list = []

    async def get(self, url, params=None):
        self.gets.append((url, params))
        status, body = self.pages.pop(0)
        return Resp(status, body)


NOW = datetime(2026, 11, 1, 12, 0, 0)


def _ev(eid, typ="bank_account.synced", consent="c1", created=None):
    return {"id": eid, "type": typ, "created": int((created or NOW - timedelta(hours=2)).timestamp()) + 0,
            "consent_id": consent, "data": {"object": {"object": "bank_account", "id": "acc1"}}}


@pytest.fixture
def env(monkeypatch):
    consents = Col([{"_id": "c1", "user_id": "u@example.com", "status": "authorized"}])
    events = Col()
    runs = Col()
    monkeypatch.setattr(wh, "finexer_consents_col", consents)
    monkeypatch.setattr(wh, "webhook_events_col", events)
    monkeypatch.setattr(rec, "webhook_events_col", events)
    monkeypatch.setattr(rec, "worker_runs_col", runs)
    import app.db.collections as colls
    monkeypatch.setattr(colls, "worker_runs_col", runs)
    monkeypatch.setattr(wh._cfg, "FINEXER_WEBHOOK_DEBOUNCE_SECONDS", 0)
    calls: list = []

    async def fake_enqueue(task, **kw):
        calls.append({"task": task, **kw})

    async def _sleep(s):
        return None
    monkeypatch.setattr(wh, "_enqueue", fake_enqueue)
    monkeypatch.setattr(fs.asyncio, "sleep", _sleep)
    return {"events": events, "runs": runs, "calls": calls, "consents": consents}


def _run(pages, **kw):
    c = EventsClient(pages)
    out = asyncio.run(rec.reconcile_events(now=NOW, client=c, **kw))
    return out, c


def test_a_missed_event_is_replayed_once(env):
    out, c = _run([(200, {"data": [_ev("evt_a")], "paging": {}})])
    assert (out["received"], out["missed"], out["replayed"], out["failed"]) == (0, 1, 1, 0)
    assert out["complete"] is True
    assert len(env["calls"]) == 1 and env["calls"][0]["task"] == "task_sync_finexer"
    stored = [d for d in env["events"].docs if d.get("event_id") == "evt_a"]
    assert len(stored) == 1 and stored[0]["source"] == "reconcile"
    # A second pass over the same events replays nothing: the event id is now stored.
    out2, _c = _run([(200, {"data": [_ev("evt_a", created=NOW)], "paging": {}})], force=True)
    assert (out2["received"], out2["missed"], out2["replayed"]) == (1, 0, 0)
    assert len(env["calls"]) == 1


def test_a_known_event_is_not_replayed(env):
    env["events"].docs.append({"event_id": "evt_k", "provider": "finexer", "status": "queued"})
    out, _c = _run([(200, {"data": [_ev("evt_k")], "paging": {}})])
    assert (out["received"], out["missed"], out["replayed"]) == (1, 0, 0)
    assert env["calls"] == []


def test_unmapped_types_are_counted_not_replayed(env):
    out, _c = _run([(200, {"data": [_ev("evt_p", typ="payment.created")], "paging": {}})])
    assert out["skipped_type"] == 1 and out["missed"] == 0 and out["replayed"] == 0
    assert env["events"].docs == []


def test_pages_are_followed_and_events_before_the_window_are_ignored(env):
    old = _ev("evt_old", created=NOW - timedelta(days=30))
    pages = [
        (200, {"data": [_ev("evt_1")], "paging": {"next": "https://api.finexer.com/events?after=evt_1"}}),
        (200, {"data": [_ev("evt_2"), old], "paging": {}}),
    ]
    out, c = _run(pages)
    assert out["pages"] == 2 and out["replayed"] == 2 and out["missed"] == 2
    assert len(c.gets) == 2 and c.gets[0][0] == "/events"
    assert rec.SINCE_PARAM in (c.gets[0][1] or {})
    assert not any(d.get("event_id") == "evt_old" for d in env["events"].docs)


@pytest.mark.parametrize("status", [429, 500, 503])
def test_429_or_5xx_stops_the_pass_without_marking_it_complete(env, status):
    out, c = _run([(200, {"data": [_ev("evt_1")], "paging": {"next": "https://api.finexer.com/events?after=x"}}),
                   (status, {})] + ([(status, {})] * 6))
    assert out["complete"] is False and out["reason"] == f"http_{status}"
    assert out["replayed"] == 1, "what was read before the failure is still handled"
    state = next(d for d in env["runs"].docs if d["_id"] == rec.STATE_DOC_ID)
    assert state["last_status"] == "incomplete" and "last_completed_at" not in state
    # The next run still covers the same window (no completed marker moved it).
    out2, c2 = _run([(200, {"data": [], "paging": {}})], force=True)
    assert out2["complete"] is True
    assert next(d for d in env["runs"].docs if d["_id"] == rec.STATE_DOC_ID)["last_completed_at"] == NOW


def test_a_replay_that_fails_to_enqueue_is_counted_and_retried_next_time(env, monkeypatch):
    async def boom(task, **kw):
        raise RuntimeError("redis down")
    monkeypatch.setattr(wh, "_enqueue", boom)
    out, _c = _run([(200, {"data": [_ev("evt_f")], "paging": {}})])
    assert out["failed"] == 1 and out["replayed"] == 0 and out["complete"] is False
    # The failed delivery released its event id, so it is missed again next time.
    assert not any(d.get("event_id") == "evt_f" for d in env["events"].docs)


def test_too_soon_returns_without_a_request_unless_forced(env):
    _run([(200, {"data": [], "paging": {}})])
    out, c = _run([])
    assert out["ran"] is False and out["reason"] == "too_soon" and c.gets == []


def test_health_summary_has_counts_and_no_ids(env):
    _run([(200, {"data": [_ev("evt_h")], "paging": {}})])
    h = asyncio.run(rec.reconcile_health(NOW + timedelta(minutes=5)))
    assert h["minutes_ago"] == 5 and h["missed"] == 1 and h["replayed"] == 1 and h["last_status"] == "complete"
    assert "evt_h" not in str(h)


def test_logs_carry_counts_only(env, caplog):
    with caplog.at_level("INFO"):
        _run([(200, {"data": [_ev("evt_secret_id")], "paging": {}})])
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "evt_secret_id" not in text and "u@example.com" not in text


def test_ops_endpoint_is_owner_only(monkeypatch):
    import app.routers.ops as ops
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        asyncio.run(ops.ops_finexer_events_reconcile(user={"email": "someone@example.com"}))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        asyncio.run(ops.ops_finexer_events_reconcile(user={"bot_name": "x"}))
