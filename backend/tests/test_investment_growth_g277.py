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


def test_parser_schema_and_cleaner_accept_and_omit_book_cost(monkeypatch):
    import inspect
    from app.routers.investments import clean_book_cost
    import app.services.pdf as pdf
    src = inspect.getsource(pdf.llm_parse_investment_statement)
    assert '"book_cost"' in src and "Never estimate" in src
    assert clean_book_cost(1234.5) == 1234.5
    for missing in (None, 0, -5, "n/a", True, float("nan")):
        assert clean_book_cost(missing) is None


# ── reviewer round: sales, backfill, note-only pricing, matching ────────────

def test_partial_sale_removes_proportional_cost():
    holds = [_h("h1", "Fund A", 100.0, 1500.0, book_cost=1000.0)]
    sale = _note(750.0, date(2026, 10, 10), "Fund A", units=50.0, kind="sale")
    sale["amount"] = -750.0
    pos = ig.build_positions(STMT, holds, [sale], _insts(**{"NAME:h1": 15.0}))
    row = pos["rows"][0]
    assert row["cost"] == 500.0 and row["value"] == 750.0


def test_partial_sale_without_units_uses_proceeds_over_value():
    holds = [_h("h1", "Fund A", 100.0, 1500.0, book_cost=1000.0)]
    sale = _note(750.0, date(2026, 10, 10), "Fund A")
    sale["amount"] = -750.0
    row = ig.build_positions(STMT, holds, [sale], _insts(**{"NAME:h1": 15.0}))["rows"][0]
    assert row["cost"] == 500.0


def test_full_sale_clamps_cost_at_zero_and_never_goes_negative():
    holds = [_h("h1", "Fund A", 100.0, 1500.0, book_cost=1000.0)]
    sale = _note(1500.0, date(2026, 10, 10), "Fund A", units=100.0)
    sale["amount"] = -1500.0
    row = ig.build_positions(STMT, holds, [sale], _insts(**{"NAME:h1": 15.0}))["rows"][0]
    assert row["cost"] == 0.0 and row["value"] == 0.0
    over = _note(9000.0, date(2026, 10, 10), "Fund A")
    over["amount"] = -9000.0
    assert ig.build_positions(STMT, holds, [over], _insts(**{"NAME:h1": 15.0}))["rows"][0]["cost"] == 0.0


def test_sale_with_no_computable_ratio_marks_cost_not_known():
    holds = [_h("h1", "Fund A", None, 0.0, book_cost=1000.0)]
    sale = _note(100.0, date(2026, 10, 10), "Fund A")
    sale["amount"] = -100.0
    row = ig.build_positions(STMT, holds, [sale], {})["rows"][0]
    assert row["cost"] is None


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
    assert unpriced["value"] == 5408.98  # the note is valued at cost until it is priced
    priced = ig.build_positions(STMT, held, notes, _insts(**{SP_KEY: 51.0}))
    assert priced["value"] == 5600.0


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


