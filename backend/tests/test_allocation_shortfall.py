"""G217: set-aside (allocation) shortfall cards, kept apart from bill shortfalls.

Engine rule (pence, mirrors the account sheet's "more needed for plans"):
  gap = max(0, -(closing - reserved)) - max(0, -closing)
Raised on Home only at or above ALLOCATION_SHORTFALL_FLOOR_PENCE (500). Two
remedies, a move from an account that can safely spare it (the SAME finder the
bill cards use) or reducing the allocation for this period. The card ranks
below every payment card, and bill outputs are byte-identical with or without
set-asides.

Same in-memory fakes as test_cover_plan_account_eligibility.py (no mongomock).
"""
import asyncio
import json
from datetime import date, timedelta

import app.db.collections as db_collections
import app.services.companion as companion
from app.services.allocation_shortfall import compute_allocation_gaps, suggested_reduced_amount

from tests.test_cover_plan_account_eligibility import FakeCol, _account, _bill, UID


def _plan(rid, name, source, remaining, *, basis="chosen", kind="allocation",
          period=None, dest=("pot",), active=True):
    return {
        "id": f"{kind}:{rid}", "record_id": rid, "kind": kind, "name": name,
        "destination": "Pot", "destination_account_ids": list(dest),
        "source_account_id": source, "source_basis": basis,
        "period_amount": period if period is not None else remaining,
        "filled_amount": 0.0, "remaining": remaining, "active": active,
    }


def _run(monkeypatch, bills, plans, accounts, *, eligibility=None):
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda today_d, pay_cfg: (today_d - timedelta(days=10), today_d + timedelta(days=17)),
    )

    async def _no_reserve(uid, internal_inflows, account_map):
        return {}

    async def _plans(uid):
        return list(plans)

    monkeypatch.setattr(companion, "_reserved_for_allocations", _no_reserve)
    monkeypatch.setattr(companion, "_load_account_plans", _plans)
    monkeypatch.setattr(companion, "accounts_col", FakeCol(accounts))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([{"user_id": UID, "income_streams": []}]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    return asyncio.run(companion.compute_today_items(UID, persist=False, account_eligibility_out=eligibility))


def _types(items):
    return [i["type"] for i in items]


def _alloc(items):
    return next((i for i in items if i["type"] == "allocation_shortfall"), None)


def _accts():
    return [_account("cur", 100.0, name="Premier Current"), _account("sav", 1000.0, name="Savings", subtype="SAVINGS")]


def test_allocation_only_shortfall_attributes_to_the_allocation(monkeypatch):
    items = _run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0, period=200.0)], _accts())
    card = _alloc(items)
    assert card is not None and "move" not in _types(items)
    assert card["headline"] == "Your Holiday set-aside is short"
    assert card["body"] == "£50 short this period."
    data = card["allocation_shortfall"]
    assert data["shortfall"] == 50.0
    assert data["allocation"] == {"id": "a1", "name": "Holiday", "period_amount": 200.0, "suggested_amount": 150.0}
    assert data["paying_account"]["name"] == "Premier Current"
    assert card["action"] == {"label": "Move from Savings", "route": "/upcoming"}
    assert sum(m["amount"] for m in data["moves"]) >= 50
    assert data["moves"][0]["move_map"]["from"]["account_id"] == "sav"


def test_bill_plus_allocation_shortfall_bill_card_first(monkeypatch):
    accounts = [_account("cur", 50.0, name="Premier Current"), _account("sav", 1000.0, name="Savings", subtype="SAVINGS")]
    bills = [_bill("British Gas", 3, 100.0, "cur", 50.0)]
    items = _run(monkeypatch, bills, [_plan("a1", "Holiday", "cur", 30.0)], accounts)
    kinds = _types(items)
    assert "move" in kinds and "allocation_shortfall" in kinds
    assert kinds.index("move") < kinds.index("allocation_shortfall")
    # Attributed to the set-aside only: the £50 bill gap is not in the figure.
    assert _alloc(items)["allocation_shortfall"]["shortfall"] == 30.0


def test_below_floor_raises_no_card_but_the_gap_exists(monkeypatch):
    plans = [_plan("a1", "Holiday", "cur", 100.06)]
    items = _run(monkeypatch, [], plans, _accts())
    assert _alloc(items) is None
    # The account sheet derives the same 6p from the same arithmetic.
    gaps = compute_allocation_gaps(plans, {"cur": 100.0}, floor_pence=1)
    assert [g["gap_pence"] for g in gaps] == [6]
    assert compute_allocation_gaps(plans, {"cur": 100.0}) == []


def test_exactly_five_pounds_raises_a_card(monkeypatch):
    items = _run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 105.0)], _accts())
    assert _alloc(items)["allocation_shortfall"]["shortfall"] == 5.0


def test_no_viable_source_offers_reduce_only(monkeypatch):
    items = _run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0, period=200.0)], [_account("cur", 100.0)])
    card = _alloc(items)
    assert card["action"] is None
    assert card["allocation_shortfall"]["moves"] == []
    assert card["allocation_shortfall"]["allocation"]["suggested_amount"] == 150.0


def test_partial_source_is_not_offered_and_capacity_is_handed_back(monkeypatch):
    accounts = [_account("cur", 100.0), _account("sav", 30.0, name="Savings", subtype="SAVINGS")]
    items = _run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0)], accounts)
    card = _alloc(items)
    assert card["action"] is None and card["allocation_shortfall"]["moves"] == []


def test_estimated_paying_account_is_flagged(monkeypatch):
    est = _alloc(_run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0, basis="recent-transfers")], _accts()))
    known = _alloc(_run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0, basis="chosen")], _accts()))
    assert est["estimated"] is True and est["allocation_shortfall"]["estimated"] is True
    assert known["estimated"] is False and known["allocation_shortfall"]["estimated"] is False


def test_goal_only_gap_raises_nothing(monkeypatch):
    plans = [_plan("g1", "House", "cur", 500.0, kind="goal")]
    assert _alloc(_run(monkeypatch, [], plans, _accts())) is None


def test_goal_counts_towards_the_gap_when_an_allocation_is_also_assigned(monkeypatch):
    plans = [_plan("a1", "Holiday", "cur", 40.0), _plan("g1", "House", "cur", 100.0, kind="goal", dest=("house",))]
    assert _alloc(_run(monkeypatch, [], plans, _accts()))["allocation_shortfall"]["shortfall"] == 40.0


def test_two_allocations_one_card_targets_the_largest(monkeypatch):
    plans = [_plan("a1", "Holiday", "cur", 80.0, dest=("p1",)), _plan("a2", "Car", "cur", 120.0, dest=("p2",))]
    card = _alloc(_run(monkeypatch, [], plans, _accts()))
    assert card["headline"] == "Your set-asides at Premier Current are short"
    assert card["allocation_shortfall"]["allocation"]["id"] == "a2"
    assert card["allocation_shortfall"]["other_allocation_count"] == 1
    assert card["allocation_shortfall"]["shortfall"] == 100.0


def test_shared_pot_and_forecast_transfer_stay_quiet():
    shared = [_plan("a1", "A", "cur", 150.0), _plan("a2", "B", "cur", 150.0)]
    assert compute_allocation_gaps(shared, {"cur": 100.0}) == []
    one = [_plan("a1", "A", "cur", 150.0)]
    assert compute_allocation_gaps(one, {"cur": 100.0}, movement_out={"cur": ["pot"]}) == []
    assert compute_allocation_gaps(one, {"cur": 100.0}, movement_out={"cur": ["other"]})[0]["gap"] == 50.0


def test_unreadable_amount_and_inactive_plans_say_nothing():
    bad = [_plan("a1", "A", "cur", float("nan"))]
    assert compute_allocation_gaps(bad, {"cur": 0.0}) == []
    off = [_plan("a1", "A", "cur", 150.0, active=False)]
    assert compute_allocation_gaps(off, {"cur": 0.0}) == []


def test_unassigned_source_is_ignored():
    plans = [_plan("a1", "A", None, 150.0), _plan("a2", "B", "cur", 150.0, basis="unknown")]
    assert compute_allocation_gaps(plans, {"cur": 0.0}) == []


def test_suggested_amount_never_below_a_penny():
    assert suggested_reduced_amount({"remaining": 50.0, "period_amount": 50.0}, 80.0) == 0.01
    assert suggested_reduced_amount({"remaining": 150.0, "period_amount": 200.0}, 50.0) == 150.0


def test_dismissed_for_this_period_stays_hidden(monkeypatch):
    first = _alloc(_run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0)], _accts()))

    async def _dismissed(uid):
        return {first["id"]}

    monkeypatch.setattr(companion, "_get_dismissed", _dismissed)
    assert _alloc(_run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0)], _accts())) is None


def test_lockstep_bill_outputs_are_byte_identical_with_and_without_set_asides(monkeypatch):
    accounts = [_account("cur", 50.0, name="Premier Current"), _account("sav", 1000.0, name="Savings", subtype="SAVINGS")]
    bills = [_bill("British Gas", 3, 100.0, "cur", 50.0)]
    elig_without, elig_with = {}, {}
    without = _run(monkeypatch, bills, [], accounts, eligibility=elig_without)
    with_plans = _run(monkeypatch, bills, [_plan("a1", "Holiday", "cur", 30.0)], accounts, eligibility=elig_with)
    pick = lambda items: json.dumps([i for i in items if i["type"] != "allocation_shortfall"], sort_keys=True, default=str)
    assert pick(without) == pick(with_plans)
    assert elig_without == elig_with
    assert _alloc(without) is None and _alloc(with_plans) is not None


def test_source_is_the_bill_engines_finder_not_a_second_ranking(monkeypatch):
    """A current account outranks savings in the shared finder, even with less headroom."""
    accounts = [
        _account("cur", 100.0, name="Premier Current"),
        _account("cur2", 400.0, name="Everyday", provider="hsbc"),
        _account("sav", 5000.0, name="Savings", subtype="SAVINGS"),
    ]
    card = _alloc(_run(monkeypatch, [], [_plan("a1", "Holiday", "cur", 150.0)], accounts))
    assert card["allocation_shortfall"]["moves"][0]["move_map"]["from"]["account_id"] == "cur2"
    assert card["action"]["label"] == "Move from Everyday"
