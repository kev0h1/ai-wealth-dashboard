"""G333: one account value everywhere. Kevin's UAT shape of data as fixtures
only (dates fixed); fake collections, no Mongo, no network."""
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import app.routers.investments as router  # noqa: E402
import app.services.investment_anchor as ia  # noqa: E402
import app.services.investment_growth as ig  # noqa: E402
import app.services.investment_prices as ip  # noqa: E402
from test_investment_anchor_g278 import (  # noqa: E402
    FTSE, FTSE_KEY, NOTE_FTSE_KEY, SP, SP_KEY, USER, _dt, _note, kevin_holdings, kevin_period,
)
from test_investment_growth_g271 import Col  # noqa: E402

TODAY = date(2026, 10, 24)
STMT = date(2026, 9, 4)
EXPECT = 20335.30


def notes():
    return [_note("n4", 400.0, date(2026, 10, 6), units=1.3348),
            _note("n5", 4908.98, date(2026, 10, 13), SP, units=43.0)]


def insts():
    def inst(k, price, d, source, conf, hist):
        return {"_id": k, "price": price, "price_date": d, "source": source, "confidence": conf,
                "history": [{"price_date": d, "price": price}] if hist else []}
    return {FTSE_KEY: inst(FTSE_KEY, 298.76, "2026-10-15", "legacy", "low", True),
            NOTE_FTSE_KEY: inst(NOTE_FTSE_KEY, 298.76, "2026-10-15", "legacy", "low", True),
            SP_KEY: inst(SP_KEY, 114.02, "2026-10-16", "web_search", "low", True)}


def acc(**extra):
    return {"_id": "a1", "user_id": USER, "provider": "Vanguard", "account_type": "ISA", "currency": "GBP",
            "total_value": 14835.65, "statement_date": _dt(STMT), "statement_periods": [kevin_period()],
            "last_refreshed": datetime(2026, 10, 24, 5, 30), **extra}


def _patch(monkeypatch, accounts):
    ins = insts()

    async def _get(keys):
        return ins
    for mod in (ig, router, ip):
        monkeypatch.setattr(mod, "get_instruments", _get)
    monkeypatch.setattr(ig, "investment_valuations_col", Col())
    for mod in (ig, router, ip):
        monkeypatch.setattr(mod, "investment_holdings_col", Col(kevin_holdings()))
        monkeypatch.setattr(mod, "investment_notes_col", Col(notes()))
        monkeypatch.setattr(mod, "investment_accounts_col", Col(accounts))
    monkeypatch.setattr(ig, "user_today", lambda: TODAY)
    monkeypatch.setattr(router.timeutil, "user_today", lambda: TODAY)


def test_canonical_value_is_units_times_latest_price_including_notes():
    pos = ig.build_positions(STMT, kevin_holdings(), notes(), insts(), ia.all_fee_lines([kevin_period()]))
    assert abs(pos["value"] - EXPECT) < 0.01


def test_account_value_helper_loads_what_it_needs(monkeypatch):
    a = acc()
    _patch(monkeypatch, [a])
    value, pos = asyncio.run(ig.account_value(a))
    assert abs(value - EXPECT) < 0.01 and pos["value"] == value


def test_header_growth_card_and_holdings_list_agree(monkeypatch):
    a = acc()
    _patch(monkeypatch, [a])
    g = asyncio.run(ig.account_growth(a, "all", TODAY))
    assert abs(g["value"] - EXPECT) < 0.01 and g["header_value"] == g["value"]
    assert g["value_note_kind"] is None
    rows = asyncio.run(router.get_investment_holdings("a1", {"email": USER}))
    assert abs(sum(r["current_value"] for r in rows) - EXPECT) < 0.01
    ftse = next(r for r in rows if r["id"] == "h1")
    assert ftse["units"] == round(50.32 + 1.3348, 4)


def test_display_value_equals_the_stored_total_after_a_recompute(monkeypatch):
    a = acc()
    _patch(monkeypatch, [a])
    stored = asyncio.run(ip._recompute_account(a, kevin_holdings(), insts()))
    assert abs(stored - EXPECT) < 0.01
    d = asyncio.run(router._investment_display(a, notes()))
    assert d["display_value"] == stored
    assert d["added_since"] == 5308.98 and d["paid_in_since"] == 5308.98


def test_price_dating_and_confidence(monkeypatch):
    a = acc()
    _patch(monkeypatch, [a])
    d = asyncio.run(router._investment_display(a, notes()))
    assert d["prices_as_of"] == "2026-10-16" and d["prices_oldest"] == "2026-10-15"
    assert d["price_confidence"] == "low"
    g = asyncio.run(ig.account_growth(a, "all", TODAY))
    assert (g["prices_as_of"], g["prices_oldest"], g["price_confidence"]) == ("2026-10-16", "2026-10-15", "low")


def test_normal_confidence_when_every_price_is_a_dated_real_source():
    ins = insts()
    for i in ins.values():
        i["confidence"], i["source"] = "medium", "yahoo"
    out = ig.price_dating(ins, kevin_holdings(), notes(), STMT)
    assert out["price_confidence"] == "normal"
    assert ig.price_dating({}, kevin_holdings(), notes(), STMT)["prices_as_of"] is None


def test_reconciliation_against_the_provider_names_the_provider(monkeypatch):
    anchor = ia.validate_anchor({"date": "2026-10-16", "provider_value": 20152.83, "total_paid_in": 18971.69}, TODAY)
    anchor["entered_at"] = "2026-10-16T09:00:00"
    a = acc(anchor=anchor)
    _patch(monkeypatch, [a])
    g = asyncio.run(ig.account_growth(a, "all", TODAY))
    rc = g["lifetime"]["reconciliation"]
    assert rc is not None and abs(abs(rc["difference"]) - 182.47) < 1.0
    assert "Vanguard" in rc["text"]
