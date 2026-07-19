from datetime import datetime, timedelta

from app.routers.savings_insights import (
    _parse_deadline, _material_change_reason, _spotlight_candidates,
)

NOW = datetime.utcnow()


def doc(**kw):
    base = {"category": "gym", "refreshed_at": NOW, "pinned": False}
    base.update(kw)
    return base


def test_fresh_insight_is_candidate():
    assert _spotlight_candidates([doc()]) != []


def test_dismissed_stays_gone_despite_new_content():
    # The old bug: regenerated wording un-retired dismissals weekly
    d = doc(spotlight_retired=True, spotlight_dismissed_at=NOW - timedelta(days=3),
            is_new=True, savings_estimate="Save £40/mo", estimate_at_dismissal=40.0)
    assert _spotlight_candidates([d]) == []


def test_material_estimate_change_earns_return_with_reason():
    d = doc(spotlight_retired=True, spotlight_dismissed_at=NOW - timedelta(days=3),
            savings_estimate="£60/mo", estimate_at_dismissal=40.0)
    cands = _spotlight_candidates([d])
    assert cands and "£40" in cands[0]["_return_reason"] and "£60" in cands[0]["_return_reason"]


def test_cooldown_expiry_returns_without_reason():
    d = doc(spotlight_retired=True, spotlight_dismissed_at=NOW - timedelta(days=31),
            savings_estimate="£40/mo", estimate_at_dismissal=40.0)
    cands = _spotlight_candidates([d])
    assert cands and cands[0]["_return_reason"] is None


def test_approaching_deadline_overrides_dismissal():
    d = doc(spotlight_retired=True, spotlight_dismissed_at=NOW - timedelta(days=3),
            deadline_at=NOW + timedelta(days=30),
            savings_estimate="£40/mo", estimate_at_dismissal=40.0)
    cands = _spotlight_candidates([d])
    assert cands and "deal ends" in cands[0]["_return_reason"].lower()


def test_deadline_parser_formats():
    assert _parse_deadline({"deal_end": "March 2027"}).month == 3
    assert _parse_deadline({"contract_end": "Oct 26"}).year == 2026
    assert _parse_deadline({"deal_end": "2027-03"}).day == 31  # end of month
    assert _parse_deadline({"deal_end": "Rolling"}) is None
    assert _parse_deadline({"deal_end": "Not sure"}) is None
    assert _parse_deadline(None) is None
