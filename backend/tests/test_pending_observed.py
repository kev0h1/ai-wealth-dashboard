"""Tests for the bank-side PENDING transaction matching fix (live bug,
2026-09-01): a bank's own displayed balance already reflects a debit before
it reaches our settled `transactions_col` feed, so the per-account walks
(at_risk_count, companion.py, spend_impact.py, the Planning page) were
debiting the same money twice -- once via the already-reduced live balance,
once again by projecting the bill as still outstanding.

Covers two layers:
  - `app/services/pending_transactions.py::replace_pending_for_account` --
    the sync-time ingestion/supersession/sweep helper.
  - `app/routers/analytics.py::_build_cashflow_response`'s
    `_match_pending_observed` choke point -- settled always wins, a pending
    match excludes the occurrence from `upcoming_bills` (and therefore every
    walk that reads it) while surfacing it via `observed_pending_bills`, and
    a vanished pending row reverts cleanly with no double give-up.

No mongomock is available in this environment (see test_notifications.py's
own note), so DB-touching collections are replaced with tiny in-memory
fakes, following the same pattern test_internal_inflows.py/test_transfer_pairs.py
already established for this suite.
"""
import asyncio
from datetime import date, datetime, timedelta

import app.routers.analytics as analytics
from app.routers.analytics import _build_cashflow_response, PENDING_GIVE_UP_DAYS
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS
import app.services.pending_transactions as pending_transactions
from app.services.pending_transactions import (
    replace_pending_for_account,
    PENDING_TXN_MAX_AGE_DAYS,
)


# ── Generic fake-Mongo plumbing, copied per this suite's existing
# per-file convention (see test_internal_inflows.py's own note). ──────────

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
            if "$nin" in cond and val in cond["$nin"]:
                return False
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$lt" in cond and not (val is not None and val < cond["$lt"]):
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

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _match(d, query)]
        return before - len(self.docs)

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$setOnInsert") or {}).items():
            d.setdefault(k, v)


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


UID = "kevin"


# ── replace_pending_for_account: ingestion / supersession / sweep ─────────

def test_new_pending_rows_are_flagged_and_stored_in_the_sibling_collection(monkeypatch):
    fake = FakeCol([])
    monkeypatch.setattr(pending_transactions, "pending_transactions_col", fake)

    asyncio.run(replace_pending_for_account(
        [{"transaction_id": "t1", "date": datetime(2026, 9, 1), "amount": -43.57,
          "description": "SEVERN TRENT WATER", "merchant_name": "", "transaction_type": "debit"}],
        "natwest", UID, provider="TrueLayer",
    ))

    assert len(fake.docs) == 1
    doc = fake.docs[0]
    assert doc["is_pending"] is True
    assert doc["amount"] == 43.57  # stored unsigned
    assert doc["account_id"] == "natwest"
    assert doc["provider"] == "TrueLayer"
    assert "first_seen" in doc and "last_seen" in doc


def test_settling_transaction_supersedes_and_deletes_the_pending_row(monkeypatch):
    """A row absent from the NEXT sync's fetch is deleted -- whether because
    it settled (and now lives in transactions_col via the ordinary path) or
    because it vanished. This test is the settle case: the second call's
    `rows` simply no longer includes it, mirroring what TrueLayer's pending
    endpoint does once a debit posts."""
    fake = FakeCol([])
    monkeypatch.setattr(pending_transactions, "pending_transactions_col", fake)

    asyncio.run(replace_pending_for_account(
        [{"transaction_id": "t1", "date": datetime(2026, 9, 1), "amount": -43.57,
          "description": "SEVERN TRENT WATER", "merchant_name": "", "transaction_type": "debit"}],
        "natwest", UID, provider="TrueLayer",
    ))
    assert len(fake.docs) == 1

    asyncio.run(replace_pending_for_account([], "natwest", UID, provider="TrueLayer"))
    assert fake.docs == []


def test_vanished_pending_row_is_also_deleted_not_just_settled_ones(monkeypatch):
    """Same mechanism as the settle case above (the module docstring's
    REVERT section): a bounced/cancelled DD just stops appearing in the next
    fetch too, and is deleted identically -- no separate code path."""
    fake = FakeCol([])
    monkeypatch.setattr(pending_transactions, "pending_transactions_col", fake)

    asyncio.run(replace_pending_for_account(
        [{"transaction_id": "t1", "date": datetime(2026, 9, 1), "amount": -20.0,
          "description": "SOME DD", "merchant_name": "", "transaction_type": "debit"}],
        "natwest", UID, provider="TrueLayer",
    ))
    asyncio.run(replace_pending_for_account([], "natwest", UID, provider="TrueLayer"))
    assert fake.docs == []


def test_age_backstop_sweeps_a_stale_pending_row_even_if_still_reported(monkeypatch):
    """PENDING_TXN_MAX_AGE_DAYS is a backstop for a connection that stops
    syncing, but it also fires even when the SAME account keeps being
    synced and the provider keeps (implausibly) reporting the same id as
    pending past the horizon -- proves the sweep isn't merely "absent from
    this fetch", it's independently age-gated."""
    fake = FakeCol([{
        "_id": "t1", "account_id": "natwest", "user_id": UID,
        "date": datetime.utcnow() - timedelta(days=PENDING_TXN_MAX_AGE_DAYS + 1),
        "amount": 43.57, "description": "SEVERN TRENT WATER", "merchant_name": None,
        "transaction_type": "debit", "provider": "TrueLayer", "is_pending": True,
        "first_seen": datetime.utcnow() - timedelta(days=PENDING_TXN_MAX_AGE_DAYS + 1),
        "last_seen": datetime.utcnow() - timedelta(days=PENDING_TXN_MAX_AGE_DAYS + 1),
    }])
    monkeypatch.setattr(pending_transactions, "pending_transactions_col", fake)

    # The provider still reports it as pending (same id) -- the age backstop
    # must still remove it.
    asyncio.run(replace_pending_for_account(
        [{"transaction_id": "t1", "date": datetime(2026, 9, 1), "amount": -43.57,
          "description": "SEVERN TRENT WATER", "merchant_name": "", "transaction_type": "debit"}],
        "natwest", UID, provider="TrueLayer",
    ))
    assert fake.docs == []


# ── _build_cashflow_response: `_match_pending_observed` choke point ───────

def _cached(recurring_spend):
    return {
        "recurring_spend": recurring_spend,
        "recurring_income": [],
        "avg_daily_spend": 0,
        "available_balance": 355.34,
        "spendable_balance": 355.34,
        "savings_balance": 0,
    }


def _pattern(**overrides):
    base = {
        "key": "SEVERN TRENT WATER",
        "avg_amount": 43.57,
        "avg_interval": 30,
        "next_date": date.today().isoformat(),
        "account_id": "natwest",
        "account_name": "THE NUMBER ONE",
        "account_bank": "NATWEST",
        "account_balance": 355.34,
        "is_credit_card": False,
        "category": "Bills",
        "monthly_anchor": None,
    }
    base.update(overrides)
    return base


def _settled_txn(desc, amount, on_date, account_id="natwest"):
    # Stored as a full datetime, matching what truelayer_sync.py/
    # finexer_sync.py actually persist (never a bare `date`).
    dt = datetime.combine(on_date, datetime.min.time()) if not isinstance(on_date, datetime) else on_date
    return {
        "user_id": UID, "transaction_type": "debit", "merchant_name": None,
        "description": desc, "amount": amount, "date": dt,
        "category": "Bills", "custom_category": None, "account_id": account_id,
    }


def _pending_doc(_id, desc, amount, on_date, account_id="natwest"):
    return {
        "_id": _id, "user_id": UID, "account_id": account_id,
        "date": datetime.combine(on_date, datetime.min.time()) if not isinstance(on_date, datetime) else on_date,
        "amount": amount, "description": desc, "merchant_name": None,
        "transaction_type": "debit", "provider": "TrueLayer", "is_pending": True,
        "first_seen": datetime.utcnow(), "last_seen": datetime.utcnow(),
    }


def _run_build_response(monkeypatch, recurring_spend, *, observed=None, pending=None):
    from app.db.collections import (
        transactions_col, yapily_transactions_col, upcoming_overrides_col,
        upcoming_rules_col, planned_expenses_col,
    )
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(observed or []))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "pending_transactions_col", FakeCol(pending or []))
    monkeypatch.setattr(analytics, "upcoming_overrides_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_rules_col", FakeCol([]))
    monkeypatch.setattr(analytics, "planned_expenses_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    return asyncio.run(_build_cashflow_response(
        _cached(recurring_spend), uid=UID, prefs={},
    ))


def test_pending_match_excludes_from_upcoming_bills_and_walks(monkeypatch):
    """The reported bug, reproduced: a bill due today with a matching
    bank-side pending debit must vanish from `upcoming_bills` -- the ONE
    list every at-risk/shortfall/payday-plan/frontend walk reads -- so
    nothing double-debits the already-reduced live balance."""
    pending = [_pending_doc("p1", "SEVERN TRENT WATER", 43.57, date.today())]
    resp = _run_build_response(monkeypatch, [_pattern()], pending=pending)

    assert resp["upcoming_bills"] == []
    assert len(resp["observed_pending_bills"]) == 1
    row = resp["observed_pending_bills"][0]
    assert row["observed_pending"] is True
    assert row["pending"] is False
    assert row["name"] == "SEVERN TRENT WATER"
    assert row["amount"] == 43.57


def test_settled_match_always_wins_over_a_stale_pending_row(monkeypatch):
    """Both a settled debit AND a pending row exist for the same occurrence
    (the brief overlap window while a provider's pending list lags behind
    its own settled feed) -- the occurrence must close ENTIRELY (settled
    behaviour), not surface as observed_pending, and must not double-count
    across the two lists."""
    observed = [_settled_txn("SEVERN TRENT WATER", 43.57, date.today())]
    pending = [_pending_doc("p1", "SEVERN TRENT WATER", 43.57, date.today())]
    resp = _run_build_response(monkeypatch, [_pattern()], observed=observed, pending=pending)

    assert resp["upcoming_bills"] == []
    assert resp["observed_pending_bills"] == []


def test_pending_match_bypasses_the_give_up_horizon(monkeypatch):
    """A bill overdue past PENDING_GIVE_UP_DAYS would ordinarily be dropped
    entirely (the give-up horizon). While it's still matched to a genuine
    bank-side pending debit it must never lapse -- give-up only applies to
    a bill nothing has accounted for at all."""
    # Exactly at the give-up boundary ((today_d - D).days == PENDING_GIVE_UP_DAYS):
    # far enough that the ordinary check would drop it, but still inside
    # `_occurrences`' own past-due generation window (today_d - PENDING_GIVE_UP_DAYS),
    # so this is a genuine "would give up here" case, not one `_occurrences`
    # never even generated.
    stale_due = (date.today() - timedelta(days=PENDING_GIVE_UP_DAYS)).isoformat()
    pattern = _pattern(next_date=stale_due, avg_interval=45)
    pending = [_pending_doc("p1", "SEVERN TRENT WATER", 43.57, date.today())]
    resp = _run_build_response(monkeypatch, [pattern], pending=pending)

    # The stale (10-days-overdue) occurrence must not appear as an ordinary
    # walk-facing bill -- it's excluded via `observed_pending`, not given up.
    # A 45-day interval also legitimately projects ONE genuine future
    # occurrence inside the 35-day window (unrelated to this bug, expected).
    assert all(b["days_away"] >= 0 for b in resp["upcoming_bills"])
    assert len(resp["observed_pending_bills"]) == 1
    stale_row = resp["observed_pending_bills"][0]
    assert stale_row["observed_pending"] is True
    assert stale_row["days_away"] < 0  # genuinely overdue, past the give-up horizon


def test_pending_vanishing_reverts_to_an_ordinary_projected_bill(monkeypatch):
    """No persisted `observed_pending` state -- it's recomputed fresh every
    call from whatever the pending collection currently holds. A pending
    row that vanished (settled elsewhere, or bounced) without ever showing
    up here again must let the occurrence fall straight back into the
    ordinary overdue/give-up handling, exactly as if this module never
    existed for that call."""
    pattern = _pattern()
    pending = [_pending_doc("p1", "SEVERN TRENT WATER", 43.57, date.today())]

    resp_with_pending = _run_build_response(monkeypatch, [pattern], pending=pending)
    assert resp_with_pending["upcoming_bills"] == []
    assert len(resp_with_pending["observed_pending_bills"]) == 1

    resp_after_revert = _run_build_response(monkeypatch, [pattern], pending=[])
    assert resp_after_revert["observed_pending_bills"] == []
    assert len(resp_after_revert["upcoming_bills"]) == 1
    bill = resp_after_revert["upcoming_bills"][0]
    assert bill["pending"] is True
    assert bill["observed_pending"] is False


def test_pending_row_not_matched_when_amount_outside_tolerance(monkeypatch):
    """Same tolerance rule as `_match_observed` (max(£2, 15%)) -- a pending
    row for a materially different amount must not be treated as this
    bill's twin, fails closed to the ordinary (walk-facing) bill instead."""
    pending = [_pending_doc("p1", "SEVERN TRENT WATER", 90.00, date.today())]
    resp = _run_build_response(monkeypatch, [_pattern()], pending=pending)

    assert len(resp["upcoming_bills"]) == 1
    assert resp["observed_pending_bills"] == []


def test_pending_row_not_matched_across_accounts(monkeypatch):
    """Account-scoped, same as `_match_observed`: a pending debit on a
    DIFFERENT account must never close this occurrence."""
    pending = [_pending_doc("p1", "SEVERN TRENT WATER", 43.57, date.today(), account_id="barclays")]
    resp = _run_build_response(monkeypatch, [_pattern()], pending=pending)

    assert len(resp["upcoming_bills"]) == 1
    assert resp["observed_pending_bills"] == []
