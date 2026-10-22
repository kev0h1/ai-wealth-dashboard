"""G318: one contribution schedule includes the live slot and no-op identity."""
from copy import deepcopy
from datetime import date

import pytest

from app.routers import commitments as goals
from app.services import goal_contribution
from tests.test_g317_goal_contribution import setup, run, preview, save
from tests.test_plan_easing import _today, USER, UID


@pytest.mark.parametrize("day", [1, 2, 15, 30])
@pytest.mark.parametrize("remaining", [290, 300, 1740, 0.01])
def test_live_slot_and_unchanged_choice_use_the_same_schedule(monkeypatch, day, remaining):
    doc, _ = setup(monkeypatch)
    doc["amount"] = remaining
    _today(monkeypatch, date(2026, 11, day))
    view = run(goals.get_commitment(str(doc["_id"]), USER))
    assert view["periods_left"] == 3
    chosen = round(view["planned_per_period_slice"] * 100)
    before = deepcopy(doc)
    checked = preview(doc, chosen)
    assert checked["unchanged"] is True
    if not checked["covers_remaining"]:
        assert checked["later_contribution"] == view["planned_per_period_slice"]
    result = save(doc, chosen, checked)
    assert doc == before
    assert result["current_period_contribution"] is None
    assert result["progress"] == 0
    assert run(goals.total_reserved_slices(UID))[0] == view["per_period_slice"]


def test_schedule_caps_the_last_slot_without_creating_extra_target_money():
    assert goal_contribution.schedule(29000, 3) == (10000, 10000, 9000)
    assert goal_contribution.schedule(1, 3) == (1, 0, 0)
    for remaining in [0, 1, 100, 29000, 174001]:
        for periods in [1, 2, 3, 31]:
            slots = goal_contribution.schedule(remaining, periods)
            assert len(slots) == periods and sum(slots) == remaining
            assert all(value >= 0 for value in slots)


def test_reediting_a_manual_total_is_read_only_and_preserves_its_later_estimate(monkeypatch):
    doc, _ = setup(monkeypatch)
    saved = save(doc, 7924)
    before = deepcopy(doc)
    checked = preview(doc, 7924)
    assert checked["unchanged"]
    assert checked["later_contribution"] == saved["current_period_contribution"]["later_contribution"]
    save(doc, 7924, checked)
    assert doc == before


def test_unchanged_easing_does_not_clear_coaching_history(monkeypatch):
    doc, _ = setup(monkeypatch)
    run(goals.ease_commitment(str(doc["_id"]), {"contribution_pence": 5000, "mode": "keep_date"}, USER))
    before = deepcopy(doc)
    checked = preview(doc, 5000)
    assert checked["unchanged"] and not checked["replaces_easing"]
    save(doc, 5000, checked)
    assert doc == before


@pytest.mark.parametrize("cfg", [
    {"type": "weekly", "weekday": 1},
    {"type": "biweekly", "referenceDate": "2026-11-02"},
    {"type": "monthly_pay_date", "day": 25},
    {"type": "last_friday"},
])
def test_schedule_identity_uses_real_pay_boundaries(monkeypatch, cfg):
    doc, _ = setup(monkeypatch)
    _today(monkeypatch, date(2026, 11, 15))

    async def pay_config(_uid):
        return cfg

    monkeypatch.setattr(goals, "_pay_cfg", pay_config)
    view = run(goals.get_commitment(str(doc["_id"]), USER))
    checked = preview(doc, round(view["planned_per_period_slice"] * 100))
    assert checked["unchanged"]
    assert view["periods_left"] == 1 + checked["later_periods"]
    assert checked["later_contribution"] == view["planned_per_period_slice"]
