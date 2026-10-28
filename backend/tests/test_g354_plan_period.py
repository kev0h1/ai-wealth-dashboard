"""G354: a payday plan covers exactly ONE pay period.

Kevin, UAT 2026-10-28: the plan showed HSBC with 3,408 of payments, one
month of its bills plus a second mortgage and car-finance payment. The
upcoming-bills feed reaches 35 days ahead and the preview bill set had no
upper bound. The plan window is now [next payday, end of the period that
starts there], the same period definition Spend and Upcoming use.

Preview mode (`payday_preview=True`) with the real pay-period functions and
the real `compute_today_items`; only today and the collections are faked.
"""
import asyncio
from datetime import date, timedelta

import app.core.timeutil as timeutil
import app.services.companion as companion
import app.services.income as income_mod
from tests.test_payday_plan_fixes import SALARY_ACCT, UID, _Col, _account, _base_patch, _payday_plan

HSBC = "acc-hsbc"
NATWEST = "acc-natwest"
TODAY = date(2026, 10, 28)


def _bill(name, on, amount, account_id=HSBC, today=TODAY):
    return {
        "name": name, "days_away": (on - today).days, "amount": amount,
        "account_id": account_id, "account_balance": 1.0, "is_credit_card": False,
        "kind": "commitment", "expected_date": on.isoformat(),
    }


def _pay(on, amount, today=TODAY):
    return {
        "name": "Salary", "days_away": (on - today).days, "amount": amount,
        "account_id": SALARY_ACCT, "occurrences": 3,
        "amounts_recent": [amount, amount, amount], "expected_date": on.isoformat(),
    }


def _preview(monkeypatch, *, config, bills, pay_on, pay=4798.0, today=TODAY, accounts=None, confirmed=None):
    monkeypatch.setattr(timeutil, "user_today", lambda: today)
    _base_patch(
        monkeypatch,
        accounts=accounts or [_account(SALARY_ACCT, 200.0, "Salary Account"), _account(HSBC, 0.0, "HSBC")],
        bills=bills,
        income=[_pay(pay_on, pay, today)],
    )
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID, "pay_period_config": config}]))
    if confirmed is not None:
        monkeypatch.setattr(income_mod, "get_confirmed_payday",
                            lambda prefs, d: (confirmed(d), {}) if confirmed(d) else None)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    plan = _payday_plan(items)
    assert plan is not None
    return plan


def _dest(plan, acct_id):
    return next(d for d in plan["dests"] if d["account_id"] == acct_id)


def test_calendar_month_bill_on_the_first_counts_once_with_a_35_day_feed(monkeypatch):
    bills = [
        _bill("Mortgage", date(2026, 11, 1), 1124.44), _bill("Car finance", date(2026, 11, 1), 428.86),
        _bill("Broadband", date(2026, 11, 10), 50.0),
        _bill("Mortgage", date(2026, 12, 1), 1124.44), _bill("Car finance", date(2026, 12, 1), 428.86),
    ]
    plan = _preview(monkeypatch, config={"type": "calendar_month"}, bills=bills, pay_on=date(2026, 11, 1))
    d = _dest(plan, HSBC)
    assert d["bill_count"] == 3
    assert d["bills_total"] == 1603  # one month, rounded to whole pounds
    assert plan["plan_period"] == {"start": "2026-11-01", "end": "2026-11-30", "label": "1 Nov to 30 Nov"}


def test_biweekly_pay_counts_a_monthly_bill_once_when_the_feed_holds_two(monkeypatch):
    bills = [_bill("Mortgage", date(2026, 11, 2), 900.0), _bill("Mortgage", date(2026, 12, 2), 900.0)]
    cfg = {"type": "biweekly", "referenceDate": "2026-10-31"}
    plan = _preview(monkeypatch, config=cfg, bills=bills, pay_on=date(2026, 10, 31))
    d = _dest(plan, HSBC)
    assert d["bill_count"] == 1 and d["bills_total"] == 900.0
    start = date.fromisoformat(plan["plan_period"]["start"])
    end = date.fromisoformat(plan["plan_period"]["end"])
    assert start == date(2026, 10, 31) and (end - start).days == 13


def test_bill_on_payday_counts_once_and_split_is_informational(monkeypatch):
    bills = [_bill("Mortgage", date(2026, 11, 1), 1000.0), _bill("Gym", date(2026, 11, 5), 30.0)]
    plan = _preview(monkeypatch, config={"type": "calendar_month"}, bills=bills, pay_on=date(2026, 11, 1))
    d = _dest(plan, HSBC)
    assert d["bill_count"] == 2 and d["bills_total"] == 1030.0
    # The split still lists the payday-day bill for visibility, it drives no move.
    assert plan["payday_split"]["total"] == 1000 and plan["payday_split"]["count"] == 1


def test_last_friday_plan_runs_30_oct_to_26_nov_and_drops_a_1_dec_bill(monkeypatch):
    bills = [
        _bill("Mortgage", date(2026, 11, 1), 1124.44), _bill("Mortgage", date(2026, 12, 1), 1124.44),
        _bill("Car finance", date(2026, 11, 1), 428.86), _bill("Car finance", date(2026, 12, 1), 428.86),
    ]
    plan = _preview(monkeypatch, config={"type": "last_friday"}, bills=bills, pay_on=date(2026, 10, 30))
    assert plan["plan_period"] == {"start": "2026-10-30", "end": "2026-11-26", "label": "30 Oct to 26 Nov"}
    d = _dest(plan, HSBC)
    assert d["bill_count"] == 2
    assert d["bills_total"] == 1553  # one mortgage + one car finance payment


def test_confirmed_following_payday_ends_the_plan_the_day_before(monkeypatch):
    bills = [_bill("Rent", date(2026, 11, 15), 500.0), _bill("Fee", date(2026, 11, 20), 40.0),
             _bill("Rent", date(2026, 12, 15), 500.0)]
    plan = _preview(
        monkeypatch, config={"type": "last_friday"}, bills=bills, pay_on=date(2026, 10, 30),
        confirmed=lambda d: date(2026, 10, 30) if d < date(2026, 10, 30) else date(2026, 11, 20),
    )
    assert plan["plan_period"]["end"] == "2026-11-19"
    # Only the 15 Nov rent is inside; 20 Nov starts the next plan.
    assert _dest(plan, HSBC)["bill_count"] == 1


def test_kevin_like_data_does_not_trip_the_over_pay_flag(monkeypatch):
    bills = [
        _bill("HSBC bills", date(2026, 11, 1), 1855.0),
        _bill("Mortgage 2", date(2026, 12, 1), 1124.44), _bill("Car finance 2", date(2026, 12, 1), 428.86),
        _bill("HSBC bills", date(2026, 12, 1), 1855.0),
        _bill("NatWest bills", date(2026, 11, 3), 1200.0, account_id=NATWEST),
        _bill("NatWest bills", date(2026, 12, 3), 1200.0, account_id=NATWEST),
    ]
    accounts = [
        _account(SALARY_ACCT, 200.0, "Salary Account"), _account(HSBC, 0.0, "HSBC"),
        _account(NATWEST, 0.0, "NatWest"),
    ]
    plan = _preview(monkeypatch, config={"type": "last_friday"}, bills=bills, pay_on=date(2026, 10, 30),
                    accounts=accounts)
    assert _dest(plan, HSBC)["bills_total"] == 1855.0
    assert _dest(plan, NATWEST)["bills_total"] == 1200.0
    assert plan["over_salary"] is None
