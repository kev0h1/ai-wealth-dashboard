"""G279 evidence reuses the engine's own signed period/category totals."""
from datetime import date

import pytest

from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.money_shape import _build_jobs, _job_drivers, average_for_window, bucket_period


def transaction(key, amount, category, day="2026-09-02", account="current", debit=True):
    return {"_id": key, "amount": amount, "category": category, "date": day, "account_id": account, "is_debit": debit}


def jobs_for(bucket):
    return _build_jobs(bucket["fixed"], bucket["moved"], bucket["free"], bucket["left"], bucket["shares"], bucket["categories"], bucket["category_totals"])


def assert_reconciles(jobs):
    for job in jobs:
        if job["id"] != "left":
            assert sum(row["amount"] for row in job["drivers"]) == pytest.approx(job["amount"], abs=.004)


def test_signed_refunds_and_period_boundaries_are_preserved():
    bucket = bucket_period([
        transaction("salary", 1000, "Income", debit=False),
        transaction("bill", 700, "Bills"),
        transaction("refund", 25, "Bills", debit=False),
        transaction("free", 150, "Shopping"),
        transaction("outside", 999, "Bills", day="2026-10-01"),
    ], BUILTIN_CATEGORY_KINDS, set(), date(2026, 9, 1), date(2026, 9, 30))
    jobs = jobs_for(bucket)
    assert jobs[0]["amount"] == 675
    assert jobs[0]["drivers"] == [{"category": "Bills", "amount": 675}]
    assert bucket["total_out"] == 825
    assert_reconciles(jobs)


def test_unlabelled_savings_credit_and_own_move_are_honest_residual_not_income():
    bucket = bucket_period([
        transaction("salary", 1000, "Income", debit=False),
        transaction("saving", 70, "Savings"),
        transaction("pot-credit", 30, "Income", account="pot", debit=False),
        transaction("own", 20, "Shopping"),
    ], BUILTIN_CATEGORY_KINDS, {"pot"}, date(2026, 9, 1), date(2026, 9, 30), own_move_ids={"own"})
    moved = jobs_for(bucket)[1]
    assert moved["amount"] == 120
    assert moved["drivers"] == [{"category": "Savings", "amount": 70}, {"category": None, "amount": 50}]
    assert "Income" not in [row["category"] for row in moved["drivers"]]
    assert_reconciles(jobs_for(bucket))


def test_average_evidence_is_per_period_and_reconciles_rounding():
    periods = []
    for month, fixed in [(9, 100.01), (8, 200.02), (7, 300.03)]:
        start, end = date(2026, month, 1), date(2026, month, 28)
        bucket = bucket_period([
            transaction("salary", 1000, "Income", day=start.isoformat(), debit=False),
            transaction("bill", fixed, "Bills", day=start.isoformat()),
            transaction("shopping", 1.01, "Shopping", day=start.isoformat()),
            transaction("eating", 2.02, "Eating Out", day=start.isoformat()),
        ], BUILTIN_CATEGORY_KINDS, set(), start, end)
        periods.append(bucket)
    average = average_for_window(periods, 3)
    assert average["period_count"] == 3
    assert average["jobs"][0]["drivers"] == [{"category": "Bills", "amount": 200.02}]
    assert average["jobs"][0]["amount"] != sum(period["fixed"] for period in periods)
    assert_reconciles(average["jobs"])
    assert_reconciles([{"id": "fixed", "amount": 1, "drivers": _job_drivers(1, {"a": .333, "b": .333, "c": .334})}])


def test_negative_category_refunds_keep_their_sign():
    rows = _job_drivers(50, {"Bills": 75, "Groceries": -25})
    assert rows == [{"category": "Bills", "amount": 75}, {"category": "Groceries", "amount": -25}]


@pytest.mark.parametrize("outflows, net_left, net_beyond, mean_gap, legacy_left", [
    ((1100, 500), 200, 0, 50, 250),
    ((1800, 600), 0, 200, 400, 200),
])
def test_mixed_average_preserves_legacy_metrics_but_net_instrument_reconciles(outflows, net_left, net_beyond, mean_gap, legacy_left):
    periods = []
    for month, out in zip((9, 8), outflows):
        start, end = date(2026, month, 1), date(2026, month, 28)
        periods.append(bucket_period([
            transaction("salary", 1000, "Income", day=start.isoformat(), debit=False),
            transaction("bill", out, "Bills", day=start.isoformat()),
        ], BUILTIN_CATEGORY_KINDS, set(), start, end))
    average = average_for_window(periods, 3)
    assert average["overspent"] == mean_gap
    assert average["jobs"][3]["amount"] == legacy_left
    assert average["beyond"] == net_beyond
    assert average["net_jobs"][3]["amount"] == net_left
    assert sum(job["amount"] for job in average["net_jobs"]) == average["take_home"] + net_beyond
    assert sum(job["share"] for job in average["net_jobs"]) == 100
    assert_reconciles(average["net_jobs"])
    if net_beyond:
        assert "£100 that went out" in average["net_verdict"]
    else:
        assert "£80 of every £100 you took home" in average["net_verdict"]
