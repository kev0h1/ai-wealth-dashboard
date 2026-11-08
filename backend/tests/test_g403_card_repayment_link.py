"""G403: the card repayment link. All numbers are invented, same SHAPES as prod:
a hyphenated 15 digit PAN, a full 16 digit PAN, a four digit tail, issuer printed forms."""
import asyncio
from datetime import datetime, timedelta

from app.services.categorisation import rule_categorise, series_key as base_series_key
from app.services.own_account_transfers import (
    reconcile_own_account_transfers, repayment_series_key, resolve_transfer_evidence,
    select_unique_pairs, series_key,
)

NOW = datetime(2026, 10, 31, 12)
TOKENS = ["pat", "example"]


def acct(id_, provider, kind="current", number="12345678"):
    return {"_id": id_, "user_id": "u1", "provider": provider, "account_number": number,
            "type": "credit_card" if kind == "card" else kind, "currency": "GBP"}


def row(id_, direction, account, amount, text, days=0, category="Other"):
    return {"_id": id_, "user_id": "u1", "transaction_type": direction, "account_id": account,
            "amount": amount, "currency": "GBP", "date": NOW + timedelta(days=days),
            "description": text, "merchant_name": None, "category": category, "custom_category": None}


def link(rows, accounts):
    return select_unique_pairs(rows, {a["_id"]: a for a in accounts}, TOKENS, set())


BANK = acct("bank", "hsbc")


def test_hyphenated_15_digit_pan_in_bank_narrative_with_issuer_provider():
    card = acct("amex", "amex", "card", "0777")
    debit = row("d", "debit", "bank", 600.25, "AMERICAN EXPRESS 3712-345678-90777 DDR")
    credit = row("c", "credit", "amex", 600.25, "PAYMENT RECEIVED", days=1, category="Transfer")
    assert link([debit, credit], [BANK, card]) == [(credit, debit)]


def test_full_16_digit_pan_in_bank_narrative():
    card = acct("bc", "barclaycard", "card", "4321")
    debit = row("d", "debit", "bank", 31.5, "B/CARD 4929123456784321")
    credit = row("c", "credit", "bc", 31.5, "DIRECT DEBIT PAYMENT", days=2)
    assert link([debit, credit], [BANK, card]) == [(credit, debit)]


def test_four_digit_tail_on_card_side_with_issuer_on_bank_side():
    card = acct("nw", "natwest", "card", "546811******5555")
    debit = row("d", "debit", "bank", 88.0, "NATWEST CARD PAYMENT")
    credit = row("c", "credit", "nw", 88.0, "PAYMENT BY DIRECT DEBIT 5555", days=1)
    assert link([debit, credit], [BANK, card]) == [(credit, debit)]


def test_issuer_printed_form_with_one_card_held_and_payment_wording():
    card = acct("nw", "natwest", "card", "9999")
    debit = row("d", "debit", "bank", 45.1, "NW WORLD MASTERCAR")
    credit = row("c", "credit", "nw", 45.1, "PAYMENT RECEIVED - THANK YOU")
    assert link([debit, credit], [BANK, card]) == [(credit, debit)]


def test_inter_bank_balance_transfer_to_a_current_account_is_never_linked():
    other_current = acct("chase", "chase", "current", "22334455")
    debit = row("d", "debit", "bank", 388.16, "HSBC COMP BAL XFR CHASE")
    credit = row("c", "credit", "chase", 388.16, "BALANCE TRANSFER IN CHASE")
    assert link([debit, credit], [BANK, other_current]) == []


def test_balance_transfer_between_two_cards_is_never_a_repayment():
    a, b = acct("a", "amex", "card", "1111"), acct("b", "chase", "card", "2222")
    debit = row("d", "debit", "a", 300, "AMEX BALANCE TRANSFER CHASE 2222")
    credit = row("c", "credit", "b", 300, "PAYMENT RECEIVED")
    assert link([debit, credit], [a, b]) == []


def test_two_cards_one_issuer_and_no_tail_is_ambiguous():
    c1, c2 = acct("c1", "amex", "card", "1111"), acct("c2", "amex", "card", "2222")
    debit = row("d", "debit", "bank", 70, "AMERICAN EXPRESS")
    credit = row("c", "credit", "c1", 70, "PAYMENT RECEIVED")
    assert link([debit, credit], [BANK, c1, c2]) == []


def test_route_three_fails_when_another_debit_shares_the_amount():
    card = acct("nw", "natwest", "card", "9999")
    d1 = row("d1", "debit", "bank", 45.1, "NW WORLD MASTERCAR")
    d2 = row("d2", "debit", "bank", 45.1, "SOME SHOP", days=1)
    credit = row("c", "credit", "nw", 45.1, "PAYMENT RECEIVED")
    assert link([d1, d2, credit], [BANK, card]) == []


def test_outside_three_days_or_wrong_amount_never_links():
    card = acct("nw", "natwest", "card", "9999")
    debit = row("d", "debit", "bank", 45.1, "NW WORLD MASTERCAR")
    assert link([debit, row("c", "credit", "nw", 45.1, "PAYMENT RECEIVED", days=4)], [BANK, card]) == []
    assert link([debit, row("c", "credit", "nw", 45.2, "PAYMENT RECEIVED")], [BANK, card]) == []


def test_wrong_issuer_never_links():
    card = acct("nw", "natwest", "card", "9999")
    debit = row("d", "debit", "bank", 45.1, "BARCLAYCARD")
    credit = row("c", "credit", "nw", 45.1, "PAYMENT RECEIVED 9999")
    assert link([debit, credit], [BANK, card]) == []


def test_reconcile_stamps_both_legs_debt_on_debit_transfer_on_credit_and_survives_resync():
    card = acct("amex", "amex", "card", "0777")
    now = datetime.utcnow()
    debit = row("d", "debit", "bank", 600.25, "AMERICAN EXPRESS 3712-345678-90777", category="Other")
    credit = row("c", "credit", "amex", 600.25, "PAYMENT RECEIVED", category="Income")
    debit["date"] = credit["date"] = now
    rows = [debit, credit]

    class Cur:
        def __init__(s, r): s.r = r
        async def to_list(s, _): return list(s.r)

    class Col:
        def __init__(s, r): s.rows = r
        def find(s, q, _p=None):
            def ok(r):
                for k, v in q.items():
                    a = r.get(k)
                    if isinstance(v, dict):
                        if "$in" in v and a not in v["$in"]: return False
                        if "$gte" in v and a < v["$gte"]: return False
                        if "$ne" in v and a == v["$ne"]: return False
                        if "$exists" in v and (k in r) != v["$exists"]: return False
                    elif a != v: return False
                return True
            return Cur([r for r in s.rows if ok(r)])
        async def find_one(s, q, _p=None):
            return next((r for r in s.rows if all(r.get(k) == v for k, v in q.items())), None)
        async def update_one(s, q, u):
            for r in s.rows:
                if all(r.get(k) == v for k, v in q.items()):
                    before = dict(r)
                    r.update(u.get("$set") or {})
                    for k in u.get("$unset") or {}: r.pop(k, None)
                    return type("R", (), {"modified_count": int(before != r)})()
            return type("R", (), {"modified_count": 0})()

    async def mark(_u, *, reason): pass
    kw = {"transaction_collection": Col(rows), "account_collection": Col([BANK, card]),
          "pair_collection": Col([]), "profile_collection": Col([{"_id": "u1", "name_tokens": TOKENS}]),
          "preference_collection": Col([]), "mark_stale_fn": mark,
          "movement_categories": {"Savings", "Investment", "Debt", "Transfer"}}
    assert asyncio.run(reconcile_own_account_transfers("u1", **kw)) == 2
    assert debit["category"] == "Debt" and credit["category"] == "Transfer"
    assert debit["own_transfer_match"]["card_repayment"] == {"issuer": "american_express", "card_account_id": "amex"}
    assert credit["own_transfer_match"]["card_repayment"]["card_account_id"] == "amex"
    # A re-pull resets the category; the evidence stamp restores it for the reader.
    debit["category"] = "Other"
    restored = {r["_id"]: r for r in resolve_transfer_evidence([debit, credit], {"Debt", "Transfer"})}
    assert restored["d"]["category"] == "Debt"
    assert asyncio.run(reconcile_own_account_transfers("u1", **kw)) >= 0
    assert debit["category"] == "Debt"


def test_recurring_key_splits_two_cards_of_one_issuer_and_unlinked_rows_keep_the_base_key():
    def stamped(card_id):
        return {"description": "AMERICAN EXPRESS", "merchant_name": "American Express",
                "own_transfer_match": {"card_repayment": {"issuer": "american_express", "card_account_id": card_id}}}
    a, b = stamped("card-a"), stamped("card-b")
    assert series_key(a) != series_key(b)
    assert repayment_series_key(a) == "American Express card-a"
    plain = {"description": "AMERICAN EXPRESS", "merchant_name": "American Express"}
    assert series_key(plain) == base_series_key(plain) == "American Express"
    assert series_key(a) != "American Express"


def test_detect_recurring_gives_two_series_for_two_cards_of_one_issuer():
    from app.routers.analytics import _detect_recurring
    txns = []
    for i in range(3):
        for card_id, amount in (("card-a", 100.0), ("card-b", 400.0)):
            txns.append({"_id": f"{card_id}{i}", "merchant_name": "American Express", "description": "AMERICAN EXPRESS",
                         "amount": amount, "transaction_type": "debit", "category": "Debt", "account_id": "bank",
                         "date": datetime(2026, 8 + i, 10), "currency": "GBP",
                         "own_transfer_match": {"card_repayment": {"issuer": "american_express", "card_account_id": card_id}}})
    keys = {s["key"] for s in _detect_recurring(txns, today=datetime(2026, 11, 1).date())}
    assert keys == {"American Express card-a", "American Express card-b"}


def test_three_days_is_inclusive_and_fifteen_digit_prefix_links():
    card = acct("amex", "amex", "card", "3712")
    debit = row("d", "debit", "bank", 120.5, "AMERICAN EXPRESS 3712-345678-90555")
    for days, expected in ((3, True), (-3, True), (4, False)):
        credit = row("c", "credit", "amex", 120.5, "PAYMENT RECEIVED", days=days)
        got = link([debit, credit], [BANK, card])
        assert bool(got) is expected, days


def test_bare_four_digit_prefix_links_without_payment_wording():
    # Two cards: route 3 is unavailable, so only the prefix rule can link.
    c1, c2 = acct("a1", "amex", "card", "3712"), acct("a2", "amex", "card", "3799")
    debit = row("d", "debit", "bank", 64.0, "AMEX 3712-345678-90555")
    credit = row("c", "credit", "a1", 64.0, "ANYTHING")
    assert link([debit, credit], [BANK, c1, c2]) == [(credit, debit)]


def test_two_amex_cards_sharing_the_first_four_never_link():
    c1, c2 = acct("a1", "amex", "card", "3712"), acct("a2", "amex", "card", "3712")
    debit = row("d", "debit", "bank", 64.0, "AMEX 3712-345678-90555")
    credit = row("c", "credit", "a1", 64.0, "PAYMENT RECEIVED")
    assert link([debit, credit], [BANK, c1, c2]) == []


def test_prefix_of_one_card_and_suffix_of_another_never_link():
    c1, c2 = acct("a1", "amex", "card", "3712"), acct("a2", "amex", "card", "0555")
    debit = row("d", "debit", "bank", 64.0, "AMEX 3712-345678-90555")
    credit = row("c", "credit", "a1", 64.0, "ANYTHING")
    assert link([debit, credit], [BANK, c1, c2]) == []


def test_masked_number_needs_prefix_and_suffix_and_16_digits_stay_suffix_only():
    masked = acct("a1", "amex", "card", "371234******90555")
    other = acct("a2", "amex", "card", "999999******11111")
    debit = row("d", "debit", "bank", 64.0, "AMEX 3712-345678-90555")
    credit = row("c", "credit", "a1", 64.0, "ANYTHING")
    assert link([debit, credit], [BANK, masked, other]) == [(credit, debit)]
    bc = acct("b1", "barclaycard", "card", "4321")
    b2 = acct("b2", "barclaycard", "card", "9999")
    # A 16 digit fragment STARTING with the stored four is not a match.
    d2 = row("d2", "debit", "bank", 20.0, "B/CARD 4321123456789012")
    c2 = row("c2", "credit", "b1", 20.0, "ANYTHING")
    assert link([d2, c2], [BANK, bc, b2]) == []


def test_unheld_card_repayment_rules_and_bare_issuer_purchase():
    assert rule_categorise("", "AMERICAN EXPRESS 3712-345678-90777") == "Debt"
    assert rule_categorise("", "B/CARD 4929123456784321") == "Debt"
    assert rule_categorise("", "B/CARD DIRECT DEBIT") == "Debt"
    assert rule_categorise("", "AMEX EXPERIENCES") is None
    assert rule_categorise("", "AMEX 2026 11 02 SHOP") is None


def test_display_name_never_carries_the_account_id():
    from app.services.own_account_transfers import repayment_display_name
    key = "American Express 64f1a2b3c4d5e6f708192a3b"
    assert repayment_display_name(key, "American Express Gold") == "American Express Gold"
    assert repayment_display_name(key, "Gold") == "American Express Gold"
    assert repayment_display_name(key) == "American Express"
    assert "64f1" not in repayment_display_name(key, "Gold")
    assert repayment_display_name("American Express") is None
    assert repayment_display_name("American Express Experiences Ltd") is None


def test_savings_rule_has_word_boundary_and_amex_no_longer_hardcoded_transfer():
    assert rule_categorise("", "B/CARD PLAT VISA") is None
    assert rule_categorise("", "VISA PREMISES") is None
    assert rule_categorise("", "STOCKISA SHOP") is None
    # G438: savings wording alone no longer makes a row own money (Kevin 2026-11-07)
    assert rule_categorise("", "CASH ISA TOP UP") is None
    assert rule_categorise("", "AMERICAN EXPRESS PAYMENT") is None
    assert rule_categorise("", "AMEX DDR") == "Transfer"


def test_returned_direct_debit_credit_is_transfer_never_income():
    # Invented 15 digit hyphenated PAN. A credit naming an issuer and a PAN
    # fragment, or an issuer with unpaid or returned wording, is the card's own
    # money moving: Transfer, so it never reaches the Income default.
    from app.services.categorisation import rule_categorise_directed
    assert rule_categorise_directed("", "AMERICAN EXPRESS 3712-345678-90777 UNP", is_credit=True) == "Transfer"
    assert rule_categorise_directed("", "AMERICAN EXPRESS 3712-345678-90777", is_credit=True) == "Transfer"
    assert rule_categorise_directed("", "B/CARD 4929123456784321", is_credit=True) == "Transfer"
    assert rule_categorise_directed("", "AMEX 3712-345678-90777 UNP DDR", is_credit=True) == "Transfer"
    assert rule_categorise_directed("", "B/CARD DD RETURNED", is_credit=True) == "Transfer"
    assert rule_categorise_directed("", "NW WORLD MASTERCAR DIRECT DEBIT REVERSED", is_credit=True) == "Transfer"
    assert rule_categorise_directed("", "AMERICAN EXPRESS UNPAID DIRECT DEBIT", is_credit=True) == "Transfer"


def test_merchant_and_fee_refund_credits_fall_through():
    from app.services.categorisation import rule_categorise_directed
    for text in ("AMEX TRAVEL REFUND", "CHASE VETS REFUND", "NATWEST BANK CHARGES REFUND", "AMEX REFUND"):
        assert rule_categorise_directed("", text, is_credit=True) != "Transfer", text


def test_same_narratives_as_debits_and_ordinary_amex_purchase_unchanged():
    from app.services.categorisation import rule_categorise_directed
    assert rule_categorise_directed("", "AMERICAN EXPRESS 3712-345678-90777 UNP", is_credit=False) == "Debt"
    assert rule_categorise_directed("", "AMERICAN EXPRESS 3712-345678-90777", is_credit=False) == "Debt"
    assert rule_categorise_directed("", "AMEX EXPERIENCES", is_credit=False) is None
    assert rule_categorise_directed("", "AMEX EXPERIENCES", is_credit=True) is None
    assert rule_categorise_directed("", "AMEX REFUND", is_credit=False) is None


def test_bulk_pass_runs_rules_before_the_credit_income_default():
    import inspect
    from app.services import categorisation
    src = inspect.getsource(categorisation.apply_rules_bulk)
    i = src.index("_match = rule_categorise_directed(merchant, description, is_credit=True)")
    assert src.index('else "Income"', i) > i
