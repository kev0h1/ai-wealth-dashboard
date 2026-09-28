"""G168 (2026-09-28): the month-closed ("needle") card's dismissal must be
surface-scoped so a Home dismiss can never delete Penny's permanent copy.

Rejection this fixes (TODO.md G168, 2026-09-27): the previously-built,
approved variant ("Chip and chevron") wired Home's dismiss chip to the
SAME shared server dismiss (`api.dismissTodayItem`, unscoped) every other
item type uses. `compute_today_items`'s needle builder (8b) gated the
item's very existence on that ONE per-user `dismissed` set, read by every
caller of `/today` — Penny included (app/penny/PennyPage.tsx reads the
identical feed) — so dismissing on Home silently deleted Penny's
"permanent" copy too.

The fix: `dismiss_item(uid, item_id, surface=...)` requires `surface="home"`
for a needle id and writes it to a SEPARATE `home_dismissed` field on the
same per-user doc, never the shared `ids` field. The needle builder now
ALWAYS constructs the item through its whole two-day window regardless of
either set, and only reads `home_dismissed` to stamp a boolean on the item
so Home can hide its own copy — Penny's raw-feed read never filters on it.
`POST /today/dismiss` (app/routers/companion.py) refuses an unscoped
dismiss of a needle id with 400.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention test_home_suppression_registry.py / test_unfunded_move.py
already established (FakeCol/_match/_FakeCursor are NOT shared across test
files by convention here).
"""
import asyncio
from datetime import timedelta

import pytest
from fastapi import HTTPException

import app.services.companion as companion
import app.routers.companion as companion_router
import app.db.collections as db_collections

UID = "kevin"


# ── Generic fake-Mongo plumbing (same shape as test_home_suppression_registry.py) ──

def _match(doc: dict, query: dict) -> bool:
    for key, cond in (query or {}).items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class FakeCol:
    """Stand-in for a Motor collection — enough of `.find()`/`.find_one()`/
    `.update_one()` to drive the real dismiss_item/_get_dismissed/
    _get_home_dismissed code under test."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _FakeCursor([d for d in self.docs if _match(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if _match(d, query or {}):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$addToSet") or {}).items():
            d.setdefault(k, [])
            if v not in d[k]:
                d[k].append(v)


# ── 1. Storage-level: dismiss_item / _get_dismissed / _get_home_dismissed ──

def test_home_scoped_dismiss_writes_home_dismissed_not_the_shared_set(monkeypatch):
    col = FakeCol([])
    monkeypatch.setattr(companion, "companion_items_col", col)

    asyncio.run(companion.dismiss_item(UID, "needle:2026-08-31", surface="home"))

    doc = col.docs[0]
    assert doc["_id"] == f"dismissed:{UID}"
    assert doc.get("home_dismissed") == ["needle:2026-08-31"]
    assert doc.get("ids", []) == []

    dismissed = asyncio.run(companion._get_dismissed(UID))
    home_dismissed = asyncio.run(companion._get_home_dismissed(UID))
    assert "needle:2026-08-31" not in dismissed
    assert "needle:2026-08-31" in home_dismissed


def test_unscoped_needle_dismiss_is_refused_at_the_service_layer(monkeypatch):
    col = FakeCol([])
    monkeypatch.setattr(companion, "companion_items_col", col)

    with pytest.raises(ValueError):
        asyncio.run(companion.dismiss_item(UID, "needle:2026-08-31"))
    with pytest.raises(ValueError):
        asyncio.run(companion.dismiss_item(UID, "needle:2026-08-31", surface="penny"))

    # Nothing was written on the rejected attempts.
    assert col.docs == []


def test_dismissal_keyed_to_one_period_end_never_matches_another(monkeypatch):
    col = FakeCol([])
    monkeypatch.setattr(companion, "companion_items_col", col)

    asyncio.run(companion.dismiss_item(UID, "needle:2026-08-31", surface="home"))
    home_dismissed = asyncio.run(companion._get_home_dismissed(UID))

    assert "needle:2026-08-31" in home_dismissed
    assert "needle:2026-07-31" not in home_dismissed
    assert "needle:2026-09-30" not in home_dismissed


def test_other_item_types_are_unaffected_by_the_new_field(monkeypatch):
    col = FakeCol([])
    monkeypatch.setattr(companion, "companion_items_col", col)

    asyncio.run(companion.dismiss_item(UID, "move:acct-1:2026-09-01:abc123"))
    asyncio.run(companion.dismiss_item(UID, "ask:card_terms"))

    dismissed = asyncio.run(companion._get_dismissed(UID))
    home_dismissed = asyncio.run(companion._get_home_dismissed(UID))
    assert dismissed == {"move:acct-1:2026-09-01:abc123", "ask:card_terms"}
    assert home_dismissed == set()

    doc = col.docs[0]
    assert "home_dismissed" not in doc or doc["home_dismissed"] == []


# ── 2. Router: POST /today/dismiss refuses an unscoped needle dismiss ──────

def test_router_refuses_unscoped_needle_dismiss_with_400(monkeypatch):
    calls = []

    async def _fake_dismiss_item(uid, item_id, surface=None):
        calls.append((uid, item_id, surface))

    monkeypatch.setattr(companion_router, "dismiss_item", _fake_dismiss_item)
    monkeypatch.setattr(companion_router.response_cache, "invalidate", lambda *a, **k: None)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(companion_router.dismiss_today_item(
            {"item_id": "needle:2026-08-31"}, {"email": UID},
        ))
    assert exc_info.value.status_code == 400
    assert calls == []  # refused before dismiss_item was ever called


def test_router_accepts_home_scoped_needle_dismiss(monkeypatch):
    calls = []

    async def _fake_dismiss_item(uid, item_id, surface=None):
        calls.append((uid, item_id, surface))

    monkeypatch.setattr(companion_router, "dismiss_item", _fake_dismiss_item)
    monkeypatch.setattr(companion_router.response_cache, "invalidate", lambda *a, **k: None)

    result = asyncio.run(companion_router.dismiss_today_item(
        {"item_id": "needle:2026-08-31", "surface": "home"}, {"email": UID},
    ))
    assert result == {"ok": True}
    assert calls == [(UID, "needle:2026-08-31", "home")]


def test_router_dismiss_of_a_non_needle_item_needs_no_surface(monkeypatch):
    calls = []

    async def _fake_dismiss_item(uid, item_id, surface=None):
        calls.append((uid, item_id, surface))

    monkeypatch.setattr(companion_router, "dismiss_item", _fake_dismiss_item)
    monkeypatch.setattr(companion_router.response_cache, "invalidate", lambda *a, **k: None)

    result = asyncio.run(companion_router.dismiss_today_item(
        {"item_id": "move:acct-1:2026-09-01:abc123"}, {"email": UID},
    ))
    assert result == {"ok": True}
    assert calls == [(UID, "move:acct-1:2026-09-01:abc123", None)]


# ── 3. End-to-end: compute_today_items always builds the needle item, and
#      stamps home_dismissed from the SEPARATE set, regardless of the
#      shared `dismissed` set (proving the old bug's exact mechanism —
#      writing a needle id into the shared set — can no longer suppress
#      the item at all). ───────────────────────────────────────────────────

def _account(acct_id, balance, provider="barclays", name=None):
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id, "balance": balance,
        "subtype": "TRANSACTION", "type": "BANK", "provider": provider,
    }


def _run_engine(monkeypatch, *, companion_items=None):
    """Full-stack harness: patches every collection compute_today_items
    touches and calls it for real, following test_home_suppression_registry
    .py's `_run` pattern.

    `today_d` inside compute_today_items comes from `timeutil.user_today()`,
    NOT `date.today()` (companion.py's own module-level `date` import is
    used elsewhere, not for this), so pay-period math is stubbed
    RELATIVE to whatever real day the suite happens to run on rather than a
    fixed calendar date: `get_pay_period_for_date(ref, cfg)` always returns
    `(ref, ref+29)`, so `curr_start == today_d` and `days_into_period == 0`
    regardless of today's real date, landing inside the needle's 2-day
    window every run. The "closed" (previous) period this produces is
    `(today_d-30, today_d-1)`d — i.e. `prev_pay_period(today_d, cfg) ==
    get_pay_period_for_date(today_d-1, cfg) == (today_d-1, today_d-1+29)`
    — so the expected needle id is always `needle:<(today_d+28).isoformat()>`,
    computed by each test via `_expected_needle_id()` below rather than
    hardcoded."""
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (ref, ref + timedelta(days=29)))

    monkeypatch.setattr(companion, "accounts_col", FakeCol([_account("barclays", 500.0)]))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol(companion_items or []))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([{"user_id": UID, "income_streams": []}]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    return asyncio.run(companion.compute_today_items(UID, persist=True))


def _find_needle(items):
    return next((i for i in items if i.get("type") == "needle"), None)


def _expected_needle_id() -> str:
    """Mirrors `_run_engine`'s relative pay-period stub: the closed period's
    end is `today_d + 28` days (see that function's own docstring for the
    derivation), so this is always today's real needle id under the stub,
    regardless of which real calendar day the suite runs on."""
    import app.core.timeutil as timeutil
    closed_end = timeutil.user_today() + timedelta(days=28)
    return f"needle:{closed_end.isoformat()}"


def _other_period_id() -> str:
    """A different, real period-end id — one month before the expected
    one — used to prove a dismissal keyed to it never matches."""
    import app.core.timeutil as timeutil
    other_end = timeutil.user_today() + timedelta(days=28) - timedelta(days=31)
    return f"needle:{other_end.isoformat()}"


def test_needle_built_and_home_dismissed_false_when_not_dismissed(monkeypatch):
    items = _run_engine(monkeypatch, companion_items=[])
    needle = _find_needle(items)
    assert needle is not None
    assert needle["id"] == _expected_needle_id()
    assert needle["home_dismissed"] is False


def test_home_scoped_dismiss_hides_on_home_but_item_still_built(monkeypatch):
    """The core G168 regression check: a home-scoped dismissal must still
    leave the item present in the engine's output (Penny reads this same
    raw list) with `home_dismissed: True` — Home's own filtering (not the
    engine) is what hides it, per HomeBrief.tsx's `!i.home_dismissed` read."""
    needle_id = _expected_needle_id()
    dismissed_doc = {"_id": f"dismissed:{UID}", "home_dismissed": [needle_id]}
    items = _run_engine(monkeypatch, companion_items=[dismissed_doc])
    needle = _find_needle(items)
    assert needle is not None, "the needle item must still be BUILT even once dismissed on Home"
    assert needle["id"] == needle_id
    assert needle["home_dismissed"] is True


def test_needle_still_built_even_if_legacy_shared_set_holds_its_id(monkeypatch):
    """Belt and braces against a regression of the exact rejected bug: even
    if a needle id somehow ends up in the OLD shared `ids` set (e.g. data
    left over from before this fix), the item must still be built — its
    existence no longer depends on that set at all."""
    needle_id = _expected_needle_id()
    dismissed_doc = {"_id": f"dismissed:{UID}", "ids": [needle_id]}
    items = _run_engine(monkeypatch, companion_items=[dismissed_doc])
    needle = _find_needle(items)
    assert needle is not None
    assert needle["id"] == needle_id
    # Not scoped as home-dismissed, since only the "ids" field held it, not
    # "home_dismissed" — Home would still show it, and Penny always would.
    assert needle["home_dismissed"] is False


def test_home_dismissal_keyed_to_a_different_period_end_does_not_suppress(monkeypatch):
    dismissed_doc = {"_id": f"dismissed:{UID}", "home_dismissed": [_other_period_id()]}
    items = _run_engine(monkeypatch, companion_items=[dismissed_doc])
    needle = _find_needle(items)
    assert needle is not None
    assert needle["id"] == _expected_needle_id()
    assert needle["home_dismissed"] is False
