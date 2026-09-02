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


def today_at(day_offset):
    """A `today` a few days after `day_offset`, as a `date` (not `datetime`).

    `_detect_recurring`'s staleness guard (added 2026-08-27, see
    analytics.py) drops a bill series whose most recent occurrence is more
    than `max(2*avg_interval, 45)` days before `today`. These acceptance
    tests only care about detection, not projection, and previously left
    `today` on its real-wall-clock default — which silently stopped working
    the moment the guard existed, since BASE (2026-04-01) drifts further
    into the past every day the suite runs. Pinning `today` shortly after
    the fixture's own last occurrence removes that wall-clock dependency for
    good, matching the convention test_recurring_projection.py already uses.
    """
    return (BASE + timedelta(days=day_offset)).date()


def test_trusted_category_qualifies_at_two_occurrences():
    txns = [txn("EE LIMITED", 0, 25.84, "Bills"), txn("EE LIMITED", 30, 25.84, "Bills")]
    assert "EE LIMITED" in keys(_detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(33)))


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
    assert "Barber" in keys(_detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(60)))


def test_legacy_mode_unchanged_for_income():
    # is_income is NOT passed here (defaults False), so the staleness guard
    # does apply to this call despite the test's name — it's testing
    # "legacy mode" (no trusted_categories), not the income code path.
    txns = [txn("ACME PAYROLL", 0, 4800, "Income"), txn("ACME PAYROLL", 30, 4800, "Income")]
    assert "ACME PAYROLL" in keys(_detect_recurring(txns, today=today_at(33)))


# ── Regression: 2026-08-27 "Transfer wasn't trusted" bug ────────────────
#
# Real case: Kevin's own-transfer standing orders (HSBC/Monzo/NatWest
# Main/Revolut/Chase) had 3 in-window occurrences on 2026-08-26 and only 2
# on 2026-08-27 once the oldest one aged past the 90-day cutoff overnight —
# one day before their real payday occurrence. `debits` (the caller,
# `_compute_cashflow_patterns`) already includes Transfer-category rows
# with no category filter specifically so an own-transfer counts as a bill
# (it consumes balance), but `DEFAULT_RECURRING_CATEGORIES` left "Transfer"
# out of the TRUSTED set, so that inclusion was hollow: at 2 occurrences a
# Transfer series needed the same 3-occurrence proof as an unproven
# merchant, while sibling Savings/Investment series survived the identical
# overnight cliff untouched. Two same-account same-day-window siblings
# (Rainy Day Saver, Foris/Freetrade — Savings/Investment) already proved
# 2-occurrence trust is the correct bar for this cadence; Transfer just
# needed to be added to the same tier it always structurally belonged to.

def test_transfer_category_now_trusted_at_two_occurrences():
    # Kevin's actual K MONZO TEST STO: 2 occurrences, 35 days apart, same
    # amount each time — must be detected the same way a Bills/Savings
    # series already is at 2 occurrences.
    txns = [txn("K MONZO TEST STO", 0, 1106.0, "Transfer"), txn("K MONZO TEST STO", 35, 1106.0, "Transfer")]
    assert "K MONZO TEST STO" in keys(_detect_recurring(txns, trusted_categories=TRUSTED, today=today_at(38)))


def test_transfer_category_still_rejects_two_occurrence_noise():
    # The genuine protection this trust tier must NOT weaken: a 2-occurrence
    # series under 21 days apart is exactly the signature of a bounced
    # direct debit + its retry (or an ingestion duplicate), not a monthly
    # standing order. This guard (analytics.py, "if len(items) == 2 and
    # avg_interval < 21") runs BEFORE the trust-tier check and applies
    # regardless of category, so trusting Transfer at 2 occurrences must
    # still reject this.
    txns = [txn("REVOLUT TRANSFER", 0, 500.0, "Transfer"), txn("REVOLUT TRANSFER", 7, 500.0, "Transfer")]
    assert keys(_detect_recurring(txns, trusted_categories=TRUSTED)) == set()
