"""G184: cover plan destination summary carries first AND last due dates."""
from datetime import date

from app.services.companion import _dest_due_range, _when_label

TODAY = date(2026, 9, 29)


def _bills(*isos):
    return [{"expected_date": d} for d in isos]


def test_single_bill_first_equals_last():
    r = _dest_due_range(_bills("2026-10-01"), TODAY)
    assert r["needs_by"] == r["needs_by_last"] == _when_label(date(2026, 10, 1), TODAY)
    assert r["needs_by_date"] == r["needs_by_last_date"] == "2026-10-01"


def test_several_bills_same_day():
    r = _dest_due_range(_bills("2026-10-01", "2026-10-01", "2026-10-01"), TODAY)
    assert r["needs_by"] == r["needs_by_last"]
    assert r["needs_by_date"] == r["needs_by_last_date"]


def test_several_bills_spread_over_range():
    r = _dest_due_range(_bills("2026-10-29", "2026-10-01", "2026-10-15"), TODAY)
    assert r["needs_by"] == _when_label(date(2026, 10, 1), TODAY)
    assert r["needs_by_last"] == _when_label(date(2026, 10, 29), TODAY)
    assert r["needs_by_date"] == "2026-10-01"
    assert r["needs_by_last_date"] == "2026-10-29"
    assert r["needs_by"] != r["needs_by_last"]
