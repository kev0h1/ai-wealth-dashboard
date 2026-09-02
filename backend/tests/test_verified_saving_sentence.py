"""Tests for `_verified_saving_sentence` / `_verified_copy_tier` /
`_substituted_line` (backend/app/routers/savings_insights.py) and their
wiring into `_serialize_insight`'s `verified_savings_line` / `verified_tier` /
`substituted_line` fields.

Regression coverage for a live bug: the "you did it" celebration banner on
/insights was composed client-side by splicing `verified_merchant` straight
into a JSX/template string ("payments to {merchant} have stopped."). A
production render showed "Nandoshave" — the merchant name landing flush
against "have" with the boundary space missing. `_verified_saving_sentence`
moves composition server-side and builds the sentence from whole phrase
CHUNKS joined with `" ".join()`, so a missing boundary space is structurally
impossible rather than merely avoided by convention (see the function's own
docstring for the reasoning, which mirrors `_house_style`'s discipline in
this module).

Insights honesty review (2026-08-31, Package A #2): a live case showed the
celebratory "You did it, £49 staying in your pocket" copy firing on an
insight the owner never engaged with (viewed_at landed 19h after the card
was generated, list-wide, not evidence of looking at THIS card). The
sentence now takes an explicit `tier` — "fact" (honest default, no
engagement evidence) or "earned" (confirmed engagement before the win
verified) — with NO default value, so every call site must consciously
choose rather than silently inheriting the old always-celebratory copy.
`_verified_copy_tier` is the deterministic gate deciding which tier a stored
insight doc earns."""
from datetime import datetime, timedelta

from app.routers.savings_insights import (
    _serialize_insight,
    _substituted_line,
    _verified_copy_tier,
    _verified_saving_sentence,
)


# ── _verified_saving_sentence: earned tier (unchanged celebratory copy) ────

def test_earned_tier_single_merchant_has_boundary_spaces():
    line = _verified_saving_sentence("Nandos", 49.1, "earned")
    assert line == (
        "You did it, payments to Nandos have stopped. "
        "That's ~£49/mo staying in your pocket."
    )
    # The exact defect this guards: a merchant name flush against the next word.
    assert "Nandoshave" not in line
    assert " have" in line
    assert "Nandos have" in line


def test_earned_tier_no_merchant_falls_back_to_generic_phrasing():
    line = _verified_saving_sentence(None, 12.99, "earned")
    assert line == "You did it, that payment has stopped. That's ~£13/mo staying in your pocket."
    assert "None" not in line


def test_earned_tier_empty_string_merchant_treated_as_absent():
    line = _verified_saving_sentence("   ", 5, "earned")
    assert line.startswith("You did it, that payment has stopped.")


def test_earned_tier_thousands_separator_preserved():
    line = _verified_saving_sentence("Big Landlord", 1234, "earned")
    assert "£1,234/mo" in line


# ── _verified_saving_sentence: fact tier (new honest default) ──────────────

def test_fact_tier_has_no_celebratory_language():
    line = _verified_saving_sentence("Nandos", 49.1, "fact")
    assert line == "Payments to Nandos stopped. That was ~£49/mo."
    assert "You did it" not in line
    assert "staying in your pocket" not in line
    assert "Nandosstopped" not in line  # same boundary-space discipline as earned tier


def test_fact_tier_no_merchant_falls_back_to_generic_phrasing():
    line = _verified_saving_sentence(None, 12.99, "fact")
    assert line == "That payment stopped. That was ~£13/mo."


def test_fact_tier_whole_pounds_have_no_decimal():
    line = _verified_saving_sentence("Netflix", 15, "fact")
    assert "£15/mo" in line
    assert "£15.00" not in line


def test_fact_tier_merchant_with_stray_internal_whitespace_still_single_spaced():
    line = _verified_saving_sentence("Big   Co", 20, "fact")
    assert "  " not in line
    assert "Big Co stopped" in line


# ── _verified_copy_tier ─────────────────────────────────────────────────────

def test_copy_tier_no_engagement_at_all_is_fact():
    d = {"verified_at": datetime(2026, 8, 20)}
    assert _verified_copy_tier(d) == "fact"


def test_copy_tier_engagement_after_verification_is_fact():
    # Opened the card AFTER the win already fired (e.g. clicked into the
    # celebration itself) — that's not evidence of engagement BEFORE the
    # change, so it must not earn the celebratory tier.
    verified_at = datetime(2026, 8, 20)
    d = {"verified_at": verified_at, "card_opened_at": verified_at + timedelta(hours=1)}
    assert _verified_copy_tier(d) == "fact"


def test_copy_tier_engagement_before_verification_is_earned():
    verified_at = datetime(2026, 8, 20)
    d = {"verified_at": verified_at, "card_opened_at": verified_at - timedelta(days=10)}
    assert _verified_copy_tier(d) == "earned"


def test_copy_tier_no_verified_at_is_fact_even_with_card_opened():
    d = {"card_opened_at": datetime(2026, 8, 1)}
    assert _verified_copy_tier(d) == "fact"


# ── _substituted_line ───────────────────────────────────────────────────────

def test_substituted_line_matches_the_owner_review_wording():
    line = _substituted_line("Nandos", "Eating Out")
    assert line == (
        "Payments to Nandos stopped, but Eating Out overall hasn't moved. "
        "Worth a look at where it went."
    )


def test_substituted_line_no_merchant_or_category_falls_back():
    line = _substituted_line(None, None)
    assert line == (
        "That payment stopped, but your overall spending here hasn't moved. "
        "Worth a look at where it went."
    )


# ── Sibling: multi-merchant join in the LLM-authored title is untouched ────
# (verifies the stored title for the same real-world insight, "You spend
# ~£60/mo on Nandos and McDonald's", already joins merchant names cleanly —
# that text comes from the model, not from a deterministic template, so
# there is no code-level join logic to unit test here; this just pins the
# expectation that the join reads correctly, guarding against a future
# regression in _house_style mangling an "X and Y" phrase.)

def test_house_style_does_not_disturb_and_joined_merchant_title():
    from app.routers.savings_insights import _house_style
    title = "You spend ~£60/mo on Nandos and McDonald's"
    assert _house_style(title) == title


# ── _serialize_insight wiring ───────────────────────────────────────────────

def _base_doc(**overrides):
    d = {
        "_id": "abc123",
        "category": "subscriptions",
        "title": "Some title",
        "body": "Some body",
    }
    d.update(overrides)
    return d


def test_serialize_insight_defaults_to_fact_tier_when_no_engagement_recorded():
    # Existing docs have no card_opened_at at all — the honest default per
    # the owner-approved repair.
    doc = _base_doc(verified_savings=49.1, verified_merchant="Nandos", verified_at=datetime(2026, 8, 20))
    out = _serialize_insight(doc)
    assert out["verified_tier"] == "fact"
    assert out["verified_savings_line"] == "Payments to Nandos stopped. That was ~£49/mo."
    assert "You did it" not in out["verified_savings_line"]


def test_serialize_insight_earned_tier_when_engaged_before_verification():
    verified_at = datetime(2026, 8, 20)
    doc = _base_doc(
        verified_savings=49.1, verified_merchant="Nandos",
        verified_at=verified_at, card_opened_at=verified_at - timedelta(days=5),
    )
    out = _serialize_insight(doc)
    assert out["verified_tier"] == "earned"
    assert out["verified_savings_line"] == (
        "You did it, payments to Nandos have stopped. "
        "That's ~£49/mo staying in your pocket."
    )


def test_serialize_insight_verified_savings_line_null_when_not_verified():
    doc = _base_doc()
    out = _serialize_insight(doc)
    assert out["verified_savings_line"] is None
    assert out["verified_tier"] is None


def test_serialize_insight_exposes_substituted_line_and_flag():
    doc = _base_doc(
        category="eating_out",
        substituted_at=datetime(2026, 8, 27),
        substituted_merchant="Nandos",
        substituted_amount=49.1,
    )
    out = _serialize_insight(doc)
    assert out["substituted"] is True
    assert out["substituted_merchant"] == "Nandos"
    assert out["substituted_amount"] == 49.1
    assert out["substituted_line"] == (
        "Payments to Nandos stopped, but Eating Out overall hasn't moved. "
        "Worth a look at where it went."
    )
    # Not a verified saving — must never carry the celebratory fields.
    assert out["verified_savings"] is None
    assert out["verified_savings_line"] is None


def test_serialize_insight_substituted_false_when_not_substituted():
    doc = _base_doc()
    out = _serialize_insight(doc)
    assert out["substituted"] is False
    assert out["substituted_line"] is None
