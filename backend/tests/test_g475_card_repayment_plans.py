"""G475: card repayment plans.

A plan is a commitment whose target is a card. These tests pin the rule that
matters most (a card with a plan has exactly ONE repayment, the plan) and the
write, prefill and read paths around it. No database: fake collections, invented
names and amounts. The end-to-end Left to spend figures are pinned by the three
g475-* scenarios in tests/scenarios.
"""
import asyncio
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.db.collections as dbc
import app.routers.allocations as allocations
import app.routers.commitments as commitments
import app.services.account_plan_sources as sources
import app.services.card_repayment_plans as crp
import app.services.companion as companion
import app.services.debt_plan as debt_plan
import app.services.plan_fulfilment as pf
from app.core import timeutil
from app.services import goal_schedule
from app.services.allocation_shortfall import compute_allocation_gaps
from tests.test_g176_account_plan_sources import _Collection

UID = "u"
OTHER = "someone-else"
TODAY = date(2026, 10, 12)
CFG = {"type": "calendar_month"}
RULE = {"match_type": "description_contains", "match_value": "20001"}


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(timeutil, "user_today", lambda *_: TODAY)
    monkeypatch.setattr(pf, "transactions_col", pf.transactions_col)
    monkeypatch.setattr(pf, "yapily_transactions_col", pf.yapily_transactions_col)


def _accounts(**overrides):
    accts = {
        "current": {"_id": "current", "type": "bank", "subtype": "CURRENT_ACCOUNT", "currency": "GBP",
                    "balance": 1500, "name": "Example Current", "provider": "barclays"},
        "card": {"_id": "card", "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP",
                 "balance": -600, "name": "Example Amex Alpha", "provider": "amex"},
        "card2": {"_id": "card2", "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP",
                  "balance": -400, "name": "Example Amex Beta", "provider": "amex"},
        "saving": {"_id": "saving", "type": "bank", "subtype": "SAVINGS_ACCOUNT", "currency": "GBP", "balance": 50},
        "usd": {"_id": "usd", "type": "bank", "subtype": "CURRENT_ACCOUNT", "currency": "USD", "balance": 10},
    }
    accts.update(overrides)
    return accts


def _schedule(pence=15000, start="2026-10-12", count=12, step=0):
    return {"type": "arithmetic", "start_pence": pence, "step_pence": step, "step_unit": "period",
            "start_date": start, "count": count, "end_date": None}


def _plan(**extra):
    doc = {"_id": ObjectId(), "user_id": UID, "name": "Example Amex Alpha repayment", "status": "active",
           "amount": 1800.0, "target_date": "2027-09-24", "funding_pots": [], "plan_kind": crp.PLAN_KIND,
           "card_account_id": "card", "source_account_id": "current", "schedule": _schedule(),
           "created_at": datetime(2026, 10, 1)}
    doc.update(extra)
    return doc


def _patch_world(monkeypatch, docs=(), accounts=None):
    col = _Collection(docs)
    monkeypatch.setattr(commitments, "commitments_col", col)
    monkeypatch.setattr(dbc, "commitments_col", col)
    monkeypatch.setattr(dbc, "preferences_col", _Rows([]))
    accts = accounts or _accounts()

    async def amap(uid):
        return dict(accts) if uid == UID else {}

    async def cfg(_): return CFG

    async def noop(*_a, **_k): return None

    async def serialised(uid, doc): return {"id": str(doc["_id"]), **{k: doc.get(k) for k in ("plan_kind", "card_account_id", "schedule", "source_account_id", "fill_rule", "amount", "target_date", "name")}}

    monkeypatch.setattr(sources, "owned_account_map", amap)
    monkeypatch.setattr(commitments, "owned_account_map", amap)
    monkeypatch.setattr(commitments, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments.response_cache, "ainvalidate", noop)
    monkeypatch.setattr(commitments, "_serialise_one_with_siblings", serialised)
    return col


def _create(body, uid=UID):
    return asyncio.run(commitments.create_commitment(body, request=None, user={"email": uid}))


def _bill(name, amount, card=None, **extra):
    return {"name": name, "amount": amount, "expected_date": "2026-10-24", "days_away": 12,
            "account_id": "current", "card_dest_account_id": card, **extra}


# ── replace, never double ────────────────────────────────────────────────────

def test_a_plan_removes_the_cards_learned_payment_and_keeps_everything_else():
    bills = [_bill("American Express 20001", 200, "card"), _bill("American Express 20002", 90, "card2"),
             _bill("COUNCIL TAX", 150), _bill("one-off", 40, "card", planned=True)]
    kept, dropped = crp.replace_planned_card_bills(bills, {"card"})
    assert [b["name"] for b in dropped] == ["American Express 20001"]
    assert [b["name"] for b in kept] == ["American Express 20002", "COUNCIL TAX", "one-off"]


def test_a_plan_removes_the_statement_estimate_for_that_card_only():
    statement = _bill("card-statement:card:2026-10-03", 450, "card", is_card_repayment=True)
    other = _bill("card-statement:card2:2026-10-03", 300, "card2", is_card_repayment=True)
    kept, dropped = crp.replace_planned_card_bills([statement, other], {"card"})
    assert dropped == [statement] and kept == [other]


def test_a_defined_payment_rule_attributes_a_learned_series_to_the_planned_card():
    # The learned series is mis-attributed to card2, but card's payment rule names it.
    bill = _bill("American Express 20001", 200, "card2")
    statements = {"card": {"payment_account_id": "current", "rule_series_keys": ["American Express 20001"]}}
    kept, dropped = crp.replace_planned_card_bills([bill], {"card"}, statements)
    assert dropped == [bill] and kept == []


def test_without_a_plan_nothing_changes():
    bills = [_bill("American Express 20001", 200, "card")]
    kept, dropped = crp.replace_planned_card_bills(bills, set())
    assert kept == bills and dropped == []


def test_only_a_live_plan_replaces_the_prediction(monkeypatch):
    live = _plan()
    paused = _plan(card_account_id="card2", paused=True)
    cancelled = _plan(card_account_id="card3", status="cancelled")
    not_a_card_plan = {"_id": ObjectId(), "user_id": UID, "status": "active", "name": "Japan", "funding_pots": []}
    _patch_world(monkeypatch, [live, paused, cancelled, not_a_card_plan])
    assert set(asyncio.run(crp.active_card_plans(UID))) == {"card"}


def test_a_finished_plan_stops_replacing_the_prediction(monkeypatch):
    # Three pay periods from 1 Jan 2025: long over by Oct 2026, so the card's usual payment counts again.
    ended = _plan(schedule=_schedule(start="2025-01-01", count=3))
    _patch_world(monkeypatch, [ended])
    assert asyncio.run(crp.active_card_plans(UID)) == {}
    # The last pay period it asks for still counts as live.
    live = _plan(schedule=_schedule(start="2026-08-12", count=3))  # periods of Aug, Sep, Oct
    _patch_world(monkeypatch, [live])
    assert set(asyncio.run(crp.active_card_plans(UID))) == {"card"}


def test_deleting_the_plan_restores_the_prediction(monkeypatch):
    plan = _plan()
    col = _patch_world(monkeypatch, [plan])
    bills = [_bill("American Express 20001", 200, "card")]
    plans = asyncio.run(crp.active_card_plans(UID))
    assert crp.replace_planned_card_bills(bills, set(plans))[0] == []
    col.docs[0]["status"] = "cancelled"  # what DELETE writes
    plans = asyncio.run(crp.active_card_plans(UID))
    assert plans == {}
    assert crp.replace_planned_card_bills(bills, set(plans))[0] == bills


# ── write path ───────────────────────────────────────────────────────────────

def test_create_a_plan_from_a_fixed_amount(monkeypatch):
    col = _patch_world(monkeypatch)
    out = _create({"card_account_id": "card", "source_account_id": "current", "amount_per_period": 150,
                   "start_date": "2026-10-12", "fill_rule": RULE})
    doc = col.docs[0]
    assert out["plan_kind"] == crp.PLAN_KIND and doc["card_account_id"] == "card"
    assert doc["funding_pots"] == [] and doc["source_account_id"] == "current"
    assert doc["name"] == "Example Amex Alpha repayment"
    # 600 owed at 150 a period is 4 payments before interest.
    assert doc["schedule"]["count"] == 4 and doc["schedule"]["step_pence"] == 0
    assert doc["amount"] == 600.0 and doc["fill_rule"] == RULE


def test_only_one_active_plan_per_card(monkeypatch):
    _patch_world(monkeypatch, [_plan()])
    with pytest.raises(HTTPException) as err:
        _create({"card_account_id": "card", "source_account_id": "current", "amount_per_period": 100})
    assert err.value.status_code == 409
    # A different card is fine, and a cancelled plan frees its card.
    _patch_world(monkeypatch, [_plan(status="cancelled")])
    assert _create({"card_account_id": "card", "source_account_id": "current", "amount_per_period": 100})["plan_kind"] == crp.PLAN_KIND


def test_the_card_must_be_the_users_own_card(monkeypatch):
    _patch_world(monkeypatch)
    with pytest.raises(HTTPException) as err:
        _create({"card_account_id": "card", "source_account_id": "current", "amount_per_period": 100}, uid=OTHER)
    assert err.value.status_code == 404
    for not_a_card in ("current", "saving", "missing"):
        with pytest.raises(HTTPException) as err:
            _create({"card_account_id": not_a_card, "source_account_id": "current", "amount_per_period": 100})
        assert err.value.status_code == 404


def test_the_paying_account_must_be_an_eligible_account_of_the_user(monkeypatch):
    _patch_world(monkeypatch)
    for bad in ("card2", "usd", "someone-elses-account", "", None):
        body = {"card_account_id": "card", "amount_per_period": 100}
        if bad is not None:
            body["source_account_id"] = bad
        with pytest.raises(HTTPException) as err:
            _create(body)
        assert err.value.status_code in (400, 422)


def test_a_plan_has_no_savings_pot_and_needs_an_amount_or_schedule(monkeypatch):
    _patch_world(monkeypatch)
    with pytest.raises(HTTPException) as err:
        _create({"card_account_id": "card", "source_account_id": "current", "amount_per_period": 100,
                 "funding_pots": [{"account_id": "saving"}]})
    assert err.value.status_code == 400
    with pytest.raises(HTTPException) as err:
        _create({"card_account_id": "card", "source_account_id": "current"})
    assert err.value.status_code == 400


def test_any_schedule_type_can_be_submitted(monkeypatch):
    col = _patch_world(monkeypatch)
    rising = _schedule(pence=10000, step=500, count=6)
    _create({"card_account_id": "card", "source_account_id": "current", "schedule": rising})
    assert col.docs[0]["schedule"]["step_pence"] == 500
    assert col.docs[0]["amount"] == sum(100 + 5 * i for i in range(6))


def test_the_card_of_a_plan_cannot_be_changed_and_it_stays_scheduled(monkeypatch):
    plan = _plan()
    _patch_world(monkeypatch, [plan])
    for body in ({"card_account_id": "card2"}, {"funding_pots": [{"account_id": "saving"}]}, {"schedule": None},
                 {"schedule": {"type": "equal"}}):
        with pytest.raises(HTTPException) as err:
            asyncio.run(commitments.update_commitment(str(plan["_id"]), body, {"email": UID}))
        assert err.value.status_code == 400


# ── prefill ──────────────────────────────────────────────────────────────────

class _Rows:
    def __init__(self, docs=()): self.docs = [dict(d) for d in docs]

    def find(self, query, *args):
        def ok(d):
            for key, want in query.items():
                if isinstance(want, dict):
                    if "$in" in want and d.get(key) not in want["$in"]:
                        return False
                    if "$gte" in want and not d.get(key) >= want["$gte"].replace(tzinfo=None):
                        return False
                elif d.get(key) != want:
                    return False
            return True
        cursor = SimpleNamespace()

        async def to_list(_): return [dict(d) for d in self.docs if ok(d)]
        cursor.to_list = to_list
        return cursor

    async def find_one(self, query, *args):
        rows = await self.find(query).to_list(None)
        return rows[0] if rows else None


def _patch_prefill(monkeypatch, series=(), terms=None, debits=(), statement=None, plans=()):
    _patch_world(monkeypatch, plans)
    monkeypatch.setattr(dbc, "card_terms_col", _Rows([terms] if terms else []))
    monkeypatch.setattr(dbc, "cashflow_cache_col", _Rows([{"_id": UID, "recurring_spend": list(series)}]))
    monkeypatch.setattr(dbc, "transactions_col", _Rows(debits))
    monkeypatch.setattr(dbc, "yapily_transactions_col", _Rows())

    async def bills(uid, **_): return {"card": statement} if statement else {}
    import app.services.card_statements as card_statements
    monkeypatch.setattr(card_statements, "load_statement_bills", bills)


def _series(**extra):
    return {"key": "American Express 20001", "avg_amount": 200.0, "avg_interval": 30, "next_date": "2026-10-24",
            "account_id": "current", "category": "Debt", "card_dest_account_id": "card", **extra}


def _debit(day, amount=200.0, desc="AMERICAN EXPRESS 3799-111111-20001"):
    return {"user_id": UID, "account_id": "current", "transaction_type": "debit", "amount": amount,
            "date": datetime.combine(day, datetime.min.time()), "description": desc, "merchant_name": "American Express"}


def test_prefill_returns_the_detected_account_amount_start_and_rule(monkeypatch):
    _patch_prefill(monkeypatch, series=[_series()], debits=[_debit(date(2026, 9, 24))])
    out = asyncio.run(crp.prefill(UID, "card", TODAY))
    assert out["source_account_id"] == "current" and out["source_account_name"] == "Example Current"
    assert out["amount"] == 200.0 and out["amount_basis"] == "direct_debit" and out["estimated"] is True
    assert out["tracking_start"] == "2026-10-24" and out["start_is_detected"] is True
    # The rule is the card's own reference tail, never the whole card number.
    assert out["fill_rule"] == {"match_type": "description_contains", "match_value": "20001"}
    assert out["balance_owed"] == 600.0
    assert out["schedule"]["count"] == 3 and out["schedule"]["start_date"] == "2026-10-24"
    assert out["existing_plan_id"] is None and out["detected"] is True


def test_prefill_prefers_the_cards_saved_payment_details(monkeypatch):
    statement = {"status": "estimated", "payment_amount": 450.0, "payment_method": "full",
                 "payment_due": "2026-10-28", "payment_account_id": "current"}
    terms = {"user_id": UID, "account_id": "card", "payment_account_id": "current",
             "payment_match": {"kind": "contains", "text": "3799-111111-20001"}}
    _patch_prefill(monkeypatch, series=[_series(next_date="2026-10-24")], terms=terms, statement=statement,
                   debits=[_debit(date(2026, 9, 24))])
    out = asyncio.run(crp.prefill(UID, "card", TODAY))
    assert out["amount"] == 450.0 and out["amount_basis"] == "statement_estimate" and out["estimated"] is True
    assert out["fill_rule"]["match_value"] == "20001"  # a saved full number is cut to its last five digits


def test_prefill_is_empty_when_nothing_is_detected(monkeypatch):
    _patch_prefill(monkeypatch)
    out = asyncio.run(crp.prefill(UID, "card", TODAY))
    assert out["source_account_id"] is None and out["amount"] is None and out["amount_basis"] is None
    assert out["fill_rule"] is None and out["schedule"] is None and out["detected"] is False
    assert out["start_is_detected"] is False and out["tracking_start"] == TODAY.isoformat()


def test_prefill_ignores_another_cards_series_and_other_users_cards(monkeypatch):
    _patch_prefill(monkeypatch, series=[_series(card_dest_account_id="card2")])
    assert asyncio.run(crp.prefill(UID, "card", TODAY))["amount"] is None
    assert asyncio.run(crp.prefill(OTHER, "card", TODAY)) is None
    assert asyncio.run(crp.prefill(UID, "current", TODAY)) is None  # not a card


def test_prefill_names_an_existing_plan(monkeypatch):
    plan = _plan()
    _patch_prefill(monkeypatch, series=[_series()], plans=[plan])
    assert asyncio.run(crp.prefill(UID, "card", TODAY))["existing_plan_id"] == str(plan["_id"])


# ── the plan is the reserve: Upcoming, paid this period, cover moves ─────────

def _txn_rows(docs):
    class T(_Rows):
        def find(self, query, *args):
            lo, hi = query["date"]["$gte"], query["date"]["$lte"]
            keep = [d for d in self.docs if d["user_id"] == query["user_id"] and d["account_id"] in query["account_id"]["$in"]
                    and d["transaction_type"] == query["transaction_type"] and lo <= d["date"] <= hi]
            cursor = SimpleNamespace()

            async def to_list(_): return [dict(d) for d in keep]
            cursor.to_list = to_list
            return cursor
    return T(docs)


def _rows(monkeypatch, plan, txns=None):
    monkeypatch.setattr(allocations, "allocations_col", _Collection())
    monkeypatch.setattr(allocations, "commitments_col", _Collection([plan]))
    monkeypatch.setattr(commitments, "commitments_col", _Collection([plan]))
    monkeypatch.setattr(pf, "transactions_col", txns or _txn_rows([]))
    monkeypatch.setattr(pf, "yapily_transactions_col", _txn_rows([]))
    accts = _accounts()

    async def amap(_): return accts
    async def cfg(_): return CFG
    async def ledger(uid, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}
    monkeypatch.setattr(allocations, "owned_account_map", amap)
    monkeypatch.setattr(sources, "owned_account_map", amap)
    monkeypatch.setattr(allocations, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    return asyncio.run(allocations.list_account_plans({"email": UID}))["items"]


def test_the_plan_reserves_this_periods_amount_at_its_paying_account(monkeypatch):
    rows = _rows(monkeypatch, _plan())
    assert len(rows) == 1
    row = rows[0]
    assert row["remaining"] == 150.0 and row["period_amount"] == 150.0
    assert row["source_account_id"] == "current" and row["source_basis"] == "chosen"
    assert row["destination"] == "Example Amex Alpha"


def test_switching_to_a_fixed_amount_changes_what_upcoming_reserves(monkeypatch):
    rising = _plan(schedule=_schedule(pence=10000, step=2500, count=6))
    assert _rows(monkeypatch, rising)[0]["remaining"] == 100.0
    fixed = _plan(schedule=_schedule(pence=20000, count=6))
    assert _rows(monkeypatch, fixed)[0]["remaining"] == 200.0


def test_a_payment_made_this_period_reduces_the_reserve_and_is_not_counted_again(monkeypatch):
    plan = _plan(fill_rule=RULE, schedule=_schedule(start="2026-10-05"))
    txns = _txn_rows([_debit(date(2026, 10, 8), 60.0), _debit(date(2026, 9, 24), 200.0)])
    row = _rows(monkeypatch, plan, txns)[0]
    # 150 planned, 60 paid on 8 Oct; the 24 Sep payment is before the plan's start and counts nothing.
    assert row["remaining"] == 90.0 and row["filled_amount"] == 60.0 and row["period_amount"] == 150.0


def test_a_payment_already_linked_to_the_card_reduces_the_reserve_without_a_rule(monkeypatch):
    plan = _plan(schedule=_schedule(start="2026-10-05"))  # no tracking rule at all
    linked = {**_debit(date(2026, 10, 8), 60.0, desc="BANK TRANSFER 8 OCT"),
              "own_transfer_match": {"card_repayment": {"issuer": "amex", "card_account_id": "card"}}}
    other_card = {**_debit(date(2026, 10, 9), 25.0, desc="BANK TRANSFER 9 OCT"),
                  "own_transfer_match": {"card_repayment": {"issuer": "amex", "card_account_id": "card2"}}}
    plain = _debit(date(2026, 10, 10), 30.0, desc="SUPERMARKET")
    row = _rows(monkeypatch, plan, _txn_rows([linked, other_card, plain]))[0]
    assert row["filled_amount"] == 60.0 and row["remaining"] == 90.0


def test_the_cover_move_engine_uses_the_plan_amount(monkeypatch):
    row = _rows(monkeypatch, _plan(schedule=_schedule(pence=20000)))[0]
    # 120 left in the paying account against a 200 plan: short by 80.
    gaps = compute_allocation_gaps([row], {"current": 120.0}, movement_out={}, require_allocation=False)
    assert [g["gap"] for g in gaps] == [80.0]
    paid = compute_allocation_gaps([{**row, "remaining": 0.0}], {"current": 120.0}, movement_out={}, require_allocation=False)
    assert paid == []


def test_the_payday_plan_reserves_the_plan_amount_at_its_source(monkeypatch):
    plan = _plan(schedule=_schedule(pence=20000))
    monkeypatch.setattr(dbc, "commitments_col", _Collection([plan]))
    monkeypatch.setattr(commitments, "commitments_col", _Collection([plan]))
    accts = _accounts()
    slices = asyncio.run(companion._goal_source_slices(UID, CFG, {}, "current", accts))
    assert [(s["source"], s["amount"], s["to"], s["assumed"]) for s in slices] == [("current", 200.0, [], False)]
    assert asyncio.run(companion._reserved_for_goals(UID, CFG, {}, "current", accts, slices=slices)) == {"current": 200.0}


# ── debt plan: would clear by ────────────────────────────────────────────────

def test_the_debt_plan_walk_follows_the_plan_and_pays_nothing_after_it_ends():
    months = crp.plan_month_amounts(_schedule(pence=15000, count=4, start="2026-10-12"), CFG, TODAY, 24)
    # 12 Oct and 1 Nov both fall before the walk's month 1 (1 Nov) ends, then 1 Dec and 1 Jan.
    assert months[1] == 300.0 and months[2] == 150.0 and months[3] == 150.0 and months[4] == 0.0
    assert months[24] == 0.0
    walk = debt_plan._amortise(600.0, 999.0, TODAY, [], predicted_by_month=months)
    assert walk["months_to_payoff"] == 3  # never the 999 movement the plan replaced
    short = crp.plan_month_amounts(_schedule(pence=15000, count=2), CFG, TODAY, debt_plan.HORIZON_MONTHS)
    assert debt_plan._amortise(600.0, 999.0, TODAY, [], predicted_by_month=short)["payoff_month"] is None


def test_the_plan_row_carries_a_hedged_clear_by_month_and_the_offer_fact(monkeypatch):
    plan = _plan()
    monkeypatch.setattr(commitments, "commitments_col", _Collection([plan]))
    terms = {"user_id": UID, "account_id": "card", "promos": [
        {"kind": "balance_transfer", "until": "2027-01-31", "apr_pct": 0, "balance": 450.0},
    ]}
    monkeypatch.setattr(dbc, "card_terms_col", _Rows([terms]))

    async def cached(uid):
        return {"cards": [{"account_id": "card", "name": "Example Amex Alpha", "debt": 600.0, "payoff_month": "2027-02"}]}
    monkeypatch.setattr(commitments, "get_debt_plan_cached", cached)
    item = {"fulfilment": {"expected_pence": 15000, "matched_pence": 6000}, "this_period_amount": 150.0}
    asyncio.run(commitments._attach_card_plans(UID, [item], [plan], CFG, TODAY))
    facts = item["card_plan"]
    assert facts["would_clear_by"] == "Feb 2027" and facts["paid_this_period"] == 60.0
    assert facts["this_period_planned"] == 150.0
    # 12 Oct, 1 Nov, 1 Dec and 1 Jan fall on or before 31 Jan: 600 against a 450 offer.
    promo = facts["promo"]
    assert promo["until"] == "2027-01-31" and promo["balance"] == 450.0 and promo["balance_is_offer"] is True
    assert promo["planned_by_end"] == 600.0 and promo["clears_before_end"] is True
    short = _plan(schedule=_schedule(pence=10000))
    item2 = {"fulfilment": None, "this_period_amount": 100.0}
    asyncio.run(commitments._attach_card_plans(UID, [item2], [short], CFG, TODAY))
    # 4 x 100 reaches 400 by 31 Jan, short of the 450 on the offer.
    assert item2["card_plan"]["promo"]["planned_by_end"] == 400.0 and item2["card_plan"]["promo"]["clears_before_end"] is False


def test_a_card_plan_is_never_eased(monkeypatch):
    plan = _plan()
    with pytest.raises(HTTPException) as err:
        commitments._require_active(plan)
    assert err.value.status_code == 409
    info = {"usual_slice": 150, "eased_this_period": None, "remaining": 600, "scheduled_later_pence": 15000}
    fields = commitments._ease_fields(plan, CFG, info, TODAY)
    assert fields["ease_blocked_reason"] == "A card repayment plan changes when you edit its schedule."
