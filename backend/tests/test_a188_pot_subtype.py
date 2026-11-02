"""A188: a Monzo pot, Revolut vault or Starling space is stored as a savings
account at sync time, so the payday plan never buffers it as a spend account.

Finexer is mocked at the client level; Mongo collections are the in-memory
fakes from the A176 and G129 tests. No database is touched. Pot names here are
generic.
"""
import asyncio
from datetime import datetime, timedelta

import app.core.timeutil as timeutil
import app.services.companion as companion
import app.services.finexer_sync as fs
from app.routers.analytics import _account_pool_kind
from app.services import finexer_coverage as cov
from app.services.account_kinds import is_savings_account
from tests.test_a176_bank_sync import (  # noqa: F401  (autouse fixture is imported too)
    CONSENT, IDLE, Client, Col, Resp, _quiet, _wire_sync,
    UID as SYNC_UID,
)
from tests.test_g129_payday_plan_payload import (
    SALARY_ACCT, UID, _account, _base_patch, _bill, _dest, _payday_plan, _salary,
)

POT = {"class": "current", "provider": "monzo", "identification": {}}
MAIN = {"class": "current", "provider": "monzo",
        "identification": {"sort_code": "040004", "account_number": "12345678"}}


# (a) the helper and its agreement with is_balance_only

def test_is_pot_account_rule():
    assert cov.is_pot_account("monzo", POT)
    assert cov.is_pot_account("REVOLUT", {"identification": {}})
    assert cov.is_pot_account("starling", {})
    assert not cov.is_pot_account("monzo", MAIN)
    assert not cov.is_pot_account("monzo", {"identification": {"number": "1"}})
    assert not cov.is_pot_account("halifax", POT)
    assert not cov.is_pot_account(None, POT)


def test_is_balance_only_agrees_with_is_pot_account():
    for prov in ("monzo", "revolut", "starling", "halifax", "amex"):
        for acc in (POT, MAIN, {"class": "savings", "identification": {}}):
            if cov.is_pot_account(prov, acc):
                assert cov.is_balance_only(prov, acc)[0] is True
    assert cov.is_balance_only("monzo", MAIN) == (False, "")


# (b) sync stores the pot as savings

class MixedClient(Client):
    async def get(self, url, params=None):
        if url == "/bank_accounts":
            return Resp(200, {"data": [
                {"id": "acc1", "class": "current", "provider": "monzo", "identification": MAIN["identification"]},
                {"id": "pot1", "class": "current", "provider": "monzo", "identification": {}},
                {"id": "pot2", "class": "savings", "provider": "monzo", "identification": {}},
                {"id": "card1", "class": "credit_card", "provider": "revolut", "identification": {}},
                {"id": "loan1", "class": "loan", "provider": "starling", "identification": {}},
                {"id": "biz1", "class": "current", "type": "business", "provider": "monzo", "identification": {}},
            ]})
        if url.endswith("/balance"):
            return Resp(200, {"data": [{"type": "actual", "current": 0.5}]})
        if "/transactions" in url:
            return Resp(200, {"data": []})
        return await super().get(url, params)


def test_sync_stores_pots_as_savings(monkeypatch):
    accts = Col([])
    _wire_sync(monkeypatch, accts)
    c = MixedClient(post_responses=[Resp(200, IDLE)])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, SYNC_UID))
    by = {d["_id"]: d for d in accts.docs}
    assert by["acc1"]["subtype"] == "TRANSACTION" and by["acc1"]["balance_only"] is False
    assert by["pot1"]["subtype"] == "SAVINGS" and by["pot1"]["type"] == "bank"
    assert by["pot1"]["balance_only"] is True
    assert by["pot2"]["subtype"] == "SAVINGS"
    assert by["card1"]["subtype"] == "CREDIT_CARD" and by["card1"]["type"] == "credit_card"
    assert by["loan1"]["type"] == "debt" and by["loan1"]["subtype"] != "SAVINGS"
    assert by["biz1"]["subtype"] == "TRANSACTION", "business-tagged accounts are never overridden"
    assert is_savings_account(by["pot1"]) and not is_savings_account(by["acc1"])


# (d) the pool classifier

def test_stored_pot_lands_in_the_savings_pool():
    pot = {"subtype": "SAVINGS", "type": "bank", "currency": "GBP", "balance_only": True}
    assert _account_pool_kind(pot) == "savings"
    assert _account_pool_kind({"subtype": "TRANSACTION", "type": "bank", "currency": "GBP"}) == "spendable"


# (c) the payday plan

BILL_ACCT = "acc-everyday"
SAVER = "acc-saver-pot"


def _plan(monkeypatch, pots):
    today_d = timeutil.user_today()
    accounts = [
        _account(SALARY_ACCT, 1000.0, "Salary Account"),
        _account(BILL_ACCT, 0.0, "Everyday"),
        _account(SAVER, 0.0, "Rainy day pot", subtype="SAVINGS"),
        *pots,
    ]
    # A habitual 100 pound transfer into SAVER (the G129 fixture), which is what
    # makes the plan surface; it also covers the class-savings pot case.
    moved_on = datetime.combine(today_d, datetime.min.time())
    txns = [
        {"user_id": UID, "transaction_type": "debit", "account_id": SALARY_ACCT,
         "amount": 100.0, "date": moved_on, "category": "Transfer"},
        {"user_id": UID, "transaction_type": "credit", "account_id": SAVER,
         "amount": 100.0, "date": moved_on},
    ]
    pay_period, _ = _base_patch(
        monkeypatch,
        accounts=accounts,
        bills=[_bill("Council Tax", 2, 200.0, account_id=BILL_ACCT)],
        income=[_salary(0, 999.0)],
        transactions=txns,
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    monkeypatch.setattr(pay_period, "prev_pay_period", lambda ref, cfg: (ref - timedelta(days=30), ref))
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    plan = _payday_plan(items)
    assert plan is not None, [i['type'] for i in items]
    return plan


def _pot_doc(acct_id, subtype):
    d = _account(acct_id, 0.5, "Holiday pot", subtype=subtype)
    d.update({"balance_only": True})
    return d


def test_plan_gives_a_stored_pot_no_move_and_no_buffer(monkeypatch):
    plan = _plan(monkeypatch, [_pot_doc("pot-a", "SAVINGS"), _pot_doc("pot-b", "SAVINGS")])
    assert not any(d["account_id"] in ("pot-a", "pot-b") for d in plan["dests"])
    saver = _dest(plan, SAVER)  # class-savings pot: mirrors the habit, never buffered
    assert saver["destination_kind"] == "savings" and saver["buffer"] == 0 and saver["move"] == 100
    everyday = _dest(plan, BILL_ACCT)
    # a real current account: bills + typical spend + buffer, minus balance
    assert everyday["destination_kind"] == "spend"
    assert everyday["bills_total"] == 200 and everyday["buffer"] == 50
    assert everyday["move"] == everyday["bills_total"] + everyday["spend_typical"] + 50
    assert everyday["spend_typical"] == 0 and everyday["move"] == 250


def test_unfixed_class_current_pot_would_be_buffered(monkeypatch):
    # Documents the A188 defect shape: this is why the sync test above matters.
    plan = _plan(monkeypatch, [_pot_doc("pot-a", "TRANSACTION")])
    assert _dest(plan, "pot-a")["buffer"] == 50
