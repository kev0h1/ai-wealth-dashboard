"""B59 step 1: amounts are never rounded where they can be matched."""
import asyncio
from datetime import datetime

import app.services.penny_search as penny_search
import app.services.penny_tools as penny_tools_module
from tests.test_penny_proposals import (
    UID, _FakeCol, _patch_get_categories, _patch_recat_txn_col, _txn_doc,
)
from tests.test_penny_search_totals import _install, _row, search
from app.services.penny_tools import execute_tool


def test_search_row_amount_keeps_pence(monkeypatch):
    _install(monkeypatch, [_row(1, 159.70, "GBP", description="BRITISH GAS", merchant_key="british gas")])
    res = search(q="British Gas")
    assert res["transactions"][0]["amount"] == {"raw": 159.7, "formatted": "£159.70"}


def test_amount_clause_whole_pound_is_half_pound_tolerant():
    lo = penny_search.amount_clause(160.0)["$or"][0]["amount"]
    assert lo["$gte"] == 159.5 and lo["$lte"] == 160.5


def test_amount_clause_with_pence_stays_exact():
    rng = penny_search.amount_clause(159.7)["$or"][0]["amount"]
    assert rng["$gte"] == 159.695 and rng["$lte"] == 159.705


def _gas(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    _patch_recat_txn_col(monkeypatch, [_txn_doc(
        _id="T1", merchant="BRITISH GAS", desc="BRITISH GAS", amount=159.70,
        category="Bills", day="2026-10-01", merchant_key="british gas")])
    _patch_get_categories(monkeypatch)


def test_resolver_whole_pound_amount_matches_pence(monkeypatch):
    _gas(monkeypatch)
    res = asyncio.run(penny_tools_module._resolve_transaction_for_propose(
        UID, None, "British Gas", "2026-10-01", 160))
    assert res["doc"]["_id"] == "T1"


def test_resolver_exact_amount_does_not_match_a_different_pence(monkeypatch):
    _gas(monkeypatch)
    res = asyncio.run(penny_tools_module._resolve_transaction_for_propose(
        UID, None, "British Gas", "2026-10-01", 159.50))
    assert "error" in res
    exact = asyncio.run(penny_tools_module._resolve_transaction_for_propose(
        UID, None, "British Gas", "2026-10-01", 159.70))
    assert exact["doc"]["_id"] == "T1"
