"""G163 (Kevin, 2026-09-24, board item, p1): "the AI should know money is
coming in so perhaps I shouldn't flag this, it only becomes a problem the
day after." A payment on account A due on day D is covered if a confirmed
income stream expected in A on or before D has not lapsed; lapse = expected
date + 1 day with no matching credit.

Unit tests for the two pure, Mongo-free pieces this rule is built from:
`app.services.companion.walk_sort_key` (same-day, credits before debits —
used by every per-account walk in companion.py, spend_impact.py and
analytics.at_risk_count) and `app.routers.analytics._late_confirmed_income`
(the interim lapse signal, standing in until G157's own payer matcher
replaces it — see that function's docstring for the full derivation).
"""
from datetime import date, datetime, timedelta

from app.routers.analytics import (
    _late_confirmed_income,
    _prev_scheduled_occurrence,
    PENDING_GIVE_UP_DAYS,
)
from app.services.categories import MOVEMENT
from app.services.companion import walk_sort_key


# ── walk_sort_key ────────────────────────────────────────────────────────────

def test_walk_sort_key_credits_before_debits_on_a_shared_day():
    """Same day (days_away == 5): the income/credit event must sort before
    the debit event, so a walk processing them in order credits first."""
    debit = (5, "acc", 100.0, False, {"name": "Council Tax"})
    credit = (5, "acc", 200.0, True, {"name": "Salary"})
    assert sorted([debit, credit], key=walk_sort_key) == [credit, debit]
    # Order of construction must not matter.
    assert sorted([credit, debit], key=walk_sort_key) == [credit, debit]


def test_walk_sort_key_days_away_dominates_the_credit_debit_tie_break():
    """An earlier debit (day 5) must still sort before a later credit (day
    6) — the same-day tie-break only ever applies WITHIN a shared day."""
    earlier_debit = (5, "acc", 100.0, False, {"name": "Council Tax"})
    later_credit = (6, "acc", 200.0, True, {"name": "Salary"})
    assert sorted([later_credit, earlier_debit], key=walk_sort_key) == [earlier_debit, later_credit]


def test_walk_sort_key_multiple_same_day_debits_keep_stable_relative_order():
    """Two debits on the same day as a credit: both sort after the credit,
    and Python's stable sort keeps them in their original relative order
    (no requirement placed on debit-vs-debit ordering, only credit-first)."""
    credit = (5, "acc", 200.0, True, {"name": "Salary"})
    debit_a = (5, "acc", 50.0, False, {"name": "A"})
    debit_b = (5, "acc", 30.0, False, {"name": "B"})
    ordered = sorted([debit_a, debit_b, credit], key=walk_sort_key)
    assert ordered[0] == credit
    assert {ordered[1][4]["name"], ordered[2][4]["name"]} == {"A", "B"}


# ── at_risk_count-shaped: same-day confirmed income counts zero ─────────────

def _at_risk_count_like(events):
    """Reproduces analytics.at_risk_count's own inline walk locally (that
    function needs a live DB/async request context, so isn't callable
    directly from a pure unit test) — same event shape (days_away, acct,
    amount, is_income, kind) and the same G163 `walk_sort_key` ordering, so
    this is a faithful shape-check that a same-day covered bill never
    counts as at-risk."""
    events = sorted(events, key=walk_sort_key)
    running: dict[str, float] = {}
    at_risk = 0
    for days_away, acct, amount, is_income, kind in events:
        if is_income:
            running[acct] = running.get(acct, 0.0) + amount
        else:
            bal = running.get(acct, 0.0)
            running[acct] = bal - amount
            if bal < amount and kind != MOVEMENT:
                at_risk += 1
    return at_risk


def test_at_risk_count_shaped_bill_covered_by_same_day_income_counts_zero():
    """A commitment bill due day 5, with confirmed income of a covering
    amount also expected day 5 into the SAME account, must count zero
    at-risk — G163's whole point, in the badge's own event shape."""
    events = [
        (5, "acc", 100.0, False, "commitment"),
        (5, "acc", 200.0, True, None),
    ]
    assert _at_risk_count_like(events) == 0


def test_at_risk_count_shaped_bill_with_no_covering_income_still_counts():
    """Regression guard: without the same-day credit, the same bill still
    counts — this item changes the ORDER, not whether a genuine shortfall
    is ever caught."""
    events = [(5, "acc", 100.0, False, "commitment")]
    assert _at_risk_count_like(events) == 1


# ── _prev_scheduled_occurrence ───────────────────────────────────────────────

SCHEDULE = {"type": "day_of_month", "day": 25}


def test_prev_scheduled_occurrence_is_the_last_one_strictly_before_today():
    # Today is the expected day itself — nothing has happened yet that
    # could be "before" it in this cycle, so the previous MONTH's
    # occurrence (31 days back) is what's returned.
    prev = _prev_scheduled_occurrence(SCHEDULE, date(2026, 9, 25))
    assert prev == date(2026, 8, 25)


def test_prev_scheduled_occurrence_one_day_after_expected():
    prev = _prev_scheduled_occurrence(SCHEDULE, date(2026, 9, 26))
    assert prev == date(2026, 9, 25)


# ── _late_confirmed_income ───────────────────────────────────────────────────

def _stream(account_id="acc-1", avg_amount=2000.0):
    return {
        "status": "confirmed",
        "schedule": SCHEDULE,
        "avg_amount": avg_amount,
        "account_id": account_id,
    }


def _credit(d: date, amount: float, account_id="acc-1"):
    return {"date": datetime(d.year, d.month, d.day), "amount": amount, "account_id": account_id}


def test_not_lapsed_on_the_expected_day_itself():
    """Today IS the expected day (25th) — the stream hasn't even become due
    yet, let alone lapsed. `_prev_scheduled_occurrence` returns last
    MONTH'S occurrence (31 days back), which is already well past
    PENDING_GIVE_UP_DAYS, so this stream is silently absent from the
    result, exactly as if nothing were wrong."""
    today = date(2026, 9, 25)
    confirmed_income_map = {"SALARY": _stream()}
    result = _late_confirmed_income(confirmed_income_map, [], today)
    assert result == []


def test_lapsed_the_day_after_with_no_matching_credit():
    """Expected 25 Sep, today is 26 Sep, and no credit anywhere near that
    date/amount/account — lapsed, reported with the right shape."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream()}
    result = _late_confirmed_income(confirmed_income_map, [], today)
    assert len(result) == 1
    entry = result[0]
    assert entry["key"] == "SALARY"
    assert entry["amount"] == 2000.0
    assert entry["expected_date"] == "2026-09-25"
    assert entry["days_late"] == 1
    assert entry["account_id"] == "acc-1"


def test_cleared_by_a_credit_within_15_percent_under_a_different_series_key():
    """The whole point of matching by amount band + account rather than
    series key: a credit dated just before the expected day, within 15
    percent of avg_amount, landing in the SAME account, clears the lapse —
    even though nothing here ties it to the stream's own key (a payroll
    reference change forking the series key, G157, is exactly why matching
    must not require the key to agree)."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream(avg_amount=2000.0)}
    # £1,900 is within 15% of £2,000 (5% off).
    credits = [_credit(date(2026, 9, 24), 1900.0, account_id="acc-1")]
    result = _late_confirmed_income(confirmed_income_map, credits, today)
    assert result == []


def test_credit_outside_amount_band_does_not_clear_the_lapse():
    """Regression guard: a credit that's nowhere near the expected amount
    (a different, smaller payment into the same account) must not
    incorrectly clear the lapse."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream(avg_amount=2000.0)}
    credits = [_credit(date(2026, 9, 24), 50.0, account_id="acc-1")]
    result = _late_confirmed_income(confirmed_income_map, credits, today)
    assert len(result) == 1


def test_credit_into_a_different_account_does_not_clear_the_lapse():
    """Per-account attribution matters here too — a matching amount landing
    in a DIFFERENT account must not clear this account's lapse."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream(account_id="acc-1", avg_amount=2000.0)}
    credits = [_credit(date(2026, 9, 24), 2000.0, account_id="acc-other")]
    result = _late_confirmed_income(confirmed_income_map, credits, today)
    assert len(result) == 1


def test_skipped_after_pending_give_up_days():
    """More than PENDING_GIVE_UP_DAYS (10) after the expected date, this
    interim signal stops reporting the stream as late — by then G157's own
    missed-cycles rule and payday-confirmation ask take over."""
    today = date(2026, 9, 25) + timedelta(days=PENDING_GIVE_UP_DAYS + 1)
    confirmed_income_map = {"SALARY": _stream()}
    result = _late_confirmed_income(confirmed_income_map, [], today)
    assert result == []


def test_manual_stream_never_reported():
    """`key == "manual"` has no transaction history to key off (see
    `_confirmed_income_fallback`'s own carve-out) — must never be
    considered here either."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"manual": _stream()}
    result = _late_confirmed_income(confirmed_income_map, [], today)
    assert result == []


def test_unconfirmed_stream_never_reported():
    today = date(2026, 9, 26)
    stream = _stream()
    stream["status"] = "rejected"
    confirmed_income_map = {"SALARY": stream}
    result = _late_confirmed_income(confirmed_income_map, [], today)
    assert result == []


def test_stream_without_schedule_is_skipped():
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": {"status": "confirmed", "avg_amount": 2000.0}}
    result = _late_confirmed_income(confirmed_income_map, [], today)
    assert result == []
