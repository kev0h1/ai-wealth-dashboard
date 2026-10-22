"""G317: intended period contributions reconcile without inventing savings."""
import asyncio
from copy import deepcopy
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers import commitments as goals
from app.services import goal_contribution, plan_fulfilment
from tests.test_commitments_a86 import _doc, _UpdateResult
from tests.test_plan_easing import FakeCol, _setup, _today, UID, USER, OTHER, _put, _del


def run(awaitable):
    return asyncio.run(awaitable)


def matches(doc, query):
    for key, condition in query.items():
        value, exists = doc, True
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                value, exists = None, False
                break
            value = value[part]
        if isinstance(condition, dict) and any(k.startswith("$") for k in condition):
            if "$exists" in condition and exists != condition["$exists"]:
                return False
            if "$eq" in condition and value != condition["$eq"]:
                return False
        elif value != condition:
            return False
    return True


class GoalCol(FakeCol):
    """Copied read snapshots and real nested equality for financial CAS tests."""
    before_write = None

    async def find_one(self, query=None, projection=None):
        return next((deepcopy(d) for d in self.docs if matches(d, query or {})), None)

    async def update_one(self, filt, update, upsert=False):
        if self.before_write:
            callback, self.before_write = self.before_write, None
            callback(self.docs[0])
        for doc in self.docs:
            if matches(doc, filt):
                for key, value in update.get("$set", {}).items():
                    _put(doc, key, deepcopy(value))
                for key in update.get("$unset", {}):
                    _del(doc, key)
                return _UpdateResult(1)
        return _UpdateResult(0)


def setup(monkeypatch, **extra):
    _today(monkeypatch, date(2026, 11, 1))
    doc = _doc("Japan", amount=300.0, target_date="2027-01-01", **extra)
    _setup(monkeypatch, [doc])
    col = GoalCol([doc])
    monkeypatch.setattr(goals, "commitments_col", col)
    return doc, col


def preview(doc, pence, user=USER):
    return run(goals.preview_goal_contribution(str(doc["_id"]), pence, user))


def save(doc, pence, checked=None, user=USER):
    checked = checked or preview(doc, pence, user)
    return run(goals.set_goal_contribution(str(doc["_id"]), {
        "contribution_pence": pence, "period_end": checked["period_end"],
        "preview_token": checked["preview_token"],
    }, user))


@pytest.mark.parametrize("pence,reserved,later", [(20000, 200, 50), (5000, 50, 125), (0, 0, 150), (30000, 300, 0), (100000, 300, 0), (10025, 100.25, 100)])
def test_more_less_zero_cover_and_exact_pennies(monkeypatch, pence, reserved, later):
    doc, _ = setup(monkeypatch)
    original = deepcopy(doc)
    checked = preview(doc, pence)
    assert doc == original  # previews are read-only
    assert checked["reserved"] == reserved and checked["later_contribution"] == later
    assert checked["target_date"] == "2027-01-01" and checked["later_periods"] == 2
    out = save(doc, pence, checked)
    assert out["per_period_slice"] == reserved
    assert out["current_period_contribution"]["later_contribution"] == later
    assert run(goals.total_reserved_slices(UID))[0] == reserved
    assert out["progress"] == 0 and out["remaining"] == 300
    for field in ("amount", "target_date", "funding_pots", "contributed", "source_account_id", "fill_rule"):
        assert doc.get(field) == original.get(field)


def test_rollover_uses_actual_progress_not_the_planned_contribution(monkeypatch):
    doc, _ = setup(monkeypatch)
    save(doc, 20000)
    _today(monkeypatch, date(2026, 12, 1))
    out = run(goals.get_commitment(str(doc["_id"]), USER))
    assert out["current_period_contribution"] is None
    assert out["per_period_slice"] == 150  # money was not actually saved
    assert out["progress"] == 0 and out["target_date"] == "2027-01-01"
    doc["contributed"] = 200.0
    out = run(goals.get_commitment(str(doc["_id"]), USER))
    assert out["per_period_slice"] == 50 and out["progress"] == 200


def test_reedit_replaces_this_period_and_date_edit_ends_it(monkeypatch):
    doc, _ = setup(monkeypatch)
    save(doc, 5000)
    assert save(doc, 7500)["per_period_slice"] == 75
    assert len(doc["period_contributions"]) == 1
    out = run(goals.update_commitment(str(doc["_id"]), {"target_date": "2027-02-01"}, USER))
    assert out["current_period_contribution"] is None and out["per_period_slice"] == 75
    assert doc["period_contributions"]["2026-11-30"]["cleared"] is True


def test_no_later_periods_never_promise_an_impossible_catchup(monkeypatch):
    doc, _ = setup(monkeypatch)
    doc["target_date"] = "2026-11-01"
    checked = preview(doc, 0)
    assert checked["blocked_reason"] and checked["later_contribution"] is None
    with pytest.raises(HTTPException) as exc:
        save(doc, 0, checked)
    assert exc.value.status_code == 422 and "period_contributions" not in doc
    assert save(doc, 30000)["per_period_slice"] == 300


@pytest.mark.parametrize("bad", [-1, True, 1.5, "100", None, float("nan"), float("inf"), 100_000_001])
def test_invalid_amount_never_writes(monkeypatch, bad):
    doc, _ = setup(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        run(goals.set_goal_contribution(str(doc["_id"]), {"contribution_pence": bad}, USER))
    assert exc.value.status_code == 422 and "period_contributions" not in doc


def test_owner_and_active_guards_apply_to_detail_preview_and_write(monkeypatch):
    doc, _ = setup(monkeypatch)
    for call in (goals.get_commitment(str(doc["_id"]), OTHER), goals.preview_goal_contribution(str(doc["_id"]), 100, OTHER), goals.set_goal_contribution(str(doc["_id"]), {"contribution_pence": 100}, OTHER)):
        with pytest.raises(HTTPException) as exc:
            run(call)
        assert exc.value.status_code == 404
    for change in ({"paused": True}, {"status": "cancelled"}, {"status": "done"}):
        doc.update({"paused": False, "status": "active", **change})
        with pytest.raises(HTTPException) as exc:
            preview(doc, 100)
        assert exc.value.status_code == 409


@pytest.mark.parametrize("change", [lambda d: d.update(amount=400), lambda d: d.update(paused=True), lambda d: d.update(fill_rule={"match_type": "description_contains", "match_value": "new"}), lambda d: d.update(period_contributions={"2026-11-30": {"contribution_pence": 200}})])
def test_concurrent_financial_edit_is_refused(monkeypatch, change):
    doc, col = setup(monkeypatch)
    checked = preview(doc, 7500)
    col.before_write = change
    with pytest.raises(HTTPException) as exc:
        save(doc, 7500, checked)
    assert exc.value.status_code == 409


def test_stale_preview_and_period_rollover_are_refused(monkeypatch):
    doc, _ = setup(monkeypatch)
    checked = preview(doc, 10000)
    doc["contributed"] = 20
    with pytest.raises(HTTPException) as exc:
        save(doc, 10000, checked)
    assert exc.value.status_code == 409
    checked = preview(doc, 10000)
    _today(monkeypatch, date(2026, 12, 1))
    with pytest.raises(HTTPException) as exc:
        save(doc, 10000, checked)
    assert exc.value.status_code == 409 and "period_contributions" not in doc


def test_manual_choice_replaces_easing_but_retains_coaching_history(monkeypatch):
    doc, _ = setup(monkeypatch)
    run(goals.ease_commitment(str(doc["_id"]), {"contribution_pence": 5000, "mode": "keep_date"}, USER))
    assert preview(doc, 20000)["replaces_easing"] is True
    out = save(doc, 20000)
    assert out["eased_this_period"] is None and out["eased_count_12m"] == 1
    assert doc["period_eased"]["2026-11-30"]["cleared"] is True
    with pytest.raises(HTTPException) as exc:
        run(goals.ease_commitment(str(doc["_id"]), {"contribution_pence": 0, "mode": "keep_date"}, USER))
    assert exc.value.status_code == 422


@pytest.mark.parametrize("matched,expected_reserve", [(0, 100.25), (50.10, 50.15), (90, 10.25), (100.25, 0), (150, 0)])
def test_matched_money_is_subtracted_once_without_rounded_tolerance(monkeypatch, matched, expected_reserve):
    doc, _ = setup(monkeypatch, fill_rule={"match_type": "description_contains", "match_value": "Japan"})

    async def fulfilment(_doc, due, _start, _end, *, exact=False):
        if goal_contribution.live_entry(_doc.get("period_contributions"), "2026-11-30"):
            assert exact is True
        verdict = plan_fulfilment.assess(round(due * 100), round(matched * 100), exact=exact)
        return {**verdict, "matched_pence": round(matched * 100), "unmet": verdict["unmet_pence"] / 100}

    monkeypatch.setattr(goals, "_plan_fulfilment", fulfilment)
    # This is actual saved money, independently present in the pot ledger.
    doc["contributed"] = matched
    checked = preview(doc, 10025)
    assert checked["reserved"] == expected_reserve
    assert checked["remaining_after"] == round(max(0, 300 - matched - expected_reserve), 2)
    assert save(doc, 10025, checked)["per_period_slice"] == expected_reserve


def test_cap_does_not_double_subtract_an_arrived_transfer(monkeypatch):
    doc, _ = setup(monkeypatch, contributed=250, fill_rule={"match_type": "description_contains", "match_value": "Japan"})

    async def fulfilment(_doc, due, _start, _end, *, exact=False):
        return {"matched_pence": 5000, "unmet": max(0, due - 50)}

    monkeypatch.setattr(goals, "_plan_fulfilment", fulfilment)
    checked = preview(doc, 10000)
    assert checked["contribution"] == 100 and checked["reserved"] == 50
    assert checked["remaining"] == 50 and checked["later_contribution"] == 0
    assert save(doc, 10000, checked)["per_period_slice"] == 50


def test_projection_uses_the_future_period_count_on_a_midperiod_day(monkeypatch):
    doc, _ = setup(monkeypatch)
    _today(monkeypatch, date(2026, 11, 15))
    checked = preview(doc, 5000)
    assert checked["later_periods"] == 2 and checked["later_contribution"] == 125
    assert checked["period_end"] == "2026-11-30"


def test_malformed_stored_entry_is_inert():
    for bad in (None, [], {"2026-11-30": 1}, {"2026-11-30": {"contribution_pence": True}}, {"2026-11-30": {"contribution_pence": -1}}):
        assert goal_contribution.live_entry(bad, "2026-11-30") is None
