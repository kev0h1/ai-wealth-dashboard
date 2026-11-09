"""Provenance is a description of existing events, never another forecast."""
from copy import deepcopy
from datetime import date, datetime, timedelta
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

import app.routers.analytics as analytics
from app.services.income_evidence import select_income_evidence
from app.services.income_payer import payer_key
from app.services.income_provenance import build_income_evidence, income_history
from test_pooled_walk import UID, TODAY as ENGINE_TODAY, _wire


TODAY = date(2026, 11, 9)


def event(key="alder::current", amount=2850, days=11, **extras):
    return {"name": key, "display_name": "Alder Payroll", "amount": amount,
            "days_away": days, "expected_date": (TODAY + timedelta(days=days)).isoformat(),
            "account_id": "current", "account_name": "EVERYDAY ACCOUNT", "account_bank": "Barclays",
            "avg_interval": 30.0, "monthly_anchor": {"type": "day", "day": 20},
            "occurrences": 3, "income_history": income_history([
                {"_id": "receipt-aug", "date": date(2026, 8, 20)},
                {"_id": "receipt-sep", "date": date(2026, 9, 20)},
                {"_id": "receipt-oct", "date": date(2026, 10, 20)},
            ]), **extras}


def evidence(before=None, on_payday=None, income_total=None, pay_total=None, **extras):
    before = [event()] if before is None else before
    on_payday = [] if on_payday is None else on_payday
    return build_income_evidence(
        before_payday=before, expected_pay=on_payday,
        income_total=sum(row["amount"] for row in before) if income_total is None else income_total,
        pay_total=sum(row["amount"] for row in on_payday) if pay_total is None else pay_total,
        today=TODAY, confirmed_keys=set(), **extras,
    )


def test_exact_history_is_from_selected_rows_and_payday_stays_separate():
    before = [event(), event(key="refund::other", amount=210, days=14, display_name="Retail refund")]
    on_payday = [event(key="reward::current", amount=24, days=22, display_name="Account reward")]
    original = deepcopy([before, on_payday])
    result = evidence(before, on_payday)
    assert result["before_payday"]["total"] == 3060
    assert result["expected_pay"]["total"] == 24
    item = result["before_payday"]["items"][0]
    assert (item["payer"], item["account_name"], item["cadence"], item["last_received"], item["occurrences"]) == (
        "Alder Payroll", "Everyday Account", "monthly", "2026-10-20", 3,
    )
    assert item["transactions_scope"] == "sources"
    query = parse_qs(urlsplit(item["transactions_href"]).query)
    assert query["transaction_id"] == ["receipt-aug", "receipt-sep", "receipt-oct"]
    assert query["txn_type"] == ["credit"]
    assert "category" not in query  # a corrected source remains findable
    assert "2850" not in item["transactions_href"]
    pay = result["expected_pay"]["items"][0]
    assert not pay["confirmed"] and "forecast on payday" in pay["basis"]
    assert "not been confirmed as pay" in pay["basis"]
    assert [before, on_payday] == original


def test_repeated_weekly_occurrences_remain_distinct_and_share_history():
    recurring = [event(key="wages::current", amount=100, days=day, avg_interval=7, monthly_anchor=None) for day in (2, 9, 16)]
    result = evidence(recurring)["before_payday"]
    assert result["total"] == 300 and len(result["items"]) == 3
    assert len({row["expected_date"] for row in result["items"]}) == 3
    assert all(row["cadence"] == "weekly" for row in result["items"])
    assert len(parse_qs(urlsplit(result["transactions_href"]).query)["transaction_id"]) == 3


def test_backend_frontend_contract_case_includes_real_wire_names_and_opaque_ids():
    history = income_history([
        {"_id": "finexer:current/receipt-aug", "date": date(2026, 8, 20)},
        {"_id": "receipt+sep?ref", "date": date(2026, 9, 20)},
        {"_id": "receipt with space", "date": date(2026, 10, 20)},
    ])
    expected = json.loads((Path(__file__).resolve().parents[2] / "shared/income-evidence-case.json").read_text())
    assert evidence([event(income_history=history)]) == expected


@pytest.mark.parametrize("field,value", [("amount", -10), ("amount", float("nan")), ("amount", float("inf")), ("expected_date", "bad")])
def test_unreliable_events_are_withheld_without_changing_authoritative_total(field, value):
    broken = event(**{field: value})
    if field == "expected_date":
        broken.pop("days_away")
    out = evidence([broken], income_total=2850)["before_payday"]
    assert out["total"] == 2850 and out["status"] == "unavailable" and out["items"] == []
    assert out["transactions_href"] is None


def test_mismatched_snapshot_is_not_presented_as_an_equation():
    out = evidence(income_total=2851)["before_payday"]
    assert out["status"] == "unavailable" and out["total"] == 2851
    assert out["items"] == []


def test_malformed_old_history_does_not_break_the_existing_estimate():
    result = evidence([event(income_history="legacy", source="confirmed", avg_interval=None, monthly_anchor=None)],
                      income_streams=[{"key": "alder::current", "status": "confirmed", "schedule": "legacy"}])
    item = result["before_payday"]["items"][0]
    assert result["before_payday"]["total"] == 2850
    assert item["last_received"] is None and item["cadence"] is None
    assert item["transactions_scope"] == "income_period"


def test_history_without_source_ids_is_explicitly_a_period_filter():
    item = event(income_history=None)
    out = evidence([item])["before_payday"]["items"][0]
    assert out["last_received"] is None
    assert "not available in this snapshot" in out["basis"]
    assert out["transactions_scope"] == "income_period"
    query = parse_qs(urlsplit(out["transactions_href"]).query)
    assert query["category"] == ["Income"] and query["to"] == [TODAY.isoformat()]
    assert "transaction_id" not in query


def test_oversized_history_is_bounded_and_never_claimed_as_exact():
    history = income_history([{"_id": f"credit-{n}", "date": TODAY} for n in range(101)])
    assert len(history["transaction_ids"]) == 100 and not history["source_ids_complete"]
    item = evidence([event(income_history=history)])["before_payday"]["items"][0]
    assert item["transactions_scope"] == "income_period"
    # Even a valid <=100 set must respect the deployed request-line budget.
    large = income_history([{"_id": f"{'x' * 190}-{n}", "date": TODAY} for n in range(40)])
    item = evidence([event(income_history=large)])["before_payday"]["items"][0]
    assert item["transactions_scope"] == "income_period" and len(item["transactions_href"]) < 6000


def test_confirmed_income_is_not_invented_historical_pay():
    row = event(key="manual", income_history=income_history([]), avg_interval=None, monthly_anchor=None, source="confirmed")
    result = evidence([row], income_streams=[{"key": "manual", "status": "confirmed", "schedule": {"type": "weekly", "weekday": 4}}])
    item = result["before_payday"]["items"][0]
    assert item["confirmed"] and item["cadence"] == "weekly"
    assert item["last_received"] is None and item["occurrences"] == 0
    assert "schedule you confirmed" in item["basis"] and "No matching historical credits" in item["basis"]
    assert "confirmed as pay" not in item["basis"]


def test_category_correction_removes_series_before_provenance_is_built():
    rows = [{"_id": f"reward-{age}", "merchant_name": "TUESDAY PERKS REWARD", "description": "TUESDAY PERKS REWARD",
             "account_id": "current", "transaction_type": "credit", "amount": 24, "category": "Income",
             "date": datetime(2026, 11, 9) - timedelta(days=age)} for age in (70, 42, 14)]
    selection = select_income_evidence(rows)
    detected = analytics._detect_recurring(selection.credits, is_income=True, today=TODAY)
    assert len(detected) == 1
    pattern = detected[0]
    assert set(pattern["income_history"]["transaction_ids"]) == {row["_id"] for row in rows}
    predicted = event(key=pattern["key"], amount=pattern["avg_amount"], income_history=pattern["income_history"])
    assert evidence([predicted])["before_payday"]["total"] == 24
    # Only the newest source needs correcting; old Income rows must not
    # recreate the recurring series or its confirmed fallback.
    rows[-1].update(custom_category="Transfer", custom_category_at=datetime(2026, 11, 9))
    corrected = select_income_evidence(rows)
    assert not analytics._detect_recurring(corrected.credits, is_income=True, today=TODAY)
    assert not corrected.confirmed({payer_key(rows[0]): {"status": "confirmed"}})
    after = evidence([], [])
    assert after["before_payday"]["total"] == 0 and after["before_payday"]["items"] == []


def test_compute_describes_exact_pooled_lists_without_extra_reads_or_math_changes(monkeypatch):
    import asyncio
    calls = []
    _wire(monkeypatch, calls=calls)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert out["safe_to_spend"] == 650 and out["lowest_projected_balance"] == 650
    assert out["next_payday"] == (ENGINE_TODAY + timedelta(days=10)).isoformat()
    assert out["income_before_payday"] == 240 and out["payday_income"] == 2000
    assert out["income_evidence"]["before_payday"]["total"] == 240
    assert [row["amount"] for row in out["income_evidence"]["before_payday"]["items"]] == [100, 140]
    assert out["income_evidence"]["expected_pay"]["total"] == 2000
    assert len(calls) == 11  # the existing fixture's exact reads, no provenance query


def test_old_response_and_pattern_shapes_are_invalidated():
    assert analytics.PATTERNS_VERSION > 16
    assert not analytics._safe_to_spend_cache_current({"status": "ok", "calculation_version": 3})
