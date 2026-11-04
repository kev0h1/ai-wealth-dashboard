"""G418: committed categories are judged against their expected payments, never by day-N pace.

Invented names and figures only. No network, no Mongo: every collection read
in compute_category_signals is replaced by a fake.
"""
import asyncio
from datetime import date

import pytest

import app.services.pace as pace
from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds
from app.services.committed_spend import committed_findings
from app.services.spend_verdict import build_notables_and_majority

KINDS = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
START, END = date(2026, 11, 1), date(2026, 11, 30)

SERIES = [
    {"key": "ACME MORTGAGE", "display_name": "Acme Mortgage", "avg_amount": 1060.0, "category": "Mortgage"},
    {"key": "NORTHERN POWER", "display_name": "Northern Power", "avg_amount": 90.0, "category": "Bills"},
]


def t(cat, amount, key, d=date(2026, 11, 3), name=None):
    return {"date": d, "category": cat, "amount": amount, "key": key, "name": name or key}


def clean(raw):
    return raw.title()


def run(txns, **kw):
    return committed_findings(txns, SERIES, KINDS, START, END, name_fn=clean, **kw)


def test_paid_as_expected():
    out = run([t("Mortgage", 1060.0, "ACME MORTGAGE"), t("Bills", 91.5, "NORTHERN POWER")])
    assert out["Mortgage"]["status"] == "as_expected" and out["Mortgage"]["payments"] == []
    assert out["Bills"]["status"] == "as_expected"


def test_higher_names_the_payment_and_both_amounts():
    out = run([t("Mortgage", 1195.0, "ACME MORTGAGE")])
    assert out["Mortgage"]["status"] == "higher"
    assert out["Mortgage"]["payments"] == [
        {"kind": "higher", "name": "Acme Mortgage", "paid": 1195.0, "expected": 1060.0}
    ]


def test_one_new_direct_debit_among_series_payments_is_still_new():
    out = run([t("Bills", 90.0, "NORTHERN POWER"), t("Bills", 10.0, "BRIGHT BROADBAND")])
    assert out["Bills"]["status"] == "new"
    assert out["Bills"]["payments"] == [{"kind": "new", "name": "Bright Broadband", "paid": 10.0}]


def test_bills_with_nearly_all_series_payments_is_judged_and_all_series_is_judged():
    assert "Bills" in run([t("Bills", 90.0, "NORTHERN POWER"), t("Bills", 10.0, "BRIGHT BROADBAND")])
    assert run([t("Bills", 90.0, "NORTHERN POWER")])["Bills"]["status"] == "as_expected"


def test_transport_with_a_rail_series_and_an_unmatched_taxi_is_not_judged_and_has_no_new():
    pats = SERIES + [{"key": "RAIL PASS", "display_name": "Rail Pass", "avg_amount": 120.0, "category": "Transport"}]
    out = committed_findings([t("Transport", 120.0, "RAIL PASS"), t("Transport", 85.0, "SOME TAXI")],
                             pats, KINDS, START, END, name_fn=clean)
    assert out == {}


def test_visible_names_never_carry_raw_narrative_or_long_digit_runs():
    key = "PAYMENT REF 123456789012 TO SOMEONE"
    pats = SERIES + [{"key": key, "avg_amount": 50.0, "category": "Bills"}]
    out = committed_findings(
        [t("Bills", 90.0, "NORTHERN POWER"), t("Bills", 90.0, key), t("Bills", 9.0, "ANOTHER 998877665544 THING")],
        pats, KINDS, START, END, name_fn=lambda raw: raw.title())
    names = [p["name"] for p in out["Bills"]["payments"]]
    assert names and all(n == "a payment in Bills" for n in names)
    assert all(__import__("re").search(r"\d{6,}", n) is None for n in names)
    # no cleaner at all: never the raw key or name either
    out = committed_findings([t("Bills", 90.0, "NORTHERN POWER"), t("Bills", 9.0, "SOME NEW THING")],
                             SERIES, KINDS, START, END)
    assert out["Bills"]["payments"][0]["name"] == "a payment in Bills"


def test_groceries_and_transport_without_a_series_are_not_judged():
    assert run([t("Groceries", 55.0, "SOME SHOP"), t("Transport", 60.0, "SOME TRAIN")]) == {}


def test_commitment_kind_without_any_series_is_not_judged():
    assert committed_findings([t("Rent", 900.0, "SOME LANDLORD")], SERIES, KINDS, START, END) == {}


def test_subscriptions_with_every_payment_matching_a_series_are_judged():
    subs = SERIES + [{"key": "STREAMCO", "display_name": "StreamCo", "avg_amount": 12.0, "category": "Subscriptions"}]
    out = committed_findings([t("Subscriptions", 12.0, "STREAMCO")], subs, KINDS, START, END)
    assert out["Subscriptions"]["status"] == "as_expected"


def test_subscriptions_with_one_unmatched_payment_keep_pace():
    subs = SERIES + [{"key": "STREAMCO", "display_name": "StreamCo", "avg_amount": 12.0, "category": "Subscriptions"}]
    assert committed_findings([t("Subscriptions", 12.0, "STREAMCO"), t("Subscriptions", 9.0, "OTHER APP")],
                              subs, KINDS, START, END) == {}


def test_payment_matching_a_dismissed_series_is_not_new():
    out = committed_findings([t("Bills", 90.0, "NORTHERN POWER"), t("Bills", 10.0, "BRIGHT BROADBAND")],
                             SERIES, KINDS, START, END, dismissed={"BRIGHT BROADBAND"}, name_fn=clean)
    assert out["Bills"]["status"] == "as_expected" and out["Bills"]["payments"] == []


def test_discretionary_and_refunds_never_judged():
    assert run([t("Eating Out", 400.0, "SOME CAFE"), t("Bills", -30.0, "NORTHERN POWER")]) == {}


def test_tiny_unmatched_payment_is_not_new():
    out = run([t("Bills", 90.0, "NORTHERN POWER"), t("Bills", 2.0, "SOME FEE")])
    assert out["Bills"]["status"] == "as_expected"


# ── compute_category_signals end to end (fakes) ──────────────────────────────

class _Col:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, *a, **k):
        return self.doc


async def _signals(monkeypatch, today, period_txns, baseline, patterns):
    monkeypatch.setattr(pace.timeutil, "user_today", lambda: today)
    monkeypatch.setattr(pace, "preferences_col", _Col({"pay_period_config": {"type": "last_friday"}}))
    monkeypatch.setattr(pace, "cashflow_cache_col", _Col({"recurring_spend": patterns}))

    async def cached(uid, key):
        return baseline, 3

    async def load(uid, start, end, kind_map=None, **kw):
        return period_txns

    async def shape(uid, start, cfg, kind_map):
        return None, {}

    async def nothing(*a, **k):
        return {}

    async def nothing_set(*a, **k):
        return set()

    monkeypatch.setattr(pace, "_read_cached_baseline", cached)
    monkeypatch.setattr(pace, "load_spend_txns", load)
    monkeypatch.setattr(pace, "get_shape_profile_fns", shape)
    import app.services.checkpoints as cp
    monkeypatch.setattr(cp, "checkpoint_map_for_period", nothing)
    monkeypatch.setattr(cp, "intent_map_for_period", nothing)
    monkeypatch.setattr(cp, "engaged_categories", nothing_set)
    return await pace.compute_category_signals("g418-fixture", kind_map=KINDS)


# last_friday periods: 2026-09-25..2026-10-29 (1 Oct is day 7) and
# 2026-10-30..2026-11-26 (1 Nov is day 3).
@pytest.mark.parametrize("today,bill_date", [(date(2026, 10, 3), date(2026, 10, 1)), (date(2026, 11, 6), date(2026, 11, 1))])
def test_fixed_bill_never_produces_a_multiple_wherever_it_falls(monkeypatch, today, bill_date):
    txns = [
        {"date": bill_date, "category": "Mortgage", "amount": 1060.0, "key": "ACME MORTGAGE", "name": "ACME MORTGAGE"},
        {"date": bill_date, "category": "Bills", "amount": 1180.0, "key": "NORTHERN POWER", "name": "NORTHERN POWER"},
    ]
    result = asyncio.run(_signals(monkeypatch, today, txns, {"Mortgage": 1060.0, "Bills": 300.0}, SERIES))
    sig = result["signals"]
    assert sig["Mortgage"]["multiple"] is None and sig["Bills"]["multiple"] is None
    assert sig["Mortgage"]["committed"]["status"] == "as_expected"
    assert sig["Bills"]["committed"]["status"] == "higher"
    notables, _quiet, majority = build_notables_and_majority(
        {c: {"spent": r["amount"], "payments_count": 1, "debit_txns": []} for c, r in
         ((x["category"], x) for x in txns)}, sig, 8)
    assert notables == []
    assert all("committed" in row for row in majority)


def test_groceries_without_a_series_keeps_its_multiple(monkeypatch):
    txns = [{"date": date(2026, 11, 3), "category": "Groceries", "amount": 400.0, "key": "SOME SHOP", "name": "SOME SHOP"}]
    result = asyncio.run(_signals(monkeypatch, date(2026, 11, 8), txns, {"Groceries": 300.0}, SERIES))
    sig = result["signals"]["Groceries"]
    assert sig["multiple"] is not None and "committed" not in sig


def test_subscriptions_matching_series_get_the_comparison_not_a_multiple(monkeypatch):
    subs = SERIES + [{"key": "STREAMCO", "display_name": "StreamCo", "avg_amount": 12.0, "category": "Subscriptions"}]
    txns = [{"date": date(2026, 11, 3), "category": "Subscriptions", "amount": 12.0, "key": "STREAMCO", "name": "STREAMCO"}]
    result = asyncio.run(_signals(monkeypatch, date(2026, 11, 8), txns, {"Subscriptions": 12.0}, subs))
    sig = result["signals"]["Subscriptions"]
    assert sig["multiple"] is None and sig["committed"]["status"] == "as_expected"


def test_committed_only_majority_reading_never_says_building_a_usual():
    from app.services.spend_verdict import build_reading
    sig = {"Bills": {"usual_rate_per_day": 40.0, "multiple": None, "committed": {"status": "as_expected", "paid_count": 1, "payments": []}},
           "Mortgage": {"usual_rate_per_day": 36.0, "multiple": None, "committed": {"status": "as_expected", "paid_count": 1, "payments": []}}}
    agg = {c: {"spent": 1000.0, "payments_count": 1, "debit_txns": []} for c in sig}
    _n, _q, majority = build_notables_and_majority(agg, sig, 12)
    assert all(m["has_baseline"] and not m["elevated"] for m in majority)
    for state in ("nothing", "normal"):
        text = build_reading(state, days_elapsed=12, qualifying=[], majority=majority, total_excess=0.0)
        assert "don't have a usual" not in text and "building a usual" not in text, text


def _row(cat, status, name=None):
    pay = [] if status == "as_expected" else [
        {"kind": status, "name": name or f"a payment in {cat}", "paid": 90.0, **({"expected": 80.0} if status == "higher" else {})}]
    return {"category": cat, "spent": 100.0, "payments_count": 1, "has_baseline": True, "elevated": False,
            "committed": {"status": status, "paid_count": 1, "payments": pay}}


def test_headline_never_calls_a_higher_or_new_committed_row_close_to_usual():
    from app.services.spend_verdict import build_reading
    for state in ("nothing", "normal"):
        higher = build_reading(state, days_elapsed=12, qualifying=[{"category": "Eating Out"}],
                               majority=[_row("Mortgage", "higher", "Acme Mortgage"), _row("Bills", "as_expected")], total_excess=0.0)
        assert "Acme Mortgage in Mortgage was higher than usual." in higher, higher
        new = build_reading(state, days_elapsed=12, qualifying=[{"category": "Eating Out"}],
                            majority=[_row("Bills", "new"), _row("Mortgage", "as_expected")], total_excess=0.0)
        assert "There is a new payment in Bills." in new, new
        only = build_reading(state, days_elapsed=12, qualifying=[{"category": "Eating Out"}],
                             majority=[_row("Mortgage", "higher"), _row("Bills", "new")], total_excess=0.0)
        assert "close to usual" not in only and "Everything else looks normal" not in only, only
        assert "A payment in Mortgage was higher than usual." in only and "—" not in only and "!" not in only
    nothing = build_reading("nothing", days_elapsed=12, qualifying=[], majority=[_row("Mortgage", "higher"), _row("Bills", "as_expected")], total_excess=0.0)
    assert "all 1 category is running close to usual" in nothing


def test_discretionary_pace_unchanged(monkeypatch):
    txns = [{"date": date(2026, 11, 3), "category": "Eating Out", "amount": 300.0, "key": "SOME CAFE", "name": "SOME CAFE"}]
    result = asyncio.run(_signals(monkeypatch, date(2026, 11, 8), txns, {"Eating Out": 300.0}, SERIES))
    sig = result["signals"]["Eating Out"]
    assert sig["multiple"] is not None and sig["multiple"] > 1.0
    assert "committed" not in sig


def test_include_series_adds_key_and_name_without_changing_default_or_evidence(monkeypatch):
    from bson import ObjectId
    from datetime import datetime
    from app.services.spending import SpendingContext
    docs = [{"_id": ObjectId("000000000000000000000001"), "date": datetime(2026, 11, 2), "amount": 1060,
             "category": "Mortgage", "transaction_type": "debit", "merchant_name": "ACME MORTGAGE"}]

    class _Cur:
        def __init__(self, d):
            self.d = d

        def __aiter__(self):
            async def gen():
                for x in self.d:
                    yield x
            return gen()

    class _C:
        def __init__(self, d):
            self.d, self.name = d, "c"

        def find(self, q, projection):
            return _Cur(self.d)

    async def kinds(uid):
        return {"Mortgage": "commitment"}

    async def ctx(*a, **k):
        return SpendingContext(kinds={"Mortgage": "commitment"})

    monkeypatch.setattr(pace, "transactions_col", _C(docs))
    monkeypatch.setattr(pace, "yapily_transactions_col", _C([]))
    monkeypatch.setattr(pace, "get_category_kinds", kinds)
    monkeypatch.setattr(pace, "build_spending_context", ctx)
    d1, d2 = date(2026, 11, 1), date(2026, 11, 5)
    default = asyncio.run(pace.load_spend_txns("u", d1, d2))
    series = asyncio.run(pace.load_spend_txns("u", d1, d2, include_series=True))
    evidence = asyncio.run(pace.load_spend_txns("u", d1, d2, include_evidence=True))
    assert "key" not in default[0] and "key" not in evidence[0]
    assert series[0]["key"] == "ACME MORTGAGE" and series[0]["name"] == "ACME MORTGAGE"
    assert {k: v for k, v in series[0].items() if k not in ("key", "name")} == default[0]
