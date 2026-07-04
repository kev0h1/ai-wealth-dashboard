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
