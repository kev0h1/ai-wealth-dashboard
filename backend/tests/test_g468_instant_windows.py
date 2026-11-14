"""G468 (Kevin 2026-11-14): own-transfer legs are timed by the earliest instant known
for each (min of date, first_seen, activity_date), and the same-calendar-day rule is
replaced by Kevin's windows on that instant:

  - within 24 hours: a named (or counterparty evidenced) pair files automatically ONLY
    as the single candidate at that amount on both sides; an unnamed pair only asks;
  - over 24 hours up to 3 days: always an ask; beyond 3 days: no pair;
  - card repayments and learned series keep their own windows.

Invented names, amounts and ids only. The model is never called."""
import asyncio
from datetime import datetime, timedelta

import app.routers.analytics as analytics
import app.services.categorisation as categorisation
import app.services.own_account_transfers as oat
from app.services.spending import find_own_move_ids, find_pending_transfer_ids

import test_g442_ai_transfer_judgement as g442
import test_g447_single_review_pipeline as g447
import test_transfer_pairs as tp
from test_g442_ai_transfer_judgement import KINDS, TOKENS, UID, _arun, _row, mongo_env

ACCTS = g447.ACCTS
BY_ID = g447.BY_ID
FRI_NIGHT = datetime(2026, 11, 13, 22, 27)        # Friday 22:27 (GMT)
SAT_EARLY = datetime(2026, 11, 14, 5, 30)         # first seen Saturday 05:30
MON_POST = datetime(2026, 11, 16)                 # the posting date the bank gave it


def _shape(*, debit_text="K NORTHWIND TEST FT", credit_text="NORTHWIND TEST"):
    """The agreed shape: a credit at Friday 22:27, a debit first seen Saturday and posted Monday."""
    c = _row("c", "credit", 70.0, "hsbc", FRI_NIGHT, credit_text, category="Income")
    d = _row("d", "debit", 70.0, "natw", MON_POST, debit_text, first_seen=SAT_EARLY, activity_date=SAT_EARLY)
    return c, d


def _select(rows):
    return oat.select_unique_pairs(rows, BY_ID, TOKENS, set(), movement_categories={"Transfer"})


def _review(monkeypatch, rows):
    out = {}

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS):
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: g442._async(identity))
            out["state"] = await analytics._build_review_state(UID)
            out["legs"] = g447._legs(out["state"])
    _arun(run())
    return out


def _identity():
    meta = {k: {f: v.get(f) for f in ("provider", "name", "type")} for k, v in BY_ID.items()}
    return {"name_tokens": TOKENS, "own_ids": set(), "own_map": {}, "own_keys": {},
            "account_names": {k: v["name"] for k, v in BY_ID.items()}, "account_meta": meta}


# ── the instant ─────────────────────────────────────────────────────────────

def test_a_leg_is_timed_by_the_earliest_known_instant():
    c, d = _shape()
    assert oat.leg_instant(d) == SAT_EARLY            # first seen beats the Monday posting date
    assert oat.leg_instant(c) == FRI_NIGHT
    assert oat.leg_instant({"date": MON_POST}) == MON_POST
    assert oat.leg_instant({"date": MON_POST, "activity_date": SAT_EARLY}) == SAT_EARLY
    assert oat.leg_instant({"description": "x"}) is None
    assert oat.pair_gap(c, d) == timedelta(hours=7, minutes=3)


def test_a_booked_row_with_a_future_posting_date_is_still_a_candidate():
    now = datetime.utcnow()  # naive-ok: Mongo booked dates are naive UTC
    c = _row("c", "credit", 70.0, "hsbc", now - timedelta(hours=2), "NORTHWIND TEST", category="Income")
    d = _row("d", "debit", 70.0, "natw", now + timedelta(days=2), "K NORTHWIND TEST FT",
             first_seen=now - timedelta(hours=1))
    assert [(x["_id"], y["_id"]) for x, y, _ in oat._same_amount_pairs(
        [c, d], BY_ID, {"Transfer"}, consumed=set(), exclude_ids=frozenset())] == [("c", "d")]


# ── the agreed shape: unnamed asks, named and unique files ──────────────────

def test_the_unnamed_shape_within_24_hours_asks_and_never_files(monkeypatch):
    c, d = _shape()
    assert oat.within_auto_window(c, d)
    assert _select([c, d]) == []                       # never automatic
    assert find_own_move_ids([c, d], KINDS, _identity()) == set()
    got = _review(monkeypatch, [c, d])
    assert {"c", "d"} <= got["legs"]                   # ... but asked


def test_the_same_shape_with_a_name_on_one_leg_as_the_unique_candidate_files_automatically():
    c, d = _shape(debit_text="K JORDAN HARTLEY FT")
    assert [(x["_id"], y["_id"]) for x, y in _select([c, d])] == [("c", "d")]
    assert find_own_move_ids([c, d], KINDS, _identity()) == {"d"}


def test_a_named_pair_with_two_candidates_at_the_same_amount_asks():
    c, d = _shape(debit_text="K JORDAN HARTLEY FT")
    rival = _row("d2", "debit", 70.0, "barc", FRI_NIGHT + timedelta(hours=3), "JORDAN HARTLEY FT")
    assert _select([c, d, rival]) == []
    assert find_own_move_ids([c, d, rival], KINDS, _identity()) == set()
    # a second CREDIT at the same amount makes it ambiguous from the other side too
    rival_c = _row("c2", "credit", 70.0, "star", FRI_NIGHT + timedelta(hours=1), "SOMEONE ELSE", category="Income")
    assert _select([c, d, rival_c]) == []


def test_counterparty_evidence_follows_the_same_rule():
    accts = {**BY_ID, "hsbc": {**BY_ID["hsbc"], "sort_code": "11-22-33", "account_number": "87654321"}}
    c = _row("c", "credit", 70.0, "hsbc", FRI_NIGHT, "FASTER PAYMENT IN", category="Income")
    d = _row("d", "debit", 70.0, "natw", MON_POST, "FT OUT", first_seen=SAT_EARLY,
             party_sort_code="112233", party_number="87654321")
    assert [(x["_id"], y["_id"]) for x, y in oat.select_unique_pairs([c, d], accts, TOKENS, set(), movement_categories={"Transfer"})] == [("c", "d")]
    # over 24 hours the same evidence only asks
    late = {**d, "first_seen": None, "date": FRI_NIGHT + timedelta(hours=30)}
    late.pop("first_seen")
    assert oat.select_unique_pairs([c, late], accts, TOKENS, set(), movement_categories={"Transfer"}) == []


# ── the windows ─────────────────────────────────────────────────────────────

def test_a_two_day_gap_asks_and_a_four_day_gap_is_no_pair(monkeypatch):
    c = _row("c", "credit", 70.0, "hsbc", datetime(2026, 11, 9, 10, 0), "HARTLEY J E HSBC")
    d2 = _row("d", "debit", 70.0, "natw", datetime(2026, 11, 11, 10, 0), "JORDAN HARTLEY HSBC STO")
    d4 = {**d2, "date": datetime(2026, 11, 13, 10, 0)}
    assert not oat.within_auto_window(c, d2) and oat.within_ask_window(c, d2)
    assert _select([c, d2]) == []                       # not automatic
    assert {"c", "d"} <= _review(monkeypatch, [c, d2])["legs"]   # asked
    assert not oat.pair_timing_ok(c, d4, BY_ID)
    assert _select([c, d4]) == []
    assert _review(monkeypatch, [c, d4])["state"]["pairs"] == []


def test_the_24_hour_window_is_exact_elapsed_time_in_bst_and_gmt():
    for base in (datetime(2026, 7, 10, 22, 30), datetime(2026, 10, 24, 22, 30), datetime(2026, 12, 11, 22, 30)):
        c = _row("c", "credit", 5.0, "hsbc", base, "x")
        inside = _row("d", "debit", 5.0, "natw", base + timedelta(hours=24), "x")
        outside = _row("d", "debit", 5.0, "natw", base + timedelta(hours=24, minutes=1), "x")
        assert oat.within_auto_window(c, inside) and not oat.within_auto_window(c, outside)
    # across the clock change (BST ends 01:00 UTC on 25 Oct) it is still elapsed UTC time
    assert oat.within_auto_window(datetime(2026, 10, 24, 12, 0), datetime(2026, 10, 25, 12, 0))


def test_learned_pairs_are_capped_at_five_days():
    c = _row("c", "credit", 150.0, "hsbc", datetime(2026, 11, 9), "HARTLEY J E HSBC")
    key = tuple(sorted((categorisation.canonical_merchant_key("", "HARTLEY J E HSBC"),
                        categorisation.canonical_merchant_key("", "JORDAN HARTLEY HSBC STO"))))
    five = _row("d", "debit", 150.0, "natw", datetime(2026, 11, 14), "JORDAN HARTLEY HSBC STO")
    six = {**five, "date": datetime(2026, 11, 15, 1)}
    assert oat.pair_timing_ok(c, five, BY_ID, {key})
    assert not oat.pair_timing_ok(c, six, BY_ID, {key})
    # a user-confirmed, a model-learned (prefixed) and a series pair are all in the same set and all capped
    ai_key = tuple(sorted((oat.AI_KEY_PREFIX + oat.transfer_text_key(None, "HARTLEY J E HSBC"),
                           oat.AI_KEY_PREFIX + oat.transfer_text_key(None, "JORDAN HARTLEY HSBC STO"))))
    assert oat.pair_timing_ok(c, five, BY_ID, {ai_key}) and not oat.pair_timing_ok(c, six, BY_ID, {ai_key})


def test_which_short_keys_may_be_learned():
    ok = oat.learnable_pair_keys
    assert ok("test", "k monzo test")                     # one short but specific key (prod shape)
    assert not ok("test", "ft")                            # both generic
    assert not ok("transfer", "ft") and not ok("to", "k monzo test") and not ok("pot", "k monzo test")
    assert not ok("sto", "k monzo test") and not ok("from", "k monzo test") and not ok("savings", "k monzo test")
    assert not ok("from savings", "k monzo test")          # only generic words
    assert ok("acme rail", "hartley j e hsbc")             # ordinary long keys, as before


def test_a_learned_series_matches_a_four_day_gap_and_card_repayments_keep_their_window():
    c = _row("c", "credit", 150.0, "hsbc", datetime(2026, 11, 9), "HARTLEY J E HSBC")
    d = _row("d", "debit", 150.0, "natw", datetime(2026, 11, 13), "JORDAN HARTLEY HSBC STO")
    key = tuple(sorted((categorisation.canonical_merchant_key("", "HARTLEY J E HSBC"),
                        categorisation.canonical_merchant_key("", "JORDAN HARTLEY HSBC STO"))))
    assert _select([c, d]) == []
    assert [(x["_id"], y["_id"]) for x, y in oat.select_unique_pairs([c, d], BY_ID, TOKENS, {key}, movement_categories={"Transfer"})] == [("c", "d")]
    card = _row("r-c", "credit", 61.78, "ncc1", datetime(2026, 7, 31), "DIRECT DEBIT PAYMENT 7788", category="Income")
    bank = _row("r-d", "debit", 61.78, "natw", datetime(2026, 7, 29), "NATWEST", category="Other")
    assert oat.pair_timing_ok(card, bank, BY_ID)


# ── a series filed twice is learned; a confirmation learns from one specific key ──

def test_a_series_filed_twice_by_rule_becomes_a_learned_pair(monkeypatch):
    rows = []
    for m in range(2):
        day = datetime(2026, 10, 1) + timedelta(days=7 * m)
        rows.append(_row(f"d{m}", "debit", 90.0, "natw", day, "JORDAN HARTLEY HSBC STO"))
        rows.append(_row(f"c{m}", "credit", 90.0, "hsbc", day, "HARTLEY J E HSBC"))

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            assert await cols["confirmed_transfer_pairs"].count_documents({}) == 0
            await oat.reconcile_own_account_transfers(UID)
            learned = await cols["confirmed_transfer_pairs"].find({}).to_list(None)
            assert len(learned) == 1 and learned[0]["source"] == "series"  # never "ai": the model did not judge it
            await oat.reconcile_own_account_transfers(UID)  # idempotent
            assert await cols["confirmed_transfer_pairs"].count_documents({}) == 1
    _arun(run())


def test_a_series_learned_pair_is_held_like_a_judged_pair_and_never_called_ai(monkeypatch):
    rows = []
    for m in range(2):
        day = datetime(2026, 10, 1) + timedelta(days=7 * m)
        rows.append(_row(f"d{m}", "debit", 90.0, "natw", day, "JORDAN HARTLEY HSBC STO"))
        rows.append(_row(f"c{m}", "credit", 90.0, "hsbc", day, "HARTLEY J E HSBC"))

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            await oat.reconcile_own_account_transfers(UID)
            docs = await cols["confirmed_transfer_pairs"].find({}).to_list(None)
            keys = oat._learned_pair_keys(docs)
            assert all(k[0].startswith(oat.AI_KEY_PREFIX) for k in keys)   # held under the model's normaliser
            # the rows it files are not stamped as the model's
            stamped = await cols["transactions"].find({"own_transfer_match": {"$exists": True}}).to_list(None)
            assert stamped and all((r["own_transfer_match"].get("source") in (None,)) for r in stamped)
            # a user confirmation of the same pair removes it (like a judged pair)
            ka, kb = oat.ai_pair_keys(rows[1], rows[0])
            await cols["confirmed_transfer_pairs"].delete_many({"key_a": ka, "key_b": kb, "source": {"$in": ["ai", "series"]}})
            assert await cols["confirmed_transfer_pairs"].count_documents({}) == 0
    _arun(run())


def test_a_series_filed_once_is_not_learned(monkeypatch):
    rows = [_row("d0", "debit", 90.0, "natw", datetime(2026, 10, 1), "JORDAN HARTLEY HSBC STO"),
            _row("c0", "credit", 90.0, "hsbc", datetime(2026, 10, 1), "HARTLEY J E HSBC")]

    async def run():
        async with mongo_env(monkeypatch, rows, accounts=ACCTS) as cols:
            await oat.reconcile_own_account_transfers(UID)
            assert await cols["confirmed_transfer_pairs"].count_documents({}) == 0
    _arun(run())


def test_a_confirmation_learns_when_only_one_key_is_a_short_word(monkeypatch):
    """The prod cause: the credit's key is the one short word "test", and the confirm path refused
    to learn unless BOTH keys were longer than five characters, so four confirmed pairs never learned."""
    credit = tp._t("cc", ttype="credit", amount=70.0, date=datetime(2026, 11, 13, 22, 27), account_id="accA",
                   desc="TEST", category="Income")
    debit = tp._t("dd", ttype="debit", amount=70.0, date=datetime(2026, 11, 16), account_id="accB",
                  desc="K MONZO TEST FT", category="Other")
    learned = tp.FakeCol([])
    import app.services.derived_caches as derived

    async def noop(*a, **k):
        return None
    monkeypatch.setattr(derived, "mark_stale", noop)
    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", noop)
    monkeypatch.setattr(analytics, "transactions_col", tp.FakeCol([credit, debit]))
    monkeypatch.setattr(analytics, "accounts_col", tp.FakeCol([
        {"_id": a, "user_id": tp.UID, "currency": "GBP", "type": "current"} for a in ("accA", "accB")]))
    monkeypatch.setattr(analytics, "confirmed_transfer_pairs_col", learned)
    monkeypatch.setattr(analytics, "get_category_kinds", tp._fake_get_category_kinds)
    asyncio.run(analytics.confirm_transfer_pair({"credit_id": "cc", "debit_id": "dd"}, {"email": tp.UID}))
    assert len(learned.docs) == 1 and {learned.docs[0]["key_a"], learned.docs[0]["key_b"]} >= {"test"}
    # two generic keys together are still never learned
    assert oat.too_generic_to_learn("test") and oat.too_generic_to_learn("ft")


def test_the_review_rules_version_was_bumped_so_stored_reviews_rebuild():
    assert oat.REVIEW_RULES_VERSION >= 3
