"""F9 (item text on TODO.md, docs/pricing/tiering-unit-economics-mcp-2026-09.md
section 9): MCP connector call allowance surfaced ("N of 2,000 calls this
month, resets 1 Oct") plus one MCP call pack (1,000 calls for £2.99), using
the SAME pack mechanics as the Penny top-up packs (B11) via the shared
`app.core.subscription._settle_packs` helper.

Covers: app.core.subscription.mcp_allowance / settle_mcp_packs (active pack
folded into `limit`, expired pack ignored, tier with no connector at all
gets no pack credit, past-month overflow settled onto the oldest covering
pack exactly once and idempotently on re-run, packs_bought_this_month),
app.routers.mcp.check_mcp_allowance (honours pack calls, still raises once
the pack-inflated limit itself is spent), POST /subscription/admin/topup
kind="mcp" (writes the right doc), and GET /subscription's `mcp`/`mcp_packs`
payload shape.

Fakes `mcp_call_packs_col`/`mcp_call_counters_col` the same way
tests/test_penny_topup_packs.py fakes `penny_topups_col`/`llm_usage_col`
(no real Mongo) — `_FakePacksCol` additionally supports `update_one` since
settle_mcp_packs persists pack draw-downs.

F14: usage is read from `mcp_call_counters_col` (the durable per-(user,
month) counter), not `mcp_calls_col` row counts, since `mcp_allowance`/
`settle_mcp_packs` now delegate to `app.core.subscription._mcp_call_count`.
`_FakeCounterCol` reproduces the old `_FakeMcpCallsCol.count_documents`
semantics behind `find_one`, the only method `_mcp_call_count` calls."""
import asyncio
from datetime import datetime, timedelta, timezone

import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.mcp as mcp_router_module
import app.routers.subscription as subscription_router_module

UID = "mcp-call-packs-test@example.com"


def _run(coro):
    return asyncio.run(coro)


def _now():
    return datetime.now(timezone.utc)


def _ym(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeCounterCol:
    """F14: stands in for `mcp_call_counters_col`. `_mcp_call_count`
    (app.core.subscription) only ever calls `find_one`, keyed by
    (user_id, year_month) — this fake tallies seeded rows for that pair,
    same counting semantics as the `_FakeMcpCallsCol.count_documents` it
    replaces here."""

    def __init__(self, docs=None):
        self.docs: list[dict] = list(docs or [])

    async def find_one(self, query):
        uid = query.get("user_id")
        ym = query.get("year_month")
        n = sum(1 for d in self.docs if d.get("user_id") == uid and d.get("year_month") == ym)
        return {"count": n} if n else None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


def _calls(uid, ym, n):
    return [{"user_id": uid, "year_month": ym, "tool": "get_accounts", "ok": True} for _ in range(n)]


class _FakePacksCol:
    def __init__(self, docs=None):
        self.docs: list[dict] = list(docs or [])
        self._n = 0

    def find(self, query=None):
        query = query or {}
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]
        return _FakeCursor(rows)

    async def insert_one(self, doc):
        doc.setdefault("_id", f"pack-{self._n}")
        self._n += 1
        self.docs.append(doc)
        return doc

    async def update_one(self, query, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                d.update(update.get("$set", {}))
                return


class _FakeConnectSub:
    """Connect tier, matching TIER_LIMITS (2000 MCP calls/month, 150 Penny
    messages/month — GET /subscription's shape test exercises both
    `mcp_allowance` and `penny_allowance` off the same faked subscription)."""
    tier_name = "connect"
    tier = subscription_module.Tier.CONNECT
    status = "active"

    def limit(self, key):
        return {"mcp_tool_calls_per_month": 2000, "penny_messages_per_month": 150}[key]


class _FakeStandardSub:
    """Standard tier: no connector at all (mcp_tool_calls_per_month == 0)."""
    tier_name = "standard"
    tier = subscription_module.Tier.STANDARD
    status = "active"

    def limit(self, key):
        return {"mcp_tool_calls_per_month": 0, "penny_messages_per_month": 150}[key]


def _pack(uid, *, pack_id="mcp_1000", calls=1000, remaining=None, purchased_at=None,
          expires_at=None, year_month=None, source="purchase", settled_months=None):
    purchased_at = purchased_at or _now()
    return {
        "_id": f"{pack_id}-{purchased_at.isoformat()}",
        "user_id": uid,
        "pack_id": pack_id,
        "calls": calls,
        "remaining": calls if remaining is None else remaining,
        "price_gbp": 2.99,
        "purchased_at": purchased_at,
        "expires_at": purchased_at + timedelta(days=90) if expires_at is None else expires_at,
        "year_month": year_month or _ym(purchased_at),
        "source": source,
        "settled_months": settled_months or [],
    }


def _patch(monkeypatch, *, used_this_month=0, packs=None, sub=None):
    now = _now()
    ym = _ym(now)

    async def fake_get_subscription(email):
        return sub or _FakeConnectSub()
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)

    fake_counters = _FakeCounterCol(_calls(UID, ym, used_this_month))
    monkeypatch.setattr(db_collections_module, "mcp_call_counters_col", fake_counters)

    fake_packs = _FakePacksCol(packs or [])
    monkeypatch.setattr(db_collections_module, "mcp_call_packs_col", fake_packs)
    return fake_packs, fake_counters


# ── 1. Active pack folds into this month's limit ────────────────────────

def test_active_pack_adds_its_remaining_to_the_limit(monkeypatch):
    now = _now()
    pack = _pack(UID, remaining=400, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=10, packs=[pack])

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["limit"] == 2000 + 400
    assert allowance["pack_calls"] == 400
    assert allowance["used"] == 10
    assert allowance["remaining"] == 2000 + 400 - 10


# ── 2. Expired pack is ignored ───────────────────────────────────────────

def test_expired_pack_does_not_count(monkeypatch):
    now = _now()
    old = _pack(
        UID, remaining=500,
        purchased_at=now - timedelta(days=200),
        expires_at=now - timedelta(days=110),
        year_month=_ym(now - timedelta(days=200)),
    )
    _patch(monkeypatch, used_this_month=5, packs=[old])

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["pack_calls"] == 0
    assert allowance["limit"] == 2000
    assert allowance["pack_expires_soonest"] is None


# ── 3. A tier without the connector gets no pack credit ─────────────────

def test_tier_without_connector_ignores_active_packs_in_the_limit(monkeypatch):
    now = _now()
    pack = _pack(UID, remaining=1000, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=0, packs=[pack], sub=_FakeStandardSub())

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["limit"] == 0
    # Still reported (so a UI could explain the pack sits unused), just not
    # folded into `limit`.
    assert allowance["pack_calls"] == 1000


# ── 4. Past-month overflow settles onto the oldest covering pack once ───

def test_past_month_overflow_settles_onto_oldest_pack_and_is_idempotent(monkeypatch):
    now = _now()
    last_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    last_ym = _ym(last_month_start)

    pack = _pack(UID, remaining=1000, purchased_at=last_month_start, year_month=last_ym)
    fake_packs, fake_counters = _patch(monkeypatch, used_this_month=0, packs=[pack])
    # Last month: 2300 calls used against a 2000 allowance -> 300 overflow,
    # drawn from the pack (still has all 1000 remaining at this point).
    fake_counters.docs.extend(_calls(UID, last_ym, 2300))

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert fake_packs.docs[0]["remaining"] == 700  # 1000 - 300 overflow
    assert last_ym in fake_packs.docs[0]["settled_months"]
    assert allowance["pack_calls"] == 700  # this month's active balance

    # Re-running (e.g. a second mcp_allowance call) must not draw down the
    # same month's overflow twice.
    _run(subscription_module.mcp_allowance(UID))
    assert fake_packs.docs[0]["remaining"] == 700


def test_past_month_overflow_only_settles_up_to_pack_remaining(monkeypatch):
    now = _now()
    last_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    last_ym = _ym(last_month_start)

    pack = _pack(UID, remaining=50, purchased_at=last_month_start, year_month=last_ym)
    fake_packs, fake_counters = _patch(monkeypatch, used_this_month=0, packs=[pack])
    # 2500 used last month against 2000 allowance -> 500 overflow, but the
    # pack only has 50 left -> settles to 0, never negative.
    fake_counters.docs.extend(_calls(UID, last_ym, 2500))

    _run(subscription_module.mcp_allowance(UID))
    assert fake_packs.docs[0]["remaining"] == 0
    assert last_ym in fake_packs.docs[0]["settled_months"]


# ── 5. packs_bought_this_month ───────────────────────────────────────────

def test_packs_bought_this_month_counts_current_month_purchases(monkeypatch):
    now = _now()
    ym = _ym(now)
    p1 = _pack(UID, remaining=600, purchased_at=now, year_month=ym)
    old = _pack(
        UID, remaining=0,
        purchased_at=now - timedelta(days=95),
        expires_at=now - timedelta(days=5),
        year_month=_ym(now - timedelta(days=95)),
    )
    _patch(monkeypatch, used_this_month=0, packs=[p1, old])

    allowance = _run(subscription_module.mcp_allowance(UID))
    assert allowance["packs_bought_this_month"] == 1


# ── 6. check_mcp_allowance honours pack calls ────────────────────────────

def test_check_mcp_allowance_lets_a_call_through_once_a_pack_covers_the_overage(monkeypatch):
    now = _now()
    # Tier's own 2000 is fully used; without a pack this would raise.
    pack = _pack(UID, remaining=10, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=2000, packs=[pack])

    result = _run(mcp_router_module.check_mcp_allowance(UID))
    assert result["used"] == 2000
    assert result["limit"] == 2010


def test_check_mcp_allowance_still_raises_once_the_pack_inflated_limit_is_spent(monkeypatch):
    now = _now()
    pack = _pack(UID, remaining=10, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=2010, packs=[pack])

    try:
        _run(mcp_router_module.check_mcp_allowance(UID))
        assert False, "expected McpError"
    except mcp_router_module.McpError as exc:
        assert exc.code == -32000
        assert exc.data["used"] == 2010
        assert exc.data["limit"] == 2010


def test_check_mcp_allowance_zero_tier_ignores_packs_and_raises_distinct_error(monkeypatch):
    pack = _pack(UID, remaining=500, purchased_at=_now(), year_month=_ym(_now()))
    _patch(monkeypatch, used_this_month=0, packs=[pack], sub=_FakeStandardSub())

    try:
        _run(mcp_router_module.check_mcp_allowance(UID))
        assert False, "expected McpError"
    except mcp_router_module.McpError as exc:
        assert exc.code == -32002
        assert exc.data["limit"] == 0


# ── 7. POST /subscription/admin/topup kind="mcp" ─────────────────────────

def test_admin_topup_mcp_kind_writes_the_right_doc(monkeypatch):
    fake_packs = _FakePacksCol()
    monkeypatch.setattr(db_collections_module, "mcp_call_packs_col", fake_packs)

    async def fake_current_user_check(*a, **k):
        return {"name": "Bot"}

    result = _run(subscription_router_module.admin_topup(
        {"email": UID, "kind": "mcp", "pack_id": "mcp_1000"},
        user={"name": "Bot"},
    ))
    assert result == {"ok": True, "email": UID, "calls": 1000, "year_month": _ym(_now())}

    doc = fake_packs.docs[0]
    assert doc["user_id"] == UID
    assert doc["pack_id"] == "admin"
    assert doc["calls"] == 1000
    assert doc["remaining"] == 1000
    assert doc["price_gbp"] == 2.99
    assert doc["source"] == "admin"
    assert doc["settled_months"] == []
    assert doc["expires_at"] - doc["purchased_at"] == timedelta(days=90)


def test_admin_topup_mcp_kind_rejects_unknown_pack_id(monkeypatch):
    from fastapi import HTTPException
    fake_packs = _FakePacksCol()
    monkeypatch.setattr(db_collections_module, "mcp_call_packs_col", fake_packs)

    try:
        _run(subscription_router_module.admin_topup(
            {"email": UID, "kind": "mcp", "pack_id": "nope"}, user={"name": "Bot"},
        ))
        assert False, "expected HTTPException"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_admin_topup_defaults_to_penny_kind_when_kind_omitted(monkeypatch):
    fake_topups = _FakePacksCol()
    monkeypatch.setattr(db_collections_module, "penny_topups_col", fake_topups)

    result = _run(subscription_router_module.admin_topup(
        {"email": UID, "pack_id": "small"}, user={"name": "Bot"},
    ))
    assert result == {"ok": True, "email": UID, "messages": 20, "year_month": _ym(_now())}
    assert fake_topups.docs[0]["messages"] == 20


# ── 8. GET /subscription payload shape ───────────────────────────────────

class _FakeLlmUsageCol:
    """Minimal stand-in for `app.core.llm.monthly_usage`'s own collection —
    GET /subscription also computes the Penny side of the payload
    (`penny_allowance`), so it needs an (empty, here) aggregate/distinct
    surface rather than hitting real Mongo."""

    def aggregate(self, pipeline):
        return _FakeCursor([])

    async def distinct(self, field, match):
        return []


def test_get_subscription_serves_mcp_block_and_packs(monkeypatch):
    import app.core.llm as llm_module

    now = _now()
    pack = _pack(UID, remaining=250, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=5, packs=[pack])
    monkeypatch.setattr(subscription_router_module, "get_subscription", lambda email: _async(_FakeConnectSub()))
    # GET /subscription also runs penny_allowance's own settle/usage path —
    # keep it a no-op, empty-pack, empty-usage read so this stays a pure
    # unit test of the MCP block, not an accidental integration test of B11.
    monkeypatch.setattr(llm_module, "llm_usage_col", _FakeLlmUsageCol())
    monkeypatch.setattr(db_collections_module, "penny_topups_col", _FakePacksCol())

    result = _run(subscription_router_module.get_subscription_info({"email": UID}))

    assert result["billing_live"] is False
    assert result["mcp_packs"] == [
        {"id": "mcp_1000", "calls": 1000, "price_gbp": 2.99, "badge": None},
    ]
    mcp_block = result["mcp"]
    assert mcp_block["limit"] == 2000 + 250
    assert mcp_block["used"] == 5
    assert mcp_block["remaining"] == 2000 + 250 - 5
    assert mcp_block["pack_calls"] == 250
    assert mcp_block["packs"] == [
        {"id": "mcp_1000", "calls": 1000, "price_gbp": 2.99, "badge": None},
    ]
    assert mcp_block["resets_on"] is not None


async def _async(value):
    return value
