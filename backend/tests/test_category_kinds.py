"""G39: Mortgage and Car finance are new built-in categories, kind
COMMITMENT (real spend, not freely chosen -- a mortgage/car-finance payment
is partly principal and partly interest, but the user doesn't choose
whether to make it this period the way they choose whether to eat out).

These tests exercise app.services.categories directly: the declared kind,
the single kind-map helper (kind_of/is_commitment/is_spend/is_non_spend),
and that the two names are real built-ins (BUILTIN_CATEGORIES), not a
custom-category-shaped afterthought. See tests/test_categorisation.py for
the deterministic-categoriser side (does a real transaction land in the
category at all) and tests/test_money_shape.py for the money-shape "Fixed
bucket inherits COMMITMENT" consequence.
"""
from app.services.categories import (
    BUILTIN_CATEGORIES,
    BUILTIN_CATEGORY_KINDS,
    COMMITMENT,
    CategoryKinds,
    is_commitment,
    is_discretionary,
    is_non_spend,
    is_spend,
    kind_of,
)


def test_mortgage_and_car_finance_are_builtin_categories():
    assert "Mortgage" in BUILTIN_CATEGORIES
    assert "Car finance" in BUILTIN_CATEGORIES


def test_mortgage_and_car_finance_declared_commitment_kind():
    assert BUILTIN_CATEGORY_KINDS["Mortgage"] == COMMITMENT
    assert BUILTIN_CATEGORY_KINDS["Car finance"] == COMMITMENT


def test_kind_of_and_predicates_agree_for_mortgage_and_car_finance():
    kinds = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
    for cat in ("Mortgage", "Car finance"):
        assert kind_of(kinds, cat) == COMMITMENT
        assert is_commitment(kinds, cat) is True
        assert is_discretionary(kinds, cat) is False
        # COMMITMENT is real spend: it must count toward Safe-to-Spend and
        # the Spend page's totals, not be excluded as movement/income.
        assert is_spend(kinds, cat) is True
        assert is_non_spend(kinds, cat) is False


def test_kind_of_tolerant_to_case_and_whitespace():
    kinds = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
    assert kind_of(kinds, "  mortgage ") == COMMITMENT
    assert kind_of(kinds, "CAR FINANCE") == COMMITMENT


def test_mortgage_and_car_finance_sit_next_to_bills_in_display_order():
    """Insertion order in BUILTIN_CATEGORY_KINDS is BUILTIN_CATEGORIES'
    display order (see that module's own docstring) -- Mortgage/Car finance
    should read as siblings of Bills, not tacked on at the end."""
    order = BUILTIN_CATEGORIES
    assert order.index("Bills") < order.index("Mortgage") < order.index("Car finance") < order.index("Subscriptions")
