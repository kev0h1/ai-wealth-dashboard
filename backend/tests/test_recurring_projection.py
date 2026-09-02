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
from datetime import date, datetime, timedelta

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
    # A real Feb occurrence is included (clamped to 2026's Feb 28, a
    # non-leap year) rather than skipping straight from Jan to a `today` two
    # and a half months later: the bill genuinely continued being paid
    # through February (that's the whole scenario this test is about), and
    # without it the staleness guard (analytics.py, added 2026-08-27; see
    # `today_at()` in test_recurring.py for the same fix applied there)
    # would read a Jan-30-to-Apr-15 gap as "stopped" and drop the series
    # before the assertion below ever gets to check the anchor recovers to
    # 30. Feb 28 is its own month's exact last day, so `_monthly_anchor`
    # already treats it as uninformative for anchor derivation (see that
    # function's docstring, step 2) — adding it doesn't change which day
    # the series anchors on, only how recent its last real occurrence is.
    txns = [
        txn("30th Bill", date(2025, 12, 30), 80),
        txn("30th Bill", date(2026, 1, 30), 80),
        txn("30th Bill", date(2026, 2, 28), 80),
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


# ---------------------------------------------------------------------------
# 12. Regression, 2026-08-27: the day-before-payday 2-occurrence cliff.
#
# Production only ever feeds `_detect_recurring` a 90-day window. Test 9
# above (`..._90_day_window`) already pins the 3-point slice this same
# last-Friday series sees most of the month, correctly landing on the real
# 2026-08-28 payday because 3 points average their interval (28 + 35) / 2
# = 31.5, comfortably inside the monthly branch's old 26-33 band. But the
# day BEFORE payday, the window can hold only the newest 2 occurrences
# (2026-06-26, 2026-07-31 — the 2026-05-29 one has just aged past the
# 90-day cutoff), leaving one raw interval of exactly 35 days: one day
# outside that old band. Falling through to the naive `else` branch there
# didn't just blur the date, it projected 2026-09-04 — a full week past the
# real occurrence, and far enough outside the at-risk walk's payday-window
# lookahead that HSBC/NatWest/Monzo read as falsely short even after
# `K MONZO TEST STO` (Transfer) started being trusted at 2 occurrences
# again (see test_transfer_category_now_trusted_at_two_occurrences in
# test_recurring.py — the Transfer-trust fix alone is not sufficient; this
# projection-boundary fix is what actually keeps the mirrored inflow inside
# the walk's window). Raising the monthly branch's upper bound to 35 (this
# function's own outer acceptance ceiling — see the `avg_interval > 35`
# rejection near the top of `_detect_recurring`) routes this 2-point slice
# through the smart anchor instead. With only ONE informative point
# (2026-07-31 is its own month's exact last day, so it's excluded — see
# `_monthly_anchor` step 2), the anchor reads as day-26 rather than
# recovering the true "last Friday" pattern (that needs 3+ points, see
# `_monthly_anchor` step 1) — an honest degrade, not a wrong answer: day-26
# in August is 2026-08-26, which is in the PAST relative to `today`, so it
# lands inside the PENDING_GIVE_UP_DAYS grace window rather than advancing
# a further month out. That is a materially better outcome than the old
# week-late projection: it is 2 days early rather than 7 days late, and
# `_build_cashflow_response` clamps any pending (already-due) date up to
# "today" for display, so this reads as "due today" rather than overdue.
# ---------------------------------------------------------------------------

def test_two_occurrence_35_day_interval_projects_near_payday_not_a_week_late():
    txns = [
        txn("K MONZO TEST STO", date(2026, 6, 26), 1106.0, category="Transfer"),
        txn("K MONZO TEST STO", date(2026, 7, 31), 1106.0, category="Transfer"),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    next_date = next_date_for("K MONZO TEST STO", results)
    # Must land within a few days of the real 2026-08-28 occurrence, not the
    # pre-fix 2026-09-04 (a full week late, and outside the at-risk walk's
    # lookahead window).
    assert abs((next_date - date(2026, 8, 28)).days) <= 3
    assert next_date == date(2026, 8, 26)


# ---------------------------------------------------------------------------
# 13. Regression, 2026-08-27: the 180-day window widening itself.
#
# Test 11 above (`test_last_friday_of_month_cadence_full_history`) already
# proves `_detect_recurring` reads this exact 4-point shape correctly when
# it's given all 4 points. What it doesn't prove is that the CALLER
# (`_compute_cashflow_patterns`) actually hands it all 4 -- that's the
# real regression: production only fed `_detect_recurring` a 90-day window,
# so on 2026-08-27 (today, here) the 2026-04-24 occurrence had already aged
# out, leaving only 2 points and mispredicting Wed 2026-08-26 (see test 12
# above) instead of the true Fri 2026-08-28. Pinned at the exact incident
# date so this stands as the regression anchor for the window-widening fix:
# `_compute_cashflow_patterns` now loads 180 days, which keeps all 4 points
# in view on 2026-08-27 (2026-04-24 is 125 days back, comfortably inside
# 180, whereas it's 25 days past the old 90-day cutoff).
# ---------------------------------------------------------------------------

def test_widened_window_keeps_four_points_and_predicts_last_friday():
    txns = [
        txn("Last Friday STO", date(2026, 4, 24), 100),
        txn("Last Friday STO", date(2026, 5, 29), 100),
        txn("Last Friday STO", date(2026, 6, 26), 100),
        txn("Last Friday STO", date(2026, 7, 31), 100),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    assert next_date_for("Last Friday STO", results) == date(2026, 8, 28)


# ---------------------------------------------------------------------------
# 14. Staleness guard: a series that genuinely stopped must not keep
#     projecting just because the widened 180-day window still contains it.
# ---------------------------------------------------------------------------

def test_stale_monthly_series_stops_projecting():
    # Monthly cadence (~30 days), last real occurrence 2026-05-24 -- 95 days
    # before today (2026-08-27), well past max(2*30, 45) = 60 days. A
    # cancelled gym membership is the real-world shape: it happened
    # regularly for a while, then genuinely stopped.
    txns = [
        txn("Cancelled Gym", date(2026, 3, 24), 40),
        txn("Cancelled Gym", date(2026, 4, 24), 40),
        txn("Cancelled Gym", date(2026, 5, 24), 40),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    assert "Cancelled Gym" not in {r["key"] for r in results}


def test_monthly_series_within_grace_still_projects():
    # Same cadence, but the last occurrence is only 40 days back -- inside
    # the 45-day floor, so a single late/skipped cycle must not be misread
    # as "stopped".
    txns = [
        txn("Still Going Gym", date(2026, 5, 18), 40),
        txn("Still Going Gym", date(2026, 6, 18), 40),
        txn("Still Going Gym", date(2026, 7, 18), 40),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    assert "Still Going Gym" in {r["key"] for r in results}


# ---------------------------------------------------------------------------
# 15. Recent-amount averaging: a bill's projected amount tracks its most
#     recent occurrences, not a mean across the whole 180-day window.
# ---------------------------------------------------------------------------

def test_avg_amount_tracks_recent_occurrences_not_full_window_mean():
    # Six occurrences: price was £10 for the first three, rose to £12 for
    # the most recent three. A price change 4-5 months back must not drag
    # the projected amount down from what the bill actually costs now.
    txns = [
        txn("Streaming Sub", date(2026, 3, 5), 10, account_id="acc1"),
        txn("Streaming Sub", date(2026, 4, 5), 10, account_id="acc1"),
        txn("Streaming Sub", date(2026, 5, 5), 10, account_id="acc1"),
        txn("Streaming Sub", date(2026, 6, 5), 12, account_id="acc1"),
        txn("Streaming Sub", date(2026, 7, 5), 12, account_id="acc1"),
        txn("Streaming Sub", date(2026, 8, 5), 12, account_id="acc1"),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    matches = [r for r in results if r["key"] == "Streaming Sub"]
    assert len(matches) == 1
    # Recent-3 mean is exactly 12.0; a full-window mean across all 6 would
    # be 11.0, which this assertion rules out.
    assert matches[0]["avg_amount"] == 12.0


# ---------------------------------------------------------------------------
# 16. Income stays on the full-window mean: recent-amount averaging is
#     scoped to bills only (`is_income=False`), never applied to income.
# ---------------------------------------------------------------------------

def test_income_avg_amount_unaffected_by_recent_averaging():
    # 8 weekly occurrences: 500 for the first four, 600 for the last four.
    # Full-window mean = 550.0. If recent-amount averaging leaked into the
    # income branch, this would read 600.0 (the last-3 mean) instead.
    txns = []
    d = date(2026, 6, 1)
    for i, amount in enumerate([500, 500, 500, 500, 600, 600, 600, 600]):
        txns.append(txn("ACME PAYROLL WEEKLY", d + timedelta(days=7 * i), amount, category="Income"))
    results = _detect_recurring(txns, today=date(2026, 7, 25), is_income=True)
    matches = [r for r in results if r["key"] == "ACME PAYROLL WEEKLY"]
    assert len(matches) == 1
    assert matches[0]["avg_amount"] == 550.0


# ---------------------------------------------------------------------------
# 17. Regression, 2026-08-27: an old, unrelated occurrence sharing a
#     merchant key must not delist a series that is still actively
#     recurring. Found live on production data the same day the 180-day
#     window shipped -- see the WHY comment in `_detect_recurring` above
#     the trim-and-retry loop.
# ---------------------------------------------------------------------------

def test_stale_outlier_does_not_delist_an_otherwise_clean_recent_cadence():
    # Kevin's real "PLAYSTATION LONDON" shape: an unrelated March purchase
    # (80 days before the next one) followed by three clean monthly
    # occurrences. On the full 4-point set avg_interval is
    # (80 + 30 + 31) / 3 = 47, over the 35-day ceiling -- without the
    # trim-and-retry loop this series is rejected outright, even though
    # it's still charging monthly as of 8 days ago. Trimming the March
    # outlier recovers the trailing 3-point cadence (avg_interval 30.5),
    # exactly what the OLD 90-day window would already have seen (March is
    # 160 days before today, never inside a 90-day load in the first
    # place).
    txns = [
        txn("Streaming Sub 2", date(2026, 3, 20), 13.49, category="Subscriptions"),
        txn("Streaming Sub 2", date(2026, 6, 8), 13.49, category="Subscriptions"),
        txn("Streaming Sub 2", date(2026, 7, 8), 13.49, category="Subscriptions"),
        txn("Streaming Sub 2", date(2026, 8, 8), 13.49, category="Subscriptions"),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    matches = [r for r in results if r["key"] == "Streaming Sub 2"]
    assert len(matches) == 1
    assert matches[0]["occurrences"] == 3  # the March outlier is trimmed, not counted
    assert matches[0]["next_date"] == date(2026, 9, 8)


def test_genuine_noise_still_rejected_after_exhausting_trim_attempts():
    # No trailing subset of this series ever has a regular cadence (gaps of
    # 80, 3, 90 days) -- the trim-and-retry loop must give up once it hits
    # min_occurrences, not paper over genuine noise by trimming forever.
    txns = [
        txn("Random Noise", date(2026, 3, 1), 20),
        txn("Random Noise", date(2026, 5, 20), 20),
        txn("Random Noise", date(2026, 5, 23), 20),
        txn("Random Noise", date(2026, 8, 21), 20),
    ]
    results = detect(txns, today=date(2026, 8, 27))
    assert "Random Noise" not in {r["key"] for r in results}
