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


# ── Penny read tool (G271 fold-in) ──────────────────────────────────────────


# ── Penny read tool (G271, renamed get_investment_value by G338) ────────────

def _penny_setup(monkeypatch, accounts, holdings):
    import app.db.collections as colls
    import app.services.penny_tools as pt

    seen = {}

    class _AccCol:
        def find(self, filt=None, proj=None):
            seen["filter"] = filt
            return _Cur([a for a in accounts if a["user_id"] == (filt or {}).get("user_id")])

    class _HoldCol:
        def find(self, filt=None, proj=None):
            return _Cur(holdings.get((filt or {}).get("account_id"), []))

    class _NoteCol:
        def find(self, filt=None, proj=None):
            return _Cur([])

    async def _value(acc, hold=None, notes=None, insts=None):
        return 46000.0, {"insts": {}}

    monkeypatch.setattr(colls, "investment_accounts_col", _AccCol())
    monkeypatch.setattr(colls, "investment_holdings_col", _HoldCol())
    monkeypatch.setattr(colls, "investment_notes_col", _NoteCol())
    monkeypatch.setattr(ig, "account_value", _value)
    monkeypatch.setattr(ig, "price_dating", lambda *a, **k: {
        "prices_as_of": "2026-10-13", "prices_oldest": "2026-10-12", "price_confidence": "normal"})
    return pt, seen


def test_penny_investment_value_tool_returns_value_date_and_caveat(monkeypatch):
    accounts = [
        {"_id": "a1", "user_id": USER, "provider": "Vanguard", "account_type": "ISA"},
        {"_id": "a2", "user_id": "other@x.com", "provider": "Other", "account_type": "ISA"},
    ]
    pt, seen = _penny_setup(monkeypatch, accounts, {"a1": [{"_id": "h1"}]})
    out = asyncio.run(pt.execute_tool(USER, "get_investment_value", {"account": "ISA"}))
    assert seen["filter"] == {"user_id": USER}  # user scoped, never another user's account
    assert len(out["accounts"]) == 1
    row = out["accounts"][0]
    assert row["name"] == "Vanguard ISA" and row["provider"] == "Vanguard"
    assert row["value"]["raw"] == 46000.0
    assert row["prices_as_of"] == "2026-10-13" and row["prices_oldest"] == "2026-10-12"
    assert row["caveat"] == "Estimated from your holdings and recent prices. For the exact value, check Vanguard."
    assert out["capital_at_risk"] == "Capital at risk."
    blob = str(out).lower()
    for word in ("gain", "growth", "paid_in", "paid in", "anchor"):
        assert word not in blob


def test_penny_investment_value_tool_no_holdings_and_no_match(monkeypatch):
    accounts = [{"_id": "a1", "user_id": USER, "provider": "Vanguard", "account_type": "ISA"}]
    pt, _ = _penny_setup(monkeypatch, accounts, {})
    out = asyncio.run(pt.execute_tool(USER, "get_investment_value", {}))
    assert out["accounts"][0]["status"] == "no_holdings_yet"
    out = asyncio.run(pt.execute_tool(USER, "get_investment_value", {"account": "Fidelity"}))
    assert out["accounts"] == []


def test_penny_investment_value_tool_is_read_only_and_exposed_over_mcp():
    import app.services.penny_tools as pt
    from app.routers.mcp import MCP_TOOLS, TOOL_SCOPES
    names = {t["function"]["name"] for t in pt.TOOL_SCHEMAS}
    assert "get_investment_value" in names and "get_investment_growth" not in names
    assert "get_investment_value" not in {t["function"]["name"] for t in pt.PROPOSE_TOOL_SCHEMAS}
    assert TOOL_SCOPES["get_investment_value"] == "accounts:read"
    assert "get_investment_value" in {t["function"]["name"] for t in MCP_TOOLS}
