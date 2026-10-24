"""G326: the verdict's single period definition (`period` + `income_rows`).

Pure seams only: no network, no Mongo. The header label, "Day N of M", In and
the income list on the Spend page are all read from this one object, so these
tests pin that its fields agree with each other and with pay_period.py.
"""
from datetime import date

from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.pay_period import get_pay_period_for_date
from app.services.spend_verdict import (
    bucket_transactions,
    build_income_rows,
    build_period_payload,
)

KIND_MAP = dict(BUILTIN_CATEGORY_KINDS)


def txn(category, amount, d, *, debit=False, tid="t", desc=""):
    return {
        "date": d, "category": category, "amount": abs(float(amount)), "debit": debit,
        "merchant_name": "", "description": desc, "id": tid, "account_id": "a1",
    }


def pace_period(cfg, today, offset=0):
    start, end = get_pay_period_for_date(today, cfg)
    days_elapsed = max(1, (today - start).days)
    days_left = max(0, (end - today).days + 1)
    return {
        "start": start.isoformat(), "end": end.isoformat(),
        "days_elapsed": days_elapsed, "days_left": days_left,
        "period_days": days_elapsed + days_left, "offset": offset, "closed": False,
        "thin_history": False, "suppress_multiple": False,
    }


def test_calendar_month_fields_agree():
    today = date(2026, 10, 24)
    p = build_period_payload(pace_period({"type": "calendar_month"}, today), [], today)
    assert p["label"] == "1 Oct to 31 Oct"
    assert p["length_days"] == 31
    assert p["day_number"] == 24
    assert p["payday"] == "2026-11-01"
    assert 1 <= p["day_number"] <= p["length_days"]
    # compatibility fields are untouched
    assert p["start"] == "2026-10-01" and p["end"] == "2026-10-31" and p["days_elapsed"] == 23


def test_last_friday_period_is_35_days_and_label_matches_count():
    # The G326 shape: a 35-day pay period (25 Sep to 29 Oct). The label and the
    # day count come from the same object, so a 31-day label can't sit beside
    # a 35-day count.
    today = date(2026, 10, 24)
    p = build_period_payload(pace_period({"type": "last_friday"}, today), [], today)
    assert (p["start"], p["end"]) == ("2026-09-25", "2026-10-29")
    assert p["label"] == "25 Sep to 29 Oct"
    assert p["length_days"] == 35
    assert p["day_number"] == 30
    assert p["payday"] == "2026-10-30"
    assert (date.fromisoformat(p["end"]) - date.fromisoformat(p["start"])).days + 1 == p["length_days"]


def test_pay_a_day_early_is_flagged_attributed_early():
    start = date(2026, 10, 1)
    rows = build_income_rows(
        [txn("Income", 444.70, date(2026, 9, 30), tid="early"), txn("Income", 50, date(2026, 10, 3), tid="ontime")],
        KIND_MAP, start,
    )
    by_id = {r["id"]: r for r in rows}
    assert by_id["early"]["attributed_early"] is True
    assert by_id["early"]["date"] == "2026-09-30"
    assert by_id["ontime"]["attributed_early"] is False
    assert rows[0]["id"] == "early"  # largest first


def test_pay_on_weekend_shifted_lands_in_the_ending_period():
    # Payday 31 Oct 2026 is a Saturday, so the salary lands Friday 30 Oct. That
    # is still inside the period that ends on 30 Oct (the next starts 31 Oct).
    today = date(2026, 10, 30)
    p = build_period_payload(pace_period({"type": "monthly_pay_date", "day": 31}, today), [], today)
    assert (p["start"], p["end"]) == ("2026-09-30", "2026-10-30")
    assert p["length_days"] == 31 and p["day_number"] == 31
    assert p["payday"] == "2026-10-31"
    rows = build_income_rows([txn("Income", 2000, date(2026, 10, 30))], KIND_MAP, date.fromisoformat(p["start"]))
    assert rows[0]["date"] == "2026-10-30" and rows[0]["attributed_early"] is False


def test_income_rows_sum_equals_income_total_with_reversal():
    txns = [
        txn("Income", 444.70, date(2026, 10, 2), tid="pay"),
        txn("Income", 20, date(2026, 10, 5), debit=True, tid="reversal"),
        txn("Groceries", 30, date(2026, 10, 6), debit=True, tid="spend"),
    ]
    _cat, _moved, income_total = bucket_transactions(txns, KIND_MAP)
    rows = build_income_rows(txns, KIND_MAP, date(2026, 10, 1))
    assert {r["id"] for r in rows} == {"pay", "reversal"}
    assert round(sum(r["amount"] for r in rows), 2) == round(income_total, 2) == 424.70


def test_closed_period_day_number_is_full_length_and_input_not_mutated():
    today = date(2026, 10, 24)
    base = pace_period({"type": "calendar_month"}, date(2026, 9, 10), offset=-1)
    base["closed"] = True
    before = dict(base)
    p = build_period_payload(base, [], today)
    assert p["day_number"] == p["length_days"] == 30
    assert base == before and "income_rows" not in base
