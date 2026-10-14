"""G271: daily valuation snapshots and simple portfolio growth. Fake
collections, no Mongo, no MONGO_DB override, no network."""
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import app.services.investment_growth as ig  # noqa: E402
import app.services.retention as retention  # noqa: E402
from test_retention import FakeCol, _patch_all_collections  # noqa: E402

TODAY = date(2026, 10, 14)
USER = "u1@x.com"
ISIN = "GB00B3X7QG63"


class _Cur:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, n):
        return [dict(d) for d in self.docs]


class Col(FakeCol):
    def find(self, filt=None, proj=None):
        from test_retention import _matches
        return _Cur([d for d in self.docs.values() if _matches(d, filt or {})])


def _acc(stmt=date(2026, 9, 4)):
    return {"_id": "a1", "user_id": USER, "currency": "GBP", "statement_date": datetime.combine(stmt, datetime.min.time())}


def _holdings(units=100.0, stmt_value=1000.0):
    return [{"_id": "h1", "account_id": "a1", "user_id": USER, "name": "Fund", "isin": ISIN,
             "instrument_key": ISIN, "units": units, "statement_value": stmt_value}]


def _insts(price):
    return {ISIN: {"_id": ISIN, "price": price, "price_date": TODAY.isoformat()}}


@pytest.fixture
def cols(monkeypatch):
    vals, notes, accs, holds = Col(), Col(), Col([_acc()]), Col(_holdings())
    monkeypatch.setattr(ig, "investment_valuations_col", vals)
    monkeypatch.setattr(ig, "investment_notes_col", notes)
    monkeypatch.setattr(ig, "investment_accounts_col", accs)
    monkeypatch.setattr(ig, "investment_holdings_col", holds)

    async def _get(keys):
        return _insts(12.0)
    monkeypatch.setattr(ig, "get_instruments", _get)
    return vals, notes, accs, holds


def test_snapshot_is_idempotent_per_day(cols):
    vals, *_ = cols
    for price in (11.0, 12.0, 12.0):
        asyncio.run(ig.snapshot_account(_acc(), _holdings(), _insts(price), TODAY))
    todays = [d for d in vals.docs.values() if d["date"] == TODAY.isoformat()]
    assert len(todays) == 1
    assert todays[0]["value"] == 1200.0  # the last run of the day wins
    assert todays[0]["_id"] == "a1|2026-10-14"
    # plus exactly one seeded statement point, however often it re-runs
    assert len(vals.docs) == 2


def test_growth_is_value_minus_net_contributions(cols):
    vals, notes, *_ = cols
    notes.docs["n1"] = {"_id": "n1", "account_id": "a1", "trade_date": datetime(2026, 9, 20), "kind": "purchase", "amount": 500.0}
    notes.docs["n2"] = {"_id": "n2", "account_id": "a1", "trade_date": datetime(2026, 9, 25), "kind": "sale", "amount": -100.0}
    # a note on or before the statement is already inside the statement value
    notes.docs["n0"] = {"_id": "n0", "account_id": "a1", "trade_date": datetime(2026, 9, 1), "kind": "purchase", "amount": 9999.0}
    snap = asyncio.run(ig.snapshot_account(_acc(), _holdings(), _insts(12.0), TODAY))
    # paid in: statement 1000 + 500 - 100; value: 100 x 12 + 400 at cost
    assert snap["paid_in_to_date"] == 1400.0
    assert snap["value"] == 1600.0
    g = ig.build_growth(list(vals.docs.values()), "all", TODAY)
    assert g["method"] == "simple"
    assert g["growth_abs"] == 200.0  # exactly the price move on 100 units: 1200 - 1000
    assert g["growth_abs"] == g["value"] - g["paid_in"]
    assert g["growth_pct"] == round(200 / 1400 * 100, 2)
    assert g["since"] == "2026-09-04"


def test_paid_in_carries_forward_from_prior_snapshot(cols):
    vals, notes, *_ = cols
    asyncio.run(ig.snapshot_account(_acc(), _holdings(), _insts(11.0), date(2026, 10, 1)))
    notes.docs["n1"] = {"_id": "n1", "account_id": "a1", "trade_date": datetime(2026, 10, 8), "kind": "purchase", "amount": 250.0}
    snap = asyncio.run(ig.snapshot_account(_acc(), _holdings(), _insts(12.0), TODAY))
    assert snap["paid_in_to_date"] == 1250.0


def test_range_filtering_and_range_growth():
    snaps = [
        {"date": "2026-01-01", "value": 1000.0, "paid_in_to_date": 1000.0},
        {"date": "2026-08-20", "value": 1100.0, "paid_in_to_date": 1000.0},
        {"date": "2026-09-20", "value": 1450.0, "paid_in_to_date": 1300.0},
        {"date": "2026-10-14", "value": 1500.0, "paid_in_to_date": 1300.0},
    ]
    one_m = ig.build_growth(snaps, "1m", TODAY)
    assert [p["date"] for p in one_m["points"]] == ["2026-09-20", "2026-10-14"]
    assert one_m["growth_abs"] == 50.0
    three_m = ig.build_growth(snaps, "3m", TODAY)
    assert [p["date"] for p in three_m["points"]][0] == "2026-08-20"
    assert three_m["growth_abs"] == 100.0  # (1500-1300) minus (1100-1000)
    allr = ig.build_growth(snaps, "all", TODAY)
    assert len(allr["points"]) == 4
    assert allr["growth_abs"] == 200.0 and allr["paid_in"] == 1300.0
    assert ig.build_growth([], "1y", TODAY)["growth_abs"] is None


def test_fall_is_negative_growth(cols):
    vals, *_ = cols
    asyncio.run(ig.snapshot_account(_acc(), _holdings(), _insts(9.0), TODAY))
    g = ig.build_growth(list(vals.docs.values()), "all", TODAY)
    assert g["growth_abs"] == -100.0 and g["growth_pct"] == -10.0


def test_holding_changes_since_statement():
    rows = ig._holding_changes(_holdings(), _insts(12.0))
    assert rows[0]["change_abs"] == 200.0 and rows[0]["change_pct"] == 20.0
    unpriced = ig._holding_changes(_holdings(), {})
    assert unpriced[0]["change_abs"] is None and unpriced[0]["value"] == 1000.0


def test_erased_with_the_user(monkeypatch):
    vals = Col([
        {"_id": "a1|2026-10-14", "user_id": USER, "account_id": "a1", "date": "2026-10-14"},
        {"_id": "b1|2026-10-14", "user_id": "other@x.com", "account_id": "b1", "date": "2026-10-14"},
    ])
    _patch_all_collections(monkeypatch, {"investment_valuations_col": vals})
    asyncio.run(retention.erase_user(USER))
    assert list(vals.docs) == ["b1|2026-10-14"]
    from app.db.collections import ERASURE_MANIFEST
    assert "investment_valuations_col" in ERASURE_MANIFEST


def test_endpoint_404_for_another_users_account(monkeypatch):
    import app.routers.investments as router
    from fastapi import HTTPException
    accs = Col([{"_id": "a1", "user_id": USER}])
    monkeypatch.setattr(router, "investment_accounts_col", accs)

    async def _growth(acc, range_key):
        return {"account_id": acc["_id"], "range": range_key}
    monkeypatch.setattr(router, "account_growth", _growth)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(router.get_investment_growth("a1", "all", {"email": "other@x.com"}))
    assert exc.value.status_code == 404
    ok = asyncio.run(router.get_investment_growth("a1", "3m", {"email": USER}))
    assert ok == {"account_id": "a1", "range": "3m"}


def test_snapshot_all_isolates_a_failing_account(cols, monkeypatch):
    vals, notes, accs, holds = cols
    accs.docs["a2"] = {**_acc(), "_id": "a2"}
    holds.docs["h2"] = {**_holdings()[0], "_id": "h2", "account_id": "a2"}
    real = ig.snapshot_account

    async def flaky(acc, holdings, insts, today=None):
        if acc["_id"] == "a1":
            raise RuntimeError("boom")
        return await real(acc, holdings, insts, today)
    monkeypatch.setattr(ig, "snapshot_account", flaky)
    result = asyncio.run(ig.snapshot_all_accounts(TODAY))
    assert result == {"written": 1, "failed": 1}
    assert any(d["account_id"] == "a2" for d in vals.docs.values())
    assert not any(d["account_id"] == "a1" for d in vals.docs.values())
