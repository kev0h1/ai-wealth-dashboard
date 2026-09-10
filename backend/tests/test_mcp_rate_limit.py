"""F7: per-principal MCP burst and daily-cap rate limits, replacing the old
per-IP "/mcp" rule in app.core.ratelimit (Claude's and ChatGPT's connectors
call from shared egress ranges, so an IP-keyed bucket would be shared by
every user of the same assistant).

Same conventions as tests/test_mcp_endpoint.py: plain `asyncio.run`, no
TestClient/real Mongo/real Redis, module-level names monkeypatched directly
on `app.core.ratelimit`/`app.routers.mcp`'s own namespace.
"""
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

import app.core.ratelimit as ratelimit_mod
import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.mcp as mcp


def _run(coro):
    return asyncio.run(coro)


def _req(path: str, ip: str = "1.2.3.4"):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={"X-Real-IP": ip},
        client=SimpleNamespace(host=ip),
    )


def _principal(client_id: str | None = None, uid: str = "user@example.com"):
    p = {"uid": uid, "client": "oauth" if client_id else "session", "scopes": set(mcp.V1_SCOPES)}
    if client_id:
        p["client_id"] = client_id
    return p


def _msg(method: str, msg_id=1, **params):
    out = {"jsonrpc": "2.0", "id": msg_id, "method": method}
    if params:
        out["params"] = params
    return out


@pytest.fixture(autouse=True)
def _force_local(monkeypatch):
    """Force both modules onto the in-process fallback path so these tests
    don't depend on a real Redis being reachable, same doctrine as
    tests/test_ratelimit.py's _force_local_path fixture."""
    async def _not_ok():
        return False
    monkeypatch.setattr(ratelimit_mod, "redis_ok", _not_ok)
    monkeypatch.setattr(mcp, "redis_ok", _not_ok)
    ratelimit_mod._hits.clear()
    mcp._daily_local_hits.clear()
    yield
    ratelimit_mod._hits.clear()
    mcp._daily_local_hits.clear()


# ── burst limit ──────────────────────────────────────────────────────────

def test_burst_limit_trips_on_the_61st_tools_call_within_a_minute():
    assert mcp.MCP_BURST_PER_MINUTE == 60
    principal = _principal(client_id="client-burst")
    for i in range(60):
        assert _run(mcp.check_mcp_principal_limit(principal, _msg("tools/call", i))) is None

    resp = _run(mcp.check_mcp_principal_limit(principal, _msg("tools/call", 61)))
    assert resp is not None
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    assert int(resp.headers["Retry-After"]) > 0

    body = json.loads(resp.body)
    assert body["error"]["code"] == -32003
    assert body["error"]["message"] == "Rate limited"
    assert body["error"]["data"]["kind"] == "burst"
    assert body["error"]["data"]["limit"] == 60
    assert body["error"]["data"]["retry_after"] > 0


def test_burst_bucket_is_per_principal_not_shared_by_ip():
    principal_a = _principal(client_id="client-a")
    principal_b = _principal(client_id="client-b")
    for i in range(mcp.MCP_BURST_PER_MINUTE):
        assert _run(mcp.check_mcp_principal_limit(principal_a, _msg("tools/call", i))) is None

    tripped = _run(mcp.check_mcp_principal_limit(principal_a, _msg("tools/call", "over")))
    assert tripped is not None and tripped.status_code == 429

    # A different principal (different client_id), even one that in
    # production could be calling from the exact same shared egress IP,
    # is on its own bucket and is untouched.
    assert _run(mcp.check_mcp_principal_limit(principal_b, _msg("tools/call", "b1"))) is None


# ── daily soft cap ───────────────────────────────────────────────────────

def test_daily_cap_trips_at_501_and_retry_after_points_to_midnight_utc(monkeypatch):
    fixed_now = datetime(2026, 9, 8, 15, 30, 0, tzinfo=timezone.utc)

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    monkeypatch.setattr(mcp, "datetime", _FrozenDatetime)

    key = "daily-cap-key"
    for _ in range(mcp.MCP_DAILY_SOFT_CAP):
        assert _run(mcp._check_mcp_daily_cap(key, mcp.MCP_DAILY_SOFT_CAP)) is None

    retry_after = _run(mcp._check_mcp_daily_cap(key, mcp.MCP_DAILY_SOFT_CAP))
    assert retry_after is not None
    # 15:30 UTC to midnight UTC is 8h30m.
    assert retry_after == 8 * 3600 + 30 * 60


def test_daily_cap_bucket_is_per_principal():
    for _ in range(mcp.MCP_DAILY_SOFT_CAP):
        assert _run(mcp._check_mcp_daily_cap("day-a", mcp.MCP_DAILY_SOFT_CAP)) is None
    assert _run(mcp._check_mcp_daily_cap("day-a", mcp.MCP_DAILY_SOFT_CAP)) is not None
    assert _run(mcp._check_mcp_daily_cap("day-b", mcp.MCP_DAILY_SOFT_CAP)) is None


# ── cheap methods: unmetered against the daily cap, own generous ceiling ─

def test_cheap_methods_never_touch_the_daily_cap(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("initialize/ping/tools/list must not touch the daily cap")
    monkeypatch.setattr(mcp, "_check_mcp_daily_cap", boom)

    principal = _principal(client_id="client-cheap")
    for method in ("initialize", "ping", "tools/list"):
        resp = _run(mcp.check_mcp_principal_limit(principal, _msg(method)))
        assert resp is None


def test_cheap_methods_have_their_own_generous_per_minute_ceiling():
    assert mcp.MCP_CHEAP_METHOD_PER_MINUTE == 240
    principal = _principal(client_id="client-cheap-ceiling")
    for i in range(240):
        assert _run(mcp.check_mcp_principal_limit(principal, _msg("ping", i))) is None
    resp = _run(mcp.check_mcp_principal_limit(principal, _msg("ping", "over")))
    assert resp is not None and resp.status_code == 429
    assert json.loads(resp.body)["error"]["data"]["kind"] == "burst"


# ── other methods pass through untouched ────────────────────────────────

def test_notification_and_unknown_methods_are_not_rate_limited():
    principal = _principal(client_id="client-passthrough")
    assert _run(mcp.check_mcp_principal_limit(principal, {"jsonrpc": "2.0", "method": "notifications/initialized"})) is None
    assert _run(mcp.check_mcp_principal_limit(principal, _msg("resources/list"))) is None


# ── integration through mcp_post: audit doc and allowance side effects ──

class _FakeEmptyCursor:
    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        return
        yield  # pragma: no cover - makes this an async generator function


class _FakeAuditCol:
    def __init__(self):
        self.docs: list[dict] = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def count_documents(self, query):
        return 0

    def find(self, query=None):
        # Doubles as an empty `mcp_call_packs_col` fake (F9) — these tests
        # carry no packs, so settle_mcp_packs' own `col.find(...)` just
        # needs something iterable that yields nothing.
        return _FakeEmptyCursor()


class _FakeCounterCol:
    """F14: stands in for `mcp_call_counters_col`. `_mcp_call_count`
    (behind check_mcp_allowance) only calls `find_one`; `_write_audit`'s
    live increment calls `update_one` with `$inc`/`$set`, upsert=True."""

    def __init__(self):
        self.docs: list[dict] = []

    async def find_one(self, query):
        uid = query.get("user_id")
        ym = query.get("year_month")
        for d in self.docs:
            if d.get("user_id") == uid and d.get("year_month") == ym:
                return d
        return None

    async def update_one(self, query, update, upsert=False):
        uid = query.get("user_id")
        ym = query.get("year_month")
        for d in self.docs:
            if d.get("user_id") == uid and d.get("year_month") == ym:
                for k, v in (update.get("$inc") or {}).items():
                    d[k] = d.get(k, 0) + v
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return
        if upsert:
            doc = {"user_id": uid, "year_month": ym}
            for k, v in (update.get("$inc") or {}).items():
                doc[k] = v
            for k, v in (update.get("$set") or {}).items():
                doc[k] = v
            self.docs.append(doc)


class _FakeSubscription:
    def __init__(self, tier_name="connect", mcp_limit=2000):
        self.tier_name = tier_name
        self._mcp_limit = mcp_limit

    def limit(self, key):
        return self._mcp_limit


class _FakeRequest:
    def __init__(self, body: bytes):
        self._body = body

    async def body(self):
        return self._body


def _tools_call_body(msg_id=1):
    return json.dumps({
        "jsonrpc": "2.0", "id": msg_id, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }).encode()


def test_rate_limited_call_writes_no_audit_doc_and_spends_no_monthly_allowance(monkeypatch):
    principal = _principal(client_id="client-flood")

    async def fake_principal(request):
        return principal
    monkeypatch.setattr(mcp, "resolve_mcp_principal", fake_principal)

    audit = _FakeAuditCol()
    # F9: mcp_allowance (behind check_mcp_allowance) counts/settles through
    # app.db.collections' own names via a lazy import, not app.routers.mcp's
    # top-level ones, so both need to point at the same fakes.
    monkeypatch.setattr(mcp, "mcp_calls_col", audit)
    monkeypatch.setattr(db_collections_module, "mcp_calls_col", audit)
    monkeypatch.setattr(db_collections_module, "mcp_call_packs_col", _FakeAuditCol())
    # F14: mcp_allowance/check_mcp_allowance now read this month's usage from
    # mcp_call_counters_col, not mcp_calls_col row counts.
    counters = _FakeCounterCol()
    monkeypatch.setattr(mcp, "mcp_call_counters_col", counters)
    monkeypatch.setattr(db_collections_module, "mcp_call_counters_col", counters)

    async def fake_get_subscription(uid):
        return _FakeSubscription()
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)

    async def fake_execute_tool(uid, name, args):
        return {"accounts": []}
    monkeypatch.setattr(mcp, "execute_tool", fake_execute_tool)

    for i in range(mcp.MCP_BURST_PER_MINUTE):
        resp = _run(mcp.mcp_post(_FakeRequest(_tools_call_body(i))))
        assert resp.status_code == 200

    assert len(audit.docs) == mcp.MCP_BURST_PER_MINUTE

    resp = _run(mcp.mcp_post(_FakeRequest(_tools_call_body("over"))))
    assert resp.status_code == 429
    body = json.loads(resp.body)
    assert body["error"]["code"] == -32003
    # The rate-limited call wrote no audit doc of its own (still exactly the
    # count from the calls that made it through) and never reached
    # check_mcp_allowance / execute_tool at all.
    assert len(audit.docs) == mcp.MCP_BURST_PER_MINUTE


def test_initialize_and_tools_list_are_not_counted_against_the_daily_cap_end_to_end(monkeypatch):
    principal = _principal(client_id="client-init-loop")

    async def fake_principal(request):
        return principal
    monkeypatch.setattr(mcp, "resolve_mcp_principal", fake_principal)

    def boom(*a, **k):
        raise AssertionError("initialize must not touch the daily cap")
    monkeypatch.setattr(mcp, "_check_mcp_daily_cap", boom)

    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}).encode()
    for _ in range(10):
        resp = _run(mcp.mcp_post(_FakeRequest(body)))
        assert resp.status_code == 200


# ── IP rule stays only on unauthenticated OAuth paths ───────────────────

def test_ip_rule_still_applies_to_oauth_register():
    req = _req("/auth/oauth/register", ip="5.5.5.5")
    for _ in range(10):
        assert _run(ratelimit_mod.check_rate_limit(req)) is None
    resp = _run(ratelimit_mod.check_rate_limit(req))
    assert resp is not None and resp.status_code == 429
    assert "Retry-After" in resp.headers


def test_ip_rule_still_applies_to_oauth_token_and_authorize():
    for path in ("/auth/oauth/token", "/auth/oauth/authorize"):
        ratelimit_mod._hits.clear()
        req = _req(path, ip="5.5.5.6")
        for _ in range(30):
            assert _run(ratelimit_mod.check_rate_limit(req)) is None
        resp = _run(ratelimit_mod.check_rate_limit(req))
        assert resp is not None and resp.status_code == 429


def test_mcp_path_no_longer_has_a_per_ip_rule():
    req = _req("/mcp", ip="6.6.6.6")
    for _ in range(200):
        assert _run(ratelimit_mod.check_rate_limit(req)) is None


# ── Redis outage falls back to local without crashing ───────────────────

def test_check_keyed_limit_falls_back_to_local_on_redis_outage(monkeypatch):
    async def ok():
        return True
    monkeypatch.setattr(ratelimit_mod, "redis_ok", ok)

    class _BoomPipeline:
        def zremrangebyscore(self, *a, **k):
            return self

        def zcard(self, *a, **k):
            return self

        def zadd(self, *a, **k):
            return self

        def expire(self, *a, **k):
            return self

        async def execute(self):
            raise ConnectionError("simulated Redis outage")

    class _BoomRedis:
        def pipeline(self):
            return _BoomPipeline()

    monkeypatch.setattr(ratelimit_mod, "get_redis", lambda: _BoomRedis())
    ratelimit_mod._hits.clear()

    key = "outage-keyed-limit"
    for _ in range(5):
        assert _run(ratelimit_mod.check_keyed_limit(key, 5, 60)) is None
    retry_after = _run(ratelimit_mod.check_keyed_limit(key, 5, 60))
    assert retry_after is not None and retry_after > 0


def test_daily_cap_falls_back_to_local_on_redis_outage(monkeypatch):
    async def ok():
        return True
    monkeypatch.setattr(mcp, "redis_ok", ok)

    class _BoomClient:
        def pipeline(self):
            raise ConnectionError("simulated Redis outage")

        async def get(self, *a, **k):
            raise ConnectionError("simulated Redis outage")

    monkeypatch.setattr(mcp, "get_redis", lambda: _BoomClient())

    key = "outage-daily-cap"
    for _ in range(3):
        assert _run(mcp._check_mcp_daily_cap(key, mcp.MCP_DAILY_SOFT_CAP)) is None
