"""G277: growth from cost versus value, shown at once. Pure helpers plus the
Penny tool; fake collections, no Mongo, no network."""
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import app.services.investment_growth as ig  # noqa: E402
from test_investment_growth_g271 import Col, _Cur  # noqa: E402,F401

TODAY = date(2026, 10, 15)
STMT = date(2026, 9, 4)
SP = "S&P 500 UCITS ETF"
SP_KEY = "NAME:s p 500 ucits etf"


def _h(i, name, units, stmt_value, book_cost=None, key=None):
    return {"_id": i, "account_id": "a1", "name": name, "isin": None, "instrument_key": key or f"NAME:{i}",
            "units": units, "statement_value": stmt_value, "book_cost": book_cost,
            "book_cost_source": "statement" if book_cost else None}


def _insts(**prices):
    return {k: {"_id": k, "price": p, "price_date": TODAY.isoformat()} for k, p in prices.items()}


def _note(amount, d, name=SP, units=None, kind="purchase"):
    return {"_id": f"n{d}{amount}", "account_id": "a1", "trade_date": datetime.combine(d, datetime.min.time()),
            "kind": kind, "amount": amount, "fund_name": name, "units": units}


def test_contract_note_purchase_shows_a_gain_at_once():
    notes = [_note(4908.98, date(2026, 10, 13), units=100.0)]
    pos = ig.build_positions(STMT, [], notes, _insts(**{SP_KEY: 50.0}))
    assert pos["holdings_with_cost"] == 1 and pos["paid_in"] == 4908.98
    assert pos["value"] == 5000.0 and pos["growth_abs"] == 91.02
    assert pos["since"] == "2026-10-13"
    g = ig.build_growth([], pos, {}, "all", TODAY)
    assert g["growth_abs"] == 91.02 and g["cost_coverage"] is None
    assert g["method"] == "simple" and "time-weighted" in g["method_label"]


def test_note_without_a_price_is_valued_at_cost_so_gain_is_zero_not_missing():
    pos = ig.build_positions(STMT, [], [_note(400.0, date(2026, 10, 6), "FTSE Global All Cap")], {})
    assert pos["growth_abs"] == 0.0 and pos["paid_in"] == 400.0


def test_statement_holding_with_book_cost_shows_a_gain():
    pos = ig.build_positions(STMT, [_h("h1", "Fund A", 100.0, 1000.0, book_cost=900.0)], [], _insts(**{"NAME:h1": 12.0}))
    row = pos["rows"][0]
    assert row["cost"] == 900.0 and row["cost_source"] == "statement"
    assert row["gain_abs"] == 300.0 and row["gain_pct"] == round(300 / 900 * 100, 2)
    assert pos["growth_abs"] == 300.0 and pos["since"] is None


def test_unknown_cost_shows_no_gain():
    pos = ig.build_positions(STMT, [_h("h1", "Fund A", 100.0, 1000.0)], [], _insts(**{"NAME:h1": 12.0}))
    row = pos["rows"][0]
    assert row["cost"] is None and row["gain_abs"] is None and row["gain_pct"] is None
    assert pos["growth_abs"] is None and pos["paid_in"] is None and pos["holdings_with_cost"] == 0
    assert pos["value"] == 1200.0  # the value is still shown
    g = ig.build_growth([], pos, {}, "all", TODAY)
    assert g["growth_abs"] is None and g["value"] == 1200.0


def test_mixed_holdings_give_a_partial_headline():
    holds = [_h("h1", "Fund A", 100.0, 1000.0, book_cost=900.0), _h("h2", "Fund B", 10.0, 500.0),
             _h("h3", "Fund C", 5.0, 100.0, book_cost=80.0)]
    insts = _insts(**{"NAME:h1": 12.0, "NAME:h2": 60.0, "NAME:h3": 20.0})
    pos = ig.build_positions(STMT, holds, [], insts)
    assert pos["holdings_with_cost"] == 2 and pos["holdings_total"] == 3
    assert pos["paid_in"] == 980.0 and pos["growth_abs"] == (1200 + 100) - 980
    g = ig.build_growth([], pos, insts, "all", TODAY)
    assert g["cost_coverage"] == "over 2 of 3 holdings"
    assert g["value"] == 1900.0
    assert all(p["paid_in"] is None for p in g["points"])  # no paid-in line over part of the value
    assert ig.coverage_label(3, 3) is None and ig.coverage_label(0, 3) is None


def test_note_on_a_statement_holding_with_unknown_cost_stays_unknown():
    holds = [_h("h1", SP, 10.0, 500.0)]
    pos = ig.build_positions(STMT, holds, [_note(100.0, date(2026, 10, 13))], {})
    assert pos["rows"][0]["cost"] is None and pos["growth_abs"] is None


def test_note_adds_to_a_known_cost_holding_and_old_notes_are_ignored():
    holds = [_h("h1", SP, 10.0, 500.0, book_cost=400.0)]
    notes = [_note(100.0, date(2026, 10, 13)), _note(9999.0, date(2026, 9, 1))]
    pos = ig.build_positions(STMT, holds, notes, _insts(**{"NAME:h1": 55.0}))
    assert pos["rows"][0]["cost"] == 500.0 and pos["rows"][0]["value"] == 650.0
    assert pos["growth_abs"] == 150.0 and len(pos["rows"]) == 1


def test_chart_fills_forward_and_backfills_from_history():
    notes = [_note(1000.0, date(2026, 10, 13), units=10.0)]
    inst = {"_id": SP_KEY, "price": 103.0, "price_date": "2026-10-15", "history": [
        {"price_date": "2026-10-13", "price": 100.0}, {"price_date": "2026-10-15", "price": 103.0}]}
    pos = ig.build_positions(STMT, [], notes, {SP_KEY: inst})
    pts = ig.build_series([], pos, {SP_KEY: inst}, "all", TODAY)
    assert [p["date"] for p in pts] == ["2026-10-13", "2026-10-14", "2026-10-15"]
    assert [p["value"] for p in pts] == [1000.0, 1000.0, 1030.0]  # daily, filled forward
    assert all(p["paid_in"] == 1000.0 for p in pts)


def test_chart_has_one_point_when_nothing_else_is_known():
    pos = ig.build_positions(STMT, [_h("h1", "Fund A", 100.0, 1000.0, book_cost=900.0)], [], _insts(**{"NAME:h1": 12.0}))
    assert len(ig.build_series([], pos, {}, "all", TODAY)) == 1


def test_parser_schema_and_cleaner_accept_and_omit_book_cost(monkeypatch):
    import inspect
    from app.routers.investments import clean_book_cost
    import app.services.pdf as pdf
    src = inspect.getsource(pdf.llm_parse_investment_statement)
    assert '"book_cost"' in src and "Never estimate" in src
    assert clean_book_cost(1234.5) == 1234.5
    for missing in (None, 0, -5, "n/a", True, float("nan")):
        assert clean_book_cost(missing) is None


def test_penny_tool_matches_the_helper_and_states_partial_wording(monkeypatch):
    import app.db.collections as colls
    import app.services.penny_tools as pt
    holds = [_h("h1", "Fund A", 100.0, 1000.0, book_cost=900.0), _h("h2", "Fund B", 10.0, 500.0)]
    insts = _insts(**{"NAME:h1": 12.0, "NAME:h2": 60.0})
    acc = {"_id": "a1", "user_id": "u@x.com", "provider": "Vanguard", "account_type": "ISA",
           "statement_date": datetime.combine(STMT, datetime.min.time())}

    class _AccCol:
        def find(self, filt=None, proj=None):
            return _Cur([acc])

    async def _find_h(*a, **k):
        return holds

    async def _insts_fn(keys):
        return insts
    monkeypatch.setattr(colls, "investment_accounts_col", _AccCol())
    monkeypatch.setattr(ig, "investment_valuations_col", Col())
    monkeypatch.setattr(ig, "investment_holdings_col", Col(holds))
    monkeypatch.setattr(ig, "investment_notes_col", Col())
    monkeypatch.setattr(ig, "get_instruments", _insts_fn)
    monkeypatch.setattr(ig, "user_today", lambda: TODAY)
    direct = asyncio.run(ig.account_growth(acc, "all"))
    out = asyncio.run(pt.execute_tool("u@x.com", "get_investment_growth", {}))
    row = out["accounts"][0]
    assert row["growth"]["raw"] == direct["growth_abs"] == 300.0
    assert row["paid_in"]["raw"] == direct["paid_in"] == 900.0
    assert row["cost_coverage"] == "over 1 of 2 holdings"
    assert "Cost not known" in row["note"]
    assert "Capital at risk" in out["capital_at_risk"]


def test_penny_tool_says_cost_not_known_when_no_cost(monkeypatch):
    import app.services.penny_tools as pt
    import app.db.collections as colls
    acc = {"_id": "a1", "user_id": "u@x.com", "provider": "Vanguard", "account_type": "ISA"}

    class _AccCol:
        def find(self, filt=None, proj=None):
            return _Cur([acc])

    async def _growth(a, r):
        return {"value": 1200.0, "paid_in": None, "growth_abs": None, "growth_pct": None, "as_of": "2026-10-15"}
    monkeypatch.setattr(colls, "investment_accounts_col", _AccCol())
    monkeypatch.setattr(ig, "account_growth", _growth)
    out = asyncio.run(pt.execute_tool("u@x.com", "get_investment_growth", {}))
    row = out["accounts"][0]
    assert row["status"] == "cost_not_known" and "growth" not in row


# ── reviewer round: sales, backfill, note-only pricing, matching ────────────

def test_partial_sale_removes_proportional_cost():
    holds = [_h("h1", "Fund A", 100.0, 1500.0, book_cost=1000.0)]
    sale = _note(750.0, date(2026, 10, 10), "Fund A", units=50.0, kind="sale")
    sale["amount"] = -750.0
    pos = ig.build_positions(STMT, holds, [sale], _insts(**{"NAME:h1": 15.0}))
    row = pos["rows"][0]
    assert row["cost"] == 500.0 and row["value"] == 750.0 and row["gain_abs"] == 250.0


def test_partial_sale_without_units_uses_proceeds_over_value():
    holds = [_h("h1", "Fund A", 100.0, 1500.0, book_cost=1000.0)]
    sale = _note(750.0, date(2026, 10, 10), "Fund A")
    sale["amount"] = -750.0
    row = ig.build_positions(STMT, holds, [sale], _insts(**{"NAME:h1": 15.0}))["rows"][0]
    assert row["cost"] == 500.0 and row["gain_abs"] == 250.0


def test_full_sale_clamps_cost_at_zero_and_never_goes_negative():
    holds = [_h("h1", "Fund A", 100.0, 1500.0, book_cost=1000.0)]
    sale = _note(1500.0, date(2026, 10, 10), "Fund A", units=100.0)
    sale["amount"] = -1500.0
    row = ig.build_positions(STMT, holds, [sale], _insts(**{"NAME:h1": 15.0}))["rows"][0]
    assert row["cost"] == 0.0 and row["value"] == 0.0 and row["gain_abs"] == 0.0
    over = _note(9000.0, date(2026, 10, 10), "Fund A")
    over["amount"] = -9000.0
    assert ig.build_positions(STMT, holds, [over], _insts(**{"NAME:h1": 15.0}))["rows"][0]["cost"] == 0.0


def test_sale_with_no_computable_ratio_marks_cost_not_known():
    holds = [_h("h1", "Fund A", None, 0.0, book_cost=1000.0)]
    sale = _note(100.0, date(2026, 10, 10), "Fund A")
    sale["amount"] = -100.0
    row = ig.build_positions(STMT, holds, [sale], {})["rows"][0]
    assert row["cost"] is None and row["gain_abs"] is None


def test_backfill_keeps_cash_so_the_chart_does_not_jump():
    holds = [_h("h1", "Fund A", 10.0, 1000.0, book_cost=900.0, key="ISINA"), _h("c1", "Cash", None, 200.0, book_cost=200.0)]
    inst = {"_id": "ISINA", "price": 100.0, "price_date": "2026-10-15", "history": [
        {"price_date": "2026-10-13", "price": 100.0}, {"price_date": "2026-10-14", "price": 100.0},
        {"price_date": "2026-10-15", "price": 100.0}]}
    insts = {"ISINA": inst}
    pos = ig.build_positions(STMT, holds, [], insts)
    pts = ig.build_series([], pos, insts, "all", TODAY)
    assert [p["value"] for p in pts] == [1200.0, 1200.0, 1200.0]


def test_note_only_fund_is_in_the_refresh_set_and_then_priced():
    from app.services.investment_prices import note_only_instruments
    notes = [_note(4908.98, date(2026, 10, 13), units=100.0)]
    held = [_h("h1", "Fund A", 10.0, 500.0)]
    keys = note_only_instruments(datetime.combine(STMT, datetime.min.time()), held, notes)
    assert keys == [(SP_KEY, SP)]
    # a note matching a holding is not note-only, and pre-statement notes are ignored
    assert note_only_instruments(STMT, [_h("h2", SP, 5.0, 100.0)], notes) == []
    assert note_only_instruments(STMT, [], [_note(10000.0, date(2026, 9, 1))]) == []
    unpriced = ig.build_positions(STMT, held, notes, {})
    assert unpriced["growth_abs"] == 0.0
    priced = ig.build_positions(STMT, held, notes, _insts(**{SP_KEY: 51.0}))
    assert priced["growth_abs"] == 191.02


def test_refresh_paths_include_note_only_keys(monkeypatch):
    import asyncio
    import app.services.investment_prices as ip
    ensured, fetched = [], []
    acc = {"_id": "a1", "user_id": "u", "statement_date": datetime.combine(STMT, datetime.min.time())}

    async def _ensure(key, **kw):
        ensured.append((key, kw.get("name")))
    monkeypatch.setattr(ip, "ensure_instrument", _ensure)
    keys = asyncio.run(ip._link_note_only(acc, [], [_note(100.0, date(2026, 10, 13))]))
    assert keys == {SP_KEY} and ensured == [(SP_KEY, SP)]


def test_ambiguous_match_prefers_the_longest_name():
    holds = [_h("h1", "Vanguard FTSE Global", 10.0, 500.0, book_cost=400.0),
             _h("h2", "Vanguard FTSE Global All Cap Index Fund", 10.0, 500.0, book_cost=400.0)]
    pos = ig.build_positions(STMT, holds, [_note(100.0, date(2026, 10, 13), "FTSE Global All Cap Index Fund")], {})
    by = {r["id"]: r for r in pos["rows"]}
    assert by["h2"]["cost"] == 500.0 and by["h1"]["cost"] == 400.0


def test_backfill_starts_at_the_statement_date_not_at_old_history():
    from datetime import timedelta
    hist = [{"price_date": (TODAY - timedelta(days=i)).isoformat(), "price": 100.0} for i in range(400, -1, -1)]
    inst = {"_id": "ISINA", "price": 100.0, "price_date": TODAY.isoformat(), "history": hist}
    holds = [_h("h1", "Fund A", 10.0, 1000.0, book_cost=900.0, key="ISINA")]
    stmt = date(2026, 9, 10)
    pos = ig.build_positions(stmt, holds, [], {"ISINA": inst})
    pts = ig.build_series([], pos, {"ISINA": inst}, "all", TODAY)
    assert pts[0]["date"] == "2026-09-10" and len(pts) == 36
