"""G256: a goal plan's fill rule, fulfilment by a matched OUTGOING transfer,
reservation release, partial match, the suggested rule, user scoping.

No database: fake transaction collections, monkeypatched account map.
"""
import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.routers.commitments as commitments
import app.services.account_plan_sources as sources
import app.services.plan_fulfilment as pf
from app.core import timeutil
from app.services.pay_period import get_pay_period_for_date
from tests.test_g176_account_plan_sources import _Collection, _accounts

UID = "u"
CFG = {"type": "calendar_month"}
RULE = {"match_type": "description_contains", "match_value": "Japan pot"}


class _Txns:
    def __init__(self, docs=()):
        self.docs = list(docs)

    def find(self, query, *args):
        def ok(d):
            if d.get("user_id") != query["user_id"]:
                return False
            if d.get("transaction_type") != query["transaction_type"]:
                return False
            if d.get("account_id") not in query["account_id"]["$in"]:
                return False
            lo, hi = query["date"]["$gte"], query["date"]["$lte"]
            return lo <= d["date"] <= hi
        cursor = SimpleNamespace()

        async def to_list(_):
            return [dict(d) for d in self.docs if ok(d)]
        cursor.to_list = to_list
        return cursor


def _day(offset=0):
    return datetime.combine(timeutil.user_today() + timedelta(days=offset), datetime.min.time())


def _debit(amount, desc="To Japan pot", offset=0, account="current", user=UID, kind="debit"):
    return {"user_id": user, "account_id": account, "transaction_type": kind,
            "amount": amount, "date": _day(offset), "description": desc}


def _credit(amount, offset=0, account="saving"):
    return _debit(amount, "From current", offset, account, kind="credit")


def _goal(**extra):
    return {"_id": ObjectId(), "user_id": UID, "name": "Japan", "status": "active",
            "amount": 1000, "target_date": (timeutil.user_today() + timedelta(days=400)).isoformat(),
            "funding_pots": [{"account_id": "saving", "baseline": 0, "count_existing": False}],
            "source_account_id": "current", **extra}


def _period():
    return get_pay_period_for_date(timeutil.user_today(), CFG)


def _run(docs, slice_due=80, goal=None):
    pf.transactions_col = _Txns(docs)
    pf.yapily_transactions_col = _Txns()
    start, end = _period()
    goal = goal or _goal(fill_rule=RULE)
    return asyncio.run(pf.period_fulfilment(UID, goal, slice_due, "current", start, end))


@pytest.fixture(autouse=True)
def _restore(monkeypatch):
    monkeypatch.setattr(pf, "transactions_col", pf.transactions_col)
    monkeypatch.setattr(pf, "yapily_transactions_col", pf.yapily_transactions_col)


# ── rule validation: identical to the allocation rule ───────────────────────

def test_rule_validation_matches_the_allocation_rule():
    assert pf.validate_fill_rule(None) is None
    assert pf.validate_fill_rule({"match_type": "description_equals", "match_value": " Japan "}) == \
        {"match_type": "description_equals", "match_value": "Japan"}
    assert len(pf.validate_fill_rule({"match_type": "description_contains", "match_value": "x" * 500})["match_value"]) == 80
    for bad in ("text", {"match_type": "category", "match_value": "x"},
                {"match_type": "description_contains", "match_value": "  "},
                {"match_type": "description_contains"}):
        with pytest.raises(HTTPException) as e:
            pf.validate_fill_rule(bad)
        assert e.value.status_code == 400


# ── fulfilment on a matched OUTGOING transfer ───────────────────────────────

def test_contains_match_fulfils_and_releases_the_slice():
    r = _run([_debit(80)])
    assert r["state"] == "fulfilled" and r["unmet"] == 0
    assert r["matched_pence"] == 8000 and r["matched"][0]["amount"] == 80


def test_equals_match_is_exact_and_case_insensitive():
    goal = _goal(fill_rule={"match_type": "description_equals", "match_value": "to japan POT"})
    assert _run([_debit(80)], goal=goal)["state"] == "fulfilled"
    assert _run([_debit(80, desc="To Japan pot 2")], goal=goal)["state"] == "unmet"


def test_no_match_stays_unmet_and_keeps_the_full_reservation():
    r = _run([_debit(80, desc="Tesco")])
    assert r["state"] == "unmet" and r["unmet"] == 80


def test_destination_rise_alone_never_fulfils():
    r = _run([_credit(80)])
    assert r["state"] == "unmet" and r["unmet"] == 80 and r["seen_in_sink"] is False


def test_sink_rise_is_confirmation_only():
    r = _run([_debit(80), _credit(80)])
    assert r["state"] == "fulfilled" and r["seen_in_sink"] is True
    assert _run([_debit(80)])["seen_in_sink"] is False


def test_credits_into_the_source_do_not_count_as_the_outgoing_transfer():
    assert _run([_debit(80, kind="credit")])["state"] == "unmet"


def test_other_account_other_user_and_other_period_are_ignored():
    start, _ = _period()
    before = (datetime.combine(start, datetime.min.time()) - timedelta(days=1) - _day(0)).days
    r = _run([_debit(80, account="other"), _debit(80, user="someone-else"), _debit(80, offset=before)])
    assert r["state"] == "unmet"


# ── tolerance edges: 85% of the slice (15%, G235) ───────────────────────────

@pytest.mark.parametrize("paid,state", [(68.0, "fulfilled"), (67.99, "partial"), (80.0, "fulfilled"),
                                        (120.0, "fulfilled"), (0.01, "partial")])
def test_tolerance_edges(paid, state):
    assert _run([_debit(paid)], slice_due=80)["state"] == state


def test_assess_pure_edges():
    assert pf.assess(8000, 6800)["state"] == "fulfilled"
    assert pf.assess(8000, 6799)["state"] == "partial"
    assert pf.assess(0, 8000) == {"state": "fulfilled", "unmet_pence": 0}
    assert pf.assess(8000, 0) == {"state": "unmet", "unmet_pence": 8000}


# ── partial match: the unmet remainder stays reserved, counted once ─────────

def test_partial_match_reserves_only_the_unmet_remainder():
    r = _run([_debit(30)], slice_due=80)
    assert r["state"] == "partial" and r["unmet"] == 50 and r["matched_pence"] == 3000


def test_two_matches_sum_and_each_counts_once():
    r = _run([_debit(40), _debit(40, offset=0)])
    assert r["state"] == "fulfilled" and len(r["matched"]) == 2 and r["matched_pence"] == 8000


# ── the shared slice: reservation release through every reader ──────────────

def _slice(monkeypatch, goal, txns):
    pf.transactions_col = _Txns(txns)
    pf.yapily_transactions_col = _Txns()

    async def amap(_):
        return _accounts()
    monkeypatch.setattr(sources, "owned_account_map", amap)
    ledger = {"commitments": {str(goal["_id"]): {"total_claimed": 0.0, "claims": {}}}}
    return asyncio.run(commitments._pot_progress_and_slice(goal, CFG, ledger, timeutil.user_today()))


def test_slice_is_released_when_fulfilled_and_usual_slice_is_untouched(monkeypatch):
    base = _slice(monkeypatch, _goal(), [])["per_period_slice"]
    assert base > 0
    info = _slice(monkeypatch, _goal(fill_rule=RULE), [_debit(float(base))])
    assert info["per_period_slice"] == 0
    assert info["usual_slice"] == base
    assert info["fulfilment"]["state"] == "fulfilled"


def test_slice_keeps_the_unmet_remainder_on_a_partial_match(monkeypatch):
    base = _slice(monkeypatch, _goal(), [])["per_period_slice"]
    info = _slice(monkeypatch, _goal(fill_rule=RULE), [_debit(10.0)])
    assert info["per_period_slice"] == base - 10
    assert info["fulfilment"]["state"] == "partial"


def test_no_rule_leaves_the_plan_estimated_as_today(monkeypatch):
    base = _slice(monkeypatch, _goal(), [])
    info = _slice(monkeypatch, _goal(), [_debit(80.0)])
    assert info["per_period_slice"] == base["per_period_slice"] and info["fulfilment"] is None


def test_rule_without_a_known_paying_account_changes_nothing(monkeypatch):
    goal = _goal(fill_rule=RULE, source_unset=True)
    goal["source_account_id"] = None
    base = _slice(monkeypatch, _goal(), [])["per_period_slice"]
    info = _slice(monkeypatch, goal, [_debit(float(base))])
    assert info["per_period_slice"] == base and info["fulfilment"] is None


def test_a_failed_lookup_keeps_the_full_reservation(monkeypatch):
    base = _slice(monkeypatch, _goal(), [])["per_period_slice"]

    async def boom(*a, **k):
        raise RuntimeError("db down")
    monkeypatch.setattr(pf, "period_fulfilment", boom)
    goal = _goal(fill_rule=RULE)
    ledger = {"commitments": {str(goal["_id"]): {"total_claimed": 0.0, "claims": {}}}}
    info = asyncio.run(commitments._pot_progress_and_slice(goal, CFG, ledger, timeutil.user_today()))
    assert info["per_period_slice"] >= base and info["fulfilment"] is None


def test_safe_to_spend_reservation_drops_by_the_fulfilled_slice(monkeypatch):
    """total_reserved_slices feeds Safe to Spend's commitments_reserved and the
    Upcoming plans line (G227); a fulfilled plan must come out of it once."""
    goal_plain, goal_rule = _goal(), _goal(fill_rule=RULE)
    base = _slice(monkeypatch, goal_plain, [])["per_period_slice"]
    pf.transactions_col = _Txns([_debit(float(base))])
    pf.yapily_transactions_col = _Txns()

    async def cfg(_): return CFG

    async def ledger(uid, docs=None, balances=None):
        return {"commitments": {str(d["_id"]): {"total_claimed": 0.0, "claims": {}} for d in docs or []}}
    monkeypatch.setattr(commitments, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments, "compute_pot_ledger", ledger)
    monkeypatch.setattr(commitments, "commitments_col", _Collection([goal_rule]))
    total, n = asyncio.run(commitments.total_reserved_slices(UID))
    assert (total, n) == (0, 1)
    monkeypatch.setattr(commitments, "commitments_col", _Collection([goal_plain]))
    assert asyncio.run(commitments.total_reserved_slices(UID))[0] == base


# ── the suggested rule, from the transfers G230 reads ───────────────────────

def _suggest(txns):
    pf.transactions_col = _Txns(txns)
    pf.yapily_transactions_col = _Txns()
    return asyncio.run(pf.fill_candidates(UID, "current", ["saving"], _accounts()))


def test_suggestion_comes_from_the_transfer_that_reached_the_pot():
    out = _suggest([_debit(80, offset=-3), _credit(80, offset=-3),
                    _debit(80, offset=-33), _credit(80, offset=-33),
                    _debit(12.5, desc="Netflix", offset=-2)])
    s = out["suggestion"]
    assert s["match_type"] == "description_contains" and "japan pot" in s["match_value"].lower()
    assert s["occurrences_90d"] == 2 and s["last_amount"] == 80
    assert {i["display_name"].lower() for i in out["items"]} >= {"netflix"}


def test_suggestion_is_none_without_a_paired_transfer():
    assert _suggest([_debit(80, offset=-3)])["suggestion"] is None


def test_suggested_rule_matches_its_own_transfer():
    out = _suggest([_debit(80, desc="  STANDING ORDER Japan   pot ", offset=-3), _credit(80, offset=-3)])
    rule = out["suggestion"]
    assert rule and pf.rule_matches(rule, _debit(80, desc="  STANDING ORDER Japan   pot "))


def test_candidates_and_suggestion_are_user_scoped():
    out = _suggest([_debit(80, offset=-3, user="someone-else"), _credit(80, offset=-3)])
    assert out["items"] == [] and out["suggestion"] is None


def test_endpoint_refuses_an_account_the_user_does_not_own(monkeypatch):
    async def amap(_): return _accounts()
    monkeypatch.setattr(commitments, "owned_account_map", amap)
    with pytest.raises(HTTPException) as e:
        asyncio.run(commitments.plan_fill_candidates("not-mine", "", {"email": UID}))
    assert e.value.status_code == 400


# ── write path ──────────────────────────────────────────────────────────────

def test_create_and_patch_store_a_validated_rule_and_clear_it(monkeypatch):
    fake = _Collection()
    monkeypatch.setattr(commitments, "commitments_col", fake)
    assert pf.validate_fill_rule(RULE) == RULE
    assert commitments._public_fill_rule({"fill_rule": RULE}) == RULE
    assert commitments._public_fill_rule({"fill_rule": None}) is None
    assert commitments._public_fill_rule({}) is None


def test_account_plan_row_reports_filled_and_released(monkeypatch):
    """The Upcoming account sheet and the account position read this row."""
    from tests.test_plan_source_account import _rows
    pf.transactions_col = _Txns([_debit(80.0)])
    pf.yapily_transactions_col = _Txns()
    monkeypatch.setattr(pf, "transactions_col", pf.transactions_col)
    rows = _rows(monkeypatch, _goal(fill_rule=RULE, source_account_id="current"), slice_=None)
    row = rows[0]
    assert row["filled_amount"] == 80.0 and row["remaining"] == 0
    assert row["period_amount"] >= 80 and row["fulfilment"]["state"] == "fulfilled"
    assert row["fulfilment"]["matched"][0]["label"].lower().startswith("to japan pot")
