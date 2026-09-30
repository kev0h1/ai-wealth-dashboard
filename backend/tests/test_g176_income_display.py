"""G176 regressions for income presentation labels and inferred cadence.

The opaque payer key remains the action identifier. These tests deliberately
exercise the cashflow response, where a display label must not replace it.
"""
import asyncio
from datetime import date, datetime

import app.routers.analytics as analytics
from app.routers.analytics import _build_cashflow_response, _confirmed_income_fallback, _detect_recurring


def _income_txn(merchant: str, when: date, amount: float, account_id: str = "acct-1") -> dict:
    return {
        "merchant_name": merchant,
        "description": merchant,
        "amount": amount,
        "date": datetime(when.year, when.month, when.day),
        "category": "Income",
        "custom_category": None,
        "account_id": account_id,
    }


def _cached_income(**pattern) -> dict:
    return {
        "patterns_version": analytics.PATTERNS_VERSION,
        "recurring_spend": [],
        "recurring_income": [pattern],
        "bnpl_commitments": [],
        "avg_daily_spend": 0,
    }


def test_income_pattern_keeps_opaque_key_but_captures_original_display_name(monkeypatch):
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 1, 9, 0))
    rows = [
        _income_txn("GOLDMAN SACHS BGC", date(2026, 7, 31), 4797.95),
        _income_txn("GOLDMAN SACHS BGC", date(2026, 8, 28), 4797.95),
        _income_txn("GOLDMAN SACHS BGC", date(2026, 9, 30), 4797.95),
    ]
    pattern = _detect_recurring(rows, today=date(2026, 10, 1), is_income=True)[0]

    assert pattern["key"] == "goldman|sachs::acct-1"
    assert pattern["display_name"] == "Goldman Sachs"

    response = asyncio.run(_build_cashflow_response(_cached_income(**{
        "key": pattern["key"], "display_name": pattern["display_name"],
        "avg_interval": pattern["avg_interval"], "avg_amount": pattern["avg_amount"],
        "next_date": "2026-10-30", "category": "Income",
    })))
    row = response["upcoming_income"][0]
    assert row["name"] == pattern["key"]  # edit/skip/dismiss identity
    assert row["display_name"] == "Goldman Sachs"  # presentation only


def test_inferred_sixteen_day_mean_repeats_fortnightly(monkeypatch):
    """A 16-day posting mean was classified as biweekly, then incorrectly
    emitted as 13 Oct and 29 Oct. Once its first date is 13 Oct, the next
    inferred occurrence must follow the detector's 14-day cadence."""
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 1, 9, 0))
    response = asyncio.run(_build_cashflow_response(_cached_income(**{
        "key": "cosctolgondwe::opaque-account", "display_name": "Cashback credit",
        "avg_interval": 16.0, "avg_amount": 7.62, "next_date": "2026-10-13",
        "category": "Income",
    })))

    rows = response["upcoming_income"]
    assert [row["expected_date"] for row in rows[:2]] == ["2026-10-13", "2026-10-27"]
    assert all(row["name"] == "cosctolgondwe::opaque-account" for row in rows)
    assert all(row["amount"] == 7.62 for row in rows)


def test_inferred_eight_day_mean_repeats_weekly(monkeypatch):
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 1, 9, 0))
    response = asyncio.run(_build_cashflow_response(_cached_income(**{
        "key": "small-credit::opaque-account", "display_name": "Small credit",
        "avg_interval": 8.0, "avg_amount": 7.62, "next_date": "2026-10-06",
        "category": "Income",
    })))

    assert [row["expected_date"] for row in response["upcoming_income"][:2]] == ["2026-10-06", "2026-10-13"]


def test_monthly_income_keeps_existing_monthly_step(monkeypatch):
    """The G176 fortnightly repair does not alter the existing monthly path."""
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 1, 9, 0))
    response = asyncio.run(_build_cashflow_response(_cached_income(**{
        "key": "salary::opaque-account", "display_name": "Salary",
        "avg_interval": 30.0, "avg_amount": 1000.0, "next_date": "2026-10-30",
        "monthly_anchor": 30, "category": "Income",
    })))

    assert [row["expected_date"] for row in response["upcoming_income"]] == ["2026-10-30"]


def test_confirmed_income_schedule_still_wins_over_inferred_fortnightly_mean():
    rows = [
        _income_txn("CASHBACK CREDIT", date(2026, 8, 1), 7.62),
        _income_txn("CASHBACK CREDIT", date(2026, 8, 17), 7.62),
        _income_txn("CASHBACK CREDIT", date(2026, 9, 2), 7.62),
    ]
    confirmed = {
        "CASHBACK CREDIT": {
            "status": "confirmed",
            "schedule": {"type": "day_of_month", "day": 30},
        }
    }

    pattern = _detect_recurring(rows, today=date(2026, 10, 1), is_income=True, confirmed_income=confirmed)[0]

    assert pattern["avg_interval"] == 16.0
    assert pattern["next_date"] == date(2026, 10, 30)


def test_confirmed_schedule_controls_response_repeats_not_inferred_mean(monkeypatch):
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 1, 9, 0))
    opaque_key = "cashback::opaque-account"
    response = asyncio.run(_build_cashflow_response(
        _cached_income(**{
            "key": opaque_key, "confirmed_alias": "CASHBACK CREDIT",
            "display_name": "Cashback credit", "avg_interval": 16.0,
            "avg_amount": 7.62, "next_date": "2026-10-13", "category": "Income",
        }),
        prefs={"income_streams": [{
            "key": "CASHBACK CREDIT", "status": "confirmed",
            "schedule": {"type": "day_of_month", "day": 30},
        }]},
    ))

    assert [row["expected_date"] for row in response["upcoming_income"]] == ["2026-10-13", "2026-10-30"]


def test_confirmed_fallback_uses_legacy_source_text_but_never_opaque_key():
    legacy = {
        "GOLDMAN SACHS BGC": {
            "status": "confirmed", "avg_amount": 4797.95,
            "schedule": {"type": "day_of_month", "day": 30},
        }
    }
    opaque = {
        "goldman|sachs::opaque-account": {
            "status": "confirmed", "avg_amount": 4797.95,
            "schedule": {"type": "day_of_month", "day": 30},
        }
    }

    legacy_fallback = _confirmed_income_fallback([], legacy, set(), date(2026, 10, 1))
    opaque_fallback = _confirmed_income_fallback([], opaque, set(), date(2026, 10, 1))

    assert legacy_fallback[0]["display_name"] == "Goldman Sachs"
    assert opaque_fallback[0]["display_name"] is None
