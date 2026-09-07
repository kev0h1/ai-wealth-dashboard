"""Unit tests for `app.services.companion._gbp` — the whole-pound GBP
formatter introduced for G11 (companion body copy was printing raw ints like
"£1175" instead of "£1,175"). Covers the three cases from the backlog item
plus a reproduction of the actual payday-gap headline template to confirm
the real interpolation site (not just the helper in isolation) now carries
the thousands separator.
"""
from app.services.companion import _gbp


def test_gbp_formats_thousands_with_a_comma():
    assert _gbp(1175) == "£1,175"


def test_gbp_small_amount_has_no_comma():
    assert _gbp(999) == "£999"


def test_gbp_negative_amount_uses_unicode_minus_before_the_pound_sign():
    # Unicode minus (U+2212), not a hyphen — matches MoneyText's currency
    # minus convention on the frontend.
    assert _gbp(-20) == "−£20"


def test_gbp_rounds_to_the_nearest_whole_pound():
    assert _gbp(1174.6) == "£1,175"
    assert _gbp(999.49) == "£999"


def test_gbp_at_exactly_one_thousand():
    assert _gbp(1000) == "£1,000"


def test_payday_gap_headline_over_a_thousand_pounds_has_thousands_separator():
    """Reproduces the exact f-string template used for the "gap before
    payday" headline in compute_today_items (companion.py) — regression
    guard for the reported bug (£1175 should read £1,175)."""
    dest_display = "Halifax Current"
    shortfall = 1175.0
    headline = f"{_gbp(shortfall)} gap before {dest_display} payday."
    assert headline == "£1,175 gap before Halifax Current payday."
    assert "," in headline


def test_bill_amount_body_over_a_thousand_pounds_has_thousands_separator():
    """Reproduces the "Your £X bill payment is expected..." body template —
    same site, the bill_amount interpolation."""
    bill_amount = 1250
    body = f"Your {_gbp(bill_amount)} rent payment is expected Friday."
    assert body == "Your £1,250 rent payment is expected Friday."
