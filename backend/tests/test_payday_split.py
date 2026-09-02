"""Integration coverage for the payday_plan card's new `payday_split` /
`payday_split_risk` payload (2026-08-28 decision — see
app/services/pay_period.py's in_current_window docstring and this file's
sibling, tests/test_pay_period_window.py, for the pure boundary-helper
tests).

Owner decision, verbatim: "we still want to have some visibility over the
next pay period but I don't think it should count in the existing one." A
bill/income scheduled ON payday (days_away == days_to_pay) must stop
counting in the current period's shortfall walk, while staying VISIBLE via
`payday_plan.payday_split`. `payday_split_risk` is a hedged warning, fired
only when the account's projected payday-morning balance (WITHOUT that
same-day income) can't cover its own payday-day outflows.

Runs the REAL `compute_today_items` end to end (not mocked), following the
same full-collection-fake pattern established by tests/test_penny_tools.py's
`_patch_today_items_collections` / tests/test_internal_inflows.py's
`_run_compute_today_items` — extended here with a real `accounts_col` entry
(needed to reach the payday-plan salary/dest section at all) and empty
`transactions_col`/`commitments_col` fakes (both of the helpers that read
them are failure-tolerant by design, so empty is enough to exercise the
happy path without hitting a real database).
"""
import asyncio
from datetime import timedelta

import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module

UID = "payday-split-user"
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
    """Minimal Motor stand-in. Every test here uses a single user with at
    most one doc per collection, so query filtering is deliberately not
    implemented — matching the precedent already set by this test suite's
    other companion.py harnesses (test_internal_inflows.py,
    test_penny_tools.py)."""

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


def _account(balance):
    return {
        "_id": ACCT_ID, "name": "Barclays Premier", "balance": balance,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _bill(name, days_away, amount):
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": ACCT_ID, "account_balance": None, "is_credit_card": False,
        "kind": "commitment", "expected_date": "2026-08-29",
    }


def _salary(days_away, amount):
    return {
        "name": "Salary", "days_away": days_away, "amount": amount,
        "account_id": ACCT_ID, "occurrences": 3,
        "amounts_recent": [amount, amount, amount],
    }


def _run(monkeypatch, *, balance, bills, income, days_to_pay=5):
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", _Col([_account(balance)]))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    # app.services.pace imports its OWN module-level cashflow_cache_col /
    # transactions_col / yapily_transactions_col / preferences_col (from
    # app.db.collections, at import time) rather than reading through
    # companion's names — compute_today_items's rhythm-checkpoint pass
    # (companion.py, "ONE kind-map read...") calls straight into
    # pace._read_cached_baseline / _write_cached_baseline on those bindings.
    # Patching only `companion.*` above left this write path pointed at the
    # REAL database (root cause of the "payday-split-user" fixture doc
    # found polluting the live cashflow_cache collection, 2026-08-28) —
    # patch pace's own references too so this suite never touches Mongo.
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.pay_period as pay_period
    import app.services.income as income_mod

    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=days_to_pay))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income, "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    # payday_preview=True forces the payday-plan section on regardless of
    # where `today` actually falls in the (unmocked) real calendar-month
    # pay period, and is exactly the "payday morning" mode payday_split_risk
    # must stay honest under — see its own docstring in companion.py.
    return asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))


def _payday_plan(items):
    return next((i for i in items if i["type"] == "payday_plan"), None)


def test_payday_day_sto_excluded_from_arithmetic_but_visible_in_split(monkeypatch):
    """7 STOs (~£410 total here) land exactly ON payday (days_away ==
    days_to_pay == 5) alongside the salary. A £50 genuine pre-payday bill
    (days_away 2) is the only thing that should size the plan's target —
    the payday-day STOs must show up in `payday_split`, not be folded into
    the plan's bills-total sizing."""
    bills = [_bill("Council Tax", 2, 50.0)] + [
        _bill(f"STO {n}", 5, 100.0) for n in range(7)
    ]
    income = [_salary(5, 2000.0)]
    items = _run(monkeypatch, balance=5000.0, bills=bills, income=income)

    plan = _payday_plan(items)
    assert plan is not None

    split = plan.get("payday_split")
    assert split is not None
    assert split["count"] == 7
    assert split["total"] == 700
    assert split["expected_in"] == 2000
    assert {a["account_id"] for a in split["accounts"]} == {ACCT_ID}
    assert split["accounts"][0]["out"] == 700

    # A balance this large comfortably covers the split without the salary —
    # no race warning.
    assert plan.get("payday_split_risk") is None


def test_race_warning_fires_when_balance_cannot_cover_the_split(monkeypatch):
    """Same shape, but the account's live balance can't absorb the
    payday-day outflow on its own (no pre-payday bills draining it further
    — the shortfall is purely "balance too small for the split")."""
    bills = [_bill(f"STO {n}", 5, 100.0) for n in range(7)]  # £700 total, on payday
    income = [_salary(5, 2000.0)]
    items = _run(monkeypatch, balance=300.0, bills=bills, income=income)

    plan = _payday_plan(items)
    assert plan is not None
    split = plan["payday_split"]
    assert split["total"] == 700

    risk = plan.get("payday_split_risk")
    assert risk is not None
    assert risk["account_id"] == ACCT_ID
    assert risk["name"] == "Barclays Premier"
    assert risk["shortfall"] == 400  # 700 - 300
    assert "£700" in risk["copy"]
    assert "Barclays Premier" in risk["copy"]
    assert "late" in risk["copy"].lower()
    assert "—" not in risk["copy"]  # house style: no em-dashes in user-facing copy


def test_race_warning_absent_when_balance_exactly_covers_the_split(monkeypatch):
    """Boundary: balance == outflow is covered, not at risk — the warning
    is genuinely conditional, not merely optimistic-vs-pessimistic noise."""
    bills = [_bill("STO", 5, 300.0)]
    income = [_salary(5, 2000.0)]
    items = _run(monkeypatch, balance=300.0, bills=bills, income=income)

    plan = _payday_plan(items)
    assert "payday_split_risk" not in plan


def test_no_payday_day_items_means_no_split_key_at_all(monkeypatch):
    """When nothing lands exactly on payday, `payday_split` must be absent
    (not an empty dict) — omission, per the contract, is how "nothing to
    show" is signalled."""
    bills = [_bill("Council Tax", 2, 50.0)]
    income = [_salary(2, 2000.0)]  # salary NOT on payday this time
    items = _run(monkeypatch, balance=5000.0, bills=bills, income=income)

    plan = _payday_plan(items)
    assert plan is not None
    assert "payday_split" not in plan
    assert "payday_split_risk" not in plan
