"""Unit tests for the current-window/payday-day boundary helpers added to
app.services.pay_period for the 2026-08-28 decision: a bill/income/inflow
scheduled ON payday (days_away == days_to_pay) no longer counts in the
CURRENT pay period's at-risk/shortfall/to-last arithmetic (it moves into a
visible-only "payday day" slice instead), except during the pre-existing
last-day lookahead (days_to_pay <= 1), which is unchanged.

These are pure, no-DB tests of `in_current_window`/`is_payday_day` in
isolation — the three call sites that consume them (companion.py,
spend_impact.py, analytics.py's at_risk_count) are covered by their own
integration tests (see tests/test_payday_split.py for companion.py's new
payday_split/payday_split_risk payload).
"""
from app.services.pay_period import in_current_window, is_payday_day


def test_boundary_partition_is_clean_for_a_typical_mid_period_days_to_pay():
    """current / payday-day / strictly-after must cover every days_away
    exactly once — no item double-counted, none dropped."""
    days_to_pay = 12
    for days_away in range(0, 40):
        buckets = [
            in_current_window(days_away, days_to_pay),
            is_payday_day(days_away, days_to_pay),
            days_away > days_to_pay,  # "strictly after" — the complement
        ]
        assert sum(buckets) == 1, (days_away, buckets)


def test_boundary_partition_is_clean_across_every_days_to_pay_value():
    """Same partition property, swept across the full practical range of
    days_to_pay (0 through 31, covering both the last-day-lookahead regime
    and ordinary mid-period values)."""
    for days_to_pay in range(0, 32):
        for days_away in range(0, 40):
            current = in_current_window(days_away, days_to_pay)
            payday_day = is_payday_day(days_away, days_to_pay)
            if days_to_pay <= 1:
                after = days_away > days_to_pay + 5
            else:
                after = days_away > days_to_pay
            assert sum([current, payday_day, after]) == 1, (days_to_pay, days_away)


def test_payday_day_item_excluded_from_current_window():
    """The item scheduled exactly ON payday must be counted as payday-day,
    not current — the core of the 2026-08-28 decision."""
    assert is_payday_day(5, 5) is True
    assert in_current_window(5, 5) is False


def test_day_before_payday_still_counts_as_current():
    assert in_current_window(4, 5) is True
    assert is_payday_day(4, 5) is False


def test_day_after_payday_is_neither_current_nor_payday_day():
    assert in_current_window(6, 5) is False
    assert is_payday_day(6, 5) is False


def test_last_day_lookahead_unchanged_when_days_to_pay_is_one():
    """Pre-existing behaviour, deliberately preserved: once payday is
    tomorrow, the window still extends five days past it (assessing the
    next period's first few days at the turn), and payday day itself is
    swallowed into that widened window rather than split out."""
    days_to_pay = 1
    # Old inclusive formula for this regime: days_away <= days_to_pay + 5 == 6.
    for days_away in range(0, 7):
        assert in_current_window(days_away, days_to_pay) is True
        assert is_payday_day(days_away, days_to_pay) is False
    assert in_current_window(7, days_to_pay) is False


def test_last_day_lookahead_unchanged_when_days_to_pay_is_zero():
    """days_to_pay == 0 — today itself is a confirmed payday (the period has
    rolled). Same widened-window regime as days_to_pay == 1; must stay sane
    (no crash, no double-partition) rather than a special case."""
    for days_away in range(0, 6):
        assert in_current_window(days_away, 0) is True
        assert is_payday_day(days_away, 0) is False
    assert in_current_window(6, 0) is False


def test_negative_days_away_never_counts_anywhere():
    """Matches the precedent in analytics.compute_safe_to_spend's own
    `0 <= days_away < days_until_payday` filter — upcoming items are never
    expected to carry a negative days_away, but the boundary must not
    silently count one if it ever did."""
    assert in_current_window(-1, 5) is False
    assert is_payday_day(-1, 5) is False
