"""G174 review (should-fix 3): `compute_today_items` reads the cashflow
cache with no `PATTERNS_VERSION` check at all, unlike
`analytics.at_risk_count` (and `GET /cashflow`), both of which recompute
synchronously the moment a cached doc predates the current version. Without
the same guard here, a stale doc (e.g. one computed before this round added
`confirmed_alias` to `recurring_income` entries) would keep serving the OLD
shape into the payday plan / every other companion card until the next sync
or an unrelated `/cashflow` load happened to refresh it.

This mirrors `at_risk_count`'s own check byte-for-byte in intent: fetch the
cache, and if `(cached.get("patterns_version") or 0) < PATTERNS_VERSION`,
call `compute_and_cache_cashflow(uid)` and re-read before doing anything
else. Verified here via monkeypatching `app.routers.analytics.
compute_and_cache_cashflow` directly (not the real one — this suite must
never touch a real database, see test_payday_split.py's own docstring),
proving: the hook fires exactly once on a stale/missing version, is skipped
entirely on a current version, and any failure inside it is swallowed
(logged, not raised) so the rest of the function still completes off the
stale doc rather than crashing the whole card set.
"""
import asyncio

import app.db.collections as db_collections
import app.routers.analytics as analytics
# H143/H150: import these before any test patches db_collections with fakes, so a
# first import inside a test cannot bind fake collections into them for later files.
import app.routers.card_terms  # noqa: F401
import app.routers.commitments  # noqa: F401
import app.routers.debt_plan  # noqa: F401
import app.services.debt_plan  # noqa: F401
import app.services.companion as companion
import app.services.pace as pace_module

UID = "patterns-staleness-user"
ACCT_ID = "acc-current"


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d

    async def to_list(self, n):
        return list(self._docs)

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self


class _Col:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _Cursor(list(self.docs))

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if d.get("_id") == filt.get("_id"):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return
        if upsert:
            new_doc = dict(filt)
            for k, v in (update.get("$set") or {}).items():
                new_doc[k] = v
            self.docs.append(new_doc)


def _account():
    return {
        "_id": ACCT_ID, "name": "Barclays Premier", "balance": 500.0,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _run(monkeypatch, *, cache_doc, on_recompute=None):
    """`on_recompute`, when given, replaces `compute_and_cache_cashflow` --
    called with `uid`, may mutate the fake `cashflow_cache_col`'s stored doc
    to simulate a real recompute writing a fresh version, or raise to prove
    the failure-tolerant path."""
    cache_col = _Col([dict(cache_doc)] if cache_doc is not None else [])
    monkeypatch.setattr(companion, "cashflow_cache_col", cache_col)
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", _Col([_account()]))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.pay_period as pay_period
    import app.services.income as income_mod
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d)

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": [], "internal_inflows": []}
    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    # E20: a stored doc is never recomputed on this path; a stale one enqueues
    # the worker recompute instead. `calls` records enqueues, `computes` any
    # (forbidden) synchronous recompute.
    calls = []
    computes = []

    async def fake_compute_and_cache(uid, clear_ai_cache=True):
        computes.append(uid)

    async def fake_enqueue(uid, *, reason):
        calls.append(uid)
        if on_recompute is not None:
            await on_recompute(cache_col)
        return True

    import app.services.derived_caches as derived_caches
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", fake_compute_and_cache)
    monkeypatch.setattr(derived_caches, "enqueue_cashflow_recompute", fake_enqueue)

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=False))
    assert computes == [], "a stored doc must never be recomputed on the request path"
    return items, calls


def test_stale_version_enqueues_exactly_once_and_never_recomputes(monkeypatch):
    items, calls = _run(monkeypatch, cache_doc={"_id": UID, "patterns_version": analytics.PATTERNS_VERSION - 1})
    assert calls == [UID]
    assert isinstance(items, list)


def test_missing_version_field_also_enqueues(monkeypatch):
    """A pre-versioning cache doc (no `patterns_version` key at all) is
    treated as version 0, always stale, like `at_risk_count`'s own fallback."""
    items, calls = _run(monkeypatch, cache_doc={"_id": UID}, on_recompute=None)
    assert calls == [UID]
    assert isinstance(items, list)


def test_current_version_never_enqueues(monkeypatch):
    items, calls = _run(
        monkeypatch,
        cache_doc={"_id": UID, "patterns_version": analytics.PATTERNS_VERSION},
    )
    assert calls == []
    assert isinstance(items, list)


def test_enqueue_failure_is_swallowed_and_stale_doc_still_used(monkeypatch):
    """An exception raised by the enqueue is logged and swallowed, not
    propagated: the function still returns its normal item list off the
    stored doc."""
    async def _boom(cache_col):
        raise RuntimeError("simulated enqueue failure")

    items, calls = _run(
        monkeypatch,
        cache_doc={"_id": UID, "patterns_version": analytics.PATTERNS_VERSION - 1},
        on_recompute=_boom,
    )
    assert calls == [UID]  # it was attempted...
    assert isinstance(items, list)  # ...but the caller never sees the exception
