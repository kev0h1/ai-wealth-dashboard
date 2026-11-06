"""G399 (H145): skip-occurrence, clear-override, edit-upcoming and
dismiss-recurring ("Not a bill") refresh the stored results before they
return, instead of leaving the next read to recompute cold.

Per endpoint: the response cache is invalidated with the AWAITED
`ainvalidate`, and the Home responses are warmed. No forecast recompute runs for skip,
clear or edit (overrides apply at response build); Not a bill rebuilds the
forecast itself first. The warm stub reads the fake override collection at
the moment it is called, proving the write came first.

Overrides are applied at read time by `_build_cashflow_response`, so the
stored forecast doc never lists them.

No database: every collection is a tiny in-memory fake.
"""
import asyncio

import pytest

import app.routers.analytics as analytics
import app.services.derived_caches as derived_caches
import app.services.warmup as warmup

UID = "fixture-user@example.com"
USER = {"email": UID}


class _Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _m(doc, q):
        return all(doc.get(k) == v for k, v in q.items())

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._m(d, q or {})), None)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._m(d, filt):
                d.update(update.get("$set") or {})
                for f, v in (update.get("$addToSet") or {}).items():
                    d[f] = list(dict.fromkeys([*(d.get(f) or []), v]))
                return
        if upsert:
            nd = dict(filt)
            nd.update(update.get("$set") or {})
            for f, v in (update.get("$addToSet") or {}).items():
                nd[f] = [v]
            self.docs.append(nd)

    async def delete_many(self, q):
        self.docs = [d for d in self.docs if not self._m(d, q)]


@pytest.fixture
def harness(monkeypatch):
    overrides = _Col()
    calls: list[tuple] = []
    snapshots: dict[str, list] = {}

    monkeypatch.setattr(analytics, "upcoming_overrides_col", overrides)
    monkeypatch.setattr(analytics, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _Col([{"_id": UID}]))

    async def ainvalidate(uid):
        calls.append(("ainvalidate", uid))

    def sync_invalidate(uid):  # the old fire-and-forget form must not be used
        calls.append(("invalidate", uid))

    async def recompute(uid, *, new_count, trigger):
        calls.append(("recompute", uid, new_count, trigger))
        return {"recomputed": True, "reason": "test"}

    async def warm(uid, include_cover_plan=True):
        calls.append(("warm_user", uid))
        snapshots["include_cover_plan"] = include_cover_plan
        snapshots["overrides_at_warm"] = list(overrides.docs)
        return {"warmed": [], "failed": []}

    async def cashflow(uid, clear_ai_cache=True):
        calls.append(("compute_cashflow", uid, clear_ai_cache))

    monkeypatch.setattr(analytics.response_cache, "ainvalidate", ainvalidate)
    monkeypatch.setattr(analytics.response_cache, "invalidate", sync_invalidate)
    monkeypatch.setattr(derived_caches, "recompute_derived_caches", recompute)
    monkeypatch.setattr(warmup, "warm_user", warm)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", cashflow)
    return overrides, calls, snapshots


def _names(calls):
    return [c[0] for c in calls]


def test_skip_occurrence_refreshes_after_the_write(harness):
    overrides, calls, snaps = harness
    out = asyncio.run(analytics.skip_occurrence({"key": "NETFLIX", "date": "2026-11-05"}, USER))
    assert out == {"ok": True}
    assert ("ainvalidate", UID) in calls and "invalidate" not in _names(calls)
    assert "recompute" not in _names(calls)
    assert _names(calls).index("ainvalidate") < _names(calls).index("warm_user")
    # The skip override was already stored when the warm-up ran.
    assert any(d["key"] == "NETFLIX" and d["date"] == "2026-11-05" and d["skip"] for d in snaps["overrides_at_warm"])
    # The discarded read-time rebuild is gone: nothing stamps the cache doc.
    assert "_override_rebuild" not in analytics.cashflow_cache_col.docs[0]


def test_skip_occurrence_validation_unchanged(harness):
    _, calls, _ = harness
    with pytest.raises(analytics.HTTPException) as e:
        asyncio.run(analytics.skip_occurrence({"key": "X", "date": "nope"}, USER))
    assert e.value.status_code == 400
    assert calls == []


def test_clear_override_refreshes_after_the_delete(harness):
    overrides, calls, snaps = harness
    overrides.docs.append({"uid": UID, "key": "NETFLIX", "date": "2026-11-05", "scope": "one", "skip": True})
    out = asyncio.run(analytics.clear_override({"key": "NETFLIX", "date": "2026-11-05"}, USER))
    assert out == {"ok": True}
    assert ("ainvalidate", UID) in calls and "invalidate" not in _names(calls)
    assert "recompute" not in _names(calls)
    assert snaps["overrides_at_warm"] == []  # already deleted when it warmed
    assert "warm_user" in _names(calls)


def test_edit_upcoming_refreshes_after_the_write(harness):
    overrides, calls, snaps = harness
    out = asyncio.run(analytics.edit_upcoming(
        {"key": "RENT", "date": "2026-11-01", "new_date": "2026-11-03", "new_amount": 500}, USER))
    assert out == {"ok": True}
    assert ("ainvalidate", UID) in calls
    assert "recompute" not in _names(calls)
    assert any(d["key"] == "RENT" and d["new_amount"] == 500.0 for d in snaps["overrides_at_warm"])
    assert "warm_user" in _names(calls)


def test_edit_upcoming_validation_unchanged(harness):
    _, calls, _ = harness
    with pytest.raises(analytics.HTTPException) as e:
        asyncio.run(analytics.edit_upcoming({"key": "RENT", "date": "2026-11-01"}, USER))
    assert e.value.status_code == 400
    assert calls == []


def test_not_a_bill_refreshes_after_its_own_rebuild(harness):
    _, calls, _ = harness
    out = asyncio.run(analytics.dismiss_recurring({"key": "GYM"}, USER))
    assert out == {"ok": True}
    names = _names(calls)
    # Its own forecast rebuild runs first, then the helper warms.
    assert names.index("compute_cashflow") < names.index("ainvalidate") < names.index("warm_user")
    assert "recompute" not in names


def test_warm_failure_never_fails_the_write(harness, monkeypatch):
    async def boom(uid, include_cover_plan=True):
        raise RuntimeError("warm failed")
    monkeypatch.setattr(warmup, "warm_user", boom)
    out = asyncio.run(analytics.skip_occurrence({"key": "NETFLIX", "date": "2026-11-05"}, USER))
    assert out == {"ok": True}


def test_request_path_warm_leaves_the_cover_plan_out(harness):
    """E17: the override refresh must not pay the cover-plan compute."""
    _overrides, _calls, snapshots = harness
    asyncio.run(analytics.skip_occurrence({"key": "NETFLIX", "date": "2026-11-05"}, USER))
    assert snapshots["include_cover_plan"] is False
