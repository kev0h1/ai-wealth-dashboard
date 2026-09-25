"""Shared datetime normalisation helpers.

The Motor client (`app.db.collections`) is not created with `tz_aware=True`,
so datetimes read back from Mongo come back naive (no tzinfo), while
application code compares them against `datetime.now(timezone.utc)`, which
is aware. Comparing a naive and an aware datetime raises `TypeError`. Use
`as_utc` to normalise a Mongo-sourced value before comparing it to `now`.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


def as_utc(dt: datetime | None) -> datetime | None:
    """Normalise a datetime read back from Mongo (often naive, since the
    Motor client is not tz_aware) to an aware UTC datetime, so it can be
    safely compared against datetime.now(timezone.utc). Returns None for
    None input. Aware datetimes in another timezone are converted to UTC.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


LONDON = ZoneInfo("Europe/London")


def user_now() -> datetime:
    """The user's calendar day. Sorted is UK-only, so this is Europe/London
    regardless of where the process runs (UAT VPS, Railway UTC). Use for any
    date the user sees or any days-away / due / overdue / payday arithmetic.
    Timestamps persisted to Mongo stay `datetime.now(timezone.utc)`.
    """
    return datetime.now(LONDON)


def user_today() -> date:
    """The user's calendar day. Sorted is UK-only, so this is Europe/London
    regardless of where the process runs (UAT VPS, Railway UTC). Use for any
    date the user sees or any days-away / due / overdue / payday arithmetic.
    Timestamps persisted to Mongo stay `datetime.now(timezone.utc)`.
    """
    return user_now().date()


def to_user_date(dt: datetime | None) -> date | None:
    """Convert a stored UTC instant to the user's Europe/London calendar day.

    Use whenever a stored UTC instant (a Mongo timestamp, `researched_at`,
    `content_valid_until`, a `refreshed_at`/`created_at` anchor, a deadline)
    is shown to the user as a day, or compared against `user_today()` in
    days ("Xd ago", "valid until", a 7-day badge window). A naive datetime
    is treated as UTC (via `as_utc`) before conversion, matching every other
    Mongo-sourced value in this codebase. Never compare an aware and a naive
    datetime directly, and never do day-count arithmetic on raw instants
    across a UTC/London offset -- go through this (or `user_today()`) and
    difference the resulting `date` objects instead. Returns None for None
    input.
    """
    utc_dt = as_utc(dt)
    if utc_dt is None:
        return None
    return utc_dt.astimezone(LONDON).date()
