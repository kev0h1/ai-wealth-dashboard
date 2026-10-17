"""G283: the resolution lines a tip may carry once its merchant went silent.

`_stopped_line` and `_substituted_line` (backend/app/routers/savings_insights.py)
state what happened and nothing else: no pounds figure, no claim of money saved,
no celebration tier, no call to action. The stored `verified_savings` amount
stays internal and is never serialised (see also test_g283_tip_facts.py).
Built from whole phrase chunks so a merchant name can never land flush against
the next word (the old "Nandoshave" bug).
"""
from datetime import datetime

from app.routers.savings_insights import (
    _house_style,
    _serialize_insight,
    _stopped_line,
    _substituted_line,
)
from app.services import tip_copy


def test_stopped_line_states_the_fact_only():
    assert _stopped_line("Nandos") == "Payments to Nandos stopped."
    assert _stopped_line(None) == "That payment stopped."
    assert _stopped_line("   ") == "That payment stopped."
    assert "  " not in _stopped_line("Big   Co")


def test_substituted_line_states_the_fact_only():
    assert _substituted_line("Nandos", "Eating Out") == (
        "Payments to Nandos stopped, and Eating Out overall hasn't moved."
    )
    assert _substituted_line(None, None) == (
        "That payment stopped, and your overall spending here hasn't moved."
    )


def test_resolution_lines_pass_the_banned_phrase_list():
    for line in (_stopped_line("Nandos"), _substituted_line("Nandos", "Eating Out")):
        assert tip_copy.find_banned(line) is None


def test_house_style_does_not_disturb_and_joined_merchant_title():
    title = "You spend about £60 a month on Nandos and McDonald's"
    assert _house_style(title) == title


def _base_doc(**overrides):
    d = {"_id": "abc123", "category": "subscriptions", "title": "Some title", "body": "Some body"}
    d.update(overrides)
    return d


def test_serialize_verified_has_a_stopped_line_and_no_pounds_fields():
    doc = _base_doc(verified_savings=49.1, verified_merchant="Nandos", verified_at=datetime(2026, 8, 20))
    out = _serialize_insight(doc)
    assert out["state"] == "verified"
    assert out["stopped_line"] == "Payments to Nandos stopped."
    for gone in ("verified_savings", "verified_tier", "verified_savings_line", "verified_merchant",
                 "savings_estimate", "savings_estimate_monthly", "substituted_amount"):
        assert gone not in out


def test_serialize_unresolved_has_no_stopped_line():
    assert _serialize_insight(_base_doc())["stopped_line"] is None


def test_serialize_substituted_exposes_the_fact_line():
    doc = _base_doc(
        category="eating_out", substituted_at=datetime(2026, 8, 27),
        substituted_merchant="Nandos", substituted_amount=49.1,
    )
    out = _serialize_insight(doc)
    assert out["substituted"] is True
    assert out["substituted_merchant"] == "Nandos"
    assert out["substituted_line"] == "Payments to Nandos stopped, and Eating Out overall hasn't moved."
    assert out["stopped_line"] is None
    assert "substituted_amount" not in out


def test_serialize_substituted_false_when_not_substituted():
    out = _serialize_insight(_base_doc())
    assert out["substituted"] is False
    assert out["substituted_line"] is None
