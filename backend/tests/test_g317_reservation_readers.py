"""G317: every reservation reader keeps an intended contribution's pennies."""
import asyncio
from copy import deepcopy
from datetime import date, timedelta

import app.db.collections as collections
import app.routers.analytics as analytics
import app.routers.allocations as allocations
import app.routers.commitments as commitments
import app.services.companion as companion
from tests.test_cashflow_live_balance_overlay import UID as CASH_UID, _fixture
from tests.test_commitments_a86 import _FakeCursor, _doc
from tests.test_g317_goal_contribution import GoalCol, USER, setup
from tests.test_g176_account_plan_sources import _accounts, _Collection


def run(awaitable):
    return asyncio.run(awaitable)


class ProjectionGoalCol(GoalCol):
    """A Mongo-shaped projection fake: omitted fields must not reach readers."""

    required_projection = {
        "name", "amount", "target_date", "funding_pots", "contributed",
        "created_at", "user_id", "paused", "period_eased",
        "period_contributions", "source_account_id", "source_unset", "fill_rule",
    }

    def find(self, query=None, projection=None):
        if projection is None:
            return super().find(query)
        assert projection is not None
        assert self.required_projection <= {key for key, included in projection.items() if included}
        docs = []
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in (query or {}).items()):
                # Mongo includes `_id` unless it is explicitly excluded.
                picked = {"_id": doc["_id"]}
                picked.update({key: deepcopy(doc[key]) for key, included in projection.items()
                               if included and key in doc})
                docs.append(picked)
        return _FakeCursor(docs)


def _manual_goal(name, pence, *, paused=False):
    return _doc(
        name,
        amount=300.0,
        target_date="2027-01-01",
        paused=paused,
        funding_pots=[{"account_id": "pot", "baseline": 0, "count_existing": False}],
        period_contributions={"2026-11-30": {"contribution_pence": pence}},
        source_account_id="current",
        source_unset=False,
        fill_rule={"match_type": "description_contains", "match_value": name},
    )


def test_companion_reads_decimal_manual_slices_from_its_mongo_projection(monkeypatch):
    """The payday-plan reader imports its collection locally, so exercise that
    projection as well as the shared slice resolver rather than a stub."""
    first = _manual_goal("Japan", 10025)
    second = _manual_goal("Kitchen", 5020)
    paused = _manual_goal("Paused", 9999, paused=True)
    col = ProjectionGoalCol([first, second, paused])
    monkeypatch.setattr(collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: date(2026, 11, 1))
    monkeypatch.setattr(companion.timeutil, "user_today", lambda: date(2026, 11, 1))

    async def ledger(_uid, *, docs=None, balances=None):
        return {"commitments": {
            str(doc["_id"]): {"total_claimed": 0.0, "claims": {}}
            for doc in docs or []
        }}

    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    result = run(companion._active_commitment_slices(
        USER["email"], {"type": "calendar_month"}, {"pot": 0.0},
    ))

    assert result == {"pot": {"slice_total": 150.45, "names": ["Japan", "Kitchen", "Paused"]}}


def test_shared_pot_manual_overrides_do_not_create_progress_or_lose_pennies(monkeypatch):
    """The ledger may divide one pot between goals, but intended contributions
    are reservations only and must retain their independent decimal totals."""
    first = _manual_goal("Japan", 10025)
    second = _manual_goal("Kitchen", 5020)
    col = ProjectionGoalCol([first, second])
    monkeypatch.setattr(collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: date(2026, 11, 1))

    async def pay_config(_uid):
        return {"type": "calendar_month"}

    async def no_payment(*_args, **_kwargs):
        return None

    monkeypatch.setattr(commitments, "_pay_cfg", pay_config)
    monkeypatch.setattr(commitments, "_plan_fulfilment", no_payment)

    async def shared_ledger(_uid, *, docs=None, balances=None):
        # Both plans reference the same empty pot. A contribution must not
        # become fabricated saved progress merely because it is reserved.
        return {"commitments": {
            str(doc["_id"]): {"total_claimed": 0.0, "claims": {}}
            for doc in docs or []
        }}

    monkeypatch.setattr(commitments, "compute_pot_ledger", shared_ledger)
    total, count = run(commitments.total_reserved_slices(USER["email"]))
    assert (total, count) == (150.45, 2)
    for doc in (first, second):
        info = run(commitments._pot_progress_and_slice(
            doc, {"type": "calendar_month"},
            {"commitments": {str(doc["_id"]): {"total_claimed": 0.0, "claims": {}}}},
            date(2026, 11, 1),
        ))
        assert info["progress"] == 0


def test_upcoming_and_safe_to_spend_keep_decimal_plan_reserves(monkeypatch):
    _fixture(monkeypatch)

    async def reserved(_uid):
        return 100.25, 1

    monkeypatch.setattr(commitments, "total_reserved_slices", reserved)
    cash = run(analytics.get_cashflow({"email": CASH_UID}))
    sts = run(analytics.compute_safe_to_spend(CASH_UID))

    assert cash["plans_reserved"] == 100.25
    assert sts["commitments_reserved"] == 100.25


def test_account_working_reconciles_a_capped_total_after_a_matched_transfer(monkeypatch):
    doc, col = setup(monkeypatch, contributed=200, source_account_id="current",
        funding_pots=[{"account_id": "pot", "baseline": 0, "count_existing": False}],
        fill_rule={"match_type": "description_contains", "match_value": "Japan"},
        period_contributions={"2026-11-30": {"contribution_pence": 100000}})
    monkeypatch.setattr(allocations, "commitments_col", _Collection([doc]))
    monkeypatch.setattr(allocations, "allocations_col", _Collection())

    async def accounts(_uid):
        return {"current": _accounts()["current"], "pot": {**_accounts()["saving"], "balance": 0}}

    async def config(_uid):
        return {"type": "calendar_month"}

    async def matched(_doc, due, _start, _end, *, exact=False):
        assert due == 1000 and exact
        return {"state": "partial", "expected_pence": 100000, "matched_pence": 5000,
                "unmet": 950, "unmet_pence": 95000, "matched": []}

    monkeypatch.setattr(allocations, "owned_account_map", accounts)
    monkeypatch.setattr(allocations, "_pay_cfg", config)
    monkeypatch.setattr(commitments, "_plan_fulfilment", matched)
    row = run(allocations.list_account_plans(USER))["items"][0]
    assert row["record_id"] == str(doc["_id"])
    assert (row["period_amount"], row["filled_amount"], row["remaining"]) == (150, 50, 100)
    assert row["period_amount"] - row["filled_amount"] == row["remaining"]
    assert doc["contributed"] == 200  # the intention did not invent progress


def test_payday_plan_move_target_and_total_keep_the_chosen_pennies(monkeypatch):
    from tests.test_payday_plan_fixes import _base_patch, _account, _salary, _payday_plan, UID, SALARY_ACCT
    today = commitments.timeutil.user_today()
    pot = {**_account("pot", 0, "Japan savings"), "subtype": "SAVINGS_ACCOUNT"}
    pay_period, _ = _base_patch(monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000), pot], bills=[], income=[_salary(0, 2000)])
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda _day, _cfg: (today, today + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda _day, _cfg: today + timedelta(days=30))

    async def slices(*_args):
        return {"pot": {"slice_total": 100.25, "names": ["Japan"]}}

    monkeypatch.setattr(companion, "_active_commitment_slices", slices)
    plan = _payday_plan(run(companion.compute_today_items(UID, persist=False)))
    assert plan is not None
    dest = next(d for d in plan["dests"] if d["account_id"] == "pot")
    assert dest["move"] == dest["target"] == plan["total"] == 100.25
