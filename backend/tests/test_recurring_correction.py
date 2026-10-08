"""G190: a user's category correction on any row of a recurring series sets
the series category; the PATCH path marks the cache stale and its recompute
is the G177 compare-and-swap."""
import asyncio
from datetime import date, datetime, timedelta

import pytest

import app.routers.analytics as analytics
import app.routers.transactions as transactions
from app.services.recurring_category import series_category
from tests import test_cashflow_staleness as st
from tests.test_cashflow_staleness import FakeCol, UID, _env  # noqa: F401  (autouse fixture re-used)

TODAY = date(2026, 10, 1)


def _rows(cats, corrected=None):
    """Monthly M&S LOANS rows, oldest first. corrected: {index: (category, stamp)}."""
    out = []
    for i, c in enumerate(cats):
        d = datetime(2026, 5, 28) + timedelta(days=30 * i)
        r = {"merchant_name": "M&S LOANS", "description": "M&S LOANS", "amount": -120.0,
             "date": d, "transaction_type": "debit", "category": c, "custom_category": None,
             "account_id": "a1"}
        if corrected and i in corrected:
            r["custom_category"], r["custom_category_at"] = corrected[i]
        out.append(r)
    return out


def _detect(rows):
    res = analytics._detect_recurring(rows, trusted_categories={"Bills", "Car finance"}, today=TODAY)
    assert len(res) == 1
    return res[0]["category"]


def test_kevin_case_latest_row_corrected_wins_over_five_bills():
    rows = _rows(["Bills"] * 5, {4: ("Car finance", datetime(2026, 10, 1, 13, 11))})
    assert _detect(rows) == "Car finance"


def test_no_corrections_the_vote_stands():
    assert _detect(_rows(["Bills", "Bills", "Bills", "Car finance"])) == "Bills"


def test_vote_tie_is_deterministic_most_recent_row():
    rows = _rows(["Bills", "Bills", "Car finance", "Car finance"])
    assert series_category(rows) == "Car finance"
    assert series_category(list(reversed(rows))) == "Car finance"


def test_conflicting_corrections_latest_wins_and_others_stay_row_level():
    rows = _rows(["Bills"] * 5, {
        1: ("Insurance", datetime(2026, 9, 1)),
        3: ("Car finance", datetime(2026, 10, 1)),
    })
    assert _detect(rows) == "Car finance"
    assert rows[1]["custom_category"] == "Insurance"  # untouched row override


def test_correction_stamp_beats_row_date_when_an_older_row_corrected_last():
    rows = _rows(["Bills"] * 5, {
        1: ("Car finance", datetime(2026, 10, 2)),   # older row, corrected most recently
        3: ("Insurance", datetime(2026, 9, 1)),
    })
    assert series_category(rows) == "Car finance"


def test_correction_on_older_row_wins_over_newer_uncorrected_rows():
    rows = _rows(["Bills"] * 5, {0: ("Car finance", datetime(2026, 10, 1))})
    assert _detect(rows) == "Car finance"


def test_unstamped_legacy_corrections_fall_back_to_row_date():
    rows = _rows(["Bills"] * 5)
    rows[1]["custom_category"] = "Insurance"
    rows[3]["custom_category"] = "Car finance"
    assert series_category(rows) == "Car finance"


def test_correction_on_row_trimmed_by_gate_still_counts():
    # an outlier old row (80 day gap) is dropped by the gate retry but its
    # correction is the user's word about the series
    rows = _rows(["Bills"] * 4)
    old = dict(rows[0]); old["date"] = datetime(2026, 2, 1)
    old["custom_category"], old["custom_category_at"] = "Car finance", datetime(2026, 10, 1)
    assert _detect([old] + rows) == "Car finance"


# ── PATCH route: marks stale, stamps the correction, recompute is the CAS ────

class _TxnCol:
    def __init__(self):
        self.sets = []

    async def update_one(self, filt, update, **_k):
        self.sets.append(update)

    async def update_many(self, *_a, **_k):
        class R: modified_count = 0
        return R()

    def find(self, *_a, **_k):
        class C:
            async def to_list(self, _n):
                return []
        return C()

    async def find_one(self, *_a, **_k):
        return None


def test_patch_marks_stale_stamps_correction_and_recompute_reflects_it(_env, monkeypatch):
    col = _TxnCol()
    monkeypatch.setattr(transactions, "transactions_col", col)

    class _Ev:
        async def insert_one(self, *_a, **_k):
            return None

    monkeypatch.setattr(transactions, "teaching_events_col", _Ev())
    monkeypatch.setattr(transactions, "cache_merchant", lambda *a, **k: asyncio.sleep(0))

    async def vocab(_uid):
        return set()

    monkeypatch.setattr(transactions, "user_allowed_categories", vocab)

    async def patterns(uid):
        return {"upcoming_bills": [{"name": "M&S LOANS", "category": "Car finance"}], "recurring_spend": []}

    monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns)

    async def run():
        out = await transactions.update_transaction(
            "t1", {"category": "Car finance"}, {"email": UID})
        # the doc is stamped dirty BEFORE the background recompute is awaited
        assert "dirty_since" in _env["cache"].docs[UID]
        await asyncio.sleep(0.05)
        return out

    out = asyncio.run(run())
    assert out["custom_category"] == "Car finance"
    assert col.sets[0]["$set"]["custom_category"] == "Car finance"
    assert isinstance(col.sets[0]["$set"]["custom_category_at"], datetime)
    doc = _env["cache"].docs[UID]
    assert doc["upcoming_bills"][0]["category"] == "Car finance"
    assert "dirty_since" not in doc  # recompute started after the stamp cleared it
    assert UID in _env["inval"]


def test_older_recompute_after_a_correction_cannot_overwrite(_env, monkeypatch):
    """The G177 race extended with a real correction between the two reads."""
    store = {"cat": "Bills"}

    async def run():
        gate = asyncio.Event()
        calls = {"n": 0}

        async def patterns(uid):
            calls["n"] += 1
            snap = {"upcoming_bills": [{"name": "M&S LOANS", "category": store["cat"]}]}
            if calls["n"] == 1:
                await gate.wait()
            return snap

        monkeypatch.setattr(analytics, "_compute_cashflow_patterns", patterns)
        old = asyncio.create_task(analytics.compute_and_cache_cashflow(UID, clear_ai_cache=False))
        await asyncio.sleep(0.02)
        store["cat"] = "Car finance"  # the correction lands after the old read
        from app.services.derived_caches import mark_stale
        await mark_stale(UID, reason="category_correction")
        await asyncio.sleep(0.02)
        await analytics.compute_and_cache_cashflow(UID, clear_ai_cache=False)
        gate.set()
        await old

    asyncio.run(run())
    doc = _env["cache"].docs[UID]
    assert doc["upcoming_bills"][0]["category"] == "Car finance"
    assert "dirty_since" not in doc
