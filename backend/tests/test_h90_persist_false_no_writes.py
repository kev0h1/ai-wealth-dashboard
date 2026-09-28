"""H90 (2026-09-28): `app.services.companion.compute_today_items`'s own
docstring says `persist=False` "gates EVERY write this function makes" —
that was not true. Section 8f (the debt-payoff TRAJECTORY item) called
`app.services.debt_plan.get_debt_plan_cached(uid)` unconditionally; on a
cache MISS that helper always called `response_cache.aput`, regardless of
`persist`. `GET /today/cover-plan` (Settings, every load) and
`app.services.penny_tools.get_today_brief` ("what's Penny suggesting")
both call `compute_today_items(..., persist=False)` specifically because
they must never write anything — this is the exact call that let a
persist=False caller write a fresh `debt_plan` response-cache doc under
whatever uid it ran for, including once under Kevin's own real uid from
unmerged code (see H90's board item, and its second note).

This test proves the negative directly: every collection
`compute_today_items` could conceivably write to, and `response_cache`'s
own write half, are wired to RECORD a call rather than perform one, so a
regression can't hide behind a swallowed exception (several write sites,
including the trajectory section itself, are wrapped in a bare
`except Exception: log.warning(...)` for resilience — a fake collaborator
that raises would just get logged and ignored, not fail the test).

Deliberately forces a debt-plan cache MISS with a "bad" verdict so the
trajectory branch that contains the bug actually executes; a cache HIT or
a "good" verdict would let this test pass for the wrong reason (never
reaching the vulnerable line at all).
"""
import asyncio
from datetime import date, timedelta

import app.db.collections as db_collections
import app.services.companion as companion
import app.services.debt_plan as debt_plan
import app.services.income as income_mod
import app.services.pay_period as pay_period
import app.services.response_cache as response_cache

UID = "h90-persist-false-uid"


class _Col:
    """Read-capable, write-RECORDING fake collection. `writes` is a shared
    list every write method appends to (name, args) onto — never raises,
    so a write inside a try/except-wrapped section is still visible to the
    test instead of being silently swallowed."""

    def __init__(self, docs, writes):
        self.docs = list(docs)
        self.writes = writes

    class _Cursor:
        def __init__(self, docs):
            self._docs = docs

        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            for d in self._docs:
                yield d

        async def to_list(self, n):
            return list(self._docs)

        def sort(self, *a, **kw):
            return self

        def limit(self, *a, **kw):
            return self

    def find(self, query=None, projection=None):
        return self._Cursor(list(self.docs))

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None

    async def update_one(self, *a, **kw):
        self.writes.append(("update_one", a, kw))

    async def replace_one(self, *a, **kw):
        self.writes.append(("replace_one", a, kw))

    async def insert_one(self, *a, **kw):
        self.writes.append(("insert_one", a, kw))

    async def delete_many(self, *a, **kw):
        self.writes.append(("delete_many", a, kw))


def _run_persist_false(monkeypatch):
    writes: list = []

    def col(docs=None):
        return _Col(docs or [], writes)

    monkeypatch.setattr(companion, "cashflow_cache_col", col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", col([]))
    monkeypatch.setattr(companion, "yapily_accounts_col", col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", col([]))
    monkeypatch.setattr(companion, "companion_items_col", col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", col([]))
    monkeypatch.setattr(companion, "transactions_col", col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", col([]))
    monkeypatch.setattr(db_collections, "commitments_col", col([]))

    today_d = date.today()
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, td: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda td, cfg: today_d + timedelta(days=10))
    # Mid-period so the payday-plan section never fires and the trajectory
    # section is reached cleanly.
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda ref, cfg: (today_d - timedelta(days=20), today_d + timedelta(days=10)),
    )

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    async def fake_list_active_allocations(u):
        return []

    monkeypatch.setattr(companion, "list_active_allocations", fake_list_active_allocations)

    # Force get_debt_plan_cached's own cache read to MISS, so it falls
    # through to compute + (pre-fix) an unconditional write.
    async def fake_aget(name, uid, ttl=None):
        return None

    monkeypatch.setattr(response_cache, "aget", fake_aget)

    aput_calls: list = []

    async def fake_aput(name, uid, payload, *, version):
        aput_calls.append((name, uid))

    monkeypatch.setattr(response_cache, "aput", fake_aput)

    async def fake_snapshot(uid):
        return 1

    monkeypatch.setattr(response_cache, "snapshot", fake_snapshot)

    # A "bad" verdict is required to reach the write: `if _verdict_str !=
    # "good":` guards the body, but get_debt_plan_cached (and therefore
    # its write) is called unconditionally above that check either way.
    async def fake_compute_debt_plan(uid):
        return {
            "totals": {"verdict": "bad", "debt": 500.0},
            "history": {},
        }

    monkeypatch.setattr(debt_plan, "compute_debt_plan", fake_compute_debt_plan)

    items = asyncio.run(companion.compute_today_items(UID, persist=False))
    return items, writes, aput_calls


def test_get_debt_plan_cached_persist_false_never_calls_aput(monkeypatch):
    """Narrow unit check directly on the helper H90 fixed: a cache MISS
    with persist=False must compute and return without ever writing."""
    aput_calls: list = []

    async def fake_aget(name, uid, ttl=None):
        return None

    async def fake_aput(name, uid, payload, *, version):
        aput_calls.append((name, uid))

    async def fake_compute_debt_plan(uid):
        return {"totals": {"verdict": "bad"}}

    monkeypatch.setattr(response_cache, "aget", fake_aget)
    monkeypatch.setattr(response_cache, "aput", fake_aput)
    monkeypatch.setattr(debt_plan, "compute_debt_plan", fake_compute_debt_plan)

    plan = asyncio.run(debt_plan.get_debt_plan_cached(UID, persist=False))

    assert plan == {"totals": {"verdict": "bad"}}
    assert aput_calls == []


def test_get_debt_plan_cached_persist_true_default_still_writes(monkeypatch):
    """Regression guard on the fix itself: every OTHER caller of
    `get_debt_plan_cached` passes no `persist` argument at all, so the
    default must still write through exactly as before H90."""
    aput_calls: list = []

    async def fake_aget(name, uid, ttl=None):
        return None

    async def fake_aput(name, uid, payload, *, version):
        aput_calls.append((name, uid, version))

    async def fake_snapshot(uid):
        return 7

    async def fake_compute_debt_plan(uid):
        return {"totals": {"verdict": "bad"}}

    monkeypatch.setattr(response_cache, "aget", fake_aget)
    monkeypatch.setattr(response_cache, "aput", fake_aput)
    monkeypatch.setattr(response_cache, "snapshot", fake_snapshot)
    monkeypatch.setattr(debt_plan, "compute_debt_plan", fake_compute_debt_plan)

    plan = asyncio.run(debt_plan.get_debt_plan_cached(UID))

    assert plan == {"totals": {"verdict": "bad"}}
    assert aput_calls == [(debt_plan._CACHE_NAME, UID, 7)]


def test_compute_today_items_persist_false_writes_nothing_anywhere(monkeypatch):
    """End-to-end through the real function (not a mock of it, unlike
    test_companion_cover_plan_route.py's route-level tests): with a forced
    debt-plan cache MISS and a "bad" verdict — the exact shape that
    reaches the previously-unguarded write — persist=False must leave
    every collection and response_cache.aput untouched."""
    items, writes, aput_calls = _run_persist_false(monkeypatch)

    assert writes == [], f"unexpected collection write(s) under persist=False: {writes}"
    assert aput_calls == [], f"response_cache.aput called under persist=False: {aput_calls}"
    # Sanity: the trajectory branch was actually reached (not skipped),
    # so the assertions above are proving something real.
    assert any(i.get("type") == "trajectory" for i in items)
