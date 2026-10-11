"""Shared clock-freeze helper for date-independent tests (H104/H105).

`pin_user_today(monkeypatch, instant)` makes `app.core.timeutil.user_now()` /
`user_today()` return a fixed moment, converted through the real
Europe/London zone. Use from a per-file autouse fixture so the file behaves
the same on any calendar day. Naive `instant` is read as London wall time.
Code that reads the raw clock (datetime.utcnow(), date.today()) is not
affected; derive fixtures from the same fixed instant instead.
"""
from datetime import date, datetime

import app.core.timeutil as timeutil


def pin_user_today(monkeypatch, instant) -> None:
    if isinstance(instant, date) and not isinstance(instant, datetime):
        instant = datetime.combine(instant, datetime.min.time().replace(hour=12))
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timeutil.LONDON)

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)

    monkeypatch.setattr(timeutil, "datetime", _Frozen)
