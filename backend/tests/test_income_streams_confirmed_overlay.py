"""G158: `GET /income/streams` must still list a confirmed stream even when
the live detector no longer finds it (same underlying cliff as
`_confirmed_income_fallback` in analytics.py, see that helper's docstring),
using the stream's OWN stored schedule and amount -- the way the pre-existing
"manual" special case already behaves. No mongomock in this environment, so
Mongo collections are replaced with tiny in-memory fakes, following the same
local `FakeCol` convention as `test_offline_account_ranking.py` (not shared
across test files by that file's own note).
"""
import asyncio
from datetime import date, datetime

import app.routers.income as income_router

UID = "kevin"


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        out = [d for d in self.docs if all(d.get(k) == v for k, v in query.items() if not isinstance(v, dict))]
        return _FakeCursor(out)

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in (query or {}).items() if not isinstance(v, dict)):
                return d
        return None


CONFIRMED_KEY = "185008 12702436 Goldman Sachs BGC"

CONFIRMED_STREAM = {
    "key": CONFIRMED_KEY,
    "status": "confirmed",
    "schedule": {"type": "last_weekday", "weekday": 4},
    "avg_amount": 4798.08,
    "last_seen": "2026-07-31",
    "confirmed_at": "2026-08-02T09:00:00",
}


class _FakeUser:
    def __getitem__(self, k):
        return UID


def _run(uid_prefs_docs, txns):
    monkey_targets = {
        "preferences_col": FakeCol(uid_prefs_docs),
        "transactions_col": FakeCol(txns),
        "yapily_transactions_col": FakeCol([]),
    }
    orig = {}
    for name, fake in monkey_targets.items():
        orig[name] = getattr(income_router, name)
        setattr(income_router, name, fake)
    try:
        return asyncio.run(income_router.get_income_streams(user={"email": UID}))
    finally:
        for name, val in orig.items():
            setattr(income_router, name, val)


def test_confirmed_stream_below_detection_floor_still_listed():
    # Only ONE credit under the confirmed key survives inside the router's
    # own 90-day detection window -- below `_detect_recurring`'s 2-occurrence
    # floor, so `detected` never carries this key at all.
    txns = [{
        "user_id": UID,
        "merchant_name": CONFIRMED_KEY,
        "description": CONFIRMED_KEY,
        "amount": 4798.08,
        "date": datetime(2026, 7, 31),
        "category": "Income",
        "custom_category": None,
        "transaction_type": "credit",
    }]
    prefs_docs = [{"user_id": UID, "income_streams": [CONFIRMED_STREAM]}]
    result = _run(prefs_docs, txns)
    matches = [r for r in result if r["key"] == CONFIRMED_KEY]
    assert len(matches) == 1
    entry = matches[0]
    assert entry["status"] == "confirmed"
    assert entry["avg_amount"] == 4798.08
    assert entry["schedule"] == CONFIRMED_STREAM["schedule"]
    assert entry["next_date"] is not None


# ── 2026-09-24 review follow-up: malformed `income_streams` entries must ──
# ── degrade to "skip that entry", never raise and crash the endpoint ──────

def test_malformed_entry_with_no_key_is_skipped_not_raised():
    malformed = {"status": "confirmed", "schedule": {"type": "last_weekday", "weekday": 4}, "avg_amount": 4798.08}
    prefs_docs = [{"user_id": UID, "income_streams": [malformed, "not-a-dict-either", CONFIRMED_STREAM]}]
    result = _run(prefs_docs, [])
    keys = [r["key"] for r in result]
    assert CONFIRMED_KEY in keys
    assert None not in keys


def test_malformed_schedule_string_is_skipped_not_raised():
    # A truthy but non-dict schedule (a stray string) must not raise --
    # `schedule["type"]` on a str is a TypeError, not a KeyError, so the
    # except clause around `next_occurrence` must catch both.
    bad_schedule_stream = {
        "key": "BAD SCHEDULE STREAM",
        "status": "confirmed",
        "schedule": "last_weekday",
        "avg_amount": 100.0,
    }
    prefs_docs = [{"user_id": UID, "income_streams": [bad_schedule_stream, CONFIRMED_STREAM]}]
    result = _run(prefs_docs, [])
    keys = [r["key"] for r in result]
    assert CONFIRMED_KEY in keys
    assert "BAD SCHEDULE STREAM" not in keys


def test_is_stream_entry_guards_write_endpoint_filters():
    """`_is_stream_entry` backs every income.py write endpoint that filters
    the stored `income_streams` list by key before re-inserting an entry
    (confirm/reject/manual/delete/confirm-payday) -- a malformed element
    (not a dict, or missing "key") must be excluded rather than raise when
    those endpoints do `s["key"] != <key>` (2026-09-24 review sweep)."""
    assert income_router._is_stream_entry(CONFIRMED_STREAM) is True
    assert income_router._is_stream_entry({"status": "confirmed"}) is False
    assert income_router._is_stream_entry("not-a-dict") is False
    assert income_router._is_stream_entry(None) is False

    streams = [{"status": "confirmed"}, "not-a-dict", None, CONFIRMED_STREAM]
    filtered = [s for s in streams if income_router._is_stream_entry(s) and s["key"] != "some-other-key"]
    assert filtered == [CONFIRMED_STREAM]
