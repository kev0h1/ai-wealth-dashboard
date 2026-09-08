"""Shared datetime normalisation helpers.

The Motor client (`app.db.collections`) is not created with `tz_aware=True`,
so datetimes read back from Mongo come back naive (no tzinfo), while
application code compares them against `datetime.now(timezone.utc)`, which
is aware. Comparing a naive and an aware datetime raises `TypeError`. Use
`as_utc` to normalise a Mongo-sourced value before comparing it to `now`.
"""
from datetime import datetime, timezone


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
