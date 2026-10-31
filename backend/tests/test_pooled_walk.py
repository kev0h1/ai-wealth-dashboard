"""G367 (money engine step 5): the pooled Left to spend walk.

`tests/fixtures/pooled_walk_golden.json` was captured from the OLD code
(POOLED_GOLDEN_DUMP=1, one-off, committed before any production change): the
exact window lists, totals, low point and full `compute_safe_to_spend` response
on one fixture that exercises every pooled rule:

  Rent           an ordinary debit on a counted account
  Move to Joint  a traced movement between two counted accounts (both legs drop)
  Amex charge    a charge on a credit card (out of the walk, into the reserve)
  Gym + Coffee   a debit pair sharing a day with a credit (debit first)
  Side gig       an income with two sightings 40 percent apart: uncredited in a
                 per-account walk (C1), credited here (C2)
  Council tax    a bill ON payday (never in the window)
  Unpicked       a bill and an income on a G231 not-counted account
  Overdrawn      a negative-balance current account (left out of the seed)
"""
import asyncio
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

import app.core.timeutil as timeutil
import app.routers.allocations as allocations_router
import app.routers.analytics as analytics
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.income as income_service
import app.services.net_position as net_position

UID = "pooled@example.com"
TODAY = date(2026, 10, 12)
GOLDEN = Path(__file__).parent / "fixtures" / "pooled_walk_golden.json"


def _bill(name, amount, days, acct="cur", **extra):
    b = {
        "name": name, "amount": amount, "days_away": days, "account_id": acct,
        "expected_date": (TODAY + timedelta(days=days)).isoformat(),
        "kind": "bill", "is_credit_card": False, "account_balance": 1000.0,
    }
    b.update(extra)
    return b


def _income(name, amount, days, acct="cur", **extra):
    i = {
        "name": name, "amount": amount, "days_away": days, "account_id": acct,
        "expected_date": (TODAY + timedelta(days=days)).isoformat(),
        "account_balance": 1000.0,
    }
    i.update(extra)
    return i


def _bills():
    return [
        _bill("Rent", 400.0, 2),
        _bill("Move to Joint", 150.0, 3, kind=analytics.MOVEMENT, dest_account_id="joint",
              dest_account_spendable=True),
        _bill("Amex charge", 90.0, 4, acct="amex", is_credit_card=True),
        _bill("Gym", 30.0, 5),
        _bill("Coffee club", 60.0, 5),
        _bill("Unpicked bill", 500.0, 6, acct="unpicked"),
        _bill("Council tax", 120.0, 10),
    ]


def _incomes():
    return [
        _income("Refund", 100.0, 5),
        _income("Side gig", 140.0, 7, occurrences=2, amounts_recent=[100.0, 140.0]),
        _income("Unpicked income", 200.0, 8, acct="unpicked"),
        _income("Salary", 2000.0, 10, occurrences=6, amounts_recent=[2000.0] * 6),
    ]


def _accounts():
    def acc(i, name, bal, subtype="CURRENT", typ="bank", **extra):
        a = {"_id": i, "name": name, "balance": bal, "type": typ, "subtype": subtype, "currency": "GBP"}
        a.update(extra)
        return a
    return [
        acc("cur", "Main", 1000.0),
        acc("joint", "Joint", 300.0),
        acc("over", "Overdrawn", -150.0),
        acc("sav", "Saver", 500.0, subtype="SAVINGS"),
        acc("unpicked", "Not counted", 800.0, include_in_safe_to_spend=False),
        acc("card", "Card", -200.0, subtype="CREDIT_CARD", typ="card"),
    ]


class _Counted:
    def __init__(self, log, name, doc=None, docs=None):
        self.log, self.name, self.doc, self.docs = log, name, doc, docs or []

    async def find_one(self, _query, *a, **k):
        self.log.append(self.name)
        return self.doc

    def find(self, _query, *a, **k):
        self.log.append(self.name)
        return self

    async def to_list(self, _n):
        return list(self.docs)


def _wire(monkeypatch, bills=None, incomes=None, accounts=None, payday_offset=10, calls=None):
    calls = calls if calls is not None else []
    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(
        income_service, "get_confirmed_payday",
        lambda _p, _t: (TODAY + timedelta(days=payday_offset), {"schedule": "fixed"}),
    )
    monkeypatch.setattr(analytics, "preferences_col", _Counted(calls, "prefs", doc={"user_id": UID}))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _Counted(calls, "cache", doc={"_id": UID, "recurring_spend": []}))
    monkeypatch.setattr(analytics, "card_terms_col", _Counted(calls, "terms"))
    bills = _bills() if bills is None else bills
    incomes = _incomes() if incomes is None else incomes
    accounts = _accounts() if accounts is None else accounts

    async def response(_cached, uid=None):
        calls.append("build_cashflow_response")
        return {"upcoming_bills": bills, "upcoming_income": incomes, "internal_inflows": []}

    async def accts(_uid):
        calls.append("accounts")
        return accounts

    async def no_commitments(_uid):
        calls.append("commitments")
        return 0, 0

    async def no_allocations(_uid):
        calls.append("allocations")
        return 0.0, 0

    async def monthly_cashflow(_uid, _cutoff):
        calls.append("monthly_cashflow")
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        calls.append("last_bank_sync")
        return None

    async def idle(_uid):
        calls.append("first_sync_state")
        return {"state": "idle", "first_sync": False, "connections": []}

    seen: dict = {}

    async def growth(_uid, _start, _today, window_bills, excluded=None):
        calls.append("card_growth_by_card")
        seen["card_window_bills"] = list(window_bills)
        seen["card_charges_excluded"] = list(excluded or [])
        return [{"account_id": "amex", "growth": 90.0, "unpaid_growth": 90.0, "net_change": 90.0,
                 "new_spend": 90.0, "future_unposted_charges": 90.0}]

    monkeypatch.setattr(analytics, "_build_cashflow_response", response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", no_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", no_allocations)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)
    monkeypatch.setattr(analytics, "first_sync_state", idle)
    monkeypatch.setattr(net_position, "card_growth_by_card", growth)
    return seen, calls


def _row(x):
    return {k: x.get(k) for k in ("name", "amount", "days_away", "account_id")}


def _capture(monkeypatch, **kw):
    seen, calls = _wire(monkeypatch, **kw)
    window_income: dict = {}
    min_running: dict = {}
    from app.services import account_walk as aw
    if hasattr(aw, "pooled_walk"):
        real = aw.pooled_walk

        def spy(*a, **k):
            r = real(*a, **k)
            window_income["v"] = [_row(i) for i in r.window_income]
            min_running["v"] = r.min_running
            return r

        monkeypatch.setattr(aw, "pooled_walk", spy)
    else:
        real = analytics._safe_to_spend_lowest_projected_balance

        def spy(seed, bills, income):
            r = real(seed, bills, income)
            window_income["v"] = [_row(i) for i in income]
            min_running["v"] = r
            return r

        monkeypatch.setattr(analytics, "_safe_to_spend_lowest_projected_balance", spy)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    return {
        "window_bills": [_row(b) for b in out["window_bills"]],
        "window_income": window_income["v"],
        "pooled_transfers_excluded": out["pooled_transfers_excluded"],
        "card_charges_excluded_from_walk": [_row(b) for b in seen["card_charges_excluded"]],
        "card_window_bills": [_row(b) for b in seen["card_window_bills"]],
        "min_running": min_running["v"],
        "bills_total": out["bills_total"],
        "income_before": out["income_before_payday"],
        "payday_income": out["payday_income"],
        "response": json.loads(json.dumps(out, default=str, sort_keys=True)),
        "round_trips": sorted(calls),
    }


def test_dump_golden(monkeypatch):
    """Only runs with POOLED_GOLDEN_DUMP=1 (used once, on the pre-change code)."""
    if not os.environ.get("POOLED_GOLDEN_DUMP"):
        pytest.skip("golden capture is a one-off")
    GOLDEN.write_text(json.dumps(_capture(monkeypatch), indent=1, sort_keys=True) + "\n")


def test_pooled_walk_equals_the_pre_change_golden(monkeypatch):
    golden = json.loads(GOLDEN.read_text())
    got = _capture(monkeypatch)
    for key in golden:
        assert got[key] == golden[key], key
