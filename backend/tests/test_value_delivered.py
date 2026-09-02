"""Tests for GET /value-delivered (`get_value_delivered` in
backend/app/routers/analytics.py, ~line 3755) — the loop-closer's read side.

The endpoint must keep two buckets strictly separate:
  - `verified_monthly_saving`: sums ONLY insights with a genuinely verified
    `verified_savings` (spend that provably ceased, see
    `_check_verified_saving` / test_verified_saving.py).
  - `total_monthly_saving`: sums ONLY parsed estimates from insights the user
    engaged with (`user_context` present), and explicitly excludes verified
    ones via a `continue` so an insight that is BOTH verified and has
    `user_context` counts once, in verified only.

No mongomock is available in this environment (see test_notifications.py's
own note), so `savings_insights_col` is replaced with a tiny in-memory fake
supporting `.find().to_list()`, following the same monkeypatch-the-module-
level-name pattern the rest of this suite already established.
"""
import asyncio
from datetime import datetime

import app.routers.analytics as analytics
from app.routers.analytics import get_value_delivered


# ── Generic fake-Mongo plumbing ─────────────────────────────────────────

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
        uid = query.get("user_id")

        def _matches(d):
            if uid is not None and d.get("user_id") != uid:
                return False
            # Only the `{"$exists": False}` shape this endpoint's own
            # query actually uses (see `get_value_delivered`'s
            # `retired_at`/`substituted_at` exclusions) — not a general
            # Mongo query engine.
            for key, cond in query.items():
                if key == "user_id":
                    continue
                if isinstance(cond, dict) and "$exists" in cond:
                    present = key in d and d.get(key) is not None
                    if cond["$exists"] != present:
                        return False
            return True

        return _FakeCursor([d for d in self.docs if _matches(d)])


UID = "kevin"


def _run(coro):
    return asyncio.run(coro)


def _user(**kw):
    return {"email": UID}


def test_verified_only_insight_counts_toward_verified_bucket(monkeypatch):
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "Gym", "verified_savings": 25.0, "verified_merchant": "David Lloyd"},
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 25.0
    assert result["total_monthly_saving"] == 0.0
    assert result["insights_acted_on"] == 0  # verified doesn't require user_context / engagement
    assert len(result["breakdown"]) == 1
    assert result["breakdown"][0]["estimate_label"] == "verified"
    assert result["breakdown"][0]["monthly_saving"] == 25.0


def test_engaged_estimate_only_counts_toward_total_bucket(monkeypatch):
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "Switch broadband", "savings_estimate": "~£15/mo",
         "user_context": {"provider": "BT"}},
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 0.0
    assert result["total_monthly_saving"] == 15.0
    assert result["insights_acted_on"] == 1
    assert result["breakdown"][0]["estimate_label"] == "~£15/mo"


def test_no_user_context_and_not_verified_is_excluded_entirely(monkeypatch):
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "Energy", "savings_estimate": "~£20/mo"},  # no user_context
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 0.0
    assert result["total_monthly_saving"] == 0.0
    assert result["insights_acted_on"] == 0
    assert result["breakdown"] == []


def test_verified_and_engaged_insight_counts_once_in_verified_only(monkeypatch):
    # The exact separation this test is here to prove: an insight that is
    # BOTH verified (spend genuinely ceased) AND carries user_context (the
    # user filled in the workflow before it verified) must count exactly
    # once, in verified_monthly_saving, and must be `continue`d out of the
    # total_monthly_saving / engaged-estimate loop entirely.
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "Mobile", "savings_estimate": "~£30/mo",
         "user_context": {"provider": "EE"},
         "verified_savings": 18.5, "verified_merchant": "EE Ltd"},
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 18.5
    assert result["total_monthly_saving"] == 0.0  # the £30 estimate must NOT also be added
    assert result["insights_acted_on"] == 0  # `continue` skips the `engaged += 1` line too
    assert len(result["breakdown"]) == 1  # one entry, not two
    assert result["breakdown"][0]["estimate_label"] == "verified"
    assert result["breakdown"][0]["monthly_saving"] == 18.5


def test_substituted_insight_never_counts_as_a_saving(monkeypatch):
    # Insights honesty review, Package B #7: a `substituted` insight (the
    # triggering merchant went silent, but the category never net'd down —
    # see _check_verified_saving / test_verified_saving.py) has no
    # `verified_savings` field at all, only `substituted_at` /
    # `substituted_merchant` / `substituted_amount`. It must NOT count
    # toward verified_monthly_saving (it is not a saving), and since it also
    # has no user_context here, it must not count toward total_monthly_saving
    # or insights_acted_on either — a substituted insight contributes
    # nothing to the value-delivered total.
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "Eating Out", "category": "eating_out",
         "substituted_at": "2026-08-27", "substituted_merchant": "Nandos",
         "substituted_amount": 49.0},
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 0.0
    assert result["total_monthly_saving"] == 0.0
    assert result["insights_acted_on"] == 0
    assert result["breakdown"] == []


def test_tri_state_doc_excluded_by_the_query_filter_not_just_python_logic(monkeypatch):
    # Insights honesty review, incoherence A (owner phone report
    # 2026-09-01): an incomplete early-return guard (fixed, see
    # `_check_verified_saving` in savings_insights.py) previously let an
    # already-`substituted` doc get re-evaluated and additionally stamped
    # `verified_savings` on top — confirmed live shape:
    # kevin.maingi12@gmail.com's eating_out/Nando's doc carried BOTH
    # `verified_savings: 49.1` and `substituted_at` set. This endpoint reads
    # the collection directly, not through `_serialize_insight`, so it needs
    # its own `substituted_at` exclusion at the QUERY level (see
    # `get_value_delivered`'s `find()` filter) — this test exercises that
    # filter itself (via FakeCol's `$exists` support above), not just the
    # Python loop body, so a doc the real Mongo query would already exclude
    # can't sneak through this test's fake and mask the guard being removed.
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "Eating Out", "category": "eating_out",
         "verified_savings": 49.1, "verified_merchant": "Nandos",
         "substituted_at": datetime(2026, 8, 31, 21, 10, 43),
         "substituted_merchant": "Nandos", "substituted_amount": 49.1},
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 0.0
    assert result["breakdown"] == []


def test_mixed_set_sums_each_bucket_independently(monkeypatch):
    monkeypatch.setattr(analytics, "savings_insights_col", FakeCol([
        {"user_id": UID, "title": "A", "verified_savings": 10.0, "verified_merchant": "A Co"},
        {"user_id": UID, "title": "B", "savings_estimate": "~£12/mo", "user_context": {"x": "y"}},
        {"user_id": UID, "title": "C", "savings_estimate": "~£5/mo"},  # not engaged, excluded
        {"user_id": UID, "title": "D", "savings_estimate": "~£8/mo", "user_context": {"x": "y"},
         "verified_savings": 3.0, "verified_merchant": "D Co"},  # verified wins, counts once
    ]))
    result = _run(get_value_delivered(user=_user()))
    assert result["verified_monthly_saving"] == 13.0   # 10.0 + 3.0
    assert result["total_monthly_saving"] == 12.0       # only B's engaged estimate
    assert result["insights_acted_on"] == 1              # only B increments `engaged`
    assert len(result["breakdown"]) == 3                  # A, D (verified), B (estimate) — not C

