"""G465: a goal's tracked payments count only from its start, and each one
reduces what is still reserved (penny-exact for scheduled goals, no 85% snap).

No database: fake transaction collections, invented names and amounts shaped
like the report (12.12 rising 4p a day from a mid-period start).
"""
import asyncio
from datetime import date, datetime, timezone

import pytest

import app.routers.commitments as commitments
import app.services.plan_fulfilment as pf
from app.core import timeutil
from app.services.upcoming_account_activity import by_account_with_activity
from tests.test_g176_account_plan_sources import _Collection
from tests.test_plan_fulfilment import CFG, UID, _Txns, _goal, _slice
from tests.test_plan_source_account import _rows

TODAY = date(2026, 11, 16)
SCHED = {"type": "arithmetic", "start_pence": 1212, "step_pence": 4, "step_unit": "day",
         "start_date": "2026-11-13", "count": 365, "end_date": None}
# 13..30 Nov (calendar month): 18 x 12.12 + 0.04 x (0 + 1 + ... + 17) = 218.16 + 6.12
PERIOD_DUE = 224.28


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(pf, "transactions_col", pf.transactions_col)
    monkeypatch.setattr(pf, "yapily_transactions_col", pf.yapily_transactions_col)
    monkeypatch.setattr(timeutil, "user_today", lambda *_: TODAY)


def _debit(amount, day, desc="Saving Challenge (2026)"):
    return {"user_id": UID, "account_id": "current", "transaction_type": "debit", "amount": amount,
            "date": datetime(2026, 11, day), "description": desc}


def _sched_goal(**extra):
    return _goal(amount=2671.8, target_date="2027-11-13", schedule=SCHED,
                 fill_rule={"match_type": "description_contains", "match_value": "Saving Challenge"}, **extra)


def test_only_payments_from_the_schedule_start_count(monkeypatch):
    txns = [_debit(12.00, 5), _debit(12.08, 10), _debit(12.12, 13), _debit(12.16, 14)]
    info = _slice(monkeypatch, _sched_goal(), txns)
    f = info["fulfilment"]
    assert f["matched_pence"] == 2428
    assert [m["date"] for m in f["matched"]] == ["2026-11-13", "2026-11-14"]
    assert info["per_period_slice"] == round(PERIOD_DUE - 24.28, 2) == 200.0


def test_payments_only_before_the_start_reduce_nothing(monkeypatch):
    info = _slice(monkeypatch, _sched_goal(), [_debit(12.00, 5), _debit(12.08, 10), _debit(100.0, 12)])
    assert info["fulfilment"]["state"] == "unmet" and info["fulfilment"]["matched_pence"] == 0
    assert info["per_period_slice"] == PERIOD_DUE


def test_a_partial_payment_reduces_the_reserve_exactly(monkeypatch):
    info = _slice(monkeypatch, _sched_goal(), [_debit(12.12, 13)])
    assert info["per_period_slice"] == round(PERIOD_DUE - 12.12, 2) == 212.16


def test_a_payment_of_ninety_percent_does_not_snap_the_reserve_to_zero(monkeypatch):
    info = _slice(monkeypatch, _sched_goal(), [_debit(202.0, 14)])  # 90% of the period's plan
    assert info["per_period_slice"] == round(PERIOD_DUE - 202.0, 2) == 22.28
    assert info["fulfilment"]["state"] == "partial"


def test_a_fully_paid_period_reserves_nothing(monkeypatch):
    info = _slice(monkeypatch, _sched_goal(), [_debit(PERIOD_DUE, 14)])
    assert info["per_period_slice"] == 0 and info["fulfilment"]["state"] == "fulfilled"
    over = _slice(monkeypatch, _sched_goal(), [_debit(PERIOD_DUE + 50, 14)])
    assert over["per_period_slice"] == 0


def test_plain_fill_rule_goal_created_mid_period_counts_from_its_start(monkeypatch):
    created = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    rule = {"match_type": "description_contains", "match_value": "Japan pot"}
    base = _slice(monkeypatch, _goal(created_at=created), [])["per_period_slice"]
    txns = [_debit(80.0, 5, "To Japan pot"), _debit(10.0, 12, "To Japan pot")]
    info = _slice(monkeypatch, _goal(fill_rule=rule, created_at=created), txns)
    assert info["fulfilment"]["matched_pence"] == 1000
    assert info["per_period_slice"] == base - 10


def test_tracking_start_reads_the_users_calendar_day():
    # 23:30 UTC on 9 Jul is already 10 Jul in London (BST).
    late = datetime(2026, 7, 9, 23, 30, tzinfo=timezone.utc)
    assert pf.tracking_start({"created_at": late}) == date(2026, 7, 10)
    assert pf.tracking_start({"created_at": late, "schedule": SCHED}) == date(2026, 11, 13)
    assert pf.tracking_start({}) is None


def test_upcoming_keeps_the_account_while_the_plan_draws_and_the_reserve_is_deducted(monkeypatch):
    goal = _sched_goal(source_account_id="current")
    pf.transactions_col = _Txns([_debit(12.00, 5), _debit(12.12, 13), _debit(12.16, 14)])
    pf.yapily_transactions_col = _Txns()
    monkeypatch.setattr(pf, "transactions_col", pf.transactions_col)
    monkeypatch.setattr(commitments, "commitments_col", _Collection([goal]))
    rows = _rows(monkeypatch, goal, slice_=None)
    row = rows[0]
    assert row["remaining"] == round(PERIOD_DUE - 24.28, 2) == 200.0
    assert row["filled_amount"] == 24.28
    shown = by_account_with_activity([], [], plans=rows, positions={}, names={"current": {"name": "Monzo Current", "bank": "monzo"}})
    assert [r["account_id"] for r in shown] == ["current"]

    # Left to spend: the shared reserve reader sums the same figure.
    async def cfg(_): return CFG
    monkeypatch.setattr(commitments, "_pay_cfg", cfg)
    total, n = asyncio.run(commitments.total_reserved_slices(UID))
    assert (total, n) == (200.0, 1)


def _end_of_goal(monkeypatch, remaining, txns):
    """A scheduled goal whose remaining target is below the period's due amount
    (224.28). `remaining` is what is left AFTER the payments (the pot already
    holds them), so the ledger claims the rest of the target."""
    goal = _sched_goal()
    goal["amount"] = 1000.0
    claimed = 1000.0 - remaining
    monkeypatch.setattr(commitments, "commitments_col", _Collection([goal]))

    async def _ledger(uid, docs=None, balances=None):
        return {"commitments": {}}
    monkeypatch.setattr(commitments, "compute_pot_ledger", _ledger)

    async def _cfg(_): return CFG
    monkeypatch.setattr(commitments, "_pay_cfg", _cfg)
    pf.transactions_col = _Txns(txns)
    pf.yapily_transactions_col = _Txns()
    import app.services.account_plan_sources as sources
    from tests.test_g176_account_plan_sources import _accounts

    async def amap(_): return _accounts()
    monkeypatch.setattr(sources, "owned_account_map", amap)
    ledger = {"commitments": {str(goal["_id"]): {"total_claimed": claimed, "claims": {}}}}
    return asyncio.run(commitments._pot_progress_and_slice(goal, CFG, ledger, TODAY))


def test_end_of_goal_planned_and_reserve_both_show_the_remaining(monkeypatch):
    info = _end_of_goal(monkeypatch, 10.0, [])
    assert info["per_period_slice"] == 10.0
    f = info["fulfilment"]
    assert f["expected_pence"] == 1000 and f["matched_pence"] == 0


def test_end_of_goal_with_a_payment_planned_equals_paid_plus_reserve(monkeypatch):
    info = _end_of_goal(monkeypatch, 5.0, [_debit(5.0, 14)])  # 5 paid, 5 still to go
    f = info["fulfilment"]
    assert f["expected_pence"] == 1000 and f["matched_pence"] == 500
    assert info["per_period_slice"] == 5.0
    assert f["expected_pence"] == f["matched_pence"] + round(info["per_period_slice"] * 100)


def test_end_of_goal_fully_paid_reads_fulfilled_with_no_reserve(monkeypatch):
    info = _end_of_goal(monkeypatch, 0.0, [_debit(10.0, 14)])  # remaining 10 before, all 10 paid
    f = info["fulfilment"]
    assert f["state"] == "fulfilled"
    assert f["expected_pence"] == 1000 and f["matched_pence"] == 1000
    assert info["per_period_slice"] == 0
