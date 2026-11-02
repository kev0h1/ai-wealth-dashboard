"""G403: every reader of the recurring series key sees the per-card key of a
linked card repayment. Invented ids and amounts only."""
import asyncio
from datetime import date, datetime, timedelta

import app.core.timeutil as timeutil
import app.services.debt_plan as debt_plan
from app.routers.analytics import _learn_card_repayment_destinations
from app.services.categories import BUILTIN_CATEGORY_KINDS
from tests.test_pending_observed import (
    FakeCol, UID, _cached, _freeze, _pattern, _pending_doc, _run_build_response, _settled_txn,
)

import pytest
from tests.test_pending_observed import _FakeCursor, _match


@pytest.fixture(autouse=True)
def _honour_projections(monkeypatch):
    """The shared fake ignores projections, which would hide a missing
    `own_transfer_match` field. Make it behave like Mongo here."""
    def find(self, query=None, projection=None):
        docs = [d for d in self.docs if _match(d, query or {})]
        if projection:
            docs = [{k: v for k, v in d.items() if k == "_id" or k in projection or k in (query or {})} for d in docs]
        return _FakeCursor(docs)
    monkeypatch.setattr(FakeCol, "find", find)


CARD_ID = "64f1a2b3c4d5e6f708192a3b"
KEY = f"American Express {CARD_ID}"
STAMP = {"card_repayment": {"issuer": "american_express", "card_account_id": CARD_ID}}


def _amex(amount, on_date, **extra):
    row = _settled_txn("AMERICAN EXPRESS", amount, on_date)
    row["category"] = "Debt"
    row["own_transfer_match"] = STAMP
    row.update(extra)
    return row


def _bill():
    return _pattern(key=KEY, avg_amount=88.0, category="Debt")


def test_stamped_posted_debit_closes_the_per_card_bill(monkeypatch):
    _freeze(monkeypatch)
    resp = _run_build_response(monkeypatch, [_bill()], observed=[_amex(88.0, timeutil.user_today())])
    assert resp["upcoming_bills"] == []


def test_unstamped_posted_debit_does_not_close_it(monkeypatch):
    _freeze(monkeypatch)
    plain = _amex(88.0, timeutil.user_today())
    plain.pop("own_transfer_match")
    resp = _run_build_response(monkeypatch, [_bill()], observed=[plain])
    assert len(resp["upcoming_bills"]) == 1


def test_pending_row_still_matches_the_per_card_bill(monkeypatch):
    _freeze(monkeypatch)
    today = timeutil.user_today()
    earlier = _amex(250.0, today - timedelta(days=12))  # different amount: only teaches the key map
    pending = [_pending_doc("p1", "AMERICAN EXPRESS", 88.0, today)]
    resp = _run_build_response(monkeypatch, [_bill()], observed=[earlier], pending=pending)
    assert resp["upcoming_bills"] == []
    assert len(resp["observed_pending_bills"]) == 1


def test_bill_name_is_the_key_but_display_name_has_no_account_id(monkeypatch):
    _freeze(monkeypatch)
    pattern = {**_bill(), "card_dest_account_name": "Platinum"}
    resp = _run_build_response(monkeypatch, [pattern])
    bill = resp["upcoming_bills"][0]
    assert bill["name"] == KEY
    assert bill["display_name"] == "American Express Platinum"
    assert CARD_ID not in bill["display_name"]
    plain = _run_build_response(monkeypatch, [_bill()])["upcoming_bills"][0]
    assert plain["display_name"] == "American Express" and CARD_ID not in plain["display_name"]


def test_debt_plan_maps_a_per_card_series_to_its_card(monkeypatch):
    today = date(2026, 11, 2)
    card = {"_id": CARD_ID, "name": "Platinum"}
    debits, credits = [], []
    for i in range(3):
        d = datetime(2026, 8 + i, 10)
        debits.append({"merchant_name": None, "description": "AMERICAN EXPRESS", "amount": 88.0, "date": d,
                       "account_id": "bank1", "own_transfer_match": {"card_repayment": {"issuer": "american_express", "card_account_id": CARD_ID}}})
        credits.append({"amount": 88.0, "date": d, "transaction_type": "credit"})
    pattern = {"key": f"American Express {CARD_ID}", "account_id": "bank1", "avg_amount": 88.0, "avg_interval": 30.0,
               "next_date": "2026-11-10"}

    class Cache:
        async def find_one(self, _q): return {"recurring_spend": [pattern]}

    class Txns:
        def find(self, _q, _p=None):
            class C:
                async def to_list(self, _n): return debits
            return C()

    monkeypatch.setattr(debt_plan, "cashflow_cache_col", Cache())
    monkeypatch.setattr(debt_plan, "transactions_col", Txns())
    predicted, bills, ambiguous = asyncio.run(
        debt_plan._map_upcoming_bills_to_cards("u", today, [card], {CARD_ID: credits}))
    assert CARD_ID in bills and bills[CARD_ID][0]["matched"] >= 2
    assert bills[CARD_ID][0]["name"] == "American Express Platinum"


def test_learned_card_repayment_destination_uses_the_per_card_key():
    """The learned-repayment path behind card_growth_reserved keys by the
    wrapper too; end to end card_growth_reserved is unproven until UAT."""
    kinds = dict(BUILTIN_CATEGORY_KINDS)
    account_map = {
        "bank1": {"name": "Current", "balance": 500.0, "provider": "Bank", "is_credit_card": False, "is_spendable": True},
        CARD_ID: {"name": "Platinum", "balance": -900.0, "provider": "Amex", "is_credit_card": True, "is_spendable": False},
    }
    raw = []
    for i in range(3):
        d = datetime(2026, 8 + i, 10)
        raw.append({"_id": f"d{i}", "merchant_name": None, "description": "AMERICAN EXPRESS", "amount": 88.0, "date": d,
                    "transaction_type": "debit", "category": "Debt", "custom_category": None, "account_id": "bank1",
                    "own_transfer_match": {"card_repayment": {"issuer": "american_express", "card_account_id": CARD_ID}}})
        raw.append({"_id": f"c{i}", "merchant_name": None, "description": "PAYMENT RECEIVED", "amount": 88.0, "date": d,
                    "transaction_type": "credit", "category": "Transfer", "custom_category": None, "account_id": CARD_ID})
    result = _learn_card_repayment_destinations(raw, account_map, kinds)
    assert set(result) == {KEY}
    assert result[KEY]["dest_account_id"] == CARD_ID


# ── X1: no reader shows the per-card key ─────────────────────────────────

def _long_tokens(value) -> list[str]:
    import json
    import re
    return [t for t in re.findall(r"[A-Za-z0-9]{12,}", json.dumps(value, default=str))]


def test_notification_body_and_penny_tool_output_carry_no_account_id(monkeypatch):
    import app.services.penny_tools as pt
    from app.services.notifications import _bill_shortfall_body
    _freeze(monkeypatch)
    pattern = {**_bill(), "card_dest_account_name": "Platinum"}
    resp = _run_build_response(monkeypatch, [pattern])
    bill = resp["upcoming_bills"][0]
    bill = {**bill, "account_bank": "Bank", "account_balance": 10.0}
    assert bill["name"] == KEY and CARD_ID in bill["name"]
    assert _long_tokens(_bill_shortfall_body(bill, "£")) == []

    async def cache(_uid): return {"x": 1}
    async def build(_cached, uid=None): return {"upcoming_bills": [bill], "upcoming_income": []}
    monkeypatch.setattr(pt, "_load_cashflow_cache", cache)
    monkeypatch.setattr(pt, "_build_cashflow_response", build)
    out = asyncio.run(pt._exec_get_upcoming_bills("u"))
    assert out["upcoming_bills"][0]["name"] == "American Express Platinum"
    row = out["upcoming_bills"][0]
    assert row["key"] == KEY  # the identity travels in its own field, for skip and dismiss
    assert _long_tokens({k: v for k, v in row.items() if k != "key"}) == []


def test_recurring_payments_label_and_plan_label_are_clean():
    from app.services.companion import _humanise_bill_name
    from app.services.own_account_transfers import repayment_display_name
    label = repayment_display_name(KEY, "Platinum")
    assert _long_tokens(_humanise_bill_name(label)) == []
    # The raw key, by contrast, still leaks hex through _humanise_bill_name.
    assert _long_tokens(_humanise_bill_name(KEY)) != []


# ── X2: the Debt rule is debit-only ──────────────────────────────────────

def test_card_repayment_debt_rule_never_files_a_credit():
    from app.services.categorisation import rule_categorise_directed
    narrative = "AMEX 3712-345678-90555"
    assert rule_categorise_directed("", narrative, is_credit=False) == "Debt"
    assert rule_categorise_directed("", narrative, is_credit=True) is None
    assert rule_categorise_directed("", "B/CARD 4929123456784321", is_credit=True) is None
    assert rule_categorise_directed("", "B/CARD DIRECT DEBIT", is_credit=True) is None


# ── Y1: Penny dismiss and skip target the real key, print the label ──────

def _penny_setup(monkeypatch):
    import app.services.penny_tools as pt
    captured = {}

    async def recurring(_uid):
        return {"series": [{"name": "American Express Platinum", "key": KEY}], "count": 1}

    async def create(uid, action, params, summary, consequence, **kw):
        captured.update(action=action, params=params, summary=summary, consequence=consequence, kw=kw)
        return {"proposal": True}

    async def cache(_uid): return {"x": 1}

    async def build(_cached, uid=None):
        return {"upcoming_bills": [{"name": KEY, "display_name": "American Express Platinum", "amount": 88.0,
                                    "expected_date": "2026-11-10"}], "upcoming_income": []}

    monkeypatch.setattr(pt, "_exec_get_recurring_payments", recurring)
    monkeypatch.setattr(pt, "_create_proposal", create)
    monkeypatch.setattr(pt, "_load_cashflow_cache", cache)
    monkeypatch.setattr(pt, "_build_cashflow_response", build)
    return pt, captured


def test_penny_dismiss_and_skip_use_the_stored_key_and_print_the_label(monkeypatch):
    pt, captured = _penny_setup(monkeypatch)
    for ref in ("American Express Platinum", KEY):
        captured.clear()
        asyncio.run(pt._exec_propose_dismiss_recurring("u", ref))
        assert captured["params"] == {"key": KEY}
        assert _long_tokens([captured["summary"], captured["consequence"]]) == []
        captured.clear()
        asyncio.run(pt._exec_propose_skip_occurrence("u", ref, "2026-11-10"))
        assert captured["params"] == {"key": KEY, "date": "2026-11-10"}
        assert "£88" in captured["summary"]  # _find_occurrence_detail resolved the amount
        assert _long_tokens([captured["summary"], captured["consequence"]]) == []


def test_penny_recurring_tool_rows_carry_both_name_and_key(monkeypatch):
    import app.services.penny_tools as pt
    out = {"series": [{"name": "American Express Platinum", "key": KEY}]}
    assert out["series"][0]["key"] == KEY and CARD_ID not in out["series"][0]["name"]
    # And the real tool: a stored series with a display_name keeps the key.
    async def cache(_uid): return {"recurring_spend": [{"key": KEY, "display_name": "American Express Platinum",
                                                          "avg_amount": 88.0, "avg_interval": 30, "next_date": "2026-11-10"}]}
    async def build(_c, uid=None): return {"upcoming_bills": [], "upcoming_income": []}
    monkeypatch.setattr(pt, "_load_cashflow_cache", cache)
    monkeypatch.setattr(pt, "_build_cashflow_response", build)
    res = asyncio.run(pt._exec_get_recurring_payments("u"))
    row = res["series"][0]
    assert row["name"] == "American Express Platinum" and row["key"] == KEY
