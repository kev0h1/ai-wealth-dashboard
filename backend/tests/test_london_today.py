"""G161 — "today" must be Europe/London, independent of the host clock.

Root cause: the app computed "today" from the server clock. The UAT VPS was
on Europe/Berlin (now switched to Europe/London), production on Railway is
UTC. From 23:00 London the app believed it was tomorrow -- Upcoming labelled
the next day "Today", Home flagged planned moves dated the next day as
overdue, while other surfaces still said "1 day" to payday.

Fix: `app.core.timeutil.user_now()`/`user_today()` are the single
Europe/London-aware source of "today" for every calendar-facing site (see
the module docstring there, and the CLAUDE.md sweep this test file backs).

These tests freeze the wall clock by monkeypatching the `datetime` name
inside `app.core.timeutil` with a subclass whose `now(tz)` returns a fixed
instant -- callers that do `from app.core import timeutil` then
`timeutil.user_today()` (the pattern used everywhere in this sweep) all pick
up the frozen value for free, since they resolve `timeutil.user_today` via
the shared module object at call time.

No mongomock is available in this environment, so DB-touching collections in
the Safe-to-Spend/cashflow-response tests are replaced with tiny in-memory
fakes, following the same per-file local-copy convention
`test_pending_observed.py`/`test_safe_to_spend_hardening.py` already use.
"""
import asyncio
import os
import time
from datetime import date, datetime, timedelta, timezone

import app.core.timeutil as timeutil
import app.routers.analytics as analytics
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.income as income_service
import app.services.net_position as net_position
from app.routers.analytics import _build_cashflow_response
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS


# ── Frozen-clock helper ─────────────────────────────────────────────────────

def _freeze(monkeypatch, iso_utc: str) -> datetime:
    """Patch `app.core.timeutil`'s `datetime` name so `user_now()`/
    `user_today()` see a fixed UTC instant, converted through the REAL
    Europe/London ZoneInfo data (so BST/GMT correctness is genuinely
    exercised, not just asserted by construction)."""
    instant = datetime.fromisoformat(iso_utc).replace(tzinfo=timezone.utc)

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)

    monkeypatch.setattr(timeutil, "datetime", _FrozenDatetime)
    return instant


def _with_process_tz(tz_name: str):
    """Context manager-ish helper: set os.environ['TZ'] + time.tzset() for
    the duration of a block, always restoring afterwards. Proves
    `user_today()` does not depend on the HOST process's local timezone --
    exactly the UAT-VPS-was-on-Europe/Berlin incident this item fixes."""
    class _Ctx:
        def __enter__(self):
            self._prev = os.environ.get("TZ")
            os.environ["TZ"] = tz_name
            time.tzset()
            return self

        def __exit__(self, *exc):
            if self._prev is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = self._prev
            time.tzset()

    return _Ctx()


# ── (a)/(b) user_today() is Europe/London, regardless of host TZ ──────────

def test_user_today_is_london_date_in_bst_regardless_of_host_tz(monkeypatch):
    # 2026-09-24T22:30:00Z is 2026-09-24T23:30:00+01:00 in London (BST) --
    # still the 24th. Under the OLD host-local-clock bug, a Europe/Berlin
    # host (CEST, UTC+2) would have read this same instant as 00:30 on the
    # 25th -- exactly the reported "believed it was tomorrow" symptom.
    _freeze(monkeypatch, "2026-09-24T22:30:00")
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            assert timeutil.user_today() == date(2026, 9, 24), tz_name
            assert timeutil.user_now().date() == date(2026, 9, 24), tz_name


def test_user_today_is_london_date_in_gmt_regardless_of_host_tz(monkeypatch):
    # 2026-01-10T23:30:00Z is 2026-01-10T23:30:00+00:00 in London (GMT,
    # winter -- no DST offset). A Europe/Berlin host (CET, UTC+1) would
    # have read this as 00:30 on the 11th under the old bug.
    _freeze(monkeypatch, "2026-01-10T23:30:00")
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            assert timeutil.user_today() == date(2026, 1, 10), tz_name
            assert timeutil.user_now().date() == date(2026, 1, 10), tz_name


# ── (c) Safe-to-Spend: days_until_payday / window_income / payday_income ──

class _ListCol:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, query=None, projection=None):
        return self

    async def to_list(self, _limit):
        return list(self.docs)


class _PrefsCol:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, _query):
        return self.doc

    async def update_one(self, *a, **kw):
        pass


class _CacheDocCol:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, _query):
        return self.doc


def test_safe_to_spend_payday_window_uses_frozen_london_today(monkeypatch):
    """Confirmed payday 2026-09-25, frozen clock 2026-09-24T22:30Z (23:30
    London, still the 24th): days_until_payday must be 1, income dated
    2026-09-25 (days_away == 1) must NOT be in the before-payday window
    (`income_before_payday`) but MUST be `payday_income` -- the exact
    Safe-to-Spend regression from the incident report."""
    _freeze(monkeypatch, "2026-09-24T22:30:00")
    uid = "g161-safe-to-spend@example.com"

    prefs = {
        "user_id": uid,
        "safe_to_spend_buffer": 0.0,
        "pay_period_config": {"type": "calendar_month"},
    }
    accounts = [
        {"name": "Current Account", "balance": 1000.0, "type": "bank",
         "subtype": "CURRENT", "currency": "GBP"},
    ]
    income = [
        # Lands exactly on payday: days_away (1) == days_until_payday (1).
        {"name": "Salary", "days_away": 1, "amount": 2000.0},
    ]

    def fake_confirmed_payday(_prefs, _today):
        return (date(2026, 9, 25), {"schedule": "fixed"})

    async def fake_cashflow_response(_cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": income}

    async def fake_accounts(_uid):
        return accounts

    async def fake_commitments(_uid):
        return 0, 0

    async def fake_allocations(_uid):
        return 0.0, 0

    async def fake_card_growth(_uid, _period_start, _today, _window_bills, _excluded=None):
        return []

    async def fake_monthly_cashflow(_uid, _cutoff):
        return {"spending": 1000.0, "n_months": 3}

    async def fake_last_sync(_uid):
        return datetime(2026, 1, 1, 9, 30, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol(prefs))
    monkeypatch.setattr(
        analytics, "cashflow_cache_col",
        _CacheDocCol({"_id": uid, "recurring_spend": []}),
    )
    monkeypatch.setattr(analytics, "card_terms_col", _ListCol([]))
    monkeypatch.setattr(income_service, "get_confirmed_payday", fake_confirmed_payday)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", fake_accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", fake_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", fake_allocations)
    monkeypatch.setattr(net_position, "card_growth_by_card", fake_card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", fake_monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", fake_last_sync)

    result = asyncio.run(analytics.compute_safe_to_spend(uid))

    assert result["status"] == "ok"
    assert result["days_until_payday"] == 1
    # NOT in window_income (days_away 1 is not < days_until_payday 1) --
    # under the old server-clock bug, a host reading "today" as the 25th
    # would compute days_until_payday == 0 and wrongly fold this into the
    # before-payday window instead.
    assert result["income_before_payday"] == 0.0
    assert result["payday_income"] == 2000.0


# ── (d)/(e) Upcoming/companion: pending ("was due") + days_away ───────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$nin" in cond and val in cond["$nin"]:
                return False
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$lt" in cond and not (val is not None and val < cond["$lt"]):
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    async def to_list(self, _n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


def _cached(recurring_spend):
    return {
        "recurring_spend": recurring_spend,
        "recurring_income": [],
        "avg_daily_spend": 0,
        "available_balance": 355.34,
        "spendable_balance": 355.34,
        "savings_balance": 0,
    }


def _pattern(**overrides):
    base = {
        "key": "SEVERN TRENT WATER",
        "avg_amount": 43.57,
        "avg_interval": 30,
        "next_date": "2026-09-25",
        "account_id": "natwest",
        "account_name": "THE NUMBER ONE",
        "account_bank": "NATWEST",
        "account_balance": 355.34,
        "is_credit_card": False,
        "category": "Bills",
        "monthly_anchor": None,
    }
    base.update(overrides)
    return base


def test_upcoming_move_due_tomorrow_is_not_pending_or_overdue_at_frozen_clock(monkeypatch):
    """Companion overdue-move detection reads `upcoming_bills[i]["pending"]`
    straight off `_build_cashflow_response` (see app/services/companion.py
    section 5d, "BOTH due-or-overdue" -- pending means the due date has
    arrived or passed). A planned move dated 2026-09-25, at frozen clock
    2026-09-24T22:30Z, must NOT be `pending` ("was due") and must report
    `days_away == 1`, not 0 or negative -- the exact G161 symptom
    (Upcoming labelled the 25th "Today", Home flagged it as overdue)."""
    _freeze(monkeypatch, "2026-09-24T22:30:00")

    monkeypatch.setattr(analytics, "transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "pending_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_overrides_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_rules_col", FakeCol([]))
    monkeypatch.setattr(analytics, "planned_expenses_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)

    resp = asyncio.run(_build_cashflow_response(
        _cached([_pattern()]), uid="kevin", prefs={},
    ))

    assert len(resp["upcoming_bills"]) == 1
    bill = resp["upcoming_bills"][0]
    assert bill["pending"] is False, "a move due tomorrow must not read as 'was due'"
    assert bill["days_away"] == 1
    assert bill["days_past_due"] == 0
