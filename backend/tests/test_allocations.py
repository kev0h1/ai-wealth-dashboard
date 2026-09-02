"""Tests for app.routers.allocations — simple per-pay-period envelopes,
filled by a description rule (owner decision, 2026-08-29: "the same rule we
have for the offline account is what we should reuse here, can be exact
match or contains, and the effective date can be selected or choose the
start of the payment period").

Covers: create/validate (own account only, match fields required, one
active allocation per (account, match_type, match_value) rule, amount > 0),
filled_this_period sums only current-period-and-on/after-effective_from
credits on the right account matching the rule (equals vs contains,
case/trim behaviour mirroring the shared description_match helper),
remaining floors at 0 on overfill, safe_to_spend drops by exactly the
remainder and recovers as fills accrue, an inactive allocation is inert,
delete removes its effect, recurrence ("once" vs "every_period") semantics,
effective_from semantics (default = period start, mid-period exclusion,
future = pending with zero reserve, once-window intersection), and GET
/allocations/fill-candidates groups/sorts recent credit series correctly
(unchanged — it's the prefill source for a contains-rule).

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention test_internal_inflows.py / test_unfunded_move.py already
established for this suite's neighbours (FakeCol / _match / _FakeCursor are
NOT shared across test files by convention here).
"""
import asyncio
from datetime import date, datetime, timedelta

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.routers.allocations as allocations

UID = "kevin"


class _FixedDate(date):
    """A `date` subclass whose `.today()` always returns a chosen calendar
    day, so this suite's period-boundary math (PERIOD_START/PERIOD_END,
    filled_this_period's `days_ago` fixtures, the effective_from
    mid-period-elapsed checks) is deterministic regardless of when this
    suite actually runs — in particular, regardless of how close "now" is
    to a calendar-month rollover. Patched in for the module-level `date`
    name `app.routers.allocations` imports (`from datetime import date`),
    matching the pattern established in test_home_suppression_registry.py
    / test_scenario.py. Pinned mid-month (day 15) so there are always
    several elapsed days in the current pay period, e.g. for the
    effective_from "mid-period exclusion" tests below."""

    _fixed: date = date(2026, 6, 15)

    @classmethod
    def today(cls):
        return cls._fixed


TODAY = _FixedDate.today()
FIXED_NOW = datetime.combine(TODAY, datetime.min.time()) + timedelta(hours=12)
PERIOD_START = TODAY.replace(day=1)
if TODAY.month == 12:
    _next_month = TODAY.replace(year=TODAY.year + 1, month=1, day=1)
else:
    _next_month = TODAY.replace(month=TODAY.month + 1, day=1)
PERIOD_END = _next_month - timedelta(days=1)

SERIES_A = "Saving Challenge (2026)"   # owner's real case: merchant_name-based series
SERIES_B = "Freelance Client"          # a second, unrelated series on the same busy account


# ── Generic fake-Mongo plumbing (subset matcher + collection) ───────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$lte" in cond and not (val is not None and val <= cond["$lte"]):
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


class _InsertResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class FakeCol:
    """Stand-in for a Motor collection — enough of find()/find_one()/
    insert_one()/update_one()/delete_one() to drive the real router code."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        if "_id" not in doc:
            doc["_id"] = ObjectId()
        self.docs.append(doc)
        return _InsertResult(doc["_id"])

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def delete_one(self, filt):
        for i, d in enumerate(self.docs):
            if _match(d, filt):
                del self.docs[i]
                return

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v


def _txn(account_id, amount, txn_type, days_ago=0, uid=UID, merchant_name=SERIES_A,
          description="", now=FIXED_NOW):
    """`now` defaults to FIXED_NOW so days_ago fixtures land relative to the
    same frozen "today" that PERIOD_START/PERIOD_END and date.today() (see
    `_FixedDate` above) use — the router's period math is fully hermetic
    against the wall clock. The one exception is fill_candidates, whose
    90-day recency window is computed from the *real* `datetime.now()`
    in app.routers.allocations (not date.today(), so `_FixedDate` doesn't
    reach it — deliberately not patched here, since datetime.now() lives
    on a built-in type and patching the module's `datetime` name would
    break the module's own `isinstance(x, datetime)` checks elsewhere,
    e.g. _is_completed). Its tests pass `now=datetime.now()` explicitly so
    their fixtures stay anchored to whatever the window actually compares
    against, instead of drifting out of the 90-day window as FIXED_NOW
    recedes further into the past relative to the real wall clock."""
    return {
        "user_id": uid,
        "account_id": account_id,
        "amount": amount,
        "transaction_type": txn_type,
        "date": now - timedelta(days=days_ago),
        "merchant_name": merchant_name,
        "description": description,
    }


def _account(acct_id, uid=UID):
    return {"_id": acct_id, "user_id": uid, "name": acct_id, "balance": 0.0}


def _setup(monkeypatch, *, accounts=None, allocations_docs=None, txns=None,
           yapily_txns=None, prefs=None):
    monkeypatch.setattr(allocations, "date", _FixedDate)
    monkeypatch.setattr(allocations, "accounts_col", FakeCol(accounts or []))
    monkeypatch.setattr(allocations, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(allocations, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(allocations, "allocations_col", FakeCol(allocations_docs or []))
    monkeypatch.setattr(allocations, "transactions_col", FakeCol(txns or []))
    monkeypatch.setattr(allocations, "yapily_transactions_col", FakeCol(yapily_txns or []))
    monkeypatch.setattr(allocations, "preferences_col", FakeCol(
        prefs if prefs is not None else [{"user_id": UID, "pay_period_config": {"type": "calendar_month"}}]
    ))
    # response_cache.invalidate touches nothing DB-backed — leave it real.


USER = {"email": UID}


def _create(name="Saving Challenge", amount=250, account="monzo-1",
            match_type="description_contains", match_value=SERIES_A, display=None,
            recurrence="every_period", effective_from=None, user=USER):
    body = {
        "name": name,
        "amount_per_period": amount,
        "fill_account_id": account,
        "match_type": match_type,
        "match_value": match_value,
        "recurrence": recurrence,
    }
    if display is not None:
        body["fill_display_name"] = display
    if effective_from is not None:
        body["effective_from"] = effective_from
    return asyncio.run(allocations.create_allocation(body, user))


def _completed_once_doc(account="monzo-1", match_type="description_contains", match_value=SERIES_A,
                         display=SERIES_A, amount=100, name="Old one-off", uid=UID, active=True,
                         effective_from=None):
    """A "once" allocation whose fixed period is safely in the past —
    bypasses create_allocation (which always fixes the boundary to TODAY's
    period) so tests can exercise post-completion behaviour without waiting
    for a real pay period to elapse."""
    past_start = TODAY - timedelta(days=400)
    past_end = TODAY - timedelta(days=370)
    return {
        "_id": ObjectId(),
        "user_id": uid,
        "name": name,
        "amount_per_period": amount,
        "fill_account_id": account,
        "match_type": match_type,
        "match_value": match_value,
        "fill_display_name": display,
        "effective_from": datetime(*(effective_from or (past_start.year, past_start.month, past_start.day))),
        "recurrence": "once",
        "created_period_start": datetime(past_start.year, past_start.month, past_start.day),
        "created_period_end": datetime(past_end.year, past_end.month, past_end.day, 23, 59, 59),
        "active": active,
        "created_at": FIXED_NOW,
    }


# ── create / validation ──────────────────────────────────────────────────

def test_create_requires_own_account(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        _create(account="not-mine")
    assert exc.value.status_code == 400


def test_create_rejects_someone_elses_account(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1", uid="someone-else")])
    with pytest.raises(HTTPException):
        _create(account="monzo-1")


def test_create_rejects_non_positive_amount(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException):
        _create(amount=0)
    with pytest.raises(HTTPException):
        _create(amount=-10)


def test_create_requires_match_type(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.create_allocation(
            {"name": "Saving Challenge", "amount_per_period": 250,
             "fill_account_id": "monzo-1", "match_value": SERIES_A, "recurrence": "every_period"},
            USER,
        ))
    assert exc.value.status_code == 400


def test_create_rejects_category_match_type(monkeypatch):
    """Category-type rules are not offered here — an envelope fills from a
    specific payment, not a whole spend category."""
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        _create(match_type="category", match_value="Groceries")
    assert exc.value.status_code == 400


def test_create_requires_match_value(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.create_allocation(
            {"name": "Saving Challenge", "amount_per_period": 250,
             "fill_account_id": "monzo-1", "match_type": "description_contains",
             "recurrence": "every_period"},
            USER,
        ))
    assert exc.value.status_code == 400


def test_create_requires_recurrence(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.create_allocation(
            {"name": "Saving Challenge", "amount_per_period": 250,
             "fill_account_id": "monzo-1", "match_type": "description_contains",
             "match_value": SERIES_A},
            USER,
        ))
    assert exc.value.status_code == 400


def test_create_rejects_invalid_recurrence(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        _create(recurrence="monthly")
    assert exc.value.status_code == 400


def test_create_succeeds_for_own_account(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    out = _create()
    assert out["name"] == "Saving Challenge"
    assert out["amount_per_period"] == 250
    assert out["match_type"] == "description_contains"
    assert out["match_value"] == SERIES_A
    assert out["fill_display_name"] == SERIES_A  # defaulted from match_value
    assert out["recurrence"] == "every_period"
    assert out["completed"] is False
    assert out["pending"] is False
    assert out["active"] is True
    assert out["filled_this_period"] == 0.0
    assert out["remaining"] == 250.0
    assert out["effective_from"] == PERIOD_START.isoformat()  # default = period start


def test_create_fill_display_name_defaults_to_cleaned_match_value(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    out = _create(match_value="  saving challenge deposit  ", display=None)
    assert out["fill_display_name"]  # cleaned, non-empty
    assert "saving" in out["fill_display_name"].lower()


def test_create_fill_display_name_explicit_wins_over_default(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    out = _create(match_value=SERIES_A, display="My Custom Label")
    assert out["fill_display_name"] == "My Custom Label"


# ── one active allocation per (account, match_type, match_value) rule ────

def test_second_active_allocation_same_rule_rejected(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    _create(name="First", amount=100)
    with pytest.raises(HTTPException) as exc:
        _create(name="Second", amount=50)
    assert exc.value.status_code == 400


def test_two_active_allocations_same_account_different_rule_both_valid(monkeypatch):
    """A busy account can host two envelopes as long as they're fed by
    different rules."""
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    first = _create(name="First", amount=100, match_value=SERIES_A)
    second = _create(name="Second", amount=50, match_value=SERIES_B)
    assert first["active"] is True
    assert second["active"] is True
    assert first["match_value"] != second["match_value"]


def test_same_match_value_different_match_type_both_valid(monkeypatch):
    """The conflict key is the full (account, match_type, match_value)
    tuple — an equals-rule and a contains-rule on the same text are
    different rules."""
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    first = _create(name="First", amount=100, match_type="description_equals", match_value=SERIES_A)
    second = _create(name="Second", amount=50, match_type="description_contains", match_value=SERIES_A)
    assert first["active"] is True
    assert second["active"] is True


def test_second_allocation_allowed_once_first_is_inactive(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    first = _create(name="First", amount=100)
    asyncio.run(allocations.update_allocation(first["id"], {"active": False}, USER))
    second = _create(name="Second", amount=50)
    assert second["active"] is True


def test_update_reactivation_conflict_rejected(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    first = _create(name="First", amount=100)
    asyncio.run(allocations.update_allocation(first["id"], {"active": False}, USER))
    _create(name="Second", amount=50)
    with pytest.raises(HTTPException):
        asyncio.run(allocations.update_allocation(first["id"], {"active": True}, USER))


# ── filled_this_period: rule matching (equals vs contains) ───────────────

def test_filled_contains_sums_only_current_period_credits_on_right_account_and_rule(monkeypatch):
    txns = [
        _txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A),
        _txn("monzo-1", 9.0, "credit", days_ago=2, merchant_name=SERIES_A),
        _txn("monzo-1", 50.0, "debit", days_ago=1, merchant_name=SERIES_A),      # wrong type
        _txn("other-acct", 100.0, "credit", days_ago=1, merchant_name=SERIES_A),  # wrong account
        _txn("monzo-1", 500.0, "credit", days_ago=400, merchant_name=SERIES_A),   # outside period
        _txn("monzo-1", 999.0, "credit", days_ago=1, merchant_name=SERIES_B),     # right account, WRONG rule
    ]
    _setup(monkeypatch, txns=txns)
    filled = asyncio.run(allocations.filled_this_period(
        UID, "monzo-1", "description_contains", SERIES_A, PERIOD_START, PERIOD_END))
    assert filled == 18.0


def test_filled_equals_matches_exact_description_only(monkeypatch):
    txns = [
        _txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=None, description="Saving Challenge (2026)"),
        _txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=None, description="Saving Challenge (2026) extra"),
    ]
    _setup(monkeypatch, txns=txns)
    filled = asyncio.run(allocations.filled_this_period(
        UID, "monzo-1", "description_equals", "Saving Challenge (2026)", PERIOD_START, PERIOD_END))
    assert filled == 9.0  # only the exact match counts, the "extra" one doesn't


def test_filled_equals_case_and_trim_insensitive(monkeypatch):
    txns = [_txn("monzo-1", 9.0, "credit", days_ago=1, description="  saving challenge (2026)  ")]
    _setup(monkeypatch, txns=txns)
    filled = asyncio.run(allocations.filled_this_period(
        UID, "monzo-1", "description_equals", "Saving Challenge (2026)", PERIOD_START, PERIOD_END))
    assert filled == 9.0


def test_filled_scoped_to_user(monkeypatch):
    txns = [_txn("monzo-1", 100.0, "credit", days_ago=1, uid="someone-else", merchant_name=SERIES_A)]
    _setup(monkeypatch, txns=txns)
    filled = asyncio.run(allocations.filled_this_period(
        UID, "monzo-1", "description_contains", SERIES_A, PERIOD_START, PERIOD_END))
    assert filled == 0.0


def test_unrelated_rule_on_same_account_does_not_fill(monkeypatch):
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    created = _create(amount=250, match_value=SERIES_A)
    assert created["filled_this_period"] == 9.0

    # Now an unrelated series lands on the SAME account.
    txns2 = txns + [_txn("monzo-1", 400.0, "credit", days_ago=1, merchant_name=SERIES_B)]
    monkeypatch.setattr(allocations, "transactions_col", FakeCol(txns2))
    full = asyncio.run(allocations.list_allocations(USER))
    assert full["items"][0]["filled_this_period"] == 9.0  # unchanged, SERIES_B ignored


def test_filled_inverted_window_returns_zero(monkeypatch):
    _setup(monkeypatch, txns=[])
    filled = asyncio.run(allocations.filled_this_period(
        UID, "monzo-1", "description_contains", SERIES_A, PERIOD_END, PERIOD_START))
    assert filled == 0.0


# ── remaining floors at 0 on overfill; filled reported truthfully ───────

def test_overfill_floors_remaining_but_reports_filled_truthfully(monkeypatch):
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 300.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    doc = _create(amount=250)
    assert doc["filled_this_period"] == 300.0
    assert doc["remaining"] == 0.0


# ── inactive allocation is inert ─────────────────────────────────────────

def test_inactive_allocation_excluded_from_active_list_and_reserve(monkeypatch):
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 20.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    created = _create(amount=250)
    asyncio.run(allocations.update_allocation(created["id"], {"active": False}, USER))

    active = asyncio.run(allocations.list_active_allocations(UID))
    assert active == []

    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 0.0
    assert count == 0

    # Still visible in the full (management) list, just marked inactive.
    full = asyncio.run(allocations.list_allocations(USER))
    assert len(full["items"]) == 1
    assert full["items"][0]["active"] is False


# ── delete removes effect ────────────────────────────────────────────────

def test_delete_removes_effect(monkeypatch):
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 20.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    created = _create(amount=250)
    out = asyncio.run(allocations.delete_allocation(created["id"], USER))
    assert out["deleted"] is True

    full = asyncio.run(allocations.list_allocations(USER))
    assert full["items"] == []
    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 0.0
    assert count == 0


# ── total_reserved_remaining drives safe_to_spend's exact drop/recovery ──

def test_reserve_drops_by_exactly_the_remainder_and_recovers_as_fills_accrue(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts, txns=[])
    created = _create(amount=250)
    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 250.0
    assert count == 1

    # Now some fills land — reserve should drop by exactly that amount.
    txns = [
        _txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A),
        _txn("monzo-1", 9.0, "credit", days_ago=2, merchant_name=SERIES_A),
    ]
    monkeypatch.setattr(allocations, "transactions_col", FakeCol(txns))
    reserved2, _ = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved2 == 250.0 - 18.0

    # Full fill — reserve hits exactly 0, never negative.
    txns_full = [_txn("monzo-1", 250.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    monkeypatch.setattr(allocations, "transactions_col", FakeCol(txns_full))
    reserved3, _ = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved3 == 0.0

    # Overfill — reserve still floors at 0, doesn't go negative.
    txns_over = [_txn("monzo-1", 400.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    monkeypatch.setattr(allocations, "transactions_col", FakeCol(txns_over))
    reserved4, _ = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved4 == 0.0


def test_patch_update_name_amount_active(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts)
    created = _create(amount=250)
    updated = asyncio.run(allocations.update_allocation(
        created["id"], {"name": "New Name", "amount_per_period": 300}, USER
    ))
    assert updated["name"] == "New Name"
    assert updated["amount_per_period"] == 300


def test_get_owned_rejects_other_users_allocation(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts)
    created = _create(amount=250)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.update_allocation(created["id"], {"name": "Hijack"}, {"email": "intruder"}))
    assert exc.value.status_code == 404


# ── recurrence: "once" vs "every_period" ──────────────────────────────────

def test_once_allocation_reserves_during_its_period_same_as_every_period(monkeypatch):
    """A freshly created "once" allocation is still inside its own fixed
    period (created just now) — it fills and reserves exactly like an
    every_period allocation would."""
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    out = _create(amount=250, recurrence="once")
    assert out["recurrence"] == "once"
    assert out["completed"] is False
    assert out["filled_this_period"] == 9.0
    assert out["remaining"] == 241.0

    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 241.0
    assert count == 1


def test_once_allocation_reserves_nothing_after_its_period_ends(monkeypatch):
    """Once today is past the fixed created_period_end, a "once" allocation
    is `completed` and reserves NOTHING — even though its rule still has
    real (historical) fills on record."""
    accounts = [_account("monzo-1")]
    doc = _completed_once_doc(amount=100)
    _setup(monkeypatch, accounts=accounts, allocations_docs=[doc], txns=[])
    full = asyncio.run(allocations.list_allocations(USER))
    item = full["items"][0]
    assert item["recurrence"] == "once"
    assert item["completed"] is True
    assert item["remaining"] == 0.0

    # Still counted as an active allocation (it's never force-deactivated),
    # but contributes exactly £0 to the reserve — that's the "excluded from
    # reserve maths" requirement.
    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 0.0
    assert count == 1


def test_once_allocation_appears_completed_in_listings_but_is_not_deleted(monkeypatch):
    accounts = [_account("monzo-1")]
    doc = _completed_once_doc(name="Old one-off")
    _setup(monkeypatch, accounts=accounts, allocations_docs=[doc], txns=[])
    full = asyncio.run(allocations.list_allocations(USER))
    assert len(full["items"]) == 1
    assert full["items"][0]["name"] == "Old one-off"
    assert full["items"][0]["completed"] is True
    assert full["items"][0]["active"] is True  # never deleted, never force-deactivated


def test_completed_once_allocation_does_not_block_new_allocation_on_same_rule(monkeypatch):
    """The whole point of the correction: a finished one-off shouldn't
    permanently squat on its rule."""
    accounts = [_account("monzo-1")]
    old = _completed_once_doc(account="monzo-1", match_value=SERIES_A, active=True)
    _setup(monkeypatch, accounts=accounts, allocations_docs=[old], txns=[])
    out = _create(name="New one", amount=50, account="monzo-1", match_value=SERIES_A, recurrence="every_period")
    assert out["active"] is True

    full = asyncio.run(allocations.list_allocations(USER))
    assert len(full["items"]) == 2
    names = {i["name"] for i in full["items"]}
    assert names == {"Old one-off", "New one"}


def test_uncompleted_once_allocation_still_blocks_same_rule(monkeypatch):
    """A "once" allocation still inside its live period behaves exactly
    like every_period for the conflict rule — it's the completed ones that
    are exempt, not "once" allocations in general."""
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts)
    _create(name="First", amount=100, recurrence="once")
    with pytest.raises(HTTPException) as exc:
        _create(name="Second", amount=50, recurrence="every_period")
    assert exc.value.status_code == 400


def test_every_period_allocation_behaviour_unchanged_by_recurrence_field(monkeypatch):
    """Regression: default/every_period allocations behave exactly as
    before recurrence existed — no completion, always reserves its
    remainder."""
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    out = _create(amount=250, recurrence="every_period")
    assert out["completed"] is False
    assert out["filled_this_period"] == 9.0
    assert out["remaining"] == 241.0
    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 241.0
    assert count == 1


def test_patch_switch_every_period_to_once_fixes_boundary_to_current_period(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts)
    created = _create(amount=100, recurrence="every_period")
    updated = asyncio.run(allocations.update_allocation(created["id"], {"recurrence": "once"}, USER))
    assert updated["recurrence"] == "once"
    assert updated["completed"] is False
    assert updated["period_start"] == PERIOD_START.isoformat()
    assert updated["period_end"] == PERIOD_END.isoformat()


def test_patch_switch_completed_once_to_every_period_is_allowed(monkeypatch):
    accounts = [_account("monzo-1")]
    doc = _completed_once_doc(amount=100)
    _setup(monkeypatch, accounts=accounts, allocations_docs=[doc], txns=[])
    updated = asyncio.run(allocations.update_allocation(str(doc["_id"]), {"recurrence": "every_period"}, USER))
    assert updated["recurrence"] == "every_period"
    assert updated["completed"] is False
    # Reactivated into a live, perpetual reservation again.
    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 100.0
    assert count == 1


# ── effective_from semantics ──────────────────────────────────────────────

def test_default_effective_from_is_period_start(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts, txns=[])
    out = _create(amount=100)
    assert out["effective_from"] == PERIOD_START.isoformat()
    assert out["pending"] is False


def test_effective_from_mid_period_excludes_earlier_credits(monkeypatch):
    accounts = [_account("monzo-1")]
    elapsed = (TODAY - PERIOD_START).days
    if elapsed < 2:
        pytest.skip("needs at least 2 elapsed days in the current pay period")
    cutoff = PERIOD_START + timedelta(days=1)
    # One credit dated the first day of the period (before the cutoff), one
    # dated today (safely after it, since elapsed >= 2).
    txns = [
        _txn("monzo-1", 100.0, "credit", days_ago=elapsed, merchant_name=SERIES_A),
        _txn("monzo-1", 9.0, "credit", days_ago=0, merchant_name=SERIES_A),
    ]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    out = _create(amount=250, effective_from=cutoff.isoformat())
    assert out["effective_from"] == cutoff.isoformat()
    assert out["filled_this_period"] == 9.0  # the period-start credit landed before the cutoff, excluded
    assert out["remaining"] == 241.0
    assert out["pending"] is False


def test_effective_from_in_future_is_pending_with_zero_reserve(monkeypatch):
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    future = PERIOD_END + timedelta(days=5)  # next pay period
    out = _create(amount=250, effective_from=future.isoformat())
    assert out["pending"] is True
    assert out["remaining"] == 0.0
    assert out["completed"] is False

    reserved, count = asyncio.run(allocations.total_reserved_remaining(UID))
    assert reserved == 0.0
    assert count == 1  # still counted as active, just contributes nothing yet


def test_once_window_intersects_created_period_start_and_effective_from(monkeypatch):
    """recurrence == 'once': the fixed window becomes
    [max(created_period_start, effective_from), created_period_end]."""
    accounts = [_account("monzo-1")]
    elapsed = (TODAY - PERIOD_START).days
    if elapsed < 2:
        pytest.skip("needs at least 2 elapsed days in the current pay period")
    cutoff = PERIOD_START + timedelta(days=1)
    txns = [
        _txn("monzo-1", 100.0, "credit", days_ago=elapsed, merchant_name=SERIES_A),
        _txn("monzo-1", 9.0, "credit", days_ago=0, merchant_name=SERIES_A),
    ]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    out = _create(amount=250, recurrence="once", effective_from=cutoff.isoformat())
    assert out["recurrence"] == "once"
    assert out["filled_this_period"] == 9.0  # the period-start credit, before the cutoff, is excluded
    assert out["remaining"] == 241.0


def test_once_effective_from_before_created_period_start_has_no_effect(monkeypatch):
    """max(created_period_start, effective_from): an effective_from earlier
    than the once allocation's own creation period changes nothing."""
    accounts = [_account("monzo-1")]
    txns = [_txn("monzo-1", 9.0, "credit", days_ago=0, merchant_name=SERIES_A)]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    long_ago = (TODAY - timedelta(days=200)).isoformat()
    out = _create(amount=250, recurrence="once", effective_from=long_ago)
    assert out["filled_this_period"] == 9.0
    assert out["period_start"] == PERIOD_START.isoformat()


def test_patch_effective_from_updates_and_recomputes_pending(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts, txns=[])
    created = _create(amount=100)
    future = (PERIOD_END + timedelta(days=5)).isoformat()
    updated = asyncio.run(allocations.update_allocation(created["id"], {"effective_from": future}, USER))
    assert updated["pending"] is True
    assert updated["remaining"] == 0.0

    # Now move it back into the current period.
    restored = asyncio.run(allocations.update_allocation(
        created["id"], {"effective_from": PERIOD_START.isoformat()}, USER))
    assert restored["pending"] is False
    assert restored["remaining"] == 100.0


def test_invalid_effective_from_rejected(monkeypatch):
    accounts = [_account("monzo-1")]
    _setup(monkeypatch, accounts=accounts)
    with pytest.raises(HTTPException) as exc:
        _create(amount=100, effective_from="not-a-date")
    assert exc.value.status_code == 400


# ── GET /allocations/fill-candidates ─────────────────────────────────────

def test_fill_candidates_requires_own_account(monkeypatch):
    _setup(monkeypatch, accounts=[_account("monzo-1")])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(allocations.fill_candidates(account_id="not-mine", user=USER))
    assert exc.value.status_code == 400


def test_fill_candidates_groups_by_series_and_sorts_by_recency(monkeypatch):
    # fill_candidates' 90-day window is computed from the real wall clock
    # (see the note on `_txn`), so these fixtures are anchored to real
    # datetime.now(), not FIXED_NOW.
    real_now = datetime.now()
    accounts = [_account("monzo-1")]
    txns = [
        _txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A, now=real_now),
        _txn("monzo-1", 9.0, "credit", days_ago=2, merchant_name=SERIES_A, now=real_now),
        _txn("monzo-1", 9.0, "credit", days_ago=3, merchant_name=SERIES_A, now=real_now),
        _txn("monzo-1", 500.0, "credit", days_ago=10, merchant_name=SERIES_B, now=real_now),
        _txn("monzo-1", 30.0, "debit", days_ago=1, merchant_name=SERIES_A, now=real_now),        # wrong type, excluded
        _txn("other-acct", 20.0, "credit", days_ago=1, merchant_name=SERIES_A, now=real_now),    # wrong account, excluded
        _txn("monzo-1", 12.0, "credit", days_ago=200, merchant_name=SERIES_A, now=real_now),     # outside 90d window
    ]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    out = asyncio.run(allocations.fill_candidates(account_id="monzo-1", user=USER))
    items = out["items"]
    assert len(items) == 2

    # Most recent series first (SERIES_A, days_ago=1) ahead of SERIES_B (days_ago=10).
    assert items[0]["series_key"] == SERIES_A
    assert items[0]["display_name"] == SERIES_A
    assert items[0]["occurrences_90d"] == 3
    assert items[0]["last_amount"] == 9.0

    assert items[1]["series_key"] == SERIES_B
    assert items[1]["occurrences_90d"] == 1
    assert items[1]["last_amount"] == 500.0


def test_fill_candidates_scoped_to_account_and_user(monkeypatch):
    accounts = [_account("monzo-1")]
    txns = [
        _txn("monzo-1", 9.0, "credit", days_ago=1, merchant_name=SERIES_A, uid="someone-else",
             now=datetime.now()),
    ]
    _setup(monkeypatch, accounts=accounts, txns=txns)
    out = asyncio.run(allocations.fill_candidates(account_id="monzo-1", user=USER))
    assert out["items"] == []
