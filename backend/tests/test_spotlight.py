from datetime import datetime, timedelta

from app.routers.savings_insights import (
    _parse_deadline, _material_change_reason, _spotlight_candidates,
)

NOW = datetime.utcnow()


def doc(**kw):
    # STRUCTURAL FIX (owner phone report 2026-09-01, "should we render a
    # card if there is no content" — the invariant applies to the Home
    # spotlight too, see `_spotlight_candidates`'s content-presence gate):
    # these fixtures are about dismiss/cooldown/return-reason logic, not
    # content presence, so they default to a normal researched (state:
    # "fresh") shape — title/body/researched_at all populated — same as
    # every real candidate the spotlight would actually rank. A test that
    # wants to exercise the content gate itself overrides these explicitly.
    base = {
        "category": "gym", "refreshed_at": NOW, "pinned": False,
        "title": "Your gym membership looks pricier than average",
        "body": "A few chains nearby run cheaper no-contract plans.",
        "researched_at": NOW,
        # OWNER DECISION (2026-09-01): freshness is content_valid_until-gated
        # now, not derived from researched_at recency alone — see
        # test_content_ttl.py. Comfortably inside the 7-day default TTL.
        "content_valid_until": NOW + timedelta(days=6),
    }
    base.update(kw)
    return base


def test_fresh_insight_is_candidate():
    assert _spotlight_candidates([doc()]) != []


def test_contentless_quiet_insight_is_never_a_spotlight_candidate():
    """The same invariant that fixed InsightsPage's compact/full decision
    (owner phone report 2026-09-01: "no content -> no full card, ever, no
    override") applies here too — HomeInsightSpotlight has no compact
    fallback, so a quiet doc winning this ranking would render the exact
    hollow card the owner reported, just on the Home screen instead."""
    quiet = doc(title="", body="", researched_at=None)
    assert _spotlight_candidates([quiet]) == []


def test_verified_insight_is_never_a_spotlight_candidate_even_if_not_yet_stamped_retired():
    """Belt-and-braces alongside the `spotlight_retired` stamp
    `_check_verified_saving`'s caller sets: a doc that resolved to
    `verified_at` renders no title/body either (Zone 2 retires once
    resolved), so it must never win the spotlight even in the hypothetical
    case a doc reaches here before `spotlight_retired` was set."""
    verified = doc(title="", body="", researched_at=None,
                    verified_at=NOW, verified_savings=11.99, verified_merchant="Now Tv")
    assert _spotlight_candidates([verified]) == []


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
