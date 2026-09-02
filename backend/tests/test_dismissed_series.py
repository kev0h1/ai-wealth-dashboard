"""Tests for the recurring-series undo log (owner decision, 2026-08-28):
GET /dismissed-series, POST /dismissed-series/hide, POST
/dismissed-series/override, plus the meta-stamping additions to the
existing dismiss/restore-recurring endpoints and the `judge_overrides`
addition to `recurring_judge.apply_verdicts`.

Two provenances:
  - USER dismissals live in `dismissed_recurring` (bare key list, the sole
    exclusion source of truth) plus new `dismissed_recurring_meta`
    ({key: {dismissed_at, hidden}}), both on the preferences doc.
  - ENGINE vetoes live in `engine_vetoed_recurring` on the cashflow_cache
    doc (recurring_judge.py), with `vetoed_hidden` (list of hidden keys)
    and `judge_overrides` (list of user-exempted keys) on preferences.

No mongomock is available in this environment, so every collection here is
a tiny in-memory fake, following the same local-copy convention this test
suite already uses (FakeCol/_match are NOT shared across files by
convention). `app.services.recurring_judge.apply_verdicts` is exercised
directly (pure function, no DB) for the override-outranks-judge behaviour.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.analytics as analytics
from app.routers.analytics import (
    _cadence_label_for_dates,
    _enrich_dismissed_keys,
    _stamp_missing_meta,
    _within_window,
    dismiss_recurring,
    dismissed_series,
    hide_dismissed_series,
    override_engine_veto,
    restore_recurring,
)
from app.services.recurring_judge import apply_verdicts


# ── Generic fake-Mongo plumbing ─────────────────────────────────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in (query or {}).items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$gte" in cond and (val is None or val < cond["$gte"]):
                return False
            if "$lte" in cond and (val is None or val > cond["$lte"]):
                return False
            if "$in" in cond and val not in cond["$in"]:
                return False
        else:
            if val != cond:
                return False
    return True


def _apply(doc: dict, update: dict) -> None:
    for k, v in (update.get("$set") or {}).items():
        doc[k] = v
    for field, val in (update.get("$addToSet") or {}).items():
        lst = list(doc.get(field) or [])
        if val not in lst:
            lst.append(val)
        doc[field] = lst
    for field, val in (update.get("$pull") or {}).items():
        lst = list(doc.get(field) or [])
        if isinstance(val, dict):
            lst = [item for item in lst if not all(item.get(k2) == v2 for k2, v2 in val.items())]
        else:
            lst = [item for item in lst if item != val]
        doc[field] = lst


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _FakeCursor([d for d in self.docs if _match(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if _match(d, query or {}):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                _apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            _apply(new_doc, update)
            self.docs.append(new_doc)


UID = "fixture-user@example.com"


def _patch_router_cols(monkeypatch, prefs_docs=None, cashflow_docs=None,
                        txn_docs=None, yapily_txn_docs=None,
                        acct_docs=None, yapily_acct_docs=None,
                        stub_recompute=True):
    prefs_col = FakeCol(prefs_docs or [])
    cashflow_col = FakeCol(cashflow_docs or [])
    monkeypatch.setattr(analytics, "preferences_col", prefs_col)
    monkeypatch.setattr(analytics, "cashflow_cache_col", cashflow_col)
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(txn_docs or []))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol(yapily_txn_docs or []))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol(acct_docs or []))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol(yapily_acct_docs or []))
    if stub_recompute:
        async def _noop_recompute(uid, clear_ai_cache=True):
            return None
        monkeypatch.setattr(analytics, "compute_and_cache_cashflow", _noop_recompute)
    return prefs_col, cashflow_col


# ── dismiss_recurring: meta stamping ────────────────────────────────────

def test_dismiss_stamps_meta_dismissed_at_and_hidden_false(monkeypatch):
    prefs_col, _ = _patch_router_cols(monkeypatch, prefs_docs=[{"user_id": UID}])

    before = datetime.now()
    asyncio.run(dismiss_recurring({"key": "NETFLIX.COM"}, {"email": UID}))
    after = datetime.now()

    doc = prefs_col.docs[0]
    assert doc["dismissed_recurring"] == ["NETFLIX.COM"]
    meta = doc["dismissed_recurring_meta"]["NETFLIX.COM"]
    assert meta["hidden"] is False
    assert before <= meta["dismissed_at"] <= after


def test_dismiss_upserts_when_no_prefs_doc_exists(monkeypatch):
    prefs_col, _ = _patch_router_cols(monkeypatch, prefs_docs=[])
    asyncio.run(dismiss_recurring({"key": "GYM"}, {"email": UID}))
    assert len(prefs_col.docs) == 1
    assert prefs_col.docs[0]["dismissed_recurring"] == ["GYM"]
    assert "GYM" in prefs_col.docs[0]["dismissed_recurring_meta"]


def test_restore_removes_key_and_its_meta(monkeypatch):
    prefs_docs = [{
        "user_id": UID,
        "dismissed_recurring": ["NETFLIX.COM", "SPOTIFY"],
        "dismissed_recurring_meta": {
            "NETFLIX.COM": {"dismissed_at": datetime.now(), "hidden": False},
            "SPOTIFY": {"dismissed_at": datetime.now(), "hidden": False},
        },
    }]
    prefs_col, _ = _patch_router_cols(monkeypatch, prefs_docs=prefs_docs)
    asyncio.run(restore_recurring({"key": "NETFLIX.COM"}, {"email": UID}))
    doc = prefs_col.docs[0]
    assert doc["dismissed_recurring"] == ["SPOTIFY"]
    assert "NETFLIX.COM" not in doc["dismissed_recurring_meta"]
    assert "SPOTIFY" in doc["dismissed_recurring_meta"]


# ── Lazy migration ───────────────────────────────────────────────────────

def test_stamp_missing_meta_only_touches_keys_without_an_entry():
    now = datetime(2026, 8, 28, 12, 0, 0)
    existing_ts = datetime(2026, 7, 1, 9, 0, 0)
    meta = {"OLD": {"dismissed_at": existing_ts, "hidden": True}}
    updated, changed = _stamp_missing_meta(["OLD", "NEW"], meta, now)
    assert changed is True
    assert updated["OLD"] == {"dismissed_at": existing_ts, "hidden": True}  # untouched
    assert updated["NEW"] == {"dismissed_at": now, "hidden": False}  # freshly stamped


def test_stamp_missing_meta_no_op_when_nothing_missing():
    now = datetime(2026, 8, 28)
    meta = {"OLD": {"dismissed_at": now, "hidden": False}}
    updated, changed = _stamp_missing_meta(["OLD"], meta, now)
    assert changed is False
    assert updated == meta


def test_get_dismissed_series_lazily_migrates_legacy_dismissal(monkeypatch):
    # A legacy dismissal with no meta entry at all (predates this feature).
    prefs_docs = [{"user_id": UID, "dismissed_recurring": ["OLD MERCHANT"]}]
    prefs_col, _ = _patch_router_cols(monkeypatch, prefs_docs=prefs_docs)

    result = asyncio.run(dismissed_series({"email": UID}))

    # It shows up now (freshly stamped, so within the 60-day window)...
    assert [r["key"] for r in result["user"]] == ["OLD MERCHANT"]
    assert result["user"][0]["dismissed_at"] is not None
    # ...and the stamp was actually persisted, not just computed in-memory.
    assert "OLD MERCHANT" in prefs_col.docs[0]["dismissed_recurring_meta"]
    assert prefs_col.docs[0]["dismissed_recurring_meta"]["OLD MERCHANT"]["hidden"] is False


# ── 60-day window (pure helper — explicit `now`, no wall-clock race) ────

def test_within_window_true_just_inside_60_days():
    now = datetime(2026, 8, 28, 12, 0, 0)
    ts = now - timedelta(days=59, hours=23)
    assert _within_window(ts, now) is True


def test_within_window_false_just_outside_60_days():
    now = datetime(2026, 8, 28, 12, 0, 0)
    ts = now - timedelta(days=61)
    assert _within_window(ts, now) is False


def test_within_window_false_for_none():
    assert _within_window(None, datetime.now()) is False


def test_within_window_handles_iso_string_defensively():
    now = datetime(2026, 8, 28, 12, 0, 0)
    ts = (now - timedelta(days=10)).isoformat()
    assert _within_window(ts, now) is True


def test_get_dismissed_series_excludes_entry_older_than_60_days(monkeypatch):
    now = datetime.now()
    prefs_docs = [{
        "user_id": UID,
        "dismissed_recurring": ["OLD", "RECENT"],
        "dismissed_recurring_meta": {
            "OLD": {"dismissed_at": now - timedelta(days=90), "hidden": False},
            "RECENT": {"dismissed_at": now - timedelta(days=5), "hidden": False},
        },
    }]
    _patch_router_cols(monkeypatch, prefs_docs=prefs_docs)
    result = asyncio.run(dismissed_series({"email": UID}))
    assert [r["key"] for r in result["user"]] == ["RECENT"]


def test_get_dismissed_series_excludes_engine_veto_older_than_60_days(monkeypatch):
    now = datetime.now()
    prefs_docs = [{"user_id": UID}]
    cashflow_docs = [{
        "_id": UID,
        "engine_vetoed_recurring": [
            {"key": "COMP BAL XFR", "category": "Transfer", "reason": "old",
             "confidence": 0.8, "vetoed_at": now - timedelta(days=70)},
            {"key": "TFL TRAVEL", "category": "Transfer", "reason": "recent",
             "confidence": 0.9, "vetoed_at": now - timedelta(days=1)},
        ],
    }]
    _patch_router_cols(monkeypatch, prefs_docs=prefs_docs, cashflow_docs=cashflow_docs)
    result = asyncio.run(dismissed_series({"email": UID}))
    assert [r["key"] for r in result["engine"]] == ["TFL TRAVEL"]
    assert result["engine"][0]["reason"] == "recent"
    assert result["engine"][0]["confidence"] == 0.9


# ── hidden filter, both provenances ──────────────────────────────────────

def test_get_dismissed_series_excludes_hidden_user_row(monkeypatch):
    now = datetime.now()
    prefs_docs = [{
        "user_id": UID,
        "dismissed_recurring": ["VISIBLE", "HIDDEN"],
        "dismissed_recurring_meta": {
            "VISIBLE": {"dismissed_at": now, "hidden": False},
            "HIDDEN": {"dismissed_at": now, "hidden": True},
        },
    }]
    _patch_router_cols(monkeypatch, prefs_docs=prefs_docs)
    result = asyncio.run(dismissed_series({"email": UID}))
    assert [r["key"] for r in result["user"]] == ["VISIBLE"]


def test_get_dismissed_series_excludes_hidden_engine_row(monkeypatch):
    now = datetime.now()
    prefs_docs = [{"user_id": UID, "vetoed_hidden": ["HIDDEN VETO"]}]
    cashflow_docs = [{
        "_id": UID,
        "engine_vetoed_recurring": [
            {"key": "HIDDEN VETO", "category": "Transfer", "reason": "x", "confidence": 0.7, "vetoed_at": now},
            {"key": "VISIBLE VETO", "category": "Transfer", "reason": "y", "confidence": 0.7, "vetoed_at": now},
        ],
    }]
    _patch_router_cols(monkeypatch, prefs_docs=prefs_docs, cashflow_docs=cashflow_docs)
    result = asyncio.run(dismissed_series({"email": UID}))
    assert [r["key"] for r in result["engine"]] == ["VISIBLE VETO"]


# ── hide / unhide round-trip ──────────────────────────────────────────────

def test_hide_then_unhide_user_row_round_trip(monkeypatch):
    now = datetime.now()
    prefs_docs = [{
        "user_id": UID,
        "dismissed_recurring": ["NETFLIX.COM"],
        "dismissed_recurring_meta": {"NETFLIX.COM": {"dismissed_at": now, "hidden": False}},
    }]
    prefs_col, _ = _patch_router_cols(monkeypatch, prefs_docs=prefs_docs)

    asyncio.run(hide_dismissed_series({"key": "NETFLIX.COM", "provenance": "user", "hidden": True}, {"email": UID}))
    assert prefs_col.docs[0]["dismissed_recurring_meta"]["NETFLIX.COM"]["hidden"] is True
    listing_hidden = asyncio.run(dismissed_series({"email": UID}))
    assert listing_hidden["user"] == []

    asyncio.run(hide_dismissed_series({"key": "NETFLIX.COM", "provenance": "user", "hidden": False}, {"email": UID}))
    assert prefs_col.docs[0]["dismissed_recurring_meta"]["NETFLIX.COM"]["hidden"] is False
    listing_visible = asyncio.run(dismissed_series({"email": UID}))
    assert [r["key"] for r in listing_visible["user"]] == ["NETFLIX.COM"]


def test_hide_then_unhide_engine_row_round_trip(monkeypatch):
    now = datetime.now()
    prefs_docs = [{"user_id": UID}]
    cashflow_docs = [{
        "_id": UID,
        "engine_vetoed_recurring": [
            {"key": "COMP BAL XFR", "category": "Transfer", "reason": "x", "confidence": 0.8, "vetoed_at": now},
        ],
    }]
    prefs_col, _ = _patch_router_cols(monkeypatch, prefs_docs=prefs_docs, cashflow_docs=cashflow_docs)

    asyncio.run(hide_dismissed_series({"key": "COMP BAL XFR", "provenance": "engine", "hidden": True}, {"email": UID}))
    assert prefs_col.docs[0]["vetoed_hidden"] == ["COMP BAL XFR"]
    listing_hidden = asyncio.run(dismissed_series({"email": UID}))
    assert listing_hidden["engine"] == []

    asyncio.run(hide_dismissed_series({"key": "COMP BAL XFR", "provenance": "engine", "hidden": False}, {"email": UID}))
    assert prefs_col.docs[0]["vetoed_hidden"] == []
    listing_visible = asyncio.run(dismissed_series({"email": UID}))
    assert [r["key"] for r in listing_visible["engine"]] == ["COMP BAL XFR"]


def test_hide_user_provenance_404s_for_a_non_dismissed_key(monkeypatch):
    _patch_router_cols(monkeypatch, prefs_docs=[{"user_id": UID}])
    try:
        asyncio.run(hide_dismissed_series({"key": "NOT DISMISSED", "provenance": "user", "hidden": True}, {"email": UID}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 404


# ── override ────────────────────────────────────────────────────────────

def test_override_adds_key_to_judge_overrides_and_stubbed_recompute_runs(monkeypatch):
    prefs_col, cashflow_col = _patch_router_cols(
        monkeypatch,
        prefs_docs=[{"user_id": UID}],
        cashflow_docs=[{"_id": UID, "engine_vetoed_recurring": [{"key": "COMP BAL XFR"}]}],
    )
    asyncio.run(override_engine_veto({"key": "COMP BAL XFR"}, {"email": UID}))
    assert prefs_col.docs[0]["judge_overrides"] == ["COMP BAL XFR"]
    # Belt-and-braces $pull already removed the stale cached veto entry,
    # independent of the (here stubbed) recompute.
    assert cashflow_col.docs[0]["engine_vetoed_recurring"] == []


# ── validation: unknown keys must not silently grow vetoed_hidden /
# judge_overrides (independent-review finding, 2026-08-29) ────────────────

def test_hide_engine_provenance_404s_for_an_unknown_key(monkeypatch):
    _patch_router_cols(
        monkeypatch,
        prefs_docs=[{"user_id": UID}],
        cashflow_docs=[{"_id": UID, "engine_vetoed_recurring": [{"key": "COMP BAL XFR"}]}],
    )
    try:
        asyncio.run(hide_dismissed_series(
            {"key": "MADE UP KEY", "provenance": "engine", "hidden": True}, {"email": UID},
        ))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 404


def test_override_404s_for_an_unknown_key(monkeypatch):
    _patch_router_cols(
        monkeypatch,
        prefs_docs=[{"user_id": UID}],
        cashflow_docs=[{"_id": UID, "engine_vetoed_recurring": [{"key": "COMP BAL XFR"}]}],
    )
    try:
        asyncio.run(override_engine_veto({"key": "MADE UP KEY"}, {"email": UID}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 404


def test_engine_unhide_succeeds_when_veto_has_since_left_the_cache(monkeypatch):
    # The key was hidden earlier (so it's in vetoed_hidden), but a later
    # recompute/re-judge has since dropped it from engine_vetoed_recurring
    # entirely — the unhide must still succeed, not 404, because the user
    # is undoing THEIR OWN prior hide, not guessing at an arbitrary key.
    prefs_col, _ = _patch_router_cols(
        monkeypatch,
        prefs_docs=[{"user_id": UID, "vetoed_hidden": ["COMP BAL XFR"]}],
        cashflow_docs=[{"_id": UID, "engine_vetoed_recurring": []}],
    )
    asyncio.run(hide_dismissed_series(
        {"key": "COMP BAL XFR", "provenance": "engine", "hidden": False}, {"email": UID},
    ))
    assert prefs_col.docs[0]["vetoed_hidden"] == []


def test_engine_unhide_404s_for_a_key_in_neither_list(monkeypatch):
    _patch_router_cols(
        monkeypatch,
        prefs_docs=[{"user_id": UID}],
        cashflow_docs=[{"_id": UID, "engine_vetoed_recurring": []}],
    )
    try:
        asyncio.run(hide_dismissed_series(
            {"key": "NEVER HIDDEN OR VETOED", "provenance": "engine", "hidden": False}, {"email": UID},
        ))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 404


def test_override_of_already_overridden_key_is_idempotent_success(monkeypatch):
    prefs_col, _ = _patch_router_cols(
        monkeypatch,
        prefs_docs=[{"user_id": UID, "judge_overrides": ["COMP BAL XFR"]}],
        # Veto no longer cached at all (already dropped by the first
        # override's recompute) — a repeat override must not need it.
        cashflow_docs=[{"_id": UID, "engine_vetoed_recurring": []}],
    )
    asyncio.run(override_engine_veto({"key": "COMP BAL XFR"}, {"email": UID}))
    assert prefs_col.docs[0]["judge_overrides"] == ["COMP BAL XFR"]  # unchanged, no duplicate


def test_apply_verdicts_override_keeps_key_even_with_a_veto_verdict():
    """The actual "override causes apply_verdicts to keep a vetoed key"
    behaviour: a user override outranks a FRESH veto verdict reached this
    exact call, not just a cached one from before the override existed."""
    series_list = [{"key": "COMP BAL XFR", "category": "Transfer"}]
    verdicts = {
        "COMP BAL XFR": {
            "recurring": False, "confidence": 0.9,
            "reason": "Looks like one-off transfers.",
            "judged_at": datetime.now(),
        }
    }
    kept, vetoed = apply_verdicts(series_list, verdicts, judge_overrides={"COMP BAL XFR"})
    assert [s["key"] for s in kept] == ["COMP BAL XFR"]
    assert vetoed == []


def test_apply_verdicts_without_override_still_vetoes():
    series_list = [{"key": "COMP BAL XFR", "category": "Transfer"}]
    verdicts = {"COMP BAL XFR": {"recurring": False, "confidence": 0.9, "reason": "x", "judged_at": datetime.now()}}
    kept, vetoed = apply_verdicts(series_list, verdicts, judge_overrides=set())
    assert kept == []
    assert [v["key"] for v in vetoed] == ["COMP BAL XFR"]


def test_apply_verdicts_override_is_optional_backward_compatible():
    # Old call shape (no third arg) must keep working unchanged.
    series_list = [{"key": "A", "category": "Transfer"}]
    kept, vetoed = apply_verdicts(series_list, {})
    assert kept == series_list
    assert vetoed == []


# ── enrichment ────────────────────────────────────────────────────────────

def test_enrich_unknown_key_falls_back_to_raw_key(monkeypatch):
    monkeypatch.setattr(analytics, "transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol([]))

    result = asyncio.run(_enrich_dismissed_keys(UID, {"GHOST MERCHANT"}))
    row = result["GHOST MERCHANT"]
    assert row["display_name"] == "GHOST MERCHANT"
    assert row["bank"] is None
    assert row["typical_amount"] is None
    assert row["cadence_label"] is None
    assert row["last_seen"] is None


def test_enrich_known_key_derives_display_fields_from_history(monkeypatch):
    now = datetime.now()
    txns = [
        {"merchant_name": "NETFLIX.COM", "description": "NETFLIX.COM", "amount": -12.99,
         "date": now - timedelta(days=60), "account_id": "acc1", "user_id": UID},
        {"merchant_name": "NETFLIX.COM", "description": "NETFLIX.COM", "amount": -12.99,
         "date": now - timedelta(days=30), "account_id": "acc1", "user_id": UID},
        {"merchant_name": "NETFLIX.COM", "description": "NETFLIX.COM", "amount": -13.99,
         "date": now - timedelta(days=1), "account_id": "acc1", "user_id": UID},
    ]
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([
        {"_id": "acc1", "user_id": UID, "provider": "Monzo"},
    ]))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol([]))

    result = asyncio.run(_enrich_dismissed_keys(UID, {"NETFLIX.COM"}))
    row = result["NETFLIX.COM"]
    assert row["display_name"] == "NETFLIX.COM"
    assert row["bank"] == "Monzo"
    assert row["typical_amount"] == 12.99
    assert row["cadence_label"] == "monthly"
    assert row["last_seen"] == (now - timedelta(days=1)).date().isoformat()


def test_cadence_label_thresholds():
    base = datetime(2026, 1, 1)
    monthly = [base, base + timedelta(days=30), base + timedelta(days=60)]
    assert _cadence_label_for_dates(monthly) == "monthly"

    roughly_monthly = [base, base + timedelta(days=25), base + timedelta(days=58)]
    assert _cadence_label_for_dates(roughly_monthly) == "roughly monthly"

    weekly = [base, base + timedelta(days=7), base + timedelta(days=14)]
    assert _cadence_label_for_dates(weekly) == "weekly"

    irregular = [base, base + timedelta(days=3), base + timedelta(days=95)]
    assert _cadence_label_for_dates(irregular) is None

    assert _cadence_label_for_dates([base]) is None
