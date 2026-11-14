"""G468: a faster payment that crosses a weekend pairs.

One leg books on Friday evening (London) at the receiving bank and the sending
bank posts its leg with the next business day's date. G447's same-calendar-day
rule never paired them. The rule now also accepts a later leg no later than the
next UK business day after the earlier leg's London day (weekends and the static
England and Wales bank-holiday set; no network). Invented names and amounts only.
"""
from datetime import datetime, timedelta

import app.routers.analytics as analytics
import app.services.categorisation as categorisation
import app.services.own_account_transfers as oat
from app.core.bank_days import next_business_day_after

import test_g442_ai_transfer_judgement as g442
import test_g447_single_review_pipeline as g447
from test_g442_ai_transfer_judgement import TOKENS, UID, _arun, _row, mongo_env

ACCTS = [
    {"_id": "alpha", "user_id": UID, "name": "Alpha", "provider": "Alphabank", "type": "current", "currency": "GBP",
     "sort_code": "11-22-33", "account_number": "87654321"},
    {"_id": "beta", "user_id": UID, "name": "Beta", "provider": "Betabank", "type": "current", "currency": "GBP",
     "sort_code": "04-00-04", "account_number": "12345678"},
]
BY_ID = {a["_id"]: a for a in ACCTS}

FRI_NIGHT = datetime(2026, 11, 13, 22, 30)   # Friday 22:30 London (GMT)
MON = datetime(2026, 11, 16)                  # Monday, date-only posting
TUE, THU = datetime(2026, 11, 10), datetime(2026, 11, 12)


def _sortcode_pair(credit_at, debit_at, amount=70.0, tag=""):
    c = _row(f"{tag}c", "credit", amount, "alpha", credit_at, "FASTER PAYMENT IN", category="Income")
    d = _row(f"{tag}d", "debit", amount, "beta", debit_at, "FT OUT REF 9",
             party_sort_code="112233", party_number="87654321")
    return c, d


def _ids(pairs):
    return sorted((c["_id"], d["_id"]) for c, d in pairs)


def test_friday_night_credit_and_monday_debit_with_sort_code_evidence_pairs_automatically():
    c, d = _sortcode_pair(FRI_NIGHT, MON)
    got = oat.select_unique_pairs([c, d], BY_ID, TOKENS, set(), movement_categories={"Transfer"})
    assert _ids(got) == [("c", "d")]


def test_saturday_booking_and_monday_posting_pair():
    c, d = _sortcode_pair(datetime(2026, 11, 14, 10, 0), MON)
    assert _ids(oat.select_unique_pairs([c, d], BY_ID, TOKENS, set(), movement_categories={"Transfer"})) == [("c", "d")]


def test_the_debit_leg_may_be_the_earlier_one():
    c, d = _sortcode_pair(MON, FRI_NIGHT)
    assert _ids(oat.select_unique_pairs([c, d], BY_ID, TOKENS, set(), movement_categories={"Transfer"})) == [("c", "d")]


def test_tuesday_and_thursday_never_pair():
    c, d = _sortcode_pair(TUE, THU)
    assert oat.select_unique_pairs([c, d], BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    assert list(oat._same_amount_pairs([c, d], BY_ID, {"Transfer"}, consumed=set(), exclude_ids=frozenset())) == []
    assert not oat.pair_timing_ok(c, d, BY_ID)
    # Friday to Tuesday is also too far
    c2, d2 = _sortcode_pair(FRI_NIGHT, datetime(2026, 11, 17))
    assert not oat.pair_timing_ok(c2, d2, BY_ID)


def test_a_bank_holiday_monday_pushes_the_window_to_tuesday():
    # 2026-08-28 is a Friday, 2026-08-31 the August bank holiday Monday
    assert next_business_day_after(datetime(2026, 8, 28).date()).isoformat() == "2026-09-01"
    c, d = _sortcode_pair(datetime(2026, 8, 28, 21, 0), datetime(2026, 9, 1))
    assert oat.pair_timing_ok(c, d, BY_ID)
    # the day before the holiday Monday ... and a Wednesday is still too late
    c2, d2 = _sortcode_pair(datetime(2026, 8, 28, 21, 0), datetime(2026, 9, 2))
    assert not oat.pair_timing_ok(c2, d2, BY_ID)


def test_a_same_day_candidate_beats_a_cross_day_one():
    # credit on Friday evening; a same-day debit exists AND a Monday debit of the same amount
    c, d_same = _sortcode_pair(FRI_NIGHT, datetime(2026, 11, 13, 22, 31), tag="s")
    _, d_mon = _sortcode_pair(FRI_NIGHT, MON, tag="m")
    got = oat.select_unique_pairs([c, d_same, d_mon], BY_ID, TOKENS, set(), movement_categories={"Transfer"})
    assert _ids(got) == [("sc", "sd")]
    built = [(x["_id"], y["_id"]) for x, y, _ in oat._same_amount_pairs(
        [c, d_same, d_mon], BY_ID, {"Transfer"}, consumed=set(), exclude_ids=frozenset())]
    assert built == [("sc", "sd")]


def test_the_london_date_decides_across_the_bst_and_gmt_boundary():
    # BST (UTC+1): 23:30 UTC on Fri 23 Oct is 00:30 Saturday 24 Oct London, Monday 26 Oct posts
    assert oat.next_business_day_window(datetime(2026, 10, 23, 23, 30), datetime(2026, 10, 26))
    # still Friday in London at 22:30 UTC in winter (GMT): Monday 2 Nov is ok, Tuesday is not
    assert oat.next_business_day_window(datetime(2026, 10, 30, 22, 30), datetime(2026, 11, 2))
    assert not oat.next_business_day_window(datetime(2026, 10, 30, 22, 30), datetime(2026, 11, 3))
    # clocks went back on Sun 25 Oct: Fri 23:30 UTC (BST, Sat London) vs Tue 27 Oct is too far
    assert not oat.next_business_day_window(datetime(2026, 10, 23, 23, 30), datetime(2026, 10, 27))


def _g447_named(day_c, day_d):
    """The G447 name-only shape (invented names): no sort code, the owner's name on both legs."""
    return (_row("c", "credit", 80.0, "hsbc", day_c, "HARTLEY J E HSBC"),
            _row("d", "debit", 80.0, "natw", day_d, "JORDAN HARTLEY HSBC STO"))


def _review_legs(monkeypatch, c, d):
    out = {}

    async def run():
        async with mongo_env(monkeypatch, [c, d], accounts=g447.ACCTS):
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: g442._async(identity))
            state = await analytics._build_review_state(UID)
            out["legs"] = g447._legs(state)
            out["pairs"] = state["pairs"]
    _arun(run())
    return out


def test_name_only_cross_day_is_asked_not_filed(monkeypatch):
    c, d = _g447_named(FRI_NIGHT, MON)
    # not filed automatically (a name alone files only on the same day) ...
    assert oat.select_unique_pairs([c, d], g447.BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    # ... but the model sees it and the review asks
    assert _ids(oat.ai_candidate_pairs([c, d], g447.BY_ID, TOKENS, set(), movement_categories={"Transfer"})) == [("c", "d")]
    assert {"c", "d"} <= _review_legs(monkeypatch, c, d)["legs"]


def test_name_only_same_day_is_still_filed_automatically_and_tuesday_thursday_is_not_asked(monkeypatch):
    c, d = _g447_named(FRI_NIGHT, FRI_NIGHT)
    assert _ids(oat.select_unique_pairs([c, d], g447.BY_ID, TOKENS, set(), movement_categories={"Transfer"})) == [("c", "d")]
    c2, d2 = _g447_named(TUE, THU)
    assert oat.select_unique_pairs([c2, d2], g447.BY_ID, TOKENS, set(), movement_categories={"Transfer"}) == []
    assert _review_legs(monkeypatch, c2, d2)["pairs"] == []


def test_the_review_rules_version_was_bumped_so_stored_reviews_rebuild():
    assert oat.REVIEW_RULES_VERSION >= 3
