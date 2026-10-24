"""G327: the cashflow payload's `period` object is the same definition the
Spend verdict reads (pay_period.period_facts), so Spend and Upcoming cannot
disagree. Pure seams only: no network, no Mongo."""
from datetime import date

import pytest

from app.services.pay_period import current_period_facts, get_pay_period_for_date
from app.services.spend_verdict import build_period_payload

TODAY = date(2026, 10, 24)

CONFIGS = [
    {"type": "calendar_month"},
    {"type": "last_friday"},
    {"type": "monthly_pay_date", "day": 28},
]


def verdict_period(cfg, today):
    start, end = get_pay_period_for_date(today, cfg)
    days_elapsed = max(1, (today - start).days)
    days_left = max(0, (end - today).days + 1)
    return build_period_payload({
        "start": start.isoformat(), "end": end.isoformat(),
        "days_elapsed": days_elapsed, "days_left": days_left,
        "period_days": days_elapsed + days_left, "offset": 0, "closed": False,
        "thin_history": False, "suppress_multiple": False,
    }, [], today)


@pytest.mark.parametrize("cfg", CONFIGS)
@pytest.mark.parametrize("today", [date(2026, 10, 24), date(2026, 10, 29), date(2026, 10, 30), date(2026, 11, 1)])
def test_cashflow_period_equals_verdict_period(cfg, today):
    cf = current_period_facts(today, cfg)
    v = verdict_period(cfg, today)
    for key in ("start", "end", "length_days", "day_number", "payday", "label"):
        assert cf[key] == v[key], key
    assert cf["payday_observed"] is None


def test_last_friday_values():
    cf = current_period_facts(TODAY, {"type": "last_friday"})
    assert (cf["start"], cf["end"], cf["payday"]) == ("2026-09-25", "2026-10-29", "2026-10-30")
    assert cf["length_days"] == 35 and cf["day_number"] == 30
    assert cf["label"] == "25 Sep to 29 Oct"


def test_calendar_month_values():
    cf = current_period_facts(TODAY, {"type": "calendar_month"})
    assert (cf["start"], cf["end"], cf["payday"]) == ("2026-10-01", "2026-10-31", "2026-11-01")
    assert cf["length_days"] == 31 and cf["day_number"] == 24


def test_monthly_pay_date_values():
    cf = current_period_facts(TODAY, {"type": "monthly_pay_date", "day": 28})
    assert cf["payday"] == "2026-10-28"
    assert cf["day_number"] == (TODAY - date.fromisoformat(cf["start"])).days + 1


def test_confirmed_payday_differs_is_explicit():
    cf = current_period_facts(TODAY, {"type": "last_friday"}, date(2026, 10, 28))
    assert cf["payday"] == "2026-10-30"
    assert cf["payday_observed"] == {"date": "2026-10-28", "source": "confirmed"}


def test_confirmed_payday_equal_is_none():
    cf = current_period_facts(TODAY, {"type": "last_friday"}, date(2026, 10, 30))
    assert cf["payday_observed"] is None
