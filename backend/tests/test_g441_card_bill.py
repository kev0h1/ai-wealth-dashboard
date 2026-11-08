"""G441: a saved card bill must replace the learned payment in production.

Production shape (invented names and figures): two Amex cards from one issuer,
one with saved statement details and a "contains 32000" payment rule, a
learned 567.72-style series from the paying account, card charges after the
close, and a card that was rebuilt so the previous statement window is missing.
"""
import asyncio
from datetime import date

import pytest

import app.routers.analytics as analytics
import app.routers.card_terms as card_terms
from app.routers.card_terms import CardTermsBody
from app.services.card_statements import apply_statement_bills, estimate_statement
from tests.penny_proposal_fakes import FakeCollection

TODAY = date(2026, 11, 8)           # statement closed 22 Oct, due 9 Nov
REF_A = "AMERICAN EXPRESS 3799-111111-32000"
REF_B = "AMERICAN EXPRESS 3799-222222-41009"
LEARNED_A = "American Express 32000"
LEARNED_B = "American Express 41009"


def _card(account_id, balance):
    return {"_id": account_id, "name": f"Example Amex {account_id}", "provider": "amex",
            "type": "credit_card", "subtype": "CREDIT_CARD", "balance": balance}


def _payer():
    return {"_id": "cash", "name": "Example Current", "provider": "barclays", "type": "bank",
            "subtype": "TRANSACTION", "currency": "GBP", "balance": 5000, "include_in_safe_to_spend": True}


def _terms(**changes):
    terms = {"statement_close_day": 22, "payment_due_day": 9, "payment_due_days_after_close": None,
             "payment_method": "full", "payment_account_id": "cash", "fixed_payment_amount": None,
             "payment_match": {"kind": "contains", "text": "32000"}}
    terms.update(changes)
    return terms


def _row(account_id, when, amount, kind, **extra):
    return {"account_id": account_id, "date": when, "amount": amount, "transaction_type": kind,
            "is_pending": False, **extra}


def _debit(when, amount, ref):
    return _row("cash", when, amount, "debit", description=ref, merchant_name="American Express")


def _rows(*extra):
    # Alpha was rebuilt: nothing reaches back to the 23 Sep statement start.
    # Beta (the same issuer) has charges that must never leak into Alpha.
    return [
        _debit(date(2026, 9, 9), 540.00, REF_A), _debit(date(2026, 10, 9), 567.72, REF_A),
        _debit(date(2026, 10, 9), 99.80, REF_B),
        _row("alpha", date(2026, 11, 2), 117.49, "debit"), _row("alpha", date(2026, 11, 5), 8.99, "debit"),
        _row("beta", date(2026, 10, 30), 300.00, "debit"), _row("beta", date(2026, 11, 3), 50.00, "debit"),
        *extra,
    ]


def _accounts(alpha=-900.0, beta=-700.0):
    return {"alpha": _card("alpha", alpha), "beta": _card("beta", beta), "cash": _payer()}


def _estimate(rows=None, card="alpha", terms=None, accounts=None):
    accounts = accounts or _accounts()
    return estimate_statement(accounts[card], terms or _terms(), _rows() if rows is None else rows,
                              accounts, TODAY, pairs=[])


def _learned(name=LEARNED_A, amount=567.72, card="beta"):
    # Attributed to the wrong card on purpose: the rule still claims it.
    return {"name": name, "amount": amount, "expected_date": "2026-11-09", "days_away": 1,
            "account_id": "cash", "card_dest_account_id": card, "is_card_repayment": True}


# 1. The estimate needs only the balance and the movements since the close.

def test_rebuilt_card_estimates_from_live_balance_less_movements_since_close():
    bill = _estimate()
    assert bill["statement_close"] == "2026-10-22" and bill["payment_due"] == "2026-11-09"
    # 900 owed now, 117.49 + 8.99 spent after the close, none of Beta's counted.
    assert bill["estimated_bill"] == 773.52
    assert bill["status"] == "estimated" and bill["payment_amount"] == 773.52
    assert bill["spending_since_close"] == 126.48


def test_two_cards_from_one_issuer_are_chosen_by_account_id():
    beta = _estimate(card="beta", terms=_terms(payment_match={"kind": "contains", "text": "41009"}))
    assert beta["estimated_bill"] == 350.0       # 700 - 300 - 50, never Alpha's charges


def test_pending_item_in_the_statement_blocks_the_estimate_but_a_later_one_does_not():
    later = _estimate(rows=_rows(_row("alpha", date(2026, 11, 6), 20.0, "debit", is_pending=True)))
    assert later["status"] == "estimated" and later["estimated_bill"] == 773.52
    inside = _estimate(rows=_rows(_row("alpha", date(2026, 10, 20), 20.0, "debit", is_pending=True)))
    assert inside["estimated_bill"] is None


def test_no_balance_at_all_is_unknown_never_zero():
    accounts = _accounts(alpha=None)
    bill = _estimate(accounts=accounts)
    assert bill["estimated_bill"] is None and bill["payment_amount"] is None
    assert bill["status"] == "amount_unknown"        # the rule matched, the amount did not


# 2. A defined bill always replaces its learned series.

def test_estimated_defined_bill_replaces_the_learned_series_once():
    bill = _estimate()
    applied, resolved = apply_statement_bills([_learned(), _learned(LEARNED_B, 99.80)], {"alpha": bill},
                                              _accounts(), TODAY, date(2026, 11, 27))
    names = [b["name"] for b in applied]
    assert LEARNED_A not in names and LEARNED_B in names and resolved == {"alpha"}
    defined = [b for b in applied if b["name"].startswith("card-statement:")]
    assert len(defined) == 1 and defined[0]["amount"] == 773.52
    assert defined[0]["amount_basis"] == "statement_estimate"


def _unknown_bill():
    return _estimate(rows=_rows(_row("alpha", date(2026, 10, 20), 20.0, "debit", is_pending=True)))


def test_unknown_amount_keeps_the_learned_amount_once_flagged_and_never_zero():
    bill = _unknown_bill()
    assert bill["status"] == "amount_unknown" and bill["rule_series_keys"] == [LEARNED_A]
    assert "Amount not known yet" in bill["reason"] and "!" not in bill["reason"] and "—" not in bill["reason"]
    # A duplicate learned occurrence in the window must not double the payment.
    applied, known = apply_statement_bills([_learned(), _learned(), _learned(LEARNED_B, 99.80)], {"alpha": bill},
                                           _accounts(), TODAY, date(2026, 11, 27))
    mine = [b for b in applied if b["name"] == LEARNED_A]
    assert known == {"alpha"} and len(mine) == 1
    assert mine[0]["amount"] == 567.72 and mine[0]["amount_basis"] == "statement_unknown"
    assert mine[0]["expected_date"] == "2026-11-09" and mine[0]["card_dest_account_id"] == "alpha"
    assert [b["name"] for b in applied].count(LEARNED_B) == 1       # the other card is untouched
    assert not any(b["name"].startswith("card-statement:") for b in applied)


def test_unknown_amount_due_outside_the_window_emits_nothing_but_still_replaces():
    applied, _ = apply_statement_bills([_learned()], {"alpha": _unknown_bill()}, _accounts(), TODAY, date(2026, 11, 6))
    assert applied == []


def test_unknown_amount_with_the_payment_already_landed_is_paid_and_leaves_no_bill():
    landed = _rows(_row("alpha", date(2026, 10, 20), 20.0, "debit", is_pending=True),
                   _debit(date(2026, 11, 6), 801.10, REF_A))
    bill = _estimate(rows=landed)
    assert bill["status"] == "paid" and bill["payment_amount"] == 801.10 and bill["payment_remaining"] == 0.0
    applied, _ = apply_statement_bills([_learned()], {"alpha": bill}, _accounts(), TODAY, date(2026, 11, 27))
    assert applied == []


def test_unknown_amount_without_a_rule_match_changes_nothing():
    bill = _estimate(rows=_rows(_row("alpha", date(2026, 10, 20), 20.0, "debit", is_pending=True)),
                     terms=_terms(payment_match={"kind": "contains", "text": "99999"}))
    assert bill["status"] == "incomplete_history"
    original = _learned()
    applied, _ = apply_statement_bills([original], {"alpha": bill}, _accounts(), TODAY, date(2026, 11, 27))
    assert applied == [original]


# 3. Saving the card settings refreshes the money views before returning (H145, G399).

@pytest.fixture
def stores(monkeypatch):
    uid = "g441@example.test"
    accounts = FakeCollection([
        {"_id": "alpha", "user_id": uid, "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"},
        {"_id": "cash", "user_id": uid, "type": "bank", "subtype": "TRANSACTION", "currency": "GBP"},
    ])
    terms = FakeCollection()
    calls: list[str] = []

    async def refresh(u):
        calls.append(u)

    monkeypatch.setattr(card_terms, "accounts_col", accounts)
    monkeypatch.setattr(card_terms, "card_terms_col", terms)
    monkeypatch.setattr(analytics, "_refresh_after_override", refresh)
    return uid, terms, calls


def test_every_card_settings_save_path_refreshes_the_money_views(stores):
    uid, terms, calls = stores
    user = {"email": uid}
    asyncio.run(card_terms.save_card_terms("alpha", CardTermsBody(
        status="confirmed", statement_close_day=22, payment_due_day=9, payment_method="full",
        payment_account_id="cash"), user))
    assert calls == [uid]
    asyncio.run(card_terms._update_scoped_terms(uid, "alpha", {"payment_method": "full"}, {"status": None}))
    assert calls == [uid, uid]
    asyncio.run(card_terms.clear_card_terms("alpha", user))
    assert calls == [uid, uid, uid]


# 4. The person's own statement amount (G441).

from fastapi import HTTPException

from app.core import timeutil
from app.services.card_statements import statement_dates


def _entered(amount=801.10, close="2026-10-22", **extra):
    return {"statement_amount_override": {"close_date": close, "amount": amount}, **extra}


def _unknown_rows():
    return _rows(_row("alpha", date(2026, 10, 20), 20.0, "debit", is_pending=True))


def test_entered_amount_makes_an_unknown_bill_estimated_and_replaces_the_learned_series():
    bill = _estimate(rows=_unknown_rows(), terms=_terms(**_entered()))
    assert bill["status"] == "estimated" and bill["user_entered"] is True
    assert bill["estimated_bill"] == 801.10 and bill["payment_remaining"] == 801.10
    applied, _ = apply_statement_bills([_learned(), _learned(LEARNED_B, 99.80)], {"alpha": bill},
                                       _accounts(), TODAY, date(2026, 11, 27))
    names = [b["name"] for b in applied]
    assert LEARNED_A not in names and LEARNED_B in names
    defined = [b for b in applied if b["name"].startswith("card-statement:")]
    assert len(defined) == 1 and defined[0]["amount"] == 801.10 and defined[0]["amount_basis"] == "user_entered"


def test_entered_amount_wins_over_an_estimate_for_the_same_close():
    bill = _estimate(terms=_terms(**_entered(700.0)))
    assert bill["estimated_bill"] == 700.0 and bill["user_entered"] is True


def test_entered_amount_expires_when_the_next_close_passes_or_for_another_close():
    other = _estimate(rows=_unknown_rows(), terms=_terms(**_entered(close="2026-09-22")))
    assert other["status"] == "amount_unknown" and "user_entered" not in other
    later = estimate_statement(_accounts()["alpha"], _terms(**_entered()), _unknown_rows(), _accounts(),
                               date(2026, 11, 23), pairs=[])
    assert later["statement_close"] == "2026-11-22" and "user_entered" not in later


@pytest.mark.parametrize("bad", [0, -5, float("nan"), float("inf"), 100000.01, True, "12", None])
def test_malformed_entered_amounts_are_ignored(bad):
    bill = _estimate(rows=_unknown_rows(), terms=_terms(**_entered(bad)))
    assert bill["status"] == "amount_unknown"


def test_entered_amount_is_ignored_for_a_fixed_payment():
    bill = _estimate(terms=_terms(payment_method="fixed", fixed_payment_amount=100, **_entered(700.0)))
    assert bill["payment_amount"] == 100.0 and "user_entered" not in bill


@pytest.fixture
def override_stores(monkeypatch):
    uid = "g441b@example.test"
    accounts = FakeCollection([
        {"_id": "alpha", "user_id": uid, "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"},
        {"_id": "theirs", "user_id": "other@example.test", "type": "credit_card", "subtype": "CREDIT_CARD", "currency": "GBP"},
    ])
    terms = FakeCollection([{"_id": f"{uid}:alpha", "user_id": uid, "account_id": "alpha", **_terms()}])
    calls: list[str] = []

    async def refresh(u):
        calls.append(u)

    monkeypatch.setattr(card_terms, "accounts_col", accounts)
    monkeypatch.setattr(card_terms, "card_terms_col", terms)
    monkeypatch.setattr(analytics, "_refresh_after_override", refresh)
    return uid, terms, calls


def _post(uid, account, amount):
    return asyncio.run(card_terms.save_statement_amount(account, card_terms.StatementAmountBody(amount=amount), {"email": uid}))


def test_saving_an_amount_stores_it_against_the_current_close_and_refreshes(override_stores):
    uid, terms, calls = override_stores
    out = _post(uid, "alpha", 801.1)
    close = statement_dates(timeutil.user_today(), _terms())[1].isoformat()
    assert out["terms"]["statement_amount_override"] == {"close_date": close, "amount": 801.1}
    assert terms.docs[0]["statement_amount_override"] == {"close_date": close, "amount": 801.1}
    assert calls == [uid]
    asyncio.run(card_terms.clear_statement_amount("alpha", {"email": uid}))
    assert terms.docs[0]["statement_amount_override"] is None and calls == [uid, uid]


@pytest.mark.parametrize("bad", [0, -1, 100001, float("nan"), 0.004])
def test_invalid_amounts_are_refused_and_nothing_is_stored(override_stores, bad):
    uid, terms, calls = override_stores
    with pytest.raises(HTTPException) as exc:
        _post(uid, "alpha", bad)
    assert exc.value.status_code == 422 and "statement_amount_override" not in terms.docs[0] and calls == []


def test_another_users_card_is_refused(override_stores):
    uid, terms, calls = override_stores
    with pytest.raises(HTTPException) as exc:
        _post(uid, "theirs", 50.0)
    assert exc.value.status_code == 404 and calls == []
    with pytest.raises(HTTPException) as exc:
        asyncio.run(card_terms.clear_statement_amount("theirs", {"email": uid}))
    assert exc.value.status_code == 404


def test_a_card_without_statement_dates_refuses_an_amount(override_stores):
    uid, terms, calls = override_stores
    terms.docs[0]["statement_close_day"] = None
    with pytest.raises(HTTPException) as exc:
        _post(uid, "alpha", 50.0)
    assert exc.value.status_code == 422


def test_a_full_terms_save_keeps_the_entered_amount(override_stores):
    uid, terms, calls = override_stores
    _post(uid, "alpha", 801.1)
    asyncio.run(card_terms.save_card_terms("alpha", CardTermsBody(status="confirmed", apr_pct=19.9), {"email": uid}))
    assert terms.docs[0]["statement_amount_override"]["amount"] == 801.1
