"""G413: a card-repayment-shaped debit keys its recurring series per PAN tail
when no G403 stamp is present, so two cards of one issuer are two series even
when the provider reports the same merchant name for both. Invented
references only (hyphenated 15 digit PANs with distinct 5 digit tails)."""
from app.services.own_account_transfers import (
    pan_repayment_series_key, repayment_display_name, series_key,
)

REF_A = "AMERICAN EXPRESS 3799-111111-20001"
REF_B = "AMERICAN EXPRESS 3799-111111-20002"
CARD_ID = "64f1a2b3c4d5e6f708192a3b"


def _debit(description, merchant="American Express", **extra):
    row = {"description": description, "merchant_name": merchant, "transaction_type": "debit", "amount": 100.0}
    row.update(extra)
    return row


def test_two_references_make_two_series_even_with_one_merchant_name():
    assert series_key(_debit(REF_A)) == "American Express 20001"
    assert series_key(_debit(REF_B)) == "American Express 20002"
    assert series_key(_debit(REF_A)) != series_key(_debit(REF_B))


def test_one_reference_is_one_series_across_cycles_and_dates():
    first = _debit(REF_A + " 09OCT")
    second = _debit(REF_A + " 09NOV")
    assert series_key(first) == series_key(second) == "American Express 20001"


def test_spaced_pan_and_amex_wording_key_the_same_way():
    row = _debit("AMEX 3799 111111 20001", merchant="")
    assert series_key(row) == "American Express 20001"


def test_a_linked_stamp_still_wins_and_keeps_its_stable_key():
    row = _debit(REF_A, own_transfer_match={"card_repayment": {"issuer": "american_express", "card_account_id": CARD_ID}})
    assert series_key(row) == f"American Express {CARD_ID}"


def test_ordinary_narratives_keep_their_historical_key():
    assert series_key(_debit("AMERICAN EXPRESS", merchant="")) == "AMERICAN EXPRESS"
    assert series_key({"description": "COUNCIL TAX 123456789012", "merchant_name": ""}) == "COUNCIL TAX 123456789012"
    assert pan_repayment_series_key({"description": "TESCO 123456789012", "merchant_name": ""}) is None


def test_a_tail_key_is_never_shown_as_a_per_card_account_key():
    assert repayment_display_name("American Express 20001") is None
