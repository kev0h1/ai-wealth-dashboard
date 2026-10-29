"""G360 (Kevin, 29 Oct 2026, HSBC Advance on prod): one account showed two
answers. The closing walk credited an expected inbound own-account transfer
with no gate, the low-point walk never credited one, and the period widened
past payday on the last day.

Rules pinned here:
  1. The current period ends the day before the next payday, for every
     days_to_pay (no last-day lookahead).
  2. ONE funded-inflow rule (`services/inflow_credit.funded_inflows`): an
     expected inbound own-account transfer counts only when its SOURCE account
     is itself covered that day, in every walk.
  3. after_payments and low_point agree, so an account is never both covered
     and short.
"""
import asyncio
import re
from datetime import date, timedelta
from pathlib import Path

import pytest

import app.db.collections as db_collections
import app.services.companion as companion
from app.core import timeutil
from app.routers.analytics import income_credit_ok, stamp_credit_basis
from app.services.categories import MOVEMENT
from app.services.inflow_credit import funded_inflows
from tests.test_g359_steady_salary import FakeCol, _account

UID = "g360-user"
HS, BC = "acc-hsbc", "acc-barclays"
PAY_CFG = {"type": "last_friday"}  # payday Fri 30 Oct 2026


def _bill(name, amount, days_away, today, *, acct, balance, kind="commitment"):
    return {
        "name": name, "amount": amount, "days_away": days_away,
        "account_id": acct, "account_name": "Acct", "account_bank": "Bank",
        "account_balance": balance, "is_credit_card": False, "kind": kind,
        "category": "Transfer" if kind == MOVEMENT else "Bills", "edited": False,
        "rule_label": None, "pending": False, "days_past_due": 0,
        "expected_date": (today + timedelta(days=days_away)).isoformat(),
        "original_date": None, "dest_account_id": None, "dest_account_spendable": None,
    }


def _inflow(amount, days_away, today, *, dest=HS, source=BC):
    return {
        "name": "Standing order", "amount": amount, "days_away": days_away,
        "expected_date": (today + timedelta(days=days_away)).isoformat(),
        "account_id": dest, "account_name": "HSBC", "account_bank": "HSBC",
        "source_account_id": source, "source_account_name": "Barclays",
    }


def _salary(amount, days_away, today, *, acct=BC):
    return {
        "name": "Pay", "display_name": "Pay", "amount": amount, "days_away": days_away,
        "expected_date": (today + timedelta(days=days_away)).isoformat(), "account_id": acct,
        "account_name": "Barclays", "account_bank": "Barclays", "category": "Income",
        "occurrences": 4, "amounts_recent": [amount] * 4, "avg_interval": 28.0,
    }


def _run(monkeypatch, today, bills, income, inflows, balances, preview=False):
    import app.services.income as income_mod
    import app.services.pace as pace_module
    import app.services.categories as categories_module
    import app.services.checkpoints as checkpoints_module
    import app.services.debt_plan as debt_plan_module

    accounts = [_account(aid, bal, provider=name, name=name) for aid, (bal, name) in balances.items()]
    for a in accounts:
        a["user_id"] = UID
    monkeypatch.setattr(timeutil, "user_today", lambda: today)
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(companion, "accounts_col", FakeCol(accounts))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([
        {"user_id": UID, "pay_period_config": PAY_CFG, "income_streams": []}
    ]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    async def no_active_allocations(uid):
        return []

    async def no_plans(uid, **kw):
        return []

    monkeypatch.setattr(companion, "list_active_allocations", no_active_allocations)
    monkeypatch.setattr(companion, "_load_account_plans", no_plans)
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(categories_module, "user_categories_col", FakeCol([]))
    monkeypatch.setattr(checkpoints_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(checkpoints_module, "checkpoints_col", FakeCol([]))
    monkeypatch.setattr(checkpoints_module, "category_intent_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "transactions_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "commitments_col", FakeCol([]))

    async def no_debt_plan(uid, **kw):
        return {"totals": {"verdict": "good"}, "cards": []}

    monkeypatch.setattr(debt_plan_module, "get_debt_plan_cached", no_debt_plan)
    stamp_credit_basis(income, PAY_CFG, frozenset(), today)

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income,
                "internal_inflows": inflows, "late_income": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    async def fake_proposal(uid, today_d):
        return None

    monkeypatch.setattr(income_mod, "get_payday_proposal", fake_proposal)
    elig: dict = {}
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=preview, persist=False, account_eligibility_out=elig))
    return items, elig


def _short(entry):
    return (entry.get("after_payments") is not None and entry["after_payments"] < 0) or (
        entry.get("low_point") is not None and entry["low_point"] < 0)


# ── 1. Kevin's HSBC case, 29 Oct (payday Fri 30 Oct, days_to_pay 1) ─────────

def test_kevin_hsbc_case_payday_eve(monkeypatch):
    today = date(2026, 10, 29)
    bills = [
        _bill("Novuna", 139.37, 0, today, acct=HS, balance=150.76),
        _bill("Mortgage", 1353.30, 4, today, acct=HS, balance=150.76),
        _bill("M&S Loans", 200.0, 4, today, acct=HS, balance=150.76),
        _bill("To HSBC", 1886.0, 1, today, acct=BC, balance=500.0, kind=MOVEMENT),
    ]
    income = [_salary(4800.0, 1, today)]
    inflows = [_inflow(1886.0, 1, today)]
    _, elig = _run(monkeypatch, today, bills, income, inflows,
                   {HS: (150.76, "hsbc"), BC: (500.0, "barclays")})
    h = elig[HS]
    assert h["after_payments"] == pytest.approx(11.39)
    assert h["low_point"] == pytest.approx(11.39)
    assert not _short(h), "payments warning must not fire"
    assert h["spend_from_headroom"] == pytest.approx(11.39), "not floored by next-period bills"
    assert h["uncertain"] is False
    # Barclays has nothing inside this period: its standing order and the pay
    # both sit on payday, so its figures are exactly its balance.
    assert elig[BC]["after_payments"] == pytest.approx(500.0)
    assert elig[BC]["low_point"] == pytest.approx(500.0)


def test_next_period_bills_absent_from_window(monkeypatch):
    """The 2 Nov mortgage and M&S Loans never reach this period's walk."""
    today = date(2026, 10, 29)
    seen = {}
    orig = companion._walk_events

    def spy(events, balances):
        seen["events"] = list(events)
        return orig(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy)
    bills = [
        _bill("Novuna", 139.37, 0, today, acct=HS, balance=150.76),
        _bill("Mortgage", 1353.30, 4, today, acct=HS, balance=150.76),
        _bill("M&S Loans", 200.0, 4, today, acct=HS, balance=150.76),
    ]
    _run(monkeypatch, today, bills, [], [], {HS: (150.76, "hsbc")})
    names = [e[4]["name"] for e in seen["events"]]
    assert names == ["Novuna"]


def test_kevin_hsbc_case_mid_window_funded_rule(monkeypatch):
    """Same accounts, but the standing order and the pay land mid-window
    (days_to_pay 10, transfer and Barclays salary on day 3)."""
    today = date(2026, 10, 20)
    bills = [
        _bill("Novuna", 139.37, 0, today, acct=HS, balance=150.76),
        _bill("Mortgage", 1353.30, 5, today, acct=HS, balance=150.76),
        _bill("M&S Loans", 200.0, 5, today, acct=HS, balance=150.76),
        _bill("To HSBC", 1886.0, 3, today, acct=BC, balance=500.0, kind=MOVEMENT),
    ]
    income = [_salary(4800.0, 3, today)]
    inflows = [_inflow(1886.0, 3, today)]
    _, elig = _run(monkeypatch, today, bills, income, inflows,
                   {HS: (150.76, "hsbc"), BC: (500.0, "barclays")})
    h = elig[HS]
    # 150.76 - 139.37 + 1886 - 1553.30: the 1,886 is in BOTH walks.
    assert h["after_payments"] == pytest.approx(344.09)
    assert h["low_point"] == pytest.approx(11.39), "low point is the day-0 dip; the inflow lands after it"
    assert not _short(h)
    # Barclays: same-day pay lands before the standing order leaves.
    assert elig[BC]["after_payments"] == pytest.approx(500.0 - 1886.0 + 4800.0)
    assert elig[BC]["low_point"] == pytest.approx(500.0)


def test_funded_inflow_into_account_with_no_bills_seeds_the_closing_walk(monkeypatch):
    today = date(2026, 10, 10)
    bills = [_bill("To Pot", 100.0, 2, today, acct=BC, balance=500.0, kind=MOVEMENT)]
    inflows = [_inflow(100.0, 2, today, dest=HS)]
    _, elig = _run(monkeypatch, today, bills, [], inflows,
                   {HS: (50.0, "hsbc"), BC: (500.0, "barclays")})
    assert elig[HS]["after_payments"] == pytest.approx(150.0)
    # The low point is a running minimum that starts at the opening balance (50),
    # so it cannot read above it; the inflow is credited in both walks.
    assert elig[HS]["low_point"] == pytest.approx(50.0)


def test_payday_eve_spend_from_not_floored_by_next_period_bills(monkeypatch):
    today = date(2026, 10, 29)  # days_to_pay 1
    bills = [
        _bill("Small HS", 10.0, 0, today, acct=HS, balance=200.0),
        _bill("Small BC", 10.0, 0, today, acct=BC, balance=300.0),
        _bill("Big HS", 1000.0, 4, today, acct=HS, balance=200.0),
        _bill("Big BC", 1000.0, 4, today, acct=BC, balance=300.0),
    ]
    _, elig = _run(monkeypatch, today, bills, [], [],
                   {HS: (200.0, "hsbc"), BC: (300.0, "barclays")})
    companion.cap_spend_from_to_pool(elig, 500.0)
    assert elig[HS]["spend_from_headroom"] > 0
    assert elig[BC]["spend_from_headroom"] > 0


def test_payday_eve_tomorrow_lands_in_payday_slice_not_window(monkeypatch):
    today = date(2026, 10, 29)
    seen = {}
    orig = companion._walk_events

    def spy(events, balances):
        seen["events"] = list(events)
        return orig(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy)
    bills = [
        _bill("Novuna", 139.37, 0, today, acct=HS, balance=150.76),
        _bill("Tomorrow bill", 50.0, 1, today, acct=HS, balance=150.76),
        _bill("To HSBC", 1886.0, 1, today, acct=BC, balance=500.0, kind=MOVEMENT),
    ]
    income = [_salary(4800.0, 1, today)]
    inflows = [_inflow(1886.0, 1, today)]
    items, _ = _run(monkeypatch, today, bills, income, inflows,
                    {HS: (150.76, "hsbc"), BC: (500.0, "barclays")}, preview=True)
    # Only today's bill is in the window; "Pay" is the preview's own payday event.
    assert [e[4]["name"] for e in seen["events"]] == ["Novuna", "Pay"]
    plan = next((i for i in items if i.get("type") == "payday_plan"), None)
    assert plan is not None, "payday plan shown on payday eve"
    split = plan["payday_split"]
    assert split["count"] == 2  # tomorrow's bill and the standing order
    assert split["total"] == round(50.0 + 1886.0)


# ── 2. Mid-period: both walks credit or neither does ───────────────────────

def test_funded_inflow_credited_in_both_walks(monkeypatch):
    today = date(2026, 10, 10)  # payday 20 days away
    bills = [
        _bill("Rent", 400.0, 3, today, acct=HS, balance=100.0),
        _bill("To HSBC", 1886.0, 1, today, acct=BC, balance=100.0, kind=MOVEMENT),
    ]
    income = [_salary(4800.0, 1, today)]  # steady, credited, covers the standing order
    inflows = [_inflow(1886.0, 1, today)]
    _, elig = _run(monkeypatch, today, bills, income, inflows,
                   {HS: (100.0, "hsbc"), BC: (100.0, "barclays")})
    h = elig[HS]
    assert h["after_payments"] == pytest.approx(100.0 + 1886.0 - 400.0)
    # The low point is the lowest the account touches; with the inflow on day 1
    # before the rent on day 3 it is the opening balance, never below zero.
    assert h["low_point"] == pytest.approx(100.0)
    assert not _short(h)


def test_unfunded_inflow_credited_in_neither_walk(monkeypatch):
    today = date(2026, 10, 10)
    bills = [
        _bill("Rent", 400.0, 3, today, acct=HS, balance=100.0),
        _bill("To HSBC", 1886.0, 1, today, acct=BC, balance=0.0, kind=MOVEMENT),
    ]
    inflows = [_inflow(1886.0, 1, today)]
    _, elig = _run(monkeypatch, today, bills, [], inflows,
                   {HS: (100.0, "hsbc"), BC: (0.0, "barclays")})
    h = elig[HS]
    assert h["after_payments"] == pytest.approx(-300.0)
    assert h["low_point"] == pytest.approx(-300.0)
    assert _short(h)


# ── 3. Bills on or after the next payday never touch this period ───────────

@pytest.mark.parametrize("days_to_pay", [0, 1, 15])
def test_bill_on_or_after_payday_never_affects_this_period(monkeypatch, days_to_pay):
    # last_friday payday is Fri 30 Oct 2026; pick today so days_to_pay matches.
    today = date(2026, 10, 30) - timedelta(days=days_to_pay)
    if days_to_pay == 0:
        today = date(2026, 10, 30)  # payday itself: the period rolled, next payday is 27 Nov
    bills = [
        _bill("Small", 10.0, 0, today, acct=HS, balance=100.0),
        _bill("Big on payday", 5000.0, max(days_to_pay, 0), today, acct=HS, balance=100.0),
        _bill("Big after payday", 5000.0, days_to_pay + 2, today, acct=HS, balance=100.0),
    ]
    if days_to_pay == 0:
        # On payday the next payday is 27 Nov; only bills before it count, and
        # the 'Big' bills sit inside that period, so assert the generic rule
        # via the helper instead.
        from app.services.pay_period import in_current_window, is_payday_day
        assert in_current_window(0, 0) is False and is_payday_day(0, 0) is True
        return
    _, elig = _run(monkeypatch, today, bills, [], [], {HS: (100.0, "hsbc")})
    h = elig[HS]
    assert h["after_payments"] == pytest.approx(90.0)
    assert h["low_point"] == pytest.approx(90.0)


# ── 4. at_risk_count and spend_impact agree on the funded rule ─────────────

def _run_at_risk(monkeypatch, bills, income, inflows, *, next_pay_in_days=10):
    import app.routers.analytics as analytics
    import app.services.income as income_mod
    import app.services.pay_period as pay_period
    from app.routers.analytics import PATTERNS_VERSION

    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, cfg: today_d + timedelta(days=next_pay_in_days))
    monkeypatch.setattr(analytics, "cashflow_cache_col", FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]))
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income, "internal_inflows": inflows}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)
    return asyncio.run(analytics.at_risk_count(user={"email": UID}))["count"]


def _run_spend_window(monkeypatch, bills, income, inflows, *, next_pay_in_days=10):
    import app.routers.analytics as analytics
    import app.services.income as income_mod
    import app.services.pay_period as pay_period
    import app.services.spend_impact as spend_impact

    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, cfg: today_d + timedelta(days=next_pay_in_days))
    monkeypatch.setattr(spend_impact, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(spend_impact, "preferences_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income, "internal_inflows": inflows}

    async def live(uid):
        return {}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)
    monkeypatch.setattr(spend_impact, "_live_balances_map", live)
    return asyncio.run(spend_impact._cashflow_window(UID))


def _scenario(today, source_balance, with_salary):
    bills = [
        _bill("Rent", 400.0, 3, today, acct=HS, balance=100.0),
        _bill("To HSBC", 1886.0, 1, today, acct=BC, balance=source_balance, kind=MOVEMENT),
    ]
    income = [_salary(4800.0, 1, today)] if with_salary else []
    stamp_credit_basis(income, PAY_CFG, frozenset(), today)
    return bills, income, [_inflow(1886.0, 1, today)]


def test_at_risk_count_follows_the_funded_rule(monkeypatch):
    today = timeutil.user_today()
    # Source covered by its own balance: HSBC credited, rent covered, nothing at risk.
    bills, income, inflows = _scenario(today, 5000.0, False)
    assert _run_at_risk(monkeypatch, bills, income, inflows) == 0
    # Source empty, no credited income: HSBC not credited, rent (and the empty
    # source's own bounced movement is never counted) is at risk.
    bills, income, inflows = _scenario(today, 0.0, False)
    assert _run_at_risk(monkeypatch, bills, income, inflows) == 1


def test_spend_impact_window_follows_the_funded_rule(monkeypatch):
    today = timeutil.user_today()
    for source_balance, expect in ((5000.0, 1), (0.0, 0)):
        bills, income, inflows = _scenario(today, source_balance, False)
        window = _run_spend_window(monkeypatch, bills, income, inflows)
        credited = [e for e in window["events"] if e[3] and e[1] == HS and e[2] == 1886.0]
        assert len(credited) == expect


def test_funded_inflows_helper_unit():
    today = date(2026, 10, 10)
    bills = [_bill("To HSBC", 1886.0, 1, today, acct=BC, balance=0.0, kind=MOVEMENT)]
    inflow = _inflow(1886.0, 1, today)
    ok = lambda i, a: income_credit_ok(i, a, frozenset())
    assert funded_inflows([inflow], bills, [], {BC: 5000.0}, ok) == [inflow]
    assert funded_inflows([inflow], bills, [], {BC: 0.0}, ok) == []
    assert funded_inflows([inflow], bills, [], {}, ok) == [], "untracked source"
    assert funded_inflows([_inflow(1886.0, 1, today, source=None)], bills, [], {BC: 5000.0}, ok) == [], "unknown source"
    sal = _salary(4800.0, 1, today)
    stamp_credit_basis([sal], PAY_CFG, frozenset(), today)
    assert funded_inflows([inflow], bills, [sal], {BC: 0.0}, ok) == [inflow], "same-day credit before debit"
    # One level only: the source's own inbound inflow never funds it.
    own = _inflow(5000.0, 0, today, dest=BC, source="acc-third")
    assert funded_inflows([inflow, own], bills, [], {BC: 0.0, "acc-third": 9000.0}, ok) == [own]


# ── 5. Lockstep: no ungated inflow append survives ─────────────────────────

def test_every_inflow_walk_goes_through_the_funded_helper():
    root = Path(__file__).resolve().parent.parent / "app"
    for rel in ("services/companion.py", "routers/analytics.py", "services/spend_impact.py"):
        src = (root / rel).read_text()
        assert "funded_inflows(" in src, rel
        # No loop appends a raw window_inflows entry into a walk.
        assert not re.search(r"for\s+\w+\s+in\s+window_inflows\s*:", src), (
            f"{rel}: iterate funded inflows, never raw window_inflows"
        )
