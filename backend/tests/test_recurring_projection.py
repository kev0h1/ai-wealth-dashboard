"""Coverage for the PROJECTION half of `_detect_recurring` (app/routers/analytics.py).

`tests/test_recurring.py` covers acceptance (which series count as recurring).
This file covers projection (when the next occurrence is predicted to land),
which has two confirmed bugs in the monthly branch (~analytics.py:601-610):

  Bug 1 - weekend/bank-holiday drift: the monthly branch anchors the next
  projection on `last_date.day` (the day the most recent payment actually
  POSTED) instead of the bill's nominal due day. If the most recent posting
  was pushed later by a weekend or bank holiday, every future projection
  inherits that offset.

  Bug 2 - month-end clamping is sticky: `min(last_date.day, monthrange(...))`
  clamps a 29th/30th/31st bill down when it lands in a short month (e.g.
  February), and because the day-of-month is then carried forward from the
  *projected* date rather than re-derived from the nominal due day, it never
  recovers even once the calendar month is long enough again.

Every date below was verified with `date.fromisoformat(...).strftime("%A")`
(see the calculations in the PR/task description) rather than assumed.
Broken-behaviour tests are `xfail(strict=True)` so they flip to "unexpectedly
passing" (and demand marker removal) the moment the projection logic is fixed.
"""
from datetime import date, datetime

import pytest

from app.routers.analytics import _detect_recurring, DEFAULT_RECURRING_CATEGORIES

TRUSTED = set(DEFAULT_RECURRING_CATEGORIES)


def txn(merchant, on_date, amount, category="Bills", account_id="acc1"):
    """Build a transaction on an explicit calendar date (not a day-offset) so
    projection tests can pin down real weekends/bank holidays/month lengths.
    """
    return {
        "merchant_name": merchant,
        "description": merchant,
        "amount": amount,
        "date": datetime(on_date.year, on_date.month, on_date.day),
        "category": category,
        "custom_category": None,
        "account_id": account_id,
    }


def next_date_for(key, results):
    matches = [r for r in results if r["key"] == key]
    assert len(matches) == 1, f"expected exactly one series for {key!r}, got {matches}"
    return matches[0]["next_date"]


def detect(txns, today):
    return _detect_recurring(txns, trusted_categories=TRUSTED, today=today)


# ---------------------------------------------------------------------------
# 1. Weekend drift
# ---------------------------------------------------------------------------

def test_weekend_drift_should_project_nominal_day():
    # Bill due on the 1st. 1 Aug 2026 is a Saturday, so that month's payment
    # posted Mon 3 Aug instead. 1 May/1 Jun/1 Jul 2026 are Fri/Mon/Wed - all
    # weekdays, so those three post cleanly on the 1st.
    assert date(2026, 8, 1).strftime("%A") == "Saturday"
    assert date(2026, 8, 3).strftime("%A") == "Monday"
    txns = [
        txn("Weekend Bill", date(2026, 5, 1), 50),
        txn("Weekend Bill", date(2026, 6, 1), 50),
        txn("Weekend Bill", date(2026, 7, 1), 50),
        txn("Weekend Bill", date(2026, 8, 3), 50),
    ]
    results = detect(txns, today=date(2026, 8, 15))
    assert next_date_for("Weekend Bill", results) == date(2026, 9, 1)


# ---------------------------------------------------------------------------
# 2. The ratchet - multiple historical collisions don't compound beyond the
#    single most recent one, but the bug still isn't self-correcting.
# ---------------------------------------------------------------------------

def test_ratchet_does_not_self_correct_from_intervening_clean_months():
    assert date(2026, 2, 1).strftime("%A") == "Sunday"
    assert date(2026, 3, 1).strftime("%A") == "Sunday"
    txns = [
        txn("Ratchet Bill", date(2026, 1, 1), 50),   # Thu - clean
        txn("Ratchet Bill", date(2026, 2, 2), 50),   # due Sun 1 Feb -> posts Mon 2 Feb
        txn("Ratchet Bill", date(2026, 3, 2), 50),   # due Sun 1 Mar -> posts Mon 2 Mar
        txn("Ratchet Bill", date(2026, 4, 1), 50),   # Wed - clean
        txn("Ratchet Bill", date(2026, 5, 1), 50),   # Fri - clean
        txn("Ratchet Bill", date(2026, 6, 1), 50),   # Mon - clean
        txn("Ratchet Bill", date(2026, 7, 1), 50),   # Wed - clean
        txn("Ratchet Bill", date(2026, 8, 3), 50),   # due Sat 1 Aug -> posts Mon 3 Aug
    ]
    results = detect(txns, today=date(2026, 8, 20))
    assert next_date_for("Ratchet Bill", results) == date(2026, 9, 1)


# ---------------------------------------------------------------------------
# 3. Month-end clamping through February
# ---------------------------------------------------------------------------

def test_month_end_bill_should_return_to_31st_after_february():
    txns = [
        txn("Month End Bill", date(2026, 1, 31), 100),
        txn("Month End Bill", date(2026, 2, 28), 100),
    ]
    results = detect(txns, today=date(2026, 3, 10))
    assert next_date_for("Month End Bill", results) == date(2026, 3, 31)


# ---------------------------------------------------------------------------
# 4. Leap year handling
# ---------------------------------------------------------------------------

def test_leap_year_29_feb_itself_projects_correctly():
    # 2028 is a leap year, so Feb has 29 days and no clamping is even needed -
    # this should already work today.
    assert date(2028, 2, 29).strftime("%A") == "Tuesday"
    txns = [
        txn("Leap Bill", date(2028, 1, 29), 60),
        txn("Leap Bill", date(2028, 2, 29), 60),
    ]
    results = detect(txns, today=date(2028, 3, 5))
    assert next_date_for("Leap Bill", results) == date(2028, 3, 29)


def test_29th_bill_should_return_to_29th_after_non_leap_february():
    txns = [
        txn("29th Bill", date(2026, 1, 29), 60),
        txn("29th Bill", date(2026, 2, 28), 60),
    ]
    results = detect(txns, today=date(2026, 3, 10))
    assert next_date_for("29th Bill", results) == date(2026, 3, 29)


# ---------------------------------------------------------------------------
# 5. Bank holiday shift (not just weekends)
# ---------------------------------------------------------------------------

def test_bank_holiday_shift_should_not_move_the_anchor():
    assert date(2026, 12, 25).strftime("%A") == "Friday"   # Christmas Day
    assert date(2026, 12, 26).strftime("%A") == "Saturday"  # Boxing Day (falls on weekend)
    assert date(2026, 12, 28).strftime("%A") == "Monday"    # substitute bank holiday
    assert date(2026, 12, 29).strftime("%A") == "Tuesday"   # first working day
    txns = [
        txn("Holiday Bill", date(2026, 9, 25), 40),
        txn("Holiday Bill", date(2026, 10, 26), 40),  # due Sun 25 Oct -> posts Mon 26 Oct
        txn("Holiday Bill", date(2026, 11, 25), 40),
        txn("Holiday Bill", date(2026, 12, 29), 40),  # bank-holiday shifted
    ]
    results = detect(txns, today=date(2027, 1, 5))
    assert next_date_for("Holiday Bill", results) == date(2027, 1, 25)


# ---------------------------------------------------------------------------
# 6. Counter-case: a genuine permanent date change must still be honoured
# ---------------------------------------------------------------------------

def test_genuine_permanent_date_change_is_projected_correctly():
    # The bill truly moved from the 1st to the 15th (e.g. provider changed
    # its billing cycle) and stayed there for three months running. Because
    # the 15th never needs clamping in any month, today's anchor-on-last-
    # posted-day logic gets this right already - it must keep doing so once
    # the weekend/month-end bugs above are fixed, i.e. a fix must not treat
    # every day-of-month change as drift to be corrected away.
    txns = [
        txn("Moved Bill", date(2026, 1, 1), 70),
        txn("Moved Bill", date(2026, 2, 1), 70),
        txn("Moved Bill", date(2026, 3, 1), 70),
        txn("Moved Bill", date(2026, 4, 1), 70),
        txn("Moved Bill", date(2026, 5, 15), 70),
        txn("Moved Bill", date(2026, 6, 15), 70),
        txn("Moved Bill", date(2026, 7, 15), 70),
    ]
    results = detect(txns, today=date(2026, 7, 20))
    assert next_date_for("Moved Bill", results) == date(2026, 8, 15)


# ---------------------------------------------------------------------------
# 7. Days 28-31 across months of differing length - a 30th-of-month bill
#    must not get stuck below 30 even once February is behind it.
# ---------------------------------------------------------------------------

def test_30th_bill_should_not_stay_stuck_below_30_once_months_lengthen():
    txns = [
        txn("30th Bill", date(2025, 12, 30), 80),
        txn("30th Bill", date(2026, 1, 30), 80),
    ]
    results = detect(txns, today=date(2026, 4, 15))
    assert next_date_for("30th Bill", results) == date(2026, 4, 30)


# ---------------------------------------------------------------------------
# 8. Non-monthly cadences are unaffected by the monthly-branch bugs
# ---------------------------------------------------------------------------

def test_weekly_cadence_still_projects_correctly():
    # Every Monday for four weeks; "today" is Wed 24 Jun 2026.
    assert date(2026, 6, 24).strftime("%A") == "Wednesday"
    txns = [
        txn("Weekly Sub", date(2026, 6, 1), 10),
        txn("Weekly Sub", date(2026, 6, 8), 10),
        txn("Weekly Sub", date(2026, 6, 15), 10),
        txn("Weekly Sub", date(2026, 6, 22), 10),
    ]
    results = detect(txns, today=date(2026, 6, 24))
    # Next Monday strictly after both today and the last occurrence.
    assert next_date_for("Weekly Sub", results) == date(2026, 6, 29)


def test_fortnightly_cadence_still_projects_correctly():
    # Every other Monday; "today" is Wed 1 Jul 2026.
    assert date(2026, 7, 1).strftime("%A") == "Wednesday"
    txns = [
        txn("Fortnightly Sub", date(2026, 6, 1), 20),
        txn("Fortnightly Sub", date(2026, 6, 15), 20),
        txn("Fortnightly Sub", date(2026, 6, 29), 20),
    ]
    results = detect(txns, today=date(2026, 7, 1))
    # 14 days on from the last occurrence (2026-06-29 + 14 = 2026-07-13).
    assert next_date_for("Fortnightly Sub", results) == date(2026, 7, 13)


# ---------------------------------------------------------------------------
# 9. Last-weekday-of-month cadence (real case: RAINY DAY SAVER STO / FORIS MT
#    LIMITED FE2779354 STO — standing orders set to "last Friday of the
#    month"). Every date below verified with `.strftime("%A")`.
# ---------------------------------------------------------------------------

def test_last_friday_of_month_cadence_full_history():
    for y, m, d in [(2026, 4, 24), (2026, 5, 29), (2026, 6, 26), (2026, 7, 31)]:
        assert date(y, m, d).strftime("%A") == "Friday"
    # 2026-08-28 is the genuine last Friday of August; the un-fixed code
    # gives 2026-08-26 (day-of-month clustering misreads 26/29/31 as a
    # day-26 bill), and naively carrying `last_date.day` forward gives
    # 2026-09-01 (31 clamped into a 30-day September, one month too late).
    assert date(2026, 8, 28).strftime("%A") == "Friday"
    txns = [
        txn("Last Friday STO", date(2026, 4, 24), 100),
        txn("Last Friday STO", date(2026, 5, 29), 100),
        txn("Last Friday STO", date(2026, 6, 26), 100),
        txn("Last Friday STO", date(2026, 7, 31), 100),
    ]
    results = detect(txns, today=date(2026, 8, 20))
    assert next_date_for("Last Friday STO", results) == date(2026, 8, 28)


def test_last_friday_of_month_cadence_90_day_window():
    # Production only ever feeds `_detect_recurring` a 90-day window, so a
    # monthly series has just 3-4 points to reason from — this is the exact
    # 3-point slice `_compute_cashflow_patterns` would see for the real
    # RAINY DAY SAVER / FORIS series as of 2026-08-20.
    txns = [
        txn("Last Friday STO 90d", date(2026, 5, 29), 100),
        txn("Last Friday STO 90d", date(2026, 6, 26), 100),
        txn("Last Friday STO 90d", date(2026, 7, 31), 100),
    ]
    results = detect(txns, today=date(2026, 8, 20))
    assert next_date_for("Last Friday STO 90d", results) == date(2026, 8, 28)


# ---------------------------------------------------------------------------
# 10. Nth-weekday cadence, more generally: first Monday, second Tuesday.
# ---------------------------------------------------------------------------

def test_first_monday_of_month_cadence():
    for y, m, d in [(2026, 3, 2), (2026, 4, 6), (2026, 5, 4), (2026, 6, 1)]:
        assert date(y, m, d).strftime("%A") == "Monday"
    assert date(2026, 7, 6).strftime("%A") == "Monday"  # first Monday of July
    txns = [
        txn("First Monday Sub", date(2026, 3, 2), 15),
        txn("First Monday Sub", date(2026, 4, 6), 15),
        txn("First Monday Sub", date(2026, 5, 4), 15),
        txn("First Monday Sub", date(2026, 6, 1), 15),
    ]
    results = detect(txns, today=date(2026, 6, 10))
    assert next_date_for("First Monday Sub", results) == date(2026, 7, 6)


def test_second_tuesday_of_month_cadence():
    for y, m, d in [(2026, 3, 10), (2026, 4, 14), (2026, 5, 12), (2026, 6, 9)]:
        assert date(y, m, d).strftime("%A") == "Tuesday"
    assert date(2026, 7, 14).strftime("%A") == "Tuesday"  # second Tuesday of July
    txns = [
        txn("Second Tuesday Sub", date(2026, 3, 10), 15),
        txn("Second Tuesday Sub", date(2026, 4, 14), 15),
        txn("Second Tuesday Sub", date(2026, 5, 12), 15),
        txn("Second Tuesday Sub", date(2026, 6, 9), 15),
    ]
    results = detect(txns, today=date(2026, 6, 10))
    assert next_date_for("Second Tuesday Sub", results) == date(2026, 7, 14)


# ---------------------------------------------------------------------------
# 11. Guard: a genuine fixed-day-of-month bill must not be misread as
#     weekday-anchored. This is the over-correction risk of adding weekday
#     detection at all — a bill due the 15th of every month lands on a
#     different weekday almost every time (verified below), so it must keep
#     reading as a plain day-15 bill.
# ---------------------------------------------------------------------------

def test_fixed_day_of_month_bill_not_misread_as_weekday_anchored():
    weekdays = [date(2026, m, 15).strftime("%A") for m in (1, 2, 3, 4)]
    assert weekdays == ["Thursday", "Sunday", "Sunday", "Wednesday"]
    assert len(set(weekdays)) > 1  # genuinely not weekday-constant
    txns = [
        txn("Fixed 15th Bill", date(2026, 1, 15), 45),
        txn("Fixed 15th Bill", date(2026, 2, 15), 45),
        txn("Fixed 15th Bill", date(2026, 3, 15), 45),
        txn("Fixed 15th Bill", date(2026, 4, 15), 45),
    ]
    results = detect(txns, today=date(2026, 4, 20))
    assert next_date_for("Fixed 15th Bill", results) == date(2026, 5, 15)
