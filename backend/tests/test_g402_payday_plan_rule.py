"""G402: the payday plan's per-destination rule (PRODUCT.md, "The payday plan").

requirement = predicted recurring payments from the account + declared goals,
set-asides and one-offs leaving it; buffer only when bills leave the account,
added after the bills; no everyday spend; an account gets a row only when
something is taken from it, and account type (current, savings, pot, ISA) is
never consulted. Every figure below is derived by hand in the test. Account and bill names are generic.
"""
import asyncio
from datetime import datetime, timedelta

import app.core.timeutil as timeutil
import app.services.companion as companion
from tests.test_g129_payday_plan_payload import (
    SALARY_ACCT, UID, _account, _base_patch, _bill, _dest, _payday_plan, _salary,
)

BILLS = "acc-bills"
BARE = "acc-bare"
SAVER = "acc-saver"


def _plan(monkeypatch, accounts, bills, transactions=None):
    today_d = timeutil.user_today()
    pay_period, _ = _base_patch(
        monkeypatch, accounts=accounts, bills=bills, income=[_salary(0, 999.0)],
        transactions=transactions or [],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    monkeypatch.setattr(pay_period, "prev_pay_period", lambda ref, cfg: (ref - timedelta(days=30), ref))
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    plan = _payday_plan(items)
    assert plan is not None
    return plan


def _habitual(dest, amount):
    when = datetime.combine(timeutil.user_today(), datetime.min.time())
    return [
        {"user_id": UID, "transaction_type": "debit", "account_id": SALARY_ACCT,
         "amount": amount, "date": when, "category": "Transfer"},
        {"user_id": UID, "transaction_type": "credit", "account_id": dest,
         "amount": amount, "date": when},
    ]


def test_buffer_only_where_bills_leave_and_no_row_without_a_requirement(monkeypatch):
    # BILLS owes 100 from a 30 balance: target 100 + 50 buffer = 150, move
    # ceil5(150 - 30) = 120. BARE owes nothing and has 0: no requirement, so no
    # row (the old rule padded a 50 buffer). Salary 1000, no bills: stays
    # 1000 - 120 = 880.
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(BILLS, 30.0, "Bills"), _account(BARE, 0.0, "Bare")],
        [_bill("Insurance", 2, 100.0, account_id=BILLS)],
    )
    assert [d["account_id"] for d in plan["dests"]] == [BILLS]
    d = _dest(plan, BILLS)
    assert (d["bills_total"], d["buffer"], d["spend_typical"], d["target"], d["move"]) == (100, 50, 0, 150, 120)
    assert plan["salary"]["stays"] == 880
    assert plan["habitual_note"] is False


def test_salary_account_buffer_follows_its_own_bills(monkeypatch):
    # The pay account owes a 100 bill: target 100 + 50 = 150, distributable
    # 1000 - 150 = 850. BILLS owes 200 from 0: buffer 50, move 250. Stays
    # 850 - 250 = 600.
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(BILLS, 0.0, "Bills")],
        [_bill("Rent", 2, 100.0, account_id=SALARY_ACCT), _bill("Insurance", 3, 200.0, account_id=BILLS)],
    )
    assert _dest(plan, BILLS)["move"] == 250
    assert plan["salary"]["stays"] == 600


def test_account_already_covered_keeps_its_row_at_zero(monkeypatch):
    # BILLS owes 100 and holds 500, above its 150 target: a row, move 0.
    # (The card hides a move-0 row with no usual; this asserts the payload only.)
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(BILLS, 500.0, "Bills")],
        [_bill("Insurance", 2, 100.0, account_id=BILLS)],
    )
    d = _dest(plan, BILLS)
    assert d["move"] == 0 and d["target"] == 150 and d["buffer"] == 50


def test_savings_account_with_nothing_leaving_it_has_no_row_and_habitual_note_is_set(monkeypatch):
    # A habitual 100 into the saver has no item behind it: no row, note true.
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(BILLS, 0.0, "Bills"),
         _account(SAVER, 0.0, "Saver", subtype="SAVINGS")],
        [_bill("Insurance", 2, 100.0, account_id=BILLS)],
        transactions=_habitual(SAVER, 100.0),
    )
    assert [d["account_id"] for d in plan["dests"]] == [BILLS]
    assert plan["habitual_note"] is True
    assert all(d["habitual_top_up"] is False for d in plan["dests"])


def test_savings_typed_account_with_a_direct_debit_is_a_destination(monkeypatch):
    # The test is positive and ignores type: the saver pays a 40 direct debit
    # from a 0 balance, so requirement 40, buffer 50 (a payment leaves it),
    # target 90, move ceil5(90) = 90. Same formula as a current account.
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(SAVER, 0.0, "Saver", subtype="SAVINGS")],
        [_bill("Direct debit", 2, 40.0, account_id=SAVER)],
    )
    d = _dest(plan, SAVER)
    assert (d["bills_total"], d["buffer"], d["target"], d["move"]) == (40, 50, 90, 90)
    assert d["destination_kind"] == "spend"


def test_pot_with_a_set_aside_funded_from_it_is_a_destination(monkeypatch):
    # A set-aside sourced from the pot (G350 source need 60): no bills, so no
    # buffer; target 60, balance 0, move 60 with the reason attached. A
    # current account with nothing due (BARE) has no row.
    async def needs(*_a, **_k):
        return {SAVER: {"amount": 60.0, "source_assumed": False, "reasons": [
            {"name": "Holiday", "kind": "set_aside", "amount": 60.0, "source_assumed": False, "to": []},
        ]}}

    monkeypatch.setattr(companion, "_plan_source_needs", needs)
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(SAVER, 0.0, "Pot", subtype="SAVINGS"),
         _account(BARE, 0.0, "Bare")],
        [],
    )
    assert [d["account_id"] for d in plan["dests"]] == [SAVER]
    d = _dest(plan, SAVER)
    assert (d["buffer"], d["target"], d["move"]) == (0, 60, 60)
    assert [r["name"] for r in d["reasons"]] == ["Holiday"]


def test_habitual_note_false_when_the_plan_move_covers_the_usual_amount(monkeypatch):
    # BILLS: 100 + 50 = 150 from 0, move 150; the usual transfer is also 150,
    # so nothing habitual is left out.
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(BILLS, 0.0, "Bills")],
        [_bill("Insurance", 2, 100.0, account_id=BILLS)],
        transactions=_habitual(BILLS, 150.0),
    )
    d = _dest(plan, BILLS)
    assert d["move"] == 150 and d["usual"] == 150
    assert plan["habitual_note"] is False


def test_habitual_note_true_when_the_move_is_below_the_usual_amount(monkeypatch):
    # BILLS holds 500: move 0, usual 150, so the usual transfer is not included.
    plan = _plan(
        monkeypatch,
        [_account(SALARY_ACCT, 1000.0, "Pay"), _account(BILLS, 500.0, "Bills")],
        [_bill("Insurance", 2, 100.0, account_id=BILLS)],
        transactions=_habitual(BILLS, 150.0),
    )
    assert _dest(plan, BILLS)["move"] == 0
    assert plan["habitual_note"] is True


def test_penny_summary_carries_the_habitual_line_only_when_flagged():
    from app.services.penny_payday_plan import _summary
    base = {"dests": [], "total": {"raw": 0}, "salary": {"keeps": []}, "left_out": []}
    assert "This doesn't include your habitual transfers." in _summary({**base, "habitual_note": True}, None, None)
    assert "habitual" not in _summary({**base, "habitual_note": False}, None, None)
