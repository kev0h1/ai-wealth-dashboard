"""E7: /ops/health metrics collectors, fakes only (the one trend-store cap
test uses the disposable per-run test database conftest provides)."""
import asyncio
import os
import pickle
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.services import health
from app.services.health import base, samples
from app.services.health.external import RailwayCollector, UpstreamError, VercelCollector
from app.services.health.latency import (
    ApiLatencyCollector, LatencyMiddleware, RingBuffer, aggregate,
)
from app.services.health.llm import LlmTavilyCollector
from app.services.health.mongo import MongoCollector
from app.services.health.push import PushDeliveryCollector
from app.services.health.sync import FinexerSyncCollector
from app.services.health.vps import VpsCollector
from app.services.health.worker import WorkerQueueCollector

OWNER = {"email": "kevin.maingi12@gmail.com"}


@pytest.fixture(autouse=True)
def _no_external(monkeypatch):
    monkeypatch.setenv("HEALTH_EXTERNAL_CALLS", "0")
    for k in ("RAILWAY_API_TOKEN", "VERCEL_API_TOKEN", "VERCEL_PROJECT_ID", "LLM_MONTHLY_BUDGET_USD",
              "MONGO_STORAGE_LIMIT_MB"):
        monkeypatch.delenv(k, raising=False)


def run(coro):
    return asyncio.run(coro)


def naive_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)  # naive-ok: test fixture clock


# ---- ring buffer and latency collector ------------------------------------

def test_ring_buffer_is_bounded_and_drops_oldest():
    ring = RingBuffer(maxlen=100)
    for i in range(1000):
        ring.record("/a", "GET", 200, float(i))
    assert len(ring) == 100
    assert min(s[4] for s in ring.samples(0)) == 900.0


def test_aggregation_percentiles_and_error_rate_per_route():
    now = 1_000_000.0
    ring = RingBuffer()
    for ms in range(1, 101):
        ring.record("/x/{id}", "GET", 200, float(ms), ts=now)
    for _ in range(5):
        ring.record("/y", "POST", 500, 10.0, ts=now)
    ring.record("/old", "GET", 200, 9999.0, ts=now - 7200)
    data = aggregate(ring.samples(now - 3600))
    by = {r["route"]: r for r in data["routes"]}
    assert by["GET /x/{id}"]["p50_ms"] == 50.0 and by["GET /x/{id}"]["p95_ms"] == 95.0
    assert by["POST /y"]["error_rate"] == 1.0
    assert "GET /old" not in by
    assert data["overall"]["count"] == 105


def _latency(ring, now):
    return run(ApiLatencyCollector(ring, now=lambda: now).collect())


def test_latency_thresholds_ok_warn_crit_and_empty():
    now = 5000.0
    assert _latency(RingBuffer(), now)["status"] == "ok"
    for ms, expect in ((200, "ok"), (2000, "warn"), (4000, "crit")):
        ring = RingBuffer()
        for _ in range(30):
            ring.record("/a", "GET", 200, ms, ts=now)
        assert _latency(ring, now)["status"] == expect
    ring = RingBuffer()
    for i in range(30):
        ring.record("/a", "GET", 500 if i < 5 else 200, 10, ts=now)   # 16% errors
    assert _latency(ring, now)["status"] == "crit"
    ring = RingBuffer()
    for i in range(5):
        ring.record("/a", "GET", 500, 10, ts=now)       # too few samples to judge
    assert _latency(ring, now)["status"] == "ok"


def test_middleware_records_route_template_status_and_nothing_else():
    from fastapi import FastAPI
    ring = RingBuffer()
    app = FastAPI()

    @app.get("/items/{item_id}")
    async def item(item_id: str):
        return {"ok": True}

    @app.get("/boom")
    async def boom():
        raise RuntimeError("secret merchant Greggs")

    app.add_middleware(LatencyMiddleware, ring=ring)
    client = TestClient(app, raise_server_exceptions=False)
    client.get("/items/abc123?token=zzz")
    client.get("/nope")
    client.get("/boom")
    rows = {(s[1], s[2], s[3]) for s in ring.samples(0)}
    assert ("GET", "/items/{item_id}", 200) in rows
    assert ("GET", "(unmatched)", 404) in rows
    assert ("GET", "/boom", 500) in rows
    flat = repr(list(ring.samples(0)))
    assert "abc123" not in flat and "zzz" not in flat and "Greggs" not in flat


# ---- budget mechanism ------------------------------------------------------

class _Hang(base.Collector):
    name, title = "hang", "Hang"

    async def collect(self):
        await asyncio.sleep(30)


class _Boom(base.Collector):
    name, title = "boom", "Boom"

    async def collect(self):
        raise ValueError("upstream said: balance 1234.56 for Greggs")


class _Fast(base.Collector):
    name, title = "fast", "Fast"

    async def collect(self):
        return base.result("fast", values={"n": 1})


def test_hanging_collector_times_out_and_does_not_block_others():
    t = time.perf_counter()
    out = run(base.run_all([_Hang(), _Boom(), _Fast()], budget_s=0.2))
    assert time.perf_counter() - t < 1.0
    assert out["hang"]["state"] == "timed_out" and out["hang"]["status"] == "unknown"
    assert out["boom"]["state"] == "error" and "Greggs" not in repr(out["boom"]) and "1234" not in repr(out["boom"])
    assert out["fast"]["state"] == "ok" and out["fast"]["status"] == "ok"


def test_collectors_endpoint_returns_within_budget_with_one_hanging(monkeypatch):
    from app.routers import ops
    monkeypatch.setattr(base, "BUDGET_S", 0.3)
    monkeypatch.setattr(health, "BUDGET_S", 0.3)
    hang = _Hang()
    hang.budget_s = 0.3
    monkeypatch.setattr(health, "default_collectors", lambda: [_Fast(), hang])
    t = time.perf_counter()
    out = run(ops.ops_health_collectors(OWNER))
    assert time.perf_counter() - t < 1.0
    by = {c["name"]: c for c in out["collectors"]}
    assert by["hang"]["state"] == "timed_out" and by["fast"]["state"] == "ok"


def test_ops_collector_endpoints_are_owner_only(monkeypatch):
    from app.routers import ops
    monkeypatch.setattr(health, "default_collectors", lambda: [_Fast()])
    for call in (lambda: ops.ops_health_collectors({"email": "x@y.co"}),
                 lambda: ops.ops_health_collector("fast", {"email": "x@y.co"}),
                 lambda: ops.ops_health_trends({"email": "x@y.co"})):
        with pytest.raises(HTTPException) as e:
            run(call())
        assert e.value.status_code == 403
    assert run(ops.ops_health_collector("fast", OWNER))["state"] == "ok"
    with pytest.raises(HTTPException) as e:
        run(ops.ops_health_collector("nope", OWNER))
    assert e.value.status_code == 404


def test_default_collectors_are_the_nine_sections_and_unique():
    names = [c.name for c in health.default_collectors()]
    assert names == ["api_latency", "finexer_sync", "worker", "llm_tavily", "mongo", "vps", "railway", "vercel", "push"]
    assert [c.name for c in health.default_collectors() if c.external] == ["railway", "vercel"]


# ---- fakes -----------------------------------------------------------------

class FakeCol:
    def __init__(self, docs=None, counts=None, found=None):
        self.docs, self.counts, self.found, self.queries = docs or [], counts or {}, found, []

    async def find_one(self, filt, proj=None):
        self.queries.append(filt)
        if "_id" in filt and not isinstance(filt["_id"], dict):
            return next((d for d in self.docs if d.get("_id") == filt["_id"]), None)
        if "last_webhook_at" in filt:
            return self.found
        return None

    async def count_documents(self, filt):
        self.queries.append(filt)
        for key, n in self.counts.items():
            if key in filt or key in repr(filt):
                return n
        return self.counts.get("*", 0)


# ---- finexer sync ----------------------------------------------------------

def _sync(runs=None, ok=0, failed=0, pending=0, found=None, stale=0):
    consents = FakeCol(counts={"last_synced": ok, "last_sync_error_at": failed, "$in": stale}, found=found)
    return FinexerSyncCollector(FakeCol(docs=runs or []), consents, FakeCol(counts={"*": pending}))


def _run_doc(hours_ago):
    at = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()  # naive-ok: test clock
    return [{"_id": "task_reconcile_truelayer", "summary": {"at": at, "reconciled": 4}}]


def test_sync_thresholds_and_webhook_feature_detect():
    r = run(_sync(_run_doc(1), ok=10, failed=0).collect())
    assert r["status"] == "ok" and "no_webhook_24h" not in r["values"] and "last_webhook_at" in r["note"]
    assert run(_sync(_run_doc(9)).collect())["status"] == "warn"
    assert run(_sync(_run_doc(13)).collect())["status"] == "crit"
    assert run(_sync(_run_doc(1), pending=1).collect())["status"] == "warn"
    assert run(_sync(_run_doc(1), pending=5).collect())["status"] == "crit"
    assert run(_sync(_run_doc(1), ok=7, failed=3).collect())["status"] == "warn"
    assert run(_sync(_run_doc(1), ok=2, failed=8).collect())["status"] == "crit"
    r = run(_sync(_run_doc(1), found={"_id": "c"}, stale=2).collect())
    assert r["values"]["no_webhook_24h"] == 2 and r["status"] == "warn" and r["note"] is None


# ---- worker ----------------------------------------------------------------

class FakeRedis:
    def __init__(self, depth=0, oldest_ms=None, running=0, results=(), heartbeat=True):
        self.depth, self.oldest_ms, self.running, self.results, self.heartbeat = depth, oldest_ms, running, list(results), heartbeat
        self.closed, self.writes = False, 0

    async def zcard(self, key):
        return self.depth

    async def zrange(self, key, a, b, withscores=False):
        return [(b"job", self.oldest_ms)] if self.oldest_ms is not None else []

    async def scan_iter(self, match=None, count=None):
        n = self.running if "in-progress" in match else len(self.results)
        for i in range(n):
            yield f"k{i}"

    async def get(self, key):
        return self.results[int(key[1:])]

    async def exists(self, key):
        return 1 if self.heartbeat else 0

    async def aclose(self):
        self.closed = True


def _worker(fake, decode=lambda raw: raw == b"fail", now=None):
    return WorkerQueueCollector(lambda: fake, decode, now=now or time.time)


def test_worker_thresholds_and_failed_count():
    now = 2_000_000.0
    r = run(_worker(FakeRedis(depth=3, oldest_ms=(now - 5) * 1000), now=lambda: now).collect())
    assert r["status"] == "ok" and r["values"]["queue_depth"] == 3
    assert run(_worker(FakeRedis(depth=60), now=lambda: now).collect())["status"] == "warn"
    assert run(_worker(FakeRedis(depth=300), now=lambda: now).collect())["status"] == "crit"
    assert run(_worker(FakeRedis(depth=1, oldest_ms=(now - 900) * 1000), now=lambda: now).collect())["status"] == "warn"
    assert run(_worker(FakeRedis(depth=1, oldest_ms=(now - 7200) * 1000), now=lambda: now).collect())["status"] == "crit"
    fake = FakeRedis(results=[b"ok", b"fail", b"fail"])
    r = run(_worker(fake, now=lambda: now).collect())
    assert r["values"]["failed_recent"] == 2 and r["values"]["finished_recent"] == 3 and r["status"] == "warn"
    assert fake.closed
    crit = FakeRedis(results=[b"fail"] * 10)
    assert run(_worker(crit, now=lambda: now).collect())["status"] == "crit"


def test_worker_decodes_real_arq_results_and_never_writes():
    from arq.jobs import serialize_result
    from app.services.health.worker import _failed

    def blob(success):
        return serialize_result("f", (), {}, 1, 1000, success, 1 if success else ValueError("x"), 1000, 2000,
                                "ref", "arq:queue", "job", serializer=pickle.dumps)
    assert _failed(blob(True)) is False
    assert _failed(blob(False)) is True
    assert _failed(b"garbage") is None
    assert not [m for m in dir(FakeRedis) if m in ("set", "delete", "zadd", "setex")]


# ---- llm and tavily --------------------------------------------------------

class FakeAgg:
    def __init__(self, rows):
        self.rows = rows

    def to_list(self, n):
        async def go():
            return self.rows
        return go()


class FakeUsage:
    def __init__(self, month, week):
        self.month, self.week, self.calls = month, week, 0

    def aggregate(self, pipeline):
        self.calls += 1
        return FakeAgg(self.month if "year_month" in pipeline[0]["$match"] else self.week)


def _llm(research=None, month=None, week=None):
    async def load():
        return research
    month = month if month is not None else [
        {"_id": {"p": "penny", "tavily": False}, "cost_usd": 8.0, "calls": 40},
        {"_id": {"p": "tips", "tavily": True}, "cost_usd": 0.0, "calls": 12},
    ]
    return LlmTavilyCollector(FakeUsage(month, week or month), load)


def test_llm_spend_budget_thresholds_and_tavily_counters(monkeypatch):
    r = run(_llm().collect())
    assert r["status"] == "ok" and r["values"]["month_cost_usd"] == 8.0
    assert r["values"]["tavily"]["calls_month"] == 12 and r["values"]["month_by_pipeline"][0]["pipeline"] == "penny"
    assert "budget" in r["note"].lower()
    monkeypatch.setenv("LLM_MONTHLY_BUDGET_USD", "10")
    assert run(_llm().collect())["status"] == "warn"
    monkeypatch.setenv("LLM_MONTHLY_BUDGET_USD", "8")
    assert run(_llm().collect())["status"] == "crit"


def test_tavily_backoff_states():
    now = naive_now()
    failing = {"research_status": "failing", "last_error_code": "quota", "skip_until": now + timedelta(hours=5), "failing_since": now}
    r = run(_llm(failing).collect())
    assert r["status"] == "crit" and r["values"]["tavily"]["backoff_active"] is True
    soft = {"research_status": "failing", "last_error_code": "server", "last_error_at": now}
    assert run(_llm(soft).collect())["status"] == "warn"
    assert run(_llm({"research_status": "ok"}).collect())["status"] == "ok"


# ---- mongo -----------------------------------------------------------------

class FakeDb:
    def __init__(self, storage_mb=100, index_mb=10, profile_level=0, slow=0, collections=()):
        self.storage, self.index, self.level, self.slow, self.names = storage_mb, index_mb, profile_level, slow, list(collections)
        self.commands = []

    async def command(self, name, *args):
        self.commands.append((name, args))
        if name == "dbStats":
            return {"dataSize": self.storage * 1048576 / 2, "storageSize": self.storage * 1048576,
                    "indexSize": self.index * 1048576, "collections": 42, "objects": 1000}
        if name == "profile":
            assert args == (-1,), "must only read the profiling level"
            return {"was": self.level}
        raise AssertionError(name)

    def __getitem__(self, name):
        return FakeCol(counts={"millis": self.slow})

    async def list_collection_names(self):
        return self.names


def test_mongo_thresholds_profiler_off_and_on(monkeypatch):
    db = FakeDb()
    r = run(MongoCollector(db).collect())
    assert r["status"] == "ok" and r["values"]["collections"] == 42 and "profiler is off" in r["note"]
    assert "slow_queries_24h" not in r["values"]
    assert all(c[0] in ("dbStats", "profile") and (c[0] != "profile" or c[1] == (-1,)) for c in db.commands)
    monkeypatch.setenv("MONGO_STORAGE_LIMIT_MB", "140")
    assert run(MongoCollector(FakeDb(storage_mb=100)).collect())["status"] == "warn"
    assert run(MongoCollector(FakeDb(storage_mb=128)).collect())["status"] == "crit"
    monkeypatch.delenv("MONGO_STORAGE_LIMIT_MB")
    r = run(MongoCollector(FakeDb(profile_level=1, slow=50)).collect())
    assert r["values"]["slow_queries_24h"] == 50 and r["status"] == "warn"
    assert run(MongoCollector(FakeDb(profile_level=2, slow=500)).collect())["status"] == "crit"


# ---- vps -------------------------------------------------------------------

class FakeHost:
    def __init__(self, mem=60.0, avail=4000, disk=50.0, load5=1.0, cpus=4):
        self._m = {"total_mb": 12000, "available_mb": avail, "used_pct": mem}
        self._d = {"total_gb": 100.0, "free_gb": 50.0, "used_pct": disk}
        self._l = {"cpus": cpus, "load_1m": load5, "load_5m": load5, "load_15m": load5}

    memory = lambda self: self._m
    disk = lambda self: self._d
    load = lambda self: self._l
    uptime_hours = lambda self: 12.5


def test_vps_thresholds_cpu_and_uptime():
    r = run(VpsCollector(FakeHost()).collect())
    assert r["status"] == "ok" and r["values"]["cpus"] == 4 and r["values"]["uptime_hours"] == 12.5
    assert run(VpsCollector(FakeHost(mem=80)).collect())["status"] == "warn"
    assert run(VpsCollector(FakeHost(mem=95)).collect())["status"] == "crit"
    assert run(VpsCollector(FakeHost(disk=91)).collect())["status"] == "crit"
    assert run(VpsCollector(FakeHost(load5=3.2)).collect())["status"] == "warn"
    assert run(VpsCollector(FakeHost(avail=1000)).collect())["status"] == "warn"
    assert run(VpsCollector(FakeHost(avail=500)).collect())["status"] == "crit"


# ---- railway and vercel ----------------------------------------------------

def test_external_collectors_not_configured_and_no_network_when_off(monkeypatch):
    async def no_fetch(*a, **k):
        raise AssertionError("network call made")
    for c in (RailwayCollector(no_fetch), VercelCollector(no_fetch)):
        r = run(c.collect())
        assert r["state"] == "not_configured" and "Not configured" in r["note"] and r["status"] == "unknown"
    monkeypatch.setenv("RAILWAY_API_TOKEN", "tok-secret")
    monkeypatch.setenv("VERCEL_API_TOKEN", "tok-secret")
    monkeypatch.setenv("VERCEL_PROJECT_ID", "prj")
    # tokens set but the master switch is off (HEALTH_EXTERNAL_CALLS=0): still no call
    assert run(RailwayCollector(no_fetch).collect())["state"] == "not_configured"
    assert run(VercelCollector(no_fetch).collect())["state"] == "not_configured"


def _railway_fetch(status="SUCCESS"):
    calls = []

    async def fetch(method, url, *, headers, json=None, params=None):
        calls.append((url, headers, json))
        q = json["query"]
        if "projectToken" in q:
            return {"data": {"projectToken": {"projectId": "p1", "environmentId": "e1"}}}
        if "services" in q:
            return {"data": {"project": {"name": "proj", "services": {"edges": [
                {"node": {"id": "s1", "name": "api"}}, {"node": {"id": "s2", "name": "worker"}}]}}}}
        created = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()  # naive-ok: test clock
        st = status if json["variables"]["s"] == "s1" else "SUCCESS"
        return {"data": {"deployments": {"edges": [{"node": {"status": st, "createdAt": created}}]}}}
    fetch.calls = calls
    return fetch


def test_railway_collector(monkeypatch):
    monkeypatch.setenv("HEALTH_EXTERNAL_CALLS", "1")
    monkeypatch.setenv("RAILWAY_API_TOKEN", "tok-secret")
    f = _railway_fetch()
    r = run(RailwayCollector(f).collect())
    assert r["status"] == "ok" and r["values"]["service_count"] == 2
    assert r["values"]["services"][0]["status"] == "SUCCESS" and 2.9 < r["values"]["services"][0]["age_hours"] < 3.2
    assert all(h.get("Project-Access-Token") == "tok-secret" for _, h, _ in f.calls)
    assert "tok-secret" not in repr(r)
    assert run(RailwayCollector(_railway_fetch("CRASHED")).collect())["status"] == "crit"

    async def denied(*a, **k):
        raise UpstreamError("HTTP 401")
    out = run(base.run_collector(RailwayCollector(denied)))
    assert out["state"] == "error" and "tok-secret" not in repr(out)


def test_vercel_collector(monkeypatch):
    monkeypatch.setenv("HEALTH_EXTERNAL_CALLS", "1")
    monkeypatch.setenv("VERCEL_API_TOKEN", "tok-secret")
    monkeypatch.setenv("VERCEL_PROJECT_ID", "prj")
    now_ms = int(time.time() * 1000)
    seen = {}

    async def fetch(method, url, *, headers, json=None, params=None):
        seen.update(url=url, headers=headers, params=params)
        return {"deployments": [{"state": "READY", "created": now_ms - 3_600_000, "target": "production"},
                                {"state": "ERROR", "created": now_ms - 99_000_000}], "pagination": {}}
    r = run(VercelCollector(fetch).collect())
    assert r["status"] == "ok" and r["values"]["deployments_month"] == 2 and r["values"]["errors_month"] == 1
    assert r["values"]["latest_state"] == "READY" and 0.9 < r["values"]["latest_age_hours"] < 1.1
    assert "billing" not in seen["url"] and "/v6/deployments" in seen["url"] and "tok-secret" not in repr(r)

    async def bad(*a, **k):
        return {"deployments": [{"state": "ERROR", "created": now_ms}]}
    assert run(VercelCollector(bad).collect())["status"] == "crit"


# ---- push ------------------------------------------------------------------

def test_push_omitted_without_log_and_counts_with_one():
    r = run(PushDeliveryCollector(FakeDb()).collect())
    assert r["state"] == "omitted" and "No push delivery log" in r["note"]

    class Db(FakeDb):
        def __getitem__(self, name):
            return FakeCol(counts={"sent": 90, "failed": 10})
    r = run(PushDeliveryCollector(Db(collections=["push_log"])).collect())
    assert r["values"] == {"sent_24h": 90, "failed_24h": 10} and r["status"] == "warn"


# ---- trend store and cron --------------------------------------------------

class InsertCol:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        from pymongo.errors import DuplicateKeyError
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = doc


def test_write_samples_one_doc_per_collector_per_bucket_skips_external():
    col = InsertCol()
    cs = [_Fast(), VpsCollector(FakeHost()), RailwayCollector()]
    assert run(samples.write_samples(cs, col, now=1000.0)) == 2
    assert run(samples.write_samples(cs, col, now=1100.0)) == 0      # same 5 minute bucket
    assert run(samples.write_samples(cs, col, now=1300.0)) == 2      # next bucket
    docs = list(col.docs.values())
    assert {d["collector"] for d in docs} == {"fast", "vps"}
    vps = next(d for d in docs if d["collector"] == "vps")
    assert vps["metrics"] == {"memory_used_pct": 60.0, "memory_available_mb": 4000, "disk_used_pct": 50.0} and vps["status"] == "ok"


def test_cron_task_writes_samples_for_worker_world_only(monkeypatch):
    from app.workers import sync_worker
    col = InsertCol()
    seen = {}

    async def fake_write(collectors, c, now=None):
        seen["names"] = [x.name for x in collectors]
        return len(collectors)

    async def fake_ensure(db, **k):
        seen["ensured"] = True
    monkeypatch.setattr(samples, "write_samples", fake_write)
    monkeypatch.setattr(samples, "ensure_collection", fake_ensure)
    out = run(sync_worker.task_health_samples({}))
    assert seen["ensured"] and out["written"] == 6
    assert seen["names"] == ["finexer_sync", "worker", "llm_tavily", "mongo", "vps", "push"]
    assert "api_latency" not in seen["names"] and "railway" not in seen["names"] and "vercel" not in seen["names"]
    names = [j.coroutine.__name__ for j in sync_worker.WorkerSettings.cron_jobs]
    assert "task_health_samples" in names and sync_worker.task_health_samples in sync_worker.WorkerSettings.functions


def test_thirty_day_cap_configuration():
    assert samples.RETENTION_DAYS == 30
    per_day = 86400 // samples.BUCKET_S
    assert samples.MAX_DOCS >= samples.SAMPLED_COLLECTORS * per_day * 30
    assert samples.MAX_DOCS < samples.SAMPLED_COLLECTORS * per_day * 31
    sampled = [c for c in health.default_collectors() if not c.external]
    assert len(sampled) == samples.SAMPLED_COLLECTORS


def test_capped_collection_drops_oldest_beyond_cap():
    import uuid
    from motor.motor_asyncio import AsyncIOMotorClient
    from app.core.config import MONGO_URI

    async def go():
        client = AsyncIOMotorClient(MONGO_URI)
        assert os.environ["MONGO_DB"] != "wealth"
        db = client[os.environ["MONGO_DB"]]
        name = f"health_samples_t{uuid.uuid4().hex[:8]}"   # lives in the per-run test database
        try:
            await samples.ensure_collection(db, max_docs=10, size=4096, name=name)
            await samples.ensure_collection(db, max_docs=10, size=4096, name=name)   # idempotent
            col = db[name]
            assert (await col.options())["capped"] is True
            for i in range(25):
                await col.insert_one({"_id": f"c:{i}", "collector": "c", "ts": naive_now(), "metrics": {}})
            assert await col.count_documents({}) <= 10
            assert await col.find_one({"_id": "c:24"}) is not None and await col.find_one({"_id": "c:0"}) is None
        finally:
            client.close()
    run(go())


def test_trends_24h_and_7d_min_avg_max():
    now = naive_now()
    rows = [
        {"collector": "api_latency", "ts": now - timedelta(days=3), "metrics": {"p95_ms": 100.0}},
        {"collector": "api_latency", "ts": now - timedelta(hours=2), "metrics": {"p95_ms": 300.0}},
        {"collector": "api_latency", "ts": now - timedelta(hours=1), "metrics": {"p95_ms": 500.0}},
    ]

    class Cursor:
        def __init__(self, r):
            self.r = r

        def sort(self, *a):
            return self

        async def to_list(self, n):
            return self.r

    class Col:
        def find(self, filt, proj=None):
            if filt["collector"] != "api_latency":
                return Cursor([])
            return Cursor([r for r in rows if r["ts"] >= filt["ts"]["$gte"]])

    t = run(samples.trends(Col()))
    p = t["p95_ms"]
    assert p["d7"]["min"] == 100.0 and p["d7"]["max"] == 500.0 and p["d7"]["avg"] == 300.0 and p["d7"]["n"] == 3
    assert p["h24"]["min"] == 300.0 and p["h24"]["avg"] == 400.0 and p["h24"]["n"] == 2
    assert t["queue_depth"]["d7"]["n"] == 0 and t["queue_depth"]["d7"]["avg"] is None
    assert set(t) == {"p95_ms", "queue_depth", "mongo_storage_mb", "memory_used_pct"}


def test_manifest_lists_health_samples_and_no_naive_clock():
    from app.db import collections as c
    assert "health_samples_col" in c.ERASURE_MANIFEST and c.health_samples_col.name == "health_samples"


def test_app_registers_latency_middleware_outermost():
    from app.main import app
    assert app.user_middleware[0].cls is LatencyMiddleware


def test_worker_missing_heartbeat_is_warn_or_crit_with_queue():
    now = 2_000_000.0
    assert run(_worker(FakeRedis(heartbeat=False), now=lambda: now).collect())["status"] == "warn"
    assert run(_worker(FakeRedis(depth=2, oldest_ms=(now - 5) * 1000, heartbeat=False), now=lambda: now).collect())["status"] == "crit"
    assert run(_worker(FakeRedis(heartbeat=True), now=lambda: now).collect())["status"] == "ok"


def test_middleware_skips_unmatched_401_but_keeps_unmatched_404():
    from fastapi import FastAPI, Response
    ring = RingBuffer()
    app = FastAPI()

    @app.middleware("http")
    async def deny(request, call_next):
        if request.url.path.startswith("/private"):
            return Response(status_code=401)
        return await call_next(request)

    app.add_middleware(LatencyMiddleware, ring=ring)
    client = TestClient(app)
    client.get("/private/x")
    client.get("/nope")
    rows = {(s[2], s[3]) for s in ring.samples(0)}
    assert rows == {("(unmatched)", 404)}
