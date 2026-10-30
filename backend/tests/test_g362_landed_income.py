"""G362 (Kevin, 30 Oct 2026): on payday the salary expected today was still in
`upcoming_income` (days_away 0) while the live balance already contained it, so
every walk credited it twice and Left to spend read as if nothing were
deducted. `_build_cashflow_response` now closes an income occurrence when a
matching credit has landed (amount band and account, never series key; one
credit closes at most one occurrence), mirroring the bill rule.

Everything is faked on the module-level names the code under test reads.
"""
import asyncio
from datetime import date, datetime, timedelta

import app.core.timeutil as timeutil
import app.routers.analytics as analytics

UID = "g362-user"
TODAY = date(2026, 10, 30)
SAL_ACC, OTHER_ACC = "acc-salary", "acc-other"
SALARY = 4797.88


def _match(doc, query):
    for key, cond in (query or {}).items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$in" in cond and val not in cond["$in"]:
                return False
        elif val != cond:
            return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self.docs:
            yield d

    async def to_list(self, n):
        return list(self.docs)


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _Cursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if _match(d, query):
                return d
        return None


def _credit(when, amount, acct=SAL_ACC, cat="Income"):
    return {
        "user_id": UID, "transaction_type": "credit", "amount": amount,
        "date": datetime(when.year, when.month, when.day), "account_id": acct,
        "category": cat, "merchant_name": "Goldman Sachs Pay", "description": "GS PAY",
    }


def _income_pattern(next_d, acct=SAL_ACC, amount=SALARY, key="gs::pay"):
    return {
        "key": key, "display_name": "Goldman Sachs", "avg_amount": amount,
        "avg_interval": 28.0, "next_date": next_d.isoformat(), "category": "Income",
        "account_id": acct, "account_name": "Current", "account_bank": "barclays",
        "occurrences": 4, "amounts_recent": [amount] * 4,
    }


def _bill_pattern(key, amount, due, acct=SAL_ACC):
    return {
        "key": key, "display_name": key, "avg_amount": amount, "avg_interval": 30.0,
        "next_date": due.isoformat(), "category": "Bills", "account_id": acct,
        "account_name": "Current", "account_bank": "barclays", "occurrences": 4,
        "amounts_recent": [amount] * 4, "kind": "commitment",
    }


def _cached(income, spend=()):
    return {
        "patterns_version": analytics.PATTERNS_VERSION,
        "recurring_spend": list(spend), "recurring_income": list(income),
        "bnpl_commitments": [], "avg_daily_spend": 0,
    }


def _build(monkeypatch, cached, credits=()):
    monkeypatch.setattr(analytics.timeutil, "user_now", lambda: datetime(2026, 10, 30, 9, 0))
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(list(credits)))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "pending_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_overrides_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_rules_col", FakeCol([]))
    monkeypatch.setattr(analytics, "planned_expenses_col", FakeCol([]))
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([
        {"user_id": UID, "pay_period_config": {"type": "last_friday"}}
    ]))

    async def kinds(uid):
        return analytics.CategoryKinds(dict(analytics.BUILTIN_CATEGORY_KINDS))

    monkeypatch.setattr(analytics, "get_category_kinds", kinds)
    return asyncio.run(analytics._build_cashflow_response(cached, uid=UID))


def test_salary_landed_today_is_closed_and_not_in_upcoming_income(monkeypatch):
    resp = _build(
        monkeypatch, _cached([_income_pattern(TODAY)]),
        credits=[_credit(TODAY, SALARY)],
    )
    assert [i for i in resp["upcoming_income"] if i["days_away"] == 0] == []
    assert [i["days_away"] for i in resp["observed_income"]] == [0]


def test_salary_landed_yesterday_closes_todays_occurrence(monkeypatch):
    resp = _build(
        monkeypatch, _cached([_income_pattern(TODAY)]),
        credits=[_credit(TODAY - timedelta(days=1), SALARY - 3.0)],
    )
    assert not any(i["days_away"] == 0 for i in resp["upcoming_income"])
    assert len(resp["observed_income"]) == 1


def test_future_occurrence_is_not_closed_by_todays_credit(monkeypatch):
    resp = _build(
        monkeypatch, _cached([_income_pattern(TODAY + timedelta(days=25))]),
        credits=[_credit(TODAY, SALARY)],
    )
    assert [i["days_away"] for i in resp["upcoming_income"]] == [25]
    assert resp["observed_income"] == []


def test_one_credit_closes_one_occurrence_two_credits_close_two(monkeypatch):
    # Two streams due today with the same amount on the same account.
    patterns = [
        _income_pattern(TODAY, key="a::pay"),
        _income_pattern(TODAY, key="b::pay"),
        _income_pattern(TODAY, key="c::pay"),
    ]
    resp = _build(
        monkeypatch, _cached(patterns),
        credits=[_credit(TODAY, SALARY), _credit(TODAY, SALARY)],
    )
    assert len(resp["observed_income"]) == 2
    assert len([i for i in resp["upcoming_income"] if i["days_away"] == 0]) == 1


def test_account_mismatch_does_not_close(monkeypatch):
    resp = _build(
        monkeypatch, _cached([_income_pattern(TODAY)]),
        credits=[_credit(TODAY, SALARY, acct=OTHER_ACC)],
    )
    assert any(i["days_away"] == 0 for i in resp["upcoming_income"])
    assert resp["observed_income"] == []


def test_non_income_credit_and_amount_outside_band_do_not_close(monkeypatch):
    resp = _build(
        monkeypatch, _cached([_income_pattern(TODAY)]),
        credits=[_credit(TODAY, SALARY, cat="Transfer"), _credit(TODAY, SALARY * 0.5)],
    )
    assert any(i["days_away"] == 0 for i in resp["upcoming_income"])


def test_payday_boundary_pool_deducts_every_bill_once(monkeypatch):
    """Payday today, salary already in the balance: the pooled low point is the
    balance minus every real bill, with no second credit of the salary."""
    balance = 5804.0
    due = [("Mortgage", 1124.44, 3), ("Loan", 428.86, 5), ("Vanguard", 400.0, 6),
           ("Debt", 567.72, 10), ("Bills", 159.70, 12), ("Rent", 77.91, 20)]
    spend = [_bill_pattern(n, a, TODAY + timedelta(days=d)) for n, a, d in due]
    resp = _build(
        monkeypatch, _cached([_income_pattern(TODAY), _income_pattern(TODAY + timedelta(days=28), key="gs::next")], spend),
        credits=[_credit(TODAY, SALARY)],
    )
    days_to_pay = 28
    income = [i for i in resp["upcoming_income"] if i["days_away"] < days_to_pay]
    bills = [b for b in resp["upcoming_bills"] if b["days_away"] < days_to_pay]
    assert income == []
    total = sum(a for _, a, _ in due)
    assert round(sum(b["amount"] for b in bills), 2) == round(total, 2)
    low = analytics._safe_to_spend_lowest_projected_balance(balance, bills, income)
    assert round(low, 2) == round(balance - total, 2)
    # Without the fix the landed salary was credited again at day 0.
    assert low < balance - total + 1


# ── companion's per-account walk reads the same (closed) upcoming_income ────

def test_companion_walk_does_not_credit_the_landed_salary(monkeypatch):
    import tests.test_g359_steady_salary as g359

    import app.db.collections as db_collections

    monkeypatch.setattr(timeutil, "user_today", lambda: g359.TODAY)
    monkeypatch.setattr(db_collections, "allocations_col", g359.FakeCol([]))
    bills = [
        g359._bill("Mortgage", 1124.44, 3),
        g359._bill("Loan", 428.86, 5),
    ]
    balance = 5678.65
    accounts = [g359._account(g359.BC, balance, provider="barclays", name="Barclays Premier")]

    # The builder's output with the salary closed: no income row today.
    elig_closed: dict = {}
    g359._run(monkeypatch, bills, [], accounts=accounts, eligibility=elig_closed)
    row = elig_closed[g359.BC]
    expected = round(balance - 1124.44 - 428.86, 2)
    assert round(row["after_payments"], 2) == expected
    assert round(row["low_point"], 2) == expected

    # The pre-fix input (landed salary still listed today) overstates it.
    elig_open: dict = {}
    sal = g359._salary()
    sal.update(days_away=0, expected_date=g359.TODAY.isoformat(), amount=SALARY)
    g359._run(monkeypatch, bills, [sal], accounts=accounts, eligibility=elig_open)
    assert elig_open[g359.BC]["after_payments"] > expected + 1000
