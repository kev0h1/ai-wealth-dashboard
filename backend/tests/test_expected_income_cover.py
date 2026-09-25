"""G163 (Kevin, 2026-09-24, board item, p1): "the AI should know money is
coming in so perhaps I shouldn't flag this, it only becomes a problem the
day after." A payment on account A due on day D is covered if a confirmed
income stream expected in A on or before D has not lapsed; lapse = expected
date + 1 day with no matching credit.

G167 (review of G163, p2) widened the interim lapse signal to also cover
reliable but merely DETECTED (unconfirmed) income patterns — the same
population `income_credit_ok` already credits into the walk, just without
this signal previously naming it when it lapses.

Unit tests for the pure, Mongo-free pieces this rule is built from:
`app.services.companion.walk_sort_key` (same-day, credits before debits —
used by every per-account walk in companion.py, spend_impact.py and
analytics.at_risk_count), `app.routers.analytics._late_reliable_income`
(the interim lapse signal, standing in until G157's own payer matcher
replaces it — see that function's docstring for the full derivation), and
`app.routers.analytics._income_pattern_reliable` (the shared reliability
predicate `income_credit_ok` and `_late_reliable_income` both call, so the
population credited into the walk and the population explained by this
signal can never drift apart).
"""
from datetime import date, datetime, timedelta

from app.routers.analytics import (
    _late_reliable_income,
    _income_pattern_reliable,
    _prev_scheduled_occurrence,
    income_credit_ok,
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


# ── _late_reliable_income: confirmed branch ─────────────────────────────────

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
    result = _late_reliable_income(confirmed_income_map, [], [], today)
    assert result == []


def test_lapsed_the_day_after_with_no_matching_credit():
    """Expected 25 Sep, today is 26 Sep, and no credit anywhere near that
    date/amount/account — lapsed, reported with the right shape, sourced
    "confirmed"."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream()}
    result = _late_reliable_income(confirmed_income_map, [], [], today)
    assert len(result) == 1
    entry = result[0]
    assert entry["key"] == "SALARY"
    assert entry["amount"] == 2000.0
    assert entry["expected_date"] == "2026-09-25"
    assert entry["days_late"] == 1
    assert entry["account_id"] == "acc-1"
    assert entry["source"] == "confirmed"


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
    result = _late_reliable_income(confirmed_income_map, [], credits, today)
    assert result == []


def test_credit_outside_amount_band_does_not_clear_the_lapse():
    """Regression guard: a credit that's nowhere near the expected amount
    (a different, smaller payment into the same account) must not
    incorrectly clear the lapse."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream(avg_amount=2000.0)}
    credits = [_credit(date(2026, 9, 24), 50.0, account_id="acc-1")]
    result = _late_reliable_income(confirmed_income_map, [], credits, today)
    assert len(result) == 1


def test_credit_into_a_different_account_does_not_clear_the_lapse():
    """Per-account attribution matters here too — a matching amount landing
    in a DIFFERENT account must not clear this account's lapse."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream(account_id="acc-1", avg_amount=2000.0)}
    credits = [_credit(date(2026, 9, 24), 2000.0, account_id="acc-other")]
    result = _late_reliable_income(confirmed_income_map, [], credits, today)
    assert len(result) == 1


def test_skipped_after_pending_give_up_days():
    """More than PENDING_GIVE_UP_DAYS (10) after the expected date, this
    interim signal stops reporting the stream as late — by then G157's own
    missed-cycles rule and payday-confirmation ask take over."""
    today = date(2026, 9, 25) + timedelta(days=PENDING_GIVE_UP_DAYS + 1)
    confirmed_income_map = {"SALARY": _stream()}
    result = _late_reliable_income(confirmed_income_map, [], [], today)
    assert result == []


def test_manual_stream_never_reported():
    """`key == "manual"` has no transaction history to key off (see
    `_confirmed_income_fallback`'s own carve-out) — must never be
    considered here either."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"manual": _stream()}
    result = _late_reliable_income(confirmed_income_map, [], [], today)
    assert result == []


def test_unconfirmed_stream_never_reported():
    today = date(2026, 9, 26)
    stream = _stream()
    stream["status"] = "rejected"
    confirmed_income_map = {"SALARY": stream}
    result = _late_reliable_income(confirmed_income_map, [], [], today)
    assert result == []


def test_stream_without_schedule_is_skipped():
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": {"status": "confirmed", "avg_amount": 2000.0}}
    result = _late_reliable_income(confirmed_income_map, [], [], today)
    assert result == []


# ── _late_reliable_income: detected branch (G167) ───────────────────────────

def _detected_pattern(
    key="FREELANCE CLIENT",
    account_id="acc-2",
    avg_amount=800.0,
    avg_interval=30,
    next_date=date(2026, 9, 25),
    occurrences=3,
    amounts_recent=(800.0, 800.0, 800.0),
):
    return {
        "key": key,
        "avg_amount": avg_amount,
        "avg_interval": avg_interval,
        "next_date": next_date,
        "account_id": account_id,
        "occurrences": occurrences,
        "amounts_recent": list(amounts_recent),
    }


def test_income_pattern_reliable_requires_three_occurrences_and_stable_amounts():
    """The shared reliability predicate itself: fewer than 3 occurrences,
    or recent amounts that swing past the 1.5x band, both fail — proven
    directly here so `_late_reliable_income`'s own detected-branch tests
    below aren't the only place this ever gets exercised."""
    assert _income_pattern_reliable(_detected_pattern(occurrences=3, amounts_recent=(800.0, 800.0, 800.0)))
    assert not _income_pattern_reliable(_detected_pattern(occurrences=2, amounts_recent=(800.0, 800.0)))
    assert not _income_pattern_reliable(
        _detected_pattern(occurrences=3, amounts_recent=(400.0, 800.0, 800.0))
    )


def test_detected_reliable_pattern_lapsed_on_d_plus_1_is_reported_as_detected():
    """A pattern the user never confirmed, but with 3+ occurrences and
    stable amounts (the SAME bar `income_credit_ok` requires before
    crediting it into the walk at all — asserted directly below, so the
    two can never drift): `next_date` 25 Sep, `avg_interval` 30 days puts
    `prev_expected` at 26 Aug, well past PENDING_GIVE_UP_DAYS by 26 Sep —
    use a `next_date` close enough to today that D+1 is still inside the
    give-up window."""
    today = date(2026, 9, 26)
    pattern = _detected_pattern(next_date=date(2026, 9, 25), avg_interval=1)
    assert income_credit_ok(pattern, "acc-2") is True  # same gate the walk itself uses
    result = _late_reliable_income({}, [pattern], [], today)
    assert len(result) == 1
    entry = result[0]
    assert entry["key"] == "FREELANCE CLIENT"
    assert entry["amount"] == 800.0
    assert entry["expected_date"] == "2026-09-24"  # next_date (25th) minus avg_interval (1 day)
    assert entry["days_late"] == 2
    assert entry["account_id"] == "acc-2"
    assert entry["source"] == "detected"


def test_detected_pattern_with_two_occurrences_is_not_reported():
    """Below the reliability floor — must not be reported, and must also
    fail `income_credit_ok` (the shared predicate proving the two gates
    agree: too unreliable to be credited into the walk, too unreliable to
    be named when it lapses)."""
    today = date(2026, 9, 26)
    pattern = _detected_pattern(next_date=date(2026, 9, 25), avg_interval=1, occurrences=2,
                                 amounts_recent=(800.0, 800.0))
    assert income_credit_ok(pattern, "acc-2") is False
    result = _late_reliable_income({}, [pattern], [], today)
    assert result == []


def test_detected_pattern_with_unstable_amounts_is_not_reported():
    """Above the occurrence floor but amounts swing past 1.5x — same
    conclusion, same shared-predicate proof."""
    today = date(2026, 9, 26)
    pattern = _detected_pattern(next_date=date(2026, 9, 25), avg_interval=1,
                                 amounts_recent=(300.0, 800.0, 800.0))
    assert income_credit_ok(pattern, "acc-2") is False
    result = _late_reliable_income({}, [pattern], [], today)
    assert result == []


def test_detected_pattern_cleared_by_a_matching_credit():
    """Same amount-band-plus-account matching as the confirmed branch."""
    today = date(2026, 9, 26)
    pattern = _detected_pattern(next_date=date(2026, 9, 25), avg_interval=1)
    credits = [_credit(date(2026, 9, 24), 790.0, account_id="acc-2")]
    result = _late_reliable_income({}, [pattern], credits, today)
    assert result == []


def test_confirmed_key_never_double_reported_from_the_detected_branch():
    """A key present in `confirmed_income_map` is reported (if at all) by
    the confirmed branch alone — even if the SAME key also shows up in
    `recurring_income` (a real detected series behind a confirmed stream,
    or the G158 synthesised fallback), it must not additionally surface a
    second, "detected" entry for itself."""
    today = date(2026, 9, 26)
    confirmed_income_map = {"SALARY": _stream()}
    detected_dup = _detected_pattern(key="SALARY", account_id="acc-1", avg_amount=2000.0,
                                      next_date=date(2026, 9, 25), avg_interval=1)
    result = _late_reliable_income(confirmed_income_map, [detected_dup], [], today)
    assert len(result) == 1
    assert result[0]["source"] == "confirmed"


def test_detected_pattern_not_yet_due_is_not_reported():
    """`next_date` far enough in the future that `prev_expected` (next_date
    minus avg_interval) is still today or later — nothing has lapsed yet."""
    today = date(2026, 9, 20)
    pattern = _detected_pattern(next_date=date(2026, 9, 25), avg_interval=1)
    result = _late_reliable_income({}, [pattern], [], today)
    assert result == []
