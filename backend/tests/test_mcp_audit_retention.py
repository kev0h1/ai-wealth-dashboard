"""F14: /mcp connector audit log retention. `mcp_calls_col` (the browsable
per-call audit log, app/routers/mcp.py) now carries a TTL index
(`MCP_AUDIT_TTL_DAYS`, app/main.py) so it cannot grow unbounded. The monthly
allowance must NOT depend on that collection's row count, since TTL expiry
would then silently reset a user's usage mid-cycle — it reads a separate,
never-expired counter instead: `mcp_call_counters_col`, one doc per
(user_id, year_month), incremented via `$inc` in `app.routers.mcp._write_audit`
and read via `app.core.subscription._mcp_call_count`.

Same conventions as tests/test_mcp_endpoint.py and tests/test_mcp_call_packs.py:
plain `asyncio.run`, no TestClient/real Mongo, module-level names monkeypatched
directly on `app.routers.mcp`/`app.db.collections`/`app.core.subscription`'s
own namespaces.
"""
import asyncio
from datetime import datetime, timezone

import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.main as main_module
import app.routers.mcp as mcp

UID = "mcp-audit-retention-test@example.com"


def _run(coro):
    return asyncio.run(coro)


def _ym() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


# ── shared fakes ─────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for r in self._rows:
            yield r


class _FakeAuditCol:
    """Stands in for `mcp_calls_col`."""

    def __init__(self, seed=None):
        self.docs: list[dict] = list(seed or [])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    def find(self, query, proj=None):
        uid = query.get("user_id")
        ym = query.get("year_month")
        rows = [d for d in self.docs if d.get("user_id") == uid and d.get("year_month") == ym]
        return _FakeCursor(rows)

    def aggregate(self, pipeline):
        """Only supports the single `{user_id, year_month}` group-and-count
        pipeline `app.main._seed_mcp_call_counters` issues."""
        from collections import Counter
        counts = Counter((d.get("user_id"), d.get("year_month")) for d in self.docs)
        grouped = [
            {"_id": {"user_id": uid, "year_month": ym}, "count": n}
            for (uid, ym), n in counts.items()
        ]
        return _FakeCursor(grouped)


class _FakeCounterCol:
    """Stands in for `mcp_call_counters_col`. Supports `find_one` (read
    path, `_mcp_call_count`) and `update_one` with `$inc`/`$set`/upsert
    (the live increment in `_write_audit`)."""

    def __init__(self, seed=None):
        self.docs: list[dict] = list(seed or [])

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


class _UpsertResult:
    def __init__(self, upserted_id):
        self.upserted_id = upserted_id


class _FakeSeedCounterCol:
    """Realistic-enough `$setOnInsert`/upsert for testing
    `_seed_mcp_call_counters`'s idempotency: a (user, month) key already
    present is left completely untouched by a second `update_one` call,
    and `result.upserted_id` is only truthy the first time a key is
    created."""

    def __init__(self):
        self.docs: dict[tuple, dict] = {}

    async def update_one(self, query, update, upsert=False):
        uid = query.get("user_id")
        ym = query.get("year_month")
        key = (uid, ym)
        if key in self.docs:
            return _UpsertResult(None)
        if upsert:
            doc = dict(update.get("$setOnInsert") or {})
            self.docs[key] = doc
            return _UpsertResult(f"{uid}:{ym}")
        return _UpsertResult(None)

    async def find_one(self, query):
        uid = query.get("user_id")
        ym = query.get("year_month")
        return self.docs.get((uid, ym))


class _FakeSubscription:
    def __init__(self, tier_name="connect", mcp_limit=2000):
        self.tier_name = tier_name
        self._mcp_limit = mcp_limit

    def limit(self, key):
        return self._mcp_limit


def _principal(uid=UID):
    return {"uid": uid, "client": "session", "scopes": set(mcp.V1_SCOPES)}


def _patch_subscription(monkeypatch, tier_name="connect", mcp_limit=2000):
    async def fake_get_subscription(email):
        return _FakeSubscription(tier_name, mcp_limit)
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)


def _patch_collections(monkeypatch, *, audit_seed=None, counter_seed=None):
    audit = _FakeAuditCol(audit_seed)
    counters = _FakeCounterCol(counter_seed)
    monkeypatch.setattr(mcp, "mcp_calls_col", audit)
    monkeypatch.setattr(db_collections_module, "mcp_calls_col", audit)
    monkeypatch.setattr(mcp, "mcp_call_counters_col", counters)
    monkeypatch.setattr(db_collections_module, "mcp_call_counters_col", counters)
    monkeypatch.setattr(db_collections_module, "mcp_call_packs_col", _FakeAuditCol())
    return audit, counters


def _force_local_redis(monkeypatch):
    async def _not_ok():
        return False
    monkeypatch.setattr(mcp, "redis_ok", _not_ok)


# ── 1. Counter increments by 1 per tools/call ────────────────────────────

def test_counter_increments_by_one_per_tools_call(monkeypatch):
    _patch_subscription(monkeypatch)
    audit, counters = _patch_collections(monkeypatch)

    async def fake_execute_tool(uid, name, args):
        return {"accounts": []}
    monkeypatch.setattr(mcp, "execute_tool", fake_execute_tool)

    principal = _principal()
    assert _run(mcp.check_mcp_allowance(UID))["used"] == 0

    _run(mcp.handle_jsonrpc_request(principal, {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    doc = _run(counters.find_one({"user_id": UID, "year_month": _ym()}))
    assert doc["count"] == 1
    assert len(audit.docs) == 1

    _run(mcp.handle_jsonrpc_request(principal, {
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    doc = _run(counters.find_one({"user_id": UID, "year_month": _ym()}))
    assert doc["count"] == 2
    assert len(audit.docs) == 2


# ── 2. Allowance reads the counter, not mcp_calls_col row count ─────────

def test_allowance_used_reflects_the_counter_not_the_row_count(monkeypatch):
    _patch_subscription(monkeypatch)
    ym = _ym()
    # Counter says 7 calls this month; the audit log only has 3 rows (e.g.
    # some already TTL-reaped). `used` must follow the counter.
    audit_seed = [{"user_id": UID, "year_month": ym, "tool": "get_accounts"} for _ in range(3)]
    counter_seed = [{"user_id": UID, "year_month": ym, "count": 7}]
    _patch_collections(monkeypatch, audit_seed=audit_seed, counter_seed=counter_seed)

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["used"] == 7


# ── 3. Counter survives mcp_calls_col rows being deleted (TTL expiry) ───

def test_counter_survives_audit_rows_being_deleted(monkeypatch):
    _patch_subscription(monkeypatch)
    ym = _ym()
    counter_seed = [{"user_id": UID, "year_month": ym, "count": 5}]
    audit, counters = _patch_collections(monkeypatch, audit_seed=[], counter_seed=counter_seed)

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["used"] == 5

    # Simulate the TTL index reaping every audit row for this user/month.
    audit.docs.clear()

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["used"] == 5


# ── 4. _seed_mcp_call_counters is idempotent ─────────────────────────────

def test_seed_mcp_call_counters_backfills_and_is_idempotent(monkeypatch):
    ym_a = "2026-07"
    ym_b = "2026-08"
    audit = _FakeAuditCol([
        {"user_id": "a@example.com", "year_month": ym_a, "tool": "get_accounts"},
        {"user_id": "a@example.com", "year_month": ym_a, "tool": "get_accounts"},
        {"user_id": "a@example.com", "year_month": ym_a, "tool": "get_goals"},
        {"user_id": "b@example.com", "year_month": ym_b, "tool": "get_accounts"},
    ])
    monkeypatch.setattr(main_module, "mcp_calls_col", audit)
    seed_counters = _FakeSeedCounterCol()
    monkeypatch.setattr(db_collections_module, "mcp_call_counters_col", seed_counters)

    _run(main_module._seed_mcp_call_counters())

    doc_a = _run(seed_counters.find_one({"user_id": "a@example.com", "year_month": ym_a}))
    doc_b = _run(seed_counters.find_one({"user_id": "b@example.com", "year_month": ym_b}))
    assert doc_a["count"] == 3
    assert doc_b["count"] == 1
    assert doc_a["seeded_from_rows"] is True

    # A live increment (simulating _write_audit having run since the first
    # seed pass) must not be clobbered by a second migration run.
    doc_a["count"] = 99

    _run(main_module._seed_mcp_call_counters())
    doc_a_after = _run(seed_counters.find_one({"user_id": "a@example.com", "year_month": ym_a}))
    assert doc_a_after["count"] == 99


# ── 5. GET /mcp/audit is capped ──────────────────────────────────────────

def test_get_mcp_audit_returns_at_most_the_cap(monkeypatch):
    _patch_subscription(monkeypatch)
    _force_local_redis(monkeypatch)
    ym = _ym()
    audit_seed = [
        {"user_id": UID, "year_month": ym, "tool": "get_accounts", "client": "session",
         "ts": datetime(2026, 9, 1, i, tzinfo=timezone.utc), "ok": True}
        for i in range(15)
    ]
    _patch_collections(monkeypatch, audit_seed=audit_seed, counter_seed=[{"user_id": UID, "year_month": ym, "count": 15}])

    result = _run(mcp.get_mcp_audit(month=None, limit=10, user={"email": UID}))
    assert len(result["calls"]) == 10

    result_default = _run(mcp.get_mcp_audit(month=None, limit=10, user={"email": UID}))
    assert len(result_default["calls"]) == 10

    result_small = _run(mcp.get_mcp_audit(month=None, limit=5, user={"email": UID}))
    assert len(result_small["calls"]) == 5

    assert result["limits"]["monthly_used"] == 15
    assert result["year_month"] == ym


# ── 6. No counter doc, no rows: used 0, empty calls, no exceptions ──────

def test_no_counter_and_no_rows_returns_zero_used_and_empty_calls(monkeypatch):
    _patch_subscription(monkeypatch)
    _force_local_redis(monkeypatch)
    _patch_collections(monkeypatch, audit_seed=[], counter_seed=[])

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["used"] == 0

    result = _run(mcp.get_mcp_audit(month=None, limit=10, user={"email": UID}))
    assert result["calls"] == []
    assert result["limits"]["monthly_used"] == 0
