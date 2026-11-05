"""G421: a monthly series that has only ever posted ON the user's payday is
payday-anchored, so its next occurrence is the next payday, not a day-of-month
guess two days earlier. With two points (a freshly reconnected account, or the
day before payday) `_monthly_anchor` has no weekday evidence and used to read
last-Friday paydays 28 Aug and 25 Sep as "the 25th", putting the whole payday
outflow ahead of the salary that funds it (the salary-account shortfall).
Invented series only."""
from datetime import date, datetime

from app.routers.analytics import DEFAULT_RECURRING_CATEGORIES, _detect_recurring, _payday_anchor

TRUSTED = set(DEFAULT_RECURRING_CATEGORIES)
LAST_FRIDAY = {"type": "last_friday"}


def txn(name, on, amount=900.0, category="Transfer"):
    return {"merchant_name": name, "description": name, "amount": amount,
            "date": datetime(on.year, on.month, on.day), "category": category,
            "custom_category": None, "account_id": "acc1"}


def nxt(txns, today, config):
    out = _detect_recurring(txns, trusted_categories=TRUSTED, today=today, pay_period_config=config)
    assert len(out) == 1, out
    return out[0]["next_date"]


def test_two_payday_postings_project_the_next_payday_not_the_25th():
    t = [txn("TEST OWNER HSBC STO", date(2026, 8, 28)), txn("TEST OWNER HSBC STO", date(2026, 9, 25))]
    assert nxt(t, date(2026, 10, 29), LAST_FRIDAY) == date(2026, 10, 30)
    # Same history, no pay config: the old day-of-month reading is unchanged
    # (the 25th, already past, so it reads as due now rather than on payday).
    assert nxt(t, date(2026, 10, 29), None) == date(2026, 10, 25)


def test_the_documented_two_point_cliff_now_lands_on_the_real_payday():
    t = [txn("K MONZO TEST STO", date(2026, 6, 26), 1106.0), txn("K MONZO TEST STO", date(2026, 7, 31), 1106.0)]
    assert nxt(t, date(2026, 8, 27), LAST_FRIDAY) == date(2026, 8, 28)


def test_next_month_after_a_payday_posting_is_the_next_last_friday():
    t = [txn("TEST OWNER HSBC STO", date(2026, 9, 25)), txn("TEST OWNER HSBC STO", date(2026, 10, 30))]
    assert nxt(t, date(2026, 11, 5), LAST_FRIDAY) == date(2026, 11, 27)


def test_a_series_not_on_paydays_keeps_its_own_day():
    # Fixed 26th, never a last Friday: untouched by the payday anchor.
    t = [txn("Chase saver", date(2026, 9, 26), 300.0), txn("Chase saver", date(2026, 10, 26), 300.0)]
    assert nxt(t, date(2026, 11, 5), LAST_FRIDAY) == date(2026, 11, 26)


def test_one_posting_off_payday_disables_the_anchor():
    assert _payday_anchor([date(2026, 8, 28), date(2026, 9, 24)], LAST_FRIDAY) is None
    assert _payday_anchor([date(2026, 9, 25)], LAST_FRIDAY) is None  # one point is not evidence
    assert _payday_anchor([date(2026, 8, 28), date(2026, 9, 25)], {"type": "calendar_month"}) is None
    assert _payday_anchor([date(2026, 8, 28), date(2026, 9, 25)], None) is None


def test_monthly_pay_date_and_last_weekday_configs():
    assert _payday_anchor([date(2026, 9, 28), date(2026, 10, 28)], {"type": "monthly_pay_date", "day": 28}) == 28
    # JS weekday 4 is Thursday in the config's own numbering, Python weekday 3.
    thu = {"type": "last_weekday_of_month", "weekday": 4}
    assert _payday_anchor([date(2026, 9, 24), date(2026, 10, 29)], thu) == {"weekday": 3, "nth": -1}
