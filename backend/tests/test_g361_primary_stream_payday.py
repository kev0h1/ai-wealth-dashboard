"""G361: next payday comes from the PRIMARY confirmed income stream only.

`get_confirmed_payday` used to return the earliest next occurrence across ALL
confirmed streams, so a confirmed side income (a rental credit, a second job)
due mid-period pulled `next_pay` forward for every server walk and shortened
the current period. Pinned here:
  1. A confirmed salary on the last Friday plus a side income on the 15th:
     the payday is the salary date.
  2. The side income's amount still counts in upcoming_income.
  3. compute_today_items' window and compute_safe_to_spend's
     days_until_payday follow the salary date.
  4. A primary whose schedule cannot produce a date falls back to the other
     confirmed streams (previous behaviour).
  5. No confirmed streams gives None.
"""
import asyncio
from datetime import date, timedelta

import pytest

import app.core.timeutil as timeutil
import app.routers.analytics as analytics
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.income as income_service
import app.services.net_position as net_position
from app.services.income import get_confirmed_payday, next_confirmed_income_date
from tests import test_g360_one_account_walk as g360

TODAY = date(2026, 10, 10)  # payday: last Friday, Fri 30 Oct 2026 (20 days)
SALARY = {"status": "confirmed", "avg_amount": 4800.0,
          "schedule": {"type": "last_weekday", "weekday": 4}}
SIDE = {"status": "confirmed", "avg_amount": 600.0,
        "schedule": {"type": "day_of_month", "day": 15}}  # Thu 15 Oct
SALARY_DATE = date(2026, 10, 30)
SIDE_DATE = date(2026, 10, 15)


def test_side_income_never_moves_payday():
    for streams in ([SALARY, SIDE], [SIDE, SALARY]):
        nd, primary = get_confirmed_payday({"income_streams": streams}, TODAY)
        assert nd == SALARY_DATE
        assert primary is SALARY
    assert next_confirmed_income_date({"income_streams": [SALARY, SIDE]}, TODAY) == SIDE_DATE


def test_unconfirmed_or_malformed_streams_are_ignored():
    prefs = {"income_streams": [SALARY, {**SIDE, "status": "suggested"}, "junk", None]}
    assert get_confirmed_payday(prefs, TODAY)[0] == SALARY_DATE


def test_broken_primary_falls_back_to_other_stream():
    broken = {"status": "confirmed", "avg_amount": 9000.0, "schedule": {"type": "nonsense"}}
    nd, primary = get_confirmed_payday({"income_streams": [broken, SIDE]}, TODAY)
    assert nd == SIDE_DATE
    assert primary is broken


def test_all_schedules_broken_returns_none():
    broken = {"status": "confirmed", "avg_amount": 9000.0, "schedule": {"type": "nonsense"}}
    assert get_confirmed_payday({"income_streams": [broken]}, TODAY) is None


def test_no_confirmed_streams_returns_none():
    assert get_confirmed_payday({}, TODAY) is None
    assert get_confirmed_payday({"income_streams": []}, TODAY) is None
    assert get_confirmed_payday({"income_streams": [{**SALARY, "status": "suggested"}]}, TODAY) is None


class _MP:
    """monkeypatch proxy: lets the g360 harness build its world, but keeps the
    real get_confirmed_payday and feeds it confirmed income streams."""

    def __init__(self, mp, streams):
        self._mp, self._streams = mp, streams

    def setattr(self, target, name, value, *a, **k):
        if name == "get_confirmed_payday":
            return
        if name == "preferences_col":
            value = g360.FakeCol([{"user_id": g360.UID, "pay_period_config": g360.PAY_CFG,
                                   "income_streams": self._streams}])
        return self._mp.setattr(target, name, value, *a, **k)


def test_today_items_window_follows_salary_date_not_side_income(monkeypatch):
    # A bill 10 days out sits after the side income (5 days) but before payday
    # (20 days). It must count in the window, so the account is short.
    bills = [g360._bill("Mortgage", 900.0, 10, TODAY, acct=g360.HS, balance=300.0)]
    income = [g360._salary(4800.0, 20, TODAY),
              {**g360._salary(600.0, 5, TODAY), "name": "Rent", "display_name": "Rent"}]
    _, elig = g360._run(_MP(monkeypatch, [SALARY, SIDE]), TODAY, bills, income, [],
                        {g360.HS: (300.0, "hsbc"), g360.BC: (500.0, "barclays")})
    h = elig[g360.HS]
    assert h["after_payments"] == pytest.approx(-600.0)
    assert g360._short(h)
    # The side income's amount is still an expected income item.
    assert any(i["amount"] == 600.0 for i in income)


def _sts_fixture(monkeypatch, streams):
    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    cached = {"_id": "u", "spendable_balance": 2000.0, "savings_balance": 0, "recurring_income": []}

    class Col:
        def __init__(self, doc):
            self.doc = doc

        async def find_one(self, _q):
            return self.doc

    monkeypatch.setattr(analytics, "cashflow_cache_col", Col(cached))
    monkeypatch.setattr(analytics, "preferences_col", Col(
        {"user_id": "u", "pay_period_config": {"type": "last_friday"}, "income_streams": streams}))
    bills = [{"days_away": 10, "amount": 100.0, "kind": "bill", "account_id": "acc1", "account_balance": 2000.0}]
    income = [{"days_away": 5, "amount": 600.0}, {"days_away": 20, "amount": 4800.0}]

    async def build(cached_doc, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income,
                "spendable_balance": 2000.0, "savings_balance": 0}

    async def accounts(_uid):
        return [{"_id": "acc1", "balance": 2000.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]

    async def alloc_reserved(_uid):
        return 0.0, 0

    async def alloc_list(_uid):
        return []

    async def commitments(_uid):
        return 0, 0

    async def card_growth(_uid, _s, _t, _b, _e=None):
        return []

    async def monthly(_uid, _c):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(analytics, "_build_cashflow_response", build)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", alloc_reserved)
    monkeypatch.setattr(allocations_router, "list_active_allocations", alloc_list)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", commitments)
    monkeypatch.setattr(net_position, "card_growth_by_card", card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)


def test_safe_to_spend_days_until_payday_is_the_salary_date(monkeypatch):
    _sts_fixture(monkeypatch, [SALARY, SIDE])
    sts = asyncio.run(analytics.compute_safe_to_spend("u"))
    assert sts["days_until_payday"] == (SALARY_DATE - TODAY).days == 20
    assert len(sts["window_bills"]) == 1
