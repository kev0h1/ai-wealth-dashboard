"""England & Wales business days (G468). One static bank-holiday set, no network
fetch; extend when new years are published. Weekends are always non-business days."""
from __future__ import annotations

from datetime import date, timedelta

# England & Wales bank holidays (static set; extend when new years published)
UK_BANK_HOLIDAYS_EW: frozenset = frozenset({
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25",
    "2026-08-31", "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31",
    "2027-08-30", "2027-12-27", "2027-12-28",
})


def is_business_day(d: date) -> bool:
    return d.weekday() < 5 and d.isoformat() not in UK_BANK_HOLIDAYS_EW


def next_business_day_after(d: date) -> date:
    """The first England & Wales business day strictly after `d`."""
    d += timedelta(days=1)
    while not is_business_day(d):
        d += timedelta(days=1)
    return d
