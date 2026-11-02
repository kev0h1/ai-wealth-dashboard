"""G350 step 2: a payday plan never shows an over-pay set of moves silently.

Buffers are "trimmed" (padding; G402 removed the everyday-spend padding and the
habitual savings top-ups). If the moves still add up to more than can be
distributed, deferrable legs (set-aside and goal legs largest first) are left
out and listed in `left_out`; a destination's bills floor is never cut.
Hand derivation shared by the tests: the bills account owes 200 from a 0
balance, so bills 200 + buffer 50 = 250, plus the 200 of needs sourced from it
(set-aside 120, goal 80) = move 450. The salary account owes no bills of its
own, so it keeps nothing back and distributable equals its balance.
What is still over after that is `over_salary`. Destinations past the 10-row
cap are always listed as kind "destination".
"""
import asyncio
from datetime import datetime, timedelta

import app.core.timeutil as timeutil
import app.services.companion as companion
import app.services.pay_period as pay_period_mod  # noqa: F401
from tests.test_payday_plan_fixes import (
    SALARY_ACCT, UID, _account, _base_patch, _bill, _payday_plan, _salary,
)

BILL = "acc-bill"
POT_A = "pot-a"
POT_B = "pot-b"


def _needs_on_bill_account():
    """A £120 set-aside and an £80 goal whose SOURCE is the bills account."""
    return {BILL: {"amount": 200.0, "source_assumed": False, "reasons": [
        {"name": "Saving Challenge", "kind": "set_aside", "amount": 120.0, "source_assumed": False, "to": [POT_A]},
        {"name": "Japan", "kind": "goal", "amount": 80.0, "source_assumed": False, "to": [POT_B]},
    ]}}


def _plan(monkeypatch, *, accounts, bills, needs=None, income=2000.0):
    today = timeutil.user_today()
    pay_period, _ = _base_patch(monkeypatch, accounts=accounts, bills=bills, income=[_salary(0, income)])
    monkeypatch.setattr(pay_period, "get_pay_period_for_date",
                        lambda _d, _c: (today, today + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda _d, _c: today + timedelta(days=30))

    async def stub(*_a, **_k):
        return needs or {}

    monkeypatch.setattr(companion, "_plan_source_needs", stub)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=False))
    plan = _payday_plan(items)
    assert plan is not None
    return plan


def _accounts(salary_balance):
    return [_account(SALARY_ACCT, salary_balance), _account(BILL, 0.0, "Everyday")]


_BILLS = [_bill("Council Tax", 2, 200.0, account_id=BILL, account_balance=0.0)]


def test_bills_floor_alone_over_pay_lists_dropped_legs_largest_first(monkeypatch):
    plan = _plan(monkeypatch, accounts=_accounts(100.0), bills=_BILLS, needs=_needs_on_bill_account())
    assert [(l["name"], l["kind"], l["amount"]) for l in plan["left_out"]] == [
        ("Saving Challenge", "set_aside", 120.0), ("Japan", "goal", 80.0),
    ]
    # Move 450 over distributable 100: buffer cut 50 (400), both legs dropped
    # (120 then 80), the bills floor 200 stays. Total 200, short 100, spare 100.
    assert plan["total"] == 200
    assert plan["over_salary"] == {"total": 200, "pay": 2000, "short": 100, "over_pay": False, "spare": 100}
    assert plan["covered"] is False
    assert plan["salary"]["stays"] == 0
    assert plan["body"] == (
        "These moves add up to £200, but Salary Account can only spare £100 "
        "after what it keeps for its own bills. "
        "£100 would need to come from other accounts."
    )
    assert plan["over_salary"]["over_pay"] is False and plan["over_salary"]["spare"] == 100
    assert "reasons" not in next(d for d in plan["dests"] if d["account_id"] == BILL)


def test_dropping_one_set_aside_makes_it_fit(monkeypatch):
    # Move 450 over 280: buffer cut 50 (400), over by 120, so the 120 set-aside
    # is dropped exactly. Total 280.
    plan = _plan(monkeypatch, accounts=_accounts(280.0), bills=_BILLS, needs=_needs_on_bill_account())
    assert plan["over_salary"] is None
    assert plan["left_out"] == [{"name": "Saving Challenge", "kind": "set_aside", "amount": 120.0}]
    assert plan["covered"] is True
    assert plan["total"] == 280
    assert plan["body"] == "£280 distributed. Some moves were left out this month."
    d = next(d for d in plan["dests"] if d["account_id"] == BILL)
    assert [r["name"] for r in d["reasons"]] == ["Japan"]


def test_last_leg_can_be_reduced_partially(monkeypatch):
    # Move 450 over 300: buffer cut 50 (400), over by 100, so the set-aside is
    # cut by 100 and 20 of it stays. Total 300.
    plan = _plan(monkeypatch, accounts=_accounts(300.0), bills=_BILLS, needs=_needs_on_bill_account())
    assert plan["over_salary"] is None
    assert plan["left_out"] == [{"name": "Saving Challenge", "kind": "set_aside", "amount": 100.0}]
    assert plan["total"] == 300
    d = next(d for d in plan["dests"] if d["account_id"] == BILL)
    assert [(r["name"], r["amount"]) for r in d["reasons"]] == [("Saving Challenge", 20.0), ("Japan", 80.0)]


def test_buffer_only_trim_is_trimmed_not_left_out(monkeypatch):
    # Move 450 over 400: only the 50 buffer is cut, nothing is left out.
    plan = _plan(monkeypatch, accounts=_accounts(400.0), bills=_BILLS, needs=_needs_on_bill_account())
    assert plan["trimmed"] is True
    assert plan["left_out"] == []
    assert plan["over_salary"] is None
    assert plan["body"].startswith("A tight month: buffers trimmed so it fits.")


def test_destinations_past_the_cap_are_listed(monkeypatch):
    # Eleven accounts each owe a 10 bill from 0: bills 10 + buffer 50 = move 60.
    accounts = [_account(SALARY_ACCT, 5000.0)] + [_account(f"acc-{i}", 0.0, f"Acc {i:02d}") for i in range(11)]
    bills = [_bill(f"Bill {i}", 2, 10.0, account_id=f"acc-{i}", account_balance=0.0) for i in range(11)]
    plan = _plan(monkeypatch, accounts=accounts, bills=bills)
    assert len(plan["dests"]) == 10
    cap = [l for l in plan["left_out"] if l["kind"] == "destination"]
    assert len(cap) == 1 and cap[0]["amount"] == 60
    assert plan["over_salary"] is None and plan["covered"] is True
    assert plan["body"].endswith("Some moves were left out this month.")


def test_habitual_savings_top_up_is_not_in_the_plan_and_nothing_is_left_out_for_it(monkeypatch):
    from tests.test_g129_payday_plan_payload import (
        BILL_ACCT, SAVINGS_ACCT, SALARY_ACCT as G_SALARY, UID as G_UID, _account as g_account, _base_patch as g_base, _bill as g_bill,
        _salary as g_salary,
    )
    today = timeutil.user_today()
    pay_period, _ = g_base(
        monkeypatch,
        accounts=[g_account(G_SALARY, 100.0, "Salary Account"),
                  g_account(SAVINGS_ACCT, 0.0, "Personal GBP", subtype="SAVINGS"),
                  g_account(BILL_ACCT, 0.0, "Everyday")],
        bills=[g_bill("Council Tax", 2, 200.0, account_id=BILL_ACCT, account_balance=0.0)],
        income=[g_salary(0, 999.0)],
        transactions=[
            {"user_id": G_UID, "transaction_type": "debit", "account_id": G_SALARY,
             "amount": 100.0, "date": datetime.combine(today, datetime.min.time()), "category": "Transfer"},
            {"user_id": G_UID, "transaction_type": "credit", "account_id": SAVINGS_ACCT,
             "amount": 100.0, "date": datetime.combine(today, datetime.min.time())},
        ],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda r, c: (today, today + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda t, c: today + timedelta(days=30))
    monkeypatch.setattr(pay_period, "prev_pay_period", lambda r, c: (r - timedelta(days=30), r))
    plan = _payday_plan(asyncio.run(companion.compute_today_items(G_UID, payday_preview=False, persist=True)))
    # G402: the saver has nothing leaving it, so no row and nothing to leave
    # out for it; the plan only says it does not include the habitual 100.
    # Bills account: 200 + 50 buffer = 250 over distributable 100, buffer cut
    # to 200, short 100, spare 100.
    assert plan["left_out"] == []
    assert plan["habitual_note"] is True
    assert [d["account_id"] for d in plan["dests"]] == [BILL_ACCT]
    assert plan["over_salary"]["short"] == 100 and plan["over_salary"]["spare"] == 100
    assert next(d for d in plan["dests"] if d["account_id"] == BILL_ACCT)["move"] == 200


def test_total_above_the_pay_says_more_than_the_pay(monkeypatch):
    plan = _plan(monkeypatch, accounts=_accounts(100.0), bills=_BILLS,
                 needs=_needs_on_bill_account(), income=150.0)
    assert plan["over_salary"]["over_pay"] is True
    assert plan["body"] == (
        "These moves add up to £200, more than the ~£150 pay expected. "
        "£100 would need to come from other accounts."
    )


def test_nothing_to_spare_wording(monkeypatch):
    # The pay account holds 20 and owes a 100 bill: it keeps 100 + 50 buffer =
    # 150, so distributable is 20 - 150 = -130 and spare 0. The bills account
    # moves 200 (250 less the 50 buffer cut), short 200 + 130 = 330.
    bills = _BILLS + [_bill("Rent", 3, 100.0, account_id=SALARY_ACCT, account_balance=20.0)]
    plan = _plan(monkeypatch, accounts=_accounts(20.0), bills=bills)
    assert plan["over_salary"]["over_pay"] is False and plan["over_salary"]["spare"] == 0
    assert plan["body"] == (
        "These moves add up to £200, but Salary Account has nothing to spare "
        "after what it keeps for its own bills. £330 would need to come from other accounts."
    )
