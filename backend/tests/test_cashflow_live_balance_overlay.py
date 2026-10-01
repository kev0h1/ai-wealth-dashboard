"""G188: Home's Safe-to-Spend and Upcoming's runway must start from one live figure.

`cashflow_cache_col` stores a balance snapshot from the last recompute.
`GET /cashflow` used to return it verbatim, so after money left a current
account Upcoming still counted the cash while the bill that took it had
dropped off the list ("£350 left" against Home's "£59 short").
"""
import asyncio
from datetime import date, timedelta

import app.core.timeutil as timeutil
import app.routers.analytics as analytics
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.income as income_service
import app.services.net_position as net_position

UID = "user@example.com"
TODAY = date(2026, 10, 1)


class _Col:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, _q):
        return self.doc


def _fixture(monkeypatch):
    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(
        income_service, "get_confirmed_payday",
        lambda _p, _t: (TODAY + timedelta(days=29), {"schedule": "fixed"}),
    )
    # Snapshot from before the money left: £2,149.01 spendable.
    cached = {"_id": UID, "spendable_balance": 2149.01, "savings_balance": 1420.67,
              "recurring_income": []}
    monkeypatch.setattr(analytics, "cashflow_cache_col", _Col(cached))
    monkeypatch.setattr(analytics, "preferences_col", _Col({"user_id": UID}))

    # Snapshot account_balance values are stale; acc9 is not in the live pool.
    bills = [
        {"days_away": 3, "amount": 1498.31, "kind": "bill", "account_id": "acc1", "account_balance": 1400.0},
        {"days_away": 4, "amount": 0.0, "kind": "bill", "account_id": "acc9", "account_balance": 55.0},
    ]
    income = [{"days_away": 5, "amount": 15.24}]

    async def build(cached_doc, uid=None, prefs=None):
        # Real builder passes the cached snapshot straight through.
        return {
            "upcoming_bills": bills, "upcoming_income": income,
            "spendable_balance": cached_doc.get("spendable_balance"),
            "savings_balance": cached_doc.get("savings_balance", 0),
        }

    # Live: current accounts hold £1,747.51 across two accounts (+ a card in
    # debt that is excluded from the pool), savings £1,420.95.
    live = [
        {"_id": "acc1", "balance": 1000.00, "type": "bank", "subtype": "CURRENT", "currency": "GBP"},
        {"_id": "acc2", "balance": 747.51, "type": "bank", "subtype": "CURRENT", "currency": "GBP"},
        {"_id": "sav", "balance": 1420.95, "type": "bank", "subtype": "SAVINGS", "currency": "GBP"},
        {"_id": "card", "balance": -200.0, "type": "card", "subtype": "CREDIT_CARD", "currency": "GBP"},
    ]

    async def accounts(_uid):
        return live

    async def alloc_reserved(_uid):
        return 315.52, 1

    async def alloc_list(_uid):
        return [{"remaining": 315.52}]

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
    return bills, income


def test_cashflow_overlays_live_balances_over_the_cached_snapshot(monkeypatch):
    _fixture(monkeypatch)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}))
    assert resp["spendable_balance"] == 1747.51   # not the 2149.01 snapshot
    assert resp["savings_balance"] == 1420.95     # not the 1420.67 snapshot


def test_cashflow_keeps_snapshot_when_live_accounts_cannot_be_read(monkeypatch):
    _fixture(monkeypatch)

    async def boom(_uid):
        raise RuntimeError("db down")

    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", boom)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}))
    assert resp["spendable_balance"] == 2149.01


def test_home_and_upcoming_start_from_the_same_figure_and_reconcile(monkeypatch):
    bills, income = _fixture(monkeypatch)
    cash = asyncio.run(analytics.get_cashflow({"email": UID}))
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))

    # 1. Same starting point.
    assert sts["spendable_now"] == cash["spendable_balance"] == 1747.51

    # 2. Upcoming's runway, exactly as PlanningPage.tsx computes it:
    #    spendable + income before payday - bills before payday - envelopes.
    bills_total = sum(b["amount"] for b in bills)
    income_total = sum(i["amount"] for i in income)
    allocations_remaining = sum(a["remaining"] for a in cash["allocations"])
    runway = round(cash["spendable_balance"] + income_total - bills_total - allocations_remaining, 2)

    # 3. Same inputs on both surfaces.
    assert sts["bills_total"] == round(bills_total, 2)
    assert sts["income_before_payday"] == round(income_total, 2)
    assert sts["allocations_reserved"] == round(allocations_remaining, 2)

    # 4. The one structural difference: Safe-to-Spend reports the walk's LOW
    #    POINT (debit-first), and the income lands after the trough, so it is
    #    not in the figure. Runway ends at payday, with that income in. The
    #    two therefore differ by exactly the income before payday, no more.
    assert sts["safe_to_spend"] == round(1747.51 - bills_total - allocations_remaining, 2)
    assert round(runway - sts["safe_to_spend"], 2) == round(income_total, 2)
    # On the stale snapshot the runway would have been £401.50 rosier:
    stale_runway = round(2149.01 + income_total - bills_total - allocations_remaining, 2)
    assert round(stale_runway - runway, 2) == 401.50


def test_bill_account_balance_becomes_live_and_unknown_accounts_keep_snapshot(monkeypatch):
    _fixture(monkeypatch)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}))
    by_acct = {b["account_id"]: b["account_balance"] for b in resp["upcoming_bills"]}
    assert by_acct["acc1"] == 1000.00   # live, not the 1400.0 snapshot
    assert by_acct["acc9"] == 55.0      # not in the live pool: snapshot kept


def test_balances_live_flag_true_on_success_false_on_failure(monkeypatch):
    _fixture(monkeypatch)
    assert asyncio.run(analytics.get_cashflow({"email": UID}))["balances_live"] is True

    _fixture(monkeypatch)  # fresh bills: the builder stub shares its lists

    async def boom(_uid):
        raise RuntimeError("db down")

    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", boom)
    resp = asyncio.run(analytics.get_cashflow({"email": UID}))
    assert resp["balances_live"] is False
    assert resp["upcoming_bills"][0]["account_balance"] == 1400.0
