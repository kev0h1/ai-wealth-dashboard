"""G166 -- London-today sweep, savings_insights.py follow-up.

G161 was rejected once for missing this file (three naive `datetime.utcnow()`
sites driving user-facing day-scale copy: the "fresh"/"Valid until"/"New"
badge machinery), then fixed in a follow-up commit
(`fix(G161): London calendar days for insight freshness, age and expiry
copy`) that moved `_derive_insight_state`, `_serialize_insight`'s `is_new`
window and `_expiry_line`'s callers onto `app.core.timeutil`'s
Europe/London-aware helpers. `tests/test_london_today.py` already covers
`_relative_age`, `_derive_insight_state` and `_serialize_insight`'s `is_new`
flag directly; this file is G166's dedicated regression suite for the same
surface, freezing the clock at 23:30 London on a given day (as G166 asks
for) and additionally exercising `_expiry_line` itself -- the function that
actually composes the "Valid until Mon 8 Sep" / "Researched 2d ago" strings
rendered to the user -- which no existing test called directly.

Frozen-clock approach copied from `test_london_today.py`'s own `_freeze`
helper: monkeypatch the `datetime` name inside `app.core.timeutil` with a
subclass whose `now(tz)` returns a fixed instant. Every date/time used below
is a plain UTC-naive `datetime`, matching how Mongo actually returns stored
values in this codebase (see `app.core.timeutil`'s module docstring).
"""
from datetime import datetime, timezone

import app.core.timeutil as timeutil
from app.routers.savings_insights import _expiry_line, _serialize_insight


def _freeze(monkeypatch, iso_utc: str) -> datetime:
    instant = datetime.fromisoformat(iso_utc).replace(tzinfo=timezone.utc)

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant.astimezone(tz) if tz is not None else instant.replace(tzinfo=None)

    monkeypatch.setattr(timeutil, "datetime", _FrozenDatetime)
    return instant


def _insight_doc(**overrides) -> dict:
    base = {
        "_id": "abc123",
        "insight_id": "abc123",
        "category": "energy",
        "title": "Switch energy supplier",
        "body": "Your tariff looks pricier than the market average.",
        "savings_estimate": None,
        "pinned": False,
        "is_new": False,
        "refreshed_at": None,
        "researched_at": None,
        "content_valid_until": None,
    }
    base.update(overrides)
    return base


# ── (a) "Valid until" / "Researched Nd ago" copy uses the London date ─────

def test_expiry_line_valid_until_branch_uses_london_calendar_date(monkeypatch):
    # Frozen "now" 23:30 London on the 24th (irrelevant to this branch's
    # own arithmetic, frozen anyway per G166's brief). content_valid_until
    # 2026-09-24T23:45:00Z is a UTC-naive instant that is already
    # 2026-09-25 00:45 in London (BST, UTC+1) -- the next London day. The
    # claim governs (claim_valid_until == content_valid_until), so the
    # rendered date must be the London day the instant falls on, Fri 25
    # Sep, not the UTC day (Thu 24 Sep) the raw instant is still on.
    now = _freeze(monkeypatch, "2026-09-24T22:30:00")
    content_valid_until = datetime(2026, 9, 24, 23, 45, 0)
    line = _expiry_line(
        researched_at=None,
        content_valid_until=content_valid_until,
        claim_valid_until=content_valid_until,
        now=now.replace(tzinfo=None),
    )
    assert line == "Valid until Fri 25 Sep", line


def test_expiry_line_researched_ago_branch_counts_london_calendar_days(monkeypatch):
    # Frozen "now" 2026-09-24T22:30:00Z = London 23:30 on the 24th ->
    # user_today() is 2026-09-24. researched_at 2026-09-20T23:15:00Z is a
    # UTC-naive instant already 2026-09-21 00:15 in London -- London date
    # the 21st. Correct answer counts LONDON calendar days (21st -> 24th =
    # 3), not a raw UTC-date difference (20th -> 24th = 4), so the string
    # must read "3d ago", not "4d ago".
    now = _freeze(monkeypatch, "2026-09-24T22:30:00")
    researched_at = datetime(2026, 9, 20, 23, 15, 0)
    line = _expiry_line(
        researched_at=researched_at,
        content_valid_until=datetime(2026, 10, 1, 0, 0, 0),  # any future instant -- claim_governs is False here
        claim_valid_until=None,
        now=now.replace(tzinfo=None),
    )
    assert line == "Researched 3d ago", line


# ── (b) is_new flips on the London day boundary, not the UTC one ──────────

def test_is_new_true_at_exactly_seven_london_days_crossing_a_bst_midnight(monkeypatch):
    # Frozen 2026-09-24T22:30:00Z = London 23:30 on the 24th.
    # refreshed_at 2026-09-16T23:10:00Z is a UTC-naive instant already
    # 2026-09-17 00:10 in London -- London date the 17th. London days
    # elapsed 17th -> 24th = 7, so still within IS_NEW_TTL (<=7): is_new
    # must be True. A raw UTC-date diff (16th -> 24th = 8) would have
    # wrongly flipped this to False a day early -- exactly the class of bug
    # this sweep closes.
    _freeze(monkeypatch, "2026-09-24T22:30:00")
    refreshed_at = datetime(2026, 9, 16, 23, 10, 0)
    out = _serialize_insight(_insight_doc(is_new=True, refreshed_at=refreshed_at))
    assert out["is_new"] is True


def test_is_new_false_at_eight_london_days_crossing_a_bst_midnight(monkeypatch):
    # Same frozen "now". refreshed_at 2026-09-15T23:10:00Z is already
    # 2026-09-16 00:10 in London -- London date the 16th. London days
    # elapsed 16th -> 24th = 8, past the 7-day IS_NEW_TTL: is_new must be
    # False.
    _freeze(monkeypatch, "2026-09-24T22:30:00")
    refreshed_at = datetime(2026, 9, 15, 23, 10, 0)
    out = _serialize_insight(_insight_doc(is_new=True, refreshed_at=refreshed_at))
    assert out["is_new"] is False
