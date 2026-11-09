"""G381 (Kevin 2026-10-31): the card repayment rule, one module.

Both legs visible: the current account side is Debt and the card side Transfer.
Only the current account side visible: a debit that is just a card issuer's name,
where the user holds a card from that issuer, is Debt without a question. Loans,
unheld issuers and two cards with no tail are never filed. A user answer wins, the
teaching sheet option (`mine-card`) files Debt and remembers the payee, and the
re-match fixes old rows. Names and figures are invented; shapes come from Kevin's
examples ("<BANK> -75.53", "<BANK> WORLD MASTERCAR -75.85"). No model call is made.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.services.card_repayment as cr
import app.services.own_account_transfers as oat
from app.services.spending import SpendingContext, card_accounts_from_docs, find_card_repayment_ids, txn_flow

from test_g442_ai_transfer_judgement import KINDS, TOKENS, UID, _arun, _row, mongo_env

D0 = datetime(2026, 10, 1)

CURRENT = {"_id": "natw", "user_id": UID, "name": "Main", "provider": "NatWest", "type": "current", "currency": "GBP"}
BARC = {"_id": "barc", "user_id": UID, "name": "Everyday", "provider": "Barclays", "type": "current", "currency": "GBP"}
CARD1 = {"_id": "ncc1", "user_id": UID, "name": "NatWest Mastercard 7788", "provider": "NatWest", "type": "credit_card", "currency": "GBP"}
CARD2 = {"_id": "ncc2", "user_id": UID, "name": "NatWest Platinum 5566", "provider": "NatWest", "type": "credit_card", "currency": "GBP"}
CHASE = {"_id": "chcc", "user_id": UID, "name": "Chase Credit Card", "provider": "Chase", "type": "credit_card", "currency": "GBP"}
LOAN = {"_id": "nloan", "user_id": UID, "name": "NatWest Loan", "provider": "NatWest", "type": "loan", "currency": "GBP"}


def _by_id(*accounts):
    return {a["_id"]: a for a in accounts}


def _hits(rows, *accounts):
    return cr_hits(rows, _by_id(*accounts))


def cr_hits(rows, accounts):
    return oat.card_repayment_rule_hits(rows, accounts, set(), set())


def _debit(id_="d1", text="NATWEST", amount=75.53, account="natw", **extra):
    return _row(id_, "debit", amount, account, D0, text, **extra)


async def _reconcile(monkeypatch, rows, accounts):
    async with mongo_env(monkeypatch, rows, accounts=accounts) as cols:
        await oat.reconcile_own_account_transfers(UID)
        docs = {r["_id"]: r async for r in cols["transactions"].find({})}
        return docs


# ── both legs visible ───────────────────────────────────────────────────────

def test_both_sides_visible_gives_debt_on_the_current_side_and_transfer_on_the_card(monkeypatch):
    # the debit names nobody; the card credit says payment received: the card account type,
    # the amount, the direction and the window are the evidence
    rows = [_debit("d", "BILL PAYMENT 0042", 61.78),
            _row("c", "credit", 61.78, "ncc1", D0 + timedelta(days=1), "PAYMENT RECEIVED - THANK YOU", category="Income")]
    docs = _arun(_reconcile(monkeypatch, rows, [CURRENT, BARC, CARD1]))
    assert docs["d"]["category"] == "Debt" and docs["c"]["category"] == "Transfer"
    assert docs["d"]["own_transfer_match"]["card_repayment"] == {"issuer": "natwest", "card_account_id": "ncc1"}
    assert docs["c"]["own_transfer_match"]["card_repayment"]["issuer"] == "natwest"
    # both are movement kinds and Spend counts neither the debit nor the credit
    ctx = SpendingContext.from_docs(list(docs.values()), KINDS, None, card_accounts_from_docs([CARD1]))
    assert not txn_flow(docs["d"], ctx).counts_as_spend and not txn_flow(docs["c"], ctx).counts_as_spend


def test_card_side_route_needs_wording_one_debit_and_no_other_issuer():
    accounts = _by_id(CURRENT, BARC, CARD1)
    credit = _row("c", "credit", 61.78, "ncc1", D0, "PAYMENT RECEIVED - THANK YOU", category="Income")
    debit = _debit("d", "BILL PAYMENT", 61.78)
    assert cr.card_account_type_repayment(credit, debit, accounts, {"natwest": ["ncc1"]}, [credit, debit]) == "natwest"
    # a refund-shaped credit (no payment wording) is not a repayment
    refund = {**credit, "description": "REFUND ACME"}
    assert cr.card_account_type_repayment(refund, debit, accounts, {"natwest": ["ncc1"]}, [refund, debit]) is None
    # a second debit of the amount from another account makes the money ambiguous
    other = _row("x", "debit", 61.78, "barc", D0, "SOMETHING")
    assert cr.card_account_type_repayment(credit, debit, accounts, {"natwest": ["ncc1"]}, [credit, debit, other]) is None
    # a debit that names a different issuer is that issuer's payment, not this card's
    amex = _debit("a", "AMEX PAYMENT", 61.78)
    assert cr.card_account_type_repayment(credit, amex, accounts, {"natwest": ["ncc1"]}, [credit, amex]) is None
    # a direct debit must name the card's issuer
    dd = _debit("dd", "SOME UTILITY", 61.78, bank_code="DD")
    assert cr.card_account_type_repayment(credit, dd, accounts, {"natwest": ["ncc1"]}, [credit, dd]) is None
    # two cards from one issuer: the credit must print this card's tail
    both = _by_id(CURRENT, CARD1, CARD2)
    cards = {"natwest": ["ncc1", "ncc2"]}
    assert cr.card_account_type_repayment(credit, debit, both, cards, [credit, debit]) is None
    tailed = {**credit, "description": "PAYMENT RECEIVED 7788"}
    assert cr.card_account_type_repayment(tailed, debit, both, cards, [tailed, debit]) == "natwest"


def test_the_older_routes_keep_their_guarantees_through_the_one_module():
    accounts = _by_id(CURRENT, CARD1, CARD2)
    cards = {"natwest": ["ncc1", "ncc2"]}
    # G443: the narrow same-bank rule, tail read from the card's name
    c = _row("c", "credit", 61.78, "ncc1", D0, "DIRECT DEBIT PAYMENT 7788", category="Income")
    d = _debit("d", "NATWEST", 61.78)
    assert cr.card_repayment_issuer(c, d, accounts, cards, [c, d]) == "natwest"
    # two cards, no tail on the credit: ambiguity is no match, whichever route looks
    c2 = {**c, "description": "DIRECT DEBIT PAYMENT"}
    assert cr.card_repayment_issuer(c2, d, accounts, cards, [c2, d]) is None
    # A194: a bank-coded direct debit naming the issuer, one card only
    single = _by_id(CURRENT, CARD1)
    c3 = {**c, "description": "CARD CREDIT"}
    dd = _debit("dd", "NATWEST", 61.78, bank_code="DD")
    assert cr.card_repayment_issuer(c3, dd, single, {"natwest": ["ncc1"]}, [c3, dd]) == "natwest"
    # the old module path still exports the same functions (one implementation)
    assert oat.card_repayment_issuer is cr.card_repayment_issuer
    assert oat.same_bank_card_repayment is cr.same_bank_card_repayment


# ── only the current account side visible ───────────────────────────────────

@pytest.mark.parametrize("text,amount", [("NATWEST", 75.53), ("NW WORLD MASTERCAR", 75.85),
                                          ("NATWEST DIRECT DEBIT", 75.53), ("NATWEST - 4421", 75.53)])
def test_current_side_only_with_a_card_from_that_issuer_is_debt_with_no_question(monkeypatch, text, amount):
    rows = [_debit("d", text, amount)]
    docs = _arun(_reconcile(monkeypatch, rows, [CURRENT, BARC, CARD1]))
    assert docs["d"]["category"] == "Debt"
    assert docs["d"]["card_repayment_rule"]["issuer"] == "natwest"
    assert docs["d"]["card_repayment_rule"]["card_account_id"] == "ncc1"
    assert "own_transfer_match" not in docs["d"], "no pair, so nothing for the transfers review to ask"
    # Spend reads it as the card repayment it is: the purchases were already counted
    ctx = SpendingContext.from_docs(list(docs.values()), KINDS, None, card_accounts_from_docs([CARD1]))
    assert txn_flow(docs["d"], ctx).reason == "card_repayment" and not txn_flow(docs["d"], ctx).counts_as_spend


def test_without_the_rule_a_bare_debt_debit_is_a_loan_and_counts():
    # the baseline the rule changes: Debt with no card evidence is spending
    doc = _debit("d", "NATWEST", category="Debt")
    ctx = SpendingContext.from_docs([doc], KINDS, None, [])
    assert txn_flow(doc, ctx).counts_as_spend


def test_no_card_from_that_issuer_is_not_filed(monkeypatch):
    rows = [_debit("d", "NATWEST"), _debit("e", "NW WORLD MASTERCAR", 75.85)]
    docs = _arun(_reconcile(monkeypatch, rows, [CURRENT, BARC, CHASE]))
    for key in ("d", "e"):
        assert "card_repayment_rule" not in docs[key]
    assert docs["d"]["category"] == "Other"


def test_loans_are_guarded():
    # narrative says loan, or fees, or is more than the issuer's name: never filed
    for text in ("NATWEST LOAN", "NATWEST OVERDRAFT FEE", "NATWEST MORTGAGE", "NATWEST CLEANERS", "NATWEST INSURANCE"):
        assert _hits([_debit("d", text)], CURRENT, CARD1) == {}, text
    # the user also holds a NatWest loan: a BARE issuer name could be its instalment, so it is asked
    assert _hits([_debit("d", "NATWEST")], CURRENT, CARD1, LOAN) == {}
    assert _hits([_debit("d", "NATWEST DIRECT DEBIT")], CURRENT, CARD1, LOAN) == {}
    # ...but a card-specific form, or the card's own tail, is still the card
    assert list(_hits([_debit("d", "NW WORLD MASTERCAR")], CURRENT, CARD1, LOAN)) == ["d"]
    assert list(_hits([_debit("d", "NATWEST 7788")], CURRENT, CARD1, LOAN)) == ["d"]
    # a card purchase code, a debit leaving a card, a credit and a pending row never are
    assert _hits([_debit("d", "NATWEST", bank_code="POS")], CURRENT, CARD1) == {}
    assert _hits([_debit("d", "NATWEST", account="ncc1")], CURRENT, CARD1) == {}
    assert _hits([_row("c", "credit", 5.0, "natw", D0, "NATWEST")], CURRENT, CARD1) == {}
    assert _hits([_debit("d", "NATWEST", is_pending=True)], CURRENT, CARD1) == {}


def test_two_cards_from_one_issuer_without_a_tail_follow_the_ambiguity_rule():
    assert _hits([_debit("d", "NATWEST")], CURRENT, CARD1, CARD2) == {}
    assert _hits([_debit("d", "NW WORLD MASTERCAR")], CURRENT, CARD1, CARD2) == {}
    # the narrative prints exactly one card's tail: that card
    hit = _hits([_debit("d", "NATWEST 5566")], CURRENT, CARD1, CARD2)
    assert hit == {"d": {"issuer": "natwest", "card_account_id": "ncc2"}}
    # two tails printed: ambiguous again
    assert _hits([_debit("d", "NATWEST 5566 7788")], CURRENT, CARD1, CARD2) == {}


def test_a_direct_debit_naming_the_issuer_gives_debt(monkeypatch):
    rows = [_debit("d", "NATWEST", 75.53, bank_code="DD")]
    docs = _arun(_reconcile(monkeypatch, rows, [CURRENT, BARC, CARD1]))
    assert docs["d"]["category"] == "Debt" and docs["d"]["card_repayment_rule"]["card_account_id"] == "ncc1"
    # a direct debit that is not the issuer is nothing to do with this rule
    other = [_debit("e", "SOME UTILITY", bank_code="DD")]
    assert _hits(other, CURRENT, CARD1) == {}


# ── user answers win ────────────────────────────────────────────────────────

def test_user_answers_override(monkeypatch):
    rows = [_debit("d", "NATWEST", custom_category="Groceries", category="Groceries"),
            _debit("e", "NATWEST", 75.54, custom_category="Debt", category="Debt")]
    docs = _arun(_reconcile(monkeypatch, rows, [CURRENT, BARC, CARD1]))
    assert docs["d"]["category"] == "Groceries" and "card_repayment_rule" not in docs["d"]
    assert "card_repayment_rule" not in docs["e"], "the user's own Debt is theirs, never restamped"


# ── the teaching sheet option ───────────────────────────────────────────────

def test_the_teaching_sheet_option_sets_debt_and_remembers_the_payee(monkeypatch):
    from test_g376_movement_destinations import _Events, _Rows, _wire, transactions
    from test_transfer_pairs import _run_apply_rules_bulk, _t

    source = _t("source", ttype="debit", amount=75.53, date=D0, account_id="a1",
                merchant="NATW", desc="NATW CC PYMT", category="Other")
    row = {**source, "user_id": "kevin@example.com"}
    rows = _Rows([row])
    _wire(monkeypatch, rows, _Events())
    result = asyncio.run(transactions.resolve_movement("source", {"resolution": "mine-card"}, {"email": "kevin@example.com"}))
    assert result["custom_category"] == "Debt"
    saved = rows.docs[0]
    assert saved["custom_category"] == "Debt" and saved["card_repayment_taught"] is True

    # the next row from that payee is Debt through the real structural pass (key level memory)
    taught = {**source, "custom_category": "Debt", "card_repayment_taught": True}
    later = _t("later", ttype="debit", amount=80.0, date=D0 + timedelta(days=30), account_id="a1",
               merchant="NATW", desc="NATW CC PYMT", category="Other")
    _run_apply_rules_bulk(monkeypatch, [taught, later])
    assert later["category"] == "Debt"
    # and Spend reads both as card repayments even though no card is connected
    docs = [taught, later]
    ids = find_card_repayment_ids(docs, KINDS, [])
    assert ids == {"source", "later"}
    ctx = SpendingContext.from_docs(docs, KINDS, None, [])
    assert not txn_flow(later, ctx).counts_as_spend
    # a loan from another payee that is Debt with no evidence still counts
    loan = {**later, "_id": "loan", "merchant_name": "ACME FINANCE", "description": "ACME FINANCE"}
    assert "loan" not in find_card_repayment_ids(docs + [loan], KINDS, [])
    # if the user later files the taught row elsewhere, the memory stops
    elsewhere = {**taught, "custom_category": "Groceries"}
    assert "later" not in find_card_repayment_ids([elsewhere, later], KINDS, [])


def test_the_option_is_a_debit_only_movement_answer(monkeypatch):
    from fastapi import HTTPException
    from test_g376_movement_destinations import _Events, _Rows, _wire, transactions
    rows = _Rows([{"_id": "c", "user_id": "kevin@example.com", "transaction_type": "credit"}])
    _wire(monkeypatch, rows, _Events())
    with pytest.raises(HTTPException, match="outgoing payments"):
        asyncio.run(transactions.resolve_movement("c", {"resolution": "mine-card"}, {"email": "kevin@example.com"}))


# ── the re-match fixes old rows ─────────────────────────────────────────────

def test_the_rematch_fixes_old_rows_and_unwinds_when_they_stop_qualifying(monkeypatch):
    old = (datetime.utcnow() - timedelta(days=300)).replace(hour=0, minute=0, second=0, microsecond=0)  # naive-ok: test clock
    rows = [_row("old", "debit", 75.53, "natw", old, "NATWEST"),
            _row("older-answered", "debit", 75.53, "natw", old - timedelta(days=5), "NATWEST", custom_category="Groceries", category="Groceries")]

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=[CURRENT, BARC, CARD1]) as cols:
            await oat.reconcile_own_account_transfers(UID)
            first = {r["_id"]: r async for r in cols["transactions"].find({})}
            assert first["old"]["category"] == "Debt" and first["old"]["card_repayment_rule"]["previous_category"] == "Other"
            assert first["older-answered"]["category"] == "Groceries"
            # idempotent
            assert await oat.reconcile_own_account_transfers(UID) == 0
            # the user adds a NatWest loan: a bare issuer name is now asked, the old filing unwinds
            await cols["accounts"].insert_one(dict(LOAN))
            await oat.reconcile_own_account_transfers(UID)
            later = await cols["transactions"].find_one({"_id": "old"})
            assert later["category"] == "Other" and "card_repayment_rule" not in later
    _arun(run())


def test_the_structural_pass_applies_the_rule_over_history_days(monkeypatch):
    from test_transfer_pairs import _run_apply_rules_bulk, _t
    old = D0 - timedelta(days=200)  # older than the 90 days the pass used to see
    row = _t("r1", ttype="debit", amount=75.53, date=old, account_id="natw", merchant="NATWEST", desc="NATWEST", category="Other")
    accounts = [{**CURRENT}, {**CARD1}, {**BARC}]
    _run_apply_rules_bulk(monkeypatch, [row], accounts=accounts)
    assert row["category"] == "Debt" and row["card_repayment_rule"]["card_account_id"] == "ncc1"
