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
import app.routers.savings_insights as savings_insights
import app.services.cashflow as cashflow_service
import app.services.income as income_service
import app.services.net_position as net_position
from app.routers.analytics import _build_cashflow_response
from app.routers.savings_insights import _derive_insight_state, _relative_age, _serialize_insight
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


# ── savings_insights.py: stored UTC instants rendered/compared at DAY
# scale must go through Europe/London calendar dates (`timeutil.to_user_date`),
# not raw instant deltas -- see app/core/timeutil.py's `to_user_date`
# docstring. Independent review found G161's first pass fixed the "today"
# boundary but missed this file's "Xd ago" / "Valid until" / New-badge
# copy, which is exactly the same class of bug one level down (day-count,
# not day-boundary).

def _insight_doc(**overrides) -> dict:
    """Minimal doc `_serialize_insight` can run against without crashing --
    same shape `test_serialize_insight_estimate.py` already established for
    this suite's neighbours (not shared across files by convention here)."""
    base = {
        "_id": "abc123",
        "insight_id": "abc123",
        "category": "energy",
        "title": "Switch energy supplier",
        "body": "Your tariff looks pricier than the market average.",
        "savings_estimate": None,
        "pinned": False,
        "is_new": False,
        "refreshed_at": None,
        "researched_at": None,
        "content_valid_until": None,
    }
    base.update(overrides)
    return base


def test_relative_age_counts_london_calendar_days_not_raw_instant_hours():
    # Researched 2026-09-22T23:30:00Z = London 00:30 on the 23rd. Frozen
    # "now" 2026-09-24T22:30:00Z = London 23:30 on the 24th. That's ONE
    # London calendar day elapsed (23rd -> 24th), i.e. "yesterday" (the
    # word `_relative_age` uses for days == 1) -- not "2d ago", which is
    # what a raw elapsed-instant floor over-eager by a UTC/London offset
    # could produce for a dt/now pair straddling a summer midnight.
    # `_relative_age` takes both instants as explicit params (no freeze
    # needed) and is itself host-TZ-independent (explicit ZoneInfo), proven
    # under both process TZs below anyway for consistency with the rest of
    # this file.
    researched_at = datetime(2026, 9, 22, 23, 30, 0)
    now = datetime(2026, 9, 24, 22, 30, 0)
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            assert _relative_age(researched_at, now) == "yesterday", tz_name

    # A cleaner demonstration that this is a REAL divergence, not just a
    # coincidence of the numbers above: 2026-09-20T00:00:00Z is already
    # London 2026-09-20 (01:00 BST); 2026-09-21T23:00:00Z is already London
    # 2026-09-22 (00:00 BST, i.e. the NEXT UK day). That's 2 London calendar
    # days apart, even though under 47 raw hours (1 day 23h) separate the
    # two instants -- a raw elapsed-duration floor would say "yesterday"
    # (1), the correct calendar-day answer is "2d ago".
    dt2 = datetime(2026, 9, 20, 0, 0, 0)
    now2 = datetime(2026, 9, 21, 23, 0, 0)
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            assert _relative_age(dt2, now2) == "2d ago", tz_name


def test_content_valid_until_fresh_through_end_of_its_london_day(monkeypatch):
    # Frozen 2026-09-24T22:30Z = London 23:30 on the 24th. content_valid_until
    # 2026-09-24T23:59:00Z = London 00:59 on the 25th -- already the NEXT
    # London day. Fresh is compared as London calendar dates ("valid
    # through the end of that London day"), so today's London date (24th)
    # is still <= the valid-until London date (25th): still fresh.
    _freeze(monkeypatch, "2026-09-24T22:30:00")
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            state = _derive_insight_state({
                "title": "Switch energy supplier",
                "body": "Your tariff looks pricier than the market average.",
                "content_valid_until": datetime(2026, 9, 24, 23, 59, 0),
            })
            assert state == "fresh", tz_name


def test_new_badge_seven_london_days_is_new_eight_is_not(monkeypatch):
    # Frozen 2026-09-24T22:30Z = London 23:30 on the 24th -> user_today()
    # is 2026-09-24. Anchors at midday UTC (clear of any DST-boundary
    # ambiguity) 7 and 8 London calendar days earlier.
    _freeze(monkeypatch, "2026-09-24T22:30:00")
    seven_days_ago = datetime(2026, 9, 17, 12, 0, 0)   # London 2026-09-17
    eight_days_ago = datetime(2026, 9, 16, 12, 0, 0)   # London 2026-09-16
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            still_new = _serialize_insight(_insight_doc(is_new=True, refreshed_at=seven_days_ago))
            assert still_new["is_new"] is True, tz_name

            no_longer_new = _serialize_insight(_insight_doc(is_new=True, refreshed_at=eight_days_ago))
            assert no_longer_new["is_new"] is False, tz_name


def test_sync_worker_reconnect_and_expiry_copy_use_london_dates(monkeypatch):
    """`app/workers/sync_worker.py`'s `_reconnect_body`/`_expiring_copy`
    push-notification text was the same bug class one level further out:
    both `.strftime` a stored naive-UTC instant directly. A late-UTC
    instant that's already tomorrow in London must render as tomorrow's
    date, and the day-count in "expires in N days" must be an Europe/London
    calendar-day count, not a raw elapsed-hours floor."""
    import app.workers.sync_worker as sync_worker

    _freeze(monkeypatch, "2026-09-24T22:30:00")
    for tz_name in ("Europe/Berlin", "UTC"):
        with _with_process_tz(tz_name):
            # 2026-09-24T23:10:00Z = London 00:10 on the 25th.
            last_synced = datetime(2026, 9, 24, 23, 10, 0)
            body = sync_worker._reconnect_body("Barclays", last_synced)
            assert "25 Sep" in body, (tz_name, body)

            # Frozen now (London 24th) to an expiry that's London 2026-10-01
            # (2026-09-30T23:30:00Z = London 00:30 on 1 Oct) is 7 London
            # days away (24th -> 1st), not 6.
            expires_at = datetime(2026, 9, 30, 23, 30, 0)
            now = datetime(2026, 9, 24, 22, 30, 0)
            title, body = sync_worker._expiring_copy("Barclays", expires_at, now)
            assert "7 days" in title, (tz_name, title)
            assert "1 Oct" in body, (tz_name, body)
