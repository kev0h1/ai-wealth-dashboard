"""Tests for `savings_estimate_monthly` on `_serialize_insight`
(backend/app/routers/savings_insights.py).

The Insights hero (frontend) sums monthly saving estimates across the open
insight cards it renders. `savings_estimate` on the wire is a display
STRING ("~£32/mo"), so the serializer also exposes the parsed numeric
figure behind it — delegating to `_parse_saving_amount` (analytics.py)
rather than re-deriving the parse in the frontend, which would drift the
moment either side changed independently.

The contract this file locks in:
  - a well-formed estimate parses to the same number `_parse_saving_amount`
    would produce directly.
  - a missing estimate (None) serializes to `savings_estimate_monthly: None`.
  - a malformed estimate (no £ amount to find) ALSO serializes to None, not
    the 0.0 that `_parse_saving_amount` itself would return for it — a
    silent 0.0 would read to a summing caller as a genuine, costed £0
    estimate rather than "nothing to parse".
"""
from datetime import datetime, timedelta

from app.routers.savings_insights import _serialize_insight, _savings_estimate_monthly
from app.routers.analytics import _parse_saving_amount

NOW = datetime.utcnow()


def _doc(**overrides) -> dict:
    base = {
        "_id": "abc123",
        "insight_id": "abc123",
        "category": "energy",
        "title": "Switch energy supplier",
        "body": "Your tariff looks pricier than the market average.",
        "savings_estimate": None,
        "pinned": False,
        "is_new": False,
        "refreshed_at": None,
        "researched_at": NOW,
        # OWNER DECISION (2026-09-01): content only serves while
        # content_valid_until is in the future — see test_content_ttl.py.
        "content_valid_until": NOW + timedelta(days=6),
    }
    base.update(overrides)
    return base


def test_savings_estimate_monthly_matches_parser_for_tilde_estimate():
    assert _savings_estimate_monthly("~£32/mo") == _parse_saving_amount("~£32/mo") == 32.0
    out = _serialize_insight(_doc(savings_estimate="~£32/mo"))
    assert out["savings_estimate_monthly"] == 32.0
    assert out["savings_estimate"] == "~£32/mo"


def test_savings_estimate_monthly_matches_parser_for_plain_estimate():
    assert _savings_estimate_monthly("£15/mo") == _parse_saving_amount("£15/mo") == 15.0
    out = _serialize_insight(_doc(savings_estimate="£15/mo"))
    assert out["savings_estimate_monthly"] == 15.0


def test_savings_estimate_monthly_is_none_when_estimate_absent():
    out = _serialize_insight(_doc(savings_estimate=None))
    assert out["savings_estimate"] is None
    assert out["savings_estimate_monthly"] is None


def test_savings_estimate_monthly_is_none_for_malformed_value():
    # No £ amount anywhere in the string — _parse_saving_amount alone would
    # return 0.0 here, which is exactly the silent-zero this wrapper guards
    # against for a summing caller.
    malformed = "reduce your outgoings soon"
    assert _parse_saving_amount(malformed) == 0.0
    assert _savings_estimate_monthly(malformed) is None
    out = _serialize_insight(_doc(savings_estimate=malformed))
    assert out["savings_estimate_monthly"] is None
