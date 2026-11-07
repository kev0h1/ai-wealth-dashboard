"""G438 rule 2 (Kevin 2026-11-07): transfer classification.

  - the counterparty sort code AND account number of an account on file is an
    own transfer, automatically;
  - the user's name is a QUESTION for the transfers review, never automatic;
  - two similar transactions in opposite directions are a QUESTION too;
  - a user's answer or rule overrides both ways.

Invented names, sort codes and account numbers throughout."""
import asyncio
from datetime import datetime, timedelta

import app.routers.card_terms  # noqa: F401  (H143: pre-import before any collection patching)
import app.services.debt_plan  # noqa: F401
import app.routers.analytics as analytics
import app.services.categorisation as categorisation
from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds
from app.services.categorisation import (
    classify_ft, is_card_balance_transfer, is_own_transfer, name_matches_owner, own_transfer_evidence,
    rule_categorise, rule_categorise_directed,
)
from app.services.own_account_transfers import select_unique_pairs
from app.services.spending import (
    SpendingContext, find_own_move_ids, find_pending_transfer_ids, is_spending, txn_flow,
)
from test_transfer_pairs import (
    D0, UID, FakeCol, _fake_get_category_kinds, _fake_user_identity, _run_apply_rules_bulk, _t,
)

KINDS = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
TOKENS = ["jordan", "blake"]
IDENTITY = {
    "name_tokens": TOKENS,
    "own_ids": {"040004", "12345678"},
    "own_map": {"12345678": {"account_id": "saver"}},
    "own_keys": {("040004", "12345678"): {"saver"}},
}
NO_ONE = {"name_tokens": [], "own_ids": set(), "own_map": {}, "own_keys": {}}
ACCOUNTS = {
    "main": {"_id": "main", "sort_code": "11-22-33", "account_number": "87654321", "type": "current"},
    "saver": {"_id": "saver", "sort_code": "04-00-04", "account_number": "12345678", "type": "savings"},
}


# ── sort code and account number: automatic ───────────────────────────────────

def test_sort_code_and_account_number_in_the_text_is_automatic():
    for text in ("TO 04-00-04 12345678", "TO 040004 12345678", "FASTER PAYMENT 04 00 04 / 12345678", "TO 04000412345678"):
        ev = own_transfer_evidence(text, IDENTITY, own_account_id="main")
        assert ev == {"kind": "account", "account_id": "saver"}, text
        assert is_own_transfer(text, IDENTITY, own_account_id="main"), text
    assert classify_ft("TO 04-00-04 12345678 FT", -50, IDENTITY, own_account_id="main") == "Transfer"
    assert classify_ft("TO 04-00-04 12345678 FT", 50, IDENTITY, own_account_id="main") == "Transfer"


def test_the_host_account_echoing_its_own_numbers_is_not_evidence():
    assert own_transfer_evidence("A/C 04-00-04 12345678", IDENTITY, own_account_id="saver") is None


def test_counterparty_fields_are_automatic_in_spending_and_in_the_pair_matcher():
    d = {"_id": "d1", "account_id": "main", "amount": 80.0, "date": D0, "transaction_type": "debit",
         "category": "Shopping", "description": "ACME REF 77", "party_sort_code": "040004", "party_number": "12345678"}
    assert "d1" in find_own_move_ids([d], KINDS, IDENTITY)
    credit = {"_id": "c1", "user_id": UID, "transaction_type": "credit", "account_id": "saver", "amount": 80.0,
              "currency": "GBP", "date": D0, "description": "BANK TRANSFER", "merchant_name": None,
              "category": "Income", "custom_category": None}
    debit = {**credit, "_id": "d1", "transaction_type": "debit", "account_id": "main",
             "description": "ACME REF 77", "category": "Other", "party_sort_code": "040004", "party_number": "12345678"}
    assert select_unique_pairs([credit, debit], ACCOUNTS, [], set()) == [(credit, debit)]


# ── a bare sort code or a bare account number is not enough ───────────────────

def test_a_bare_sort_code_or_bare_account_number_is_not_evidence():
    for text in ("PAYMENT 12345678", "PAYMENT 040004", "PAYMENT 04-00-04", "REF 04000412345679"):
        assert own_transfer_evidence(text, NO_ONE | {"own_keys": IDENTITY["own_keys"]}, own_account_id="main") is None, text
        assert not is_own_transfer(text, IDENTITY, own_account_id="main"), text
    d = {"_id": "d1", "account_id": "main", "amount": 80.0, "date": D0, "transaction_type": "debit",
         "category": "Business", "description": "TFR 12345678 SAVER", "party_sort_code": "040004"}
    assert find_own_move_ids([d], KINDS, IDENTITY) == set()


# ── the user's name: a question, never a decision ─────────────────────────────

def test_a_name_match_is_a_prompt_not_an_automatic_decision():
    text = "JORDAN BLAKE REGULAR SAVER"
    assert own_transfer_evidence(text, IDENTITY, own_account_id="main") == {"kind": "name"}
    assert not is_own_transfer(text, IDENTITY, own_account_id="main")
    # an FT line with the name no longer becomes Transfer; it stays visible
    assert classify_ft("TO JORDAN BLAKE FT", -50, IDENTITY, own_account_id="main") == "Other"
    assert classify_ft("FROM JORDAN BLAKE FT", 50, IDENTITY, own_account_id="main") == "Income"
    # and spending never calls it an own move on the name alone
    d = {"_id": "d1", "account_id": "main", "amount": 80.0, "date": D0, "transaction_type": "debit",
         "category": "Other", "description": text}
    assert find_own_move_ids([d], KINDS, IDENTITY) == set()


def _review_fakes(monkeypatch, txns, identity, prefs=None):
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([
        {"_id": aid, "user_id": UID, "currency": "GBP", "type": "current"}
        for aid in {t.get("account_id") for t in txns}
    ]))
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([{"user_id": UID, **(prefs or {})}]))
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    monkeypatch.setattr(analytics, "user_identity", _fake_user_identity(identity))


def test_a_name_match_debit_is_asked_about_in_the_existing_transfers_review(monkeypatch):
    txns = [_t("d1", ttype="debit", amount=40.0, date=D0, account_id="main", desc="To Jordan Blake", category="Other")]
    _review_fakes(monkeypatch, txns, IDENTITY)
    flagged = asyncio.run(analytics._flagged_miscategorised(UID))
    assert [t["_id"] for t in flagged] == ["d1"]
    assert flagged[0]["_evidence"] == {"kind": "name"}


# ── opposite-direction pair: a question ───────────────────────────────────────

def _pair(credit_text="FROM JORDAN BLAKE", debit_text="TO JORDAN BLAKE", **kw):
    credit = _t("c1", ttype="credit", amount=65.25, date=D0, account_id="saver", desc=credit_text, category="Income")
    debit = _t("d1", ttype="debit", amount=65.25, date=D0, account_id="main", desc=debit_text, category="Other")
    return credit, debit


def test_a_pair_where_a_leg_carries_the_users_name_is_automatic():
    credit, debit = _pair("BANK TRANSFER", "TO JORDAN BLAKE")
    assert select_unique_pairs([credit, debit], ACCOUNTS, TOKENS, set()) == [(credit, debit)]
    assert find_own_move_ids([debit, credit], KINDS, IDENTITY) == {"d1"}
    assert find_pending_transfer_ids([debit, credit], KINDS, IDENTITY) == set()


def test_a_pair_where_a_leg_carries_initials_only_is_automatic():
    tokens = ["alex", "james", "carter"]  # profile Alex James Carter
    credit, debit = _pair("BANK TRANSFER", "TO CARTER AJ")
    assert select_unique_pairs([credit, debit], ACCOUNTS, tokens, set()) == [(credit, debit)]
    ident = {**NO_ONE, "name_tokens": tokens}
    assert find_own_move_ids([debit, credit], KINDS, ident) == {"d1"}


def test_a_pair_where_a_leg_names_a_pot_on_file_is_automatic():
    accounts = {**ACCOUNTS, "pot": {"_id": "pot", "name": "Holiday Fund", "type": "savings"}}
    credit = _t("c1", ttype="credit", amount=65.25, date=D0, account_id="pot", desc="FROM MAIN", category="Income")
    debit = _t("d1", ttype="debit", amount=65.25, date=D0, account_id="main", desc="Holiday Fund", category="Other")
    assert select_unique_pairs([credit, debit], accounts, TOKENS, set()) == [(credit, debit)]
    ident = {**NO_ONE, "account_names": {"pot": "Holiday Fund", "main": "Main"}}
    assert find_own_move_ids([debit, credit], KINDS, ident) == {"d1"}
    # pots are accounts: with no pot on file the same text is just a payment, no pair
    assert select_unique_pairs([debit], accounts, TOKENS, set()) == []


def test_a_pair_with_no_name_asks(monkeypatch):
    credit, debit = _pair("PAIRREF IN", "PAIRREF OUT")
    credit["category"] = "Transfer"
    assert select_unique_pairs([credit, debit], ACCOUNTS, TOKENS, set()) == []
    assert find_own_move_ids([debit, credit], KINDS, NO_ONE) == set()
    assert find_pending_transfer_ids([debit, credit], KINDS, NO_ONE) == {"d1"}
    ctx = SpendingContext.from_docs([debit, credit], KINDS, NO_ONE)
    assert ctx.pending_transfer_ids == {"d1"} and ctx.confirmed_own_move_ids == set()
    assert not is_spending(debit, ctx)
    _review_fakes(monkeypatch, [credit, debit], NO_ONE)
    items = asyncio.run(analytics._transfer_pair_suggestions(UID))
    assert [(i["credit"]["id"], i["debit"]["id"]) for i in items] == [("c1", "d1")]


def test_a_name_with_no_pair_asks_and_is_not_automatic():
    debit = {"_id": "d1", "account_id": "main", "amount": 65.25, "date": D0, "transaction_type": "debit",
             "category": "Other", "description": "TO JORDAN BLAKE"}
    assert find_own_move_ids([debit], KINDS, IDENTITY) == set()
    assert not is_own_transfer("TO JORDAN BLAKE", IDENTITY, own_account_id="main")


def test_an_unpaired_pot_move_follows_the_same_rule_as_any_account():
    # A debit naming a pot with no matching credit is an ordinary payment: no
    # pot shortcut and no pot exclusion.
    ident = {**NO_ONE, "account_names": {"pot": "Holiday Fund"}}
    debit = {"_id": "d1", "account_id": "main", "amount": 50.0, "date": D0, "transaction_type": "debit",
             "category": "Other", "description": "TO HOLIDAY FUND POT"}
    assert find_own_move_ids([debit], KINDS, ident) == set()
    assert find_pending_transfer_ids([debit], KINDS, ident) == set()
    assert is_spending(debit, SpendingContext.from_docs([debit], KINDS, ident))


def test_surname_with_initials_is_the_users_name_from_profile_tokens():
    tokens = ["alex", "james", "carter"]  # profile Alex James Carter
    for text in ("CARTER AJ", "CARTER A J", "A J CARTER", "TO CARTER JA", "MR CARTER AJ"):
        assert name_matches_owner(text, tokens), text
    for text in ("CARTER", "CARTER ZQ", "ACME LTD", "AJ"):
        assert not name_matches_owner(text, tokens), text


def test_card_balance_transfers_are_transfers_on_cards_only(monkeypatch):
    assert is_card_balance_transfer("COMP BAL XFR") and is_card_balance_transfer("BALANCE TRANSFER BT123")
    assert not is_card_balance_transfer("BALANCE TRANSFER FEE") and not is_card_balance_transfer("TO J SMITH")
    rows = [
        _t("bt1", ttype="debit", amount=900.0, date=D0, account_id="card", desc="COMP BAL XFR", category="Other"),
        _t("bt2", ttype="debit", amount=900.0, date=D0, account_id="cur", desc="COMP BAL XFR", category="Other"),
    ]
    _run_apply_rules_bulk(monkeypatch, rows, accounts=[
        {"_id": "card", "user_id": UID, "type": "credit_card"}, {"_id": "cur", "user_id": UID, "type": "current"}])
    by_id = {r["_id"]: r for r in rows}
    assert by_id["bt1"]["category"] == "Transfer"
    assert by_id["bt2"]["category"] != "Transfer"


# ── empty identity is never own ───────────────────────────────────────────────

def test_empty_identity_is_never_own():
    assert not is_own_transfer("ANYTHING AT ALL", NO_ONE)
    assert not is_own_transfer("TO 04-00-04 12345678", NO_ONE)
    assert classify_ft("TO SOMEONE FT", -5, NO_ONE) is None
    assert own_transfer_evidence("JORDAN BLAKE", NO_ONE) is None


# ── a provider TRANSFER tag and wording alone are not trusted ─────────────────

def test_a_raw_provider_transfer_tag_is_not_trusted_on_its_own(monkeypatch):
    rows = [
        _t("d1", ttype="debit", amount=30.0, date=D0, account_id="main", desc="TO SOMEONE ELSE", category="TRANSFER"),
        _t("c1", ttype="credit", amount=30.0, date=D0, account_id="main", desc="FROM A FRIEND", category="TRANSFER"),
    ]
    _run_apply_rules_bulk(monkeypatch, rows)
    by_id = {r["_id"]: r for r in rows}
    assert by_id["d1"]["category"] == "Other"
    assert by_id["c1"]["category"] == "Income"


def test_wording_alone_never_makes_a_row_own_money_but_card_links_stay():
    for text in ("REGULAR SAVER TOP UP", "CASH ISA TOP UP", "INTERNAL TRANSFER", "FASTER PAYMENT TO J SMITH",
                 "STANDING ORDER 42", "FROM MY HOLIDAY POT"):
        assert rule_categorise("", text) not in ("Transfer", "Savings"), text
        assert rule_categorise_directed("", text, is_credit=False) not in ("Transfer", "Savings"), text
    # card repayment links (G403/G413) are unchanged
    assert rule_categorise("", "AMEX DDR") == "Transfer"
    assert rule_categorise("", "PAYMENT RECEIVED THANK YOU") == "Transfer"


# ── the user's answer overrides both ways ─────────────────────────────────────

def test_a_user_spend_answer_beats_name_and_pair_evidence(monkeypatch):
    credit, debit = _pair()
    debit["custom_category"] = "Groceries"
    assert find_pending_transfer_ids([debit, credit], KINDS, IDENTITY) == set()
    assert find_own_move_ids([debit, credit], KINDS, IDENTITY) == set()
    _review_fakes(monkeypatch, [credit, debit], IDENTITY)
    assert asyncio.run(analytics._flagged_miscategorised(UID)) == []
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []


def test_a_user_transfer_answer_beats_missing_evidence():
    debit = {"_id": "d1", "account_id": "main", "amount": 80.0, "date": D0, "transaction_type": "debit",
             "category": "Other", "custom_category": "Transfer", "description": "ACME REF 77"}
    ctx = SpendingContext.from_docs([debit], KINDS, NO_ONE)
    assert not txn_flow(debit, ctx).counts_as_spend
    # a pair the user already answered (learned description pair) still matches automatically
    from app.services.categorisation import canonical_merchant_key
    credit = {"_id": "c1", "user_id": UID, "transaction_type": "credit", "account_id": "saver", "amount": 80.0,
              "currency": "GBP", "date": D0, "description": "ACME RAIL IN", "merchant_name": None,
              "category": "Income", "custom_category": None}
    out = {**credit, "_id": "d2", "transaction_type": "debit", "account_id": "main", "description": "BETA OUT", "category": "Other"}
    learned = {tuple(sorted((canonical_merchant_key("", "ACME RAIL IN"), canonical_merchant_key("", "BETA OUT"))))}
    assert select_unique_pairs([credit, out], ACCOUNTS, [], learned) == [(credit, out)]


# ── a lone credit that names the user is a question too (Kevin 2026-11-07) ────

def test_a_lone_name_only_credit_is_flagged_until_answered(monkeypatch):
    credit = _t("c1", ttype="credit", amount=40.0, date=D0, account_id="main", desc="FROM JORDAN BLAKE", category="Income")
    _review_fakes(monkeypatch, [credit], IDENTITY)
    flagged = asyncio.run(analytics._flagged_miscategorised(UID))
    assert [t["_id"] for t in flagged] == ["c1"]
    assert flagged[0]["transaction_type"] == "credit" and flagged[0]["_evidence"] == {"kind": "name"}
    assert credit["category"] == "Income"  # stays Income until answered
    groups = analytics._group_miscategorised(flagged)
    assert groups[0]["transaction_type"] == "credit" and groups[0]["series_key"].endswith("|credit")


def test_an_answered_or_dismissed_credit_stops_being_flagged(monkeypatch):
    for answer in ("custom", "dismissed"):
        credit = _t("c1", ttype="credit", amount=40.0, date=D0, account_id="main", desc="FROM JORDAN BLAKE", category="Income")
        prefs = {"dismissed_miscategorised": ["c1"]} if answer == "dismissed" else None
        if answer == "custom":
            credit["custom_category"] = "Transfer"
        _review_fakes(monkeypatch, [credit], IDENTITY, prefs)
        assert asyncio.run(analytics._flagged_miscategorised(UID)) == [], answer


def test_a_credit_with_a_matching_debit_is_not_lone_and_ordinary_income_is_never_asked(monkeypatch):
    credit, debit = _pair()
    debit["custom_category"] = "Groceries"  # the pair was answered as spending
    _review_fakes(monkeypatch, [credit, debit], IDENTITY)
    assert asyncio.run(analytics._flagged_miscategorised(UID)) == []
    salary = _t("s1", ttype="credit", amount=2000.0, date=D0, account_id="main", desc="ACME LTD PAYROLL", category="Income")
    _review_fakes(monkeypatch, [salary], IDENTITY)
    assert asyncio.run(analytics._flagged_miscategorised(UID)) == []


# ── fix round: nothing leaves Spend unless the review can ask about it ────────

def test_acme_debit_and_unrelated_other_credit_stay_in_spend():
    debit = _t("d1", ttype="debit", amount=120.0, date=D0, account_id="main", desc="ACME SUPPLIES", category="Business")
    credit = _t("c1", ttype="credit", amount=120.0, date=D0, account_id="saver", desc="CUSTOMER PAYMENT", category="Other")
    assert find_pending_transfer_ids([debit, credit], KINDS, IDENTITY) == set()
    assert find_own_move_ids([debit, credit], KINDS, IDENTITY) == set()
    ctx = SpendingContext.from_docs([debit, credit], KINDS, IDENTITY)
    assert is_spending(debit, ctx)


def test_every_pending_pair_is_one_the_review_can_ask_about():
    cases = [
        ("PAIRREF OUT", "PAIRREF IN", "Other", "Transfer"),
        ("ACME SUPPLIES", "CUSTOMER PAYMENT", "Business", "Other"),
        ("ACME SUPPLIES", "CUSTOMER PAYMENT", "Other", "Income"),
        ("TRANSFER OUT", "BANK CREDIT", "Other", "Other"),
        ("TRANSFER OUT", "SALARY ACME LTD", "Other", "Income"),
        ("TRANSFER REF 9", "TRANSFER REF 9", "Other", "Transfer"),
    ]
    for debit_text, credit_text, dcat, ccat in cases:
        debit = _t("d1", ttype="debit", amount=77.5, date=D0, account_id="main", desc=debit_text, category=dcat)
        credit = _t("c1", ttype="credit", amount=77.5, date=D0, account_id="saver", desc=credit_text, category=ccat)
        pending = find_pending_transfer_ids([debit, credit], KINDS, NO_ONE)
        if "d1" in pending:
            assert analytics._has_pair_evidence(credit, debit, NO_ONE), (debit_text, credit_text)


def test_initials_do_not_match_common_words_or_repeated_letters():
    # profile Tom Olivia Jones: "TO" are his initials only as letters, not as a word
    assert not name_matches_owner("JONES TO PAY", ["tom", "olivia", "jones"])
    assert not name_matches_owner("JONES PAY", ["tom", "olivia", "jones"])
    # profile Ian Thomas Smith
    assert not name_matches_owner("SMITH IT SERVICES", ["ian", "thomas", "smith"])
    assert not name_matches_owner("SMITH AA", ["alan", "adam", "smith"])
    assert not name_matches_owner("SMITH AND CO", ["anna", "dora", "smith"])
    # real initials still match, in every layout
    tokens = ["kim", "mara", "maingi"]
    for text in ("MAINGI KM", "MAINGI K M", "K M MAINGI", "MAINGI MK", "TO MAINGI KM"):
        assert name_matches_owner(text, tokens), text


def test_generic_account_names_are_never_name_evidence():
    from app.services.own_account_transfers import account_name_in_text
    for generic in ("Main", "Bills", "Joint Account", "Rent", "Emergency Fund", "Everyday Spending"):
        assert not account_name_in_text("MAIN STREET CAFE BILLS RENT JOINT EMERGENCY FUND EVERYDAY SPENDING", {"name": generic}), generic
    assert account_name_in_text("TO MAIN G POT", {"name": "Main G"})
    assert account_name_in_text("TO HOLIDAY FUND", {"name": "Holiday Fund"})
    # a cafe payment and an unrelated credit do not auto-pair with an account called "Main"
    debit = _t("d1", ttype="debit", amount=9.5, date=D0, account_id="other", desc="MAIN STREET CAFE", category="Other")
    credit = _t("c1", ttype="credit", amount=9.5, date=D0, account_id="mainacct", desc="REFUND", category="Income")
    ident = {**NO_ONE, "account_names": {"mainacct": "Main", "other": "Current"}}
    assert find_own_move_ids([debit, credit], KINDS, ident) == set()
    accounts = {"mainacct": {"_id": "mainacct", "name": "Main", "type": "current"},
                "other": {"_id": "other", "name": "Current", "type": "current"}}
    assert select_unique_pairs([credit, debit], accounts, [], set()) == []
