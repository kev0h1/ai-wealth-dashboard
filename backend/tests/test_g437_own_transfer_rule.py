"""G437 (Kevin 2026-11-07): a payment is an own-account transfer only when
(a) its counterparty sort code and account number match an account on file,
(b) the user's own name is in the payee or description, or (c) both legs are
seen and the user identified them as a pair. User rules override both ways.
The account-name shape is no longer evidence. Invented names and numbers."""
from datetime import datetime, timedelta

import app.routers.card_terms  # noqa: F401  (H143: pre-import before any collection patching)
import app.services.debt_plan  # noqa: F401
from app.services.own_account_transfers import own_account_index
from app.services.spending import find_own_move_ids
from app.services.categories import BUILTIN_CATEGORY_KINDS

SAVER = {"_id": "saver-acc", "sort_code": "04-00-04", "account_number": "1234 5678"}
SOURCE = {"_id": "src-acc", "sort_code": "112233", "account_number": "87654321"}
INDEX = own_account_index([SAVER, SOURCE])


def _t(desc, **kw):
    return {"description": desc, "merchant_name": None, **kw}


KINDS = dict(BUILTIN_CATEGORY_KINDS)
NOW = datetime(2026, 11, 1, 12)


def _debit(**kw):
    return {"_id": "d1", "account_id": "src-acc", "amount": 80.0, "date": NOW, "transaction_type": "debit",
            "category": "Shopping", "description": "ACME REF 77", "merchant_name": None, **kw}


def _identity():
    return {"name_tokens": [], "own_ids": set(), "own_map": {}, "own_keys": {("040004", "12345678"): {"saver-acc"}}}


def test_spending_reads_counterparty_account_as_own_move():
    d = _debit(party_sort_code="040004", party_number="12345678")
    assert "d1" in find_own_move_ids([d], KINDS, _identity())


def test_spending_ignores_partial_or_foreign_counterparty():
    for extra in ({"party_sort_code": "040004"}, {"party_sort_code": "040004", "party_number": "11111111"}, {}):
        assert "d1" not in find_own_move_ids([_debit(**extra)], KINDS, _identity())


def test_spending_counterparty_equal_to_own_account_does_not_flag_itself():
    d = _debit(account_id="saver-acc", party_sort_code="040004", party_number="12345678")
    assert "d1" not in find_own_move_ids([d], KINDS, _identity())


# --- the user's own category outranks every automatic evidence ---------------

def _identity_with_digits():
    # G438: text evidence is the sort code AND the number, never a bare number.
    return {"name_tokens": [], "own_ids": {"20202020"},
            "own_map": {"20202020": {"account_id": "saver-acc"}},
            "own_keys": {("202020", "20202020"): {"saver-acc"}}}


def test_counterparty_match_with_user_spend_category_stays_spending():
    d = _debit(party_sort_code="040004", party_number="12345678", custom_category="Groceries")
    assert "d1" not in find_own_move_ids([d], KINDS, _identity())


def test_own_digits_text_match_with_user_spend_category_stays_spending():
    d = _debit(description="PAYMENT 20-20-20 20202020", custom_category="Gifts")
    assert "d1" not in find_own_move_ids([d], KINDS, _identity_with_digits())
    # control: without the user category the same text is an own move
    assert "d1" in find_own_move_ids([_debit(description="PAYMENT 20-20-20 20202020")], KINDS, _identity_with_digits())


def test_user_movement_category_still_counts():
    d = _debit(party_sort_code="040004", party_number="12345678", custom_category="Transfer")
    # Transfer is already a movement: not spending, no evidence needed, and it never flips to spend.
    from app.services.spending import classify_flow
    flow = classify_flow(KINDS, "Transfer", True, "d1" in find_own_move_ids([d], KINDS, _identity()))
    assert not flow.counts_as_spend


def test_user_business_or_other_category_keeps_option_b_own_move():
    for cat in ("Business", "Other"):
        d = _debit(party_sort_code="040004", party_number="12345678", custom_category=cat)
        assert "d1" in find_own_move_ids([d], KINDS, _identity())
        d = _debit(description="PAYMENT 20-20-20 20202020", custom_category=cat)
        assert "d1" in find_own_move_ids([d], KINDS, _identity_with_digits())
