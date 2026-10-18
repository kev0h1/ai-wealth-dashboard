"""E8: throttled /ops/health alerts. Fakes for push and for sample rows; the
throttle state tests use the disposable per-run test database that conftest
provides (a fresh collection each, dropped afterwards). Never the real DB."""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.db.guard import guarded_drop_collection
from app.services.health import alerts, error_types
from app.services.health.alerts import Config, Condition

NOW = datetime(2026, 10, 18, 12, 0, 0)  # naive-ok: fixed fixture clock, naive UTC like Mongo returns
OWNER = {"email": "kevin.maingi12@gmail.com"}


def run(coro):
    return asyncio.run(coro)


def cfg(**kw):
    return Config(**{"enabled": True, "cooldown_h": 6.0, "warn_streak": 3, "hourly_cap": 5, **kw})


def row(ts=NOW, status="ok", state="ok", **metrics):
    return {"ts": ts, "state": state, "status": status, "metrics": metrics}


def series(*specs, now=NOW, status="ok"):
    """Newest first; each spec is a dict of metrics, 5 minutes apart."""
    return [row(ts=now - timedelta(minutes=5 * i), status=status, **s) for i, s in enumerate(specs)]


class Sent:
    def __init__(self):
        self.calls = []

    async def __call__(self, title, body):
        self.calls.append((title, body))
        return {"fcm": {"attempted": 1, "delivered": 1, "failed": 0}}

    @property
    def titles(self):
        return [t for t, _ in self.calls]


def with_state(fn):
    """Run `fn(col)` against a fresh collection in the per-run test database."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import MONGO_URI

    async def go():
        assert os.environ["MONGO_DB"] != "wealth"
        client = AsyncIOMotorClient(MONGO_URI)
        col = client[os.environ["MONGO_DB"]][f"alert_state_t{uuid.uuid4().hex[:8]}"]
        try:
            return await fn(col)
        finally:
            await guarded_drop_collection(client, col.database.name, col.name)
            client.close()
    return run(go())


def crit(key="vps_disk", title="Server disk nearly full", body="Server disk 93% used"):
    return Condition(key, "crit", title, body, "Resolved: server disk", "Server disk back under 90%")


def warn(key="vps_disk"):
    return Condition(key, "warn", "Server disk filling", "Server disk 80% used", "Resolved: server disk", "ok again")


def at(minutes):
    return NOW + timedelta(minutes=minutes)


# ---- conditions fire on fixture samples -------------------------------------

def test_error_rate_needs_two_consecutive_samples_and_enough_requests():
    hot = dict(error_rate=0.12, count=80, p95_ms=100)
    out = alerts.evaluate({"api_latency": series(hot, hot)}, cfg(), NOW)
    c = out["error_rate"]
    assert c.severity == "crit" and c.body == "API error rate 12% over the last hour, above 10%"
    assert out["api_p95"] is None
    # one spike is unconfirmed: neither raised nor cleared
    assert "error_rate" not in alerts.evaluate({"api_latency": series(hot, dict(hot, error_rate=0.0))}, cfg(), NOW)
    # a quiet latest sample clears
    assert alerts.evaluate({"api_latency": series(dict(hot, error_rate=0.01), hot)}, cfg(), NOW)["error_rate"] is None
    # too few requests is noise
    thin = dict(error_rate=0.5, count=5, p95_ms=100)
    assert alerts.evaluate({"api_latency": series(thin, thin)}, cfg(), NOW)["error_rate"] is None
    # stale samples are "no data"
    assert alerts.evaluate({"api_latency": series(hot, hot, now=NOW - timedelta(hours=1))}, cfg(), NOW) == {}
    # a collection that failed is "no data" too
    assert alerts.evaluate({"api_latency": [row(state="timed_out", status="unknown")]}, cfg(), NOW) == {}


def test_api_p95_sync_quota_disk_and_memory_conditions():
    slow = dict(p95_ms=3400.0, error_rate=0.0, count=50)
    assert alerts.evaluate({"api_latency": series(slow, slow)}, cfg(), NOW)["api_p95"].body.startswith("API p95 latency 3400 ms")

    out = alerts.evaluate({"finexer_sync": series(dict(failed_24h=6))}, cfg(), NOW)
    assert out["sync_failures"].severity == "warn"
    assert alerts.evaluate({"finexer_sync": series(dict(failed_24h=15))}, cfg(), NOW)["sync_failures"].severity == "crit"
    assert alerts.evaluate({"finexer_sync": series(dict(failed_24h=2))}, cfg(), NOW)["sync_failures"] is None

    out = alerts.evaluate({"llm_tavily": series(dict(tavily_backoff=1, budget_used_pct=104.0))}, cfg(), NOW)
    assert out["quota_tavily"].severity == "crit" and "paused" in out["quota_tavily"].body
    assert out["quota_openrouter"].body == "Model spend is at 104% of the monthly budget"
    out = alerts.evaluate({"llm_tavily": series(dict(tavily_backoff=0, budget_used_pct=40.0))}, cfg(), NOW)
    assert out["quota_tavily"] is None and out["quota_openrouter"] is None

    out = alerts.evaluate({"vps": series(dict(disk_used_pct=93.0, memory_used_pct=95.0, memory_available_mb=400))}, cfg(), NOW)
    assert out["vps_disk"].body == "Server disk 93% used, above 90%"
    assert out["vps_memory"].body == "Server memory 95% used, 400 MB free"
    out = alerts.evaluate({"vps": series(dict(disk_used_pct=50.0, memory_used_pct=60.0, memory_available_mb=500))}, cfg(), NOW)
    assert out["vps_disk"] is None and out["vps_memory"].severity == "crit"      # low free memory alone is crit
    out = alerts.evaluate({"vps": series(dict(disk_used_pct=50.0, memory_used_pct=60.0, memory_available_mb=5000))}, cfg(), NOW)
    assert out["vps_memory"] is None


def test_generic_collector_crit_and_warn_streak():
    out = alerts.evaluate({"mongo": series(dict(), status="ok")}, cfg(), NOW)
    assert out["collector:mongo"] is None
    out = alerts.evaluate({"mongo": [row(status="crit")]}, cfg(), NOW)
    assert out["collector:mongo"].severity == "crit"
    two = [row(ts=NOW, status="warn"), row(ts=NOW - timedelta(minutes=5), status="warn"), row(ts=NOW - timedelta(minutes=10))]
    assert alerts.evaluate({"mongo": two}, cfg(), NOW)["collector:mongo"] is None       # streak not reached
    three = [row(ts=NOW - timedelta(minutes=5 * i), status="warn") for i in range(3)]
    c = alerts.evaluate({"mongo": three}, cfg(), NOW)["collector:mongo"]
    assert c.severity == "warn" and "3 checks" in c.body
    assert alerts.evaluate({"mongo": three}, cfg(warn_streak=4), NOW)["collector:mongo"] is None
    # a specific rule already speaking for the collector silences the generic one
    out = alerts.evaluate({"vps": [row(status="crit", disk_used_pct=95.0, memory_used_pct=10.0, memory_available_mb=9000)]}, cfg(), NOW)
    assert out["vps_disk"] is not None and "collector:vps" not in out


# ---- throttling state --------------------------------------------------------

def test_cooldown_suppresses_repeat_then_allows_after_window():
    async def go(col):
        send = Sent()
        c = cfg(cooldown_h=6)
        s1 = await alerts.process(col, {"vps_disk": crit()}, at(0), c, send)
        s2 = await alerts.process(col, {"vps_disk": crit()}, at(5), c, send)
        s3 = await alerts.process(col, {"vps_disk": crit()}, at(6 * 60 - 5), c, send)
        assert (s1["sent"], s2["throttled"], s3["throttled"]) == (1, 1, 1) and len(send.calls) == 1
        s4 = await alerts.process(col, {"vps_disk": crit()}, at(6 * 60 + 5), c, send)
        assert s4["sent"] == 1 and len(send.calls) == 2
        doc = await col.find_one({"_id": "vps_disk"})
        assert doc["state"] == "open" and doc["count"] == 1 and doc["first_seen"] == at(0)
    with_state(go)


def test_escalation_warn_to_crit_renotifies_once():
    async def go(col):
        send = Sent()
        await alerts.process(col, {"vps_disk": warn()}, at(0), cfg(), send)
        await alerts.process(col, {"vps_disk": warn()}, at(5), cfg(), send)
        assert len(send.calls) == 1
        s = await alerts.process(col, {"vps_disk": crit()}, at(10), cfg(), send)
        assert s["sent"] == 1 and send.titles[-1] == "Server disk nearly full"
        # flapping back to warn then crit within the cooldown does not repeat the crit notice
        await alerts.process(col, {"vps_disk": warn()}, at(15), cfg(), send)
        await alerts.process(col, {"vps_disk": crit()}, at(20), cfg(), send)
        assert len(send.calls) == 2
    with_state(go)


def test_resolved_notice_after_two_clear_samples_only():
    async def go(col):
        send = Sent()
        await alerts.process(col, {"vps_disk": crit()}, at(0), cfg(), send)
        await alerts.process(col, {"vps_disk": None}, at(5), cfg(), send)
        assert len(send.calls) == 1 and (await col.find_one({"_id": "vps_disk"}))["state"] == "open"
        # a relapse resets the count
        await alerts.process(col, {"vps_disk": crit()}, at(10), cfg(), send)
        await alerts.process(col, {"vps_disk": None}, at(15), cfg(), send)
        assert len(send.calls) == 1
        s = await alerts.process(col, {"vps_disk": None}, at(20), cfg(), send)
        assert s["resolved"] == 1 and send.calls[-1] == ("Resolved: server disk", "Server disk back under 90%")
        assert (await col.find_one({"_id": "vps_disk"}))["state"] == "resolved"
        # nothing more once resolved, and no data holds an open alert open
        await alerts.process(col, {"vps_disk": None}, at(25), cfg(), send)
        assert len(send.calls) == 2
        await alerts.process(col, {"vps_disk": crit()}, at(30), cfg(), send)       # inside the cooldown: reopened, not re-sent
        assert len(send.calls) == 2 and (await col.find_one({"_id": "vps_disk"}))["count"] == 2
        await alerts.process(col, {}, at(35), cfg(), send)
        await alerts.process(col, {}, at(40), cfg(), send)
        assert (await col.find_one({"_id": "vps_disk"}))["state"] == "open"
    with_state(go)


def test_never_notified_alert_resolves_without_a_notice():
    async def go(col):
        send = Sent()
        c = cfg(hourly_cap=1)
        await alerts.process(col, {"a": crit("a"), "b": crit("b")}, at(0), c, send)   # b is capped out
        await alerts.process(col, {"a": None, "b": None}, at(65), c, send)    # next hour, so the cap has room
        await alerts.process(col, {"a": None, "b": None}, at(70), c, send)
        assert send.titles.count("Resolved: server disk") == 1                         # only a, which was announced
    with_state(go)


def test_hourly_cap_suppresses_and_sends_one_overflow_summary():
    async def go(col):
        send = Sent()
        c = cfg(hourly_cap=2)
        results = {k: crit(k, title=f"Alert {k}") for k in "abcde"}
        s = await alerts.process(col, results, at(0), c, send)
        assert s["sent"] == 2 and s["suppressed"] == 3 and len(send.calls) == 2
        s = await alerts.process(col, results, at(5), c, send)            # retried, but counted once per key per hour
        assert s["sent"] == 0 and len(send.calls) == 2
        # next hour: one summary, and the held-back alerts get their turn within the cap
        s = await alerts.process(col, results, at(60), c, send)
        summaries = [b for t, b in send.calls if t == "More alerts suppressed"]
        assert summaries == ["3 more alerts suppressed in the last hour. See /ops/health"]
        assert s["sent"] == 2
    with_state(go)


def test_cross_replica_dedupe_notifies_once():
    async def go(col):
        send = Sent()
        results = await asyncio.gather(*[alerts.process(col, {"vps_disk": crit()}, at(0), cfg(), send) for _ in range(4)])
        assert len(send.calls) == 1 and sum(r["sent"] for r in results) == 1
        # and the same bucket again changes nothing
        await asyncio.gather(*[alerts.process(col, {"vps_disk": crit()}, at(1), cfg(cooldown_h=0), send) for _ in range(3)])
        assert len(send.calls) == 1
        # resolve race: two replicas clearing in the same bucket count one sample
        await asyncio.gather(*[alerts.process(col, {"vps_disk": None}, at(5), cfg(), send) for _ in range(3)])
        assert (await col.find_one({"_id": "vps_disk"}))["clear_streak"] == 1
    with_state(go)


def test_disabled_flag_sends_nothing_and_touches_nothing(monkeypatch):
    monkeypatch.delenv("ALERTS_ENABLED", raising=False)
    assert alerts.load_config().enabled is False
    send = Sent()

    class Boom:
        def __getattr__(self, name):
            raise AssertionError("must not touch the database while disabled")

    out = run(alerts.run_alerts(Boom(), Boom(), now=NOW, send=send))
    assert out == {"enabled": False} and send.calls == []
    error_types.clear()
    error_types.record("NeverAnnounced")
    assert run(alerts.process_new_error_types(Boom(), Boom(), now=NOW, send=send, cfg=Config(enabled=False)))["enabled"] is False
    assert send.calls == []
    monkeypatch.setenv("ALERTS_ENABLED", "true")
    monkeypatch.setenv("ALERT_COOLDOWN_HOURS", "2")
    monkeypatch.setenv("ALERT_WARN_STREAK", "4")
    monkeypatch.setenv("ALERT_HOURLY_CAP", "9")
    c = alerts.load_config()
    assert (c.enabled, c.cooldown_h, c.warn_streak, c.hourly_cap) == (True, 2.0, 4, 9)
    monkeypatch.setenv("ALERT_HOURLY_CAP", "nonsense")
    assert alerts.load_config().hourly_cap == 5


def test_run_alerts_end_to_end_from_samples():
    class Cursor:
        def __init__(self, docs):
            self.docs = docs

        def sort(self, *a):
            return self

        async def to_list(self, n):
            return self.docs

    class Samples:
        def find(self, filt, proj=None):
            docs = [dict(r, collector="vps") for r in series(dict(disk_used_pct=96.0, memory_used_pct=10.0, memory_available_mb=9000), status="crit")]
            return Cursor(docs)

    async def go(col):
        send = Sent()
        out = await alerts.run_alerts(Samples(), col, now=NOW, send=send, cfg=cfg())
        assert out["enabled"] and out["sent"] == 1 and send.calls == [("Server disk nearly full", "Server disk 96% used, above 90%")]
    with_state(go)


# ---- delivery and the owner-only endpoints -----------------------------------

def test_default_send_targets_owner_only_through_existing_push_path(monkeypatch):
    from app.core import push
    from app.core.config import PRIMARY_EMAIL
    from app.services import notifications

    seen = {}

    async def fake_push(user_id, title, body, url="/"):
        seen.update(user=user_id, title=title, body=body, url=url)
        return {"fcm": {"attempted": 1, "delivered": 1, "failed": 0}}

    async def pref_on(user_id, key):
        seen["pref"] = (user_id, key)
        return True
    monkeypatch.setattr(push, "send_push_to_user", fake_push)
    monkeypatch.setattr(notifications, "notif_pref", pref_on)
    assert run(alerts.default_send("API error rate high", "API error rate 12% over the last hour, above 10%")) is not None
    assert seen["user"] == PRIMARY_EMAIL and seen["url"] == "/ops/health" and seen["pref"] == (PRIMARY_EMAIL, "ops_alerts")
    assert notifications.NOTIF_DEFAULTS["ops_alerts"] is True

    async def pref_off(user_id, key):
        return False
    monkeypatch.setattr(notifications, "notif_pref", pref_off)
    seen.clear()
    assert run(alerts.default_send("x", "y")) is None and "user" not in seen


def test_copy_has_no_em_dash_or_exclamation():
    out = alerts.evaluate({
        "api_latency": series(dict(error_rate=0.5, count=90, p95_ms=9000.0), dict(error_rate=0.5, count=90, p95_ms=9000.0)),
        "finexer_sync": series(dict(failed_24h=40)),
        "llm_tavily": series(dict(tavily_backoff=1, budget_used_pct=150.0)),
        "vps": series(dict(disk_used_pct=99.0, memory_used_pct=99.0, memory_available_mb=10)),
        "mongo": [row(status="crit")],
    }, cfg(), NOW)
    assert len([c for c in out.values() if c]) >= 8
    for c in out.values():
        for text in (c.title, c.body, c.resolved_title, c.resolved_body):
            assert "—" not in text and "–" not in text and "!" not in text


def test_test_endpoint_owner_only_and_throttled(monkeypatch):
    from app.routers import ops
    called = []

    async def fake_test(col, **kw):
        called.append(1)
        return {"sent": True}
    monkeypatch.setattr(alerts, "send_test", fake_test)
    for fn in (lambda: ops.ops_health_alerts_test({"email": "tester@example.com"}),
               lambda: ops.ops_health_alerts({"email": "tester@example.com"})):
        with pytest.raises(HTTPException) as e:
            run(fn())
        assert e.value.status_code == 403
    assert called == []
    assert run(ops.ops_health_alerts_test(OWNER)) == {"sent": True} and called == [1]


def test_send_test_is_throttled_to_one_a_minute_and_ignores_the_enabled_flag():
    async def go(col):
        send = Sent()
        c = cfg(enabled=False)
        a = await alerts.send_test(col, now=at(0), send=send, cfg=c)
        b = await alerts.send_test(col, now=at(0) + timedelta(seconds=20), send=send, cfg=c)
        d = await alerts.send_test(col, now=at(0) + timedelta(seconds=61), send=send, cfg=c)
        assert a["sent"] and a["delivery"] == {"attempted": 1, "delivered": 1, "failed": 0} and a["enabled"] is False
        assert b == {"sent": False, "throttled": True, "retry_after_s": 40, "enabled": False}
        assert d["sent"] and len(send.calls) == 2

        async def off(title, body):
            return None
        later = await alerts.send_test(col, now=at(10), send=off, cfg=c)
        assert later["sent"] is False and "ops_alerts" in later["note"]
    with_state(go)


def test_snapshot_lists_open_and_24h_history_without_internal_docs():
    async def go(col):
        send = Sent()
        await alerts.process(col, {"vps_disk": crit(), "quota_tavily": crit("quota_tavily", title="Tavily paused")}, at(0), cfg(), send)
        await alerts.process(col, {"quota_tavily": None}, at(5), cfg(), send)
        await alerts.process(col, {"quota_tavily": None}, at(10), cfg(), send)
        await alerts.send_test(col, now=at(11), send=send)
        await col.insert_one({"_id": "old", "state": "resolved", "first_seen": at(-48 * 60), "last_notified": at(-48 * 60)})
        snap = await alerts.snapshot(col, now=at(20), cfg=cfg())
        assert [a["key"] for a in snap["open"]] == ["vps_disk"]
        assert {h["key"] for h in snap["history"]} == {"vps_disk", "quota_tavily"}
        assert snap["cap"]["sent_this_hour"] == 3 and snap["config"]["hourly_cap"] == 5
        assert all("__" not in h["key"] for h in snap["history"])
    with_state(go)


# ---- new error types ---------------------------------------------------------

def test_error_type_set_is_bounded_and_holds_class_names_only():
    error_types.clear()
    for i in range(error_types.MAX_TYPES + 50):
        error_types.record(f"Err{i}", now=1000.0 + i)
    assert len(error_types.RECENT) == error_types.MAX_TYPES and len(error_types.PENDING) <= error_types.MAX_TYPES
    assert "Err0" not in error_types.RECENT and f"Err{error_types.MAX_TYPES + 49}" in error_types.RECENT
    error_types.clear()
    for bad in ("user@example.com failed", "Bearer abc", "£12.50", "x" * 200, "", None, 12, "A.B", "a b"):
        assert error_types.record(bad) is False
    assert error_types.RECENT == {} and error_types.PENDING == set()
    assert error_types.record("ValueError") and set(error_types.RECENT) == {"ValueError"}
    assert all(isinstance(v, float) for v in error_types.RECENT.values())     # no payload, only a timestamp


def test_logging_handler_keeps_class_name_not_message():
    error_types.clear()
    h = error_types.ErrorTypeHandler()
    log = logging.getLogger(f"t.{uuid.uuid4().hex}")
    log.propagate = False
    log.addHandler(h)
    try:
        raise KeyError("secret merchant Costa £4.20")
    except KeyError:
        log.exception("failed for kevin@example.com")
    log.error("no exception attached")
    log.warning("warning only", exc_info=True)
    assert set(error_types.RECENT) == {"KeyError"}
    assert "secret" not in repr(error_types.RECENT) and "kevin" not in repr(error_types.PENDING)
    error_types.install()
    error_types.install()
    assert sum(isinstance(x, error_types.ErrorTypeHandler) for x in logging.getLogger().handlers) == 1


def test_new_error_type_flush_and_alert():
    async def go(col):
        send = Sent()
        seen = col.database[f"seen_{uuid.uuid4().hex[:6]}"]
        c = cfg()
        error_types.clear()
        error_types.record("BaselineError")
        first = await alerts.process_new_error_types(seen, col, now=NOW, send=send, cfg=c)
        assert first["new"] == 0 and send.calls == []                      # empty collection: baseline only
        error_types.record("BaselineError")
        error_types.record("BrandNewError")
        out = await alerts.process_new_error_types(seen, col, now=at(5), send=send, cfg=c)
        assert out["new"] == 1 and out["sent"] == 1
        assert send.calls == [("New error type", "BrandNewError raised for the first time in 7 days")]
        # known class again: nothing
        error_types.record("BrandNewError")
        out = await alerts.process_new_error_types(seen, col, now=at(10), send=send, cfg=c)
        assert out["new"] == 0 and len(send.calls) == 1
        # not seen for over 7 days: new again
        await seen.update_one({"_id": "BaselineError"}, {"$set": {"last_seen": NOW - timedelta(days=8)}})
        error_types.record("BaselineError")
        out = await alerts.process_new_error_types(seen, col, now=at(15), send=send, cfg=c)
        assert out["new"] == 1 and out["sent"] == 1
        assert (await col.find_one({"_id": "new_error:BrandNewError"}))["state"] == "resolved"     # events do not stay open
        # while disabled the baseline still grows but nothing is sent
        error_types.record("QuietError")
        out = await alerts.process_new_error_types(seen, col, now=at(20), send=send, cfg=cfg(enabled=False))
        assert out["enabled"] is False and len(send.calls) == 2 and await seen.find_one({"_id": "QuietError"})
        await guarded_drop_collection(col.database.client, col.database.name, seen.name)
        error_types.clear()
    with_state(go)


def test_cron_runs_alerts_after_samples_and_never_fails(monkeypatch):
    from app.workers import sync_worker
    from app.services.health import samples
    order = []

    async def fake_write(collectors, c, now=None):
        order.append("samples")
        return 1

    async def fake_ensure(db, **k):
        pass

    async def fake_alerts(*a, **k):
        order.append("alerts")
        raise RuntimeError("boom")
    monkeypatch.setattr(samples, "write_samples", fake_write)
    monkeypatch.setattr(samples, "ensure_collection", fake_ensure)
    monkeypatch.setattr(alerts, "run_alerts", fake_alerts)
    out = run(sync_worker.task_health_samples({}))
    assert order == ["samples", "alerts"] and out["written"] == 1
