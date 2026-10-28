"""G350 (Kevin, 2026-10-28): goal and set-aside money is tracked at its SOURCE
account, never at the pot it ends up in. A goal or set-aside is never a payday
plan destination by itself.

  - salary-sourced needs are KEPT in the salary account (`salary.keeps`), in
    its target, counted once; a habitual top-up into their pot is netted off
    so no "Personal GBP, funds Japan" move appears;
  - other-sourced needs raise THAT account's move, with `reasons` on the row;
  - `_plan_source_needs` resolves each source: stored, else detected from
    history, else the salary account with `source_assumed` true;
  - headline total == sum of moves == item total, and the move count in the
    headline equals the number of moves.
"""
import asyncio
from datetime import date, datetime, timedelta

import app.core.timeutil as timeutil
import app.db.collections as collections
import app.routers.commitments as commitments
import app.services.companion as companion
from tests.test_g317_goal_contribution import USER
from tests.test_g317_reservation_readers import ProjectionGoalCol, _manual_goal
from tests.test_payday_plan_fixes import (
    SALARY_ACCT, UID, _account, _base_patch, _payday_plan, _salary,
)

POT = "pot"
MONZO = "monzo-current"
STARLING = "starling"


def _sav(acct, name="Personal GBP", balance=0.0):
    return {**_account(acct, balance, name), "subtype": "SAVINGS_ACCOUNT"}


def _need(amount, *reasons, assumed=False):
    return {"amount": amount, "source_assumed": assumed, "reasons": [
        {"name": n, "kind": k, "amount": a, "source_assumed": assumed, "to": to}
        for n, k, a, to in reasons
    ]}


def _plan(monkeypatch, needs, *, accounts, transactions=None, income=2000.0):
    today = timeutil.user_today()
    pay_period, _ = _base_patch(monkeypatch, accounts=accounts, bills=[], income=[_salary(0, income)])
    import app.services.categories as categories_module
    from tests.test_payday_plan_fixes import _Col
    monkeypatch.setattr(categories_module, "user_categories_col", _Col([]))
    if transactions is not None:
        monkeypatch.setattr(companion, "transactions_col", _Col(transactions))
    monkeypatch.setattr(pay_period, "get_pay_period_for_date",
                        lambda _d, _c: (today, today + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda _d, _c: today + timedelta(days=30))
    monkeypatch.setattr(pay_period, "prev_pay_period", lambda r, c: (r - timedelta(days=30), r))

    async def stub(*_a, **_k):
        return needs

    monkeypatch.setattr(companion, "_plan_source_needs", stub)
    plan = _payday_plan(asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=False)))
    assert plan is not None
    return plan


def _usual_into_pot(amount):
    day = datetime.combine(timeutil.user_today(), datetime.min.time())
    return [
        {"user_id": UID, "transaction_type": "debit", "account_id": SALARY_ACCT,
         "amount": amount, "date": day, "category": "Transfer"},
        {"user_id": UID, "transaction_type": "credit", "account_id": POT,
         "amount": amount, "date": day},
    ]


def _dest(plan, acct):
    return next((d for d in plan["dests"] if d["account_id"] == acct), None)


# ── Plan wiring ─────────────────────────────────────────────────────────────

def test_goal_sourced_from_the_salary_account_is_kept_not_moved(monkeypatch):
    accounts = [_account(SALARY_ACCT, 3000.0), _sav(POT)]
    baseline = _plan(monkeypatch, {}, accounts=accounts, transactions=_usual_into_pot(100.0))
    assert _dest(baseline, POT)["move"] == 100  # today's "Personal GBP £100, funds Japan"
    needs = {SALARY_ACCT: _need(100.0, ("Japan", "goal", 100.0, [POT]))}
    plan = _plan(monkeypatch, needs, accounts=accounts, transactions=_usual_into_pot(100.0))
    assert _dest(plan, POT) is None, "the pot is never a destination for a salary-sourced goal"
    assert plan["salary"]["keeps"] == [
        {"name": "Japan", "kind": "goal", "amount": 100.0, "source_assumed": False}
    ]
    assert plan["total"] == 0
    # Counted once: the £100 moved from "moving" to "kept", so stays is unchanged.
    assert plan["salary"]["stays"] == baseline["salary"]["stays"]


def test_salary_keeps_reduce_distributable_once(monkeypatch):
    accounts = [_account(SALARY_ACCT, 3000.0), _sav(POT)]
    without = _plan(monkeypatch, {}, accounts=accounts)
    kept = _plan(monkeypatch, {SALARY_ACCT: _need(120.0, ("Saving Challenge", "set_aside", 120.0, [POT]))},
                 accounts=accounts)
    assert without["salary"]["stays"] - kept["salary"]["stays"] == 120
    assert kept["salary"]["keeps"][0]["name"] == "Saving Challenge"


def test_set_aside_sourced_from_another_account_raises_that_accounts_move(monkeypatch):
    accounts = [_account(SALARY_ACCT, 3000.0), _account(MONZO, 0.0, "Monzo current"), _sav(POT, "Monzo pot")]
    needs = {MONZO: _need(120.0, ("Saving Challenge", "set_aside", 120.0, [POT]))}
    plan = _plan(monkeypatch, needs, accounts=accounts)
    d = _dest(plan, MONZO)
    assert d["move"] == 170  # its own £50 buffer move plus the period's total
    assert d["reasons"] == [{"name": "Saving Challenge", "kind": "set_aside", "amount": 120.0}]
    assert _dest(plan, POT) is None, "never routed into the pot"
    assert plan["salary"]["keeps"] == []


def test_headline_total_moves_and_counts_agree(monkeypatch):
    accounts = [_account(SALARY_ACCT, 3000.0), _account(MONZO, 0.0, "Monzo current"), _sav(POT, "Monzo pot")]
    needs = {MONZO: _need(120.0, ("Saving Challenge", "set_aside", 120.0, [POT]))}
    plan = _plan(monkeypatch, needs, accounts=accounts)
    moves = [d for d in plan["dests"] if d["move"] > 0]
    assert plan["total"] == sum(d["move"] for d in plan["dests"])
    assert f"£{plan['total']:,}" in plan["headline"]
    assert f"across {len(moves)} account" in plan["headline"]


# ── `_plan_source_needs` source resolution ──────────────────────────────────

def _goal_world(monkeypatch, goal_doc, allocations=()):
    col = ProjectionGoalCol([goal_doc])
    monkeypatch.setattr(collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: date(2026, 11, 1))
    monkeypatch.setattr(companion.timeutil, "user_today", lambda: date(2026, 11, 1))

    async def ledger(_uid, *, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}

    async def listed(_uid):
        return list(allocations)

    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    monkeypatch.setattr(companion, "list_active_allocations", listed)


def _amap():
    accounts = [_account("current", 0.0, "Premier"), _sav(POT), _account(STARLING, 0.0, "Starling"),
                _account(MONZO, 0.0, "Monzo current")]
    return {a["_id"]: a for a in accounts}


def _needs(monkeypatch, **kw):
    return asyncio.run(companion._plan_source_needs(
        USER["email"], {"type": "calendar_month"}, {POT: 0.0}, "current", kw.pop("preview", False),
        account_map=_amap(), internal_inflows=[],
    ))


def test_goal_with_a_stored_source_is_counted_there(monkeypatch):
    _goal_world(monkeypatch, _manual_goal("Japan", 10025))
    needs = _needs(monkeypatch)
    assert list(needs) == ["current"]
    assert needs["current"]["amount"] == 100.25
    assert needs["current"]["reasons"][0]["name"] == "Japan"
    assert needs["current"]["reasons"][0]["kind"] == "goal"
    assert needs["current"]["source_assumed"] is False


def test_goal_with_no_stored_source_is_detected_from_history(monkeypatch):
    doc = {**_manual_goal("Japan", 10025), "source_account_id": None, "source_unset": False}
    _goal_world(monkeypatch, doc)

    async def history(_uid, wanted, _amap):
        return {key: STARLING for key in wanted}

    monkeypatch.setattr(companion, "infer_plan_sources_batch", history)
    needs = _needs(monkeypatch)
    assert list(needs) == [STARLING]
    assert needs[STARLING]["source_assumed"] is False


def test_goal_with_no_source_and_no_history_assumes_the_salary_account(monkeypatch):
    doc = {**_manual_goal("Japan", 10025), "source_account_id": None, "source_unset": False}
    _goal_world(monkeypatch, doc)

    async def nothing(_uid, wanted, _amap):
        return {}

    monkeypatch.setattr(companion, "infer_plan_sources_batch", nothing)
    needs = _needs(monkeypatch)
    assert list(needs) == ["current"]
    assert needs["current"]["source_assumed"] is True
    assert needs["current"]["reasons"][0]["source_assumed"] is True


def test_goal_with_not_set_is_never_guessed(monkeypatch):
    doc = {**_manual_goal("Japan", 10025), "source_account_id": None, "source_unset": True}
    _goal_world(monkeypatch, doc)
    assert _needs(monkeypatch) == {}


def _alloc(**kw):
    d = {"id": "al1", "name": "Saving Challenge", "active": True, "completed": False,
         "recurrence": "every_period", "tracking_mode": "existing_payment", "fill_account_id": POT,
         "amount_per_period": 120.0, "period_amount": 150.0, "remaining": 70.0,
         "source_account_id": MONZO, "source_set": True}
    d.update(kw)
    return d


def _no_goals(monkeypatch, allocations):
    _goal_world(monkeypatch, _manual_goal("Japan", 0, paused=True), allocations)
    monkeypatch.setattr(collections, "commitments_col", ProjectionGoalCol([]))
    monkeypatch.setattr(commitments, "commitments_col", collections.commitments_col)


def test_set_aside_counts_at_its_stored_source_remaining_live_period_amount_preview(monkeypatch):
    _no_goals(monkeypatch, [_alloc()])
    live = _needs(monkeypatch)
    assert live[MONZO]["amount"] == 70.0 and live[MONZO]["reasons"][0]["to"] == [POT]
    assert _needs(monkeypatch, preview=True)[MONZO]["amount"] == 150.0


def test_set_aside_kept_in_the_paying_account_counts_at_its_source(monkeypatch):
    kept = _alloc(tracking_mode="manual", fill_account_id="", source_account_id=None, source_set=False,
                  remaining=120.0)
    _no_goals(monkeypatch, [kept])
    needs = _needs(monkeypatch)
    assert needs["current"]["amount"] == 120.0 and needs["current"]["source_assumed"] is True


def test_once_set_aside_only_counts_in_the_live_plan(monkeypatch):
    _no_goals(monkeypatch, [_alloc(recurrence="once")])
    assert MONZO in _needs(monkeypatch)
    assert _needs(monkeypatch, preview=True) == {}


def test_set_aside_with_not_set_source_is_never_guessed(monkeypatch):
    _no_goals(monkeypatch, [_alloc(source_account_id=None, source_set=True)])
    assert _needs(monkeypatch) == {}
