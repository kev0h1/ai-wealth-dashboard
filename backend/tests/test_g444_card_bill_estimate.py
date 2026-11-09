"""G444: the closed-statement estimate, its working, and the stale-balance fix.

Invented names and figures only. Production shape: a card that closed on the
22nd, a balance read some time ago, and movements the sync saw afterwards.
"""
import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.card_statements import estimate_statement
from tests.test_g441_card_bill import TODAY, _accounts, _card, _payer, _row, _terms

CLOSE = date(2026, 10, 22)
BALANCE_READ = datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc)


def _seen(row, when):
    return {**row, "first_seen": when}


def _est(rows, balance=-2000.0, as_of=BALANCE_READ, terms=None):
    card = {**_card("alpha", balance), **({"balance_as_of": as_of} if as_of else {})}
    accounts = {"alpha": card, "cash": _payer()}
    return estimate_statement(card, terms or _terms(), rows, accounts, TODAY, pairs=[])


# (f) A stale balance: movements first seen after the balance was read are not in it.

def test_movements_first_seen_after_the_balance_was_read_are_not_backed_out():
    rows = [
        _seen(_row("alpha", date(2026, 10, 30), 100.0, "debit"), BALANCE_READ - timedelta(hours=2)),
        # Seen days after the balance was read, so the balance cannot contain it.
        _seen(_row("alpha", date(2026, 11, 6), 648.19, "debit"), BALANCE_READ + timedelta(days=3)),
    ]
    bill = _est(rows)
    assert bill["estimated_bill"] == 1900.0          # 2000 - 100, not 2000 - 748.19
    assert bill["working"]["stale_excluded"] == 648.19 and bill["working"]["stale_excluded_count"] == 1
    assert bill["spending_since_close"] == 748.19      # the spending line still tells the whole story


def test_same_pass_rows_inside_the_grace_are_still_backed_out():
    rows = [_seen(_row("alpha", date(2026, 11, 3), 80.0, "debit"), BALANCE_READ + timedelta(minutes=2))]
    assert _est(rows)["estimated_bill"] == 1920.0


def test_stale_credits_are_not_added_back_either():
    rows = [_seen(_row("alpha", date(2026, 11, 6), 500.0, "credit"), BALANCE_READ + timedelta(days=2))]
    bill = _est(rows)
    assert bill["estimated_bill"] == 2000.0 and bill["working"]["credits_since_close"] == 0.0


def test_without_a_balance_timestamp_every_movement_counts_as_before():
    rows = [_seen(_row("alpha", date(2026, 11, 6), 648.19, "debit"), BALANCE_READ + timedelta(days=3))]
    assert _est(rows, as_of=None)["estimated_bill"] == 1351.81


# (a) pending and booked duplicates, (d) credits, (e) the close day, (b) other cards.

def test_pending_rows_are_never_backed_out_and_are_reported():
    rows = [_row("alpha", date(2026, 11, 7), 60.0, "debit", is_pending=True),
            _row("alpha", date(2026, 11, 7), 25.0, "debit")]
    bill = _est(rows, as_of=None)
    assert bill["estimated_bill"] == 1975.0
    assert bill["working"]["pending_excluded"] == 60.0 and bill["working"]["spent_since_close"] == 25.0


def test_a_pending_twin_of_a_booked_purchase_is_not_counted_twice():
    rows = [_row("alpha", date(2026, 11, 5), 42.0, "debit"),
            _row("alpha", date(2026, 11, 5), 42.0, "debit", is_pending=True)]
    assert _est(rows, as_of=None)["estimated_bill"] == 1958.0


def test_payments_and_refunds_since_the_close_are_added_back():
    rows = [_row("alpha", date(2026, 11, 1), 300.0, "credit"), _row("alpha", date(2026, 11, 2), 50.0, "debit")]
    bill = _est(rows, as_of=None)
    assert bill["estimated_bill"] == 2250.0           # 2000 owed + 300 repaid - 50 spent
    assert bill["working"]["credits_since_close"] == 300.0 and bill["working"]["spent_since_close"] == 50.0


def test_the_close_day_belongs_to_the_statement_and_the_next_day_does_not():
    rows = [_row("alpha", CLOSE, 70.0, "debit"), _row("alpha", CLOSE + timedelta(days=1), 30.0, "debit")]
    assert _est(rows, as_of=None)["estimated_bill"] == 1970.0


def test_another_cards_rows_never_enter_the_working():
    rows = [_row("beta", date(2026, 11, 2), 999.0, "debit"), _row("beta", date(2026, 11, 3), 99.0, "credit")]
    bill = _est(rows, as_of=None)
    assert bill["estimated_bill"] == 2000.0 and bill["working"]["spent_since_close"] == 0.0


# The working

def test_working_carries_the_components_as_amounts_and_the_card_estimate():
    rows = [_row("alpha", date(2026, 11, 2), 117.49, "debit"), _row("alpha", date(2026, 11, 4), 20.0, "credit")]
    bill = _est(rows)
    assert bill["working"] == {
        "balance_owed": 2000.0, "balance_as_of": BALANCE_READ.isoformat(), "spent_since_close": 117.49,
        "credits_since_close": 20.0, "pending_excluded": 0.0, "stale_excluded": 0.0, "stale_excluded_count": 0,
        "card_estimate": 1902.51}


def test_card_estimate_survives_an_entered_amount():
    terms = _terms(statement_amount_override={"close_date": "2026-10-22", "amount": 2640.78})
    bill = _est([_row("alpha", date(2026, 11, 2), 100.0, "debit")], terms=terms)
    assert bill["estimated_bill"] == 2640.78 and bill["user_entered"] is True
    assert bill["working"]["card_estimate"] == 1900.0


def test_the_working_is_logged_at_debug_as_amounts_only(caplog):
    rows = [_row("alpha", date(2026, 11, 2), 117.49, "debit", description="SECRET SHOP", merchant_name="SECRET SHOP")]
    with caplog.at_level(logging.DEBUG, logger="app.services.card_statements"):
        _est(rows)
    line = next(r.getMessage() for r in caplog.records if "card statement working" in r.getMessage())
    assert "117.49" in line and "SECRET" not in line


def test_no_balance_means_no_working():
    card = {**_card("alpha", None)}
    card.pop("balance")
    bill = estimate_statement(card, _terms(), [], {"alpha": card, "cash": _payer()}, TODAY, pairs=[])
    assert "working" not in bill


# The Finexer sync stores a balance only when the bank returned one.

from tests.test_a176_bank_sync import Resp, IDLE
from tests.test_a179_account_refresh import TwoAccountClient, _quiet, recomputes, _finexer_world, _call  # noqa: F401


def _card_client(balance_status=200, current=250.0):
    class C(TwoAccountClient):
        async def get(self, url, params=None):
            if url == "/bank_accounts":
                return Resp(200, {"data": [{"id": "acc1", "provider": "amex", "class": "credit_card"}]})
            if url.endswith("/balance"):
                if balance_status != 200:
                    return Resp(balance_status, {})
                return Resp(200, {"data": [{"type": "actual", "current": current, "available": 900.0}]})
            return await super().get(url, params)
    return C(post_responses=[Resp(200, IDLE)])


def _doc(accts):
    return next(x for x in accts.docs if x["_id"] == "acc1")


def test_a_failed_balance_fetch_keeps_the_last_good_balance(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, {"balance": -1992.59, "balance_as_of": BALANCE_READ},
                              client=_card_client(balance_status=500))
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == -1992.59 and d["balance_as_of"] == BALANCE_READ


def test_a_good_balance_fetch_stamps_when_it_was_read(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, {"balance": -1.0}, client=_card_client())
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == -250.0 and d["card_balance_entry_type"] == "actual"
    assert isinstance(d["balance_as_of"], datetime) and datetime.now(timezone.utc) - d["balance_as_of"].replace(tzinfo=timezone.utc) < timedelta(minutes=5)


# Editing an estimated defined card bill: the entered amount replaces the bill, the
# payment rule still settles it, and it clears when the next statement closes.

from app.services.card_statements import apply_statement_bills
from tests.test_g441_card_bill import _debit, REF_A, LEARNED_A, _learned

ENTERED = {"statement_amount_override": {"close_date": "2026-10-22", "amount": 2640.78}}


def _applied(bill):
    accounts = {"alpha": _card("alpha", -2000.0), "cash": _payer()}
    out, _ = apply_statement_bills([_learned(card="alpha")], {"alpha": bill}, accounts, TODAY, date(2026, 11, 27))
    return [b for b in out if b["name"].startswith("card-statement:")]


def test_editing_an_estimated_bill_replaces_the_amount_everywhere_the_bill_is_read():
    before = _est([], as_of=None)
    assert before["status"] == "estimated" and before["payment_remaining"] == 2000.0
    after = _est([], as_of=None, terms=_terms(**ENTERED))
    assert after["status"] == "estimated" and after["user_entered"] is True
    assert after["payment_amount"] == after["payment_remaining"] == 2640.78
    [defined] = _applied(after)
    assert defined["amount"] == 2640.78 and defined["amount_basis"] == "user_entered"
    assert LEARNED_A not in [b["name"] for b in _applied(after)]


def test_the_payment_rule_still_settles_an_entered_bill_whatever_the_bank_takes():
    rows = [_debit(date(2026, 11, 7), 1992.59, REF_A)]
    bill = _est(rows, as_of=None, terms=_terms(**ENTERED))
    assert bill["status"] == "paid" and bill["payment_remaining"] == 0.0
    assert _applied(bill) == []


def test_the_entered_amount_clears_itself_once_the_next_statement_closes():
    card = {**_card("alpha", -2000.0)}
    accounts = {"alpha": card, "cash": _payer()}
    later = estimate_statement(card, _terms(**ENTERED), [], accounts, date(2026, 11, 23), pairs=[])
    assert later["statement_close"] == "2026-11-22" and "user_entered" not in later
    assert later["estimated_bill"] == 2000.0
