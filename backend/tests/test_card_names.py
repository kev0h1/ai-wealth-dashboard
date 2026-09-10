"""Coverage for app.services.card_names (G15): the display-name pass that
turns raw bank card descriptors from GET /cards/story into clean,
disambiguated labels.

Fixtures below are synthetic — shaped like the real production rows G15's
ticket captured from Mongo (never real user data), specifically to exercise
every rule the ticket called out: four/five-way and two-way duplicate
groups, bare-last-four vs masked-PAN account numbers, a missing account
number, a descriptor that already names the bank, shouty-vs-already-mixed
case, holder-name-shaped descriptors (both the comma form and the
session-name-match form), an unrecognised provider falling back to a
title-cased raw value, and the generic "Credit Card" descriptor.
"""
from app.services.card_names import (
    apply_card_display_names,
    build_display_name,
    last_four,
    looks_like_holder_name,
    provider_display_name,
)


# ── provider_display_name ───────────────────────────────────────────────────

def test_provider_display_name_known_providers_case_insensitive():
    assert provider_display_name("NATWEST") == "NatWest"
    assert provider_display_name("NatWest") == "NatWest"
    assert provider_display_name("BARCLAYS") == "Barclays"
    assert provider_display_name("AMEX") == "American Express"
    assert provider_display_name("MS") == "Marks & Spencer"


def test_provider_display_name_strips_trailing_uk():
    assert provider_display_name("Chase UK") == "Chase"


def test_provider_display_name_unknown_provider_title_cased_fallback():
    assert provider_display_name("SOME NEW BANK") == "Some New Bank"
    assert provider_display_name("some new bank") == "Some new bank".title()


def test_provider_display_name_missing():
    assert provider_display_name(None) == "Card"
    assert provider_display_name("") == "Card"


# ── last_four ────────────────────────────────────────────────────────────────

def test_last_four_bare_value():
    assert last_four("6271") == "6271"


def test_last_four_masked_pan():
    assert last_four("546811******1432") == "1432"


def test_last_four_missing():
    assert last_four(None) is None
    assert last_four("") is None


def test_last_four_too_short():
    assert last_four("12") is None


# ── looks_like_holder_name ───────────────────────────────────────────────────

def test_comma_title_form_is_holder_name():
    assert looks_like_holder_name("MAINGI,KEVIN MBITHI/MR") is True
    assert looks_like_holder_name("SMITH,JOHN A/MR") is True
    # lower-case title suffix and no space after comma still match
    assert looks_like_holder_name("smith,john a/mr") is True


def test_three_word_allcaps_name_is_holder_name():
    assert looks_like_holder_name("CHIGOMEZYO CHUB GOND") is True


def test_two_word_allcaps_product_name_is_not_holder_name():
    # "IBCM PLATINUM" and "MASTERCARD" must NOT be mistaken for a name —
    # this is the false-positive guard the two-word exclusion exists for.
    assert looks_like_holder_name("IBCM PLATINUM") is False
    assert looks_like_holder_name("MASTERCARD") is False


def test_three_word_descriptor_with_product_word_is_not_holder_name():
    assert looks_like_holder_name("PREMIER BUSINESS GOLD") is False


def test_generic_credit_card_is_not_holder_name():
    assert looks_like_holder_name("Credit Card") is False


def test_descriptor_matching_session_holder_name():
    # A plain two-word descriptor that doesn't meet the 3-word structural
    # bar, but matches the CURRENT session's own OAuth name.
    assert looks_like_holder_name("KEVIN MAINGI", holder_name="Kevin Maingi") is True
    assert looks_like_holder_name("MAINGI KEVIN", holder_name="Kevin Maingi") is True


def test_descriptor_not_matching_session_holder_name():
    assert looks_like_holder_name("CHIGOMEZYO CHUB GOND", holder_name="Kevin Maingi") is True  # via 3-word rule
    assert looks_like_holder_name("IBCM PLATINUM", holder_name="Kevin Maingi") is False


def test_already_mixed_case_amex_descriptors_are_not_holder_name():
    assert looks_like_holder_name("American Express® Corporate Green C") is False
    assert looks_like_holder_name("British Airways American Express® C") is False


# ── Regression: rule 2 must not eat mixed-case product names ───────────────
#
# A real bug found in review: the original rule 2 matched ANY 3+-word
# alphabetic descriptor regardless of case (the code didn't match its own
# "ALL-CAPS" docstring), so a genuine mixed-case card product name like
# "Sainsburys Nectar Dual" or "John Lewis Partnership" was misclassified as
# a holder name and its descriptor was thrown away and replaced with just
# the bank name — worse than the shouty-name problem the ticket set out to
# fix. Fixed two ways: (1) rule 2 now requires the descriptor to be
# genuinely ALL-CAPS (core.isupper()) before it can fire at all, and (2)
# `build_display_name` checks `_provider_already_named` BEFORE the
# holder-name rules, since a descriptor that already names its own bank is
# definitionally not a bare cardholder name.

def test_mixed_case_three_word_product_names_are_not_holder_name_shaped():
    assert looks_like_holder_name("Sainsburys Nectar Dual") is False
    assert looks_like_holder_name("John Lewis Partnership") is False
    assert looks_like_holder_name("Virgin Atlantic Reward Plus") is False
    assert looks_like_holder_name("Tesco Clubcard Credit") is False


def test_mixed_case_product_names_survive_build_display_name_unchanged():
    # All four already name their own bank (once spacing/punctuation is
    # squashed out), so they take the "provider already named" path and
    # come back completely unprefixed and unmodified — never collapsed
    # down to just the bank name.
    assert build_display_name("Sainsburys Nectar Dual", "SAINSBURYS") == "Sainsburys Nectar Dual"
    assert build_display_name("John Lewis Partnership", "JOHNLEWIS") == "John Lewis Partnership"
    assert build_display_name("Virgin Atlantic Reward Plus", "VIRGIN") == "Virgin Atlantic Reward Plus"
    assert build_display_name("Tesco Clubcard Credit", "TESCO") == "Tesco Clubcard Credit"


def test_mixed_case_three_word_descriptor_not_naming_its_provider_is_still_preserved():
    # Even when the bank ISN'T already named in the descriptor, a
    # mixed-case 3-word descriptor must never be treated as a holder name
    # — the product text is preserved, just with the ordinary bank prefix
    # (rule 4), not discarded in favour of the bare bank name.
    assert looks_like_holder_name("Reward Explorer Plan") is False
    name = build_display_name("Reward Explorer Plan", "MONZO")
    assert name == "Monzo Reward Explorer Plan"
    assert "Reward Explorer Plan" in name


# ── build_display_name (pure, single card, no disambiguation) ──────────────

def test_shouty_descriptor_is_title_cased_and_prefixed():
    assert build_display_name("MASTERCARD", "NATWEST") == "NatWest Mastercard"
    assert build_display_name("IBCM PLATINUM", "BARCLAYS") == "Barclays Ibcm Platinum"


def test_provider_already_named_is_not_doubled():
    name = build_display_name("American Express® Corporate Green C", "AMEX")
    assert name == "American Express® Corporate Green C"
    assert "American Express American Express" not in name

    name2 = build_display_name("British Airways American Express® C", "AMEX")
    assert name2 == "British Airways American Express® C"
    assert "American Express British Airways" not in name2


def test_already_mixed_case_descriptor_left_alone_when_not_prefixed():
    # Not a real fixture from the ticket, but exercises rule 5 directly:
    # an already-mixed-case descriptor that does NOT name the bank still
    # gets the bank prefix (rule 2) without being re-cased.
    assert build_display_name("Rewards Card", "MONZO") == "Monzo Rewards Card"


def test_generic_credit_card_gets_bank_prefix():
    assert build_display_name("Credit Card", "Chase UK") == "Chase Credit Card"


def test_holder_name_descriptor_falls_back_to_bank_name():
    assert build_display_name("MAINGI,KEVIN MBITHI/MR", "HSBC") == "HSBC"
    assert build_display_name("CHIGOMEZYO CHUB GOND", "MS") == "Marks & Spencer"


def test_missing_name_falls_back_to_bank_name():
    assert build_display_name(None, "NATWEST") == "NatWest"
    assert build_display_name("", "NATWEST") == "NatWest"


def test_unknown_provider_fallback_used_in_prefix():
    assert build_display_name("PLATINUM CARD", "SOME NEW BANK") == "Some New Bank Platinum Card"


# ── apply_card_display_names (set-level disambiguation) ────────────────────

def _card(account_id, name, provider, account_number=None, **extra):
    return {"account_id": account_id, "name": name, "provider": provider,
            "account_number": account_number, **extra}


def test_five_way_natwest_mastercard_duplicate_group_disambiguated():
    # Mirrors the real production shape: five "MASTERCARD"/NatWest rows,
    # two of which additionally collide on last-four (a bare last-four and
    # a masked PAN that happen to end the same way), needing the ordinal
    # fallback on top of the last-four pass.
    cards = [
        _card("a1", "MASTERCARD", "NATWEST", "6271"),
        _card("a2", "MASTERCARD", "NATWEST", "1432"),
        _card("a3", "MASTERCARD", "NATWEST", "8391"),
        _card("a4", "MASTERCARD", "NatWest", "546811******1432"),
        _card("a5", "MASTERCARD", "NatWest", "552213******6271"),
    ]
    out = apply_card_display_names(cards)
    names = [c["display_name"] for c in out]
    assert names == [
        "NatWest Mastercard 6271",
        "NatWest Mastercard 1432",
        "NatWest Mastercard 8391",
        "NatWest Mastercard 1432 (2)",
        "NatWest Mastercard 6271 (2)",
    ]
    assert len(set(names)) == len(names)
    # raw `name` untouched
    assert all(c["name"] == "MASTERCARD" for c in out)


def test_two_way_ibcm_platinum_duplicate_group_disambiguated():
    cards = [
        _card("b1", "IBCM PLATINUM", "BARCLAYS", "5005"),
        _card("b2", "IBCM PLATINUM", "BARCLAYS", "7003"),
    ]
    out = apply_card_display_names(cards)
    names = [c["display_name"] for c in out]
    assert names == ["Barclays Ibcm Platinum 5005", "Barclays Ibcm Platinum 7003"]


def test_duplicate_group_with_missing_account_number_falls_back_to_ordinal():
    cards = [
        _card("c1", "MASTERCARD", "NATWEST", "1111"),
        _card("c2", "MASTERCARD", "NATWEST", None),
    ]
    out = apply_card_display_names(cards)
    names = [c["display_name"] for c in out]
    # c2 has no account number to append, so it keeps the bare base name;
    # since that no longer collides with c1's (now last-four-suffixed)
    # name, no ordinal is needed either.
    assert names == ["NatWest Mastercard 1111", "NatWest Mastercard"]
    assert len(set(names)) == 2


def test_two_cards_missing_account_number_both_use_ordinal():
    cards = [
        _card("d1", "MASTERCARD", "NATWEST", None),
        _card("d2", "MASTERCARD", "NATWEST", None),
    ]
    out = apply_card_display_names(cards)
    names = [c["display_name"] for c in out]
    assert names == ["NatWest Mastercard", "NatWest Mastercard (2)"]


def test_unique_names_are_not_suffixed():
    cards = [
        _card("e1", "Credit Card", "Chase UK", "4699"),
        _card("e2", "American Express® Corporate Green C", "AMEX", "1009"),
    ]
    out = apply_card_display_names(cards)
    names = [c["display_name"] for c in out]
    assert names == ["Chase Credit Card", "American Express® Corporate Green C"]


def test_holder_name_fallback_participates_in_set_level_disambiguation():
    # Two different holder-name-shaped cards at the SAME bank would both
    # fall back to the bank name and collide; that collision must still be
    # caught by the set-level pass like any other duplicate.
    cards = [
        _card("f1", "MAINGI,KEVIN MBITHI/MR", "HSBC", "2786"),
        _card("f2", "SOME,OTHER PERSON/MRS", "HSBC", "9999"),
    ]
    out = apply_card_display_names(cards)
    names = [c["display_name"] for c in out]
    assert names == ["HSBC 2786", "HSBC 9999"]


def test_apply_card_display_names_does_not_mutate_input():
    cards = [_card("g1", "MASTERCARD", "NATWEST", "1234")]
    apply_card_display_names(cards)
    assert "display_name" not in cards[0]


def test_full_real_shaped_set_matches_expected_table():
    """End-to-end pass over synthetic fixtures shaped exactly like the 12
    real production rows the G15 ticket captured (values changed, no real
    user data), holder_name="Kevin Maingi" standing in for the session."""
    cards = [
        _card("1", "MASTERCARD", "NATWEST", "6271"),
        _card("2", "MASTERCARD", "NATWEST", "1432"),
        _card("3", "MASTERCARD", "NATWEST", "8391"),
        _card("4", "MASTERCARD", "NatWest", "546811******1432"),
        _card("5", "MASTERCARD", "NatWest", "552213******6271"),
        _card("6", "IBCM PLATINUM", "BARCLAYS", "5005"),
        _card("7", "IBCM PLATINUM", "BARCLAYS", "7003"),
        _card("8", "MAINGI,KEVIN MBITHI/MR", "HSBC", "2786"),
        _card("9", "CHIGOMEZYO CHUB GOND", "MS", "7134"),
        _card("10", "American Express® Corporate Green C", "AMEX", "1009"),
        _card("11", "British Airways American Express® C", "AMEX", "2000"),
        _card("12", "Credit Card", "Chase UK", "555901******4699"),
    ]
    out = apply_card_display_names(cards, holder_name="Kevin Maingi")
    got = {c["account_id"]: c["display_name"] for c in out}
    assert got == {
        "1": "NatWest Mastercard 6271",
        "2": "NatWest Mastercard 1432",
        "3": "NatWest Mastercard 8391",
        "4": "NatWest Mastercard 1432 (2)",
        "5": "NatWest Mastercard 6271 (2)",
        "6": "Barclays Ibcm Platinum 5005",
        "7": "Barclays Ibcm Platinum 7003",
        "8": "HSBC",
        "9": "Marks & Spencer",
        "10": "American Express® Corporate Green C",
        "11": "British Airways American Express® C",
        "12": "Chase Credit Card",
    }
    names = list(got.values())
    assert len(set(names)) == len(names)
