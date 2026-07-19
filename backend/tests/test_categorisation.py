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
