"""G440 (Kevin 2026-11-08), superseded on timing by G447 (Kevin 2026-11-09): own-transfer
rule 2 name forms and the same-day timing rule.

  - between current accounts a candidate pair must be on the SAME London calendar
    day: a named pair that day is an automatic own transfer; a pair on any other
    day is no pair, so it stays in Spend and is not asked;
  - a pair with no name is a question; a name with no pair is a question;
  - name forms: bank truncations (4+ letters) and initials in any order;
  - card repayments (G381 routes) and learned series keep their own windows.

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


# ── timing (G447: the same London calendar day) ──────────────────────────────

def test_named_same_day_pair_is_automatic():
    credit, debit = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3), datetime(2026, 11, 3))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)]
    assert own == {"d1"} and pending == set()


def test_named_pair_on_the_same_day_by_timestamp_is_automatic():
    credit, debit = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3, 6, 10), datetime(2026, 11, 3, 22, 0))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [(credit, debit)] and own == {"d1"} and pending == set()


def test_the_next_day_is_not_a_pair_even_when_named_and_even_within_24_hours():
    # 22:10 and 20:00 next day is under 24 hours but two calendar days: G447 says no pair
    credit, debit = _pair(1885.0, "barclays", "hsbc", datetime(2026, 11, 3, 22, 10), datetime(2026, 11, 4, 20, 0))
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == set()
    assert is_spending(debit, SpendingContext.from_docs([debit, credit], KINDS, IDENTITY))


def test_two_and_three_days_apart_get_no_offer(monkeypatch):
    for gap in (2, 3):
        credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 30), datetime(2026, 11, 3 + gap, 8, 0))
        pairs, own, pending = _classify(credit, debit)
        assert pairs == [] and own == set() and pending == set()
        _review_fakes(monkeypatch, [credit, debit], IDENTITY)
        assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []


def test_date_only_legs_one_day_apart_are_not_a_pair(monkeypatch):
    credit, debit = _pair(110.0, "hsbc", "barclays", datetime(2026, 11, 3), datetime(2026, 11, 4))
    assert not within_auto_window(debit["date"], credit["date"])
    pairs, own, pending = _classify(credit, debit)
    assert pairs == [] and own == set() and pending == set()
    assert is_spending(debit, SpendingContext.from_docs([debit, credit], KINDS, IDENTITY))
    _review_fakes(monkeypatch, [credit, debit], IDENTITY)
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []


def test_a_one_day_gap_never_hides_a_row_unasked(monkeypatch):
    # the G438 invariant under the new rule: nothing next-day is left out of Spend either
    credit, debit = _pair(60.0, "barclays", "monzo", datetime(2026, 8, 1), datetime(2026, 8, 2))
    assert find_pending_transfer_ids([debit, credit], KINDS, IDENTITY) == set()
    assert is_spending(debit, SpendingContext.from_docs([debit, credit], KINDS, IDENTITY))


def test_same_day_edges_use_the_london_calendar_day():
    # stored naive UTC. Summer (BST = UTC+1): 23:30 UTC on 3 Aug is 00:30 London on 4 Aug
    assert within_ask_window(datetime(2026, 8, 3, 23, 30), datetime(2026, 8, 4, 8, 0))
    assert not within_ask_window(datetime(2026, 8, 3, 22, 30), datetime(2026, 8, 4, 8, 0))
    # winter (GMT): the UTC date is the London date
    assert not within_ask_window(datetime(2026, 11, 3, 23, 30), datetime(2026, 11, 4, 0, 10))
    assert within_ask_window(datetime(2026, 11, 3, 0, 0), datetime(2026, 11, 3, 23, 59))
    # a date-only (midnight) leg keeps the bank's own date in both seasons
    assert within_ask_window(datetime(2026, 8, 3), datetime(2026, 8, 3, 21, 0))
    assert within_ask_window(datetime(2026, 11, 3), datetime(2026, 11, 3, 23, 0))
    assert not within_ask_window(datetime(2026, 11, 3), datetime(2026, 11, 4))
    assert within_auto_window(datetime(2026, 11, 3), datetime(2026, 11, 3, 5)) and not within_auto_window(None, datetime(2026, 11, 3))


def test_pair_with_no_name_asks_on_the_same_day(monkeypatch):
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

def test_every_pending_pair_is_askable_and_next_day_rows_are_never_hidden():
    cases = [
        # (debit text, credit text, debit date, credit date, identity)
        ("TO CARTER AJ", "BANK TRANSFER", datetime(2026, 11, 3, 9), datetime(2026, 11, 3, 18), IDENTITY),  # automatic
        ("TO CARTER AJ", "BANK TRANSFER", datetime(2026, 11, 3, 9), datetime(2026, 11, 5, 9), IDENTITY),  # no pair
        ("PAYMENT", "FROM CART JA", datetime(2026, 11, 3), datetime(2026, 11, 3), IDENTITY),
        ("PAIRREF OUT", "PAIRREF IN", datetime(2026, 11, 3), datetime(2026, 11, 3), NO_ONE),
        ("PAIRREF OUT", "PAIRREF IN", datetime(2026, 11, 3), datetime(2026, 11, 6), NO_ONE),  # no pair
    ]
    for dtext, ctext, d_at, c_at, ident in cases:
        for amount in (110.0, 110.37):  # round and distinctive pence
            credit, debit = _pair(amount, "hsbc", "barclays", d_at, c_at, debit_text=dtext, credit_text=ctext)
            credit["category"] = "Transfer" if ident is NO_ONE else "Income"
            pending = find_pending_transfer_ids([debit, credit], KINDS, ident)
            if "d1" in pending:
                assert analytics._has_pair_evidence(credit, debit, ident, kind_of(KINDS, credit["category"]) == MOVEMENT), (dtext, ctext, amount)


def test_review_offers_a_same_day_pair_with_no_name_and_not_a_next_day_one(monkeypatch):
    credit, debit = _pair(250.0, "hsbc", "barclays", datetime(2026, 11, 3, 9, 30), datetime(2026, 11, 3, 12, 0),
                          debit_text="PAIRREF OUT", credit_text="PAIRREF IN")
    credit["category"] = "Transfer"
    _review_fakes(monkeypatch, [credit, debit], NO_ONE)
    items = asyncio.run(analytics._transfer_pair_suggestions(UID))
    assert [(i["credit"]["id"], i["debit"]["id"]) for i in items] == [("c1", "d1")]
    late = {**credit, "date": datetime(2026, 11, 4, 12, 0)}
    _review_fakes(monkeypatch, [late, debit], NO_ONE)
    assert asyncio.run(analytics._transfer_pair_suggestions(UID)) == []


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
