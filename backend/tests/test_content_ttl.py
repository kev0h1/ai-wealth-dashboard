"""Tests for the content-TTL reversal (owner decision 2026-09-01, verbatim:
"this pattern would mean that users would do a lot of searches which mean
tavily calls would be high, I think the app should be responsible for the
refreshes, but it should indicate an expiry on the offers perhaps a ttl on
the entry, these should come on a weekly basis").

The live, user-initiated research pull (POST /savings-insights/{id}/research)
is retired — see test_research_endpoint_retired.py. Every category is now
weekly-push (CATEGORY_LIFECYCLE, test_category_lifecycle_registry.py) and
every researched entry carries a displayed `content_valid_until`:

    content_valid_until = min(claim_valid_until, researched_at + DEFAULT_RESEARCH_TTL)
                          when claim_valid_until is supplied, else just
                          researched_at + DEFAULT_RESEARCH_TTL

This file covers two things:
  1. `_compute_content_valid_until` derivation in isolation (claim wins when
     sooner than the default; default wins otherwise, including "no claim
     at all").
  2. The expiry -> quiet transition in `_derive_insight_state` /
     `_serialize_insight`, uniformly across categories now (no push/pull
     split any more — see test_insight_state_machine.py for the fuller
     state-machine exhaustiveness suite), plus idempotency: reading the same
     expired doc twice must never flip state.
"""
from datetime import datetime, timedelta

from app.routers.savings_insights import (
    _compute_content_valid_until,
    _derive_insight_state,
    _serialize_insight,
    DEFAULT_RESEARCH_TTL,
    DEFAULT_RESEARCH_TTL_DAYS,
)


NOW = datetime(2026, 9, 1, 12, 0, 0)


# ── TTL derivation ───────────────────────────────────────────────────────────

def test_default_ttl_is_seven_days_aligned_to_the_weekly_cadence():
    assert DEFAULT_RESEARCH_TTL_DAYS == 7
    assert DEFAULT_RESEARCH_TTL == timedelta(days=7)


def test_no_claim_uses_the_default_ttl():
    out = _compute_content_valid_until(NOW, None)
    assert out == NOW + DEFAULT_RESEARCH_TTL


def test_claim_sooner_than_default_wins():
    # A real, dated offer expiring in 3 days — sooner than the 7-day
    # default — must govern; showing it as good for a full week would be
    # dishonest about when it actually lapses.
    claim = NOW + timedelta(days=3)
    out = _compute_content_valid_until(NOW, claim)
    assert out == claim


def test_claim_later_than_default_is_ignored_default_wins():
    # A claim that outlives the default TTL never gets to extend the
    # card's shown freshness past the weekly cadence — the default silently
    # governs, same as if no claim had been supplied at all.
    claim = NOW + timedelta(days=30)
    out = _compute_content_valid_until(NOW, claim)
    assert out == NOW + DEFAULT_RESEARCH_TTL


def test_claim_exactly_equal_to_default_is_the_claim_value_either_way():
    claim = NOW + DEFAULT_RESEARCH_TTL
    out = _compute_content_valid_until(NOW, claim)
    assert out == claim == NOW + DEFAULT_RESEARCH_TTL


def test_claim_in_the_past_still_governs_if_sooner_than_default():
    # Not this function's job to reject a stale claim — `_regen_reason`'s
    # `promo_claim_expired` branch is what forces a regen once a claim
    # deadline passes; this function just computes the honest minimum.
    claim = NOW - timedelta(days=1)
    out = _compute_content_valid_until(NOW, claim)
    assert out == claim


# ── Expiry -> quiet transition ──────────────────────────────────────────────

def _fresh_doc(category="gym", **overrides):
    base = {
        "_id": "x", "insight_id": f"{category}-x", "category": category,
        "title": "Your PCP rate looks above the current market average",
        "body": "Typical rates for a similar vehicle are running higher right now.",
        "savings_estimate": None, "claim_valid_until": None,
        "researched_at": NOW - timedelta(days=1),
        "content_valid_until": NOW + timedelta(days=6),  # still inside the 7d TTL
        "pinned": False, "is_new": False, "refreshed_at": NOW,
        "triggered_by": [],
    }
    base.update(overrides)
    return base


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _freeze(monkeypatch):
    import app.routers.savings_insights as savings_insights
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)


def test_content_valid_until_in_the_future_is_fresh(monkeypatch):
    _freeze(monkeypatch)
    doc = _fresh_doc()
    assert _derive_insight_state(doc) == "fresh"
    out = _serialize_insight(doc)
    assert out["state"] == "fresh"
    assert out["title"] != ""
    assert out["content_valid_until"] is not None


def test_content_valid_until_in_the_past_is_quiet_and_content_is_withheld(monkeypatch):
    _freeze(monkeypatch)
    doc = _fresh_doc(content_valid_until=NOW - timedelta(hours=1))
    assert _derive_insight_state(doc) == "quiet"
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"
    assert out["title"] == ""
    assert out["body"] == ""
    assert out["savings_estimate"] is None
    assert out["claim_valid_until"] is None
    assert out["content_valid_until"] is None
    assert out["expiry_line"] is None


def test_content_valid_until_exactly_now_is_no_longer_fresh(monkeypatch):
    # `now < content_valid_until` — the boundary instant itself is NOT
    # fresh, same "strictly before" contract as the old RESEARCH_TTL gate.
    _freeze(monkeypatch)
    doc = _fresh_doc(content_valid_until=NOW)
    assert _derive_insight_state(doc) == "quiet"


def test_missing_content_valid_until_never_researched_is_quiet(monkeypatch):
    _freeze(monkeypatch)
    doc = _fresh_doc(content_valid_until=None, researched_at=None, title="", body="")
    assert _derive_insight_state(doc) == "quiet"
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"


def test_expiry_is_category_independent_a_former_push_category_expires_the_same_way(monkeypatch):
    # Before this reversal, "mobile" (a structured/push category) never
    # aged out at all in `_derive_insight_state` — this proves that
    # distinction no longer exists: mobile and gym behave identically now.
    _freeze(monkeypatch)
    mobile = _fresh_doc(category="mobile", content_valid_until=NOW - timedelta(hours=1))
    gym = _fresh_doc(category="gym", content_valid_until=NOW - timedelta(hours=1))
    assert _derive_insight_state(mobile) == _derive_insight_state(gym) == "quiet"


def test_expiry_transition_is_idempotent_across_repeated_reads(monkeypatch):
    """Reading the same expired doc repeatedly (the API being polled, or the
    twin re-rendering) must never flip state — `_serialize_insight` is a
    pure function of the stored doc and the frozen clock, so this is really
    proving there's no hidden mutation/side effect smuggled into a read
    path. Only the cron (a WRITE) may ever change the outcome."""
    _freeze(monkeypatch)
    doc = _fresh_doc(content_valid_until=NOW - timedelta(days=1))
    first = _serialize_insight(doc)
    second = _serialize_insight(doc)
    third = _serialize_insight(doc)
    assert first["state"] == second["state"] == third["state"] == "quiet"
    assert first == second == third


def test_freshness_idempotent_across_repeated_reads_too(monkeypatch):
    _freeze(monkeypatch)
    doc = _fresh_doc(content_valid_until=NOW + timedelta(days=3))
    first = _serialize_insight(doc)
    second = _serialize_insight(doc)
    assert first["state"] == second["state"] == "fresh"
    assert first == second


# ── expiry_line copy ─────────────────────────────────────────────────────────

def test_expiry_line_states_the_real_deadline_when_a_claim_governs(monkeypatch):
    _freeze(monkeypatch)
    claim = NOW + timedelta(days=2)  # sooner than the 7d default -> claim governs
    doc = _fresh_doc(
        category="subscriptions",
        claim_valid_until=claim,
        content_valid_until=_compute_content_valid_until(NOW - timedelta(days=1), claim),
        researched_at=NOW - timedelta(days=1),
    )
    out = _serialize_insight(doc)
    assert out["expiry_line"] is not None
    assert out["expiry_line"].startswith("Valid until ")
    assert "—" not in out["expiry_line"] and "–" not in out["expiry_line"]


def test_expiry_line_is_generic_when_the_default_ttl_governs(monkeypatch):
    _freeze(monkeypatch)
    doc = _fresh_doc(
        category="gym", claim_valid_until=None,
        researched_at=NOW - timedelta(days=2),
        content_valid_until=NOW - timedelta(days=2) + DEFAULT_RESEARCH_TTL,
    )
    out = _serialize_insight(doc)
    # OWNER RULING 2026-09-02: no cadence/"weekly" wording anywhere
    # user-facing — the age stamp alone survives (see _expiry_line).
    assert out["expiry_line"] == "Researched 2d ago"


def test_expiry_line_is_null_once_the_card_is_quiet(monkeypatch):
    _freeze(monkeypatch)
    doc = _fresh_doc(content_valid_until=NOW - timedelta(hours=1))
    out = _serialize_insight(doc)
    assert out["state"] == "quiet"
    assert out["expiry_line"] is None
