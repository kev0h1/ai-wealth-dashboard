"""Coverage for the balance-aware credit-card repayment projection
(app/routers/analytics.py):

  Step 1 — `_learn_card_repayment_destinations`: links a recurring Debt/
  card-repayment debit series to the credit-card account its payments land
  on. The mirror image of `_learn_transfer_destinations` (which deliberately
  EXCLUDES credit-card destinations); this function requires one instead.

  Step 2 — `_card_repayment_projection`'s cap: caps a projected repayment at
  the linked card's own outstanding debt, and suppresses the projection
  entirely once the card is in credit.

  Step 3 — `_card_repayment_projection`'s classifier: distinguishes a
  fixed/minimum payer (trailing mean stays correct) from a confident
  full-statement-ish payer (projected amount becomes spend since the last
  observed payment instead), with a non-negotiable balance-transfer
  carve-out (a BT-shaped debit anywhere examined forces "ambiguous",
  regardless of what the ratios alone would say) — the live bug this exists
  to prevent: NatWest MC#2 took a ~£994 balance transfer while its DD stayed
  ~£62; a naive spend-since-last-payment estimate would have read that BT as
  spend and blown the projection up to roughly its size.

Also covers the internal_inflows non-interference guarantee: linking a
card-repayment series must never start mirroring the payment as an inbound
credit onto the card account (a card is not a spendable destination).

Everything here is pure/in-memory — `_learn_card_repayment_destinations`,
`_learn_transfer_destinations` and `_card_repayment_projection` take plain
dicts/lists and touch no database at all, and `_build_cashflow_response`
(called with `uid=None`) skips every DB read it would otherwise make (see
its own docstring/guards) — so this suite never touches real Mongo.
"""
import asyncio
from datetime import date, datetime, timedelta

from app.routers.analytics import (
    _learn_transfer_destinations,
    _learn_card_repayment_destinations,
    _card_repayment_projection,
    _build_cashflow_response,
    CARD_CLASSIFY_MIN_CYCLES,
    CARD_FIXED_PAYER_RATIO_CEILING,
    CARD_FULL_PAYER_RATIO_FLOOR,
)
from app.services.categories import BUILTIN_CATEGORY_KINDS

KIND_MAP = dict(BUILTIN_CATEGORY_KINDS)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def txn(description, on_date, amount, txn_type, account_id, category=None,
        custom_category=None, merchant_name=None, txn_id=None):
    return {
        "_id":              txn_id,
        "merchant_name":    merchant_name,
        "description":      description,
        "amount":           amount,
        "date":             datetime(on_date.year, on_date.month, on_date.day),
        "transaction_type": txn_type,
        "category":         category,
        "custom_category":  custom_category,
        "account_id":       account_id,
    }


def account(name, balance, is_credit_card=False, is_spendable=True, provider="Bank"):
    return {
        "name": name, "balance": balance, "provider": provider,
        "is_credit_card": is_credit_card, "is_spendable": is_spendable,
    }


# ---------------------------------------------------------------------------
# Step 1 — destination linking
# ---------------------------------------------------------------------------

def test_card_repayment_links_to_the_card_it_pays_off():
    payer, card = "payer1", "card1"
    account_map = {
        payer: account("Premier Current Account", 500.0),
        card:  account("HSBC Credit Card", -6352.68, is_credit_card=True),
    }
    raw = []
    for d, amt in [(date(2026, 5, 26), 13.0), (date(2026, 6, 22), 101.4), (date(2026, 7, 23), 98.87)]:
        raw.append(txn("HSBC CREDIT CARD", d, amt, "debit", payer, custom_category="Debt", merchant_name="HSBC CREDIT CARD"))
        raw.append(txn("DIRECT DEBIT PAYMENT - THANK YOU", d, amt, "credit", card, custom_category="Transfer"))

    result = _learn_card_repayment_destinations(raw, account_map, KIND_MAP)
    assert "HSBC CREDIT CARD" in result
    linked = result["HSBC CREDIT CARD"]
    assert linked["dest_account_id"] == card
    assert linked["dest_account_balance"] == -6352.68

    # The general (non-card) transfer channel must never learn this same
    # destination -- it structurally excludes credit-card credits.
    general = _learn_transfer_destinations(raw, account_map, KIND_MAP)
    assert "HSBC CREDIT CARD" not in general


def test_ambiguous_credit_fails_closed_no_link_for_either_series():
    # Two unrelated card-repayment series both plausibly claim the SAME
    # same-day, same-amount credit on the same card (a coincidence), with
    # generic descriptions that give neither series a legible name-affinity
    # claim to the card. The matcher must fail closed: neither is linked.
    payer_a, payer_b, card = "payerA", "payerB", "card1"
    account_map = {
        payer_a: account("Current A", 500.0),
        payer_b: account("Current B", 500.0),
        card:    account("Some Credit Card", -1000.0, is_credit_card=True),
    }
    raw = []
    for d in [date(2026, 3, 1), date(2026, 4, 1), date(2026, 5, 1)]:
        raw.append(txn("PAYMENT SERIES A", d, 50.0, "debit", payer_a, custom_category="Debt", merchant_name="PAYMENT SERIES A"))
        raw.append(txn("PAYMENT SERIES B", d, 50.0, "debit", payer_b, custom_category="Debt", merchant_name="PAYMENT SERIES B"))
        # Only ONE credit lands each date -- both series compete for it.
        raw.append(txn("DIRECT DEBIT PAYMENT", d, 50.0, "credit", card, custom_category="Transfer"))

    result = _learn_card_repayment_destinations(raw, account_map, KIND_MAP)
    assert "PAYMENT SERIES A" not in result
    assert "PAYMENT SERIES B" not in result


def test_current_account_destination_never_linked_credit_via_mobile_case():
    # The real "KEVIN MAINGI CREDIT VIA MOBILE - PY" shape: a debit series
    # whose matching credit lands on the user's own CURRENT account, not a
    # card. `_learn_card_repayment_destinations` must never link it (its
    # candidate-credit pool structurally excludes non-card accounts), even
    # though the general transfer channel is free to.
    payer, other_current = "payer1", "current2"
    account_map = {
        payer:          account("The Number One", 500.0),
        other_current:  account("Premier Current Account", 800.0, is_credit_card=False),
    }
    raw = []
    for d, amt in [(date(2026, 3, 2), 498.0), (date(2026, 4, 9), 442.0), (date(2026, 4, 24), 438.0)]:
        raw.append(txn("KEVIN MAINGI CREDIT VIA MOBILE - PYMT", d, amt, "debit", payer, custom_category="Debt", merchant_name="KEVIN MAINGI CREDIT VIA MOBILE - PYMT"))
        raw.append(txn("MAINGI KM CREDIT BGC", d, amt, "credit", other_current, custom_category="Transfer"))

    card_result = _learn_card_repayment_destinations(raw, account_map, KIND_MAP)
    assert card_result == {}

    general_result = _learn_transfer_destinations(raw, account_map, KIND_MAP)
    assert general_result["KEVIN MAINGI CREDIT VIA MOBILE - PYMT"]["dest_account_id"] == other_current


# ---------------------------------------------------------------------------
# Step 2 — the cap
# ---------------------------------------------------------------------------

def test_cap_reduces_an_over_mean_projection_and_flags_basis():
    key, card = "Big Card DDR", "card1"
    account_map = {card: account("Card", -100.0, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -100.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 300.0,
        "occurrences_detail": [
            {"date": "2026-06-01", "amount": 300.0},
            {"date": "2026-07-01", "amount": 300.0},
        ],
    }]
    result = _card_repayment_projection(recurring_spend, [], account_map, card_dest_by_key, date(2026, 8, 1))
    info = result[key]
    assert info["final_amount"] == 100.0
    assert info["amount_basis"] == "balance_estimate"
    assert info["suppressed"] is False


def test_positive_balance_suppresses_rather_than_zero_bill():
    key, card = "Cleared Card DDR", "card2"
    account_map = {card: account("Card", 15.0, is_credit_card=True)}  # in credit
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": 15.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 50.0,
        "occurrences_detail": [
            {"date": "2026-06-01", "amount": 50.0},
            {"date": "2026-07-01", "amount": 50.0},
        ],
    }]
    result = _card_repayment_projection(recurring_spend, [], account_map, card_dest_by_key, date(2026, 8, 1))
    info = result[key]
    assert info["suppressed"] is True
    assert info["final_amount"] == 0.0


def test_cap_is_a_no_op_when_mean_already_under_outstanding():
    key, card = "Small Card DDR", "card3"
    account_map = {card: account("Card", -5000.0, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -5000.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 60.0,
        "occurrences_detail": [
            {"date": "2026-06-01", "amount": 60.0},
            {"date": "2026-07-01", "amount": 60.0},
        ],
    }]
    result = _card_repayment_projection(recurring_spend, [], account_map, card_dest_by_key, date(2026, 8, 1))
    info = result[key]
    assert info["final_amount"] == 60.0
    assert info["amount_basis"] is None
    assert info["suppressed"] is False


# ---------------------------------------------------------------------------
# Step 3 — classifier
# ---------------------------------------------------------------------------

def test_classifier_flat_minimum_payer_keeps_trailing_mean():
    key, card, payer = "Min Payer DDR", "card4", "payer4"
    account_map = {card: account("Card", -5000.0, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -5000.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 60.0,
        "occurrences_detail": [
            {"date": "2026-03-01", "amount": 60.0},
            {"date": "2026-04-01", "amount": 60.0},
            {"date": "2026-05-01", "amount": 60.0},
            {"date": "2026-06-01", "amount": 60.0},
        ],
    }]
    # Spend consistently dwarfs the flat payment (ratio well under
    # CARD_FIXED_PAYER_RATIO_CEILING) across every cycle, including the
    # fallback trailing window for the earliest occurrence.
    raw = [
        txn("SHOP", date(2026, 2, 15), 420.0, "debit", card),   # fallback window for 3/1
        txn("SHOP", date(2026, 3, 15), 410.0, "debit", card),   # window (3/1, 4/1]
        txn("SHOP", date(2026, 4, 15), 430.0, "debit", card),   # window (4/1, 5/1]
        txn("SHOP", date(2026, 5, 15), 405.0, "debit", card),   # window (5/1, 6/1]
    ]
    result = _card_repayment_projection(recurring_spend, raw, account_map, card_dest_by_key, date(2026, 6, 20))
    info = result[key]
    assert len(info["ratios"]) >= CARD_CLASSIFY_MIN_CYCLES
    assert all(r <= CARD_FIXED_PAYER_RATIO_CEILING for r in info["ratios"])
    assert info["verdict"] == "fixed"
    assert info["final_amount"] == 60.0
    assert info["amount_basis"] is None


def test_classifier_clean_full_payer_switches_to_balance_estimate():
    key, card = "Full Payer DDR", "card5"
    account_map = {card: account("Card", -10000.0, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -10000.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 700.0,
        "occurrences_detail": [
            {"date": "2026-05-01", "amount": 560.0},
            {"date": "2026-06-01", "amount": 700.0},
            {"date": "2026-07-01", "amount": 840.0},
        ],
    }]
    raw = [
        txn("SHOP", date(2026, 4, 20), 800.0, "debit", card),    # fallback window for 5/1 -> ratio 560/800=0.7
        txn("SHOP", date(2026, 5, 20), 1000.0, "debit", card),   # window (5/1, 6/1] -> 700/1000=0.7
        txn("SHOP", date(2026, 6, 20), 1200.0, "debit", card),   # window (6/1, 7/1] -> 840/1200=0.7
        # Spend AFTER the last observed payment -- this is what the
        # full-payer estimate should pick up for the projection.
        txn("SHOP", date(2026, 7, 10), 450.0, "debit", card),
    ]
    result = _card_repayment_projection(recurring_spend, raw, account_map, card_dest_by_key, date(2026, 7, 20))
    info = result[key]
    assert info["verdict"] == "full_payer"
    assert all(CARD_FULL_PAYER_RATIO_FLOOR <= r <= 1.5 for r in info["ratios"])
    assert info["final_amount"] == 450.0
    assert info["amount_basis"] == "balance_estimate"


def test_classifier_mixed_ratios_stay_ambiguous():
    key, card = "Mixed Card DDR", "card6"
    account_map = {card: account("Card", -5000.0, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -5000.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 500.0,
        "occurrences_detail": [
            {"date": "2026-05-01", "amount": 100.0},
            {"date": "2026-06-01", "amount": 600.0},
            {"date": "2026-07-01", "amount": 800.0},
        ],
    }]
    raw = [
        txn("SHOP", date(2026, 4, 15), 1000.0, "debit", card),  # fallback -> 100/1000=0.1
        txn("SHOP", date(2026, 5, 15), 1000.0, "debit", card),  # -> 600/1000=0.6
        txn("SHOP", date(2026, 6, 15), 500.0, "debit", card),   # -> 800/500=1.6 (above the full-payer ceiling)
    ]
    result = _card_repayment_projection(recurring_spend, raw, account_map, card_dest_by_key, date(2026, 7, 20))
    info = result[key]
    assert info["verdict"] == "ambiguous"
    # Trailing mean untouched (cap doesn't bind at this balance either).
    assert info["final_amount"] == 500.0
    assert info["amount_basis"] is None


def test_classifier_insufficient_history_stays_ambiguous():
    # Only 2 occurrences in view -- below CARD_CLASSIFY_MIN_CYCLES even if
    # both ratios individually look "full-payer-ish".
    key, card = "Short History DDR", "card7"
    account_map = {card: account("Card", -5000.0, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -5000.0}}
    recurring_spend = [{
        "key": key, "avg_amount": 700.0,
        "occurrences_detail": [
            {"date": "2026-06-01", "amount": 700.0},
            {"date": "2026-07-01", "amount": 700.0},
        ],
    }]
    raw = [
        txn("SHOP", date(2026, 5, 15), 1000.0, "debit", card),
        txn("SHOP", date(2026, 6, 15), 1000.0, "debit", card),
    ]
    result = _card_repayment_projection(recurring_spend, raw, account_map, card_dest_by_key, date(2026, 7, 20))
    assert result[key]["verdict"] == "ambiguous"


def test_bt_carveout_forces_non_full_payer_natwest_mc2_shape():
    """The live bug: a card whose HISTORICAL cycles alone would clear the
    full-payer bar (ratio ~0.7, three clean cycles), but which took a large
    balance-transfer-shaped debit in the PROJECTION window (since the last
    observed payment). Without the carve-out this would classify
    full_payer and compute spend_since_last off the BT amount, ballooning
    the projection. With it, the card must fall back to ambiguous and the
    trailing mean, exactly NatWest MC#2's real 2026-08-07 ~£994 BT against
    its ~£62 DD.
    """
    key, card = "BT Card DDR", "card8"
    account_map = {card: account("Card", -7138.98, is_credit_card=True)}
    card_dest_by_key = {key: {"dest_account_id": card, "dest_account_balance": -7138.98}}
    recurring_spend = [{
        "key": key, "avg_amount": 700.0,
        "occurrences_detail": [
            {"date": "2026-05-01", "amount": 700.0},
            {"date": "2026-06-01", "amount": 700.0},
            {"date": "2026-07-01", "amount": 700.0},
        ],
    }]
    raw = [
        # Clean historical cycles -- ratio 0.7 each, would-be full-payer.
        txn("SHOP", date(2026, 4, 15), 1000.0, "debit", card),
        txn("SHOP", date(2026, 5, 15), 1000.0, "debit", card),
        txn("SHOP", date(2026, 6, 15), 1000.0, "debit", card),
        # The balance transfer -- lands AFTER the last observed payment,
        # inside the projection window only.
        txn("BALANCE TRANSFER BT000254 1432", date(2026, 8, 7), 854.97, "debit", card, custom_category="Transfer"),
        txn("BALANCE TRANSFER FEE 1432", date(2026, 8, 7), 4.04, "debit", card, category="Bills"),
        txn("BALANCE TRANSFER BT000254 1432", date(2026, 8, 7), 139.07, "debit", card, custom_category="Transfer"),
        txn("BALANCE TRANSFER FEE 1432", date(2026, 8, 7), 24.8, "debit", card, category="Bills"),
    ]
    result = _card_repayment_projection(recurring_spend, raw, account_map, card_dest_by_key, date(2026, 8, 28))
    info = result[key]
    assert info["verdict"] != "full_payer"
    # Must stay near the trailing mean, nowhere close to the ~£994 BT.
    assert info["final_amount"] == 700.0
    assert info["final_amount"] < 994.0


# ---------------------------------------------------------------------------
# internal_inflows non-interference
# ---------------------------------------------------------------------------

def test_internal_inflows_unaffected_by_card_repayment_link():
    """A card-repayment series carrying a `card_dest_account_id` (but no
    `dest_account_id` -- exactly what `_serialise_pattern` produces) must
    never produce an `internal_inflows` entry. `_build_cashflow_response`
    with uid=None makes no database calls at all (see its own uid-gated
    reads), so this is a pure in-memory check.
    """
    future = (date.today() + timedelta(days=10)).isoformat()
    cached = {
        "recurring_spend": [{
            "key":             "HSBC CREDIT CARD",
            "avg_amount":      121.05,
            "avg_interval":    30,
            "next_date":       future,
            "account_id":      "payer1",
            "account_name":    "Premier Current Account",
            "account_bank":    "Barclays",
            "account_balance": 500.0,
            "is_credit_card":  False,
            "category":        "Debt",
            "monthly_anchor":  None,
            "dest_account_id":        None,
            "dest_account_name":      None,
            "dest_account_bank":      None,
            "dest_account_spendable": None,
            "card_dest_account_id":   "card_hsbc",
            "card_dest_account_name": "HSBC Credit Card",
            "card_dest_account_bank": "HSBC",
            "amount_basis": None,
            "suppressed":   False,
        }],
        "recurring_income":  [],
        "avg_daily_spend":   0,
        "available_balance": 0,
        "spendable_balance": 0,
        "savings_balance":   0,
    }
    resp = asyncio.run(_build_cashflow_response(cached, uid=None))
    assert resp["internal_inflows"] == []
    assert any(b["name"] == "HSBC CREDIT CARD" for b in resp["upcoming_bills"])


def test_suppressed_series_never_emits_a_bill():
    future = (date.today() + timedelta(days=10)).isoformat()
    cached = {
        "recurring_spend": [{
            "key":             "Cleared Card DDR",
            "avg_amount":      0.0,
            "avg_interval":    30,
            "next_date":       future,
            "account_id":      "payer1",
            "account_name":    "Premier Current Account",
            "account_bank":    "Barclays",
            "account_balance": 500.0,
            "is_credit_card":  False,
            "category":        "Debt",
            "monthly_anchor":  None,
            "dest_account_id":        None,
            "dest_account_name":      None,
            "dest_account_bank":      None,
            "dest_account_spendable": None,
            "card_dest_account_id":   "card_x",
            "card_dest_account_name": "Some Card",
            "card_dest_account_bank": "Some Bank",
            "amount_basis": "balance_estimate",
            "suppressed":   True,
        }],
        "recurring_income":  [],
        "avg_daily_spend":   0,
        "available_balance": 0,
        "spendable_balance": 0,
        "savings_balance":   0,
    }
    resp = asyncio.run(_build_cashflow_response(cached, uid=None))
    assert resp["upcoming_bills"] == []
    assert resp["internal_inflows"] == []
