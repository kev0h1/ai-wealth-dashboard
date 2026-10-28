"""G355 step 1: dates, weekdays and per-day amounts always come from the server."""
import asyncio
from datetime import date

import pytest

from app.services import goal_schedule as gs
from app.services import penny_reply_guards as guards
from app.services.penny_tools import execute_tool
from tests.test_g351_penny_goal_schedule import TODAY, UID, world  # noqa: F401  (autouse fixture)

CFG = {"type": "calendar_month"}
FRIDAY_SCHEDULE = {"type": "arithmetic", "start_pence": 1148, "step_pence": 4, "step_unit": "day",
                   "start_date": "2026-10-30", "count": 79, "end_date": None}


def run(coro):
    return asyncio.run(coro)


def test_amount_on_counts_from_the_first_block():
    assert gs.amount_on(FRIDAY_SCHEDULE, date(2026, 10, 30), CFG) == {"day_number": 1, "amount_pence": 1148, "of_total": 79, "days_left": 79}
    assert gs.amount_on(FRIDAY_SCHEDULE, date(2026, 10, 31), CFG)["amount_pence"] == 1152
    assert gs.amount_on(FRIDAY_SCHEDULE, date(2026, 10, 29), CFG) is None  # Thursday is before the start
    assert gs.amount_on(FRIDAY_SCHEDULE, date(2027, 1, 16), CFG)["days_left"] == 1


def test_days_286_to_365_are_79_days_ending_16_jan():
    assert gs.total_pence(FRIDAY_SCHEDULE, CFG) == sum(1148 + 4 * i for i in range(79)) == 103016
    assert gs.end_date(FRIDAY_SCHEDULE, CFG) == date(2027, 1, 16)
    assert gs.weekday_name(date(2027, 1, 16)) == "Saturday"
    assert gs.fmt_date_wd(date(2026, 10, 30)) == "Fri 30 Oct 2026"


@pytest.mark.parametrize("word,expected,weekday", [
    ("Friday", "2026-10-30", "Friday"), ("on friday", "2026-10-30", "Friday"), ("fri", "2026-10-30", "Friday"),
    ("tomorrow", "2026-10-29", "Thursday"), ("today", "2026-10-28", "Wednesday"),
    ("next Wednesday", "2026-11-04", "Wednesday"), ("Wednesday", "2026-10-28", "Wednesday"),
    ("2026-11-02", "2026-11-02", "Monday"), ("31 Oct", "2026-10-31", "Saturday"),
])
def test_ask_date_reads_words_from_today(word, expected, weekday):
    out = run(execute_tool(UID, "preview_goal_schedule", {
        "start_amount": 11.48, "step_amount": 0.04, "step_unit": "day", "count": 79, "start_date": "2026-10-30", "ask_date": word}))
    assert out["on_date"]["date"] == expected and out["on_date"]["weekday"] == weekday


def test_preview_returns_friday_amount_weekdays_today_and_period():
    out = run(execute_tool(UID, "preview_goal_schedule", {
        "start_amount": 11.48, "step_amount": 0.04, "step_unit": "day", "count": 79, "start_date": "2026-10-30", "ask_date": "Friday"}))
    assert out["on_date"]["amount"] == {"raw": 11.48, "formatted": "£11.48"}
    assert out["on_date"]["day_number"] == 1 and out["on_date"]["label"] == "Fri 30 Oct 2026" and out["on_date"]["days_left"] == 79
    assert out["today"] == {"date": "2026-10-28", "weekday": "Wednesday", "label": "Wed 28 Oct 2026"}
    assert out["current_period"]["end"] == "2026-10-31" and out["current_period"]["weekday_end"] == "Saturday"
    assert out["start_weekday"] == "Friday" and out["end_weekday"] == "Saturday" and out["end_label"] == "Sat 16 Jan 2027"
    assert out["total"]["formatted"] == "£1,030.16"
    assert "from Fri 30 Oct 2026" in out["summary"] and "finishing Sat 16 Jan 2027" in out["summary"]
    assert out["next_periods"][0]["start_weekday"] == "Sunday"
    # the schedule label kept for cards and storage has no weekday
    assert out["schedule_label"].endswith("from 30 Oct 2026 for 79 days")


def test_ask_date_before_the_start_and_unreadable():
    out = run(execute_tool(UID, "preview_goal_schedule", {
        "start_amount": 11.48, "step_amount": 0.04, "step_unit": "day", "count": 79, "start_date": "2026-10-30", "ask_date": "tomorrow"}))
    assert out["on_date"]["amount"] is None and "not started" in out["on_date"]["note"]
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": "start at 4p", "ask_date": "soonish"}))
    assert "could not read" in out["on_date"]["error"] and out["today"]["weekday"] == "Wednesday"  # even a needs result


# ── The weekday guard ────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,fixed,n", [
    ("Your current pay period runs until 29 Oct (Friday).", "Your current pay period runs until 29 Oct (Thursday).", 1),
    ("Friday, 29 Oct 2026 is payday", "Thursday, 29 Oct 2026 is payday", 1),
    ("Fri 29 Oct is next", "Thu 29 Oct is next", 1),
    ("Friday (30 Oct) then Sat 31 Oct", "Friday (30 Oct) then Sat 31 Oct", 0),
    ("Friday 30 October 2026", "Friday 30 October 2026", 0),
    ("3 Nov Tue, 4 November 2026 (Wednesday)", "3 Nov Tue, 4 November 2026 (Wednesday)", 0),
    ("It is 12 Dec (Monday)", "It is 12 Dec (Saturday)", 1),
    ("No dates here on Friday", "No dates here on Friday", 0),
    ("31 Feb (Friday)", "31 Feb (Friday)", 0),
])
def test_fix_weekday_claims(text, fixed, n):
    assert guards.fix_weekday_claims(text, TODAY) == (fixed, n)


def test_weekday_guard_year_rollover():
    # 15 Jan with no year, asked in late October, is next year's: 15 Jan 2027 is a Friday
    assert guards.fix_weekday_claims("15 Jan (Monday)", TODAY) == ("15 Jan (Friday)", 1)
    assert guards.fix_weekday_claims("", TODAY) == ("", 0)
