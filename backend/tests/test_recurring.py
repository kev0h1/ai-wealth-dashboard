from datetime import datetime, timedelta

from app.routers.analytics import _detect_recurring, DEFAULT_RECURRING_CATEGORIES

TRUSTED = set(DEFAULT_RECURRING_CATEGORIES)
BASE = datetime(2026, 4, 1)


def txn(merchant, day_offset, amount, category="Other"):
    return {
        "merchant_name": merchant,
        "description": merchant,
        "amount": amount,
        "date": BASE + timedelta(days=day_offset),
        "category": category,
        "custom_category": None,
        "account_id": "acc1",
    }


def keys(results):
    return {r["key"] for r in results}


def test_trusted_category_qualifies_at_two_occurrences():
    txns = [txn("EE LIMITED", 0, 25.84, "Bills"), txn("EE LIMITED", 30, 25.84, "Bills")]
    assert "EE LIMITED" in keys(_detect_recurring(txns, trusted_categories=TRUSTED))


def test_untrusted_two_visits_rejected():
    # Restaurant visited twice ~25 days apart — the old false positive
    txns = [txn("Noble Rahedi", 0, 36.40, "Eating Out"), txn("Noble Rahedi", 25, 61.10, "Eating Out")]
    assert keys(_detect_recurring(txns, trusted_categories=TRUSTED)) == set()


def test_untrusted_irregular_intervals_rejected():
    # Three visits but no cadence: gaps of 24 and 11 days
    txns = [txn("Cafe", 0, 12, "Eating Out"), txn("Cafe", 24, 12, "Eating Out"), txn("Cafe", 35, 12, "Eating Out")]
    assert keys(_detect_recurring(txns, trusted_categories=TRUSTED)) == set()


def test_untrusted_varying_amounts_rejected():
    # Perfect weekly cadence but wildly different amounts = habit, not a bill
    txns = [txn("Shop", 0, 10, "Shopping"), txn("Shop", 7, 45, "Shopping"), txn("Shop", 14, 90, "Shopping")]
    assert keys(_detect_recurring(txns, trusted_categories=TRUSTED)) == set()


def test_untrusted_true_pattern_accepted():
    # Barber every 28 days, same price — earns its way in despite Beauty not being trusted
    txns = [txn("Barber", 0, 20, "Beauty"), txn("Barber", 28, 20, "Beauty"), txn("Barber", 56, 22, "Beauty")]
    assert "Barber" in keys(_detect_recurring(txns, trusted_categories=TRUSTED))


def test_legacy_mode_unchanged_for_income():
    txns = [txn("ACME PAYROLL", 0, 4800, "Income"), txn("ACME PAYROLL", 30, 4800, "Income")]
    assert "ACME PAYROLL" in keys(_detect_recurring(txns))
