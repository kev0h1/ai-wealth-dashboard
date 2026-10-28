"""G356 step 1: a day number ("day 287/365") counts days, it is never the day of the year."""
import asyncio
from datetime import date

import pytest

from app.services import goal_schedule as gs
from app.services import penny_goal_schedule as pgs
from app.services.penny_tools import execute_tool
from tests.test_g351_penny_goal_schedule import TODAY, UID, world  # noqa: F401  (autouse fixture)

KEVIN = ("Okay I want to set up a plan to contribute to my savings challenge, the first day will be on Friday the next "
         "period, a figure of 11.48 and will increase by 4p everyday, I will be on day 287/365 on Friday so come up with "
         "a plan for contributions I will need to make until day 365")
PERIOD_END = date(2026, 10, 29)  # Thursday: Kevin's pay period ended the day after


def run(coro):
    return asyncio.run(coro)


def test_kevin_sentence_reads_start_friday_and_79_days():
    parsed = pgs.parse_description(KEVIN, TODAY, PERIOD_END)
    f = parsed["fields"]
    assert f["start_date"] == "2026-10-30"
    assert f["start_pence"] == 1148 and f["step_pence"] == 4 and f["step_unit"] == "day"
    assert f["day_number"] == 287 and f["last_day"] == 365
    assert "end_date" not in f


def test_kevin_sentence_merged_gives_79_days_to_16_jan():
    merged = pgs.merge_fields({"description": KEVIN}, TODAY, None, PERIOD_END)
    f = merged["fields"]
    assert f["count"] == 79
    assert "I have counted from your day 287, so day 365 is Sat 16 Jan 2027." in merged["assumptions"]
    raw, needs = pgs.build_schedule(f, TODAY)
    assert needs == []
    assert gs.total_pence(raw, {"type": "calendar_month"}) == 103016
    assert gs.end_date(raw, {"type": "calendar_month"}) == date(2027, 1, 16)


def test_next_period_weekday_rules():
    # next pay period starts Friday: that day
    assert pgs._weekday_start("the first day will be on friday the next period", TODAY, date(2026, 10, 29)) == date(2026, 10, 30)
    # next pay period starts Sunday 1 Nov: the next Friday on or after it
    assert pgs._weekday_start("starting friday next period", TODAY, date(2026, 10, 31)) == date(2026, 11, 6)
    # no "next period": the weekday on or after today
    assert pgs._weekday_start("starting on friday", TODAY, date(2026, 10, 31)) == date(2026, 10, 30)


@pytest.mark.parametrize("text,n,m", [
    ("day 10 of 100", 10, 100), ("day 10/100", 10, 100), ("I'm on day 10 out of 100", 10, 100),
    ("I'm on day 287 and want to go until day 365", 287, 365), ("until day 365", None, 365),
])
def test_day_numbers(text, n, m):
    assert pgs._day_numbers(text.lower()) == (n, m)


def test_day_10_of_100_is_91_days():
    merged = pgs.merge_fields({"description": "start 4p add 4p a day, day 10 of 100"}, TODAY)
    assert merged["fields"]["count"] == 91


def test_until_day_365_uses_draft_day_number():
    base = {"start_pence": 1148, "step_pence": 4, "step_unit": "day", "start_date": "2026-10-30", "day_number": 287}
    merged = pgs.merge_fields({"description": "until day 365"}, TODAY, base)
    assert merged["fields"]["count"] == 79


def test_until_day_without_a_day_number_needs_it():
    out = run(execute_tool(UID, "preview_goal_schedule", {
        "description": "start at 11.48p, add 4p a day until day 365", "start_amount": 11.48, "step_unit": "day"}))
    assert out["needs"] == ["day_number"]
    assert out["needs_questions"]["day_number"] == "Which day of the challenge is the first day?"


def test_for_365_days_and_end_dates_unchanged():
    f = pgs.parse_description("start at 4p add 4p a day for 365 days", TODAY)["fields"]
    assert f["count"] == 365 and "last_day" not in f
    f = pgs.parse_description("start at 4p add 4p a day until 31 December", TODAY)["fields"]
    assert f["end_date"] == "2026-12-31" and "last_day" not in f
    assert pgs._day_numbers("until day 365, the day of the year") == (None, None)
