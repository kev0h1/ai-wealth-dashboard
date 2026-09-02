"""Unit tests for the BNPL fix (see app/services/bnpl.py's module docstring
for the bug this closes): a PayPal Pay-in-3 instalment descriptor embeds the
original purchase date, which `series_key`'s date-fragment stripping reads
as noise to collapse — so every plan from every purchase used to fall into
ONE bucket, and `_amount_clusters`'s 30% tolerance then braided instalments
from different purchases into a phantom series.

Two parts, tested independently:
  1. The guard — `_detect_recurring` excludes BNPL debits unconditionally,
     so the braiding bug cannot fire and `recurring_judge` never sees a
     BNPL series (it only ever sees `_detect_recurring`'s output).
  2. Plan reconstruction — `group_bnpl_plans` / `project_bnpl_instalments`
     rebuild real plan instances from the excluded debits and project only
     what a pay-in-3 plan still owes.

Fixtures use synthetic user/account ids built from the REAL observed PayPal
descriptor shape reported against a live account (never real user data).
"""
from datetime import date, datetime, timedelta

from app.routers.analytics import _detect_recurring, DEFAULT_RECURRING_CATEGORIES
from app.services.bnpl import (
    bnpl_provider,
    build_bnpl_projections,
    group_bnpl_plans,
    is_bnpl_txn,
    project_bnpl_instalments,
)
from app.services.recurring_judge import judge_suspect_series

TRUSTED = set(DEFAULT_RECURRING_CATEGORIES)
BASE = datetime(2026, 5, 31)


def dtxn(desc, amount, d, account_id="acc-syn-1", category="Shopping"):
    """A debit transaction dict, `_detect_recurring`'s own shape."""
    return {
        "merchant_name": "",
        "description": desc,
        "amount": -abs(amount),
        "date": datetime(d.year, d.month, d.day) if isinstance(d, date) else d,
        "category": category,
        "custom_category": None,
        "account_id": account_id,
        "transaction_type": "debit",
    }


def paypal_desc(ref, purchase_token, txn_id):
    return f"{ref} {purchase_token} PAYPAL *PYPL PAYIN3 {txn_id} GB"


# ── Matcher ──────────────────────────────────────────────────────────────────

def test_matcher_recognises_all_providers():
    cases = [
        ("KLARNA*a1b2c3", "Klarna"),
        ("Klarna Payment", "Klarna"),
        ("CLEARPAY", "Clearpay"),
        ("ZILCH*ORDER 123", "Zilch"),
        ("9896 31MAY26 PAYPAL *PYPL PAYIN3 8003587911 GB", "PayPal"),
        ("PAYPAL PAY IN 3 REF12345", "PayPal"),
        ("AFTERPAY US", "Afterpay"),
        ("LAYBUY LTD", "Laybuy"),
        ("MONZO FLEX PLAN", "Monzo Flex"),
    ]
    for desc, expected in cases:
        t = dtxn(desc, 25.0, BASE)
        assert bnpl_provider(t) == expected, desc
        assert is_bnpl_txn(t)


def test_matcher_rejects_ordinary_merchants():
    for desc in ["TESCO STORES 1234", "SAINSBURYS S/PAY", "NETFLIX.COM 18665797172", "EE LIMITED"]:
        assert bnpl_provider(dtxn(desc, 12.0, BASE)) is None
        assert not is_bnpl_txn(dtxn(desc, 12.0, BASE))


def test_matcher_checks_merchant_name_too():
    t = {"merchant_name": "Klarna", "description": "", "amount": -10, "date": BASE,
         "category": "Shopping", "custom_category": None, "account_id": "a", "transaction_type": "debit"}
    assert is_bnpl_txn(t)


# ── Part 1: the guard ────────────────────────────────────────────────────────

def test_guard_excludes_overlapping_paypal_plans_that_would_otherwise_braid():
    """The real case: two concurrent PayPal Pay-in-3 plans with close-enough
    amounts that the OLD 30%-tolerance amount clustering would braid their
    instalments into one fake series once series_key collapsed them onto
    the same bucket (both descriptors reduce to the same 35-char-cut,
    date-stripped key). With the guard, `_detect_recurring` must return
    ZERO series for any of these transactions."""
    # Card token ("9896") and PayPal's own merchant/processor reference
    # ("8003587911") are FIXED across a card's PayPal Pay-in-3 activity —
    # only the embedded purchase-date token varies per plan. That is
    # exactly why the pre-fix series_key collapse was total: stripping the
    # one varying token (the date) leaves byte-identical strings for every
    # plan on the card.
    txns = []
    for d in [date(2026, 5, 31), date(2026, 6, 30), date(2026, 7, 30)]:
        txns.append(dtxn(paypal_desc("9896", "31MAY26", "8003587911"), 26.66, d))
    for d in [date(2026, 6, 15), date(2026, 7, 15)]:
        txns.append(dtxn(paypal_desc("9896", "15JUN26", "8003587911"), 26.50, d))
    # Sanity: pre-fix, these WOULD collapse onto one series_key bucket —
    # confirm the shared-key premise still holds, then confirm the guard
    # keeps them out regardless.
    from app.services.categorisation import series_key
    keys = {series_key(t) for t in txns}
    assert len(keys) == 1, "fixture premise: both plans must share one series_key bucket"

    results = _detect_recurring(txns, trusted_categories=TRUSTED, today=date(2026, 8, 5))
    assert results == []


def test_guard_excludes_klarna_descriptor_end_to_end():
    txns = [dtxn(f"KLARNA*{i}", 40.0, d) for i, d in enumerate(
        [date(2026, 6, 1), date(2026, 7, 1), date(2026, 7, 31)]
    )]
    results = _detect_recurring(txns, trusted_categories=TRUSTED, today=date(2026, 8, 5))
    assert results == []


def test_guard_leaves_ordinary_bills_untouched():
    txns = [dtxn("EE LIMITED", 25.84, d, category="Bills") for d in
             [date(2026, 5, 31), date(2026, 6, 30)]]
    results = _detect_recurring(txns, trusted_categories=TRUSTED, today=date(2026, 7, 3))
    assert {r["key"] for r in results} == {"EE LIMITED"}


def test_judge_never_receives_bnpl_series():
    """`judge_suspect_series` only ever scans `_detect_recurring`'s own
    output (see recurring_judge.py's docstring) — since the guard keeps
    BNPL series out of that output entirely, the judge structurally never
    sees one. Assert the premise directly: run detection on a BNPL-only
    input (trusted category, so it WOULD hit the judge's suspect path if it
    survived at all) and confirm both the detector's output and what the
    judge is asked to review are empty."""
    txns = [dtxn(f"KLARNA*{i}", 40.0, d, category="Bills") for i, d in enumerate(
        [date(2026, 6, 1), date(2026, 7, 1)]
    )]
    recurring_spend = _detect_recurring(txns, trusted_categories=TRUSTED, today=date(2026, 7, 3))
    assert recurring_spend == []
    verdicts = asyncio_run(judge_suspect_series("syn-user", recurring_spend, {}))
    assert verdicts == {}


def asyncio_run(coro):
    import asyncio
    return asyncio.run(coro)


# ── Part 2: plan reconstruction ──────────────────────────────────────────────

def test_overlapping_paypal_plans_resolve_into_two_correct_groups():
    # Card token ("9896") and PayPal's own merchant/processor reference
    # ("8003587911") are FIXED across a card's PayPal Pay-in-3 activity —
    # only the embedded purchase-date token varies per plan. That is
    # exactly why the pre-fix series_key collapse was total: stripping the
    # one varying token (the date) leaves byte-identical strings for every
    # plan on the card.
    txns = []
    for d in [date(2026, 5, 31), date(2026, 6, 30), date(2026, 7, 30)]:
        txns.append(dtxn(paypal_desc("9896", "31MAY26", "8003587911"), 26.66, d))
    for d in [date(2026, 6, 15), date(2026, 7, 15)]:
        txns.append(dtxn(paypal_desc("9896", "15JUN26", "8003587911"), 26.50, d))

    plans = group_bnpl_plans(txns)
    assert len(plans) == 2
    by_anchor = {p["anchor"]: p for p in plans}
    assert date(2026, 5, 31) in by_anchor
    assert date(2026, 6, 15) in by_anchor
    assert len(by_anchor[date(2026, 5, 31)]["instalments"]) == 3
    assert len(by_anchor[date(2026, 6, 15)]["instalments"]) == 2
    # Never braided: the 3-instalment plan's dates must all belong to plan A
    assert [i["date"] for i in by_anchor[date(2026, 5, 31)]["instalments"]] == \
        [date(2026, 5, 31), date(2026, 6, 30), date(2026, 7, 30)]


def test_three_observed_projects_nothing():
    txns = [dtxn("CLEARPAY", 15.0, d) for d in
            [date(2026, 6, 1), date(2026, 7, 1), date(2026, 7, 31)]]
    assert build_bnpl_projections(txns) == []


def test_two_observed_projects_one_hedged_instalment():
    txns = [dtxn("KLARNA*x", 40.0, date(2026, 7, 1)), dtxn("KLARNA*x", 40.0, date(2026, 7, 31))]
    proj = build_bnpl_projections(txns)
    assert len(proj) == 1
    p = proj[0]
    assert p["instalment"] == 3 and p["of"] == 3
    assert p["date"] == date(2026, 8, 30)
    assert p["hedged"] is True
    assert p["amount"] == 40.0


def test_one_observed_projects_two_instalments_second_firm_third_hedged():
    txns = [dtxn("KLARNA*y", 40.0, date(2026, 8, 1))]
    proj = build_bnpl_projections(txns)
    assert len(proj) == 2
    p2, p3 = sorted(proj, key=lambda x: x["instalment"])
    assert p2["instalment"] == 2 and p2["date"] == date(2026, 8, 31) and p2["hedged"] is False
    assert p3["instalment"] == 3 and p3["date"] == date(2026, 9, 30) and p3["hedged"] is True


def test_off_model_spacing_projects_nothing():
    # 10-day gap — nowhere near the 30-day pay-in-3 model.
    txns = [dtxn("KLARNA*z", 40.0, date(2026, 7, 1)), dtxn("KLARNA*z", 40.0, date(2026, 7, 11))]
    assert build_bnpl_projections(txns) == []


def test_synthetic_klarna_end_to_end():
    """Full flow for a synthetic KLARNA* descriptor set: guard excludes it
    from generic detection, plan reconstruction projects the right
    instalment."""
    txns = [dtxn("KLARNA*ref998877", 33.33, date(2026, 7, 5)),
            dtxn("KLARNA*ref998877", 33.33, date(2026, 8, 4))]
    detected = _detect_recurring(txns, trusted_categories=TRUSTED, today=date(2026, 8, 10))
    assert detected == []
    proj = build_bnpl_projections(txns)
    assert len(proj) == 1
    assert proj[0]["provider"] == "Klarna"
    assert proj[0]["date"] == date(2026, 9, 3)
    assert proj[0]["hedged"] is True


def test_different_accounts_never_grouped_together():
    txns = [dtxn("KLARNA*shared-ref", 40.0, date(2026, 7, 1), account_id="acc-A"),
            dtxn("KLARNA*shared-ref", 40.0, date(2026, 7, 31), account_id="acc-B")]
    plans = group_bnpl_plans(txns)
    assert len(plans) == 2
    assert {p["account_id"] for p in plans} == {"acc-A", "acc-B"}
    for p in plans:
        assert len(p["instalments"]) == 1
