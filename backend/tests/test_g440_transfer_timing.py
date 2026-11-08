"""G440 (Kevin 2026-11-08): own-transfer rule 2 timing and name forms.

  - a named pair (the user's name in any form, or another account's or pot's
    name) within 24 hours is an automatic own transfer;
  - the same pair more than 24 hours and up to 3 days apart is a QUESTION;
  - beyond 3 days nothing is offered;
  - a pair with no name is a question; a name with no pair is a question;
  - name forms: bank truncations (4+ letters) and initials in any order.

Invented names, amounts and account ids throughout, shaped like the 8 Nov
review rows."""
import asyncio
from datetime import datetime

import app.routers.card_terms  # noqa: F401  (H143: pre-import before any collection patching)
import app.services.debt_plan  # noqa: F401
import app.routers.analytics as analytics
from app.services.categories import BUILTIN_CATEGORY_KINDS, MOVEMENT, CategoryKinds, kind_of
from app.services.categorisation import name_matches_owner
from app.services.own_account_transfers import (
    _compact_owner_name, select_unique_pairs, within_ask_window, within_auto_window,
)
from app.services.spending import SpendingContext, find_own_move_ids, find_pending_transfer_ids, is_spending
from test_g438_transfer_classification import _review_fakes
from test_transfer_pairs import UID, _t

KINDS = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
TOKENS = ["alex", "james", "carter"]  # invented profile: Alex James Carter
IDENTITY = {"name_tokens": TOKENS, "own_ids": set(), "own_map": {}, "own_keys": {}}
NO_ONE = {"name_tokens": [], "own_ids": set(), "own_map": {}, "own_keys": {}}
ACCOUNTS = {
    "barclays": {"_id": "barclays", "name": "Everyday", "type": "current"},
    "hsbc": {"_id": "hsbc", "name": "Joint", "type": "current"},
    "monzo": {"_id": "monzo", "name": "Pocket", "type": "current"},
}


def _pair(amount, debit_acc, credit_acc, debit_at, credit_at, debit_text="TO CARTER AJ", credit_text="BANK TRANSFER"):
    debit = _t("d1", ttype="debit", amount=amount, date=debit_at, account_id=debit_acc, desc=debit_text, category="Other")
    credit = _t("c1", ttype="credit", amount=amount, date=credit_at, account_id=credit_acc, desc=credit_text, category="Income")
    return credit, debit


def _classify(credit, debit, identity=IDENTITY):
    docs = [debit, credit]
    return (
        select_unique_pairs([credit, debit], ACCOUNTS, identity["name_tokens"], set()),
        find_own_move_ids(docs, KINDS, identity),
        find_pending_transfer_ids(docs, KINDS, identity),
    )


# ── timing ────────────────────────────────────────────────────────────────────

def test_named_same_day_pair_is_automatic():
    credit, debit = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)]
    assert own == {"d1"} and pending == set()


def test_named_pair_within_24_hours_by_timestamp_is_automatic():
    credit, debit = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3, 22, 10), datetime(2026, 11, 4, 20, 0))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)] and own == {"d1"} and pending == set()


def test_named_pair_three_days_apart_asks():
    credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 30), datetime(2026, 11, 6, 8, 0))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == []  # sync does not file it
    assert own == set()  # Spend does not decide it
    assert pending == {"d1"}  # left out of Spend and asked


def test_named_pair_just_over_24_hours_asks():
    credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 0), datetime(2026, 11, 4, 9, 1))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == {"d1"}


def test_midnight_timestamps_count_same_or_next_day_as_within_24_hours():
    # the bank sent a date only (00:00:00 on both legs)
    credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3), datetime(2026, 11, 4))
    assert within_auto_window(debit["date"], credit["date"])
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)] and own == {"d1"} and pending == set()
    # two days apart is not within 24 hours
    credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3), datetime(2026, 11, 5))
    assert not within_auto_window(debit["date"], credit["date"])
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == {"d1"}
    # one leg date-only, the other timed: next calendar day still counts
    assert within_auto_window(datetime(2026, 11, 3, 23, 30), datetime(2026, 11, 4))


def test_pair_beyond_three_days_is_not_offered(monkeypatch):
    # 31 Jul morning to 3 Aug evening: more than three days
    credit, debit = _pair(60.0, "barclays", "monzo", datetime(2026, 7, 31, 9, 0), datetime(2026, 8, 3, 17, 0))
    assert not within_ask_window(debit["date"], credit["date"])
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == set()
    assert is_spending(debit, SpendingContext.from_docs([debit, credit], KINDS, IDENTITY))
    _review_fakes(monkeypatch, [credit, debit], IDENTITY)
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []


def test_ask_window_edges():
    assert within_ask_window(datetime(2026, 11, 3, 9, 0), datetime(2026, 11, 6, 9, 0))
    assert not within_ask_window(datetime(2026, 11, 3, 9, 0), datetime(2026, 11, 6, 9, 1))
    assert within_ask_window(datetime(2026, 11, 3), datetime(2026, 11, 6))
    assert not within_ask_window(datetime(2026, 11, 3), datetime(2026, 11, 7))


def test_pair_with_no_name_asks_within_three_days(monkeypatch):
    credit, debit = _pair(250.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3),
                          debit_text="PAIRREF OUT", credit_text="PAIRREF IN")
    credit["category"] = "Transfer"
    pairs, own, pending = _classify(credit, debit, NO_ONE)
    assert pairs == [] and own == set() and pending == {"d1"}


def test_name_with_no_pair_asks_and_is_not_automatic():
    debit = _t("d1", ttype="debit", amount=75.0, date=datetime(2026, 11, 3), account_id="barclays",
               desc="TO CARTER AJ", category="Other")
    assert select_unique_pairs([debit], ACCOUNTS, TOKENS, set()) == []
    assert find_own_move_ids([debit], KINDS, IDENTITY) == set()


# ── the invariant: whatever Spend leaves out, the review can ask about ────────

def test_every_pending_pair_is_askable_including_named_pairs_a_day_or_more_apart():
    cases = [
        # (debit text, credit text, debit date, credit date, identity)
        ("TO CARTER AJ", "BANK TRANSFER", datetime(2026, 11, 3, 9), datetime(2026, 11, 5, 9), IDENTITY),
        ("TO CARTER AJ", "BANK TRANSFER", datetime(2026, 11, 3, 9), datetime(2026, 11, 6, 9), IDENTITY),
        ("PAYMENT", "FROM CART JA", datetime(2026, 11, 3), datetime(2026, 11, 6), IDENTITY),
        ("TO CARTER AJ", "BANK TRANSFER", datetime(2026, 11, 3), datetime(2026, 11, 4), IDENTITY),  # automatic
        ("PAIRREF OUT", "PAIRREF IN", datetime(2026, 11, 3), datetime(2026, 11, 6), NO_ONE),
    ]
    for dtext, ctext, d_at, c_at, ident in cases:
        for amount in (110.0, 110.37):  # round and distinctive pence
            credit, debit = _pair(amount, "hsbc", "barclays", d_at, c_at, debit_text=dtext, credit_text=ctext)
            credit["category"] = "Transfer" if ident is NO_ONE else "Income"
            pending = find_pending_transfer_ids([debit, credit], KINDS, ident)
            if "d1" in pending:
                assert analytics._has_pair_evidence(credit, debit, ident, kind_of(KINDS, credit["category"]) == MOVEMENT), (dtext, ctext, amount)


def test_review_offers_a_named_round_pair_three_days_apart(monkeypatch):
    credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 30), datetime(2026, 11, 6, 8, 0))
    _review_fakes(monkeypatch, [credit, debit], IDENTITY)
    items = asyncio.run(analytics._transfer_pair_suggestions(UID))
    assert [(i["credit"]["id"], i["debit"]["id"]) for i in items] == [("c1", "d1")]


# ── name forms ────────────────────────────────────────────────────────────────

def test_truncated_name_forms_match():
    tokens = ["kevin", "mainer", "carter"]  # invented: Kevin Mainer Carter
    for text in ("MAIN K", "KEVI M", "CART KM", "KEVI MAIN", "MAIN KC", "CARTER KEVI"):
        assert name_matches_owner(text, tokens), text
    for text in ("TO CART AJ",):
        assert name_matches_owner(text, ["alex", "james", "carter"]), text
    # a lone truncation is as weak as a lone surname
    assert not name_matches_owner("MAIN", tokens)
    assert not name_matches_owner("CART", tokens)
    assert _compact_owner_name("KEVI M", tokens)


def test_three_letter_truncations_never_match():
    tokens = ["kevin", "mainer", "carter"]
    for text in ("KEV M", "MAI K", "CAR AJ", "KEV MAI", "CAR KM", "KEV CAR"):
        assert not name_matches_owner(text, tokens), text
        assert not _compact_owner_name(text, tokens), text
    # short common words do not pass as truncated names
    assert not name_matches_owner("CAR PARK TO PAY", ["alex", "carter", "dean"])


def test_name_order_permutations_match():
    tokens = ["alex", "james", "carter"]
    for text in ("CARTER AJ", "CARTER JA", "AJ CARTER", "JA CARTER", "A J CARTER", "J A CARTER",
                 "ALEX JAMES CARTER", "CARTER ALEX JAMES", "JAMES CARTER", "CARTER, ALEX",
                 "CARTER AJC", "CARTER CJA"):
        assert name_matches_owner(text, tokens) or _compact_owner_name(text, tokens), text
    # the stoplist and repeated letters still hold
    assert not name_matches_owner("CARTER TO PAY", ["tom", "olivia", "carter"])
    assert not name_matches_owner("CARTER AA", ["alan", "adam", "carter"])
    assert not _compact_owner_name("CARTER AND CO", ["anna", "dora", "carter"])
