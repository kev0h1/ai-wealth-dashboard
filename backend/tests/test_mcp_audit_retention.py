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
from datetime import datetime, timedelta, timezone

from bson import ObjectId

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

def _matches(doc: dict, query: dict) -> bool:
    """Minimal Mongo query-language subset needed by this file: equality,
    `$lt`, and `$or` of sub-clauses — exactly what `get_mcp_audit` builds
    (see app/routers/mcp.py), nothing more, so this stays an honest stand-in
    for the query the real endpoint issues rather than a bespoke shortcut."""
    for k, v in query.items():
        if k == "$or":
            if not any(_matches(doc, sub) for sub in v):
                return False
            continue
        actual = doc.get(k)
        if isinstance(v, dict):
            for op, opval in v.items():
                if op == "$lt":
                    if actual is None or not (actual < opval):
                        return False
                else:
                    raise NotImplementedError(f"fake query: unsupported operator {op!r}")
        else:
            if actual != v:
                return False
    return True


class _FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)

    def sort(self, spec, direction=None):
        # `get_mcp_audit` always sorts `[("ts", -1), ("_id", -1)]` (a single
        # descending compound sort) — this fake only needs to support that
        # shape (plus the single-key `"ts", -1` shape other callers might
        # use), not general mixed-direction sorting.
        if isinstance(spec, str):
            spec = [(spec, direction if direction is not None else 1)]
        dirs = {d for _, d in spec}
        assert len(dirs) == 1, "fake only supports uniform-direction compound sorts"
        reverse = next(iter(dirs)) < 0
        keys = [k for k, _ in spec]
        self._rows = sorted(self._rows, key=lambda d: tuple(d.get(k) for k in keys), reverse=reverse)
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
    """Stands in for `mcp_calls_col`. Every doc gets a real `bson.ObjectId`
    `_id` (assigned in insertion order if the seed doesn't carry one),
    matching production Mongo closely enough that `get_mcp_audit`'s
    `_id`-tiebreaker cursor logic exercises the real comparison types
    (`ObjectId.__lt__`), not a stand-in that would hide a type mismatch."""

    def __init__(self, seed=None):
        self.docs: list[dict] = []
        for d in (seed or []):
            doc = dict(d)
            doc.setdefault("_id", ObjectId())
            self.docs.append(doc)

    async def insert_one(self, doc):
        d = dict(doc)
        d.setdefault("_id", ObjectId())
        self.docs.append(d)

    def find(self, query, proj=None):
        rows = [d for d in self.docs if _matches(d, query)]
        return _FakeCursor(rows)

    async def distinct(self, field, query=None):
        query = query or {}
        return sorted({d.get(field) for d in self.docs if _matches(d, query) and d.get(field) is not None})

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

    result = _run(mcp.get_mcp_audit(month=None, limit=10, cursor=None, client=None, user={"email": UID}))
    assert len(result["calls"]) == 10

    result_default = _run(mcp.get_mcp_audit(month=None, limit=10, cursor=None, client=None, user={"email": UID}))
    assert len(result_default["calls"]) == 10

    result_small = _run(mcp.get_mcp_audit(month=None, limit=5, cursor=None, client=None, user={"email": UID}))
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

    result = _run(mcp.get_mcp_audit(month=None, limit=10, cursor=None, client=None, user={"email": UID}))
    assert result["calls"] == []
    assert result["limits"]["monthly_used"] == 0


# ── 7. Cursor pages tile the full result set with no gap or overlap ─────

def test_cursor_pages_tile_with_no_gap_or_overlap(monkeypatch):
    _patch_subscription(monkeypatch)
    _force_local_redis(monkeypatch)
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    audit_seed = [
        {
            "user_id": UID, "year_month": "2026-09", "tool": "get_accounts",
            "client": "session", "ts": base + timedelta(seconds=i), "ok": True,
        }
        for i in range(25)
    ]
    _patch_collections(
        monkeypatch, audit_seed=audit_seed,
        counter_seed=[{"user_id": UID, "year_month": "2026-09", "count": 25}],
    )

    seen_ts: list[str] = []
    cursor = None
    pages = 0
    while True:
        result = _run(mcp.get_mcp_audit(month="all", limit=10, cursor=cursor, client=None, user={"email": UID}))
        pages += 1
        seen_ts.extend(c["ts"] for c in result["calls"])
        cursor = result["next_cursor"]
        if cursor is None:
            break
        assert pages < 10, "pagination did not terminate"

    assert pages == 3  # 10 + 10 + 5
    # No gap, no overlap: every seeded row shows up exactly once across pages,
    # most recent first.
    assert len(seen_ts) == 25
    assert len(set(seen_ts)) == 25
    expected = sorted((row["ts"].isoformat() for row in audit_seed), reverse=True)
    assert seen_ts == expected


# ── 8. The last page's cursor is null; earlier pages' are not ───────────

def test_last_page_cursor_is_null_earlier_pages_are_not(monkeypatch):
    _patch_subscription(monkeypatch)
    _force_local_redis(monkeypatch)
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    audit_seed = [
        {"user_id": UID, "year_month": "2026-09", "tool": "get_accounts", "client": "session",
         "ts": base + timedelta(seconds=i), "ok": True}
        for i in range(12)
    ]
    _patch_collections(
        monkeypatch, audit_seed=audit_seed,
        counter_seed=[{"user_id": UID, "year_month": "2026-09", "count": 12}],
    )

    page1 = _run(mcp.get_mcp_audit(month="all", limit=10, cursor=None, client=None, user={"email": UID}))
    assert len(page1["calls"]) == 10
    assert page1["next_cursor"] is not None

    page2 = _run(mcp.get_mcp_audit(month="all", limit=10, cursor=page1["next_cursor"], client=None, user={"email": UID}))
    assert len(page2["calls"]) == 2
    assert page2["next_cursor"] is None


# ── 9. The client filter narrows results; `clients` stays the full list ─

def test_client_filter_narrows_results_and_clients_list_stays_full(monkeypatch):
    _patch_subscription(monkeypatch)
    _force_local_redis(monkeypatch)
    base = datetime(2026, 9, 1, tzinfo=timezone.utc)
    audit_seed = (
        [
            {"user_id": UID, "year_month": "2026-09", "tool": "get_accounts", "client": "Claude",
             "ts": base + timedelta(seconds=i), "ok": True}
            for i in range(4)
        ]
        + [
            {"user_id": UID, "year_month": "2026-09", "tool": "get_goals", "client": "ChatGPT",
             "ts": base + timedelta(seconds=100 + i), "ok": True}
            for i in range(3)
        ]
    )
    _patch_collections(
        monkeypatch, audit_seed=audit_seed,
        counter_seed=[{"user_id": UID, "year_month": "2026-09", "count": 7}],
    )

    result = _run(mcp.get_mcp_audit(month="all", limit=50, cursor=None, client="Claude", user={"email": UID}))
    assert len(result["calls"]) == 4
    assert all(c["client"] == "Claude" for c in result["calls"])
    assert result["next_cursor"] is None
    # The filter dropdown's own option list must not collapse to just the
    # currently-selected client.
    assert set(result["clients"]) == {"Claude", "ChatGPT"}


# ── 10. Rows sharing a timestamp are not skipped across a page boundary ─

def test_tied_timestamp_rows_are_not_skipped_across_a_page_boundary(monkeypatch):
    _patch_subscription(monkeypatch)
    _force_local_redis(monkeypatch)
    tied_ts = datetime(2026, 9, 1, 12, 0, 0, tzinfo=timezone.utc)
    # Three calls landing in the exact same timestamp (a real possibility
    # under concurrent tool calls, see _encode_audit_cursor's docstring),
    # plus one strictly older row that must only appear on the second page.
    audit_seed = [
        {"user_id": UID, "year_month": "2026-09", "tool": f"tool_{i}", "client": "session",
         "ts": tied_ts, "ok": True}
        for i in range(3)
    ] + [
        {"user_id": UID, "year_month": "2026-09", "tool": "older_tool", "client": "session",
         "ts": tied_ts - timedelta(seconds=1), "ok": True}
    ]
    _patch_collections(
        monkeypatch, audit_seed=audit_seed,
        counter_seed=[{"user_id": UID, "year_month": "2026-09", "count": 4}],
    )

    page1 = _run(mcp.get_mcp_audit(month="all", limit=2, cursor=None, client=None, user={"email": UID}))
    assert len(page1["calls"]) == 2
    assert all(c["ts"] == tied_ts.isoformat() for c in page1["calls"])
    assert page1["next_cursor"] is not None

    page2 = _run(mcp.get_mcp_audit(month="all", limit=2, cursor=page1["next_cursor"], client=None, user={"email": UID}))
    assert len(page2["calls"]) == 2  # the remaining tied row + the older row

    tools_seen = [c["tool"] for c in page1["calls"]] + [c["tool"] for c in page2["calls"]]
    assert sorted(tools_seen) == sorted(["tool_0", "tool_1", "tool_2", "older_tool"])
    assert len(set(tools_seen)) == 4  # no duplicate, no skip
