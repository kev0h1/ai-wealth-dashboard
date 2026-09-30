"""G176 regressions for income presentation labels.

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


def test_income_display_name_does_not_change_occurrences_or_totals(monkeypatch):
    """A label is presentation only: cadence, identity and totals stay put."""
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 1, 9, 0))
    base_pattern = {
        "key": "cosctolgondwe::opaque-account",
        "avg_interval": 16.0, "avg_amount": 7.62, "next_date": "2026-10-13",
        "category": "Income",
    }
    without_label = asyncio.run(_build_cashflow_response(_cached_income(**base_pattern)))
    with_label = asyncio.run(_build_cashflow_response(_cached_income(**{
        **base_pattern, "display_name": "Cashback credit",
    })))

    base_rows = without_label["upcoming_income"]
    labelled_rows = with_label["upcoming_income"]
    assert [row["expected_date"] for row in base_rows] == ["2026-10-13", "2026-10-29"]
    assert [row["expected_date"] for row in labelled_rows] == [row["expected_date"] for row in base_rows]
    assert [row["name"] for row in labelled_rows] == [row["name"] for row in base_rows]
    assert sum(row["amount"] for row in labelled_rows) == sum(row["amount"] for row in base_rows)
    assert [row["display_name"] for row in base_rows] == [None] * len(base_rows)
    assert [row["display_name"] for row in labelled_rows] == ["Cashback credit"] * len(labelled_rows)


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
