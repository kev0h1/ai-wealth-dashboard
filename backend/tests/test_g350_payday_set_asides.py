"""G350 step 1 (Kevin, 2026-10-28): a recurring set-aside whose money is held
in a separate pot becomes a suggested payday move to that pot, worded and
sized like a goal leg. A set-aside kept in the paying account needs no move.

Rules pinned here:
  - existing-payment set-aside -> leg to its fill account; manual set-aside
    -> leg to its destination account; a manual one with no destination
    (kept in the paying account) and one whose destination IS the salary
    account get no leg.
  - the leg is a FLOOR on the destination's move (never lowered).
  - a pot that also receives a goal slice must cover BOTH (goal + set-aside
    summed), they are different pots of money going to the same account.
  - the salary account's own envelope reservation is added back to
    `distributable` for set-asides that became legs (no double count).
  - live plan uses `remaining`, preview uses `period_amount` (falls back to
    `amount_per_period`).
"""
import asyncio
from datetime import timedelta

import app.core.timeutil as timeutil
import app.services.companion as companion
from tests.test_payday_plan_fixes import (
    SALARY_ACCT, UID, _account, _base_patch, _payday_plan, _salary,
)

POT = "pot-monzo"


def _pot(balance=0.0):
    return {**_account(POT, balance, "Monzo pot"), "subtype": "SAVINGS_ACCOUNT"}


def _alloc(name="Saving Challenge", **kw):
    d = {
        "id": "al-" + name.replace(" ", "-").lower(), "name": name, "active": True,
        "completed": False, "pending": False, "recurrence": "every_period",
        "tracking_mode": "existing_payment", "fill_account_id": POT,
        "amount_per_period": 120.0, "period_amount": 120.0, "remaining": 120.0,
        "source_account_id": None,
    }
    d.update(kw)
    return d


def _run(monkeypatch, allocs, *, preview=False, salary_balance=3000.0, accounts=None,
         slices=None, derived_source=SALARY_ACCT, income=2000.0, extra_patch=None):
    today = timeutil.user_today()
    pay_period, _ = _base_patch(
        monkeypatch,
        accounts=accounts if accounts is not None else [_account(SALARY_ACCT, salary_balance), _pot()],
        bills=[], income=[_salary(0, income)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date",
                        lambda _d, _c: (today, today + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda _d, _c: today + timedelta(days=30))

    async def listed(_uid):
        return allocs

    async def source(_uid, _alloc, _inflows, _amap):
        # Like the real helper: no fill account, no learned source.
        return derived_source if _alloc.get("fill_account_id") else None

    async def goal_slices(*_a):
        return slices or {}

    monkeypatch.setattr(companion, "list_active_allocations", listed)
    monkeypatch.setattr(companion, "_allocation_funding_source", source)
    monkeypatch.setattr(companion, "_active_commitment_slices", goal_slices)
    if extra_patch:
        extra_patch(monkeypatch)
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=preview, persist=False))
    return _payday_plan(items)


def _dest(plan, acct):
    return next((d for d in plan["dests"] if d["account_id"] == acct), None)


def test_existing_payment_set_aside_becomes_a_leg_to_its_pot(monkeypatch):
    plan = _run(monkeypatch, [_alloc()])
    assert plan is not None
    d = _dest(plan, POT)
    assert d is not None
    assert d["allocation_names"] == ["Saving Challenge"]
    assert d["move"] == d["target"] == plan["total"] == 120


def test_leg_is_a_floor_a_larger_usual_is_not_lowered(monkeypatch):
    # A bills-owed pot with a bigger natural move keeps it: the leg is a floor.
    accounts = [_account(SALARY_ACCT, 3000.0), {**_account(POT, 0.0, "Monzo pot")}]
    plan = _run(monkeypatch, [_alloc(amount_per_period=20.0, period_amount=20.0, remaining=20.0)],
                accounts=accounts)
    d = _dest(plan, POT)
    assert d["allocation_names"] == ["Saving Challenge"]
    assert d["move"] >= 50  # spend-account buffer move stays, 20 does not lower it


def test_manual_set_aside_with_no_destination_gets_no_leg(monkeypatch):
    plan = _run(monkeypatch, [_alloc(tracking_mode="manual", fill_account_id="")])
    assert plan is not None
    assert _dest(plan, POT) is None or "allocation_names" not in _dest(plan, POT)


def test_manual_set_aside_with_a_destination_pot_gets_a_leg(monkeypatch):
    plan = _run(monkeypatch, [_alloc(tracking_mode="manual", fill_account_id="",
                                     destination_account_id=POT)])
    d = _dest(plan, POT)
    assert d["allocation_names"] == ["Saving Challenge"]
    assert d["move"] == 120


def test_set_aside_whose_destination_is_the_salary_account_gets_no_leg(monkeypatch):
    plan = _run(monkeypatch, [_alloc(fill_account_id=SALARY_ACCT)])
    assert plan is not None
    assert all("allocation_names" not in d for d in plan["dests"])
    assert plan["total"] == 0


def test_salary_account_stays_is_not_reduced_twice(monkeypatch):
    without = _run(monkeypatch, [])
    with_leg = _run(monkeypatch, [_alloc()])
    assert without["salary"]["stays"] - with_leg["salary"]["stays"] == 120


def test_set_aside_that_is_not_a_leg_keeps_its_salary_reservation(monkeypatch):
    # Kept in the paying account (no destination), reserved from the salary
    # account by the derived source: no leg, so the reservation stands.
    without = _run(monkeypatch, [])
    kept = _run(monkeypatch, [_alloc(tracking_mode="manual", fill_account_id="")])
    # Manual with no fill account is never reserved by the envelope code either.
    assert without["salary"]["stays"] == kept["salary"]["stays"]
    onto_salary = _run(monkeypatch, [_alloc(fill_account_id=SALARY_ACCT)])
    assert onto_salary["salary"]["stays"] == without["salary"]["stays"] - 120


def test_goal_and_set_aside_on_the_same_pot_are_summed(monkeypatch):
    plan = _run(monkeypatch, [_alloc()],
                slices={POT: {"slice_total": 200.0, "names": ["Japan"]}})
    d = _dest(plan, POT)
    assert d["commitment_names"] == ["Japan"]
    assert d["allocation_names"] == ["Saving Challenge"]
    assert d["move"] == d["target"] == plan["total"] == 320


def test_live_uses_remaining_and_preview_uses_period_amount(monkeypatch):
    allocs = [_alloc(remaining=70.0, period_amount=150.0, amount_per_period=200.0)]
    live = _run(monkeypatch, allocs)
    assert _dest(live, POT)["move"] == 70
    prev = _run(monkeypatch, allocs, preview=True)
    assert prev["preview"] is True
    assert _dest(prev, POT)["move"] == 150
    # Falls back to amount_per_period when period_amount is absent.
    no_period = [{k: v for k, v in _alloc(remaining=70.0, amount_per_period=200.0).items()
                  if k != "period_amount"}]
    assert _dest(_run(monkeypatch, no_period, preview=True), POT)["move"] == 200


def test_once_set_aside_only_counts_in_the_live_plan(monkeypatch):
    allocs = [_alloc(recurrence="once")]
    assert _dest(_run(monkeypatch, allocs), POT)["move"] == 120
    prev = _run(monkeypatch, allocs, preview=True)
    assert _dest(prev, POT) is None or "allocation_names" not in _dest(prev, POT)
