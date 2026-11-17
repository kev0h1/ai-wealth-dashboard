"""G475 follow-ups: a plan that has not started keeps the prediction, a cleared card
reserves nothing, Penny never calls a repayment plan a goal, the bill-due push skips
a card a plan replaced, and Upcoming rows carry the repayment flag. No database."""
import asyncio

import pytest

import app.db.collections as dbc
import app.routers.allocations as allocations
import app.routers.analytics as analytics
import app.routers.commitments as commitments
import app.services.card_repayment_plans as crp
import app.services.notifications as notifications
import app.services.penny_tools as penny_tools
from tests.test_g475_card_repayment_plans import (
    UID, _bill, _clock, _patch_world, _plan, _rows, _schedule,
)  # noqa: F401  (_clock is an autouse fixture)
from tests.test_notifications import FakeCashflowCacheCol, _bill as _nbill, _patch_common


@pytest.fixture(autouse=True)
def _owed(monkeypatch):
    async def owed(uid, card_id):
        return 600.0
    monkeypatch.setattr(crp, "owed_balance", owed)


def test_a_plan_whose_first_event_is_next_period_keeps_the_prediction(monkeypatch):
    # Calendar month, today 12 Oct: a first payment on 1 Nov asks for nothing this period.
    later = _plan(schedule=_schedule(start="2026-11-01"))
    _patch_world(monkeypatch, [later])
    assert asyncio.run(crp.active_card_plans(UID)) == {}
    bills = [_bill("American Express 20001", 200, "card")]
    assert crp.replace_planned_card_bills(bills, set())[0] == bills
    # Once the first event is in the current period it replaces the prediction.
    _patch_world(monkeypatch, [_plan(schedule=_schedule(start="2026-10-20"))])
    assert set(asyncio.run(crp.active_card_plans(UID))) == {"card"}


def _slice_with_owed(monkeypatch, owed, paid_rows=None):
    async def fake_owed(uid, card_id):
        return owed
    monkeypatch.setattr(crp, "owed_balance", fake_owed)
    return _rows(monkeypatch, _plan(), paid_rows)[0]["remaining"]


def test_a_card_paid_off_early_reserves_nothing(monkeypatch):
    assert _slice_with_owed(monkeypatch, 0.0) == 0.0


def test_a_small_remaining_balance_reserves_only_that_amount(monkeypatch):
    assert _slice_with_owed(monkeypatch, 42.5) == 42.5
    assert _slice_with_owed(monkeypatch, 600.0) == 150.0
    assert _slice_with_owed(monkeypatch, None) == 150.0  # an unreadable balance never hides the plan


def test_penny_goals_never_list_a_repayment_plan(monkeypatch):
    async def fake_list(user):
        return {"items": [
            {"id": "g", "name": "Japan", "status": "active", "amount": 1000, "progress": 100},
            {"id": "p", "name": "Example Amex Alpha repayment", "status": "active", "amount": 600,
             "progress": 0, "plan_kind": "card_repayment", "on_track": False, "feasibility": "stretch"},
        ]}
    monkeypatch.setattr(commitments, "list_commitments", fake_list)
    out = asyncio.run(penny_tools._exec_get_goals(UID))
    assert [g["name"] for g in out["goals"]] == ["Japan"]
    text = str(out).lower()
    assert "repayment" not in text and "amex" not in text


def test_penny_debt_position_carries_the_plan_as_a_repayment_plan(monkeypatch):
    plan = {"status": "ok", "totals": {}, "cards": [{
        "name": "Example Amex Alpha", "debt": 600.0, "movement": {}, "rate_schedule": [],
        "repayment_plan": {"schedule": "£150 a pay period", "next_payment": 150.0},
    }]}

    async def cached(uid):
        return plan
    monkeypatch.setattr(penny_tools, "get_debt_plan_cached", cached)
    card = asyncio.run(penny_tools._exec_get_debt_position(UID))["cards"][0]
    assert card["repayment_plan"]["next_payment"] == 150.0
    assert "goal" not in str(card["repayment_plan"]).lower() and "saving" not in str(card["repayment_plan"]).lower()


def test_no_bill_due_push_for_a_card_prediction_a_plan_replaced(monkeypatch):
    _state, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(dbc, "cashflow_cache_col", FakeCashflowCacheCol())
    amex = {**_nbill("American Express 20001", 2, 200.0, 10.0, "acc-bc"), "card_dest_account_id": "card"}
    tax = _nbill("Council Tax", 2, 50.0, 10.0, "acc-bc")

    async def fake_resp(cached):
        return {"upcoming_bills": [amex, tax]}
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    async def plans(uid):
        return {"card": _plan()}
    monkeypatch.setattr(crp, "active_card_plans", plans)
    names = [b["name"] for b in asyncio.run(notifications._maybe_bill_shortfall("kevin"))]
    assert names == ["Council Tax"]


def test_upcoming_rows_flag_a_repayment_plan(monkeypatch):
    rows = _rows(monkeypatch, _plan())
    assert rows[0]["kind"] == "goal" and rows[0]["plan_kind"] == "card_repayment"
    assert rows[0]["card_account_id"] == "card"
    assert rows[0]["destination"] == "Example Amex Alpha"


class _Cards:
    def __init__(self, doc): self.doc = doc
    async def find_one(self, query, *args): return dict(self.doc) if self.doc and query["user_id"] == "u" and query["_id"] == "card" else None


def _owed_for(monkeypatch, doc):
    monkeypatch.undo()  # use the real reader, not the autouse stub
    import app.db.collections as c
    monkeypatch.setattr(c, "accounts_col", _Cards(doc))
    monkeypatch.setattr(c, "yapily_accounts_col", _Cards(None))
    monkeypatch.setattr(c, "manual_accounts_col", _Cards(None))
    return asyncio.run(crp.owed_balance("u", "card"))


def test_owed_balance_never_turns_a_missing_balance_into_zero(monkeypatch):
    assert _owed_for(monkeypatch, {"_id": "card"}) is None
    assert _owed_for(monkeypatch, {"_id": "card", "balance": None}) is None
    assert _owed_for(monkeypatch, {"_id": "card", "balance": None, "current_balance": -80.0}) == 80.0
    assert _owed_for(monkeypatch, {"_id": "card", "available_balance": -5}) == 5.0
    assert _owed_for(monkeypatch, {"_id": "card", "balance": 0}) == 0.0
    assert _owed_for(monkeypatch, {"_id": "card", "balance": -600}) == 600.0


def test_a_card_with_no_balance_field_keeps_the_full_reserve(monkeypatch):
    async def none(uid, card_id): return None
    monkeypatch.setattr(crp, "owed_balance", none)
    assert _rows(monkeypatch, _plan())[0]["remaining"] == 150.0
