"""G374: the live payday plan must stay hidden once the salary has posted.

G362 closes a salary occurrence whose credit has already posted out of
`upcoming_income` into the display-only `observed_income`. On payday that left
the plan with no salary candidate, so G172's landed-salary gate
(`_pp_salary_observed`) never ran and the plan still showed with a salary of
0. The closed occurrence now stands in for the candidate. "No candidate
because the salary was closed as observed" hides the plan; "no candidate
because nothing was ever detected" still shows it.
"""
import asyncio
from datetime import datetime, timedelta

import app.core.timeutil as timeutil
import app.services.companion as companion

from tests.test_payday_plan_fixes import (
    DEST_ACCT, SALARY_ACCT, UID, _Col, _account, _base_patch, _bill, _payday_plan, _salary,
)


def _setup(monkeypatch, *, income, observed, posted):
    today_d = timeutil.user_today()
    pay_period, _docs = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=income,
    )

    async def fake_resp(cached, uid=None, prefs=None):
        return {
            "upcoming_bills": [_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
            "upcoming_income": income,
            "observed_income": observed,
            "internal_inflows": [],
        }

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    if posted:
        monkeypatch.setattr(companion, "transactions_col", _Col([
            {"user_id": UID, "transaction_type": "credit", "account_id": SALARY_ACCT,
             "amount": 2000.0, "date": datetime.combine(today_d, datetime.min.time())},
        ]))


def test_posted_salary_closed_as_observed_suppresses_live_plan(monkeypatch):
    _setup(monkeypatch, income=[], observed=[_salary(0, 2000.0)], posted=True)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    assert _payday_plan(items) is None


def test_closed_occurrence_without_a_posted_credit_still_shows_plan(monkeypatch):
    """Closed occurrence but no matching credit in the transactions (the
    check is honest, not a blanket 'observed_income is non-empty')."""
    _setup(monkeypatch, income=[], observed=[_salary(0, 2000.0)], posted=False)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    assert _payday_plan(items) is not None


def test_salary_not_posted_shows_plan(monkeypatch):
    _setup(monkeypatch, income=[_salary(0, 2000.0)], observed=[], posted=False)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    assert _payday_plan(items) is not None


def test_no_income_stream_at_all_still_shows_plan(monkeypatch):
    _setup(monkeypatch, income=[], observed=[], posted=False)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    assert _payday_plan(items) is not None


def test_preview_unaffected_by_closed_occurrence(monkeypatch):
    _setup(monkeypatch, income=[], observed=[_salary(0, 2000.0)], posted=True)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    plan = _payday_plan(items)
    assert plan is not None and plan.get("preview") is True
