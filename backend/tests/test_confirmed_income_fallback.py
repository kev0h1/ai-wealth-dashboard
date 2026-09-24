"""G158: a confirmed income stream must keep forecasting even when
`_detect_recurring`'s own 90-day window/2-occurrence floor loses it -- see
`_confirmed_income_fallback`'s docstring in analytics.py for the exact
mechanism (flat window sliding past an occurrence, or a payroll reference
change splitting one salary across two series keys, each alone under the
floor). Pure, Mongo-free tests: the helper takes plain dicts.
"""
from datetime import date, datetime

from app.routers.analytics import _detect_recurring, _confirmed_income_fallback, _build_confirmed_income_map

TODAY = date(2026, 9, 24)

CONFIRMED_KEY = "185008 12702436 Goldman Sachs BGC"
NEW_REF_KEY = "0201-GOLDMAN SACHS GOLDMAN SACHS PA"

CONFIRMED_STREAM = {
    "key": CONFIRMED_KEY,
    "status": "confirmed",
    "schedule": {"type": "last_weekday", "weekday": 4},
    "avg_amount": 4798.08,
    "last_seen": "2026-07-31",
    "confirmed_at": "2026-08-02T09:00:00",
}


def income_txn(merchant, d, amount):
    return {
        "merchant_name": merchant,
        "description": merchant,
        "amount": amount,
        "date": datetime(d.year, d.month, d.day),
        "category": "Income",
        "custom_category": None,
        "account_id": "acc1",
    }


def test_absent_confirmed_stream_is_synthesised():
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY)
    assert len(result) == 1
    entry = result[0]
    assert entry["key"] == CONFIRMED_KEY
    assert entry["next_date"] == date(2026, 9, 25)
    assert entry["avg_amount"] == 4798.08
    assert entry["source"] == "confirmed"
    assert entry["last_date"] == date(2026, 7, 31)


def test_already_detected_stream_is_not_duplicated():
    already_detected = [{"key": CONFIRMED_KEY, "avg_amount": 4798.08, "next_date": date(2026, 9, 25)}]
    result = _confirmed_income_fallback(already_detected, {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY)
    assert result == []


def test_dismissed_key_is_not_synthesised():
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: CONFIRMED_STREAM}, {CONFIRMED_KEY}, TODAY)
    assert result == []


def test_stream_without_schedule_is_skipped():
    no_schedule = {**CONFIRMED_STREAM, "schedule": None}
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: no_schedule}, set(), TODAY)
    assert result == []


def test_manual_key_is_skipped():
    manual_stream = {**CONFIRMED_STREAM, "key": "manual"}
    result = _confirmed_income_fallback([], {"manual": manual_stream}, set(), TODAY)
    assert result == []


def test_reference_change_scenario_end_to_end():
    """Kevin's real 2026-09-24 case: three Goldman Sachs credits under the
    old payroll reference, then one under a new reference after the bank
    changed it. As of `TODAY`, only the newest occurrence under EACH key is
    still inside the (already-applied, in this fixture) 90-day window -- one
    under the confirmed key, one under the new, orphan key -- both below
    `_detect_recurring`'s 2-occurrence floor, so plain detection finds no
    salary at all. The confirmed stream must still forecast.
    """
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 7, 31), 4798.08),
        income_txn(NEW_REF_KEY, date(2026, 8, 28), 4798.08),
    ]
    recurring_income = _detect_recurring(income_credits, today=TODAY, is_income=True)
    # Both keys have exactly one in-window occurrence -- under the floor.
    assert recurring_income == []

    credits_by_key: dict = {}
    for t in income_credits:
        credits_by_key.setdefault(t["merchant_name"], []).append(t)

    fallback = _confirmed_income_fallback(
        recurring_income, {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, credits_by_key,
    )
    assert len(fallback) == 1
    entry = fallback[0]
    assert entry["key"] == CONFIRMED_KEY
    assert entry["next_date"] == date(2026, 9, 25)
    assert entry["avg_amount"] == 4798.08
    assert entry["source"] == "confirmed"
    assert entry["occurrences"] == 1


# ── 2026-09-24 review follow-up: malformed `income_streams` entries must ──
# ── degrade to "skip that entry", never raise and crash Safe to Spend ─────

def test_build_confirmed_income_map_skips_entry_with_no_key():
    malformed = {"status": "confirmed", "schedule": {"type": "last_weekday", "weekday": 4}, "avg_amount": 4798.08}
    income_streams = [malformed, CONFIRMED_STREAM]
    result = _build_confirmed_income_map(income_streams)
    # The malformed entry (no "key") is skipped; the well-formed one is not.
    assert list(result.keys()) == [CONFIRMED_KEY]


def test_build_confirmed_income_map_skips_non_dict_entry():
    income_streams = ["not-a-stream-dict", None, CONFIRMED_STREAM]
    result = _build_confirmed_income_map(income_streams)
    assert list(result.keys()) == [CONFIRMED_KEY]


def test_fallback_skips_entry_whose_schedule_is_a_string_instead_of_raising():
    # A truthy but non-dict schedule -- e.g. a stray string from a bad write
    # -- must not raise (`schedule["type"]` on a str is a TypeError, not a
    # KeyError, so the except clause must catch both).
    bad_schedule_stream = {**CONFIRMED_STREAM, "schedule": "last_weekday"}
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: bad_schedule_stream}, set(), TODAY)
    assert result == []
