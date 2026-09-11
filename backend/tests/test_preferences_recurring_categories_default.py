"""G39 fix: app/routers/preferences.py used to carry its own hand-typed copy
of analytics.py's DEFAULT_RECURRING_CATEGORIES for the GET /preferences
`recurring_categories` fallback -- a second hardcoded list that would have
silently gone stale the moment G39 added Mortgage/Car finance to the real
one. preferences.py now imports the constant instead of re-typing it; this
test is the guard against that drift reopening."""
from app.routers.analytics import DEFAULT_RECURRING_CATEGORIES as ANALYTICS_DEFAULT
from app.routers.preferences import DEFAULT_RECURRING_CATEGORIES as PREFERENCES_DEFAULT


def test_preferences_recurring_default_is_the_same_object_as_analytics():
    # Imported, not re-typed -- same list object, not just an equal-looking one.
    assert PREFERENCES_DEFAULT is ANALYTICS_DEFAULT


def test_preferences_recurring_default_includes_mortgage_and_car_finance():
    assert "Mortgage" in PREFERENCES_DEFAULT
    assert "Car finance" in PREFERENCES_DEFAULT
