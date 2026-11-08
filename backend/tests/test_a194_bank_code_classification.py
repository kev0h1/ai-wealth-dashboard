"""A194 phase 2: the bank code leads classification. DD is never an own
transfer (a card repayment only when its issuer matches a card on file); the
transfer rails are candidates only, with the G438/G440 name, pair and timing
rules still deciding; an absent code keeps today's behaviour. Invented data."""
from datetime import datetime

from test_g440_transfer_timing import ACCOUNTS, IDENTITY, KINDS, _pair, _classify
from test_g403_card_repayment_link import BANK, NOW, acct, link, row
from app.services.spending import find_own_move_ids, find_pending_transfer_ids
import app.routers.analytics as analytics


def _coded(pair, code):
    credit, debit = pair
    return {**credit, "bank_code": code if code != "DD" else "CR"}, {**debit, "bank_code": code}


def test_dd_with_a_name_and_a_pair_is_never_automatic_own():
    credit, debit = _coded(_pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3)), "DD")
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == set()  # stays in Spend, never asked as own
    assert analytics._has_pair_evidence(credit, debit, IDENTITY) is False


def test_dd_from_an_issuer_matching_a_card_is_a_card_repayment():
    card = acct("nw", "natwest", "card", "9999")
    debit = {**row("d", "debit", "bank", 45.1, "NATWEST CARD"), "bank_code": "DD"}
    credit = row("c", "credit", "nw", 45.1, "CREDIT")  # no payment-received wording
    assert link([debit, credit], [BANK, card]) == [(credit, debit)]
    # without the bank code the same rows do not link (G403 route 3 is not loosened)
    plain = {k: v for k, v in debit.items() if k != "bank_code"}
    assert link([plain, credit], [BANK, card]) == []
    # a DD that names no issuer on file is not linked either
    other = {**debit, "description": "SOME UTILITY"}
    assert link([other, credit], [BANK, card]) == []


def test_fp_pair_with_a_name_within_24_hours_is_automatic():
    credit, debit = _coded(_pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3, 22, 10), datetime(2026, 11, 4, 20, 0)), "FP")
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)] and own == {"d1"} and pending == set()
    from app.services.own_account_transfers import is_transfer_rail_candidate
    assert is_transfer_rail_candidate(debit)


def test_rail_code_alone_is_never_evidence():
    credit, debit = _coded(_pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3), datetime(2026, 11, 3),
                                 debit_text="SHOP 1", credit_text="CREDIT"), "FP")
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set()


def test_absent_code_keeps_the_same_behaviour():
    pair = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3))
    def shape(result):
        return [[x["_id"] for x in p] for p in result[0]], result[1], result[2]

    plain = shape(_classify(*pair))
    coded_none = shape(_classify(*({**r, "bank_code": None} for r in pair)))
    assert plain == coded_none
    from app.services.own_account_transfers import is_transfer_rail_candidate
    assert plain[1] == {"d1"} and not is_transfer_rail_candidate(pair[1])


def test_cr_with_the_users_name_still_asks_three_days_apart():
    credit, debit = _coded(_pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 30), datetime(2026, 11, 6, 8, 0)), "FP")
    credit = {**credit, "bank_code": "CR"}
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == {"d1"}
