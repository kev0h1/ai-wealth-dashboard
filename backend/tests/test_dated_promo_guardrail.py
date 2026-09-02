"""Tests for the dated-promo guardrail (Insights honesty review, Package A
#5): `_DATED_PROMO_RE` (backend/app/routers/savings_insights.py), its
`claim_valid_until` parser `_parse_claim_valid_until`, and the
`promo_claim_expired` branch of `_regen_reason` that suppresses/regenerates
a stale researched body once a stated promo's claimed expiry has passed.

The guardrail only applies to categories with no other tracked
deal/contract/renewal date (`_CATEGORIES_WITHOUT_WORKFLOW_EXPIRY` — derived
from CATEGORY_WORKFLOWS + _DEADLINE_KEYS, not hand-duplicated), since the
other five categories already have `deadline_window` doing the same
staleness-catching job via a real user-supplied date."""
from datetime import datetime, timedelta

from app.routers.savings_insights import (
    _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY,
    _DATED_PROMO_RE,
    _parse_claim_valid_until,
    _regen_reason,
    PROMPT_VERSION,
)


# ── _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY ─────────────────────────────────────

def test_categories_without_workflow_expiry_are_exactly_the_untracked_five():
    # energy/mortgage/broadband/mobile/car_insurance all have a deal_end/
    # contract_end/renewal_date step in CATEGORY_WORKFLOWS and are excluded;
    # these five have no such step and are the ones the guardrail covers.
    assert _CATEGORIES_WITHOUT_WORKFLOW_EXPIRY == {
        "car_finance", "gym", "subscriptions", "groceries", "eating_out",
    }


# ── _DATED_PROMO_RE: hits ───────────────────────────────────────────────────

def test_promo_regex_hits_offer_ending_on_a_date():
    assert _DATED_PROMO_RE.search("This month's switching offer ends 31 March.")


def test_promo_regex_hits_offer_with_month_name_nearby():
    assert _DATED_PROMO_RE.search("There's a joining discount valid until January 2027.")


def test_promo_regex_hits_named_shopping_event():
    assert _DATED_PROMO_RE.search("Look out for a Black Friday deal on annual plans.")


def test_promo_regex_hits_expires_wording():
    assert _DATED_PROMO_RE.search("The current promo expires soon, so switch now.")


# ── _DATED_PROMO_RE: misses (must not false-positive on evergreen advice) ──

def test_promo_regex_misses_plain_evergreen_advice():
    assert not _DATED_PROMO_RE.search(
        "Switching typically saves around £15 a month, no strings attached."
    )


def test_promo_regex_misses_a_month_mention_with_no_offer_word_nearby():
    assert not _DATED_PROMO_RE.search(
        "Your contract started in March and renews annually."
    )


def test_promo_regex_misses_offer_word_with_no_date_token_anywhere():
    assert not _DATED_PROMO_RE.search(
        "This provider's discount is available to all new customers year round."
    )


# ── _parse_claim_valid_until ────────────────────────────────────────────────

def test_parse_claim_valid_until_iso_date():
    assert _parse_claim_valid_until("2027-03-31") == datetime(2027, 3, 31)


def test_parse_claim_valid_until_year_month():
    assert _parse_claim_valid_until("2027-03") == datetime(2027, 3, 31)  # end of month


def test_parse_claim_valid_until_month_name_and_year():
    assert _parse_claim_valid_until("March 2027") == datetime(2027, 3, 31)


def test_parse_claim_valid_until_no_expiry_known_is_none():
    assert _parse_claim_valid_until("no_expiry_known") is None


def test_parse_claim_valid_until_blank_is_none():
    assert _parse_claim_valid_until("") is None
    assert _parse_claim_valid_until(None) is None


def test_parse_claim_valid_until_unparseable_text_is_none():
    assert _parse_claim_valid_until("soon") is None
    assert _parse_claim_valid_until("whenever the offer ends") is None


# ── _regen_reason: promo_claim_expired ──────────────────────────────────────

NOW = datetime(2026, 8, 27, 12, 0, 0)


def _fresh_existing(**overrides):
    d = {
        "refreshed_at": NOW - timedelta(days=1),
        "prompt_version": PROMPT_VERSION,
        "triggered_by": [],
        # OWNER DECISION (2026-09-01): _regen_reason's TTL check now runs on
        # content_valid_until, not a separate refreshed_at window — see
        # test_content_ttl.py / _compute_content_valid_until. This fixture
        # is meant to represent a genuinely NOT-yet-stale doc (so these
        # tests can isolate the claim_valid_until/promo_claim_expired
        # branch specifically), so it needs its own content_valid_until
        # comfortably in the future by default.
        "content_valid_until": NOW + timedelta(days=6),
    }
    d.update(overrides)
    return d


def test_regen_reason_fires_once_claim_valid_until_has_passed():
    existing = _fresh_existing(claim_valid_until=NOW - timedelta(days=1))
    assert _regen_reason(existing, [], NOW) == "promo_claim_expired"


def test_regen_reason_does_not_fire_before_claim_valid_until():
    existing = _fresh_existing(claim_valid_until=NOW + timedelta(days=10))
    assert _regen_reason(existing, [], NOW) is None


def test_regen_reason_ignores_claim_valid_until_when_absent():
    existing = _fresh_existing()  # no claim_valid_until at all — the common case
    assert _regen_reason(existing, [], NOW) is None


def test_regen_reason_promo_expiry_does_not_override_earlier_reasons():
    # first_generation (no refreshed_at) must still win even if a stray
    # claim_valid_until is somehow present on a doc with no refresh history.
    existing = {"claim_valid_until": NOW - timedelta(days=1)}
    assert _regen_reason(existing, [], NOW) == "first_generation"
