"""G476: card repayment plans prefill from the card's real history.

Invented names and amounts. No database: fake collections. Every card here posts
its debit and credit on DIFFERENT days (the paying account first, the card a day
or two later), which is the case the same-day rule used to miss.
"""
import asyncio
from datetime import date, datetime

import pytest
from fastapi import HTTPException

import app.db.collections as dbc
import app.routers.commitments as commitments
import app.services.card_repayment_plans as crp
from tests.test_g475_card_repayment_plans import (
    TODAY, UID, OTHER, _Rows, _accounts, _patch_world, _series,
)

PAN = "5412 7512 3412 3456"


def _acc(**extra):
    base = _accounts(
        card={"_id": "card", "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP", "balance": -600,
              "name": "Northbank Mastercard 1234", "provider": "northbank"},
        second={"_id": "second", "type": "bank", "subtype": "CURRENT_ACCOUNT", "currency": "GBP", "balance": 900,
                "name": "Example Second Current", "provider": "barclays"},
    )
    base.update(extra)
    return base


def _row(account, kind, day, amount, desc, merchant="", **extra):
    return {"_id": f"{account}-{kind}-{day.isoformat()}-{amount}", "user_id": UID, "account_id": account,
            "transaction_type": kind, "amount": amount, "currency": "GBP",
            "date": datetime.combine(day, datetime.min.time()), "description": desc,
            "merchant_name": merchant, **extra}


def _world(monkeypatch, rows, accounts=None, series=(), terms=None):
    _patch_world(monkeypatch, [], accounts or _acc())
    monkeypatch.setattr(dbc, "card_terms_col", _Rows([terms] if terms else []))
    monkeypatch.setattr(dbc, "cashflow_cache_col", _Rows([{"_id": UID, "recurring_spend": list(series)}]))
    monkeypatch.setattr(dbc, "transactions_col", _Rows(rows))
    monkeypatch.setattr(dbc, "yapily_transactions_col", _Rows())

    async def bills(uid, **_): return {}
    import app.services.card_statements as card_statements
    monkeypatch.setattr(card_statements, "load_statement_bills", bills)


def _pair(day, amount=200.0, source="current", lag=2, ref="AMEX PAYMENT 3799-111111-20001"):
    return [
        _row(source, "debit", day, amount, ref, "Northbank"),
        _row("card", "credit", date.fromordinal(day.toordinal() + lag), amount, "PAYMENT RECEIVED - THANK YOU"),
    ]


def _prefill():
    return asyncio.run(crp.prefill(UID, "card", TODAY))


# ── 1. default name ──────────────────────────────────────────────────────────

def test_the_default_name_is_the_card_name_plus_repayment_plan(monkeypatch):
    _world(monkeypatch, [])
    out = _prefill()
    assert out["default_name"] == "Northbank Mastercard 1234 repayment plan"
    assert len(out["default_name"]) <= 40


def test_the_default_name_never_shows_a_holders_name(monkeypatch):
    accounts = _acc(card={"_id": "card", "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP",
                          "balance": -600, "name": "Mr Alex Example", "provider": "northbank"})
    _world(monkeypatch, [], accounts)
    name = _prefill()["default_name"]
    assert "Alex" not in name and "Example" not in name
    assert name.endswith("repayment plan") and "Northbank" in name


def test_a_long_card_name_is_cut_not_the_suffix():
    name = crp.default_plan_name("Northbank Platinum Rewards Mastercard 1234567")
    assert name.endswith(" repayment plan") and len(name) <= 40


# ── 2. recent repayments from both legs ──────────────────────────────────────

def test_repayments_pair_a_debit_and_a_credit_posting_on_different_days(monkeypatch):
    _world(monkeypatch, _pair(date(2026, 9, 24), lag=2) + _pair(date(2026, 8, 24), lag=3))
    out = _prefill()
    first = out["repayments"][0]
    assert first["matched"] is True and first["amount"] == 200.0
    assert first["debit_date"] == "2026-09-24" and first["card_date"] == "2026-09-26"
    assert first["source_account_id"] == "current" and first["source_account_name"] == "Example Current"
    assert len(out["repayments"]) == 2 and all(r["matched"] for r in out["repayments"])


def test_a_credit_with_no_debit_leg_is_listed_unmatched(monkeypatch):
    rows = _pair(date(2026, 9, 24)) + [_row("card", "credit", date(2026, 10, 2), 75.0, "CARD PYMT")]
    _world(monkeypatch, rows)
    out = _prefill()
    unmatched = [r for r in out["repayments"] if not r["matched"]]
    assert len(unmatched) == 1 and unmatched[0]["amount"] == 75.0 and unmatched[0]["source_account_id"] is None


def test_a_refund_credit_is_not_a_repayment(monkeypatch):
    rows = _pair(date(2026, 9, 24)) + [_row("card", "credit", date(2026, 10, 2), 18.0, "ACME SHOP REFUND")]
    _world(monkeypatch, rows)
    out = _prefill()
    assert [r["amount"] for r in out["repayments"]] == [200.0]
    assert any(c["amount"] == 18.0 for c in out["recent_credits"])  # still on the credits list


def test_the_usual_source_and_amount_are_preselected(monkeypatch):
    rows = _pair(date(2026, 9, 24), 200.0) + _pair(date(2026, 8, 24), 180.0) + _pair(date(2026, 7, 24), 200.0)
    _world(monkeypatch, rows)
    out = _prefill()
    assert out["source_account_id"] == "current" and out["source_choice_needed"] is False
    assert out["amount"] == 200.0 and out["amount_basis"] == "usual_repayments" and out["estimated"] is True
    assert out["schedule"]["start_pence"] == 20000


def test_several_paying_accounts_are_offered_not_picked(monkeypatch):
    rows = _pair(date(2026, 9, 24), 200.0) + _pair(date(2026, 8, 24), 150.0, source="second", lag=1)
    _world(monkeypatch, rows, series=[_series()])
    out = _prefill()
    assert out["source_account_id"] is None and out["source_choice_needed"] is True
    assert {s["account_id"] for s in out["sources"]} == {"current", "second"}
    assert out["fill_rule"] is None and out["card_leg_match"] is None
    assert {s["account_id"]: s["usual_amount"] for s in out["sources"]} == {"current": 200.0, "second": 150.0}


def test_a_saved_paying_account_wins_over_several_sources(monkeypatch):
    rows = _pair(date(2026, 9, 24), 200.0) + _pair(date(2026, 8, 24), 150.0, source="second", lag=1)
    _world(monkeypatch, rows, terms={"user_id": UID, "account_id": "card", "payment_account_id": "second"})
    assert _prefill()["source_account_id"] == "second"


# ── 3. the automatic card-leg match ──────────────────────────────────────────

def test_the_card_leg_is_found_across_days_and_becomes_the_rule(monkeypatch):
    _world(monkeypatch, _pair(date(2026, 9, 24), lag=3))
    out = _prefill()
    match = out["card_leg_match"]
    assert match["matched"] and match["card_date"] == "2026-09-27" and match["debit_date"] == "2026-09-24"
    assert out["fill_rule"] == {"match_type": "description_contains", "match_value": "20001"}


def test_a_credit_outside_the_posting_lag_is_not_paired(monkeypatch):
    _world(monkeypatch, _pair(date(2026, 9, 24), lag=6))
    out = _prefill()
    assert out["card_leg_match"] is None and out["fill_rule"] is None
    assert out["repayments"][0]["matched"] is False


def test_a_different_amount_is_not_paired(monkeypatch):
    rows = [_row("current", "debit", date(2026, 9, 24), 200.0, "AMEX 20001"),
            _row("card", "credit", date(2026, 9, 25), 199.0, "PAYMENT RECEIVED")]
    _world(monkeypatch, rows)
    assert _prefill()["card_leg_match"] is None


def test_each_debit_pairs_only_one_credit(monkeypatch):
    rows = [_row("current", "debit", date(2026, 9, 24), 200.0, "AMEX 20001"),
            _row("card", "credit", date(2026, 9, 25), 200.0, "PAYMENT RECEIVED"),
            _row("card", "credit", date(2026, 9, 26), 200.0, "PAYMENT RECEIVED")]
    _world(monkeypatch, rows)
    assert sum(1 for r in _prefill()["repayments"] if r["matched"]) == 1


def test_the_fallback_lists_the_cards_recent_credits(monkeypatch):
    rows = [_row("card", "credit", date(2026, 10, 2), 75.0, "CARD PYMT"),
            _row("card", "credit", date(2026, 9, 20), 40.0, "PAYMENT RECEIVED")]
    _world(monkeypatch, rows)
    out = _prefill()
    assert out["card_leg_match"] is None
    assert [c["amount"] for c in out["recent_credits"]] == [75.0, 40.0]


def test_another_users_rows_never_pair(monkeypatch):
    rows = _pair(date(2026, 9, 24))
    rows[0]["user_id"] = OTHER
    _world(monkeypatch, rows)
    assert _prefill()["card_leg_match"] is None


# ── 4. search ────────────────────────────────────────────────────────────────

def _search(q="", source="current", uid=UID, **kw):
    return asyncio.run(crp.search(uid, "card", source, q, **kw))


def _search_world(monkeypatch):
    rows = _pair(date(2026, 9, 24)) + [
        _row("card", "credit", date(2026, 10, 2), 75.0, "CARD PYMT 5412751234123456", "Card Pymt"),
        _row("current", "debit", date(2026, 10, 3), 12.5, "COFFEE SHOP", "Coffee Shop"),
        _row("second", "debit", date(2026, 10, 4), 75.0, "SECRET OTHER ACCOUNT PAYMENT", "Other"),
        _row("card", "debit", date(2026, 10, 5), 33.0, "BOOKSHOP", "Bookshop"),
    ]
    _world(monkeypatch, rows)


def test_search_matches_the_raw_narrative_not_only_the_clean_name(monkeypatch):
    _search_world(monkeypatch)
    out = _search("pymt")
    assert [i["amount"] for i in out["items"]] == [75.0]
    out = _search("payment received")
    assert [i["on_card"] for i in out["items"]] == [True]


def test_search_matches_an_amount(monkeypatch):
    _search_world(monkeypatch)
    assert {i["amount"] for i in _search("£200.00")["items"]} == {200.0}
    assert [i["amount"] for i in _search("12.50")["items"]] == [12.5]


def test_search_only_returns_the_card_and_the_paying_account(monkeypatch):
    _search_world(monkeypatch)
    everything = _search("")
    assert {i["account_id"] for i in everything["items"]} == {"card", "current"}
    assert all("SECRET" not in i["narrative"] for i in everything["items"])
    assert _search("secret")["items"] == []


def test_search_rejects_another_users_account_or_card(monkeypatch):
    _search_world(monkeypatch)
    assert _search("", uid=OTHER) is None
    assert asyncio.run(crp.search(UID, "card", "not-mine", "")) is None
    assert asyncio.run(crp.search(UID, "current", "card", "")) is None  # a current account is no card


def test_search_masks_long_card_numbers_and_paginates(monkeypatch):
    _search_world(monkeypatch)
    out = _search("pymt")
    assert "5412751234123456" not in out["items"][0]["narrative"] and "…23456" in out["items"][0]["narrative"]
    page = _search("", limit=2)
    assert len(page["items"]) == 2 and page["has_more"] is True and page["total"] > 2
    rest = _search("", limit=2, skip=2)
    assert rest["items"][0]["id"] != page["items"][0]["id"]


def test_a_card_row_carries_the_rule_of_the_debit_it_pairs_with(monkeypatch):
    _search_world(monkeypatch)
    paired = next(i for i in _search("payment received")["items"])
    assert paired["fill_rule"] == {"match_type": "description_contains", "match_value": "20001"}
    assert _search("pymt")["items"][0]["fill_rule"] is None  # no paying debit found for it


def test_the_search_route_returns_404_for_a_foreign_account(monkeypatch):
    _search_world(monkeypatch)
    with pytest.raises(HTTPException) as err:
        asyncio.run(commitments.card_plan_search("card", "not-mine", "", 20, 0, {"email": UID}))
    assert err.value.status_code == 404
    out = asyncio.run(commitments.card_plan_search("card", "current", "pymt", 20, 0, {"email": UID}))
    assert out["total"] == 1
