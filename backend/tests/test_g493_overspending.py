"""G493: the overspending engine. Pure-function tests on synthetic data
(invented accounts, no database), plus the acknowledgement endpoints and the
stored-not-computed read path against in-memory collections."""
import asyncio
from datetime import date

import pytest

import app.routers.spend_verdict as spend_router
import app.services.overspending as ov
import app.services.response_cache as response_cache
from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.overspending import (
    build_overspending,
    first_crossed_on,
    on_course_block,
    period_figures,
    split_funded_by,
)

KINDS = BUILTIN_CATEGORY_KINDS
CUR, SAV, CARD = "cur1", "sav1", "card1"
SAVINGS, CARDS = {SAV}, {CARD}
START, END = date(2026, 10, 1), date(2026, 10, 31)
USER = {"email": "g493-user@example.com"}


def t(day, amount, category, *, debit=True, acct=CUR, own_move=False, card_repayment=False, month=10):
    return {
        "date": date(2026, month, day), "category": category, "amount": float(amount),
        "debit": debit, "account_id": acct, "own_move": own_move,
        "card_repayment": card_repayment, "description": "", "merchant_name": "",
        "merchant_key": "", "id": f"{month}-{day}-{category}-{amount}-{debit}-{acct}",
    }


def salary(amount, day=1, month=10):
    return t(day, amount, "Income", debit=False, month=month)


def spend(amount, day=5, acct=CUR, month=10, category="Eating Out"):
    return t(day, amount, category, acct=acct, month=month)


def move_savings_to_current(amount, day=10, month=10):
    """Own-account move: debit on savings, matching credit on current."""
    return [
        t(day, amount, "Transfer", acct=SAV, own_move=True, month=month),
        t(day, amount, "Transfer", debit=False, acct=CUR, own_move=True, month=month),
    ]


def fig(txns, start=START, end=END):
    return period_figures(txns, KINDS, SAVINGS, CARDS, start, end)


# 1. Kevin's example ---------------------------------------------------------

def test_in_2000_out_2500_with_500_moved_from_savings():
    txns = [salary(2000), spend(2500)] + move_savings_to_current(500)
    f = fig(txns)
    assert f["in"] == 2000.0  # the 500 move is NOT In
    assert f["out"] == 2500.0
    assert f["gap"] == 500.0
    assert f["from_savings"] == 500.0
    assert f["funded_by"] == {"savings": 500.0, "cards": 0.0, "current_account": 0.0}
    assert f["savings_covered"] is True


# 2. Moves back into savings are netted --------------------------------------

def test_savings_out_500_and_200_back_is_300_then_cards_then_current():
    back = [
        t(20, 200, "Transfer", debit=False, acct=SAV, own_move=True),
        t(20, 200, "Transfer", acct=CUR, own_move=True),
    ]
    # In 2000; Out = 2350 on current + 150 on the card = 2500; gap 500.
    txns = [salary(2000), spend(2350), spend(150, acct=CARD)] + move_savings_to_current(500) + back
    f = fig(txns)
    assert (f["out"], f["in"], f["gap"]) == (2500.0, 2000.0, 500.0)
    assert f["from_savings"] == 300.0
    assert f["card_growth"] == 150.0
    # savings 300, cards min(200, 150) = 150, current account the remaining 50
    assert f["funded_by"] == {"savings": 300.0, "cards": 150.0, "current_account": 50.0}
    assert sum(f["funded_by"].values()) == f["gap"]


def test_interest_credit_on_savings_is_not_a_move_back():
    txns = [salary(1000), spend(1500), t(3, 40, "Interest", debit=False, acct=SAV)] + move_savings_to_current(500)
    assert fig(txns)["from_savings"] == 500.0


# 3. Card repayments are neither In nor Out ----------------------------------

def test_card_repayment_is_neither_in_nor_out():
    base = [salary(2000), spend(1200), spend(300, acct=CARD)]
    repay = [
        t(15, 600, "Debt", card_repayment=True),
        t(15, 600, "Debt", debit=False, acct=CARD, card_repayment=True),
    ]
    a, b = fig(base), fig(base + repay)
    assert (a["out"], a["in"]) == (1500.0, 2000.0)
    assert (b["out"], b["in"]) == (a["out"], a["in"])


# 4. Card purchases with no repayment ----------------------------------------

def test_card_purchases_400_fund_a_400_gap():
    txns = [salary(1000), spend(1000), spend(400, acct=CARD)]
    f = fig(txns)
    assert f["gap"] == 400.0
    assert f["funded_by"] == {"savings": 0.0, "cards": 400.0, "current_account": 0.0}


# 5. No gap ------------------------------------------------------------------

def test_no_gap_means_nothing_funds_it_and_savings_not_covered():
    txns = [salary(3000), spend(2000)] + move_savings_to_current(500)
    doc = build_overspending(
        txns=txns, kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31}, history=[],
    )
    assert doc["gap"] == 0.0
    assert doc["crossed"] is False and doc["crossed_on"] is None
    assert doc["funded_by"] == {"savings": 0.0, "cards": 0.0, "current_account": 0.0}
    assert doc["from_savings"] == 500.0
    assert doc["savings_covered"] is False


def test_cards_are_capped_by_what_is_left_after_savings():
    # gap 500, 300 from savings, cards grew 400: cards take only the remaining 200.
    assert split_funded_by(500, 300, 400) == {"savings": 300.0, "cards": 200.0, "current_account": 0.0}


def test_funded_by_always_sums_to_gap():
    for gap, sav, cards in [(500, 0, 0), (500, 120.5, 90.25), (500, 900, 900), (0.1, 0.05, 0.05)]:
        fb = split_funded_by(gap, sav, cards)
        assert round(sum(fb.values()), 2) == round(gap, 2)


def test_crossed_on_is_first_day_cumulative_out_passes_in():
    txns = [salary(1000, day=1), spend(600, day=3), spend(300, day=9), spend(200, day=12)]
    assert first_crossed_on(txns, KINDS, START, END) == "2026-10-12"
    assert first_crossed_on(txns[:3], KINDS, START, END) is None


# 6. On course ---------------------------------------------------------------

def test_on_course_projects_out_and_crosses():
    b = on_course_block(
        out_to_date=1000, in_to_date=2000, days_elapsed=10, length_days=30,
        predicted_income=0, drivers=[],
    )
    assert b["projected_out"] == 3000.0
    assert b["projected_in"] == 2000.0
    assert b["on_course_to_cross"] is True
    assert b["projected_gap"] == 1000.0


def test_on_course_counts_predicted_income_before_payday():
    b = on_course_block(
        out_to_date=1000, in_to_date=2000, days_elapsed=10, length_days=30,
        predicted_income=1500, drivers=[],
    )
    assert b["projected_in"] == 3500.0
    assert b["on_course_to_cross"] is False and b["projected_gap"] == 0.0


def test_on_course_is_null_before_day_five():
    b = on_course_block(
        out_to_date=1000, in_to_date=2000, days_elapsed=4, length_days=30,
        predicted_income=0, drivers=[],
    )
    assert b["available"] is False
    assert b["projected_out"] is None and b["projected_in"] is None
    assert b["on_course_to_cross"] is None and b["projected_gap"] is None


def test_drivers_are_top_two_positive_excess_only():
    txns = [
        salary(500), spend(700, category="Travel"), spend(400, category="Eating Out"),
        spend(300, category="Groceries"), spend(90, category="Shopping"), spend(900, category="Other"),
    ]
    signals = {
        "Travel": {"usual_by_now": 100.0},        # +600
        "Eating Out": {"usual_by_now": 150.0},    # +250
        "Groceries": {"usual_by_now": 280.0},     # +20
        "Shopping": {"usual_by_now": 200.0},      # -110, dropped
        "Other": {"usual_by_now": 0.0},           # carved out
    }
    doc = build_overspending(
        txns=txns, kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31},
        history=[], signals=signals, predicted_income=0.0,
    )
    d = doc["on_course"]["drivers"]
    assert [x["category"] for x in d] == ["Travel", "Eating Out"]
    assert d[0]["excess"] == 600.0


def test_no_drivers_when_nothing_is_above_usual():
    doc = build_overspending(
        txns=[salary(500), spend(100)], kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31},
        history=[], signals={"Eating Out": {"usual_by_now": 300.0}},
    )
    assert doc["on_course"]["drivers"] == []


# 7. Trend -------------------------------------------------------------------

def test_trend_dipped_3_of_4_consecutive_1():
    months = [6, 7, 8, 9]
    covered = [True, True, False, True]  # most recent last
    txns = []
    for m, c in zip(months, covered):
        if c:
            txns += [salary(1000, month=m), spend(1500, month=m, day=6)] + move_savings_to_current(500, month=m)
        else:
            txns += [salary(2000, month=m), spend(1500, month=m, day=6)]
    history = [(date(2026, m, 1), date(2026, m, 30 if m in (6, 9) else 31)) for m in months]
    doc = build_overspending(
        txns=txns, kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31},
        history=history,
    )
    tr = doc["trend"]
    assert tr["periods_considered"] == 4
    assert tr["dipped_count"] == 3
    assert tr["consecutive"] == 1
    assert [p["savings_covered"] for p in tr["periods"]] == covered
    assert tr["periods"][0]["gap"] == 500.0 and tr["periods"][0]["from_savings"] == 500.0


def test_trend_skips_periods_with_no_data():
    doc = build_overspending(
        txns=[salary(1000, month=9), spend(1500, month=9, day=6)] + move_savings_to_current(500, month=9),
        kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31},
        history=[(date(2026, 8, 1), date(2026, 8, 31)), (date(2026, 9, 1), date(2026, 9, 30))],
    )
    assert doc["trend"]["periods_considered"] == 1 and doc["trend"]["consecutive"] == 1


# 8 + 9. Endpoints and stored-not-computed -----------------------------------

class FakeCol:
    def __init__(self):
        self.docs = {}

    async def find_one(self, filt, *a, **k):
        return self.docs.get(filt.get("_id"))

    def find(self, filt, *a, **k):
        rows = [d for d in self.docs.values() if all(d.get(k) == v for k, v in filt.items())]

        class _It:
            def __init__(s):
                s.rows = list(rows)

            def __aiter__(s):
                return s

            async def __anext__(s):
                if not s.rows:
                    raise StopAsyncIteration
                return s.rows.pop(0)

        return _It()

    async def update_one(self, filt, update, upsert=False):
        _id = filt["_id"]
        doc = self.docs.get(_id)
        if doc is None:
            if not upsert:
                return
            doc = self.docs[_id] = {"_id": _id}
        doc.update(update["$set"])

    async def replace_one(self, filt, doc, upsert=False):
        self.docs[filt["_id"]] = dict(doc)

    async def delete_one(self, filt):
        self.docs.pop(filt["_id"], None)


@pytest.fixture
def cols(monkeypatch):
    from app.services import overspending_moments
    cache, ack = FakeCol(), FakeCol()
    monkeypatch.setattr(ov, "overspending_cache_col", cache)
    monkeypatch.setattr(ov, "preferences_col", FakeCol())  # no prefs: calendar months

    async def _end(uid):
        return END
    monkeypatch.setattr(ov, "current_period_end", _end)
    monkeypatch.setattr(ov, "overspending_ack_col", ack)
    # G494 decorates stored reads with presentation readiness. Keep this
    # pre-existing engine/route test fully isolated from Motor event loops.
    monkeypatch.setattr(overspending_moments, "preferences_col", FakeCol())
    monkeypatch.setattr(overspending_moments, "notification_state_col", FakeCol())
    async def _version(uid, **kwargs):
        return 3
    async def _ready(uid):
        return {"first_sync": False, "state": "ready"}
    monkeypatch.setattr(overspending_moments.data_version, "current_strict", _version)
    monkeypatch.setattr(overspending_moments, "first_sync_state", _ready)
    invalidated = []
    monkeypatch.setattr(response_cache, "invalidate", lambda uid, name=None: invalidated.append(uid))
    return cache, ack, invalidated


def _stored_doc():
    doc = build_overspending(
        txns=[salary(2000), spend(2500)] + move_savings_to_current(500),
        kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31},
        history=[(date(2026, 9, 1), date(2026, 9, 30))],
    )
    doc.update({"_id": USER["email"], "schema_version": ov.SCHEMA_VERSION, "data_version": 3})
    return doc


def test_acknowledgement_round_trip_changes_no_number(cols):
    cache, ack, invalidated = cols
    cache.docs[USER["email"]] = _stored_doc()
    before = {k: v for k, v in cache.docs[USER["email"]].items() if k not in ("acknowledged", "trend")}

    out = asyncio.run(spend_router.post_overspend_one_off({"period_end": "2026-10-31"}, USER))
    assert out["acknowledged"] is True
    stored = cache.docs[USER["email"]]
    assert stored["acknowledged"] is True
    assert ack.docs[f"{USER['email']}:2026-10-31"]["answer"] == "one_off"
    assert invalidated == [USER["email"]]
    assert {k: v for k, v in stored.items() if k not in ("acknowledged", "trend")} == before
    assert (stored["out"], stored["in"], stored["gap"]) == (2500.0, 2000.0, 500.0)

    out = asyncio.run(spend_router.delete_overspend_one_off("2026-10-31", USER))
    assert out["acknowledged"] is False
    assert cache.docs[USER["email"]]["acknowledged"] is False
    assert ack.docs == {}
    assert invalidated == [USER["email"]] * 2
    # undo twice is a no-op, not an error
    asyncio.run(spend_router.delete_overspend_one_off("2026-10-31", USER))


def test_acknowledgement_defaults_to_current_period_and_survives_recompute(cols, monkeypatch):
    cache, ack, _ = cols

    async def fake_end(uid):
        return END
    monkeypatch.setattr(ov, "current_period_end", fake_end)
    asyncio.run(spend_router.post_overspend_one_off(None, USER))
    assert f"{USER['email']}:2026-10-31" in ack.docs
    acked = asyncio.run(ov.acknowledged_period_ends(USER["email"]))
    doc = build_overspending(
        txns=[salary(2000), spend(2500)], kind_map=KINDS, savings_ids=SAVINGS, card_ids=CARDS,
        current={"start": START, "end": END, "days_elapsed": 10, "length_days": 31},
        history=[], acknowledged_period_ends=acked,
    )
    assert doc["acknowledged"] is True


def test_bad_period_end_is_rejected(cols):
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        asyncio.run(spend_router.post_overspend_one_off({"period_end": "31/10/2026"}, USER))


def test_verdict_reads_stored_overspending_and_never_computes(cols, monkeypatch):
    cache, _ack, _ = cols

    async def boom(*a, **k):
        raise AssertionError("overspending must never be computed on a read")
    monkeypatch.setattr(ov, "compute_overspending", boom)
    monkeypatch.setattr(ov, "compute_and_cache_overspending", boom)

    cached_verdict = {"state": "normal", "pills": {"spent": 1.0, "income": 2.0, "net": 1.0}}

    async def fake_aget(name, uid):
        return cached_verdict
    monkeypatch.setattr(response_cache, "aget", fake_aget)

    out = asyncio.run(spend_router.get_spend_verdict(0, USER))
    assert out["overspending"] is None  # no stored doc
    assert "overspending" not in cached_verdict  # the cached entry is never mutated

    cache.docs[USER["email"]] = _stored_doc()
    out = asyncio.run(spend_router.get_spend_verdict(0, USER))
    assert out["overspending"]["gap"] == 500.0
    assert "_id" not in out["overspending"] and "data_version" not in out["overspending"]

    # closed periods never carry it
    assert "overspending" not in asyncio.run(spend_router.get_spend_verdict(-1, USER))


def test_stored_doc_from_another_schema_version_reads_as_absent(cols):
    cache, _ack, _ = cols
    doc = _stored_doc()
    doc["schema_version"] = ov.SCHEMA_VERSION + 1
    cache.docs[USER["email"]] = doc
    assert asyncio.run(ov.read_stored_overspending(USER["email"])) is None


def test_one_off_refuses_a_period_end_that_is_not_a_real_period_end(cols):
    from fastapi import HTTPException
    for bad in ("2026-10-15", "2026-11-30", "2020-02-10"):  # mid-period, a future period, mid-period
        with pytest.raises(HTTPException) as e:
            asyncio.run(spend_router.post_overspend_one_off({"period_end": bad}, USER))
        assert e.value.status_code == 400
    assert cols[1].docs == {}
    # an earlier real period end is allowed
    asyncio.run(spend_router.post_overspend_one_off({"period_end": "2026-09-30"}, USER))
    assert f"{USER['email']}:2026-09-30" in cols[1].docs


def test_stored_doc_is_replaced_not_merged(cols, monkeypatch):
    cache, _a, _i = cols
    cache.docs[USER["email"]] = {"_id": USER["email"], "old_schema_key": 1}

    async def fake(uid):
        return {"out": 1.0}
    monkeypatch.setattr(ov, "compute_overspending", fake)

    async def cur(uid, fresh=False):
        return 4
    monkeypatch.setattr(ov.data_version, "current", cur)
    asyncio.run(ov.compute_and_cache_overspending(USER["email"]))
    assert "old_schema_key" not in cache.docs[USER["email"]]
    assert cache.docs[USER["email"]]["out"] == 1.0 and cache.docs[USER["email"]]["data_version"] == 4
