"""G456 (Kevin 2026-11-11): an own-account pair's two legs are categorised from
the two ACCOUNT TYPES, by one function, on every filing path.

  current or emoney -> savings        Savings,  Transfer
  savings -> current                  Transfer, Transfer
  current -> credit or charge card    Debt,     Transfer   (G381)
  card -> current                     Transfer, Transfer
  current -> current                  Transfer, Transfer
  savings -> savings                  Transfer, Transfer
  unknown or other types              Transfer, Transfer

Invented names and numbers only. Collections are the in-memory fakes the G377
tests use; the confirm endpoint runs through the G-series fake plumbing.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

from app.services.account_kinds import own_transfer_account_class, own_transfer_leg_categories
from app.services.categories import BUILTIN_CATEGORY_KINDS, MOVEMENT
import app.services.own_account_transfers as oat
from app.services.own_account_transfers import build_match_metadata, reconcile_own_account_transfers

from test_g377_own_account_transfers import _Collection, _service_collections, TOKENS
from test_transfer_pairs import _run_confirm, _t, D0

CURRENT = {"_id": "cur", "sort_code": "11-22-33", "account_number": "12345678", "type": "bank", "subtype": "TRANSACTION"}
CURRENT2 = {"_id": "cur2", "sort_code": "44-55-66", "account_number": "87654321", "type": "bank", "subtype": "TRANSACTION"}
EMONEY = {"_id": "emo", "sort_code": "20-30-40", "account_number": "11112222", "type": "bank", "subtype": "TRANSACTION"}
SAVINGS = {"_id": "sav", "sort_code": "77-88-99", "account_number": "23456789", "type": "bank", "subtype": "SAVINGS"}
SAVINGS2 = {"_id": "sav2", "sort_code": "55-66-77", "account_number": "33334444", "type": "bank", "subtype": "SAVINGS"}
CARD = {"_id": "card", "sort_code": "99-88-77", "account_number": "98765432", "type": "credit_card", "subtype": "CREDIT_CARD"}
MYSTERY = {"_id": "odd", "sort_code": "12-12-12", "account_number": "56565656", "type": "weird"}
ACCTS = {a["_id"]: a for a in (CURRENT, CURRENT2, EMONEY, SAVINGS, SAVINGS2, CARD, MYSTERY)}

# (paying account, receiving account, paying leg, receiving leg)
TABLE = [
    (CURRENT, SAVINGS, "Savings", "Transfer"),
    (EMONEY, SAVINGS, "Savings", "Transfer"),
    (SAVINGS, CURRENT, "Transfer", "Transfer"),
    (CURRENT, CARD, "Debt", "Transfer"),
    (CARD, CURRENT, "Transfer", "Transfer"),
    (CURRENT, CURRENT2, "Transfer", "Transfer"),
    (SAVINGS, SAVINGS2, "Transfer", "Transfer"),
    (CURRENT, MYSTERY, "Transfer", "Transfer"),
    (MYSTERY, SAVINGS, "Transfer", "Transfer"),
    (SAVINGS, CARD, "Transfer", "Transfer"),
]


@pytest.mark.parametrize("paying,receiving,pay_cat,recv_cat", TABLE)
def test_the_function_implements_each_row_of_the_table(paying, receiving, pay_cat, recv_cat):
    assert own_transfer_leg_categories(paying, receiving) == (pay_cat, recv_cat)


def test_unknown_missing_and_charge_card_types():
    assert own_transfer_account_class(None) == "other"
    assert own_transfer_account_class({}) == "other"
    assert own_transfer_account_class(MYSTERY) == "other"
    assert own_transfer_leg_categories(None, SAVINGS) == ("Transfer", "Transfer")
    assert own_transfer_leg_categories(CURRENT, None) == ("Transfer", "Transfer")
    # A181: charge_card is stored as the credit_card type, so it is a card.
    assert own_transfer_leg_categories(CURRENT, {"type": "credit_card", "subtype": "CREDIT_CARD"}) == ("Debt", "Transfer")
    assert own_transfer_leg_categories({"type": "debt", "subtype": "LOAN"}, SAVINGS) == ("Transfer", "Transfer")


def _legs(paying, receiving, *, debit_custom=None, credit_custom=None, credit_cat="Income", debit_cat="Other", days=0):
    now = datetime.utcnow() - timedelta(days=days)  # naive-ok: Mongo booked dates are naive UTC
    credit = {"_id": "c1", "user_id": "kevin", "transaction_type": "credit", "account_id": receiving["_id"], "amount": 250.37,
              "currency": "GBP", "date": now, "description": f"TO {paying['sort_code']} {paying['account_number']}",
              "merchant_name": None, "category": credit_cat, "custom_category": credit_custom}
    debit = {**credit, "_id": "d1", "transaction_type": "debit", "account_id": paying["_id"],
             "description": f"TO {receiving['sort_code']} {receiving['account_number']}",
             "category": debit_cat, "custom_category": debit_custom}
    return credit, debit


def _accounts():
    return [{**a, "user_id": "kevin", "currency": "GBP"} for a in ACCTS.values()]


def _reconcile(rows, **extra):
    collections = _service_collections(rows, _accounts())
    collections.update(extra)
    return asyncio.run(reconcile_own_account_transfers("kevin", **collections)), collections


# The matcher never pairs a debit ON a card with a credit on a current account
# (a card cash advance is not an own-account transfer it can see), so card to
# current is filed by the confirm endpoint, Pass 2.6 and a learned pair, which
# are tested below. Every other row is filed by reconcile.
RECONCILE_ROWS = [t for t in TABLE if t[0] is not MYSTERY and t[1] is not MYSTERY and t[0] is not CARD]


@pytest.mark.parametrize("paying,receiving,pay_cat,recv_cat", RECONCILE_ROWS)
def test_reconcile_files_each_row_of_the_table(paying, receiving, pay_cat, recv_cat):
    credit, debit = _legs(paying, receiving)
    _reconcile([credit, debit])
    assert (debit["category"], credit["category"]) == (pay_cat, recv_cat)
    assert debit["own_transfer_match"]["matched_category"] == pay_cat
    assert credit["own_transfer_match"]["matched_category"] == recv_cat
    assert debit["own_transfer_match"]["previous_category"] == "Other"
    assert credit["own_transfer_match"]["previous_category"] == "Income"


def test_reconcile_unknown_type_files_transfer_on_both_legs():
    credit, debit = _legs(CURRENT, MYSTERY)
    _reconcile([credit, debit])
    assert (debit["category"], credit["category"]) == ("Transfer", "Transfer")


def test_a_user_set_leg_is_never_changed_and_the_other_leg_still_follows_the_table():
    credit, debit = _legs(CURRENT, SAVINGS, debit_custom="House fund")
    collections = _service_collections([credit, debit], _accounts())
    collections["movement_categories"].add("House fund")
    asyncio.run(reconcile_own_account_transfers("kevin", **collections))
    assert debit["custom_category"] == "House fund"
    assert debit["category"] == "Other" and "own_transfer_match" not in debit
    assert credit["category"] == "Transfer"
    # the receiving leg set by the user is equally protected
    credit, debit = _legs(CURRENT, SAVINGS, credit_custom="Savings")
    _reconcile([credit, debit])
    assert credit["custom_category"] == "Savings" and credit["category"] == "Income"
    assert debit["category"] == "Savings"


def test_backfill_corrects_a_pair_filed_by_the_old_rule_and_keeps_previous_category():
    # Old rule: savings -> current filed the RECEIVING current leg as Savings,
    # Reconcile re-stamps every pass, keeping previous_category.
    credit, debit = _legs(SAVINGS, CURRENT)
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Savings")
    debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer")
    credit["category"], debit["category"] = "Savings", "Transfer"
    changed, _ = _reconcile([credit, debit])
    assert changed >= 1
    assert credit["category"] == "Transfer" and debit["category"] == "Transfer"
    assert credit["own_transfer_match"]["matched_category"] == "Transfer"
    assert credit["own_transfer_match"]["previous_category"] == "Income"


def test_backfill_fixes_a_transfer_transfer_current_to_savings_pair():
    credit, debit = _legs(CURRENT, SAVINGS)
    credit["category"] = debit["category"] = "Transfer"
    credit["own_transfer_match"] = build_match_metadata(credit, debit, "Transfer")
    debit["own_transfer_match"] = build_match_metadata(debit, credit, "Transfer")
    first, collections = _reconcile([credit, debit])
    assert (debit["category"], credit["category"]) == ("Savings", "Transfer")
    assert first >= 1
    # idempotent: the next pass changes nothing
    assert asyncio.run(reconcile_own_account_transfers("kevin", **collections)) == 0


def test_unwinding_restores_the_previous_categories():
    credit, debit = _legs(CURRENT, SAVINGS)
    _, collections = _reconcile([credit, debit])
    assert debit["category"] == "Savings"
    # the counterpart disappears: only our own automatic result is unwound
    collections["transaction_collection"].rows.remove(credit)
    asyncio.run(reconcile_own_account_transfers("kevin", **collections))
    assert debit["category"] == "Other" and "own_transfer_match" not in debit


def test_category_kinds_stay_movement_so_spend_totals_do_not_move():
    for name in ("Savings", "Debt", "Transfer"):
        assert BUILTIN_CATEGORY_KINDS[name] == MOVEMENT
    spend_before = None
    for paying, receiving, *_ in RECONCILE_ROWS:
        credit, debit = _legs(paying, receiving)
        rows = [credit, debit]
        spend = lambda: sum(r["amount"] for r in rows if BUILTIN_CATEGORY_KINDS.get(r["category"]) not in (MOVEMENT, "income") and r["transaction_type"] == "debit")
        spend_before = spend()
        assert spend_before > 0  # "Other" is spending until the pair is recognised
        _reconcile(rows)
        assert spend() == 0


# ── the confirm endpoint ────────────────────────────────────────────────────

def _confirm(paying, receiving, **kw):
    credit = _t("c-conf", ttype="credit", amount=45.0, date=D0, account_id=receiving["_id"], desc="CREDIT LEG", category="Income")
    debit = _t("d-conf", ttype="debit", amount=45.0, date=D0, account_id=paying["_id"], desc="DEBIT LEG", category="Other")
    import pytest as _p
    mp = _p.MonkeyPatch()
    try:
        result = _run_confirm(mp, [credit, debit], "c-conf", "d-conf",
                              accounts=[{"user_id": "kevin", **a} for a in (paying, receiving)])
    finally:
        mp.undo()
    return result, credit, debit


@pytest.mark.parametrize("paying,receiving,pay_cat,recv_cat", [t for t in TABLE if t[0] is not MYSTERY and t[1] is not MYSTERY])
def test_confirm_endpoint_follows_the_table(paying, receiving, pay_cat, recv_cat):
    result, credit, debit = _confirm(paying, receiving)
    assert (result["debit_category"], result["credit_category"]) == (pay_cat, recv_cat)
    assert (debit["category"], credit["category"]) == (pay_cat, recv_cat)
    assert debit["own_transfer_match"]["matched_category"] == pay_cat
    assert debit["own_transfer_match"]["confirmed"] is True


# ── series singles (G443) ───────────────────────────────────────────────────

def test_a_series_single_gets_its_own_sides_category_from_the_table():
    for paying, receiving, pay_cat, recv_cat in ((CURRENT, SAVINGS, "Savings", "Transfer"), (SAVINGS, CURRENT, "Transfer", "Transfer")):
        credit, debit = _legs(paying, receiving)
        accounts = {paying["_id"]: paying, receiving["_id"]: receiving}
        cats_debit, cats_credit = own_transfer_leg_categories(accounts[paying["_id"]], accounts[receiving["_id"]])
        ev = oat.series_evidence([(credit, debit, {"credit": cats_credit, "debit": cats_debit})])
        by_side = {e["transaction_type"]: e["category"] for e in ev}
        assert by_side == {"debit": pay_cat, "credit": recv_cat}


# ── the sync-time pass (Pass 2.6) and a learned pair ────────────────────────

@pytest.mark.parametrize("paying,receiving,pay_cat,recv_cat", [
    (CARD, CURRENT, "Transfer", "Transfer"),
    (SAVINGS, CURRENT, "Transfer", "Transfer"),
    (CURRENT, SAVINGS, "Savings", "Transfer"),
    (CURRENT, CARD, "Debt", "Transfer"),
])
def test_a_learned_pair_is_filed_by_the_table_at_sync(monkeypatch, paying, receiving, pay_cat, recv_cat):
    from test_transfer_pairs import _run_apply_rules_bulk, UID
    from app.services.categorisation import canonical_merchant_key
    c_key = canonical_merchant_key("Acme Rail", "ACME RAIL TRANSFER IN")
    d_key = canonical_merchant_key("Beta Payments", "BETA PAYMENTS OUT")
    txns = [
        _t("c1", ttype="credit", amount=100.0, date=D0, account_id=receiving["_id"],
           merchant="Acme Rail", desc="ACME RAIL TRANSFER IN", category="Income"),
        _t("d1", ttype="debit", amount=100.0, date=D0, account_id=paying["_id"],
           merchant="Beta Payments", desc="BETA PAYMENTS OUT", category="Other"),
    ]
    accounts = [{"user_id": UID, "currency": "GBP", **{k: v for k, v in a.items() if k not in ("sort_code", "account_number")}}
                for a in (paying, receiving)]
    _run_apply_rules_bulk(monkeypatch, txns, accounts=accounts,
                          learned=[{"_id": "pair1", "user_id": UID, "key_a": c_key, "key_b": d_key}])
    by_id = {t["_id"]: t for t in txns}
    assert (by_id["d1"]["category"], by_id["c1"]["category"]) == (pay_cat, recv_cat)
