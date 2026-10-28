"""G351 step 1: the pure goal schedule engine."""
from datetime import date

import pytest

from app.services import goal_schedule as gs

CAL = {"type": "calendar_month"}
KEVIN = {"type": "arithmetic", "start_pence": 4, "step_pence": 4, "step_unit": "day",
         "start_date": "2026-01-01", "count": 365, "end_date": None}


def test_kevins_challenge_total():
    s = gs.validate(KEVIN)
    assert gs.total_pence(s, CAL) == 267_180
    assert gs.end_date(s, CAL) == date(2026, 12, 31)
    assert gs.periods_count(s, CAL) == 12


def test_january_calendar_month_sums_days_one_to_thirty_one():
    assert gs.period_amount(KEVIN, date(2026, 1, 1), date(2026, 1, 31), CAL) == 4 * sum(range(1, 32))
    assert 4 * sum(range(1, 32)) == 1_984


def test_four_week_and_last_friday_periods_differ_in_length():
    biweekly = {"type": "biweekly", "referenceDate": "2026-01-01"}
    p = gs.period_amount(KEVIN, date(2026, 1, 1), date(2026, 1, 14), biweekly)
    assert p == 4 * sum(range(1, 15))
    lf = {"type": "last_friday"}
    # Last Friday of Jan 2026 is the 30th, so the period 2026-01-30..2026-02-26 is 28 days.
    a = gs.period_amount(KEVIN, date(2026, 1, 30), date(2026, 2, 26), lf)
    assert a == 4 * sum(range(30, 58))
    b = gs.period_amount(KEVIN, date(2026, 2, 27), date(2026, 3, 26), lf)
    assert b == 4 * sum(range(58, 86))


def test_leap_year_daily_count():
    s = gs.validate({**KEVIN, "start_date": "2028-01-01", "count": 366})
    days = gs.daily_amounts(s, date(2028, 1, 1), date(2028, 12, 31))
    assert len(days) == 366 and days[-1] == 366 * 4 and all(d > 0 for d in days)
    assert gs.end_date(s, CAL) == date(2028, 12, 31)


def test_start_mid_period_counts_only_days_from_start():
    s = gs.validate({**KEVIN, "start_date": "2026-01-20", "count": 30})
    assert gs.period_amount(s, date(2026, 1, 1), date(2026, 1, 31), CAL) == 4 * sum(range(1, 13))
    assert gs.period_amount(s, date(2026, 2, 1), date(2026, 2, 28), CAL) == 4 * sum(range(13, 31))


def test_end_date_clips_before_count():
    s = gs.validate({**KEVIN, "count": 365, "end_date": "2026-01-10"})
    assert gs.total_pence(s, CAL) == 4 * sum(range(1, 11))


def test_week_step_counts_weeks_from_start():
    s = gs.validate({"type": "arithmetic", "start_pence": 100, "step_pence": 100, "step_unit": "week",
                     "start_date": "2026-01-01", "count": 5})
    # Weeks start 1, 8, 15, 22, 29 Jan: all in January.
    assert gs.period_amount(s, date(2026, 1, 1), date(2026, 1, 31), CAL) == 100 + 200 + 300 + 400 + 500
    assert gs.total_pence(s, CAL) == 1500


def test_period_step_and_fixed_list_exhaustion():
    p = gs.validate({"type": "arithmetic", "start_pence": 5000, "step_pence": 500, "step_unit": "period",
                     "start_date": "2026-01-15", "count": 3})
    assert gs.period_amount(p, date(2026, 1, 1), date(2026, 1, 31), CAL) == 5000
    assert gs.period_amount(p, date(2026, 2, 1), date(2026, 2, 28), CAL) == 5500
    f = gs.validate({"type": "fixed", "start_date": "2026-01-01", "amounts_pence": [1000, 2000]})
    assert gs.period_amount(f, date(2026, 2, 1), date(2026, 2, 28), CAL) == 2000
    assert gs.period_amount(f, date(2026, 3, 1), date(2026, 3, 31), CAL) == 0
    assert gs.total_pence(f, CAL) == 3000
    assert gs.end_date(f, CAL) == date(2026, 2, 28)


def test_percent_of_pay_with_and_without_expected_pay():
    s = gs.validate({"type": "percent_of_pay", "percent": 10, "start_date": "2026-01-01", "count": 3,
                     "expected_pay_pence": 240_000})
    assert gs.period_amount(s, date(2026, 1, 1), date(2026, 1, 31), CAL) == 24_000
    assert gs.total_pence(s, CAL) == 72_000
    assert gs.period_amount(s, date(2026, 1, 1), date(2026, 1, 31), CAL, expected_pay_pence=100_000) == 10_000
    nopay = gs.validate({"type": "percent_of_pay", "percent": 10, "start_date": "2026-01-01", "count": 3})
    assert gs.period_amount(nopay, date(2026, 1, 1), date(2026, 1, 31), CAL) == 0


def test_planned_to_date_and_next_periods():
    assert gs.planned_to_date(KEVIN, date(2026, 1, 10), CAL) == 4 * 55
    nxt = gs.next_periods(KEVIN, date(2026, 1, 10), CAL, 3)
    assert [n["start"] for n in nxt] == ["2026-02-01", "2026-03-01", "2026-04-01"]
    assert nxt[0]["amount"] == 4 * sum(range(32, 60))
    tail = gs.next_periods(KEVIN, date(2026, 11, 10), CAL, 3)
    assert [n["start"] for n in tail] == ["2026-12-01"]


def test_label_and_money():
    assert gs.schedule_label(KEVIN) == "4p a day, rising by 4p a day, from 1 Jan 2026 for 365 days"
    assert gs.fmt_money(267_180) == "£2,671.80"
    assert gs.fmt_pence(150) == "£1.50" and gs.fmt_pence(100) == "£1"


@pytest.mark.parametrize("bad", [
    None, {"type": "weird"},
    {**KEVIN, "start_pence": 0},
    {**KEVIN, "step_pence": -1},
    {**KEVIN, "count": 3661},
    {**KEVIN, "count": None, "end_date": None},
    {**KEVIN, "start_date": "nonsense"},
    {**KEVIN, "count": None, "end_date": "2025-12-31"},
    {**KEVIN, "step_unit": "week", "count": 521},
    {"type": "fixed", "start_date": "2026-01-01", "amounts_pence": []},
    {"type": "fixed", "start_date": "2026-01-01", "amounts_pence": [0]},
    {"type": "percent_of_pay", "percent": 0, "start_date": "2026-01-01", "count": 2},
    {"type": "percent_of_pay", "percent": 101, "start_date": "2026-01-01", "count": 2},
])
def test_validation_rejections(bad):
    with pytest.raises(ValueError):
        gs.validate(bad)
