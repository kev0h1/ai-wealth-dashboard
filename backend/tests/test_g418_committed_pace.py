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
    {"key": "ACME MORTGAGE", "display_name": "Acme Mortgage", "avg_amount": 1124.0, "category": "Mortgage"},
    {"key": "NORTHERN POWER", "display_name": "Northern Power", "avg_amount": 90.0, "category": "Bills"},
]


def t(cat, amount, key, d=date(2026, 11, 3), name=None):
    return {"date": d, "category": cat, "amount": amount, "key": key, "name": name or key}


def run(txns):
    return committed_findings(txns, SERIES, KINDS, START, END)


def test_paid_as_expected():
    out = run([t("Mortgage", 1124.0, "ACME MORTGAGE"), t("Bills", 91.5, "NORTHERN POWER")])
    assert out["Mortgage"]["status"] == "as_expected" and out["Mortgage"]["payments"] == []
    assert out["Bills"]["status"] == "as_expected"


def test_higher_names_the_payment_and_both_amounts():
    out = run([t("Mortgage", 1300.0, "ACME MORTGAGE")])
    assert out["Mortgage"]["status"] == "higher"
    assert out["Mortgage"]["payments"] == [
        {"kind": "higher", "name": "Acme Mortgage", "paid": 1300.0, "expected": 1124.0}
    ]


def test_new_committed_payment_is_flagged_new():
    out = run([t("Bills", 240.0, "BRIGHT BROADBAND")])
    assert out["Bills"]["status"] == "new"
    assert out["Bills"]["payments"][0]["kind"] == "new" and out["Bills"]["payments"][0]["paid"] == 240.0


def test_committed_category_without_recurring_series_is_silent():
    assert run([t("Groceries", 55.0, "SOME SHOP"), t("Transport", 60.0, "SOME TRAIN")]) == {}


def test_discretionary_and_refunds_never_judged():
    assert run([t("Eating Out", 400.0, "SOME CAFE"), t("Bills", -30.0, "NORTHERN POWER")]) == {}


def test_tiny_unmatched_payment_is_not_new():
    out = run([t("Bills", 2.0, "SOME FEE")])
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
        {"date": bill_date, "category": "Mortgage", "amount": 1124.0, "key": "ACME MORTGAGE", "name": "ACME MORTGAGE"},
        {"date": bill_date, "category": "Bills", "amount": 1217.0, "key": "NORTHERN POWER", "name": "NORTHERN POWER"},
    ]
    result = asyncio.run(_signals(monkeypatch, today, txns, {"Mortgage": 1124.0, "Bills": 300.0}, SERIES))
    sig = result["signals"]
    assert sig["Mortgage"]["multiple"] is None and sig["Bills"]["multiple"] is None
    assert sig["Mortgage"]["committed"]["status"] == "as_expected"
    assert sig["Bills"]["committed"]["status"] == "higher"
    notables, _quiet, majority = build_notables_and_majority(
        {c: {"spent": r["amount"], "payments_count": 1, "debit_txns": []} for c, r in
         ((x["category"], x) for x in txns)}, sig, 8)
    assert notables == []
    assert all("committed" in row for row in majority)


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
    docs = [{"_id": ObjectId("000000000000000000000001"), "date": datetime(2026, 11, 2), "amount": 1124,
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
