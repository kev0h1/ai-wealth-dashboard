"""Opt-in pytest plugin (H105): run the suite with the app's clock faked.

Inactive unless FAKE_DATE=YYYY-MM-DD is set. Load with
`-p tests._plugins.fake_clock` (see scripts/run_suite_at_date.py).

It patches the `datetime` name inside `app.core.timeutil` with a subclass
whose now() returns noon Europe/London on FAKE_DATE, the same mechanism
tests/test_london_today.py's `_freeze` uses, so user_now()/user_today()
move forward consistently. Anything that reads the real clock directly
(date.today(), datetime.now(timezone.utc) in a test) is deliberately left
alone: a mismatch between the two is exactly the date-bomb class this finds.
Tests that freeze the clock themselves re-patch over this and are unaffected.
"""
import datetime as _d
import os

import pytest

_RAW = os.environ.get("FAKE_DATE")


if _RAW:
    import app.core.timeutil as _t

    _DAY = _d.date.fromisoformat(_RAW)

    class _FakeDatetime(_d.datetime):
        @classmethod
        def now(cls, tz=None):
            at = _d.datetime.combine(_DAY, _d.time(12), tzinfo=_t.LONDON)
            return at.astimezone(tz) if tz else at.replace(tzinfo=None)

    @pytest.fixture(autouse=True)
    def _fake_app_clock(monkeypatch):
        monkeypatch.setattr(_t, "datetime", _FakeDatetime)
