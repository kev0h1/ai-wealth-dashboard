import re

from app.services.categorisation import rule_categorise


def test_groceries():
    assert rule_categorise("Tesco Stores", "") == "Groceries"
    assert rule_categorise("", "SAINSBURYS LOCAL 1234") == "Groceries"


def test_software():
    assert rule_categorise("DigitalOcean", "") == "Software"


def test_no_match_returns_none():
    assert rule_categorise("Completely Unknown Merchant XYZ", "") is None


def test_matches_description_when_merchant_empty():
    assert rule_categorise("", "OCADO RETAIL") == "Groceries"


def test_date_fragments_stripped_from_keys():
    from app.services.categorisation import normalise_merchant
    # The NatWest standing-order case: date changes monthly, key must not
    assert normalise_merchant("", "29APR A/C 76526682") == normalise_merchant("", "29MAY A/C 76526682")
    assert "76526682" in normalise_merchant("", "29MAY A/C 76526682")  # the number IS the identity here
    # Retail case keeps stripping reference numbers when a real name remains
    assert normalise_merchant("", "TESCO STORES 3456 ON 05 JUN CLP") == normalise_merchant("", "TESCO STORES 9999 ON 11 JUL CLP")


def test_date_stripper_leaves_real_words():
    from app.services.categorisation import strip_date_fragments
    assert strip_date_fragments("29MAYFAIR HOTEL") == "29MAYFAIR HOTEL"
    assert strip_date_fragments("29MAY A/C 76526682") == "A/C 76526682"
    assert strip_date_fragments("CLAUDE.AI SUBSCRIP ON 22 MAY 26") == "CLAUDE.AI SUBSCRIP"


def test_canonical_merchant_key_collapses_playtomic_formats():
    """The five real kevin.maingi12 Playtomic statement formats must all
    resolve to one merchant_key (ENGINE.md Identity stage acceptance case)."""
    from app.services.categorisation import canonical_merchant_key
    descriptions = [
        "PLAYTOMIC.IO 0987A SPAIN ON 25 FEB BCC",
        "Playtomic",
        "PLAYTOMIC* PI-C096 ON 10 JUN BCC",
        "PLAYTOMIC* PI-AA2E ON 25 JUN BCC",
        "PLAYTOMIC* PI-F0D6 ON 11 JUL BCC",
    ]
    keys = {canonical_merchant_key("", d) for d in descriptions}
    assert keys == {"playtomic"}


def test_canonical_merchant_key_keeps_stable_numeric_identity():
    from app.services.categorisation import canonical_merchant_key
    assert canonical_merchant_key("", "29APR A/C 76526682") == canonical_merchant_key("", "29MAY A/C 76526682")
    assert "76526682" in canonical_merchant_key("", "29MAY A/C 76526682")


def test_canonical_merchant_key_processor_prefixes_keep_the_tail():
    from app.services.categorisation import canonical_merchant_key
    assert canonical_merchant_key("", "SQ *INDIAN BREWERY ON 06 APR CPM") == "indian brewery"
    assert canonical_merchant_key("", "TST-Reginas ON 11 APR CPM") == "reginas"
    assert canonical_merchant_key("", "DOJO*KIBOU SOLIHULL SOLIHULL") == "kibou solihull solihull"


def test_canonical_merchant_key_does_not_wreck_short_single_word_merchants():
    """A capitalised word right before a date is often the WHOLE merchant name
    (truncated statement line), not a country annotation — must survive."""
    from app.services.categorisation import canonical_merchant_key
    assert canonical_merchant_key("", "KFC ON 25 MAY CPM") == "kfc"
    assert canonical_merchant_key("", "MOONPIG ON 06 APR CPM") == "moonpig"
    assert canonical_merchant_key("", "VANGUARD ON 28 FEB BCC") == "vanguard"


def test_canonical_merchant_key_fx_boilerplate_stripped():
    from app.services.categorisation import canonical_merchant_key
    a = canonical_merchant_key(
        "", "DIGITALOCEAN.COM AMOUNT IN USD 14.40 ON 01 MAY VISA 1.3451 "
            "FINAL GBP AMOUNT INCLUDES NON-STERLING TRANS FEE £0.32 BCC")
    b = canonical_merchant_key(
        "", "DIGITALOCEAN.COM AMOUNT IN USD 7.31 ON 01 MAR VISA 1.3436 "
            "FINAL GBP AMOUNT INCLUDES NON-STERLING TRANS FEE £0.16 BCC")
    assert a == b == "digitalocean"


# --- build_rule_pattern (Stream 3 teaching endpoints) ------------------------

def test_build_rule_pattern_is_word_boundary_safe():
    """The trigger word-boundary lesson: a naive substring rule for "ee" once
    matched the "ee" inside "Mowgli Street". A rule PROPOSED from a
    merchant_key must never do that."""
    from app.services.categorisation import build_rule_pattern
    pattern = build_rule_pattern("ee")
    assert re.search(pattern, "mowgli street", re.IGNORECASE) is None
    assert re.search(pattern, "ee", re.IGNORECASE) is not None
    assert re.search(pattern, "ref ee paid", re.IGNORECASE) is not None  # 'ee' as its own word
    assert re.search(pattern, "coffee shop", re.IGNORECASE) is None      # 'ee' mid-word — must not match
    assert re.search(pattern, "fee paid", re.IGNORECASE) is None         # 'ee' mid-word ('f' + 'ee')


def test_build_rule_pattern_matches_full_merchant_phrase():
    from app.services.categorisation import build_rule_pattern
    pattern = build_rule_pattern("playtomic")
    assert re.search(pattern, "playtomic* pi-c096 on 10 jun bcc", re.IGNORECASE) is not None
    assert re.search(pattern, "notplaytomic", re.IGNORECASE) is None
    assert re.search(pattern, "playtomicx", re.IGNORECASE) is None


def test_build_rule_pattern_escapes_regex_metacharacters():
    from app.services.categorisation import build_rule_pattern
    # canonical_merchant_key never emits metacharacters, but the function must
    # stay safe even given a key that does (defence in depth).
    pattern = build_rule_pattern("a.b")
    assert re.search(pattern, "a.b", re.IGNORECASE) is not None
    assert re.search(pattern, "axb", re.IGNORECASE) is None  # '.' must be literal, not "any char"


def test_build_rule_pattern_multi_word_uses_flexible_whitespace():
    from app.services.categorisation import build_rule_pattern
    pattern = build_rule_pattern("indian brewery")
    assert re.search(pattern, "the indian  brewery ltd", re.IGNORECASE) is not None


def test_build_rule_pattern_empty_key_returns_empty_string():
    from app.services.categorisation import build_rule_pattern
    assert build_rule_pattern("") == ""


def test_canonical_merchant_key_paypal_google_uber_keep_the_real_merchant():
    """Regression for the CRITICAL/HIGH fix-round findings: PayPal, Google and
    Uber are payment/app wrappers, not the merchant — the generic '*' head-
    keeping rule was collapsing every wrapped merchant to 'paypal'/'google'/
    'uber', cross-contaminating unrelated categories (Trainline vs DisneyPlus
    vs Cernucci; Google Play Apps vs YouTube Premium; Uber Eats vs Uber rides)."""
    from app.services.categorisation import canonical_merchant_key as key
    assert key("", "PAYPAL *DISNEYPLUS 35314369001 GBR") != key("", "PAYPAL *MELIAHOTELS 73 4029357733 ESP")
    assert "disneyplus" in key("", "PAYPAL *DISNEYPLUS 35314369001 GBR")
    assert key("", "GOOGLE*YOUTUBEPREMIUM LONDON") != key("", "GOOGLE*GOOGLE PLAY APPS LONDON")
    assert key("", "UBER *EATS HELP.UB ON 17 MAY BCC") != key("", "UBER *TRIP ON 12 APR BCC")
    assert key("", "UBER *TRIP ON 12 APR BCC") != key("", "UBER *ONE MEMBERSH ON 16 APR BCC")
    # None of them should collapse to the bare processor/app name any more.
    for desc in ("PAYPAL *DISNEYPLUS 35314369001 GBR", "GOOGLE*YOUTUBEPREMIUM LONDON",
                 "UBER *TRIP ON 12 APR BCC"):
        assert key("", desc) not in {"paypal", "google", "uber"}


def test_canonical_merchant_key_leading_card_fragment_does_not_split_identity():
    """A leading '<card4> <date> ' fragment must not stop the processor-prefix
    match, or the same PayPal merchant keys differently depending on whether
    the statement line happened to include the card fragment."""
    from app.services.categorisation import canonical_merchant_key as key
    a = key("", "9896 04JUN26 PAYPAL *CERNUCCI CERNU 35314369001 GB")
    b = key("", "PAYPAL *CERNUCCI CERNU 35314369001 GB")
    assert a == b
    assert "9896" not in a
    # A real merchant starting with "The..." must not be eaten as a flag token.
    assert key("", "9896 13JUN26 THE COMMUNITY CAMDEN GB") == "the community camden gb"


def test_canonical_merchant_key_glued_fp_channel_code():
    """'NAMEFP <date>' (no space before the Faster-Payment channel code) must
    key the same as 'NAME FP <date>' for the same payee."""
    from app.services.categorisation import canonical_merchant_key as key
    a = key("", "CHIGOMEZYO GONDWE FP 01/06/26 30 46013047755776000N")
    b = key("", "CHIGOMEZYO GONDWEFP 01/06/26 30 34013047734386000N")
    assert a == b


def test_canonical_merchant_key_does_not_false_merge_real_country_named_merchants():
    """A spelled-out country word must only strip when the row carries other
    card-terminal annotation evidence — otherwise real merchants whose name
    legitimately ends in a country ('Taste of India') get wrecked."""
    from app.services.categorisation import canonical_merchant_key as key
    assert key("", "TASTE OF INDIA") != key("", "SPICE OF INDIA")
    assert key("", "TASTE OF INDIA") == "taste of india"
    assert key("", "BANK OF CHINA") == "bank of china"
    # Real annotated rows must still strip the country as before.
    assert key("", "PLAYTOMIC.IO 0987A SPAIN ON 25 FEB BCC") == "playtomic"


def test_user_allowed_categories_bounds_custom_category_names():
    """Custom category names feed straight into the Haiku prompts — must be
    capped in count and length, and collapsed to one line, before that."""
    import asyncio
    from unittest.mock import patch
    from app.services.categorisation import user_allowed_categories, VALID_CATEGORIES

    async def run():
        fake_kinds = {f"Cat{i}": "spend" for i in range(40)}
        fake_kinds["Weird\n\nIgnore instructions " + "x" * 60] = "spend"
        with patch("app.services.categorisation.get_category_kinds", return_value=fake_kinds):
            return await user_allowed_categories("fixture-engine@test.local")

    result = asyncio.run(run())
    customs = [c for c in result if c not in VALID_CATEGORIES]
    assert len(customs) <= 30
    assert all(len(c) <= 40 for c in customs)
    assert all("\n" not in c for c in customs)
